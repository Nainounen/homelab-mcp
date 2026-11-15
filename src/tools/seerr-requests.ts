import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { isAxiosError } from "axios";
import { SeerrClient } from "../seerr.js";
import { MEDIA_STATUS, REQUEST_STATUS } from "./seerr.js";

interface SeasonStatus { seasonNumber: number; status: number }
interface ExistingRequest { id: number; status: number; is4k?: boolean; seasons?: SeasonStatus[] }
interface MediaInfo { status?: number; seasons?: SeasonStatus[]; requests?: ExistingRequest[] }
interface SearchResult {
  id: number; mediaType: string; title?: string; name?: string;
  originalTitle?: string; originalName?: string; overview?: string;
  releaseDate?: string; firstAirDate?: string; mediaInfo?: MediaInfo;
}
interface Details {
  title?: string; name?: string; releaseDate?: string; firstAirDate?: string;
  seasons?: Array<{ seasonNumber: number; episodeCount?: number }>;
  externalIds?: { tvdbId?: number };
  keywords?: Array<{ id: number }>;
  mediaInfo?: MediaInfo;
}
interface ArrServer { is4k: boolean; isDefault: boolean; activeProfileName?: string; activeAnimeProfileName?: string }
interface CreatedRequest { id?: number; status?: number; message?: string }

const MEDIA_UNKNOWN = 1;
const MEDIA_BLOCKLISTED = 6;
const MEDIA_DELETED = 7;
const REQUEST_DECLINED = 3;
const REQUEST_FAILED = 4;
const REQUEST_COMPLETED = 5;
const ADMIN_PERMISSION = 2;
// TMDB keyword Seerr uses to route a series to the anime profile.
const ANIME_KEYWORD_ID = 210024;

export const SeerrSearchSchema = z.object({
  query: z.string().trim().min(1).max(200),
  page: z.number().int().min(1).max(50).default(1),
}).strict();

export const SeerrCreateRequestSchema = z.object({
  media_type: z.enum(["movie", "tv"]),
  tmdb_id: z.number().int().positive(),
  seasons: z.union([z.literal("all"), z.array(z.number().int().min(1).max(999)).min(1).max(100)]).optional(),
  preview_only: z.boolean().default(true),
}).strict().superRefine((input, ctx) => {
  if (input.media_type === "movie" && input.seasons !== undefined) ctx.addIssue({ code: "custom", message: "seasons applies only to tv" });
});

// Seerr answers HTTP 400 for "+" and for unescaped RFC 3986 reserved characters in the query.
function encodeQuery(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
const yearOf = (date?: string): number | undefined => (date ? Number(date.slice(0, 4)) || undefined : undefined);
// Seerr treats every media status except unknown and deleted as already handled.
const isTracked = (status?: number): boolean => status !== undefined && status !== MEDIA_UNKNOWN && status !== MEDIA_DELETED;
// Declined and completed requests do not block a new one. 4K requests are a separate track.
const isOpen = (request: ExistingRequest): boolean => !request.is4k && request.status !== REQUEST_DECLINED && request.status !== REQUEST_COMPLETED;

export async function seerrSearch(client: SeerrClient, input: z.infer<typeof SeerrSearchSchema>): Promise<string> {
  const page = await client.get<{ page: number; totalPages: number; totalResults: number; results: SearchResult[] }>(
    `/search?query=${encodeQuery(input.query)}&page=${input.page}`);
  const results = page.results.filter(row => row.mediaType === "movie" || row.mediaType === "tv").map(row => {
    const title = row.title ?? row.name;
    const original = row.originalTitle ?? row.originalName;
    return {
      media_type: row.mediaType,
      tmdb_id: row.id,
      title,
      ...(original && original !== title ? { original_title: original } : {}),
      year: yearOf(row.releaseDate ?? row.firstAirDate),
      overview: row.overview ? (row.overview.length > 140 ? `${row.overview.slice(0, 140)}...` : row.overview) : undefined,
      status: isTracked(row.mediaInfo?.status) ? MEDIA_STATUS[row.mediaInfo!.status!] ?? String(row.mediaInfo!.status) : "not requested",
    };
  });
  return JSON.stringify({ page: page.page, total_pages: page.totalPages, results });
}

async function loadDetails(client: SeerrClient, mediaType: string, tmdbId: number): Promise<Details> {
  try {
    return await client.get<Details>(`/${mediaType}/${tmdbId}`);
  } catch (error) {
    const status = isAxiosError(error) ? error.response?.status : undefined;
    if (status === 404) throw new Error(`Seerr found no ${mediaType} with TMDB ID ${tmdbId}. Check the ID and media type with seerr_search.`);
    // Seerr also answers 500 for an unknown TMDB ID, so the cause is not certain.
    if (status === 500) throw new Error(`Seerr could not load ${mediaType} TMDB ID ${tmdbId} (HTTP 500). Usually the ID or media type is wrong; check with seerr_search. If both are right, Seerr or TMDB is failing.`);
    throw error;
  }
}

async function expectedProfile(client: SeerrClient, service: "radarr" | "sonarr", anime: boolean): Promise<string | undefined> {
  try {
    const server = (await client.get<ArrServer[]>(`/settings/${service}`)).find(row => row.isDefault && !row.is4k);
    return (anime && server?.activeAnimeProfileName) || server?.activeProfileName;
  } catch { return undefined; }
}

async function approvalNote(client: SeerrClient, tv: boolean): Promise<string> {
  // Sonarr searches the whole series, not only the seasons in the request.
  const outcome = tv
    ? "Seerr monitors these seasons in Sonarr and starts a series search. Other monitored seasons with missing episodes can download too."
    : "Seerr adds it to Radarr, monitored, and starts the search and download.";
  try {
    const me = await client.get<{ permissions?: number }>("/auth/me");
    if (((me.permissions ?? 0) & ADMIN_PERMISSION) !== 0) return `Approved immediately: ${outcome}`;
  } catch { /* fall through to the neutral note */ }
  return `Approval depends on the Seerr permissions of the API key owner. Once approved: ${outcome}`;
}

export async function seerrCreateRequest(client: SeerrClient, input: z.infer<typeof SeerrCreateRequestSchema>): Promise<string> {
  const path = `/${input.media_type}/${input.tmdb_id}`;
  const details = await loadDetails(client, input.media_type, input.tmdb_id);
  const media = details.mediaInfo;
  const identity = {
    media_type: input.media_type, tmdb_id: input.tmdb_id,
    title: details.title ?? details.name, year: yearOf(details.releaseDate ?? details.firstAirDate),
  };
  const blocked = (message: string, extra: Record<string, unknown> = {}): string =>
    JSON.stringify({ preview: input.preview_only, submitted: false, requestable: false, ...identity, ...extra, message });

  if (media?.status === MEDIA_BLOCKLISTED) return blocked("This title is blocklisted in Seerr. Nothing was requested.");
  const openRequests = (media?.requests ?? []).filter(isOpen);
  let seasons: number[] | undefined;
  let skippedSeasons: Array<{ season: number; reason: string }> | undefined;

  if (input.media_type === "movie") {
    if (openRequests.length || isTracked(media?.status)) {
      const failed = openRequests.find(request => request.status === REQUEST_FAILED);
      return blocked(failed ? `Request #${failed.id} already exists and failed. Use seerr_retry_request instead.` : "Already requested or available in Seerr. Nothing was requested.", {
        media_status: MEDIA_STATUS[media?.status ?? MEDIA_UNKNOWN],
        existing_requests: openRequests.map(request => ({ request_id: request.id, status: REQUEST_STATUS[request.status] ?? request.status })),
      });
    }
  } else {
    const listed = (details.seasons ?? []).filter(season => season.seasonNumber > 0);
    const known = listed.map(season => season.seasonNumber);
    // Like the Seerr request dialog, "all" leaves out seasons that have no episodes yet.
    const wanted = input.seasons === undefined || input.seasons === "all"
      ? listed.filter(season => season.episodeCount !== 0).map(season => season.seasonNumber)
      : [...new Set(input.seasons)].sort((a, b) => a - b);
    if (!wanted.length) return blocked("This series has no season with episodes to request yet. Nothing was requested.");
    const missing = wanted.filter(number => !known.includes(number));
    if (missing.length) throw new Error(`Season ${missing.join(", ")} does not exist for this series. Known seasons: ${known.join(", ") || "none"}.`);
    // Mirror Seerr's own duplicate filter so the approved preview matches what is sent.
    const reasons = new Map<number, string>();
    for (const request of openRequests) for (const season of request.seasons ?? []) reasons.set(season.seasonNumber, `in request #${request.id} (${REQUEST_STATUS[request.status] ?? request.status})`);
    for (const season of media?.seasons ?? []) if (isTracked(season.status)) reasons.set(season.seasonNumber, MEDIA_STATUS[season.status] ?? String(season.status));
    seasons = wanted.filter(number => !reasons.has(number));
    skippedSeasons = wanted.filter(number => reasons.has(number)).map(number => ({ season: number, reason: reasons.get(number)! }));
    if (!seasons.length) return blocked("Every chosen season is already requested or available in Seerr. Nothing was requested.", { skipped_seasons: skippedSeasons });
  }

  const service = input.media_type === "movie" ? "radarr" : "sonarr";
  const anime = input.media_type === "tv" && (details.keywords ?? []).some(keyword => keyword.id === ANIME_KEYWORD_ID);
  const preview = {
    preview: true, submitted: false, requestable: true, ...identity,
    ...(seasons ? { seasons, ...(skippedSeasons?.length ? { skipped_seasons: skippedSeasons } : {}) } : {}),
    destination: service,
    // Seerr override rules or an existing Sonarr series can end up on another profile.
    default_quality_profile: await expectedProfile(client, service, anime),
    effect: await approvalNote(client, input.media_type === "tv"),
  };
  if (input.preview_only) return JSON.stringify(preview);

  const knownRequestIds = new Set((media?.requests ?? []).map(request => request.id));
  const unconfirmed = "Seerr request was not confirmed. Inspect seerr_list_requests before retrying; it may have been created.";
  // Finds the request this call created. A series match must carry exactly the seasons that were sent,
  // so a request someone else filed at the same moment is not reported as this one.
  const readBack = async (): Promise<CreatedRequest> => {
    let fresh: Details;
    try { fresh = await client.get<Details>(path); } catch { throw new Error(unconfirmed); }
    const match = (fresh.mediaInfo?.requests ?? []).find(request => !request.is4k && !knownRequestIds.has(request.id)
      && (!seasons || (request.seasons?.length === seasons.length && seasons.every(number => request.seasons!.some(season => season.seasonNumber === number)))));
    if (!match) throw new Error(unconfirmed);
    return match;
  };
  let created: CreatedRequest | undefined;
  let reconciled = false;
  try {
    created = await client.post<CreatedRequest>("/request", {
      mediaType: input.media_type, mediaId: input.tmdb_id, is4k: false,
      ...(seasons ? { seasons, tvdbId: details.externalIds?.tvdbId } : {}),
    });
  } catch (error) {
    const status = isAxiosError(error) ? error.response?.status : undefined;
    if (status && status >= 400 && status < 500) {
      const detail = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
      throw new Error(`Seerr rejected the request (HTTP ${status})${typeof detail === "string" ? `: ${detail.slice(0, 160)}` : ""}. Nothing was created.`);
    }
    // A timeout or server error can happen after the request was saved. Read back once before reporting.
    created = await readBack();
    reconciled = true;
  }
  if (!created?.id) {
    // Seerr answers 202 with a message when nothing is left to request.
    if (typeof created?.message === "string") return JSON.stringify({ ...preview, preview: false, requestable: false, message: created.message });
    // Any other success without a request ID is uncertain, so read back instead of inviting a retry.
    created = await readBack();
    reconciled = true;
  }
  return JSON.stringify({
    ...preview, preview: false, submitted: true, request_id: created.id,
    request_status: REQUEST_STATUS[created.status ?? 0] ?? created.status, reconciled_after_error: reconciled,
  });
}

export const seerrRequestTools: Tool[] = [
  {
    name: "seerr_search",
    description: "Search movies and series in Seerr by title. Returns TMDB IDs, year and the current Seerr status (not requested, pending, processing, available). Use before seerr_create_request.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 200, description: "Title to search for" },
        page: { type: "integer", minimum: 1, maximum: 50, default: 1 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "seerr_create_request",
    description: "Preview or create a Seerr request for a movie or series, using the exact TMDB ID from seerr_search. Seerr then adds it to Radarr or Sonarr with its default profile, monitored, and starts the search, so an approved request leads to a download. Defaults to preview_only: true; apply with preview_only: false and native human approval. Titles and seasons that are already requested or available are skipped. A failed request needs seerr_retry_request instead. No 4K requests.",
    inputSchema: {
      type: "object",
      properties: {
        media_type: { type: "string", enum: ["movie", "tv"] },
        tmdb_id: { type: "integer", minimum: 1, description: "Exact TMDB ID from seerr_search" },
        seasons: {
          description: "Series only: \"all\" (default, without specials) or a list of season numbers",
          anyOf: [{ type: "string", enum: ["all"] }, { type: "array", items: { type: "integer", minimum: 1 }, minItems: 1 }],
        },
        preview_only: { type: "boolean", default: true, description: "Preview without changes; set false after reviewing and obtaining approval" },
      },
      required: ["media_type", "tmdb_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
  },
];
