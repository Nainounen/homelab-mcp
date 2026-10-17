import { createHash } from "crypto";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ArrClient, getArrRecords } from "../arr.js";

const itemSchema = z.object({
  queue_id: z.number().int().positive().max(2147483647),
  expected_download_id: z.string().min(1).max(200),
}).strict();

export const queueBatchSchema = z.object({
  items: z.array(itemSchema).min(1).max(200),
  remove_from_client: z.boolean().default(false),
  retry: z.boolean().default(false),
  expected_batch_digest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  preview_only: z.boolean().default(true),
}).strict().superRefine((input, ctx) => {
  if (new Set(input.items.map(item => item.queue_id)).size !== input.items.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate queue IDs are not allowed." });
  }
  if (!input.preview_only && !input.expected_batch_digest) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Apply requires the batch_digest returned by a fresh preview." });
  }
});

interface QueueRow {
  id: number;
  downloadId?: string;
  title?: string;
  seriesId?: number;
  episodeId?: number;
  movieId?: number;
}

export function queueBatchTools(app: "sonarr" | "radarr"): Tool[] {
  return [false, true].map(blocklist => ({
    name: `${app}_${blocklist ? "blocklist_releases" : "remove_queue_items"}`,
    description: `${blocklist ? "Blocklist tracked releases and dismiss their queue rows" : "Dismiss selected stale queue rows"}. Explicit batch of 1 to 200 rows; preview first, then use batch_digest as expected_batch_digest. One human approval covers the fixed batch. Include every row sharing a download ID. File removal through the download client and replacement searches default to off. remove_from_client=true can delete downloaded files. ${blocklist ? "Only currently tracked queue releases are supported; arbitrary untracked NZBs cannot be blocklisted here." : "retry must remain false; no blocklisting."}`,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        items: { type: "array", minItems: 1, maxItems: 200, items: { type: "object", additionalProperties: false,
          properties: { queue_id: { type: "integer", minimum: 1, maximum: 2147483647 }, expected_download_id: { type: "string", minLength: 1, maxLength: 200 } }, required: ["queue_id", "expected_download_id"] } },
        remove_from_client: { type: "boolean", default: false },
        retry: { type: "boolean", default: false },
        expected_batch_digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
        preview_only: { type: "boolean", default: true },
      }, required: ["items"],
    }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  }));
}

export async function processQueueBatch(client: ArrClient, app: "sonarr" | "radarr", blocklist: boolean, input: z.infer<typeof queueBatchSchema>): Promise<string> {
  if (!blocklist && input.retry) throw new Error("retry is only supported when blocklisting releases.");
  const records = await getArrRecords<QueueRow>(client, "/queue");
  const selected = input.items.map(request => {
    const row = records.find(item => item.id === request.queue_id);
    if (!row || row.downloadId !== request.expected_download_id) throw new Error(`Queue row ${request.queue_id} is missing or changed. Inspect the queue and preview again. Nothing changed.`);
    return { queue_id: row.id, download_id: row.downloadId, title: row.title,
      series_id: row.seriesId, episode_id: row.episodeId, movie_id: row.movieId };
  }).sort((a, b) => a.queue_id - b.queue_id);
  const selectedIds = new Set(selected.map(item => item.queue_id));
  const downloadIds = new Set(selected.map(item => item.download_id));
  const omitted = records.filter(item => item.downloadId && downloadIds.has(item.downloadId) && !selectedIds.has(item.id));
  if (omitted.length) throw new Error(`These downloads also affect queue rows ${omitted.map(item => item.id).join(", ")}. Include those rows in the approved batch. Nothing changed.`);
  const options = { removeFromClient: input.remove_from_client, blocklist, skipRedownload: !input.retry, changeCategory: false };
  const batch = { app, items: selected, options };
  const digest = createHash("sha256").update(JSON.stringify(batch)).digest("hex");
  const preview = { ...batch, batch_digest: digest, preview: input.preview_only,
    note: "Removing a tracked queue row does not verify library availability. Download-client removal can delete files; retry can start replacement downloads." };
  if (input.preview_only) return JSON.stringify(preview);
  if (input.expected_batch_digest !== digest) throw new Error("Batch identity or options changed. Preview again before approval. Nothing changed.");
  let writeConfirmed = true;
  try {
    await client.deleteWithBodyOnce("/queue/bulk", { ids: selected.map(item => item.queue_id) }, options);
  } catch {
    writeConfirmed = false;
  }
  let remaining: QueueRow[];
  try { remaining = await getArrRecords<QueueRow>(client, "/queue"); } catch {
    return JSON.stringify({ ...preview, submitted: true, write_confirmed: writeConfirmed, verification_available: false,
      note: "Some or all changes may have applied. Inspect current queue and blocklist before retrying; no automatic retry was made." });
  }
  return JSON.stringify({ ...preview, submitted: true, write_confirmed: writeConfirmed, verification_available: true,
    results: selected.map(item => ({ ...item, row_removed: !remaining.some(row => row.id === item.queue_id) })),
    blocklist_verified: false, note: "Queue absence does not prove blocklist insertion, file deletion or replacement completion. Inspect current state before retrying uncertain results." });
}
