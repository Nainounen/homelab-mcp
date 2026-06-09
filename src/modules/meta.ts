import { ToolModule } from "../types.js";

/**
 * Meta-module: discovery tool that lets an AI inspect the full capability surface
 * without needing to read the source code.
 *
 * homelab_capabilities — lists every domain + tool available, with descriptions.
 */
export function metaModule(getModules: () => ToolModule[]): ToolModule {
  return {
    domain: "Meta",
    tools: [
      {
        name: "homelab_capabilities",
        description:
          "List all available homelab tools grouped by service domain. " +
          "Call this first in any session to discover what you can do. " +
          "Returns each domain (e.g. Proxmox, Radarr, Plex) with its tool names and descriptions.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
    ],

    async handle(name, _args) {
      if (name !== "homelab_capabilities") return null;

      const modules = getModules();
      const lines: string[] = [
        `Homelab MCP — ${modules.flatMap((m) => m.tools).length} tools across ${modules.length} domains\n`,
      ];

      for (const mod of modules) {
        lines.push(`## ${mod.domain} (${mod.tools.length} tools)`);
        for (const tool of mod.tools) {
          lines.push(`  ${tool.name}`);
          lines.push(`    ${tool.description}`);
        }
        lines.push("");
      }

      return lines.join("\n");
    },
  };
}
