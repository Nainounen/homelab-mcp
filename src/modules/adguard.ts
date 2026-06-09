import { ToolModule } from "../types.js";
import { AdGuardClient } from "../adguard.js";
import * as impl from "../tools/adguard.js";

export function adguardModule(client: AdGuardClient): ToolModule {
  return {
    domain: "AdGuard",
    tools: [
      {
        name: "adguard_stats",
        description: "Show AdGuard Home DNS query stats: total queries, blocked count, block rate, top queried and blocked domains.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "adguard_check_host",
        description: "Check if a domain is blocked by AdGuard Home and which rule matches.",
        inputSchema: {
          type: "object",
          properties: { host: { type: "string", description: "Hostname or domain to check (e.g. ads.example.com)" } },
          required: ["host"],
        },
      },
      {
        name: "adguard_toggle_protection",
        description: "Enable or disable AdGuard Home DNS filtering protection.",
        inputSchema: {
          type: "object",
          properties: { enable: { type: "boolean", description: "true to enable, false to disable" } },
          required: ["enable"],
        },
      },
    ],

    async handle(name, args) {
      switch (name) {
        case "adguard_stats":             return impl.adguardGetStats(client);
        case "adguard_check_host":        return impl.adguardCheckHost(client, impl.AdGuardCheckHostSchema.parse(args));
        case "adguard_toggle_protection": return impl.adguardToggleProtection(client, impl.AdGuardToggleSchema.parse(args));
        default: return null;
      }
    },
  };
}
