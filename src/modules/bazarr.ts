import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolModule } from "../types.js";
import { BazarrClient } from "../bazarr.js";
import { bazarrApiTools, operations, runOperation, getSettings, setSettings, setLanguages, setProfiles, settingsSchema, languagesSchema, profilesSchema } from "../tools/bazarr.js";

const preview = { type: "boolean", default: true, description: "Preview changes. Set false only when authorized." };
const expectedHash = { type: "string", description: "Opaque expected_hash returned by the latest preview; required to apply." };
const legacyDownloadSchema = z.object({ media_type: z.enum(["movie", "episode"]), id: z.number().int().positive(), language: z.string().default("en"), series_id: z.number().int().positive().optional(), preview_only: z.boolean().default(true) }).strict();
const wantedSearchSchema = z.object({ preview_only: z.boolean().default(true) }).strict();
const wantedTasks: Record<string, string> = {
  bazarr_search_wanted_movies: "wanted_search_missing_subtitles_movies",
  bazarr_search_wanted_episodes: "wanted_search_missing_subtitles_series",
};
const customTools: Tool[] = [
  ...Object.keys(wantedTasks).map(name => ({ name, description: `Start Bazarr mass search and download of wanted subtitles for all ${name.endsWith("movies") ? "movies" : "episodes"}. Equivalent to System > Tasks > Search Wanted. Uses assigned language profiles. Runs in the background; inspect bazarr_get_system_tasks and bazarr_get_system_jobs for progress. Preview by default; set preview_only=false to start when authorized.`, inputSchema: { type: "object" as const, properties: { preview_only: preview }, additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false } })),
  { name: "bazarr_status", description: "Inspect Bazarr system health and wanted subtitle counts, with up to ten example movies and episodes.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "bazarr_download_subtitle", description: "Search and download subtitles for one movie or episode. IDs are Radarr movie or Sonarr episode IDs. Preview by default.", inputSchema: { type: "object", properties: { media_type: { type: "string", enum: ["movie", "episode"] }, id: { type: "integer", minimum: 1 }, language: { type: "string", default: "en" }, series_id: { type: "integer", minimum: 1 }, preview_only: preview }, required: ["media_type", "id"], additionalProperties: false }, annotations: { readOnlyHint: false } },
  { name: "bazarr_get_settings", description: "Inspect all Bazarr settings or one section, including Sonarr/Radarr connection, subtitle providers, path mappings, subsync, and general settings. Secret values are redacted. Returns a settings revision hash.", inputSchema: { type: "object", properties: { section: { type: "string" } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "bazarr_update_settings", description: "Patch existing Bazarr settings using settings-SECTION-KEY names, e.g. settings-sonarr-series_sync or settings-subsync-use_subsync. Preview first; applying requires expected_hash. Only specified fields change. Default profile fields require numeric profile IDs, not names; existing media needs an explicit profile assignment. Use arrays of comma-separated pairs for path mappings. Some settings restart connections or schedule jobs. Never send redacted values.", inputSchema: { type: "object", properties: { changes: { type: "object", additionalProperties: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] } }] } }, expected_hash: expectedHash, preview_only: preview }, required: ["changes"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: true } },
  { name: "bazarr_set_enabled_languages", description: "Replace Bazarr's enabled language list using code2 values from bazarr_get_system_languages. Does not assign a profile to media. Preview first; applying requires expected_hash.", inputSchema: { type: "object", properties: { languages: { type: "array", items: { type: "string" }, minItems: 1 }, expected_hash: expectedHash, preview_only: preview }, required: ["languages"], additionalProperties: false }, annotations: { readOnlyHint: false } },
  { name: "bazarr_set_language_profiles", description: "Replace the complete Bazarr language-profile list. Read bazarr_get_language_profiles first, preserve profiles you want to retain. Omitted profiles are removed. Each profile requires profileId, name, cutoff, items (id/language/forced/hi strings), mustContain/mustNotContain arrays, originalFormat, optional tag. Item audio_exclude and audio_only_include default to False. Preview returns expected_hash required to apply.", inputSchema: { type: "object", properties: { profiles: { type: "array", maxItems: 100, items: { type: "object", properties: { profileId: { type: "integer" }, name: { type: "string" }, cutoff: { anyOf: [{ type: "integer" }, { type: "string" }, { type: "null" }] }, items: { type: "array", items: { type: "object", properties: { id: { type: "integer" }, language: { type: "string" }, forced: { type: "string" }, hi: { type: "string" }, audio_exclude: { type: "string", enum: ["True", "False"], default: "False" }, audio_only_include: { type: "string", enum: ["True", "False"], default: "False" } }, required: ["id", "language", "forced", "hi"], additionalProperties: false } }, mustContain: { type: "array", items: { type: "string" } }, mustNotContain: { type: "array", items: { type: "string" } }, originalFormat: { anyOf: [{ type: "number" }, { type: "string" }, { type: "boolean" }, { type: "null" }] }, tag: { anyOf: [{ type: "string" }, { type: "null" }] } }, required: ["profileId", "name", "cutoff", "items", "mustContain", "mustNotContain", "originalFormat"], additionalProperties: false } }, expected_hash: expectedHash, preview_only: preview }, required: ["profiles"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: true } },
];
export const bazarrTools = [...bazarrApiTools, ...customTools];
export const bazarrActionSchemas = Object.fromEntries([
  ...Object.keys(wantedTasks).map(name => [name, wantedSearchSchema]),
  ["bazarr_download_subtitle", legacyDownloadSchema], ["bazarr_update_settings", settingsSchema], ["bazarr_set_enabled_languages", languagesSchema], ["bazarr_set_language_profiles", profilesSchema],
]);
export function bazarrModule(client: BazarrClient): ToolModule {
  return { domain: "Bazarr", tools: bazarrTools, async handle(name, args) {
    if (Object.hasOwn(wantedTasks, name)) {
      const searchArgs = wantedSearchSchema.parse(args);
      const operation = operations.find(op => op.name === "bazarr_post_system_tasks")!;
      return runOperation(client, operation, { taskid: wantedTasks[name], preview_only: searchArgs.preview_only });
    }
    const operation = operations.find(op => op.name === name);
    if (operation) return runOperation(client, operation, args);
    switch (name) {
      case "bazarr_status": {
        z.object({}).strict().parse(args);
        const data = await Promise.all([client.get("/api/system/health"), client.get("/api/movies/wanted", { start: 0, length: 10 }), client.get("/api/episodes/wanted", { start: 0, length: 10 })]);
        return JSON.stringify({ health: data[0], movies: data[1], episodes: data[2] });
      }
      case "bazarr_download_subtitle": {
        const a = legacyDownloadSchema.parse(args);
        let seriesId = a.series_id;
        if (a.media_type === "episode" && !seriesId) {
          const data = await client.get<{ data: Array<{ sonarrSeriesId: number }> }>("/api/episodes", { "episodeid[]": [a.id] });
          seriesId = data.data?.[0]?.sonarrSeriesId;
          if (!seriesId) throw new Error("Episode not found or series_id could not be resolved.");
        }
        const op = operations.find(o => o.name === (a.media_type === "movie" ? "bazarr_patch_movies_subtitles" : "bazarr_patch_episodes_subtitles"))!;
        return runOperation(client, op, { ...(a.media_type === "movie" ? { radarrid: a.id } : { episodeid: a.id, seriesid: seriesId }), language: a.language, forced: "false", hi: "false", preview_only: a.preview_only });
      }
      case "bazarr_get_settings": return getSettings(client, args);
      case "bazarr_update_settings": return setSettings(client, args);
      case "bazarr_set_enabled_languages": return setLanguages(client, args);
      case "bazarr_set_language_profiles": return setProfiles(client, args);
      default: return null;
    }
  } };
}
