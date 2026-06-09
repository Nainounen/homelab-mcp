import { ToolModule } from "../types.js";
import { ProwlarrClient } from "../prowlarr.js";
import * as impl from "../tools/prowlarr.js";

export function prowlarrModule(client: ProwlarrClient): ToolModule {
  return {
    domain: "Prowlarr",
    tools: [
      {
        name: "prowlarr_list_indexers",
        description: "List all indexers configured in Prowlarr with their status.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "prowlarr_sync_apps",
        description: "Force Prowlarr to sync all indexers to connected apps (Radarr, Sonarr). Use after adding a new indexer.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "prowlarr_test_indexers",
        description: "Test all indexers (or a specific one) in Prowlarr to verify they are working.",
        inputSchema: {
          type: "object",
          properties: { indexer_id: { type: "number", description: "Indexer ID to test (tests all if omitted)" } },
        },
      },
    ],

    async handle(name, args) {
      switch (name) {
        case "prowlarr_list_indexers": return impl.prowlarrListIndexers(client);
        case "prowlarr_sync_apps":     return impl.prowlarrSyncApps(client);
        case "prowlarr_test_indexers": return impl.prowlarrTestIndexers(client, impl.ProwlarrTestIndexerSchema.parse(args));
        default: return null;
      }
    },
  };
}
