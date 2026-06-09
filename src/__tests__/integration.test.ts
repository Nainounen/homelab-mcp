/**
 * Integration tests for the homelab-mcp module registry and tool dispatch.
 *
 * Verifies that the registry builds correctly, tools are discoverable,
 * the dispatch map works, and representative tools handle calls with mocked clients.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock external dependencies (hoisted by vitest before all imports) ──────

const mockSshExec = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

vi.mock("../ssh.js", () => ({
  DevboxSSH: vi.fn(() => ({ exec: mockSshExec, writeFile: vi.fn() })),
  ProxmoxSSH: vi.fn(() => ({ exec: mockSshExec })),
  getDevbox: vi.fn(() => ({ exec: mockSshExec, writeFile: vi.fn() })),
  getProxmoxSSH: vi.fn(() => ({ exec: mockSshExec })),
  BLOCKED_PATTERNS: [/rm\s+-rf\s+\//],
  PVE_BLOCKED_PATTERNS: [/rm\s+-rf\s+\//],
}));

vi.mock("../proxmox.js", () => ({
  ProxmoxClient: vi.fn(() => ({
    node: "homelab", get: vi.fn().mockResolvedValue([]), post: vi.fn().mockResolvedValue({}),
  })),
  createProxmoxClient: vi.fn(() => ({
    node: "homelab", get: vi.fn().mockResolvedValue([]), post: vi.fn().mockResolvedValue({}),
  })),
}));

const arrMock = {
  get: vi.fn().mockResolvedValue([]),
  post: vi.fn().mockResolvedValue({}),
  delete: vi.fn().mockResolvedValue(undefined),
  deleteWithBody: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../arr.js", () => ({
  ArrClient: vi.fn(() => arrMock),
  createArrV1Client: vi.fn(() => arrMock),
  createRadarrClient: vi.fn(() => arrMock),
  createSonarrClient: vi.fn(() => arrMock),
}));

vi.mock("../prowlarr.js", () => ({
  ProwlarrClient: vi.fn(),
  createProwlarrClient: vi.fn(() => ({
    get: vi.fn().mockResolvedValue([]), post: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock("../sabnzbd.js", () => ({
  SabnzbdClient: vi.fn(),
  createSabnzbdClient: vi.fn(() => ({
    api: vi.fn().mockResolvedValue({ queue: { status: "idle" } }),
  })),
}));

vi.mock("../overseerr.js", () => ({
  OverseerrClient: vi.fn(),
  createOverseerrClient: vi.fn(() => ({
    get: vi.fn().mockResolvedValue([]), post: vi.fn().mockResolvedValue({}), delete: vi.fn(),
  })),
}));

vi.mock("../qnap.js", () => ({
  QnapSSH: vi.fn(),
  getQnap: vi.fn(() => ({ exec: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }) })),
}));

vi.mock("../prometheus.js", () => ({
  PrometheusClient: vi.fn(),
  createPrometheusClient: vi.fn(() => ({
    query: vi.fn().mockResolvedValue([]), queryRange: vi.fn().mockResolvedValue([]), targets: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock("../grafana.js", () => ({
  GrafanaClient: vi.fn(),
  createGrafanaClient: vi.fn(() => ({
    searchDashboards: vi.fn().mockResolvedValue([]),
    queryPanelData: vi.fn().mockResolvedValue({}),
    getDashboard: vi.fn().mockResolvedValue({ title: "Test", panels: [] }),
  })),
}));

// ─── Imports of real modules (use mocked factories) ─────────────────────────

import { buildModules, validateModules, HomelabClients } from "../modules/registry.js";
import { ToolModule } from "../types.js";
import { createProxmoxClient } from "../proxmox.js";
import { getDevbox, getProxmoxSSH } from "../ssh.js";
import { createRadarrClient, createSonarrClient } from "../arr.js";
import { createProwlarrClient } from "../prowlarr.js";
import { createSabnzbdClient } from "../sabnzbd.js";
import { createOverseerrClient } from "../overseerr.js";
import { getQnap } from "../qnap.js";
import { createPrometheusClient } from "../prometheus.js";
import { createGrafanaClient } from "../grafana.js";

// ─── Build mock clients ────────────────────────────────────────────────────

function buildClients(): HomelabClients {
  return {
    proxmox: createProxmoxClient(),
    pveSSH: getProxmoxSSH(),
    devbox: getDevbox(),
    radarr: createRadarrClient(),
    sonarr: createSonarrClient(),
    prowlarr: createProwlarrClient(),
    sabnzbd: createSabnzbdClient(),
    overseerr: createOverseerrClient(),
    prometheus: createPrometheusClient(),
    grafana: createGrafanaClient(),
    getQnap,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Module registry integration", () => {
  let clients: HomelabClients;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSshExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    clients = buildClients();
  });

  it("builds modules without throwing", () => {
    const modules = buildModules(clients);
    expect(modules.length).toBeGreaterThan(10);
  });

  it("validates modules with no duplicates", () => {
    const modules = buildModules(clients);
    expect(() => validateModules(modules)).not.toThrow();
  });

  it("every module has a non-empty domain", () => {
    const modules = buildModules(clients);
    for (const mod of modules) {
      expect(mod.domain).toBeTruthy();
    }
  });

  it("every tool has a name and description", () => {
    const modules = buildModules(clients);
    const allTools = modules.flatMap((m) => m.tools);
    expect(allTools.length).toBeGreaterThan(30);

    for (const tool of allTools) {
      expect(tool.name).toBeTruthy();
      expect(tool.name).toMatch(/^[a-z_]+$/);
      expect(tool.description).toBeTruthy();
    }
  });

  it("has the always-on modules registered", () => {
    const modules = buildModules(clients);
    const domains = modules.map((m) => m.domain);

    expect(domains).toContain("Proxmox");
    expect(domains).toContain("Devbox");
    expect(domains).toContain("Radarr");
    expect(domains).toContain("Sonarr");
    expect(domains).toContain("Prowlarr");
    expect(domains).toContain("SABnzbd");
    expect(domains).toContain("Seerr");
    expect(domains).toContain("Meta");
    expect(domains).toContain("Health");
    expect(domains).toContain("Setup");
  });

  it("has no duplicate tool names", () => {
    const modules = buildModules(clients);
    const names = modules.flatMap((m) => m.tools.map((t) => t.name));
    const unique = new Set(names);
    expect(names.length).toBe(unique.size);
  });
});

describe("Tool dispatch", () => {
  let modules: ToolModule[];
  let toolMap: Map<string, (args: Record<string, unknown>) => Promise<string | null>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSshExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const clients = buildClients();
    modules = buildModules(clients);

    toolMap = new Map();
    for (const mod of modules) {
      for (const tool of mod.tools) {
        toolMap.set(tool.name, (args) => mod.handle(tool.name, args));
      }
    }
  });

  it("homelab_capabilities returns domain listing", async () => {
    const handler = toolMap.get("homelab_capabilities");
    expect(handler).toBeDefined();
    const result = await handler!({});
    expect(result).toContain("Homelab MCP");
    expect(result).toContain("Proxmox");
    expect(result).toContain("Radarr");
    expect(result).toContain("tools");
  });

  it("proxmox_list_nodes returns formatted output", async () => {
    const handler = toolMap.get("proxmox_list_nodes");
    expect(handler).toBeDefined();
    const result = await handler!({});
    expect(typeof result).toBe("string");
  });

  it("devbox_docker_ps delegates to SSH and returns container list", async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: "plex    Up 2 days",
      stderr: "",
      exitCode: 0,
    });

    const handler = toolMap.get("devbox_docker_ps");
    expect(handler).toBeDefined();
    const result = await handler!({});
    expect(result).toContain("plex");
  });

  it("module handle returns null for unknown tool names", async () => {
    const proxmoxMod = modules.find((m) => m.domain === "Proxmox")!;
    const result = await proxmoxMod.handle("nonexistent_tool", {});
    expect(result).toBeNull();
  });

  it("radarr_search_movie returns result string", async () => {
    const handler = toolMap.get("radarr_search_movie");
    expect(handler).toBeDefined();
    const result = await handler!({ title: "Inception" });
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });
});
