import { createHash, createHmac, randomBytes } from "crypto";
import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { BazarrClient } from "../bazarr.js";
import { bazarrCatalog } from "./bazarr-catalog.js";

interface Parameter {
  name: string; in: string; type: string; required?: boolean; description?: string;
  default?: unknown; enum?: readonly unknown[]; items?: { type?: string };
}
interface Operation { name: string; path: string; method: string; description: string; parameters: readonly Parameter[] }
export const operations: readonly Operation[] = bazarrCatalog;
const secretKey = /password|passwd|api.?key|token|secret|credential|authorization|cookie|username|user_name|notifications.*url|passkey|(?:^|[._-])(?:\w+_)?keys?$|postgresql.url|proxy.url/i;
const knownSecrets = new Set<string>();

export function redactBazarr(value: unknown, key = ""): unknown {
  if (secretKey.test(key)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === "string" && item.length >= 4) knownSecrets.add(item);
    }
    return value ? "[redacted]" : value;
  }
  if (Array.isArray(value)) return value.map(item => redactBazarr(item, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactBazarr(v, `${key}.${k}`)]));
  }
  if (typeof value === "string") {
    let text = value.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@");
    text = text.replace(/([?&](?:apikey|api_key|token|password)=)[^&\s]+/gi, "$1[redacted]");
    for (const secret of knownSecrets) text = text.split(secret).join("[redacted]");
    return text;
  }
  return value;
}
const output = (value: unknown) => JSON.stringify(redactBazarr(value));
const revisionKey = randomBytes(32);
const digest = (value: unknown) => createHmac("sha256", revisionKey).update(JSON.stringify(value)).digest("hex");
const fileSchema = z.object({ filename: z.string().regex(/^[\w .-]+\.(srt|ass|ssa|vtt|sub)$/i), content: z.string().min(1).max(2_000_000) }).strict();

function parameterSchema(p: Parameter): z.ZodTypeAny {
  let schema: z.ZodTypeAny;
  if (p.type === "file") schema = fileSchema;
  else if (p.type === "array") schema = z.array(p.items?.type === "integer" ? z.number().int().positive() : z.string().max(4096)).max(100);
  else if (p.type === "integer") schema = z.number().int();
  else if (p.type === "number") schema = z.number().finite();
  else if (p.type === "boolean") schema = z.boolean();
  else schema = z.string().max(100_000);
  if (p.enum) schema = schema.refine(v => p.enum!.includes(v), "Unsupported value");
  if (p.name === "length") return z.number().int().min(1).max(100).default(50);
  if (p.name === "start") return z.number().int().min(0).default(0);
  if (p.required) return schema;
  if (p.default !== undefined && p.default !== null) return schema.default(p.default);
  return schema.optional();
}
export function operationSchema(op: Operation) {
  const shape: Record<string, z.ZodTypeAny> = Object.fromEntries(op.parameters.map(p => [p.name, parameterSchema(p)]));
  if (["bazarr_post_movies", "bazarr_post_series"].includes(op.name)) {
    shape[op.name === "bazarr_post_movies" ? "radarrid" : "seriesid"] = z.array(z.number().int().positive()).min(1).max(100);
    shape.profileid = z.array(z.union([z.number().int().positive(), z.string().regex(/^(?:[1-9]\d*|none)$/)])).min(1).max(100);
  }
  if (op.method !== "GET") shape.preview_only = z.boolean().default(true);
  return z.object(shape).strict();
}
function operationTool(op: Operation): Tool {
  const properties: Record<string, object> = {};
  for (const p of op.parameters) {
    if (p.type === "file") {
      properties[p.name] = { type: "object", properties: { filename: { type: "string" }, content: { type: "string", maxLength: 2_000_000, description: "Subtitle file text; never a local filesystem path." } }, required: ["filename", "content"], additionalProperties: false };
    } else {
      const { name, in: location, required, ...schema } = p;
      properties[name] = { ...schema, ...(name === "length" ? { default: 50, minimum: 1, maximum: 100 } : {}), ...(name === "start" ? { minimum: 0 } : {}) };
    }
  }
  const required = op.parameters.filter(p => p.required).map(p => p.name);
  let guidance = "";
  if (["bazarr_post_movies", "bazarr_post_series"].includes(op.name)) {
    const id = op.name === "bazarr_post_movies" ? "radarrid" : "seriesid";
    properties[id] = { type: "array", items: { type: "integer", minimum: 1 }, minItems: 1, maxItems: 100 };
    properties.profileid = { type: "array", items: { anyOf: [{ type: "integer", minimum: 1 }, { type: "string", pattern: "^(?:[1-9][0-9]*|none)$" }] }, minItems: 1, maxItems: 100 };
    required.push(id, "profileid");
    guidance = ` Supply equally sized ${id} and profileid arrays, one numeric profile ID per media ID. Repeat the profile ID to apply it to multiple items. Read bazarr_get_language_profiles first.`;
  }
  if (["bazarr_get_providers_movies", "bazarr_get_providers_episodes"].includes(op.name)) guidance = ` Searches subtitles for ONE ${op.name.endsWith("movies") ? "movie; supply radarrid" : "episode; supply episodeid"}. To inspect provider health use bazarr_get_providers instead.`;
  if (op.method !== "GET") properties.preview_only = { type: "boolean", default: true, description: "Preview by default. Apply only when authorized." };
  return { name: op.name, description: `${op.description}. ${op.method === "GET" ? "Read Bazarr API data." : "Preview by default. Affects Bazarr state or subtitle files; apply only when authorized."} IDs are Sonarr/Radarr IDs, not TVDB/TMDB IDs.${guidance}`, inputSchema: { type: "object", properties, required, additionalProperties: false }, annotations: { readOnlyHint: op.method === "GET", destructiveHint: op.method !== "GET" } };
}

async function profileIds(client: BazarrClient): Promise<Set<number>> {
  const profiles = z.array(z.object({ profileId: z.number().int().positive() }).passthrough())
    .parse(await client.get("/api/system/languages/profiles"));
  return new Set(profiles.map(profile => profile.profileId));
}

function validProfileId(value: unknown, ids: Set<number>): boolean {
  return (typeof value === "number" || typeof value === "string" && /^\d+$/.test(value))
    && Number.isSafeInteger(Number(value)) && Number(value) > 0 && ids.has(Number(value));
}

async function requireDownloadProfile(client: BazarrClient, movie: boolean, args: Record<string, unknown>) {
  let id = movie ? args.radarrid : args.seriesid;
  if (!movie) {
    const episodes = await client.get<{ data: Array<{ sonarrEpisodeId: number; sonarrSeriesId: number }> }>("/api/episodes", { "episodeid[]": [args.episodeid] });
    const episode = episodes.data.find(row => row.sonarrEpisodeId === args.episodeid);
    if (!episode || id !== undefined && episode.sonarrSeriesId !== id) throw new Error("Episode not found or series ID does not match the episode.");
    id = episode.sonarrSeriesId;
  }
  const media = await client.get<{ data: Array<{ radarrId?: number; sonarrSeriesId?: number; profileId: number | null }> }>(
    movie ? "/api/movies" : "/api/series", { [movie ? "radarrid[]" : "seriesid[]"]: [id], start: 0, length: 1 });
  const item = media.data.find(row => (movie ? row.radarrId : row.sonarrSeriesId) === id);
  if (!item) throw new Error("Media not found in Bazarr.");
  if (!validProfileId(item.profileId, await profileIds(client))) {
    throw new Error("No valid language profile is assigned to this media. Assign an existing numeric profile ID using bazarr_post_movies or bazarr_post_series before downloading. Default profiles do not assign existing media.");
  }
}

export async function runOperation(client: BazarrClient, op: Operation, input: Record<string, unknown>): Promise<string> {
  const args = operationSchema(op).parse(input);
  const actionChoices = op.path === "/api/providers" ? ["reset"] : op.path === "/api/system/jobs" && op.method === "POST" ? ["force_start", "move_top", "move_bottom"] : undefined;
  if (actionChoices && op.method !== "GET" && !actionChoices.includes(String(args.action))) throw new Error("Unsupported action.");
  if (op.path.endsWith("/blacklist") && op.method === "DELETE" && args.all !== "true" && !(args.provider && args.subs_id)) throw new Error("Provide provider and subs_id, or all=true to explicitly clear the blacklist.");
  if ((op.path === "/api/movies" || op.path === "/api/series") && op.method === "POST") {
    const ids = args[op.path.endsWith("movies") ? "radarrid" : "seriesid"] as unknown[];
    const profiles = args.profileid as unknown[];
    if (!ids?.length || ids.length !== profiles?.length) throw new Error("Supply equally sized, nonempty media ID and profile ID arrays.");
    const available = await profileIds(client);
    if (profiles.some(id => id !== "none" && !validProfileId(id, available))) throw new Error("Use an existing numeric language profile ID, not its name; use none only to explicitly unassign.");
  }
  if ((op.method === "PATCH" && ["/api/movies/subtitles", "/api/episodes/subtitles"].includes(op.path)) ||
      (op.method === "POST" && ["/api/providers/movies", "/api/providers/episodes"].includes(op.path))) {
    await requireDownloadProfile(client, op.path.includes("movies"), args);
  }
  if (op.path === "/api/subtitles" && op.method === "PATCH") {
    if (args.action === "extract" ? !args.subtitles_id : !args.path) throw new Error("Extraction requires subtitles_id; other actions require path from Bazarr's subtitle inventory.");
  }
  if (op.method !== "GET" && args.preview_only !== false) {
    const preview = { ...args };
    if (preview.file) { const f = preview.file as { filename: string; content: string }; preview.file = { filename: f.filename, bytes: Buffer.byteLength(f.content), sha256: createHash("sha256").update(f.content).digest("hex") }; }
    return output({ preview: true, method: op.method, endpoint: op.path, arguments: preview });
  }
  const query: Record<string, unknown> = {};
  let multipart: FormData | undefined;
  for (const p of op.parameters) {
    const value = args[p.name];
    if (value === undefined) continue;
    if (p.type === "file") {
      const f = value as { filename: string; content: string };
      multipart = new FormData();
      multipart.append(p.name, new Blob([f.content], { type: "text/plain" }), f.filename);
    } else query[p.name] = value;
  }
  if (op.path === "/api/system/logs") redactBazarr(await client.get("/api/system/settings"));
  const result = await client.request(op.method, op.path, query, multipart);
  return output({ accepted: op.method !== "GET", data: result, ...(args.length ? { start: args.start ?? 0, length: args.length } : {}) });
}

const scalar = z.union([z.string(), z.number().finite(), z.boolean()]);
export const settingsSchema = z.object({ changes: z.record(z.union([scalar, z.array(scalar).max(100)])).refine(v => Object.keys(v).length > 0 && Object.keys(v).length <= 100), expected_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(), preview_only: z.boolean().default(true) }).strict();
export const languagesSchema = z.object({ languages: z.array(z.string().regex(/^[a-z]{2,3}$/)).min(1).max(100), expected_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(), preview_only: z.boolean().default(true) }).strict();
const profile = z.object({ profileId: z.number().int().positive(), name: z.string().min(1), cutoff: z.union([z.number().int(), z.string(), z.null()]), items: z.array(z.object({ id: z.number().int(), language: z.string(), forced: z.string(), hi: z.string(), audio_exclude: z.enum(["True", "False"]).default("False"), audio_only_include: z.enum(["True", "False"]).default("False") }).strict()).min(1), mustContain: z.array(z.string()), mustNotContain: z.array(z.string()), originalFormat: z.union([z.number(), z.string(), z.boolean(), z.null()]), tag: z.string().nullable().optional() }).strict();
export const profilesSchema = z.object({ profiles: z.array(profile).max(100), expected_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(), preview_only: z.boolean().default(true) }).strict();

export async function getSettings(client: BazarrClient, args: Record<string, unknown>) {
  const { section } = z.object({ section: z.string().optional() }).strict().parse(args);
  const settings = await client.get<Record<string, unknown>>("/api/system/settings");
  redactBazarr(settings);
  const available_sections = Object.keys(settings).sort();
  if (section && !Object.hasOwn(settings, section)) throw new Error(`Unknown section. Available sections: ${available_sections.join(", ")}. Use bazarr_get_providers for provider health.`);
  return output({ settings: section ? settings[section] : settings, available_sections, expected_hash: digest(settings) });
}
export async function setSettings(client: BazarrClient, input: Record<string, unknown>) {
  const args = settingsSchema.parse(input);
  const current = await client.get<Record<string, Record<string, unknown>>>("/api/system/settings");
  redactBazarr(current);
  for (const kind of ["movie", "serie"]) {
    const profileKey = `settings-general-${kind}_default_profile`;
    const enabledKey = `settings-general-${kind}_default_enabled`;
    if (!Object.hasOwn(args.changes, profileKey) && !Object.hasOwn(args.changes, enabledKey)) continue;
    const value = args.changes[profileKey] ?? current.general?.[`${kind}_default_profile`];
    const enabled = args.changes[enabledKey] ?? current.general?.[`${kind}_default_enabled`];
    const disabled = enabled === false || enabled === "false";
    if (disabled && !Object.hasOwn(args.changes, profileKey)) continue;
    if (disabled && value === "") continue;
    if (!validProfileId(value, await profileIds(client))) throw new Error(`${profileKey} requires an existing numeric profile ID, not a profile name. Read bazarr_get_language_profiles first.`);
  }
  const form = new URLSearchParams();
  const before: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args.changes)) {
    const match = /^settings-([a-zA-Z0-9_]+)-([a-zA-Z0-9_]+)$/.exec(key);
    if (!match || !Object.hasOwn(current[match[1]] ?? {}, match[2])) throw new Error("Use existing settings-SECTION-KEY names from bazarr_get_settings; languages and profiles use dedicated tools.");
    if (JSON.stringify(value).includes("[redacted")) throw new Error("Do not write redacted placeholders back to settings.");
    before[key] = current[match[1]][match[2]];
    const values = Array.isArray(value) ? value : [value];
    for (const item of values.length ? values : [""]) form.append(key, String(item));
  }
  const hash = digest(current);
  if (args.preview_only) return output({ preview: true, before, changes: args.changes, expected_hash: hash, note: "Some settings restart connections or schedule jobs. Secrets are redacted." });
  if (args.expected_hash !== hash) throw new Error("Settings changed or expected_hash is missing. Preview again before applying.");
  await client.post("/api/system/settings", form);
  return getSettings(client, {});
}
export async function setLanguages(client: BazarrClient, input: Record<string, unknown>) {
  const args = languagesSchema.parse(input);
  const available = await client.get<unknown>("/api/system/languages");
  const rows = Array.isArray(available) ? available : (available as { data: unknown[] }).data;
  const codes = new Set((rows as Array<{ code2: string }>).map(row => row.code2));
  if (args.languages.some(code => !codes.has(code))) throw new Error("Unknown language code. Use bazarr_get_system_languages.");
  if (args.preview_only) return output({ preview: true, current: rows, enabled_languages: args.languages, expected_hash: digest(rows), note: "Replaces enabled language list; profile assignments are unchanged." });
  const form = new URLSearchParams();
  if (args.expected_hash !== digest(rows)) throw new Error("Enabled languages changed or expected_hash is missing. Preview again.");
  args.languages.forEach(code => form.append("languages-enabled", code));
  await client.post("/api/system/settings", form);
  return output(await client.get("/api/system/languages"));
}
export async function setProfiles(client: BazarrClient, input: Record<string, unknown>) {
  const args = profilesSchema.parse(input);
  if (new Set(args.profiles.map(p => p.profileId)).size !== args.profiles.length) throw new Error("Duplicate profile IDs.");
  const current = await client.get<unknown>("/api/system/languages/profiles");
  const existing = Array.isArray(current) ? current : (current as { data: unknown[] }).data;
  const retained = new Set(args.profiles.map(p => p.profileId));
  const removed = (existing as Array<{ profileId: number }>).filter(p => !retained.has(p.profileId));
  if (removed.length) {
    for (const endpoint of ["/api/movies", "/api/series"]) {
      for (let start = 0; ; start += 100) {
        const page = await client.get<{ data: Array<{ profileId: number }> }>(endpoint, { start, length: 100 });
        if (page.data.some(item => removed.some(p => p.profileId === item.profileId))) throw new Error("A removed profile is still assigned to media. Reassign it first.");
        if (page.data.length < 100) break;
        if (start >= 100_000) throw new Error("Profile reference scan exceeded its limit; no changes made.");
      }
    }
  }
  for (const p of args.profiles) {
    if (p.items.some(item => !["True", "False", "true", "false"].includes(item.forced) || !["True", "False", "true", "false"].includes(item.hi))) throw new Error("Profile forced/hi flags must be True or False strings.");
    if (p.cutoff !== null && p.cutoff !== "None" && !p.items.some(item => String(item.id) === String(p.cutoff))) throw new Error("Profile cutoff must reference an item ID or be null.");
  }
  const hash = digest(current);
  if (args.preview_only) return output({ preview: true, current, replacement: args.profiles, expected_hash: hash, note: "Complete replacement: omitted profiles are deleted. Inspect all media references before removing any profile." });
  if (args.expected_hash !== hash) throw new Error("Profiles changed or expected_hash is missing. Preview again.");
  await client.post("/api/system/settings", new URLSearchParams({ "languages-profiles": JSON.stringify(args.profiles) }));
  return output(await client.get("/api/system/languages/profiles"));
}
export const bazarrApiTools = operations.map(operationTool);
