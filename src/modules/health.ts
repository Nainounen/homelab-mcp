import { ToolModule } from "../types.js";
import { cached } from "../utils.js";
import * as impl from "../tools/health.js";

export function healthModule(): ToolModule {
  return {
    domain: "Health",
    tools: [
      {
        name: "homelab_health",
        description:
          "Run a health check against all configured homelab services. " +
          "Pings every service URL found in .env and reports which are reachable " +
          "with latency, and which are down with the error reason. " +
          "Results are cached for 30 seconds.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
    ],

    async handle(name, _args) {
      switch (name) {
        case "homelab_health":
          return cached("homelab_health", 30_000, () => impl.homelabHealth());
        default:
          return null;
      }
    },
  };
}
