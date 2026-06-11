import { NodeSSH } from "node-ssh";
import { homedir } from "os";
import { resolve } from "path";
import { shellEscape } from "./utils.js";

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

/**
 * Parse a command timeout from an env var with validation.
 * Falls back to `defaultMs` if unset, non-numeric, or negative.
 */
function parseTimeout(envKey: string, defaultMs: number): number {
  const raw = process.env[envKey];
  if (!raw) return defaultMs;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n <= 0) {
    process.stderr.write(`[homelab-mcp] WARNING: ${envKey}=${raw} is invalid — using default ${defaultMs}ms\n`);
    return defaultMs;
  }
  return n;
}

/**
 * Shared ssh2 connection options: detect dead peers via keepalive probes
 * (3 missed probes × 15s = connection declared dead) and fail fast when the
 * host is unreachable instead of hanging for the OS default TCP timeout.
 */
export const SSH_CONNECTION_OPTIONS = {
  keepaliveInterval: 15_000,
  keepaliveCountMax: 3,
  readyTimeout: 15_000,
} as const;

/**
 * rm with both recursive and force flags (any order or spelling: -rf, -fr,
 * -r -f, --recursive --force) targeting an absolute path. Scoped to a single
 * command segment so flags after `;`, `|`, or `&` don't trigger false positives.
 */
const RM_RF_ABSOLUTE =
  /\brm\b(?=[^|;&]*\s-{1,2}[\w-]*r)(?=[^|;&]*\s-{1,2}[\w-]*f)[^|;&]*\s\//;

/** Commands that are too dangerous to forward to the devbox. */
export const BLOCKED_PATTERNS = [
  RM_RF_ABSOLUTE,
  /mkfs\b/,
  /dd\s+if=.*of=\/dev\/(sd|nvme|vd|hd)/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bpoweroff\b/,
  /\bhalt\b/,
  /\binit\s+0\b/,
  /\bsystemctl\s+(reboot|poweroff|halt|shutdown)\b/,
  /\bsystemctl\s+stop\s+(ssh|sshd|ssh\.service|ssh\.socket)\b/,
];

/**
 * Singleton SSH client for the devbox.
 * Reconnects automatically if the connection drops.
 */
export class DevboxSSH {
  private ssh: NodeSSH = new NodeSSH();
  private connected = false;
  private cmdTimeout: number;
  private config: {
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKeyPath?: string;
    tryKeyboard: boolean;
    hostVerifier: () => boolean;
  } & typeof SSH_CONNECTION_OPTIONS;

  constructor() {
    const required = ["DEVBOX_HOST", "DEVBOX_PORT", "DEVBOX_USER"];
    for (const key of required) {
      if (!process.env[key]) throw new Error(`Missing env var: ${key}`);
    }

    // Configurable command timeout (default 30s)
    this.cmdTimeout = parseTimeout("DEVBOX_CMD_TIMEOUT", 30_000);
    this.config = {
      host: process.env.DEVBOX_HOST!,
      port: parseInt(process.env.DEVBOX_PORT!, 10),
      username: process.env.DEVBOX_USER!,
      // Homelab hosts often rotate keys; avoid hard failures on host key trust.
      hostVerifier,
      tryKeyboard: true,
      ...SSH_CONNECTION_OPTIONS,
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
        const ts = new Date().toISOString();
        process.stderr.write(`[homelab-mcp] ${ts} BLOCKED devbox command: "${command}" (matched ${pattern})\n`);
        return {
          stdout: "",
          stderr: `Command blocked by safety filter: matches pattern ${pattern}`,
          exitCode: 1,
        };
      }
    }

    if (process.env.DEBUG_COMMANDS === "true") {
      process.stderr.write(`[homelab-mcp] devbox exec: "${command}" (cwd: ${cwd})\n`);
    }

    await this.ensureConnected();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Command timed out after ${Math.round(this.cmdTimeout / 1000)}s`));
      }, this.cmdTimeout);

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
      await this.exec(`mkdir -p ${shellEscape(dir)}`);
    }
    // Encode on the client side, decode remotely — avoids heredoc quoting issues
    const b64 = Buffer.from(content, "utf8").toString("base64");
    const result = await this.exec(`printf '%s' "${b64}" | base64 -d > ${shellEscape(path)}`);
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

export const PVE_BLOCKED_PATTERNS = [
  RM_RF_ABSOLUTE,
  /mkfs\b/,
  /dd\s+if=.*of=\/dev\/(sd|nvme|vd|hd)/,
  /\bpoweroff\b/,
  /\bhalt\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\binit\s+0\b/,
  /\bsystemctl\s+(reboot|poweroff|halt|shutdown)\b/,
];

export class ProxmoxSSH {
  private ssh: NodeSSH = new NodeSSH();
  private connected = false;
  private cmdTimeout: number;
  private config: {
    host: string;
    port: number;
    username: string;
    privateKeyPath?: string;
    password?: string;
    tryKeyboard: boolean;
    hostVerifier: () => boolean;
  } & typeof SSH_CONNECTION_OPTIONS;

  constructor() {
    if (!process.env.PROXMOX_HOST) throw new Error("Missing env var: PROXMOX_HOST");

    // Configurable command timeout (default 60s)
    this.cmdTimeout = parseTimeout("PROXMOX_CMD_TIMEOUT", 60_000);
    const sshUser = (process.env.PROXMOX_USER ?? "root").split("@")[0];
    this.config = {
      host: process.env.PROXMOX_HOST!,
      port: 22,
      username: sshUser,
      tryKeyboard: true,
      hostVerifier,
      ...SSH_CONNECTION_OPTIONS,
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
        const ts = new Date().toISOString();
        process.stderr.write(`[homelab-mcp] ${ts} BLOCKED proxmox command: "${command}" (matched ${pattern})\n`);
        return {
          stdout: "",
          stderr: `Command blocked by safety filter: matches pattern ${pattern}`,
          exitCode: 1,
        };
      }
    }

    if (process.env.DEBUG_COMMANDS === "true") {
      process.stderr.write(`[homelab-mcp] proxmox exec: "${command}" (cwd: ${cwd})\n`);
    }

    await this.ensureConnected();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Command timed out after ${Math.round(this.cmdTimeout / 1000)}s`));
      }, this.cmdTimeout);

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
