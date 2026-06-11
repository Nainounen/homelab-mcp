import { ToolModule } from "../types.js";
import { ArrClient } from "../arr.js";
import * as impl from "../tools/radarr.js";

export function radarrModule(client: ArrClient): ToolModule {
  return {
    domain: "Radarr",
    tools: [
      {
        name: "radarr_search_movie",
        description: "Search for a movie by title. Returns TMDB IDs, overviews, and ratings. Use before radarr_add_movie.",
        inputSchema: {
          type: "object",
          properties: { title: { type: "string", description: "Movie title to search for" } },
          required: ["title"],
        },
      },
      {
        name: "radarr_add_movie",
        description: "Add a movie to Radarr and trigger an automatic download search.",
        inputSchema: {
          type: "object",
          properties: {
            tmdb_id: { type: "number", description: "TMDB ID of the movie" },
            title: { type: "string", description: "Movie title (auto-lookup if tmdb_id not provided)" },
            quality_profile: { type: "string", description: "Quality profile name (default: first available)" },
          },
        },
      },
      {
        name: "radarr_list_movies",
        description: "List movies in the Radarr library with download status and file size. Supports filtering and search to keep output small.",
        inputSchema: {
          type: "object",
          properties: {
            filter: { type: "string", enum: ["all", "missing", "downloaded", "unmonitored"], description: "Filter by status (default: all)" },
            search: { type: "string", description: "Only show titles containing this text" },
            limit: { type: "number", description: "Max titles to return (default 100)" },
          },
          required: [],
        },
      },
      {
        name: "radarr_remove_movie",
        description: "Remove a movie from the Radarr library by TMDB ID.",
        inputSchema: {
          type: "object",
          properties: {
            tmdb_id: { type: "number", description: "TMDB ID of the movie to remove" },
            delete_files: { type: "boolean", description: "Also delete downloaded files (default false)" },
          },
          required: ["tmdb_id"],
        },
      },
      {
        name: "radarr_get_queue",
        description: "Show active and queued movie downloads in Radarr with progress and ETA.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "radarr_force_search",
        description: "Force Radarr to search all indexers for a specific movie already in the library.",
        inputSchema: {
          type: "object",
          properties: { tmdb_id: { type: "number", description: "TMDB ID of the movie" } },
          required: ["tmdb_id"],
        },
      },
      {
        name: "radarr_get_history",
        description: "Show recent Radarr download history (last 20 events).",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "radarr_check_releases",
        description: "Show available releases for a movie and why some are being rejected. Use to debug download issues.",
        inputSchema: {
          type: "object",
          properties: { tmdb_id: { type: "number", description: "TMDB ID of the movie" } },
          required: ["tmdb_id"],
        },
      },
      {
        name: "radarr_clear_queue",
        description: "Remove all items from the Radarr download queue and cancel them in SABnzbd.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "radarr_clear_blocklist",
        description: "Clear all entries from the Radarr blocklist so previously rejected releases can be grabbed again.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "radarr_blocklist_release",
        description: "Blocklist a specific bad release from the Radarr queue and optionally trigger a fresh search. Use queue_id from radarr_get_queue.",
        inputSchema: {
          type: "object",
          properties: {
            queue_id: { type: "number", description: "Queue item ID (shown as queueId:X in radarr_get_queue)" },
            retry: { type: "boolean", description: "Trigger a new search after blocklisting (default true)" },
          },
          required: ["queue_id"],
        },
      },
      {
        name: "radarr_list_path_mappings",
        description: "List remote path mappings in Radarr (translates download client paths to Radarr paths).",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "radarr_set_path_mapping",
        description: "Add or update a remote path mapping in Radarr.",
        inputSchema: {
          type: "object",
          properties: {
            host: { type: "string", description: "Download client host (e.g. sabnzbd)" },
            remote_path: { type: "string", description: "Path as seen by the download client" },
            local_path: { type: "string", description: "Path as seen by Radarr" },
          },
          required: ["host", "remote_path", "local_path"],
        },
      },
    ],

    async handle(name, args) {
      switch (name) {
        case "radarr_search_movie":      return impl.radarrSearchMovie(client, impl.RadarrSearchSchema.parse(args));
        case "radarr_add_movie":         return impl.radarrAddMovie(client, impl.RadarrAddMovieSchema.parse(args));
        case "radarr_list_movies":       return impl.radarrListMovies(client, impl.RadarrListMoviesSchema.parse(args));
        case "radarr_remove_movie":      return impl.radarrRemoveMovie(client, impl.RadarrRemoveMovieSchema.parse(args));
        case "radarr_get_queue":         return impl.radarrGetQueue(client);
        case "radarr_force_search":      return impl.radarrForceSearch(client, impl.RadarrForceSearchSchema.parse(args));
        case "radarr_get_history":       return impl.radarrGetHistory(client);
        case "radarr_check_releases":    return impl.radarrCheckReleases(client, impl.RadarrCheckReleasesSchema.parse(args));
        case "radarr_clear_queue":       return impl.radarrClearQueue(client);
        case "radarr_clear_blocklist":   return impl.radarrClearBlocklist(client);
        case "radarr_blocklist_release": return impl.radarrBlocklistRelease(client, impl.RadarrBlocklistReleaseSchema.parse(args));
        case "radarr_list_path_mappings": return impl.radarrListPathMappings(client);
        case "radarr_set_path_mapping":  return impl.radarrSetPathMapping(client, impl.PathMappingSchema.parse(args));
        default: return null;
      }
    },
  };
}
