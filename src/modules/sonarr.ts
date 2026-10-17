import { queueBatchTools, queueBatchSchema, processQueueBatch } from "../tools/queue-bulk.js";
import { ToolModule } from "../types.js";
import { ArrClient } from "../arr.js";
import { QueueDismissSchema, dismissQueueItem, queueDismissTool } from "../tools/queue.js";
import { qualityProfileTools, profileDetails, saveProfile, deleteProfile, profileIdSchema, createProfileSchema, editProfileSchema, deleteProfileSchema } from "../tools/quality-profiles.js";
import * as impl from "../tools/sonarr.js";

export function sonarrModule(client: ArrClient): ToolModule {
  return {
    domain: "Sonarr",
    tools: [
      ...qualityProfileTools("sonarr"),
      queueDismissTool("sonarr"),
      ...queueBatchTools("sonarr"),
      {
        "name": "sonarr_refresh_series",
        "description": "Refresh metadata and run the service-configured file scan. Preview by default; returns a command ID when applied. Does not submit a download search.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "tvdb_id": {
              "type": "integer",
              "minimum": 1,
              "description": "External ID of an existing library item"
            },
            "preview_only": {
              "type": "boolean",
              "default": true,
              "description": "Preview only by default. Set false only after human approval."
            }
          },
          "required": [
            "tvdb_id"
          ]
        },
        "annotations": {
          "readOnlyHint": false
        }
      },
      {
        "name": "sonarr_rescan_series",
        "description": "Rescan the existing library folder for media files. This can update file records. Preview by default; returns a command ID when applied. Does not submit a download search.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "tvdb_id": {
              "type": "integer",
              "minimum": 1,
              "description": "External ID of an existing library item"
            },
            "preview_only": {
              "type": "boolean",
              "default": true,
              "description": "Preview only by default. Set false only after human approval."
            }
          },
          "required": [
            "tvdb_id"
          ]
        },
        "annotations": {
          "readOnlyHint": false
        }
      },
      {
        "name": "sonarr_list_languages",
        "description": "List supported languages for Sonarr.",
        "inputSchema": {
          "type": "object",
          "properties": {},
          "required": []
        },
        "annotations": {
          "readOnlyHint": true
        }
      },
      {
        "name": "sonarr_list_quality_profiles",
        "description": "List supported quality profiles for Sonarr.",
        "inputSchema": {
          "type": "object",
          "properties": {},
          "required": []
        },
        "annotations": {
          "readOnlyHint": true
        }
      },
      {
        "name": "sonarr_set_quality_profile",
        "description": "Change the quality profile of one existing library item. Preview by default. Existing file quality is unchanged; future automatic upgrades may become eligible.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "tvdb_id": {
              "type": "integer",
              "minimum": 1,
              "description": "External ID of an existing library item"
            },
            "quality_profile": {
              "type": "string",
              "minLength": 1,
              "description": "Exact quality profile name from list_quality_profiles"
            },
            "preview_only": {
              "type": "boolean",
              "default": true,
              "description": "Preview only by default. Set false only after human approval."
            }
          },
          "required": [
            "tvdb_id",
            "quality_profile"
          ]
        },
        "annotations": {
          "readOnlyHint": false
        }
      },
      {
        "name": "sonarr_list_episodes",
        "description": "Inspect episode IDs, air dates, monitoring, download status, and file IDs for an existing series.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "tvdb_id": {
              "type": "integer",
              "minimum": 1,
              "description": "External ID of an existing library item"
            },
            "season": {
              "type": "integer",
              "minimum": 0
            },
            "episode": {
              "type": "integer",
              "minimum": 0,
              "description": "Requires season"
            },
            "limit": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100,
              "default": 50
            }
          },
          "required": [
            "tvdb_id"
          ]
        },
        "annotations": {
          "readOnlyHint": true
        }
      },
      {
        "name": "sonarr_list_episode_files",
        "description": "Inspect existing episode files, quality, assigned languages, and reported audio/subtitle languages. This does not edit files or audio tracks.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "tvdb_id": {
              "type": "integer",
              "minimum": 1,
              "description": "External ID of an existing library item"
            },
            "season": {
              "type": "integer",
              "minimum": 0
            },
            "episode": {
              "type": "integer",
              "minimum": 0,
              "description": "Requires season"
            },
            "limit": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100,
              "default": 50
            }
          },
          "required": [
            "tvdb_id"
          ]
        },
        "annotations": {
          "readOnlyHint": true
        }
      },
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
        name: "sonarr_get_command",
        description: "Check whether a submitted command is queued, running, completed, or failed.",
        inputSchema: {
          type: "object",
          properties: { command_id: { type: "integer", minimum: 1, description: "Command ID returned by an import, refresh, or rescan" } },
          required: ["command_id"],
        },
      },
      {
        name: "sonarr_get_queue",
        description: "Show active and queued episode downloads in Sonarr with queue IDs, progress, ETA, output paths, and import errors.",
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
          "Show available releases for a TV series episode or season with their GUIDs, quality, languages, size, age, indexer ID, custom format score and matched formats, sorted by highest profile score first. " +
          "Use this when you want to manually pick a specific release instead of letting Sonarr auto-grab. " +
          "WORKFLOW: (1) Call this to browse releases for a season or episode. (2) Pick a release by guid. (3) Call sonarr_grab_release with that guid. " +
          "For existing downloaded media, use include_rejected: true to see alternatives rejected because the current file meets the cutoff. " +
          "Season packs are labelled [SEASON PACK]. By default only shows grabbable releases — pass include_rejected: true to also see why others were rejected.",
        inputSchema: {
          type: "object",
          properties: {
            tvdb_id: { type: "number", description: "TVDB ID of the series" },
            season: { type: "number", description: "Season number" },
            episode: { type: "number", description: "Episode number — omit to search the entire season" },
            language: { type: "string", minLength: 1, description: "Filter by reported language, such as German. Use include_rejected: true to inspect alternatives for existing files." },
            include_rejected: { type: "boolean", description: "Also show rejected releases (default false)" },
            limit: { type: "integer", minimum: 1, maximum: 100, description: "Maximum releases to show (default 20, maximum 100)" },
          },
          required: ["tvdb_id", "season"],
        },
      },
      {
        name: "sonarr_grab_release",
        description:
          "Preview or grab a specific release by its GUID (from sonarr_interactive_search) and send it to the download client. " +
          "Defaults to preview_only: true. Obtain human approval before preview_only: false. A rejected release also requires allow_rejected: true. " +
          "After grabbing, use sonarr_get_queue to monitor progress.",
        inputSchema: {
          type: "object",
          properties: {
            tvdb_id: { type: "number", description: "TVDB ID of the series" },
            indexer_id: { type: "integer", minimum: 1, description: "Indexer ID from the search result; required if the GUID is ambiguous" },
            allow_rejected: { type: "boolean", default: false, description: "Acknowledge rejection reasons only after human approval" },
            preview_only: { type: "boolean", default: true, description: "Preview the download and replacement risk; set false after human approval" },
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
          "Imports run asynchronously. Use sonarr_get_command with the returned command ID to check completion. " +
          "Files without a confident match are reported separately for manual attention.",
        inputSchema: {
          type: "object",
          properties: {
            folder: { type: "string", description: "Absolute path of the folder to scan" },
            preview_only: { type: "boolean", description: "Show matches without importing (default true)" },
            filter_existing: { type: "boolean", description: "Skip files already in the library (default true)" },
            import_mode: { type: "string", enum: ["auto", "copy", "move"], description: "Import mode (default copy preserves source files)" },
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
        case "sonarr_remove_queue_items": return processQueueBatch(client, "sonarr", false, queueBatchSchema.parse(args));
        case "sonarr_blocklist_releases": return processQueueBatch(client, "sonarr", true, queueBatchSchema.parse(args));
        case "sonarr_get_quality_profile": return profileDetails(client,profileIdSchema.parse(args));
        case "sonarr_create_quality_profile": return saveProfile(client,createProfileSchema.parse(args));
        case "sonarr_edit_quality_profile": return saveProfile(client,editProfileSchema.parse(args));
        case "sonarr_delete_quality_profile": return deleteProfile(client,"sonarr",deleteProfileSchema.parse(args));
        case "sonarr_remove_queue_item": return dismissQueueItem(client, QueueDismissSchema.parse(args));
        case "sonarr_refresh_series": return impl.sonarrRefreshSeries(client, impl.SonarrExistingItemSchema.parse(args));
        case "sonarr_rescan_series": return impl.sonarrRescanSeries(client, impl.SonarrExistingItemSchema.parse(args));
        case "sonarr_list_languages": return impl.sonarrListLanguages(client);
        case "sonarr_list_quality_profiles": return impl.sonarrListQualityProfiles(client);
        case "sonarr_set_quality_profile": return impl.sonarrSetQualityProfile(client, impl.SonarrSetQualityProfileSchema.parse(args));
        case "sonarr_list_episodes": return impl.sonarrListEpisodes(client, impl.SonarrInspectEpisodesSchema.parse(args));
        case "sonarr_list_episode_files": return impl.sonarrListEpisodeFiles(client, impl.SonarrInspectEpisodesSchema.parse(args));
        case "sonarr_search_series":        return impl.sonarrSearchSeries(client, impl.SonarrSearchSchema.parse(args));
        case "sonarr_add_series":           return impl.sonarrAddSeries(client, impl.SonarrAddSeriesSchema.parse(args));
        case "sonarr_list_series":          return impl.sonarrListSeries(client, impl.SonarrListSeriesSchema.parse(args));
        case "sonarr_remove_series":        return impl.sonarrRemoveSeries(client, impl.SonarrRemoveSeriesSchema.parse(args));
        case "sonarr_get_command":          return impl.sonarrGetCommand(client, impl.SonarrCommandStatusSchema.parse(args));
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
