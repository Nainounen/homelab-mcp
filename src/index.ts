import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { createProxmoxClient } from "./proxmox.js";
import { getDevbox, getProxmoxSSH } from "./ssh.js";
import { createRadarrClient, createSonarrClient, createArrV1Client } from "./arr.js";
import { createProwlarrClient } from "./prowlarr.js";
import { createSabnzbdClient } from "./sabnzbd.js";
import { createOverseerrClient } from "./overseerr.js";
import { getQnap } from "./qnap.js";
import { createPrometheusClient } from "./prometheus.js";
import { createGrafanaClient } from "./grafana.js";
import { createUptimeKumaClient } from "./uptime-kuma.js";
import { createTautulliClient } from "./tautulli.js";
import { createBazarrClient } from "./bazarr.js";
import { createAdGuardClient } from "./adguard.js";
import { createPbsClient } from "./pbs.js";
import { buildModules, validateModules, HomelabClients } from "./modules/registry.js";

// ─── Error sanitization ────────────────────────────────────────────────────────

/**
 * Strip internal details (URLs, IPs, file paths, tokens) from error messages
 * before returning them to the MCP client.  Full errors are always logged to stderr.
 */
function sanitizeError(err: unknown): string {
  if (err instanceof Error) {
    // Axios errors contain the full URL (with API keys in query params)
    const msg = err.message
      // Redact apikey query params first (before URL regex eats the whole URL)
      .replace(/apikey=[^\s&]+/gi, "apikey=[redacted]")
      .replace(/https?:\/\/[^\s]+/g, "[redacted-url]")
      .replace(/\/[a-zA-Z0-9_-]{20,}/g, "/[redacted-token]");
    return msg;
  }
  return String(err);
}

// ─── Helper: try to create an optional client, skip with a warning if env vars missing ──

function tryCreate<T>(name: string, factory: () => T): T | undefined {
  try {
    return factory();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[homelab-mcp] skipping ${name}: ${msg}\n`);
    return undefined;
  }
}

// ─── Clients ──────────────────────────────────────────────────────────────────

const clients: HomelabClients = {
  // Required — server fails to start if these throw
  proxmox:    createProxmoxClient(),
  pveSSH:     getProxmoxSSH(),
  devbox:     getDevbox(),
  radarr:     createRadarrClient(),
  sonarr:     createSonarrClient(),
  prowlarr:   createProwlarrClient(),
  sabnzbd:    createSabnzbdClient(),
  overseerr:  createOverseerrClient(),
  prometheus: createPrometheusClient(),
  grafana:    createGrafanaClient(),
  getQnap,

  // Optional — missing env vars just skip the module
  uptime:   tryCreate("Uptime Kuma",  createUptimeKumaClient),
  tautulli: tryCreate("Tautulli",     createTautulliClient),
  bazarr:   tryCreate("Bazarr",       createBazarrClient),
  adguard:  tryCreate("AdGuard",      createAdGuardClient),
  pbs:      tryCreate("PBS",          createPbsClient),
  lidarr:   tryCreate("Lidarr",       () => createArrV1Client(
    process.env.LIDARR_URL  ?? (() => { throw new Error("Missing LIDARR_URL") })(),
    process.env.LIDARR_API_KEY ?? (() => { throw new Error("Missing LIDARR_API_KEY") })(),
  )),
  readarr:  tryCreate("Readarr",      () => createArrV1Client(
    process.env.READARR_URL  ?? (() => { throw new Error("Missing READARR_URL") })(),
    process.env.READARR_API_KEY ?? (() => { throw new Error("Missing READARR_API_KEY") })(),
  )),
};

// ─── Modules ──────────────────────────────────────────────────────────────────

const MODULES = buildModules(clients);
validateModules(MODULES);

// ─── Server ───────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "homelab-mcp", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: MODULES.flatMap((m) => m.tools),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;

  try {
    for (const mod of MODULES) {
      const result = await mod.handle(name, args);
      if (result !== null) return { content: [{ type: "text", text: result }] };
    }
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? `Validation error: ${err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")}`
        : sanitizeError(err);

    // Log the full error to stderr for the operator to debug
    const fullMessage = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[homelab-mcp] error in ${name}: ${fullMessage}\n`);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[homelab-mcp] started — ${MODULES.flatMap((m) => m.tools).length} tools across ${MODULES.length} domains\n`
  );
}

main().catch((err) => {
  process.stderr.write(`[homelab-mcp] fatal: ${err}\n`);
  process.exit(1);
});
