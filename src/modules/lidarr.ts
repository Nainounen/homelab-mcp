import { ToolModule } from "../types.js";
import { ArrClient } from "../arr.js";
import * as impl from "../tools/lidarr.js";

export function lidarrModule(client: ArrClient): ToolModule {
  return {
    domain: "Lidarr",
    tools: [
      {
        name: "lidarr_search_artist",
        description: "Search for a music artist by name. Returns MusicBrainz IDs and album counts. Use before lidarr_add_artist.",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string", description: "Artist name to search for" } },
          required: ["name"],
        },
      },
      {
        name: "lidarr_add_artist",
        description: "Add a music artist to Lidarr and trigger an automatic album download search.",
        inputSchema: {
          type: "object",
          properties: {
            mbid: { type: "string", description: "MusicBrainz ID (from lidarr_search_artist)" },
            name: { type: "string", description: "Artist name (auto-lookup if mbid not provided)" },
            quality_profile: { type: "string", description: "Quality profile name (default: first available)" },
          },
        },
      },
      {
        name: "lidarr_list_artists",
        description: "List all artists in the Lidarr library with album counts and disk usage.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "lidarr_remove_artist",
        description: "Remove an artist from the Lidarr library by Lidarr artist ID.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "number", description: "Lidarr artist ID (from lidarr_list_artists)" },
            delete_files: { type: "boolean", description: "Also delete downloaded files (default false)" },
          },
          required: ["id"],
        },
      },
      {
        name: "lidarr_get_queue",
        description: "Show active and queued music downloads in Lidarr with progress and ETA.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
    ],

    async handle(name, args) {
      switch (name) {
        case "lidarr_search_artist": return impl.lidarrSearchArtist(client, impl.LidarrSearchSchema.parse(args));
        case "lidarr_add_artist":    return impl.lidarrAddArtist(client, impl.LidarrAddArtistSchema.parse(args));
        case "lidarr_list_artists":  return impl.lidarrListArtists(client);
        case "lidarr_remove_artist": return impl.lidarrRemoveArtist(client, impl.LidarrRemoveArtistSchema.parse(args));
        case "lidarr_get_queue":     return impl.lidarrGetQueue(client);
        default: return null;
      }
    },
  };
}
