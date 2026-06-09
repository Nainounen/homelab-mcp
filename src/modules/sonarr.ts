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
        description: "List all TV series in the Sonarr library with episode counts and download progress.",
        inputSchema: { type: "object", properties: {}, required: [] },
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
    ],

    async handle(name, args) {
      switch (name) {
        case "sonarr_search_series":     return impl.sonarrSearchSeries(client, impl.SonarrSearchSchema.parse(args));
        case "sonarr_add_series":        return impl.sonarrAddSeries(client, impl.SonarrAddSeriesSchema.parse(args));
        case "sonarr_list_series":       return impl.sonarrListSeries(client);
        case "sonarr_remove_series":     return impl.sonarrRemoveSeries(client, impl.SonarrRemoveSeriesSchema.parse(args));
        case "sonarr_get_queue":         return impl.sonarrGetQueue(client);
        case "sonarr_force_search":      return impl.sonarrForceSearch(client, impl.SonarrForceSearchSchema.parse(args));
        case "sonarr_season_search":     return impl.sonarrSeasonSearch(client, impl.SonarrSeasonSearchSchema.parse(args));
        case "sonarr_check_releases":    return impl.sonarrCheckReleases(client, impl.SonarrCheckReleasesSchema.parse(args));
        case "sonarr_blocklist_release":  return impl.sonarrBlocklistRelease(client, impl.SonarrBlocklistReleaseSchema.parse(args));
        case "sonarr_clear_queue":       return impl.sonarrClearQueue(client);
        case "sonarr_clear_blocklist":   return impl.sonarrClearBlocklist(client);
        case "sonarr_list_path_mappings": return impl.sonarrListPathMappings(client);
        case "sonarr_set_path_mapping":  return impl.sonarrSetPathMapping(client, impl.SonarrPathMappingSchema.parse(args));
        default: return null;
      }
    },
  };
}
