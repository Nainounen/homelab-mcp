import { NodeSSH } from "node-ssh";
import { homedir } from "os";
import { resolve } from "path";

function resolveKeyPath(p: string): string {
  if (p.startsWith("~/") || p === "~") return resolve(homedir(), p.slice(2));
  return p;
}

/**
 * SSH host key verification policy.
 *
 * In homelab environments host keys change frequently (container rebuilds, OS
 * reinstalls).  The default is **lenient** — any host key is accepted.
 *
 * Set SSH_STRICT_HOST_KEY=true to enable standard ~/.ssh/known_hosts checking.
 * This prevents MITM attacks but requires you to pre-populate known_hosts entries
 * for your Proxmox host, devbox, and QNAP NAS.
 */
function hostVerifier(): boolean {
  const strict = process.env.SSH_STRICT_HOST_KEY === "true";
  if (!strict) {
    process.stderr.write("[homelab-mcp] WARNING: SSH host key verification disabled (set SSH_STRICT_HOST_KEY=true to enable)\n");
    return true; // accept any host key
  }
  // Use node-ssh's default behavior — reads ~/.ssh/known_hosts
  return false;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Commands that are too dangerous to forward to the devbox. */
const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\//,
  /mkfs\b/,
  /dd\s+if=.*of=\/dev\/(sd|nvme|vd|hd)/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bpoweroff\b/,
  /\bhalt\b/,
  /\binit\s+0\b/,
  /systemctl\s+(reboot|poweroff|halt|shutdown)/,
  /\bsystemctl\s+stop\s+ssh\b/,
];

/**
 * Singleton SSH client for the devbox.
 * Reconnects automatically if the connection drops.
 */
export class DevboxSSH {
  private ssh: NodeSSH = new NodeSSH();
  private connected = false;
  private config: {
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKeyPath?: string;
    tryKeyboard: boolean;
    hostVerifier: () => boolean;
  };

  constructor() {
    const required = ["DEVBOX_HOST", "DEVBOX_PORT", "DEVBOX_USER"];
    for (const key of required) {
      if (!process.env[key]) throw new Error(`Missing env var: ${key}`);
    }
    this.config = {
      host: process.env.DEVBOX_HOST!,
      port: parseInt(process.env.DEVBOX_PORT!, 10),
      username: process.env.DEVBOX_USER!,
      // Homelab hosts often rotate keys; avoid hard failures on host key trust.
      hostVerifier,
      tryKeyboard: true,
    };
    if (process.env.DEVBOX_KEY_PATH) {
      this.config.privateKeyPath = resolveKeyPath(process.env.DEVBOX_KEY_PATH);
    } else if (process.env.DEVBOX_PASSWORD) {
      this.config.password = process.env.DEVBOX_PASSWORD;
    } else {
      throw new Error("Either DEVBOX_PASSWORD or DEVBOX_KEY_PATH must be set");
    }
  }

  /** Connect (or reconnect) to the devbox. */
  private async ensureConnected(): Promise<void> {
    if (this.connected && this.ssh.isConnected()) return;
    this.ssh = new NodeSSH();
    await this.ssh.connect(this.config);
    this.connected = true;
  }

  /**
   * Execute a shell command on the devbox.
   * Returns stdout, stderr, and the exit code.
   * Rejects blocked commands before sending.
   */
  async exec(command: string, cwd = "/root"): Promise<ExecResult> {
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        return {
          stdout: "",
          stderr: `Command blocked by safety filter: matches pattern ${pattern}`,
          exitCode: 1,
        };
      }
    }

    await this.ensureConnected();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Command timed out after 30s"));
      }, 30_000);

      this.ssh
        .execCommand(command, { cwd })
        .then((result) => {
          clearTimeout(timeout);
          resolve({
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.code ?? 0,
          });
        })
        .catch((err: unknown) => {
          clearTimeout(timeout);
          this.connected = false;
          reject(err);
        });
    });
  }

  /** Write a file on the devbox by base64-encoding content and piping through SSH. */
  async writeFile(path: string, content: string): Promise<void> {
    // Ensure parent directory exists
    const dir = path.substring(0, path.lastIndexOf("/"));
    if (dir) {
      await this.exec(`mkdir -p "${dir}"`);
    }
    // Encode on the client side, decode remotely — avoids heredoc quoting issues
    const b64 = Buffer.from(content, "utf8").toString("base64");
    const result = await this.exec(`echo '${b64}' | base64 -d > "${path}"`);
    if (result.exitCode !== 0) {
      throw new Error(`writeFile failed: ${result.stderr}`);
    }
  }
}

let _devboxInstance: DevboxSSH | null = null;

/** Return the singleton DevboxSSH instance, creating it on first call. */
export function getDevbox(): DevboxSSH {
  if (!_devboxInstance) {
    _devboxInstance = new DevboxSSH();
  }
  return _devboxInstance;
}

// ─── Proxmox SSH ──────────────────────────────────────────────────────────────

const PVE_BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\/(?:\s|$)/,
  /mkfs\b/,
  /dd\s+if=.*of=\/dev\/(sd|nvme|vd|hd)/,
  /\bpoweroff\b/,
  /\bhalt\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\binit\s+0\b/,
  /systemctl\s+(reboot|poweroff|halt|shutdown)/,
];

export class ProxmoxSSH {
  private ssh: NodeSSH = new NodeSSH();
  private connected = false;
  private config: {
    host: string;
    port: number;
    username: string;
    privateKeyPath?: string;
    password?: string;
    tryKeyboard: boolean;
    hostVerifier: () => boolean;
  };

  constructor() {
    if (!process.env.PROXMOX_HOST) throw new Error("Missing env var: PROXMOX_HOST");
    const sshUser = (process.env.PROXMOX_USER ?? "root").split("@")[0];
    this.config = {
      host: process.env.PROXMOX_HOST!,
      port: 22,
      username: sshUser,
      tryKeyboard: true,
      hostVerifier,
    };
    // Prefer key auth (secure), fall back to password
    if (process.env.PROXMOX_KEY_PATH) {
      this.config.privateKeyPath = resolveKeyPath(process.env.PROXMOX_KEY_PATH);
    } else if (process.env.DEVBOX_KEY_PATH) {
      // Fallback: reuse devbox key if no dedicated Proxmox key is set
      this.config.privateKeyPath = resolveKeyPath(process.env.DEVBOX_KEY_PATH);
    } else if (process.env.PROXMOX_PASSWORD) {
      this.config.password = process.env.PROXMOX_PASSWORD;
    } else {
      throw new Error("Either PROXMOX_KEY_PATH, DEVBOX_KEY_PATH, or PROXMOX_PASSWORD must be set for Proxmox SSH");
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected && this.ssh.isConnected()) return;
    this.ssh = new NodeSSH();
    await this.ssh.connect(this.config);
    this.connected = true;
  }

  async exec(command: string, cwd = "/"): Promise<ExecResult> {
    for (const pattern of PVE_BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        return {
          stdout: "",
          stderr: `Command blocked by safety filter: matches pattern ${pattern}`,
          exitCode: 1,
        };
      }
    }

    await this.ensureConnected();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Command timed out after 60s"));
      }, 60_000);

      this.ssh
        .execCommand(command, { cwd })
        .then((result) => {
          clearTimeout(timeout);
          resolve({
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.code ?? 0,
          });
        })
        .catch((err: unknown) => {
          clearTimeout(timeout);
          this.connected = false;
          reject(err);
        });
    });
  }
}

let _proxmoxSshInstance: ProxmoxSSH | null = null;

export function getProxmoxSSH(): ProxmoxSSH {
  if (!_proxmoxSshInstance) {
    _proxmoxSshInstance = new ProxmoxSSH();
  }
  return _proxmoxSshInstance;
}
