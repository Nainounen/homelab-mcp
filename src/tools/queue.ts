import { z } from "zod";
import { ArrClient, getArrRecords } from "../arr.js";

export const QueueDismissSchema = z.object({
  queue_id: z.number().int().positive(),
  expected_download_id: z.string().min(1).max(200),
  preview_only: z.boolean().default(true),
}).strict();

export function queueDismissTool(app: "sonarr" | "radarr") {
  return { name: `${app}_remove_queue_item`, description: "Dismiss one stale tracked queue row. Preview by default; requires exact download ID from current queue. Never blocklists, removes from the download client, changes its category, or submits a search. Inspect the imported file first. Actual dismissal requires human approval.", inputSchema: { type: "object" as const, properties: { queue_id: { type: "integer", minimum: 1 }, expected_download_id: { type: "string", minLength: 1, maxLength: 200 }, preview_only: { type: "boolean", default: true } }, required: ["queue_id", "expected_download_id"], additionalProperties: false }, annotations: { readOnlyHint: false } };
}

export async function dismissQueueItem(client: ArrClient, input: z.infer<typeof QueueDismissSchema>): Promise<string> {
  const records = await getArrRecords<{ id: number; downloadId?: string; title?: string; status?: string; trackedDownloadState?: string }>(client, "/queue");
  const item = records.find(row => row.id === input.queue_id);
  if (!item) throw new Error("Queue row is no longer present. Nothing changed.");
  if (item.downloadId !== input.expected_download_id) throw new Error("Queue download ID changed. Inspect the current queue again.");
  if (input.preview_only) return JSON.stringify({ queue: item, preview: true, removeFromClient: false, blocklist: false, changeCategory: false });
  await client.delete(`/queue/${input.queue_id}`, { removeFromClient: false, blocklist: false, changeCategory: false, skipRedownload: true });
  const remaining = await getArrRecords<{ id: number }>(client, "/queue");
  return JSON.stringify({ queue_id: input.queue_id, submitted: true, row_removed: !remaining.some(row => row.id === input.queue_id), removeFromClient: false, blocklist: false, changeCategory: false, note: "Tracked row dismissal does not verify media availability in Plex." });
}
