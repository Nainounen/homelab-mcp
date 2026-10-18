import { createHash, randomUUID } from "crypto";
import { constants, promises as fs } from "fs";
import path from "path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { SabnzbdClient } from "../sabnzbd.js";
import { deleteSabSelection, readSabRows, sabIdPattern, type SabRow } from "./sabnzbd-bulk.js";

export const sabClearQueueSchema = z.object({
  delete_files: z.boolean().default(false),
  expected_batch_digest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  preview_only: z.boolean().default(true),
}).strict().superRefine((input, ctx) => {
  if (!input.preview_only && !input.expected_batch_digest) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Apply requires a preview digest." });
  }
});

export const sabClearQueueTool: Tool = {
  name: "sabnzbd_clear_queue",
  description: "Clear the queue snapshot reviewed in one native approval. Preview without a digest to capture up to 5000 jobs; apply using its batch_digest as expected_batch_digest within one hour. Internal chunks need no extra approvals. Already removed jobs are skipped, new arrivals excluded, renamed jobs refused. Queue must remain globally paused when applying. Files preserved by default; delete_files=true can delete download data. Does not clear history, cancel post-processing, blocklist releases, or prevent Sonarr/Radarr from adding new jobs. Stops on uncertain API outcomes; never automatically repeats a delete.",
  inputSchema: { type: "object", additionalProperties: false, properties: {
    delete_files: { type: "boolean", default: false },
    expected_batch_digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
    preview_only: { type: "boolean", default: true },
  } },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
};

const snapshotSchema = z.object({
  version: z.literal(1), nonce: z.string().uuid(), created: z.number().int(),
  delete_files: z.boolean(),
  items: z.array(z.object({ nzo_id: z.string().regex(sabIdPattern).max(200), name: z.string().min(1).max(1000) }).strict()).max(5000),
}).strict();
const snapshotDirectory = () => process.env.HOMELAB_SAB_SNAPSHOT_DIR ?? "/var/lib/homelab-mcp/sab-queue-previews";

async function checkDirectory(): Promise<string> {
  const directory = snapshotDirectory();
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
    throw new Error("SAB snapshot directory must be a private directory owned by this service.");
  }
  return directory;
}

async function captureQueue(client: SabnzbdClient): Promise<SabRow[]> {
  // Capture membership in one API response; offset pagination can shift during arrivals/removals.
  const response = await client.api<{ queue: { slots: SabRow[]; noofslots: number } }>("queue", { start: "0", limit: "5000" });
  const queue = response.queue;
  if (!queue || !Array.isArray(queue.slots) || !Number.isInteger(queue.noofslots) || queue.noofslots < 0 || queue.noofslots > 5000) {
    throw new Error("Queue cannot be captured safely, or exceeds 5000 jobs. Nothing changed.");
  }
  const rows = queue.slots;
  if (rows.length !== queue.noofslots || new Set(rows.map(row => row.nzo_id)).size !== rows.length) {
    throw new Error("Queue preview was incomplete or changed during capture. Preview again. Nothing changed.");
  }
  return rows;
}

export async function clearSabQueue(client: SabnzbdClient, input: z.infer<typeof sabClearQueueSchema>): Promise<string> {
  const directory = await checkDirectory();
  let snapshot: z.infer<typeof snapshotSchema>;
  let digest = input.expected_batch_digest;
  if (digest) {
    const file = await fs.open(path.join(directory, digest + ".json"), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.size > 8_000_000) {
        throw new Error("Invalid SAB queue snapshot.");
      }
      const raw = await file.readFile("utf8");
      if (createHash("sha256").update(raw).digest("hex") !== digest) throw new Error("SAB queue snapshot digest mismatch.");
      snapshot = snapshotSchema.parse(JSON.parse(raw));
    } finally { await file.close(); }
    if (snapshot.delete_files !== input.delete_files) throw new Error("File deletion option changed. Create a new preview. Nothing changed.");
    if (Date.now() - snapshot.created > 3_600_000 || snapshot.created > Date.now()) throw new Error("Queue preview expired. Preview again. Nothing changed.");
  } else {
    const rows = await captureQueue(client);
    snapshot = snapshotSchema.parse({ version: 1, nonce: randomUUID(), created: Date.now(), delete_files: input.delete_files,
      items: rows.map(row => ({ nzo_id: row.nzo_id, name: row.filename })).sort((a, b) => a.nzo_id.localeCompare(b.nzo_id)) });
    const raw = JSON.stringify(snapshot);
    digest = createHash("sha256").update(raw).digest("hex");
    await fs.writeFile(path.join(directory, digest + ".json"), raw, { flag: "wx", mode: 0o600 });
  }
  // Revalidate identities before approval and again inside each mutation chunk.
  let present = 0;
  for (let offset = 0; offset < snapshot.items.length; offset += 100) {
    const selected = snapshot.items.slice(offset, offset + 100);
    const rows = await readSabRows(client, "queue", selected.map(item => item.nzo_id));
    for (const item of selected) {
      const row = rows.find(row => row.nzo_id === item.nzo_id);
      if (row && row.filename !== item.name) throw new Error("A snapshot job was renamed. Create a new preview. Nothing changed.");
      if (row) present++;
    }
  }
  const preview = { operation: "clear_queue_snapshot", batch_digest: digest, preview: input.preview_only,
    delete_files: snapshot.delete_files, captured_count: snapshot.items.length, currently_present: present,
    already_absent: snapshot.items.length - present, created_at: new Date(snapshot.created).toISOString(),
    sample_items: snapshot.items.slice(0, 20), new_arrivals_excluded: true,
    note: "Approval covers only captured IDs and names, not later arrivals. Global queue pause is required when applying. Files preserved unless delete_files=true; post-processing and history are outside this operation." };
  if (input.preview_only) return JSON.stringify(preview);
  const result = await deleteSabSelection(client, "queue", snapshot.items, input.delete_files, true, true);
  return JSON.stringify({ ...preview, ...result });
}
