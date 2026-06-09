import { z } from "zod";
import { OverseerrClient } from "../overseerr.js";

interface OverseerrRequest {
  id: number;
  status: number;
  type: string;
  media: {
    mediaType: string;
    tmdbId?: number;
    tvdbId?: number;
    title?: string;
    originalTitle?: string;
  };
  requestedBy: { displayName: string; email?: string };
  createdAt: string;
}

interface OverseerrCount {
  total: number;
  movie: number;
  tv: number;
  pending: number;
  approved: number;
  declined: number;
  processing: number;
  available: number;
}

const STATUS_MAP: Record<number, string> = {
  1: "pending",
  2: "approved",
  3: "declined",
  4: "available",
  5: "processing",
};

export const OverseerrListSchema = z.object({
  filter: z.enum(["all", "pending", "approved", "declined", "available", "processing"])
    .optional().default("all"),
  take: z.number().optional().default(20),
});

export const OverseerrRequestActionSchema = z.object({
  request_id: z.number().describe("Request ID from overseerr_list_requests"),
});

export async function overseerrListRequests(
  client: OverseerrClient,
  input: z.infer<typeof OverseerrListSchema>
): Promise<string> {
  const params: Record<string, unknown> = { take: input.take, sort: "added" };
  if (input.filter !== "all") params.filter = input.filter;

  const r = await client.get<{ results: OverseerrRequest[]; pageInfo: { results: number } }>("/request", params);
  if (!r.results.length) return `No ${input.filter} requests.`;

  return r.results
    .map((req) => {
      const title = req.media.title ?? req.media.originalTitle ?? "Unknown";
      const status = STATUS_MAP[req.status] ?? `status:${req.status}`;
      const date = new Date(req.createdAt).toLocaleDateString();
      return `[${req.id}] ${title} (${req.type}) — ${status} | by ${req.requestedBy.displayName} on ${date}`;
    })
    .join("\n");
}

export async function overseerrApproveRequest(
  client: OverseerrClient,
  input: z.infer<typeof OverseerrRequestActionSchema>
): Promise<string> {
  const r = await client.post<OverseerrRequest>(`/request/${input.request_id}/approve`);
  const title = r.media.title ?? "Unknown";
  return `Approved request #${input.request_id} for "${title}".`;
}

export async function overseerrDeclineRequest(
  client: OverseerrClient,
  input: z.infer<typeof OverseerrRequestActionSchema>
): Promise<string> {
  const r = await client.post<OverseerrRequest>(`/request/${input.request_id}/decline`);
  const title = r.media.title ?? "Unknown";
  return `Declined request #${input.request_id} for "${title}".`;
}

export async function overseerrDeleteRequest(
  client: OverseerrClient,
  input: z.infer<typeof OverseerrRequestActionSchema>
): Promise<string> {
  await client.delete(`/request/${input.request_id}`);
  return `Deleted request #${input.request_id}.`;
}

export async function overseerrGetStats(client: OverseerrClient): Promise<string> {
  const counts = await client.get<OverseerrCount>("/request/count");
  return (
    `Total: ${counts.total} | Pending: ${counts.pending} | Approved: ${counts.approved}\n` +
    `Processing: ${counts.processing} | Available: ${counts.available} | Declined: ${counts.declined}\n` +
    `Movies: ${counts.movie} | TV: ${counts.tv}`
  );
}
