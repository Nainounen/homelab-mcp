import { ToolModule } from "../types.js";
import { UptimeKumaClient } from "../uptime-kuma.js";
import * as impl from "../tools/uptime.js";

export function uptimeModule(client: UptimeKumaClient): ToolModule {
  return {
    domain: "Uptime Kuma",
    tools: [
      {
        name: "uptime_status",
        description: "List all Uptime Kuma monitors with their up/down status and latency. Shows any currently down services first.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
    ],

    async handle(name, _args) {
      switch (name) {
        case "uptime_status": return impl.uptimeStatus(client);
        default: return null;
      }
    },
  };
}
