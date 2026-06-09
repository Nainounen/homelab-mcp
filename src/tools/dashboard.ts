import { ProxmoxClient } from "../proxmox.js";
import { ProxmoxSSH, DevboxSSH } from "../ssh.js";
import { ArrClient } from "../arr.js";
import { SabnzbdClient } from "../sabnzbd.js";
import { bytes, speed } from "../utils.js";

function diskPaths(): string {
  return process.env.DASHBOARD_DISK_PATHS ?? "";
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
      pveSSH.exec(`df -h ${disks} 2>/dev/null | tail -n +2 | awk '{print $6": "$3"/"$2" used, "$4" free"}'`),
      pveSSH.exec("nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null"),
      devbox.exec(`python3 - <<'PY'
import json, os, urllib.request
from pathlib import Path

def load_env(path: str) -> dict:
  env = {}
  for line in Path(path).read_text().splitlines():
    if not line or line.startswith('#') or '=' not in line:
      continue
    key, value = line.split('=', 1)
    env[key] = value
  return env

def fetch(url: str, api_key: str | None = None):
  headers = {"X-Api-Key": api_key} if api_key else {}
  req = urllib.request.Request(url, headers=headers)
  with urllib.request.urlopen(req, timeout=10) as response:
    return json.load(response)

result = {}
# Paths configurable via env vars on the devbox — no hardcoded assumptions
media_env = os.environ.get("MEDIA_ENV_PATH", "/opt/media/.env")
env = load_env(media_env)

# SABnzbd — read API key from its config file
sab_config = os.environ.get("SABNZBD_CONFIG_PATH", "/opt/media/config/sabnzbd/sabnzbd.ini")
sab_port  = os.environ.get("SABNZBD_PORT", "8085")
try:
  sab_ini = Path(sab_config).read_text().splitlines()
  sab_key = next(line.split(' = ', 1)[1].strip() for line in sab_ini if line.startswith('api_key = '))
  sab_queue = fetch(f'http://127.0.0.1:{sab_port}/api?mode=queue&output=json&apikey={sab_key}')
  q = sab_queue.get('queue', {})
  result['sab'] = {
    'status': q.get('status', 'unknown'),
    'speed': float(q.get('kbpersec', 0) or 0),
    'jobs': int(q.get('noofslots', 0) or 0),
    'sizeleft': q.get('sizeleft', '0 B'),
  }
except Exception as exc:
  result['sab_error'] = str(exc)

# Prowlarr
prowlarr_port = os.environ.get("PROWLARR_PORT", "9696")
try:
  prowlarr_key = env.get('PROWLARR_API_KEY')
  if prowlarr_key:
    health = fetch(f'http://127.0.0.1:{prowlarr_port}/api/v1/health', prowlarr_key)
    indexers = fetch(f'http://127.0.0.1:{prowlarr_port}/api/v1/indexer', prowlarr_key)
    result['prowlarr'] = {
      'enabled_indexers': sum(1 for i in indexers if i.get('enable')),
      'health_warnings': len(health),
    }
except Exception as exc:
  result['prowlarr_error'] = str(exc)

# Overseerr
overseerr_port = os.environ.get("OVERSEERR_PORT", "5055")
try:
  overseerr_key = env.get('OVERSEERR_API_KEY')
  if overseerr_key:
    status = fetch(f'http://127.0.0.1:{overseerr_port}/api/v1/status', overseerr_key)
    counts = fetch(f'http://127.0.0.1:{overseerr_port}/api/v1/request/count', overseerr_key)
    result['seerr'] = {
      'version': status.get('version'),
      'pending': counts.get('pending'),
      'processing': counts.get('processing'),
      'approved': counts.get('approved'),
      'available': counts.get('available'),
    }
except Exception as exc:
  result['seerr_error'] = str(exc)

print(json.dumps(result))
PY`),
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
