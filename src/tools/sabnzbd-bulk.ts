import { createHash } from "crypto";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { SabnzbdClient } from "../sabnzbd.js";

const sabIdPattern = /^(?:SABnzbd_nzo_[A-Za-z0-9_-]+|[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})$/;

export const sabBatchSchema = z.object({
  items: z.array(z.object({
    nzo_id: z.string().regex(sabIdPattern).max(200),
    expected_name: z.string().min(1).max(1000),
  }).strict()).min(1).max(200),
  delete_files: z.boolean().default(false),
  expected_batch_digest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  preview_only: z.boolean().default(true),
}).strict().superRefine((input, ctx) => {
  if (new Set(input.items.map(item => item.nzo_id)).size !== input.items.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate NZO IDs are not allowed." });
  }
  if (!input.preview_only && !input.expected_batch_digest) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Apply requires the batch_digest returned by a fresh preview." });
  }
});

interface SabRow {
  nzo_id: string;
  filename?: string;
  name?: string;
  status: string;
  cat?: string;
  category?: string;
  storage?: string;
  path?: string;
  completed?: number;
}

export const sabBatchTools: Tool[] = ["queue", "history"].map(source => ({
  name: source === "queue" ? "sabnzbd_delete_queue_items" : "sabnzbd_delete_history",
  description: `Delete an explicit batch of 1 to 200 SABnzbd ${source} items by NZO ID and expected name. Supports legacy SABnzbd_nzo_ IDs and UUID IDs. Preview first, then use batch_digest as expected_batch_digest. One native human approval covers this fixed batch. Files are preserved by default; delete_files=true can delete files. ${source === "history" ? "Only terminal Completed/Failed jobs are allowed. Entries are permanently removed from history, skipping Archive." : "Stops selected downloads. Does not blocklist releases in Sonarr or Radarr."}`,
  inputSchema: {
    type: "object", additionalProperties: false,
    properties: {
      items: { type: "array", minItems: 1, maxItems: 200, items: { type: "object", additionalProperties: false,
        properties: { nzo_id: { type: "string", pattern: sabIdPattern.source, maxLength: 200 }, expected_name: { type: "string", minLength: 1, maxLength: 1000 } }, required: ["nzo_id", "expected_name"] } },
      delete_files: { type: "boolean", default: false },
      expected_batch_digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
      preview_only: { type: "boolean", default: true },
    }, required: ["items"],
  }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
}));

async function readRows(client: SabnzbdClient, source: "queue" | "history", ids: string[]): Promise<SabRow[]> {
  const response = await client.api<{ queue?: { slots: SabRow[] }; history?: { slots: SabRow[] } }>(source, {
    nzo_ids: ids.join(","), start: "0", limit: String(ids.length), ...(source === "history" ? { archive: "0" } : {}),
  });
  const rows = response[source]?.slots;
  if (!Array.isArray(rows)) throw new Error("SABnzbd returned an invalid list. Current state cannot be verified.");
  return rows;
}

export async function deleteSabBatch(client: SabnzbdClient, source: "queue" | "history", input: z.infer<typeof sabBatchSchema>): Promise<string> {
  const ids = input.items.map(item => item.nzo_id);
  const rows = await readRows(client, source, ids);
  const selected = input.items.map(request => {
    const row = rows.find(item => item.nzo_id === request.nzo_id);
    if (!row || (source === "queue" ? row.filename : row.name) !== request.expected_name) {
      throw new Error(`SABnzbd item ${request.nzo_id} is missing or renamed. Inspect current ${source} and preview again. Nothing changed.`);
    }
    if (source === "history" && !["Completed", "Failed"].includes(row.status)) {
      throw new Error(`SABnzbd item ${request.nzo_id} is still processing. Only terminal history entries may be deleted. Nothing changed.`);
    }
    return { nzo_id: row.nzo_id, name: request.expected_name, category: row.cat ?? row.category,
      ...(source === "history" ? { status: row.status, storage: row.storage, path: row.path, completed: row.completed } : {}) };
  }).sort((a, b) => a.nzo_id.localeCompare(b.nzo_id));
  const batch = { source, items: selected, delete_files: input.delete_files };
  const digest = createHash("sha256").update(JSON.stringify(batch)).digest("hex");
  const preview = { ...batch, preview: input.preview_only, batch_digest: digest };
  if (input.preview_only) return JSON.stringify(preview);
  if (input.expected_batch_digest !== digest) throw new Error("Batch identity or options changed. Preview again before approval. Nothing changed.");
  let writeConfirmed = true;
  try {
    await client.api(source, { name: "delete", value: selected.map(item => item.nzo_id).join(","),
      del_files: input.delete_files ? "1" : "0", ...(source === "history" ? { archive: "0" } : {}) });
  } catch {
    writeConfirmed = false;
  }
  let remaining: SabRow[];
  try { remaining = await readRows(client, source, ids); } catch {
    return JSON.stringify({ ...preview, submitted: true, write_confirmed: writeConfirmed, verification_available: false,
      note: "Some or all changes may have applied. Inspect current state before retrying; no automatic retry was made." });
  }
  return JSON.stringify({ ...preview, submitted: true, write_confirmed: writeConfirmed, verification_available: true,
    results: selected.map(item => ({ ...item, entry_removed: !remaining.some(row => row.nzo_id === item.nzo_id) })),
    files_verified: false, note: "Entry removal does not verify file deletion or library availability. Inspect current state before retrying uncertain results." });
}
