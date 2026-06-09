import { ToolModule } from "../types.js";
import { BazarrClient } from "../bazarr.js";
import * as impl from "../tools/bazarr.js";

export function bazarrModule(client: BazarrClient): ToolModule {
  return {
    domain: "Bazarr",
    tools: [
      {
        name: "bazarr_status",
        description: "Show Bazarr wanted subtitle counts and the first items needing subtitles for movies and episodes.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "bazarr_download_subtitle",
        description: "Trigger a manual subtitle download for a specific movie or episode in Bazarr.",
        inputSchema: {
          type: "object",
          properties: {
            media_type: { type: "string", enum: ["movie", "episode"], description: "Type of media" },
            id: { type: "number", description: "Radarr movie ID or Sonarr episode ID" },
            language: { type: "string", description: "Subtitle language code (default: en)" },
          },
          required: ["media_type", "id"],
        },
      },
    ],

    async handle(name, args) {
      switch (name) {
        case "bazarr_status":            return impl.bazarrGetStatus(client);
        case "bazarr_download_subtitle": return impl.bazarrDownloadSubtitle(client, impl.BazarrDownloadSchema.parse(args));
        default: return null;
      }
    },
  };
}
