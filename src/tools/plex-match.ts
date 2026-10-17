import { createHash } from "crypto";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getPlexClient } from "./plex.js";

const ratingKey = z.string().regex(/^[1-9][0-9]{0,19}$/);
const queryFields = {
  rating_key: ratingKey,
  title: z.string().trim().min(1).max(200),
  year: z.number().int().min(1800).max(2200).optional(),
};
export const PlexMetadataSchema = z.object({ rating_key: ratingKey }).strict();
export const PlexMatchesSchema = z.object(queryFields).strict();
export const PlexFixMatchSchema = z.object({
  ...queryFields,
  candidate_guid: z.string().min(1).max(500),
  expected_match_digest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  preview_only: z.boolean().default(true),
}).strict().superRefine((input, ctx) => {
  if (!input.preview_only && !input.expected_match_digest) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Apply requires match_digest from a fresh preview." });
  }
});

interface Metadata {
  ratingKey: string;
  title: string;
  year?: number;
  type: string;
  guid?: string;
  Guid?: Array<{ id: string }>;
  librarySectionID?: number | string;
  Media?: Array<{ id?: string; Part?: Array<{ id?: string; file?: string; size?: number }> }>;
}
interface Library { key: string; title: string; type: string; agent?: string; language?: string }
interface Match { guid: string; name?: string; title?: string; year?: number; type?: string; score?: number }

function client() {
  const http = getPlexClient();
  http.defaults.maxRedirects = 0;
  http.defaults.maxContentLength = 2_000_000;
  return http;
}

async function context(key: string) {
  const http = client();
  const result = await http.get(`/library/metadata/${key}`, { params: { includeGuids: 1 } });
  const items: Metadata[] = result.data?.MediaContainer?.Metadata;
  if (!Array.isArray(items) || items.length !== 1 || String(items[0].ratingKey) !== key) throw new Error("Plex item identity could not be verified.");
  const item = items[0];
  if (!["movie", "show"].includes(item.type)) throw new Error("Fix Match supports movies and top-level TV shows. Select the parent show for an episode or season.");
  const libraries: Library[] = (await http.get("/library/sections")).data?.MediaContainer?.Directory;
  const library = Array.isArray(libraries) ? libraries.find(row => String(row.key) === String(item.librarySectionID)) : undefined;
  if (!library || library.type !== item.type) throw new Error("Plex library identity could not be verified.");
  return { http, item, library };
}

function identity(item: Metadata) {
  return { rating_key: String(item.ratingKey), title: item.title, year: item.year, type: item.type,
    guid: item.guid ?? null, external_ids: (item.Guid ?? []).map(row => row.id).sort(),
    media: (item.Media ?? []).map(row => ({ id: row.id, parts: (row.Part ?? []).map(part => ({ id: part.id, file: part.file, size: part.size })) })) };
}

async function candidates(current: Awaited<ReturnType<typeof context>>, input: z.infer<typeof PlexMatchesSchema>) {
  if (!current.library.agent || current.library.agent === "com.plexapp.agents.none") throw new Error("This Plex library has no metadata matching agent configured.");
  // Plex 1.43 serves candidate lookup through GET, despite the current API reference listing PUT.
  const response = await current.http.get(`/library/metadata/${input.rating_key}/matches`, { params: {
    title: input.title, ...(input.year === undefined ? {} : { year: input.year }),
    agent: current.library.agent, language: current.library.language ?? "en-US", manual: 1,
  } });
  const container = response.data?.MediaContainer;
  if (!container || (container.SearchResult !== undefined && !Array.isArray(container.SearchResult))) throw new Error("Unexpected Plex match candidates response.");
  const rows: Match[] = container.SearchResult ?? [];
  return rows.filter(row => typeof row.guid === "string" && row.guid.length <= 500 && row.type === current.item.type)
    .slice(0, 50).map(row => ({ guid: row.guid, title: row.name ?? row.title ?? "", year: row.year, type: row.type, score: row.score }));
}

export async function plexGetMetadata(input: z.infer<typeof PlexMetadataSchema>): Promise<string> {
  const current = await context(input.rating_key);
  return JSON.stringify({ item: identity(current.item), library: { key: current.library.key, title: current.library.title, agent: current.library.agent } });
}

export async function plexGetMatches(input: z.infer<typeof PlexMatchesSchema>): Promise<string> {
  const current = await context(input.rating_key);
  return JSON.stringify({ item: identity(current.item), library: current.library.title, candidates: await candidates(current, input) });
}

export async function plexFixMatch(input: z.infer<typeof PlexFixMatchSchema>): Promise<string> {
  const current = await context(input.rating_key);
  const candidate = (await candidates(current, input)).find(row => row.guid === input.candidate_guid);
  if (!candidate) throw new Error("Selected GUID is not among this item's current matching candidates. Search and preview again. Nothing changed.");
  const plan = { before: identity(current.item), library: { key: current.library.key, title: current.library.title, agent: current.library.agent }, after: candidate };
  const digest = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
  const preview = { ...plan, match_digest: digest, preview: input.preview_only, already_matched: current.item.guid === candidate.guid,
    note: "Changes the metadata identity and may refresh titles, posters and related metadata. Matching a show may update its seasons and episodes. No media files are deleted, moved or downloaded." };
  if (input.preview_only) return JSON.stringify(preview);
  if (input.expected_match_digest !== digest) throw new Error("Plex item or selected match changed. Preview again before approval. Nothing changed.");
  if (preview.already_matched) return JSON.stringify({ ...preview, submitted: false });
  let confirmed = true;
  try {
    await current.http.put(`/library/metadata/${input.rating_key}/match`, undefined, {
      params: { guid: candidate.guid, name: candidate.title, ...(candidate.year === undefined ? {} : { year: candidate.year }) },
    });
  } catch { confirmed = false; }
  let after;
  try { after = identity((await context(input.rating_key)).item); } catch {
    return JSON.stringify({ ...preview, submitted: true, request_confirmed: confirmed, verified: false,
      note: "The match may have applied. Re-read plex_get_metadata before retrying. No automatic retry was made." });
  }
  return JSON.stringify({ ...preview, submitted: true, request_confirmed: confirmed, verified: after.guid === candidate.guid, current: after,
    note: "Metadata refresh can be asynchronous. Re-read plex_get_metadata before retrying an uncertain result." });
}

const queryProperties = {
  rating_key: { type: "string", pattern: "^[1-9][0-9]{0,19}$" },
  title: { type: "string", minLength: 1, maxLength: 200, description: "Correct title or supported provider ID search, such as tmdb-19913" },
  year: { type: "integer", minimum: 1800, maximum: 2200 },
};
export const plexMatchTools: Tool[] = [
  { name: "plex_get_metadata", description: "Inspect the current metadata identity, external IDs, library and media parts for one movie or top-level TV show.",
    inputSchema: { type: "object", properties: { rating_key: queryProperties.rating_key }, required: ["rating_key"], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "plex_get_matches", description: "Find Fix Match candidates for one Plex movie or top-level TV show using its library's metadata agent. Returns exact candidate GUIDs; makes no metadata changes.",
    inputSchema: { type: "object", properties: queryProperties, required: ["rating_key", "title"], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "plex_fix_match", description: "Correct one movie or top-level TV show's metadata match using an exact GUID from plex_get_matches. Preview first, then supply match_digest as expected_match_digest. Apply requires native human approval and rechecks the current item and candidate. May refresh posters/titles and a show's child metadata. No file deletion, moves or downloads.",
    inputSchema: { type: "object", properties: { ...queryProperties, candidate_guid: { type: "string", minLength: 1, maxLength: 500 },
      expected_match_digest: { type: "string", pattern: "^[a-f0-9]{64}$" }, preview_only: { type: "boolean", default: true } },
      required: ["rating_key", "title", "candidate_guid"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false } },
];
