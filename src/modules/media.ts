import { ToolModule } from "../types.js";
import { ProxmoxClient } from "../proxmox.js";
import { ProxmoxSSH, DevboxSSH } from "../ssh.js";
import { ArrClient } from "../arr.js";
import { SabnzbdClient } from "../sabnzbd.js";
import * as impl from "../tools/containers.js";
import { mediaDashboard } from "../tools/dashboard.js";

export function mediaModule(
  devbox: DevboxSSH,    // docker commands run on devbox
  pveSSH: ProxmoxSSH,  // GPU + security checks run on Proxmox host
  proxmox: ProxmoxClient,
  radarr: ArrClient,
  sonarr: ArrClient,
  sabnzbd: SabnzbdClient,
): ToolModule {
  return {
    domain: "Media",
    tools: [
      {
        name: "media_logs",
        description: "Get recent log output from a media service container running on the devbox.",
        inputSchema: {
          type: "object",
          properties: {
            container: { type: "string", description: "Container name — use media_status to see available containers" },
            lines: { type: "number", description: "Number of log lines (default 100)" },
          },
          required: ["container"],
        },
      },
      {
        name: "media_restart",
        description: "Restart a media service container on the devbox.",
        inputSchema: {
          type: "object",
          properties: {
            container: { type: "string", description: "Container name — use media_status to see available containers" },
          },
          required: ["container"],
        },
      },
      {
        name: "media_status",
        description: "Show the status and uptime of all running containers on the devbox.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "media_dashboard",
        description: "All-in-one homelab status: Proxmox node health, container status, active downloads, library stats, and storage — all in a single call.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "nvidia_status",
        description: "Show GPU temperature, utilization, VRAM usage, and power draw (runs on Proxmox host).",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "security_status",
        description: "Check homelab security: SSH config and Proxmox firewall status.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
    ],

    async handle(name, args) {
      switch (name) {
        case "media_logs":      return impl.mediaLogs(devbox, impl.ContainerLogsSchema.parse(args));
        case "media_restart":   return impl.mediaRestart(devbox, impl.ContainerRestartSchema.parse(args));
        case "media_status":    return impl.mediaStatus(devbox);
        case "media_dashboard": return mediaDashboard(proxmox, pveSSH, devbox, radarr, sonarr, sabnzbd);
        case "nvidia_status":   return impl.nvidiaStatus(pveSSH);
        case "security_status": return impl.securityStatus(pveSSH);
        default: return null;
      }
    },
  };
}
