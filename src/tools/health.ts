import axios from "axios";

interface HealthCheck {
  service: string;
  url: string;
  reachable: boolean;
  latencyMs: number;
  error?: string;
}

/**
 * Run a quick health check against all configured services.
 * Returns reachable/unreachable status and latency for each.
 */
export async function homelabHealth(): Promise<string> {
  const checks: Array<{ service: string; url: string; timeout: number }> = [];

  const add = (service: string, envKey: string, timeout = 5_000) => {
    const url = process.env[envKey];
    if (url) checks.push({ service, url, timeout });
  };

  add("Proxmox", "PROXMOX_HOST", 3000);
  add("Devbox", "DEVBOX_HOST", 3000);
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
  add("QNAP", "QNAP_HOST", 3000);

  if (checks.length === 0) {
    return "No services configured. Set service URLs in .env to enable health checks.";
  }

  const results: HealthCheck[] = await Promise.all(
    checks.map(async ({ service, url, timeout }) => {
      const start = Date.now();
      try {
        await axios.get(url, { timeout });
        return { service, url, reachable: true, latencyMs: Date.now() - start };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { service, url, reachable: false, latencyMs: Date.now() - start, error: msg };
      }
    })
  );

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
