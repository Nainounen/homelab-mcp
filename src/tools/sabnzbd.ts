import { z } from "zod";
import { SabnzbdClient } from "../sabnzbd.js";

function bytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(1)} KB`;
  return `${n} B`;
}

function speed(mbps: number): string {
  if (mbps >= 1024) return `${(mbps / 1024).toFixed(1)} GB/s`;
  if (mbps >= 1) return `${mbps.toFixed(1)} MB/s`;
  return `${(mbps * 1024).toFixed(0)} KB/s`;
}

function eta(seconds: number): string {
  if (seconds <= 0) return "done";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

interface SabQueue {
  paused: boolean;
  speed: string;
  mbleft: string;
  mb: string;
  timeleft: string;
  diskspace1: string;
  slots: Array<{
    nzo_id: string;
    filename: string;
    status: string;
    mbleft: string;
    mb: string;
    percentage: string;
    timeleft: string;
    cat: string;
    priority: string;
  }>;
}

interface SabHistory {
  slots: Array<{
    nzo_id: string;
    name: string;
    status: string;
    size: string;
    completed: number;
    category: string;
    fail_message: string;
  }>;
}

export const SabDeleteSchema = z.object({
  nzo_id: z.string().describe("NZO ID of the queue item to delete"),
  delete_files: z.boolean().optional().default(false).describe("Also delete downloaded files"),
});

export const SabHistorySchema = z.object({
  limit: z.number().optional().default(20).describe("Number of history entries to return"),
});

export async function sabnzbdGetStatus(client: SabnzbdClient): Promise<string> {
  const data = await client.api<{ queue: SabQueue }>("queue");
  const q = data.queue;
  const pausedStr = q.paused ? " [PAUSED]" : "";
  const dlSpeed = parseFloat(q.speed) || 0;
  const mbLeft = parseFloat(q.mbleft) || 0;
  const mbTotal = parseFloat(q.mb) || 0;
  const lines = [
    `SABnzbd${pausedStr}`,
    `Speed: ${speed(dlSpeed / 1024)} | Remaining: ${bytes(mbLeft * 1024 * 1024)} / ${bytes(mbTotal * 1024 * 1024)} | ETA: ${q.timeleft}`,
    `Disk free: ${parseFloat(q.diskspace1).toFixed(1)} GB | Queue: ${q.slots.length} item(s)`,
  ];
  return lines.join("\n");
}

export async function sabnzbdListQueue(client: SabnzbdClient): Promise<string> {
  const data = await client.api<{ queue: SabQueue }>("queue");
  const slots = data.queue.slots;
  if (!slots.length) return "SABnzbd queue is empty.";
  return slots
    .map((s) => {
      const pct = s.percentage ? `${s.percentage}%` : "0%";
      const cat = s.cat ? ` [${s.cat}]` : "";
      return `${s.filename}${cat}\n  id:${s.nzo_id} | ${pct} | ${bytes(parseFloat(s.mbleft) * 1024 * 1024)} left | ETA: ${s.timeleft} | ${s.status}`;
    })
    .join("\n\n");
}

export async function sabnzbdGetHistory(
  client: SabnzbdClient,
  input: z.infer<typeof SabHistorySchema>
): Promise<string> {
  const data = await client.api<{ history: SabHistory }>("history", { limit: String(input.limit) });
  const slots = data.history.slots;
  if (!slots.length) return "No SABnzbd history.";
  return slots
    .map((s) => {
      const ts = new Date(s.completed * 1000).toISOString().replace("T", " ").slice(0, 16);
      const cat = s.category ? ` [${s.category}]` : "";
      const fail = s.fail_message ? ` ⚠ ${s.fail_message}` : "";
      return `${s.name}${cat} — ${s.status}${fail}\n  id:${s.nzo_id} | ${s.size} | ${ts}`;
    })
    .join("\n\n");
}

export async function sabnzbdPauseQueue(client: SabnzbdClient): Promise<string> {
  await client.api("pause");
  return "SABnzbd queue paused.";
}

export async function sabnzbdResumeQueue(client: SabnzbdClient): Promise<string> {
  await client.api("resume");
  return "SABnzbd queue resumed.";
}

export async function sabnzbdDeleteItem(
  client: SabnzbdClient,
  input: z.infer<typeof SabDeleteSchema>
): Promise<string> {
  const extra: Record<string, string> = { name: "delete", value: input.nzo_id };
  if (input.delete_files) extra["del_files"] = "1";
  await client.api("queue", extra);
  return `Deleted queue item ${input.nzo_id}${input.delete_files ? " (files removed)" : ""}.`;
}
