/**
 * Module registry — the only file to edit when adding a new integration.
 *
 * To add a new service:
 *   1. Create src/tools/{service}.ts      — schemas + implementations
 *   2. Create src/modules/{service}.ts    — tool definitions + handler (run: npm run new-module <Name>)
 *   3. Create src/{service}.ts            — API/SSH client factory
 *   4. Import the client + module below and add one line to buildModules()
 */
import { ToolModule } from "../types.js";

import { ProxmoxClient } from "../proxmox.js";
import { ProxmoxSSH, DevboxSSH } from "../ssh.js";
import { ArrClient } from "../arr.js";
import { SabnzbdClient } from "../sabnzbd.js";
import { OverseerrClient } from "../overseerr.js";
import { QnapSSH } from "../qnap.js";
import { PrometheusClient } from "../prometheus.js";
import { GrafanaClient } from "../grafana.js";
import { ProwlarrClient } from "../prowlarr.js";
import { UptimeKumaClient } from "../uptime-kuma.js";
import { TautulliClient } from "../tautulli.js";
import { BazarrClient } from "../bazarr.js";
import { AdGuardClient } from "../adguard.js";
import { PbsClient } from "../pbs.js";

import { proxmoxModule } from "./proxmox.js";
import { devboxModule } from "./devbox.js";
import { radarrModule } from "./radarr.js";
import { sonarrModule } from "./sonarr.js";
import { plexModule } from "./plex.js";
import { mediaModule } from "./media.js";
import { prowlarrModule } from "./prowlarr.js";
import { sabnzbdModule } from "./sabnzbd.js";
import { serrModule } from "./seerr.js";
import { qnapModule } from "./qnap.js";
import { prometheusModule } from "./prometheus.js";
import { grafanaModule } from "./grafana.js";
import { uptimeModule } from "./uptime.js";
import { tautulliModule } from "./tautulli.js";
import { bazarrModule } from "./bazarr.js";
import { adguardModule } from "./adguard.js";
import { pbsModule } from "./pbs.js";
import { lidarrModule } from "./lidarr.js";
import { readarrModule } from "./readarr.js";
import { networkModule } from "./network.js";
import { watchtowerModule } from "./watchtower.js";
import { notifyModule } from "./notify.js";
import { metaModule } from "./meta.js";
import { healthModule } from "./health.js";

/** Required clients — server won't start without these. */
export interface RequiredClients {
  proxmox:    ProxmoxClient;
  pveSSH:     ProxmoxSSH;
  devbox:     DevboxSSH;
  radarr:     ArrClient;
  sonarr:     ArrClient;
  prowlarr:   ProwlarrClient;
  sabnzbd:    SabnzbdClient;
  overseerr:  OverseerrClient;
  prometheus: PrometheusClient;
  grafana:    GrafanaClient;
  getQnap:    () => QnapSSH;
}

/** Optional clients — missing ones are skipped with a warning at startup. */
export interface OptionalClients {
  uptime?:   UptimeKumaClient;
  tautulli?: TautulliClient;
  bazarr?:   BazarrClient;
  adguard?:  AdGuardClient;
  pbs?:      PbsClient;
  lidarr?:   ArrClient;
  readarr?:  ArrClient;
}

export type HomelabClients = RequiredClients & OptionalClients;

export function buildModules(c: HomelabClients): ToolModule[] {
  const modules: ToolModule[] = [
    // ── Always-on ─────────────────────────────────────────────────────────────
    proxmoxModule(c.proxmox, c.pveSSH),
    devboxModule(c.devbox),
    networkModule(c.devbox),
    watchtowerModule(c.devbox),
    radarrModule(c.radarr),
    sonarrModule(c.sonarr),
    plexModule(),
    mediaModule(c.devbox, c.pveSSH, c.proxmox, c.radarr, c.sonarr, c.sabnzbd),
    prowlarrModule(c.prowlarr),
    sabnzbdModule(c.sabnzbd),
    serrModule(c.overseerr),
    qnapModule(c.getQnap),
    prometheusModule(c.prometheus),
    grafanaModule(c.grafana),
    notifyModule(),
  ];

  // ── Optional — only added when the client was created successfully ──────────
  if (c.uptime)   modules.push(uptimeModule(c.uptime));
  if (c.tautulli) modules.push(tautulliModule(c.tautulli));
  if (c.bazarr)   modules.push(bazarrModule(c.bazarr));
  if (c.adguard)  modules.push(adguardModule(c.adguard));
  if (c.pbs)      modules.push(pbsModule(c.pbs));
  if (c.lidarr)   modules.push(lidarrModule(c.lidarr));
  if (c.readarr)  modules.push(readarrModule(c.readarr));
  // ── Add new modules above this line ─────────────────────────────────────────

  // Health check runs last so it can report on all other services
  modules.push(healthModule());

  modules.push(metaModule(() => modules));
  return modules;
}

export function validateModules(modules: ToolModule[]): void {
  const seen = new Map<string, string>();

  for (const mod of modules) {
    if (!mod.domain) throw new Error(`Module missing domain field`);

    for (const tool of mod.tools) {
      if (!tool.name) throw new Error(`Tool in module "${mod.domain}" has an empty name`);
      if (!tool.description) throw new Error(`Tool "${tool.name}" in module "${mod.domain}" has no description`);

      const existing = seen.get(tool.name);
      if (existing) {
        throw new Error(`Duplicate tool name "${tool.name}" found in both "${existing}" and "${mod.domain}"`);
      }
      seen.set(tool.name, mod.domain);
    }
  }
}
