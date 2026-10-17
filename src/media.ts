#!/usr/bin/env node
import dotenv from "dotenv";
import path from "path";
import { promises as fs } from "fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createSonarrClient, createRadarrClient } from "./arr.js";
import { createSabnzbdClient } from "./sabnzbd.js";
import { createOverseerrClient } from "./overseerr.js";
import { sonarrModule } from "./modules/sonarr.js";
import { radarrModule } from "./modules/radarr.js";
import { sabnzbdModule } from "./modules/sabnzbd.js";
import { seerrModule } from "./modules/seerr.js";
import { PlexFixMatchSchema } from "./tools/plex-match.js";
import { plexModule } from "./modules/plex.js";
import { redactSecrets, sanitizeError, truncateOutput } from "./utils.js";
import { createProfileSchema, editProfileSchema, deleteProfileSchema } from "./tools/quality-profiles.js";
import { seerrProfileSchema } from "./tools/seerr-profiles.js";
import { replacementDownloadSchema, replacementImportSchema, bulkReplacementImportSchema } from "./tools/radarr-replacement.js";
import { queueBatchSchema } from "./tools/queue-bulk.js";
import { sabBatchSchema } from "./tools/sabnzbd-bulk.js";
import { bulkProfileSchema } from "./tools/radarr-bulk.js";
import { createBazarrClient } from "./bazarr.js";
import { bazarrModule, bazarrTools, bazarrActionSchemas } from "./modules/bazarr.js";
import { operations as bazarrOperations, operationSchema } from "./tools/bazarr.js";
import { version } from "../package.json";

dotenv.config({ path: process.env.HOMELAB_ENV_FILE ?? path.resolve(__dirname, "..", ".env") });

// No infrastructure clients are initialized. Deploy with a media-only environment file.
const modules = [sonarrModule(createSonarrClient()), radarrModule(createRadarrClient()),
  sabnzbdModule(createSabnzbdClient()), seerrModule(createOverseerrClient()), plexModule()];
if (process.env.BAZARR_URL && process.env.BAZARR_API_KEY) modules.push(bazarrModule(createBazarrClient()));
const readOnlyTools = new Set([
  "radarr_inspect_replacement",
  "radarr_list_space_savers", "radarr_plan_downgrade",
  "sonarr_get_quality_profile", "radarr_get_quality_profile", "seerr_get_quality_profile_settings",
  "sonarr_search_series", "sonarr_list_series", "sonarr_get_command", "sonarr_get_queue",
  "sonarr_check_releases", "sonarr_interactive_search", "sonarr_list_path_mappings",
  "sonarr_list_custom_formats", "sonarr_list_languages", "sonarr_list_quality_profiles",
  "sonarr_list_episodes", "sonarr_list_episode_files",
  "radarr_search_movie", "radarr_list_movies", "radarr_get_command", "radarr_get_queue",
  "radarr_get_history", "radarr_check_releases", "radarr_interactive_search",
  "radarr_list_path_mappings", "radarr_list_custom_formats", "radarr_list_languages",
  "radarr_list_quality_profiles", "radarr_get_movie_file",
  "sabnzbd_get_status", "sabnzbd_list_queue", "sabnzbd_get_history", "sabnzbd_get_job",
  "sabnzbd_get_warnings", "sabnzbd_list_categories", "sabnzbd_list_servers",
  "sabnzbd_get_switches", "sabnzbd_get_folders", "sabnzbd_get_general",
  "seerr_stats", "seerr_list_requests", "seerr_get_request",
  "plex_get_metadata", "plex_get_matches",
  "plex_get_libraries", "plex_search", "plex_get_sessions", "plex_recently_added", "plex_get_watch_history", "plex_list_shares",
]);
const batchActionSchemas: Record<string, z.ZodTypeAny> = {
  sonarr_remove_queue_items: queueBatchSchema, sonarr_blocklist_releases: queueBatchSchema,
  radarr_remove_queue_items: queueBatchSchema, radarr_blocklist_releases: queueBatchSchema,
  sabnzbd_delete_queue_items: sabBatchSchema, sabnzbd_delete_history: sabBatchSchema,
};
const actionTools = new Set([
  ...Object.keys(batchActionSchemas),
  "radarr_bulk_import_replacements",
  "radarr_bulk_set_quality_profile",
  "radarr_download_replacement", "radarr_import_replacement",
  "sonarr_create_quality_profile", "sonarr_edit_quality_profile", "radarr_create_quality_profile", "radarr_edit_quality_profile", "seerr_set_quality_profile",
  "sonarr_delete_quality_profile", "radarr_delete_quality_profile",
  "plex_invite_user", "plex_fix_match",
  "sonarr_remove_queue_item", "radarr_remove_queue_item",
  "sonarr_refresh_series", "sonarr_rescan_series", "sonarr_set_quality_profile",
  "sonarr_grab_release", "sonarr_manual_import", "sonarr_force_search", "sonarr_season_search",
  "radarr_refresh_movie", "radarr_rescan_movie", "radarr_set_quality_profile",
  "radarr_grab_release", "radarr_manual_import", "radarr_force_search",
  "sabnzbd_pause_queue", "sabnzbd_resume_queue", "sabnzbd_pause_timed", "sabnzbd_set_speed_limit",
  "sabnzbd_set_item_priority", "sabnzbd_pause_item", "sabnzbd_resume_item", "sabnzbd_retry_item",
  "seerr_approve_request", "seerr_decline_request", "seerr_retry_request",
]);
for (const tool of bazarrTools) (tool.annotations?.readOnlyHint ? readOnlyTools : actionTools).add(tool.name);
const dispatch = new Map<string, (args: Record<string, unknown>) => Promise<string | null>>();
const tools = modules.flatMap(module => module.tools.filter(tool => readOnlyTools.has(tool.name) || (process.env.HOMELAB_READ_ONLY !== "1" && actionTools.has(tool.name))).map(tool => {
  dispatch.set(tool.name, args => module.handle(tool.name, args));
  return { ...tool, annotations: { ...tool.annotations, readOnlyHint: readOnlyTools.has(tool.name) } };
}));
tools.push({ name: "media_get_monitor_status", description: "Read the latest automatic media-delivery diagnosis snapshot, including its check time and coverage limits. Historical snapshot; verify current queue and files before proposing repairs.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } });
dispatch.set("media_get_monitor_status",async args => {
  z.object({}).strict().parse(args);
  const file = "/var/lib/homelab-mcp/media-watch.json";
  const info = await fs.stat(file);
  if (info.size > 2000000) throw new Error("Media monitoring snapshot exceeds its size limit.");
  return JSON.stringify(JSON.parse(await fs.readFile(file,"utf8")));
});
const newActionSchemas: Record<string, z.ZodTypeAny> = {
  ...batchActionSchemas,
  plex_fix_match: PlexFixMatchSchema,
  ...bazarrActionSchemas,
  ...Object.fromEntries(bazarrOperations.filter(op => op.method !== "GET").map(op => [op.name, operationSchema(op)])),
  radarr_bulk_import_replacements:bulkReplacementImportSchema,
  radarr_bulk_set_quality_profile:bulkProfileSchema,
  sonarr_create_quality_profile:createProfileSchema, radarr_create_quality_profile:createProfileSchema,
  sonarr_edit_quality_profile:editProfileSchema, radarr_edit_quality_profile:editProfileSchema,
  sonarr_delete_quality_profile:deleteProfileSchema, radarr_delete_quality_profile:deleteProfileSchema,
  seerr_set_quality_profile:seerrProfileSchema, radarr_download_replacement:replacementDownloadSchema,
  radarr_import_replacement:replacementImportSchema,
};
const server = new Server({ name: "homelab-media-mcp", version }, { capabilities: { tools: {} } });
async function checkOperationLock(): Promise<void> {
  // Client names coordinate this trusted local job; they are not authentication.
  if (server.getClientVersion()?.name === "user-authorized-encode-batch") return;
  const file = "/var/lib/homelab-mcp/media-conversion-active.json";
  let info;
  try { info = await fs.lstat(file); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error("Media operation lock cannot be checked. Writes paused; reads remain available.");
  }
  if (!info.isFile() || info.uid !== 0 || (info.mode & 0o022) !== 0 || info.size > 4096) throw new Error("Invalid media operation lock. Writes paused; reads remain available.");
  const lock = JSON.parse(await fs.readFile(file, "utf8"));
  if (!lock || typeof lock !== "object" || typeof lock.active !== "boolean") throw new Error("Invalid media operation lock. Writes paused; reads remain available.");
  if (lock.active === true) throw new Error("Codex's approved conversion batch is active. Media writes are temporarily paused for other clients; inspection and previews remain available. Do not start duplicate downloads.");
}
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  const handler = dispatch.get(request.params.name);
  if (!handler) return { content: [{ type: "text", text: "Tool is not available in the restricted media server." }], isError: true };
  try {
    const args = request.params.arguments ?? {};
    newActionSchemas[request.params.name]?.parse(args);
    const definition = tools.find(tool => tool.name === request.params.name)!;
    const hasPreview = definition.inputSchema.properties?.preview_only !== undefined;
    if (actionTools.has(request.params.name) && !(hasPreview && args.preview_only !== false)) await checkOperationLock();
    if (["sonarr_delete_quality_profile", "radarr_delete_quality_profile"].includes(request.params.name) && args.preview_only === false) {
      const preview = await handler({...args, preview_only: true});
      if (!preview || JSON.parse(preview).deletable !== true) throw new Error("Profile is still referenced. Inspect the removal preview; no changes made.");
    }
    if(["radarr_import_replacement","radarr_bulk_import_replacements"].includes(request.params.name) && args.preview_only === false){
      await handler({...args,preview_only:true});
      const acknowledgements=request.params.name === "radarr_import_replacement" ? [args] : (args.files as Array<Record<string,unknown>>);
      if(acknowledgements.some(row=>row.allow_non_upgrade !== true))throw new Error("Review the preview and acknowledge allow_non_upgrade for every replacement before requesting approval.");
    }
    if(request.params.name === "radarr_bulk_set_quality_profile" && args.preview_only === false){
      const preview=await handler({...args,preview_only:true});
      if(preview && JSON.parse(preview).changes === 0)return {content:[{type:"text",text:truncateOutput(preview)}]};
    }
    if (hasPreview && args.preview_only !== undefined && typeof args.preview_only !== "boolean") {
      throw new Error("preview_only must be a boolean.");
    }
    const batchPreview = batchActionSchemas[request.params.name] && args.preview_only === false
      ? JSON.parse((await handler({ ...args, preview_only: true })) ?? "{}") : undefined;
    if (batchPreview && batchPreview.batch_digest !== args.expected_batch_digest) {
      throw new Error("Batch changed. Preview again before requesting approval. Nothing changed.");
    }
    const matchPreview = request.params.name === "plex_fix_match" && args.preview_only === false
      ? JSON.parse((await handler({ ...args, preview_only: true })) ?? "{}") : undefined;
    if (matchPreview) {
      if (matchPreview.match_digest !== args.expected_match_digest) throw new Error("Plex match changed. Preview again before approval. Nothing changed.");
      if (matchPreview.already_matched) return { content: [{ type: "text", text: redactSecrets(JSON.stringify({ ...matchPreview, submitted: false })) }] };
    }
    if (actionTools.has(request.params.name) && !(hasPreview && args.preview_only !== false)) {
      // Approval belongs to the authenticated MCP client, never to a model argument.
      const approval = await server.elicitInput({
        mode: "form",
        message: "HOMELAB_ACTION\n" + redactSecrets(JSON.stringify({ tool: request.params.name, args: matchPreview ?? batchPreview ?? (request.params.name.startsWith("bazarr_") ? JSON.parse((await handler({ ...args, preview_only: true })) ?? "{}") : args) })),
        requestedSchema: { type: "object", properties: {} },
      }, { timeout: 300_000 });
      if (approval.action !== "accept") return { content: [{ type: "text", text: "Action denied or approval expired. No changes made." }], isError: true };
    }
    if (actionTools.has(request.params.name) && !(hasPreview && args.preview_only !== false)) await checkOperationLock();
    const result = await handler(args);
    return { content: [{ type: "text", text: truncateOutput(redactSecrets(result ?? "No result.")) }] };
  } catch (error) {
    const message = error instanceof z.ZodError ? "Invalid tool arguments." : sanitizeError(error);
    return { content: [{ type: "text", text: redactSecrets(message) }], isError: true };
  }
});
server.connect(new StdioServerTransport()).catch(error => {
  process.stderr.write(`[homelab-media-mcp] ${redactSecrets(sanitizeError(error))}\n`);
  process.exit(1);
});
