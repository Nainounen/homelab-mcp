#!/usr/bin/env node
/**
 * Scaffold a new homelab MCP integration.
 *
 * Usage:
 *   npm run new-module -- tautulli
 *   npm run new-module -- adguard
 *   npm run new-module -- "home-assistant"
 *
 * Creates:
 *   src/{slug}.ts           — HTTP/SSH client factory
 *   src/tools/{slug}.ts     — Zod schemas + tool implementations
 *   src/modules/{slug}.ts   — Tool definitions + handler
 *
 * Then prints the three manual steps left for you to do.
 */

const fs   = require("fs");
const path = require("path");

const rawName = process.argv[2];
if (!rawName) {
  console.error("Usage: npm run new-module -- <name>  (e.g. tautulli, adguard, home-assistant)");
  process.exit(1);
}

// Normalise: everything lowercase with hyphens as separator
const slug    = rawName.toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "");
// PascalCase class name: HomeAssistant, Tautulli, AdGuard
const pascal  = slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
// camelCase factory function prefix: homeAssistant, tautulli
const camel   = pascal.charAt(0).toLowerCase() + pascal.slice(1);
// SCREAMING_SNAKE for env vars: HOME_ASSISTANT, TAUTULLI
const envBase = slug.toUpperCase().replace(/-/g, "_");
// tool name prefix — same as slug but underscores: home_assistant_status
const toolPrefix = slug.replace(/-/g, "_");

const srcDir = path.join(__dirname, "..", "src");

// ─── Client ───────────────────────────────────────────────────────────────────

const clientContent = `import axios, { AxiosInstance } from "axios";

export class ${pascal}Client {
  private http: AxiosInstance;

  constructor(baseUrl: string, apiKey: string) {
    this.http = axios.create({
      baseURL: baseUrl,
      headers: { "X-Api-Key": apiKey },
      timeout: 15_000,
    });
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const r = await this.http.get<T>(path, { params });
    return r.data;
  }

  async post<T>(path: string, data?: unknown): Promise<T> {
    const r = await this.http.post<T>(path, data);
    return r.data;
  }
}

export function create${pascal}Client(): ${pascal}Client {
  const url = process.env.${envBase}_URL;
  const key = process.env.${envBase}_API_KEY;
  if (!url || !key) throw new Error("Missing ${envBase}_URL or ${envBase}_API_KEY in .env");
  return new ${pascal}Client(url, key);
}
`;

// ─── Tools ────────────────────────────────────────────────────────────────────

const toolsContent = `import { z } from "zod";
import { ${pascal}Client } from "../${slug}.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const ${pascal}StatusSchema = z.object({});

// ─── Implementations ──────────────────────────────────────────────────────────

export async function ${camel}GetStatus(client: ${pascal}Client): Promise<string> {
  // TODO: implement — replace with real API calls
  const data = await client.get<unknown>("/");
  return JSON.stringify(data, null, 2);
}
`;

// ─── Module ───────────────────────────────────────────────────────────────────

const moduleContent = `import { ToolModule } from "../types.js";
import { ${pascal}Client } from "../${slug}.js";
import * as impl from "../tools/${slug}.js";

export function ${camel}Module(client: ${pascal}Client): ToolModule {
  return {
    domain: "${pascal}",
    tools: [
      {
        name: "${toolPrefix}_status",
        description: "TODO: describe what this tool does.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
    ],

    async handle(name, _args) {
      switch (name) {
        case "${toolPrefix}_status": return impl.${camel}GetStatus(client);
        default: return null;
      }
    },
  };
}
`;

// ─── Write files ──────────────────────────────────────────────────────────────

function writeIfMissing(filePath, content) {
  if (fs.existsSync(filePath)) {
    console.warn(`  skip   ${path.relative(process.cwd(), filePath)} (already exists)`);
    return false;
  }
  fs.writeFileSync(filePath, content, "utf8");
  console.log(`  create ${path.relative(process.cwd(), filePath)}`);
  return true;
}

console.log(`\nScaffolding ${pascal} integration...\n`);
writeIfMissing(path.join(srcDir, `${slug}.ts`), clientContent);
writeIfMissing(path.join(srcDir, "tools", `${slug}.ts`), toolsContent);
writeIfMissing(path.join(srcDir, "modules", `${slug}.ts`), moduleContent);

// ─── Validation ────────────────────────────────────────────────────────────

const registryPath = path.join(srcDir, "modules", "registry.ts");
const indexPath    = path.join(srcDir, "index.ts");

const registrySrc = fs.readFileSync(registryPath, "utf8");
const indexSrc    = fs.readFileSync(indexPath, "utf8");

const checks = [];

// Check import of client factory in registry.ts
checks.push({
  label: `import { create${pascal}Client } in registry.ts`,
  ok: registrySrc.includes(`create${pascal}Client`),
  fix: `Add: import { create${pascal}Client } from "../${slug}.js";`,
});

// Check import of module in registry.ts
checks.push({
  label: `import { ${camel}Module } in registry.ts`,
  ok: registrySrc.includes(`${camel}Module`),
  fix: `Add: import { ${camel}Module } from "./${slug}.js";`,
});

// Check client added to HomelabClients interface
checks.push({
  label: `${camel} in HomelabClients interface`,
  ok: registrySrc.includes(`${camel}:`) && registrySrc.includes(`${pascal}Client`),
  fix: `Add to HomelabClients interface: ${camel}: ${pascal}Client;`,
});

// Check module added to buildModules()
checks.push({
  label: `${camel}Module(c.${camel}) in buildModules()`,
  ok: registrySrc.includes(`${camel}Module`),
  fix: `Add to buildModules(): ${camel}Module(c.${camel}),`,
});

// Check client instantiated in index.ts
checks.push({
  label: `${camel}: create${pascal}Client() in index.ts`,
  ok: indexSrc.includes(`create${pascal}Client`),
  fix: `Add to clients object in index.ts: ${camel}: create${pascal}Client(),`,
});

const done = checks.filter((c) => c.ok).length;
const remaining = checks.filter((c) => !c.ok);

console.log(`\nValidation: ${done}/${checks.length} registration steps complete\n`);

if (remaining.length) {
  console.log("Still needed:");
  remaining.forEach((c) => console.log(`  ✗ ${c.label}\n    → ${c.fix}`));
} else {
  console.log("✓ All registration steps complete!");
}

// ─── Next steps ───────────────────────────────────────────────────────────────

console.log(`
Additional manual steps:

1. Add env vars to .env and .env.example:
   ${envBase}_URL=http://192.168.1.14:XXXX
   ${envBase}_API_KEY=yourkey

2. Run: npm run build
`);
