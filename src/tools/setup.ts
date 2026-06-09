import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { homelabHealth } from "./health.js";
import { SECRET_KEY_PATTERNS } from "../utils.js";

// ─── Security: secret detection ────────────────────────────────────────────────

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((p) => key.includes(p));
}

// ─── Env var metadata ──────────────────────────────────────────────────────────

interface EnvVarMeta {
  key: string;
  section: string;
  description: string;
  defaultValue: string;
  required: boolean;
  /** Short hint shown to the user during setup */
  hint?: string;
}

/**
 * Master list of all known env vars with metadata.
 * Source of truth — kept in sync with .env.example and README config tables.
 *
 * required = true means the server may refuse to start without it.
 */
const ENV_META: EnvVarMeta[] = [
  // ── Proxmox (required) ─────────────────────────────────────────────────────
  { key: "PROXMOX_HOST", section: "Proxmox VE", description: "Proxmox host IP/hostname", defaultValue: "", required: true, hint: "e.g. 192.168.1.10" },
  { key: "PROXMOX_PORT", section: "Proxmox VE", description: "Proxmox API port", defaultValue: "8006", required: true },
  { key: "PROXMOX_USER", section: "Proxmox VE", description: "Proxmox API user", defaultValue: "root@pam", required: true },
  { key: "PROXMOX_PASSWORD", section: "Proxmox VE", description: "Proxmox password (or use PROXMOX_KEY_PATH)", defaultValue: "", required: false, hint: "leave empty if using SSH key" },
  { key: "PROXMOX_KEY_PATH", section: "Proxmox VE", description: "SSH private key path for Proxmox", defaultValue: "", required: false, hint: "e.g. ~/.ssh/id_rsa" },
  { key: "PROXMOX_NODE", section: "Proxmox VE", description: "Proxmox node name", defaultValue: "homelab", required: true },
  { key: "PROXMOX_GATEWAY", section: "Proxmox VE", description: "Network gateway", defaultValue: "", required: false },
  { key: "PROXMOX_CT_TEMPLATE", section: "Proxmox VE", description: "LXC container template", defaultValue: "", required: false },
  { key: "PROXMOX_CT_STORAGE", section: "Proxmox VE", description: "LXC storage pool", defaultValue: "local-lvm", required: false },
  { key: "PROXMOX_CT_BRIDGE", section: "Proxmox VE", description: "LXC network bridge", defaultValue: "vmbr0", required: false },

  // ── Devbox (required) ──────────────────────────────────────────────────────
  { key: "DEVBOX_HOST", section: "Devbox (Docker host)", description: "Devbox IP/hostname", defaultValue: "", required: true, hint: "e.g. 192.168.1.14" },
  { key: "DEVBOX_PORT", section: "Devbox (Docker host)", description: "SSH port", defaultValue: "22", required: true },
  { key: "DEVBOX_USER", section: "Devbox (Docker host)", description: "SSH user", defaultValue: "root", required: true },
  { key: "DEVBOX_PASSWORD", section: "Devbox (Docker host)", description: "SSH password (or use DEVBOX_KEY_PATH)", defaultValue: "", required: false, hint: "leave empty if using SSH key" },
  { key: "DEVBOX_KEY_PATH", section: "Devbox (Docker host)", description: "SSH private key path", defaultValue: "", required: false, hint: "e.g. ~/.ssh/id_rsa" },
  { key: "DEVBOX_PROJECTS_DIR", section: "Devbox (Docker host)", description: "Base path for docker-compose projects", defaultValue: "/opt/projects", required: false },

  // ── QNAP NAS (optional) ────────────────────────────────────────────────────
  { key: "QNAP_HOST", section: "QNAP NAS", description: "QNAP IP/hostname", defaultValue: "", required: false, hint: "e.g. 192.168.1.20" },
  { key: "QNAP_PORT", section: "QNAP NAS", description: "SSH port", defaultValue: "22", required: false },
  { key: "QNAP_USER", section: "QNAP NAS", description: "SSH user", defaultValue: "admin", required: false },
  { key: "QNAP_PASSWORD", section: "QNAP NAS", description: "SSH password", defaultValue: "", required: false },

  // ── Media: Radarr (required) ───────────────────────────────────────────────
  { key: "RADARR_URL", section: "Radarr", description: "Radarr URL", defaultValue: "", required: true, hint: "e.g. http://192.168.1.14:7878" },
  { key: "RADARR_API_KEY", section: "Radarr", description: "Radarr API key", defaultValue: "", required: true },
  { key: "RADARR_ROOT_FOLDER", section: "Radarr", description: "Movie root folder", defaultValue: "/nas/movies", required: false },

  // ── Media: Sonarr (required) ───────────────────────────────────────────────
  { key: "SONARR_URL", section: "Sonarr", description: "Sonarr URL", defaultValue: "", required: true, hint: "e.g. http://192.168.1.14:8989" },
  { key: "SONARR_API_KEY", section: "Sonarr", description: "Sonarr API key", defaultValue: "", required: true },
  { key: "SONARR_ROOT_FOLDER", section: "Sonarr", description: "TV series root folder", defaultValue: "/nas/series", required: false },

  // ── Media: Prowlarr (required) ─────────────────────────────────────────────
  { key: "PROWLARR_URL", section: "Prowlarr", description: "Prowlarr URL", defaultValue: "", required: true, hint: "e.g. http://192.168.1.14:9696" },
  { key: "PROWLARR_API_KEY", section: "Prowlarr", description: "Prowlarr API key", defaultValue: "", required: true },

  // ── Media: SABnzbd (required) ──────────────────────────────────────────────
  { key: "SABNZBD_URL", section: "SABnzbd", description: "SABnzbd URL", defaultValue: "", required: true, hint: "e.g. http://192.168.1.14:8085" },
  { key: "SABNZBD_API_KEY", section: "SABnzbd", description: "SABnzbd API key", defaultValue: "", required: true },

  // ── Media: Overseerr (required) ────────────────────────────────────────────
  { key: "OVERSEERR_URL", section: "Overseerr", description: "Overseerr URL", defaultValue: "", required: true, hint: "e.g. http://192.168.1.14:5055" },
  { key: "OVERSEERR_API_KEY", section: "Overseerr", description: "Overseerr API key", defaultValue: "", required: true },

  // ── Media: Plex (optional) ─────────────────────────────────────────────────
  { key: "PLEX_URL", section: "Plex", description: "Plex URL", defaultValue: "", required: false, hint: "e.g. http://192.168.1.14:32400" },
  { key: "PLEX_TOKEN", section: "Plex", description: "Plex token", defaultValue: "", required: false },

  // ── Media: Tautulli (optional) ─────────────────────────────────────────────
  { key: "TAUTULLI_URL", section: "Tautulli", description: "Tautulli URL", defaultValue: "", required: false, hint: "e.g. http://192.168.1.14:8181" },
  { key: "TAUTULLI_API_KEY", section: "Tautulli", description: "Tautulli API key", defaultValue: "", required: false },

  // ── Media: Bazarr (optional) ───────────────────────────────────────────────
  { key: "BAZARR_URL", section: "Bazarr", description: "Bazarr URL", defaultValue: "", required: false, hint: "e.g. http://192.168.1.14:6767" },
  { key: "BAZARR_API_KEY", section: "Bazarr", description: "Bazarr API key", defaultValue: "", required: false },

  // ── Media: Lidarr (optional) ───────────────────────────────────────────────
  { key: "LIDARR_URL", section: "Lidarr", description: "Lidarr URL", defaultValue: "", required: false, hint: "e.g. http://192.168.1.14:8686" },
  { key: "LIDARR_API_KEY", section: "Lidarr", description: "Lidarr API key", defaultValue: "", required: false },
  { key: "LIDARR_ROOT_FOLDER", section: "Lidarr", description: "Music root folder", defaultValue: "/nas/music", required: false },

  // ── Media: Readarr (optional) ──────────────────────────────────────────────
  { key: "READARR_URL", section: "Readarr", description: "Readarr URL", defaultValue: "", required: false, hint: "e.g. http://192.168.1.14:8787" },
  { key: "READARR_API_KEY", section: "Readarr", description: "Readarr API key", defaultValue: "", required: false },
  { key: "READARR_ROOT_FOLDER", section: "Readarr", description: "Books root folder", defaultValue: "/nas/books", required: false },

  // ── Monitoring (optional) ──────────────────────────────────────────────────
  { key: "PROMETHEUS_URL", section: "Prometheus", description: "Prometheus URL", defaultValue: "", required: false, hint: "e.g. http://192.168.1.14:9090" },
  { key: "GRAFANA_URL", section: "Grafana", description: "Grafana URL", defaultValue: "", required: false, hint: "e.g. http://192.168.1.14:3000" },
  { key: "GRAFANA_TOKEN", section: "Grafana", description: "Grafana service account token", defaultValue: "", required: false },

  // ── Uptime Kuma (optional) ─────────────────────────────────────────────────
  { key: "UPTIME_KUMA_URL", section: "Uptime Kuma", description: "Uptime Kuma URL", defaultValue: "", required: false, hint: "e.g. http://192.168.1.14:3001" },
  { key: "UPTIME_KUMA_USER", section: "Uptime Kuma", description: "Uptime Kuma username", defaultValue: "admin", required: false },
  { key: "UPTIME_KUMA_PASSWORD", section: "Uptime Kuma", description: "Uptime Kuma password", defaultValue: "", required: false },

  // ── AdGuard Home (optional) ────────────────────────────────────────────────
  { key: "ADGUARD_URL", section: "AdGuard Home", description: "AdGuard URL", defaultValue: "", required: false, hint: "e.g. http://192.168.1.14:3000" },
  { key: "ADGUARD_USER", section: "AdGuard Home", description: "AdGuard username", defaultValue: "admin", required: false },
  { key: "ADGUARD_PASSWORD", section: "AdGuard Home", description: "AdGuard password", defaultValue: "", required: false },

  // ── Proxmox Backup Server (optional) ───────────────────────────────────────
  { key: "PBS_URL", section: "Proxmox Backup Server", description: "PBS URL", defaultValue: "", required: false, hint: "e.g. https://192.168.1.11:8007" },
  { key: "PBS_TOKEN_ID", section: "Proxmox Backup Server", description: "PBS API token ID", defaultValue: "", required: false, hint: "e.g. root@pam!mcp" },
  { key: "PBS_TOKEN_SECRET", section: "Proxmox Backup Server", description: "PBS API token secret", defaultValue: "", required: false },

  // ── Notifications (optional) ───────────────────────────────────────────────
  { key: "TELEGRAM_BOT_TOKEN", section: "Telegram", description: "Telegram bot token", defaultValue: "", required: false },
  { key: "TELEGRAM_CHAT_ID", section: "Telegram", description: "Telegram chat ID", defaultValue: "", required: false },

  // ── Misc (optional) ────────────────────────────────────────────────────────
  { key: "MEDIA_LXC_ID", section: "Media stack", description: "LXC container ID for media", defaultValue: "", required: false },
  { key: "DASHBOARD_DISK_PATHS", section: "Media stack", description: "Disk paths for dashboard", defaultValue: "", required: false },
];

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const SetupUpdateSchema = z.object({
  key: z.string().describe("Environment variable name (e.g. PROXMOX_HOST)"),
  value: z.string().describe("Value to set"),
});

export const SetupSchema = z.object({
  action: z.enum(["status", "configure", "test"]).describe(
    "What to do: 'status' shows what's configured vs missing, 'configure' saves settings, 'test' checks connectivity"
  ),
  updates: z.array(SetupUpdateSchema).optional().describe(
    "Key-value pairs to write to .env (only for action='configure')"
  ),
});

// ─── .env path resolution ─────────────────────────────────────────────────────

function envPath(): string {
  // MCP server runs with cwd set by Claude Code config, or falls back to dist/../
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(__dirname, "..", "..", ".env"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // If no .env exists, return the default location
  return candidates[0];
}

function envExamplePath(): string {
  const candidates = [
    path.resolve(process.cwd(), ".env.example"),
    path.resolve(__dirname, "..", "..", ".env.example"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

// ─── .env reader ──────────────────────────────────────────────────────────────

function readEnv(filepath: string): Map<string, string> {
  const vars = new Map<string, string>();
  if (!fs.existsSync(filepath)) return vars;

  const content = fs.readFileSync(filepath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.substring(0, eq).trim();
    let value = trimmed.substring(eq + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars.set(key, value);
  }
  return vars;
}

// ─── .env writer ──────────────────────────────────────────────────────────────

function writeEnv(filepath: string, updates: Array<{ key: string; value: string }>): void {
  // If .env doesn't exist, copy from .env.example as a starting template
  if (!fs.existsSync(filepath)) {
    const example = envExamplePath();
    if (fs.existsSync(example)) {
      fs.copyFileSync(example, filepath);
    } else {
      fs.writeFileSync(filepath, "", "utf8");
    }
  }

  let content = fs.readFileSync(filepath, "utf8");
  const lines = content.split("\n");

  for (const { key, value } of updates) {
    let found = false;

    // Try to replace an existing line
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const lineKey = trimmed.substring(0, eq).trim();
      if (lineKey === key) {
        // Keep any inline comment
        const commentIdx = trimmed.indexOf("#", eq);
        const comment = commentIdx !== -1 ? " " + trimmed.substring(commentIdx) : "";
        lines[i] = `${key}=${value}${comment}`;
        found = true;
        break;
      }
    }

    // Append at the end if not found
    if (!found) {
      lines.push(`${key}=${value}`);
    }
  }

  fs.writeFileSync(filepath, lines.join("\n"), "utf8");
}

// ─── Status reporter ──────────────────────────────────────────────────────────

interface SetupStatus {
  section: string;
  vars: Array<{
    key: string;
    description: string;
    configured: boolean;
    currentValue: string;
    hint?: string;
  }>;
}

function buildStatus(): { sections: SetupStatus[]; allDone: boolean; totalRequired: number; configuredRequired: number } {
  const current = readEnv(envPath());
  const sections = new Map<string, SetupStatus>();

  let totalRequired = 0;
  let configuredRequired = 0;

  for (const meta of ENV_META) {
    if (!sections.has(meta.section)) {
      sections.set(meta.section, { section: meta.section, vars: [] });
    }

    const currentValue = current.get(meta.key) ?? "";
    const configured = currentValue !== "" && currentValue !== meta.defaultValue;

    if (meta.required) {
      totalRequired++;
      if (configured) configuredRequired++;
    }

    sections.get(meta.section)!.vars.push({
      key: meta.key,
      description: meta.description,
      configured,
      currentValue: configured
        ? (isSecretKey(meta.key) ? "••••••••" : currentValue)
        : "",
      hint: meta.hint,
    });
  }

  return {
    sections: [...sections.values()],
    allDone: configuredRequired === totalRequired,
    totalRequired,
    configuredRequired,
  };
}

function formatStatus(s: ReturnType<typeof buildStatus>): string {
  const lines: string[] = [];

  // Header
  const pct = s.totalRequired > 0 ? Math.round((s.configuredRequired / s.totalRequired) * 100) : 0;
  const envExists = fs.existsSync(envPath());

  lines.push(`# Homelab Setup — ${s.configuredRequired}/${s.totalRequired} required vars configured (${pct}%)\n`);

  if (!envExists) {
    lines.push("> No `.env` file found yet. It will be created on first `configure` call.\n");
  }

  if (s.allDone) {
    lines.push("> All required services are configured. Run `homelab_setup` with `action: \"test\"` to verify connectivity.\n");
  }

  // Configured first
  const configuredVars = s.sections.flatMap(sec => sec.vars.filter(v => v.configured));
  if (configuredVars.length > 0) {
    lines.push("## Already configured");
    for (const v of configuredVars) {
      lines.push(`  ✓ ${v.key} → ${v.currentValue || "(set)"}`);
    }
    lines.push("");
  }

  // Missing required
  const missingRequired = s.sections.flatMap(sec =>
    sec.vars.filter(v => !v.configured).map(v => ({ ...v, section: sec.section }))
  ).filter(v => ENV_META.find(m => m.key === v.key)?.required);

  if (missingRequired.length > 0) {
    lines.push(`## Missing — Required (${missingRequired.length} vars)`);
    lines.push("These must be set before the server will start.\n");

    const bySection = new Map<string, typeof missingRequired>();
    for (const v of missingRequired) {
      if (!bySection.has(v.section)) bySection.set(v.section, []);
      bySection.get(v.section)!.push(v);
    }

    for (const [section, vars] of bySection) {
      lines.push(`### ${section}`);
      for (const v of vars) {
        const hint = v.hint ? ` (${v.hint})` : "";
        lines.push(`  ✗ ${v.key} — ${v.description}${hint}`);
      }
      lines.push("");
    }
  }

  // Missing optional
  const missingOptional = s.sections.flatMap(sec =>
    sec.vars.filter(v => !v.configured).map(v => ({ ...v, section: sec.section }))
  ).filter(v => !ENV_META.find(m => m.key === v.key)?.required);

  if (missingOptional.length > 0 && s.allDone) {
    // Only show optional in detail when required are done; otherwise just count
    lines.push(`## Optional (${missingOptional.length} vars)`);
    lines.push("These add extra services. Skip any you don't use.\n");

    const bySection = new Map<string, typeof missingOptional>();
    for (const v of missingOptional) {
      if (!bySection.has(v.section)) bySection.set(v.section, []);
      bySection.get(v.section)!.push(v);
    }

    for (const [section, vars] of bySection) {
      lines.push(`### ${section}`);
      for (const v of vars) {
        const hint = v.hint ? ` (${v.hint})` : "";
        lines.push(`  ○ ${v.key} — ${v.description}${hint}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function homelabSetup(
  input: z.infer<typeof SetupSchema>
): Promise<string> {
  switch (input.action) {
    case "status": {
      const status = buildStatus();
      return formatStatus(status);
    }

    case "configure": {
      if (!input.updates || input.updates.length === 0) {
        return "No updates provided. Pass an `updates` array with {key, value} pairs.";
      }

      // Validate keys against known vars
      const knownKeys = new Set(ENV_META.map(m => m.key));
      const unknown = input.updates.filter(u => !knownKeys.has(u.key));
      if (unknown.length > 0) {
        return `Unknown env vars: ${unknown.map(u => u.key).join(", ")}. Check the key names against .env.example.`;
      }

      const filepath = envPath();
      writeEnv(filepath, input.updates);

      // Return updated status
      const status = buildStatus();
      const lines: string[] = [
        `Saved ${input.updates.length} setting(s):\n`,
        ...input.updates.map(u => {
          const display = isSecretKey(u.key) ? "••••••••" : u.value;
          return `  ✓ ${u.key}=${display}`;
        }),
        "",
      ];

      // If all required are now done, prompt to test
      if (status.allDone) {
        lines.push("> All required services are now configured! Run `homelab_setup` with `action: \"test\"` to verify connectivity.\n");
      } else {
        lines.push(`Progress: ${status.configuredRequired}/${status.totalRequired} required vars configured.\n`);
        lines.push("Continue asking the user for the remaining missing values shown above.\n");
      }

      lines.push(formatStatus(status));
      return lines.join("\n");
    }

    case "test": {
      const status = buildStatus();
      if (status.configuredRequired === 0) {
        return "No services configured yet. Run `homelab_setup` with `action: \"status\"` to see what's missing.";
      }

      // Reuse existing health check
      const healthResult = await homelabHealth();
      return `# Connection Test\n\n${healthResult}`;
    }

    default:
      return "Invalid action. Use 'status', 'configure', or 'test'.";
  }
}
