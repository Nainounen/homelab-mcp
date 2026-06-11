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
      {
        name: "radarr_interactive_search",
        description:
          "Show all available releases for a movie with their GUIDs, quality, size, age, indexer, and custom format score. " +
          "Use this when you want to manually pick a specific release instead of letting Radarr auto-grab. " +
          "WORKFLOW: (1) Call this to browse releases. (2) Pick a release by guid. (3) Call radarr_grab_release with that guid. " +
          "By default only shows grabbable releases — pass include_rejected: true to also see why others were rejected.",
        inputSchema: {
          type: "object",
          properties: {
            tmdb_id: { type: "number", description: "TMDB ID of the movie" },
            include_rejected: { type: "boolean", description: "Also show rejected releases (default false)" },
          },
          required: ["tmdb_id"],
        },
      },
      {
        name: "radarr_grab_release",
        description:
          "Grab a specific release by its GUID (from radarr_interactive_search) and send it to the download client. " +
          "After grabbing, use radarr_get_queue to monitor progress.",
        inputSchema: {
          type: "object",
          properties: {
            tmdb_id: { type: "number", description: "TMDB ID of the movie" },
            guid: { type: "string", description: "Release GUID from radarr_interactive_search (shown as guid:xxx)" },
          },
          required: ["tmdb_id", "guid"],
        },
      },
      {
        name: "radarr_manual_import",
        description:
          "Scan a local folder for video files and import them into Radarr. " +
          "Radarr will auto-match each file to a movie in the library. " +
          "WORKFLOW: (1) Call with preview_only: true to see what will be matched. " +
          "(2) If matches look correct, call again with preview_only: false to apply. " +
          "Files without a confident match are reported separately for manual attention. " +
          "Useful after manually moving files into a watched folder or after a partial download.",
        inputSchema: {
          type: "object",
          properties: {
            folder: { type: "string", description: "Absolute path of the folder to scan" },
            preview_only: { type: "boolean", description: "Show matches without importing (default false)" },
            filter_existing: { type: "boolean", description: "Skip files already in the library (default true)" },
          },
          required: ["folder"],
        },
      },
      {
        name: "radarr_list_custom_formats",
        description:
          "List all custom formats in Radarr and their scores across quality profiles. " +
          "Always call this first before creating or modifying custom formats so you know what already exists. " +
          "Output: [id] Name | N condition(s) | ProfileName: +score",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "radarr_set_custom_format",
        description:
          "Create or update a custom format in Radarr (upsert by name). " +
          "WORKFLOW: (1) Call radarr_list_custom_formats to see existing formats. " +
          "(2) Build the specifications array — each object needs: name, implementationName, implementation, negate (bool), required (bool), fields (array). " +
          "Common implementations: ReleaseTitleSpecification (fields: value=regex), LanguageSpecification (fields: value=language id), IndexerFlagSpecification, SizeSpecification. " +
          "Pass specifications as a JSON string. Omit specifications to create a score-only placeholder. " +
          "(3) After creating, call radarr_set_cf_score to assign a score in the desired quality profile.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Custom format name (creates if new, updates if exists)" },
            specifications: {
              type: "string",
              description:
                'JSON array of spec objects, e.g. [{"name":"HDR","implementationName":"Release Title","implementation":"ReleaseTitleSpecification","negate":false,"required":false,"fields":[{"name":"value","value":"\\\\bHDR\\\\b"}]}]',
            },
            include_when_renaming: { type: "boolean", description: "Append format tag to renamed filenames (default false)" },
          },
          required: ["name"],
        },
      },
      {
        name: "radarr_delete_custom_format",
        description: "Delete a custom format from Radarr by name. Also removes its score from all quality profiles automatically.",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string", description: "Exact custom format name to delete" } },
          required: ["name"],
        },
      },
      {
        name: "radarr_set_cf_score",
        description:
          "Set the score of a custom format in a Radarr quality profile. " +
          "Scores control whether a release is preferred (+), penalised (-), or ignored (0). " +
          "Use after radarr_set_custom_format to wire the new format into a profile. " +
          "Tip: use radarr_list_custom_formats to confirm the format name and see current scores before setting.",
        inputSchema: {
          type: "object",
          properties: {
            format_name: { type: "string", description: "Exact custom format name" },
            profile_name: { type: "string", description: "Quality profile name — omit to use the first available profile" },
            score: { type: "number", description: "Integer score: positive=prefer, negative=penalise/reject at cutoff, 0=ignore" },
          },
          required: ["format_name", "score"],
        },
      },
    ],

    async handle(name, args) {
      switch (name) {
        case "radarr_search_movie":        return impl.radarrSearchMovie(client, impl.RadarrSearchSchema.parse(args));
        case "radarr_add_movie":           return impl.radarrAddMovie(client, impl.RadarrAddMovieSchema.parse(args));
        case "radarr_list_movies":         return impl.radarrListMovies(client, impl.RadarrListMoviesSchema.parse(args));
        case "radarr_remove_movie":        return impl.radarrRemoveMovie(client, impl.RadarrRemoveMovieSchema.parse(args));
        case "radarr_get_queue":           return impl.radarrGetQueue(client);
        case "radarr_force_search":        return impl.radarrForceSearch(client, impl.RadarrForceSearchSchema.parse(args));
        case "radarr_get_history":         return impl.radarrGetHistory(client);
        case "radarr_check_releases":      return impl.radarrCheckReleases(client, impl.RadarrCheckReleasesSchema.parse(args));
        case "radarr_clear_queue":         return impl.radarrClearQueue(client);
        case "radarr_clear_blocklist":     return impl.radarrClearBlocklist(client);
        case "radarr_blocklist_release":   return impl.radarrBlocklistRelease(client, impl.RadarrBlocklistReleaseSchema.parse(args));
        case "radarr_list_path_mappings":  return impl.radarrListPathMappings(client);
        case "radarr_set_path_mapping":    return impl.radarrSetPathMapping(client, impl.PathMappingSchema.parse(args));
        case "radarr_interactive_search":   return impl.radarrInteractiveSearch(client, impl.RadarrInteractiveSearchSchema.parse(args));
        case "radarr_grab_release":         return impl.radarrGrabRelease(client, impl.RadarrGrabReleaseSchema.parse(args));
        case "radarr_manual_import":        return impl.radarrManualImport(client, impl.RadarrManualImportSchema.parse(args));
        case "radarr_list_custom_formats": return impl.radarrListCustomFormats(client);
        case "radarr_set_custom_format":   return impl.radarrSetCustomFormat(client, impl.CustomFormatSetSchema.parse(args));
        case "radarr_delete_custom_format": return impl.radarrDeleteCustomFormat(client, impl.CustomFormatDeleteSchema.parse(args));
        case "radarr_set_cf_score":        return impl.radarrSetCfScore(client, impl.CustomFormatScoreSchema.parse(args));
        default: return null;
      }
    },
  };
}
