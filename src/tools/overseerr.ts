import { z } from "zod";
import { OverseerrClient } from "../overseerr.js";

interface OverseerrRequest {
  id: number;
  status: number;
  type: string;
  is4k?: boolean;
  seasons?: Array<{ seasonNumber: number; status: number }>;
  media: { mediaType: string; tmdbId?: number; tvdbId?: number; title?: string;
    originalTitle?: string; status?: number; status4k?: number; externalServiceId?: number };
  requestedBy: { displayName?: string; username?: string };
  createdAt: string;
}
const REQUEST_STATUS: Record<number, string> = { 1: "pending", 2: "approved", 3: "declined", 4: "failed", 5: "completed" };
const MEDIA_STATUS: Record<number, string> = { 1: "unknown", 2: "pending", 3: "processing", 4: "partially available", 5: "available", 6: "blocklisted", 7: "deleted" };
export const OverseerrListSchema = z.object({
  filter: z.enum(["all", "pending", "approved", "declined", "available", "processing", "failed", "completed", "unavailable"]).default("all"),
  take: z.number().int().min(1).max(100).default(20),
  skip: z.number().int().min(0).default(0),
  include_titles: z.boolean().default(false),
});
export const OverseerrRequestSchema = z.object({ request_id: z.number().int().positive() });
export const OverseerrRequestActionSchema = OverseerrRequestSchema.extend({ preview_only: z.boolean().default(true) });

async function titleFor(client: OverseerrClient, req: OverseerrRequest, enrich = false): Promise<string> {
  const known = req.media.title ?? req.media.originalTitle;
  if (known) return known;
  const fallback = `${req.type} TMDB:${req.media.tmdbId ?? "missing"}`;
  if (!enrich || !req.media.tmdbId) return fallback;
  try {
    const media = await client.get<{ title?: string; name?: string }>(`/${req.type}/${req.media.tmdbId}`);
    return media.title ?? media.name ?? fallback;
  } catch { return `${fallback} (title lookup unavailable)`; }
}
function describe(req: OverseerrRequest, title: string): string {
  const mediaStatus = req.is4k ? req.media.status4k : req.media.status;
  return `[${req.id}] ${title} (${req.type}${req.is4k ? ", 4K" : ""}) | Request: ${REQUEST_STATUS[req.status] ?? req.status} | Media: ${MEDIA_STATUS[mediaStatus ?? 1] ?? mediaStatus} | by ${req.requestedBy?.displayName ?? req.requestedBy?.username ?? "unspecified"} | ${req.createdAt}`;
}
export async function overseerrListRequests(client: OverseerrClient, input: z.infer<typeof OverseerrListSchema>): Promise<string> {
  let results: OverseerrRequest[];
  let total: number;
  let partial = false;
  if (input.filter === "declined") {
    // Seerr does not implement the declined filter, so inspect bounded pages explicitly.
    const matches: OverseerrRequest[] = [];
    let scanned = 0;
    total = 0;
    while (scanned < 1000) {
      const page = await client.get<{ results: OverseerrRequest[]; pageInfo: { results: number } }>("/request", { take: 100, skip: scanned, sort: "added" });
      matches.push(...page.results.filter(r => r.status === 3));
      scanned += page.results.length;
      if (!page.results.length || scanned >= page.pageInfo.results) break;
      if (scanned >= 1000) partial = true;
    }
    total = matches.length;
    results = matches.slice(input.skip, input.skip + input.take);
  } else {
    const page = await client.get<{ results: OverseerrRequest[]; pageInfo: { results: number } }>("/request", {
      take: input.take, skip: input.skip, sort: "added", ...(input.filter === "all" ? {} : { filter: input.filter }),
    });
    results = page.results;
    total = page.pageInfo.results;
  }
  const lines: string[] = [];
  // Limit metadata lookups to four simultaneous requests.
  for (let offset = 0; offset < results.length; offset += 4) {
    lines.push(...await Promise.all(results.slice(offset, offset + 4).map(async req => describe(req, await titleFor(client, req, input.include_titles)))));
  }
  return `Showing ${results.length} of ${total} ${input.filter} requests, offset ${input.skip}.${partial ? " Partial results: scanned first 1000 requests." : ""}\n${lines.join("\n") || "No matching requests."}`;
}
export async function overseerrGetRequest(client: OverseerrClient, input: z.infer<typeof OverseerrRequestSchema>): Promise<string> {
  const req = await client.get<OverseerrRequest>(`/request/${input.request_id}`);
  return `${describe(req, await titleFor(client, req, true))}\nTMDB: ${req.media.tmdbId ?? "missing"} | TVDB: ${req.media.tvdbId ?? "missing"} | Arr ID: ${req.media.externalServiceId ?? "missing"}\nSeasons: ${req.seasons?.map(s => `${s.seasonNumber} (${REQUEST_STATUS[s.status] ?? s.status})`).join(", ") || "none"}`;
}
async function requestAction(client: OverseerrClient, input: z.infer<typeof OverseerrRequestActionSchema>, action: "approve" | "decline" | "delete" | "retry"): Promise<string> {
  const req = await client.get<OverseerrRequest>(`/request/${input.request_id}`);
  if ((action === "approve" || action === "decline") && req.status !== 1) throw new Error("Only pending requests can be approved or declined.");
  if (action === "retry" && req.status !== 4) throw new Error("Only failed requests can be retried.");
  const title = await titleFor(client, req);
  if (input.preview_only) return `Preview: ${action} request #${req.id} (${title}), currently ${REQUEST_STATUS[req.status]}. No changes made. Set preview_only=false after human approval.`;
  if (action === "delete") await client.delete(`/request/${req.id}`);
  else await client.post(`/request/${req.id}/${action}`);
  return `Seerr accepted ${action} for request #${req.id} (${title}).`;
}
export async function overseerrApproveRequest(client: OverseerrClient, input: z.infer<typeof OverseerrRequestActionSchema>): Promise<string> { return requestAction(client, input, "approve"); }
export async function overseerrDeclineRequest(client: OverseerrClient, input: z.infer<typeof OverseerrRequestActionSchema>): Promise<string> { return requestAction(client, input, "decline"); }
export async function overseerrDeleteRequest(client: OverseerrClient, input: z.infer<typeof OverseerrRequestActionSchema>): Promise<string> { return requestAction(client, input, "delete"); }
export async function overseerrRetryRequest(client: OverseerrClient, input: z.infer<typeof OverseerrRequestActionSchema>): Promise<string> { return requestAction(client, input, "retry"); }
export async function overseerrGetStats(client: OverseerrClient): Promise<string> {
  const counts = await client.get<Record<string, number>>("/request/count");
  return ["total", "pending", "approved", "declined", "processing", "available", "completed", "movie", "tv"]
    .map(key => `${key}: ${counts[key] ?? "unavailable"}`).join(" | ");
}
