import * as matching from "../tools/plex-match.js";
import { ToolModule } from "../types.js";
import * as impl from "../tools/plex.js";
import * as sharing from "../tools/plex-sharing.js";

export function plexModule(): ToolModule {
  return {
    domain: "Plex",
    tools: [
      ...matching.plexMatchTools,
      {
        name: "plex_list_shares",
        description: "List pending and accepted library shares on this Plex server. Does not return user access tokens.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true },
      },
      {
        name: "plex_invite_user",
        description: "Invite an email address to explicitly selected Plex library keys from plex_get_libraries. Preview by default. Downloads default off; never adds a Plex Home member. Sending requires human approval. Existing shares are left unchanged.",
        inputSchema: { type: "object", properties: {
          email: { type: "string", format: "email", maxLength: 254 },
          library_keys: { type: "array", items: { type: "string", pattern: "^[0-9]+$" }, minItems: 1, maxItems: 50 },
          allow_downloads: { type: "boolean", default: false }, preview_only: { type: "boolean", default: true },
        }, required: ["email", "library_keys"], additionalProperties: false },
        annotations: { readOnlyHint: false },
      },
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
        description: "Inspect current Plex streams, playback decisions, hardware transcoding flags, bandwidth and local/remote location. A current snapshot does not establish historical peak concurrency.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "plex_recently_added",
        description: "Show recently added movies and episodes in Plex.",
        inputSchema: {
          type: "object",
          properties: { limit: { type: "integer", minimum: 1, maximum: 100, description: "Number of items to return (default 20)" } },
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
        description: "Read paginated Plex watch events, newest first, with UTC timestamps, account IDs and next offset. Works without Tautulli. Events cannot establish historical concurrent streams or transcode load.",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, description: "Number of entries per page (default 20)" },
            offset: { type: "integer", minimum: 0, maximum: 1000000, description: "Page offset (default 0), use next_offset from the previous result" },
            account_id: { type: "integer", minimum: 0, description: "Filter by Plex account ID (optional, omit for all users)" },
          },
        },
      },
    ],

    async handle(name, args) {
      switch (name) {
        case "plex_get_metadata": return matching.plexGetMetadata(matching.PlexMetadataSchema.parse(args));
        case "plex_get_matches": return matching.plexGetMatches(matching.PlexMatchesSchema.parse(args));
        case "plex_fix_match": return matching.plexFixMatch(matching.PlexFixMatchSchema.parse(args));
        case "plex_list_shares":      return sharing.plexListShares();
        case "plex_invite_user":      return sharing.plexInviteUser(sharing.PlexInviteSchema.parse(args));
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
