import { ToolModule } from "../types.js";
import { ArrClient } from "../arr.js";
import * as impl from "../tools/sonarr.js";

export function sonarrModule(client: ArrClient): ToolModule {
  return {
    domain: "Sonarr",
    tools: [
      {
        name: "sonarr_search_series",
        description: "Search for a TV series by title. Returns TVDB IDs, overviews, and network info. Use before sonarr_add_series.",
        inputSchema: {
          type: "object",
          properties: { title: { type: "string", description: "Series title to search for" } },
          required: ["title"],
        },
      },
      {
        name: "sonarr_add_series",
        description: "Add a TV series to Sonarr and trigger an automatic episode download.",
        inputSchema: {
          type: "object",
          properties: {
            tvdb_id: { type: "number", description: "TVDB ID of the series" },
            title: { type: "string", description: "Series title (auto-lookup if tvdb_id not provided)" },
            quality_profile: { type: "string", description: "Quality profile name (default: first available)" },
            monitor: {
              type: "string",
              enum: ["all", "future", "missing", "existing", "none"],
              description: "Which episodes to monitor (default: all)",
            },
          },
        },
      },
      {
        name: "sonarr_list_series",
        description: "List TV series in the Sonarr library with episode counts and download progress. Supports filtering and search to keep output small.",
        inputSchema: {
          type: "object",
          properties: {
            filter: { type: "string", enum: ["all", "missing", "complete", "unmonitored"], description: "Filter by status (default: all)" },
            search: { type: "string", description: "Only show titles containing this text" },
            limit: { type: "number", description: "Max titles to return (default 100)" },
          },
          required: [],
        },
      },
      {
        name: "sonarr_remove_series",
        description: "Remove a TV series from the Sonarr library by TVDB ID.",
        inputSchema: {
          type: "object",
          properties: {
            tvdb_id: { type: "number", description: "TVDB ID of the series to remove" },
            delete_files: { type: "boolean", description: "Also delete downloaded files (default false)" },
          },
          required: ["tvdb_id"],
        },
      },
      {
        name: "sonarr_get_queue",
        description: "Show active and queued episode downloads in Sonarr with progress and ETA.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "sonarr_force_search",
        description: "Force Sonarr to search all indexers for missing episodes of a series.",
        inputSchema: {
          type: "object",
          properties: { tvdb_id: { type: "number", description: "TVDB ID of the series" } },
          required: ["tvdb_id"],
        },
      },
      {
        name: "sonarr_season_search",
        description: "Search for a specific season of a series in Sonarr.",
        inputSchema: {
          type: "object",
          properties: {
            tvdb_id: { type: "number", description: "TVDB ID of the series" },
            season: { type: "number", description: "Season number to search" },
          },
          required: ["tvdb_id", "season"],
        },
      },
      {
        name: "sonarr_check_releases",
        description: "Show available releases for a TV series season and why some are being rejected. Use to debug download issues.",
        inputSchema: {
          type: "object",
          properties: {
            tvdb_id: { type: "number", description: "TVDB ID of the series" },
            season: { type: "number", description: "Season number to check (default: 1)" },
          },
          required: ["tvdb_id"],
        },
      },
      {
        name: "sonarr_blocklist_release",
        description: "Blocklist a specific bad release from the Sonarr queue so it won't be grabbed again, and optionally trigger a fresh search. Use queue_id from sonarr_get_queue.",
        inputSchema: {
          type: "object",
          properties: {
            queue_id: { type: "number", description: "Queue item ID from sonarr_get_queue" },
            retry: { type: "boolean", description: "Trigger a new search after blocklisting (default true)" },
          },
          required: ["queue_id"],
        },
      },
      {
        name: "sonarr_clear_queue",
        description: "Remove all items from the Sonarr download queue and cancel them in SABnzbd.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "sonarr_clear_blocklist",
        description: "Clear all entries from the Sonarr blocklist.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "sonarr_list_path_mappings",
        description: "List remote path mappings in Sonarr.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "sonarr_set_path_mapping",
        description: "Add or update a remote path mapping in Sonarr.",
        inputSchema: {
          type: "object",
          properties: {
            host: { type: "string", description: "Download client host (e.g. sabnzbd)" },
            remote_path: { type: "string", description: "Path as seen by the download client" },
            local_path: { type: "string", description: "Path as seen by Sonarr" },
          },
          required: ["host", "remote_path", "local_path"],
        },
      },
      {
        name: "sonarr_interactive_search",
        description:
          "Show all available releases for a TV series episode or season with their GUIDs, quality, size, age, indexer, and custom format score. " +
          "Use this when you want to manually pick a specific release instead of letting Sonarr auto-grab. " +
          "WORKFLOW: (1) Call this to browse releases for a season or episode. (2) Pick a release by guid. (3) Call sonarr_grab_release with that guid. " +
          "Season packs are labelled [SEASON PACK]. By default only shows grabbable releases — pass include_rejected: true to also see why others were rejected.",
        inputSchema: {
          type: "object",
          properties: {
            tvdb_id: { type: "number", description: "TVDB ID of the series" },
            season: { type: "number", description: "Season number" },
            episode: { type: "number", description: "Episode number — omit to see season-pack and first-episode releases" },
            include_rejected: { type: "boolean", description: "Also show rejected releases (default false)" },
          },
          required: ["tvdb_id", "season"],
        },
      },
      {
        name: "sonarr_grab_release",
        description:
          "Grab a specific release by its GUID (from sonarr_interactive_search) and send it to the download client. " +
          "After grabbing, use sonarr_get_queue to monitor progress.",
        inputSchema: {
          type: "object",
          properties: {
            tvdb_id: { type: "number", description: "TVDB ID of the series" },
            guid: { type: "string", description: "Release GUID from sonarr_interactive_search (shown as guid:xxx)" },
            season: { type: "number", description: "Season number — must match what was used in sonarr_interactive_search" },
            episode: { type: "number", description: "Episode number — include if sonarr_interactive_search was called with one" },
          },
          required: ["tvdb_id", "guid", "season"],
        },
      },
      {
        name: "sonarr_manual_import",
        description:
          "Scan a local folder for video files and import them into Sonarr. " +
          "Sonarr will auto-match each file to a series and episode in the library. " +
          "WORKFLOW: (1) Call with preview_only: true to see what will be matched. " +
          "(2) If matches look correct, call again with preview_only: false to apply. " +
          "Files without a confident match are reported separately for manual attention.",
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
        name: "sonarr_list_custom_formats",
        description:
          "List all custom formats in Sonarr and their scores across quality profiles. " +
          "Always call this first before creating or modifying custom formats so you know what already exists. " +
          "Output: [id] Name | N condition(s) | ProfileName: +score",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "sonarr_set_custom_format",
        description:
          "Create or update a custom format in Sonarr (upsert by name). " +
          "WORKFLOW: (1) Call sonarr_list_custom_formats to see existing formats. " +
          "(2) Build the specifications array — each object needs: name, implementationName, implementation, negate (bool), required (bool), fields (array). " +
          "Common implementations: ReleaseTitleSpecification (fields: value=regex), LanguageSpecification (fields: value=language id), IndexerFlagSpecification, SizeSpecification. " +
          "Pass specifications as a JSON string. Omit specifications to create a score-only placeholder. " +
          "(3) After creating, call sonarr_set_cf_score to assign a score in the desired quality profile.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Custom format name (creates if new, updates if exists)" },
            specifications: {
              type: "string",
              description:
                'JSON array of spec objects, e.g. [{"name":"DV","implementationName":"Release Title","implementation":"ReleaseTitleSpecification","negate":false,"required":false,"fields":[{"name":"value","value":"\\\\bDV\\\\b"}]}]',
            },
            include_when_renaming: { type: "boolean", description: "Append format tag to renamed filenames (default false)" },
          },
          required: ["name"],
        },
      },
      {
        name: "sonarr_delete_custom_format",
        description: "Delete a custom format from Sonarr by name. Also removes its score from all quality profiles automatically.",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string", description: "Exact custom format name to delete" } },
          required: ["name"],
        },
      },
      {
        name: "sonarr_set_cf_score",
        description:
          "Set the score of a custom format in a Sonarr quality profile. " +
          "Scores control whether a release is preferred (+), penalised (-), or ignored (0). " +
          "Use after sonarr_set_custom_format to wire the new format into a profile. " +
          "Tip: use sonarr_list_custom_formats to confirm the format name and see current scores before setting.",
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
        case "sonarr_search_series":        return impl.sonarrSearchSeries(client, impl.SonarrSearchSchema.parse(args));
        case "sonarr_add_series":           return impl.sonarrAddSeries(client, impl.SonarrAddSeriesSchema.parse(args));
        case "sonarr_list_series":          return impl.sonarrListSeries(client, impl.SonarrListSeriesSchema.parse(args));
        case "sonarr_remove_series":        return impl.sonarrRemoveSeries(client, impl.SonarrRemoveSeriesSchema.parse(args));
        case "sonarr_get_queue":            return impl.sonarrGetQueue(client);
        case "sonarr_force_search":         return impl.sonarrForceSearch(client, impl.SonarrForceSearchSchema.parse(args));
        case "sonarr_season_search":        return impl.sonarrSeasonSearch(client, impl.SonarrSeasonSearchSchema.parse(args));
        case "sonarr_check_releases":       return impl.sonarrCheckReleases(client, impl.SonarrCheckReleasesSchema.parse(args));
        case "sonarr_blocklist_release":    return impl.sonarrBlocklistRelease(client, impl.SonarrBlocklistReleaseSchema.parse(args));
        case "sonarr_clear_queue":          return impl.sonarrClearQueue(client);
        case "sonarr_clear_blocklist":      return impl.sonarrClearBlocklist(client);
        case "sonarr_list_path_mappings":   return impl.sonarrListPathMappings(client);
        case "sonarr_set_path_mapping":     return impl.sonarrSetPathMapping(client, impl.SonarrPathMappingSchema.parse(args));
        case "sonarr_interactive_search":    return impl.sonarrInteractiveSearch(client, impl.SonarrInteractiveSearchSchema.parse(args));
        case "sonarr_grab_release":         return impl.sonarrGrabRelease(client, impl.SonarrGrabReleaseSchema.parse(args));
        case "sonarr_manual_import":        return impl.sonarrManualImport(client, impl.SonarrManualImportSchema.parse(args));
        case "sonarr_list_custom_formats":  return impl.sonarrListCustomFormats(client);
        case "sonarr_set_custom_format":    return impl.sonarrSetCustomFormat(client, impl.CustomFormatSetSchema.parse(args));
        case "sonarr_delete_custom_format": return impl.sonarrDeleteCustomFormat(client, impl.CustomFormatDeleteSchema.parse(args));
        case "sonarr_set_cf_score":         return impl.sonarrSetCfScore(client, impl.CustomFormatScoreSchema.parse(args));
        default: return null;
      }
    },
  };
}
