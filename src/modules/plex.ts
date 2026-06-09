import { ToolModule } from "../types.js";
import * as impl from "../tools/plex.js";

export function plexModule(): ToolModule {
  return {
    domain: "Plex",
    tools: [
      {
        name: "plex_get_libraries",
        description: "List all Plex libraries (Movies, TV Shows, etc.) with item counts.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "plex_search",
        description: "Search across all Plex libraries for movies, shows, or episodes.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string", description: "Search query" } },
          required: ["query"],
        },
      },
      {
        name: "plex_get_sessions",
        description: "Show who is currently streaming on Plex, what they are watching, and whether it is transcoding or direct play.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "plex_recently_added",
        description: "Show recently added movies and episodes in Plex.",
        inputSchema: {
          type: "object",
          properties: { limit: { type: "number", description: "Number of items to return (default 20)" } },
        },
      },
      {
        name: "plex_refresh_library",
        description: "Trigger a Plex library scan to pick up newly added files.",
        inputSchema: {
          type: "object",
          properties: {
            library_name: { type: "string", description: "Library name to refresh (e.g. 'Movies'). Refreshes all if omitted." },
          },
        },
      },
      {
        name: "plex_delete_media",
        description: "Permanently delete a movie or episode from the Plex library by its ratingKey. Get the ratingKey from plex_search.",
        inputSchema: {
          type: "object",
          properties: { rating_key: { type: "string", description: "Plex ratingKey of the item to delete (from plex_search results)" } },
          required: ["rating_key"],
        },
      },
      {
        name: "plex_get_watch_history",
        description: "Show recent Plex watch history across all users with titles, types, and play counts.",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Number of entries to return (default 20)" },
            account_id: { type: "number", description: "Filter by Plex account ID (optional, omit for all users)" },
          },
        },
      },
    ],

    async handle(name, args) {
      switch (name) {
        case "plex_get_libraries":    return impl.plexGetLibraries();
        case "plex_search":           return impl.plexSearch(impl.PlexSearchSchema.parse(args));
        case "plex_get_sessions":     return impl.plexGetSessions();
        case "plex_recently_added":   return impl.plexRecentlyAdded(impl.PlexRecentlyAddedSchema.parse(args));
        case "plex_refresh_library":  return impl.plexRefreshLibrary(impl.PlexRefreshLibrarySchema.parse(args));
        case "plex_delete_media":     return impl.plexDeleteMedia(impl.PlexDeleteMediaSchema.parse(args));
        case "plex_get_watch_history": return impl.plexGetWatchHistory(impl.PlexWatchHistorySchema.parse(args));
        default: return null;
      }
    },
  };
}
