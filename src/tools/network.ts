import { z } from "zod";
import { DevboxSSH } from "../ssh.js";

export const WolSchema = z.object({
  mac: z.string().describe("MAC address of the machine to wake (e.g. AA:BB:CC:DD:EE:FF)"),
  broadcast: z.string().optional().default("255.255.255.255").describe("Broadcast address (default: 255.255.255.255)"),
});

export async function wolSend(ssh: DevboxSSH, input: z.infer<typeof WolSchema>): Promise<string> {
  // Try wakeonlan first, fall back to etherwake
  const result = await ssh.exec(
    `command -v wakeonlan >/dev/null 2>&1 && wakeonlan -i ${input.broadcast} ${input.mac} || etherwake -i eth0 ${input.mac}`
  );
  if (result.exitCode !== 0) throw new Error(result.stderr || "Wake-on-LAN failed — is wakeonlan or etherwake installed?");
  return `Sent Wake-on-LAN magic packet to ${input.mac}.`;
}

export async function tailscaleStatus(ssh: DevboxSSH): Promise<string> {
  const result = await ssh.exec("tailscale status 2>/dev/null || echo 'Tailscale not found or not running'");
  return result.stdout.trim() || result.stderr.trim() || "(no output)";
}
