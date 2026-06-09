import { z } from "zod";
import { DevboxSSH, ProxmoxSSH } from "../ssh.js";

/**
 * Returns the media container list from MEDIA_CONTAINERS env var (comma-separated)
 * or falls back to the default set.
 */
function mediaContainers(): string[] {
  const env = process.env.MEDIA_CONTAINERS;
  if (env) return env.split(",").map((s) => s.trim()).filter(Boolean);
  return ["plex", "radarr", "sonarr", "sabnzbd", "seerr", "prowlarr"];
}

export const ContainerLogsSchema = z.object({
  container: z.string().describe("Container name — use media_status to see available containers"),
  lines: z.number().optional().default(100).describe("Number of log lines to return (default 100)"),
});

export const ContainerRestartSchema = z.object({
  container: z.string().describe("Container name — use media_status to see available containers"),
});

// ── Docker ops run directly on the devbox ────────────────────────────────────

export async function mediaLogs(ssh: DevboxSSH, input: z.infer<typeof ContainerLogsSchema>): Promise<string> {
  const valid = mediaContainers();
  if (!valid.includes(input.container)) {
    return `Unknown container "${input.container}". Available: ${valid.join(", ")}`;
  }
  const result = await ssh.exec(`docker logs --tail=${input.lines} ${input.container} 2>&1`);
  return result.stdout || result.stderr || "(no logs)";
}

export async function mediaRestart(ssh: DevboxSSH, input: z.infer<typeof ContainerRestartSchema>): Promise<string> {
  const valid = mediaContainers();
  if (!valid.includes(input.container)) {
    return `Unknown container "${input.container}". Available: ${valid.join(", ")}`;
  }
  const result = await ssh.exec(`docker restart ${input.container}`);
  if (result.exitCode !== 0) throw new Error(result.stderr);
  return `Restarted ${input.container} successfully.`;
}

export async function mediaStatus(ssh: DevboxSSH): Promise<string> {
  const result = await ssh.exec(
    `docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.RunningFor}}"`
  );
  return result.stdout || "(no containers running)";
}

// ── GPU and security run on the Proxmox host ─────────────────────────────────

export async function nvidiaStatus(ssh: ProxmoxSSH): Promise<string> {
  const result = await ssh.exec(
    `nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,utilization.memory,memory.used,memory.total,power.draw --format=csv,noheader,nounits`
  );
  if (result.exitCode !== 0) throw new Error("nvidia-smi failed — is the driver loaded?");
  const [name, temp, gpuUtil, memUtil, memUsed, memTotal, power] = result.stdout.trim().split(", ");
  return (
    `GPU: ${name}\n` +
    `Temp: ${temp}°C | Power: ${power}W\n` +
    `GPU Util: ${gpuUtil}% | Memory: ${memUsed}/${memTotal} MB (${memUtil}%)`
  );
}

export async function securityStatus(ssh: ProxmoxSSH): Promise<string> {
  const [sshConf, fwStatus] = await Promise.all([
    ssh.exec(`sshd -T 2>/dev/null | grep -E "permitrootlogin|passwordauthentication"`),
    ssh.exec(`pve-firewall status 2>/dev/null`),
  ]);

  const lines: string[] = ["SECURITY STATUS\n"];
  const sshOut    = sshConf.stdout;
  const rootLogin = sshOut.includes("prohibit-password") || sshOut.includes("without-password") ? "✓ key-only" : "✗ password allowed";
  const pwAuth    = sshOut.includes("passwordauthentication no") ? "✓ disabled" : "✗ enabled";
  lines.push(`SSH Root Login: ${rootLogin}`);
  lines.push(`SSH Password Auth: ${pwAuth}`);

  const fwEnabled = fwStatus.stdout.includes("enabled/running") ? "✓ enabled" : "✗ disabled";
  lines.push(`Proxmox Firewall: ${fwEnabled}`);

  return lines.join("\n");
}
