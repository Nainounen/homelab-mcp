import { ToolModule } from "../types.js";
import { TautulliClient } from "../tautulli.js";
import * as impl from "../tools/tautulli.js";

export function tautulliModule(client: TautulliClient): ToolModule {
  return {
    domain: "Tautulli",
    tools: [
      {
        name: "tautulli_get_activity",
        description: "Show current Plex streams via Tautulli: who is watching what, player, stream decision, and progress.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "tautulli_get_history",
        description: "Show recent Plex watch history from Tautulli with user, title, duration, and player.",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Number of entries to return (default 20)" },
            user: { type: "string", description: "Filter by Plex username (optional)" },
          },
        },
      },
      {
        name: "tautulli_get_stats",
        description: "Show Tautulli play stats for the last 30 days: top movies, shows, users, and platforms.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
    ],

    async handle(name, args) {
      switch (name) {
        case "tautulli_get_activity": return impl.tautulliGetActivity(client);
        case "tautulli_get_history":  return impl.tautulliGetHistory(client, impl.TautulliHistorySchema.parse(args));
        case "tautulli_get_stats":    return impl.tautulliGetStats(client);
        default: return null;
      }
    },
  };
}
