import { ProxmoxClient } from "../proxmox.js";
import { ProxmoxSSH, DevboxSSH } from "../ssh.js";
import { ArrClient } from "../arr.js";
import { SabnzbdClient } from "../sabnzbd.js";
import { bytes, speed, shellEscape } from "../utils.js";
import * as fs from "fs";
import * as path from "path";

/**
 * Load the media-health Python script once at startup.
 *
 * SECURITY: This script is loaded from disk at startup — it is operator-controlled,
 * not user-supplied. The script path is resolved relative to this source file and
 * cannot be influenced by tool input or environment variables. Only the operator
 * with filesystem access to the MCP server's installation directory can modify it.
 * If the script file is absent, media-service health checks are silently disabled.
 */
const MEDIA_HEALTH_SCRIPT = (() => {
  const scriptPath = path.resolve(__dirname, "..", "..", "scripts", "media-health.py");
  if (fs.existsSync(scriptPath)) {
    return fs.readFileSync(scriptPath, "utf8");
  }
  process.stderr.write("[homelab-mcp] WARNING: media-health.py not found — media_dashboard Python checks disabled\n");
  return "";
})();

/**
 * Returns validated disk paths from DASHBOARD_DISK_PATHS env var.
 * Only absolute paths with safe characters (alphanumeric, /, -, _, .) are allowed.
 * Any path containing shell metacharacters is rejected and logged.
 */
function diskPaths(): string {
  const raw = (process.env.DASHBOARD_DISK_PATHS ?? "").trim();
  if (!raw) return "";
  const paths = raw.split(/\s+/).filter(Boolean);
  for (const p of paths) {
    if (!/^\/[a-zA-Z0-9\/_\-\.]+$/.test(p)) {
      process.stderr.write(
        `[homelab-mcp] WARNING: DASHBOARD_DISK_PATHS contains unsafe path "${p}" — all paths skipped\n`
      );
      return "";
    }
  }
  return raw;
}

export async function mediaDashboard(
  proxmox: ProxmoxClient,
  pveSSH: ProxmoxSSH,
  devbox: DevboxSSH,
  radarr: ArrClient,
  sonarr: ArrClient,
  _sabnzbd: SabnzbdClient
): Promise<string> {
  const sections: string[] = [];
  const disks = diskPaths();

  const [nodeRes, containersRes, radarrQueueRes, sonarrQueueRes, radarrLibRes, sonarrLibRes, diskRes, gpuRes, mediaHealthRes] =
    await Promise.allSettled([
      proxmox.get<{ cpu: number; memory: { used: number; total: number }; uptime: number }>(`/nodes/${proxmox.node}/status`),
      devbox.exec(`docker ps --format "{{.Names}}\\t{{.Status}}"`),
      radarr.get<{ records: Array<{ title: string; status: string; size: number; sizeleft: number; timeleft?: string }> }>("/queue"),
      sonarr.get<{ records: Array<{ title: string; status: string; size: number; sizeleft: number; timeleft?: string }> }>("/queue"),
      radarr.get<Array<{ hasFile: boolean }>>("/movie"),
      sonarr.get<Array<{ statistics?: { episodeFileCount: number; episodeCount: number } }>>("/series"),
      pveSSH.exec(`df -h ${shellEscape(disks)} 2>/dev/null | tail -n +2 | awk '{print $6": "$3"/"$2" used, "$4" free"}'`),
      pveSSH.exec("nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null"),
      MEDIA_HEALTH_SCRIPT
        ? devbox.exec(`python3 - <<'PY'\n${MEDIA_HEALTH_SCRIPT}\nPY`)
        : Promise.resolve({ stdout: "{}", stderr: "", exitCode: 0 }),
    ]);

  // Node
  if (nodeRes.status === "fulfilled") {
    const n = nodeRes.value;
    const upH = Math.floor(n.uptime / 3600);
    sections.push(
      `PROXMOX\n  CPU: ${(n.cpu * 100).toFixed(1)}%  RAM: ${bytes(n.memory.used)}/${bytes(n.memory.total)}  Up: ${upH}h`
    );
  }

  // Storage
  if (diskRes.status === "fulfilled" && diskRes.value.stdout) {
    const diskLines = diskRes.value.stdout.trim().split("\n").map((l) => `  ${l}`).join("\n");
    sections.push(`STORAGE\n${diskLines}`);
  }

  // Containers
  if (containersRes.status === "fulfilled" && containersRes.value.stdout) {
    const lines = containersRes.value.stdout.trim().split("\n").map((l) => `  ${l}`).join("\n");
    sections.push(`CONTAINERS\n${lines}`);
  }

  // Media services health
  if (mediaHealthRes.status === "fulfilled" && mediaHealthRes.value.stdout) {
    try {
      const mediaHealth = JSON.parse(mediaHealthRes.value.stdout.trim()) as {
        sab?: { status: string; speed: number; jobs: number; sizeleft: string };
        sab_error?: string;
        prowlarr?: { enabled_indexers: number; health_warnings: number };
        prowlarr_error?: string;
        seerr?: { version?: string; pending?: number; processing?: number; approved?: number; available?: number };
        seerr_error?: string;
      };

      const mediaLines: string[] = [];
      if (mediaHealth.sab) {
        mediaLines.push(
          `  SABNZBD: ${mediaHealth.sab.status} | ${speed(mediaHealth.sab.speed * 1024)} | ${mediaHealth.sab.jobs} job(s) | ${mediaHealth.sab.sizeleft} left`
        );
      } else if (mediaHealth.sab_error) {
        mediaLines.push(`  SABNZBD: error (${mediaHealth.sab_error})`);
      }

      if (mediaHealth.prowlarr) {
        const healthState = mediaHealth.prowlarr.health_warnings > 0 ? `${mediaHealth.prowlarr.health_warnings} warning(s)` : "healthy";
        mediaLines.push(`  PROWLARR: ${mediaHealth.prowlarr.enabled_indexers} enabled indexer(s) | ${healthState}`);
      } else if (mediaHealth.prowlarr_error) {
        mediaLines.push(`  PROWLARR: error (${mediaHealth.prowlarr_error})`);
      }

      if (mediaHealth.seerr) {
        mediaLines.push(
          `  SEERR: v${mediaHealth.seerr.version ?? "?"} | pending ${mediaHealth.seerr.pending ?? 0} | processing ${mediaHealth.seerr.processing ?? 0} | approved ${mediaHealth.seerr.approved ?? 0} | available ${mediaHealth.seerr.available ?? 0}`
        );
      } else if (mediaHealth.seerr_error) {
        mediaLines.push(`  SEERR: error (${mediaHealth.seerr_error})`);
      }

      if (mediaLines.length) sections.push(`MEDIA SERVICES\n${mediaLines.join("\n")}`);
    } catch {
      sections.push(`MEDIA SERVICES\n  Unable to parse media service health`);
    }
  }

  // Radarr queue
  if (radarrQueueRes.status === "fulfilled") {
    const records = radarrQueueRes.value.records;
    const lines = records.length
      ? records.slice(0, 5).map((r) => {
          const pct = r.size > 0 ? ((1 - r.sizeleft / r.size) * 100).toFixed(0) : "?";
          return `  ${r.title} — ${pct}% (${r.status})`;
        })
      : ["  No active downloads"];
    sections.push(`RADARR QUEUE\n${lines.join("\n")}`);
  }

  // Sonarr queue
  if (sonarrQueueRes.status === "fulfilled") {
    const records = sonarrQueueRes.value.records;
    const seen = new Set<string>();
    const unique = records.filter((r) => !seen.has(r.title) && seen.add(r.title));
    const lines = unique.length
      ? unique.slice(0, 5).map((r) => {
          const pct = r.size > 0 ? ((1 - r.sizeleft / r.size) * 100).toFixed(0) : "?";
          return `  ${r.title} — ${pct}% (${r.status})`;
        })
      : ["  No active downloads"];
    sections.push(`SONARR QUEUE\n${lines.join("\n")}`);
  }

  // Library stats
  const libLines: string[] = [];
  if (radarrLibRes.status === "fulfilled") {
    const movies = radarrLibRes.value;
    const downloaded = movies.filter((m) => m.hasFile).length;
    libLines.push(`  Movies: ${downloaded}/${movies.length} downloaded`);
  }
  if (sonarrLibRes.status === "fulfilled") {
    const series = sonarrLibRes.value;
    const totalEps = series.reduce((s, x) => s + (x.statistics?.episodeCount ?? 0), 0);
    const gotEps = series.reduce((s, x) => s + (x.statistics?.episodeFileCount ?? 0), 0);
    libLines.push(`  Series: ${series.length} shows, ${gotEps}/${totalEps} episodes`);
  }
  if (libLines.length) sections.push(`LIBRARY\n${libLines.join("\n")}`);

  // GPU
  if (gpuRes.status === "fulfilled" && gpuRes.value.stdout) {
    const parts = gpuRes.value.stdout.trim().split(", ");
    if (parts.length >= 5) {
      const [gpuName, temp, gpuUtil, memUsed, memTotal] = parts;
      sections.push(`GPU\n  ${gpuName} | ${temp}°C | ${gpuUtil}% util | ${memUsed}/${memTotal} MB VRAM`);
    }
  }

  return sections.join("\n\n");
}
