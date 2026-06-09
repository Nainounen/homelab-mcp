import { NodeSSH } from "node-ssh";
import { homedir } from "os";
import { resolve } from "path";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function resolveKeyPath(p: string): string {
  if (p.startsWith("~/") || p === "~") return resolve(homedir(), p.slice(2));
  return p;
}

function hostVerifier(): boolean {
  const strict = process.env.SSH_STRICT_HOST_KEY === "true";
  if (!strict) return true;
  return false;
}

export class QnapSSH {
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
    if (!process.env.QNAP_HOST) throw new Error("Missing env var: QNAP_HOST");
    this.config = {
      host: process.env.QNAP_HOST!,
      port: parseInt(process.env.QNAP_PORT ?? "22", 10),
      username: process.env.QNAP_USER ?? "admin",
      tryKeyboard: true,
      hostVerifier,
    };
    if (process.env.QNAP_KEY_PATH) {
      this.config.privateKeyPath = resolveKeyPath(process.env.QNAP_KEY_PATH);
    } else if (process.env.DEVBOX_KEY_PATH) {
      // Fallback: reuse devbox key if no dedicated QNAP key is set
      this.config.privateKeyPath = resolveKeyPath(process.env.DEVBOX_KEY_PATH);
    } else if (process.env.QNAP_PASSWORD) {
      this.config.password = process.env.QNAP_PASSWORD;
    } else {
      throw new Error("Either QNAP_KEY_PATH, DEVBOX_KEY_PATH, or QNAP_PASSWORD must be set for QNAP SSH");
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected && this.ssh.isConnected()) return;
    this.ssh = new NodeSSH();
    await this.ssh.connect(this.config);
    this.connected = true;
  }

  async exec(command: string): Promise<ExecResult> {
    await this.ensureConnected();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Command timed out after 30s")), 30_000);
      this.ssh.execCommand(command).then((r) => {
        clearTimeout(timeout);
        resolve({ stdout: r.stdout, stderr: r.stderr, exitCode: r.code ?? 0 });
      }).catch((err) => {
        clearTimeout(timeout);
        this.connected = false;
        reject(err);
      });
    });
  }
}

let _qnapInstance: QnapSSH | null = null;

export function getQnap(): QnapSSH {
  if (!_qnapInstance) _qnapInstance = new QnapSSH();
  return _qnapInstance;
}
