import axios from "axios";
import https from "https";
import net from "net";

interface HealthCheck {
  service: string;
  url: string;
  reachable: boolean;
  latencyMs: number;
  error?: string;
}

/**
 * Reachability-only HTTPS agent: homelab services almost always use
 * self-signed certificates. This check only answers "is it up?" — no data
 * is trusted from the response, so skipping cert verification is safe here.
 */
const reachabilityAgent = new https.Agent({ rejectUnauthorized: false });

/** Probe an HTTP(S) endpoint. Any HTTP response (including 401/403/404) counts as reachable. */
async function httpCheck(service: string, url: string, timeout: number): Promise<HealthCheck> {
  const start = Date.now();
  try {
    await axios.get(url, {
      timeout,
      validateStatus: () => true,
      httpsAgent: reachabilityAgent,
    });
    return { service, url, reachable: true, latencyMs: Date.now() - start };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { service, url, reachable: false, latencyMs: Date.now() - start, error: msg };
  }
}

/** Probe a raw TCP port (for SSH-only hosts like the devbox and QNAP). */
function tcpCheck(service: string, host: string, port: number, timeout: number): Promise<HealthCheck> {
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout });
    const done = (reachable: boolean, error?: string) => {
      socket.destroy();
      resolve({ service, url: `${host}:${port}`, reachable, latencyMs: Date.now() - start, error });
    };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false, `TCP connect timed out after ${timeout}ms`));
    socket.once("error", (err) => done(false, err.message));
  });
}

/**
 * Run a quick health check against all configured services.
 * Returns reachable/unreachable status and latency for each.
 */
export async function homelabHealth(): Promise<string> {
  const probes: Array<Promise<HealthCheck>> = [];

  const add = (service: string, envKey: string, timeout = 5_000) => {
    const url = process.env[envKey];
    if (url) probes.push(httpCheck(service, url, timeout));
  };

  const addTcp = (service: string, hostKey: string, portKey: string, defaultPort: number, timeout = 3_000) => {
    const host = process.env[hostKey];
    if (!host) return;
    const port = parseInt(process.env[portKey] ?? "", 10) || defaultPort;
    probes.push(tcpCheck(service, host, port, timeout));
  };

  // Host-only services: Proxmox exposes its API over HTTPS on PROXMOX_PORT,
  // the devbox and QNAP are reached via SSH, so probe their TCP ports.
  if (process.env.PROXMOX_HOST) {
    const port = parseInt(process.env.PROXMOX_PORT ?? "", 10) || 8006;
    probes.push(httpCheck("Proxmox", `https://${process.env.PROXMOX_HOST}:${port}`, 3_000));
  }
  addTcp("Devbox", "DEVBOX_HOST", "DEVBOX_PORT", 22);
  addTcp("QNAP", "QNAP_HOST", "QNAP_PORT", 22);
  add("Radarr", "RADARR_URL");
  add("Sonarr", "SONARR_URL");
  add("Prowlarr", "PROWLARR_URL");
  add("SABnzbd", "SABNZBD_URL");
  add("Overseerr", "OVERSEERR_URL");
  add("Plex", "PLEX_URL");
  add("Tautulli", "TAUTULLI_URL");
  add("Bazarr", "BAZARR_URL");
  add("Lidarr", "LIDARR_URL");
  add("Readarr", "READARR_URL");
  add("AdGuard", "ADGUARD_URL");
  add("Prometheus", "PROMETHEUS_URL");
  add("Grafana", "GRAFANA_URL");
  add("Uptime Kuma", "UPTIME_KUMA_URL");
  add("PBS", "PBS_URL", 3000);

  if (probes.length === 0) {
    return "No services configured. Set service URLs in .env to enable health checks.";
  }

  const results: HealthCheck[] = await Promise.all(probes);

  const reachable = results.filter((r) => r.reachable);
  const unreachable = results.filter((r) => !r.reachable);

  const lines: string[] = [
    `Health check — ${reachable.length}/${results.length} services reachable\n`,
  ];

  if (reachable.length) {
    lines.push("✓ Reachable:");
    for (const r of reachable) {
      lines.push(`  ${r.service}: ${r.latencyMs}ms`);
    }
  }

  if (unreachable.length) {
    lines.push(`\n✗ Unreachable (${unreachable.length}):`);
    for (const r of unreachable) {
      const reason = r.error ? ` (${r.error.slice(0, 80)})` : "";
      lines.push(`  ${r.service}: ${r.url}${reason}`);
    }
  }

  return lines.join("\n");
}
