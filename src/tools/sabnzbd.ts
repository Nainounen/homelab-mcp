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

interface SabQueue {
  paused: boolean;
  speed: string;
  kbpersec?: string;
  noofslots_total?: number;
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
    storage?: string;
    path?: string;
    stage_log?: unknown;
  }>;
}

// ─── Existing schemas ────────────────────────────────────────────────────────

export const SabDeleteSchema = z.object({
  nzo_id: z.string().describe("NZO ID of the queue item to delete"),
  delete_files: z.boolean().optional().default(false).describe("Also delete downloaded files"),
});

export const SabQueueSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  start: z.number().int().min(0).default(0),
  category: z.string().optional(),
  search: z.string().optional(),
  nzo_id: z.string().min(1).optional(),
});
export const SabHistorySchema = SabQueueSchema.extend({ failed_only: z.boolean().default(false) });
export const SabJobSchema = z.object({ nzo_id: z.string().min(1) });

function listParams(input: z.infer<typeof SabQueueSchema>): Record<string, string> {
  const params: Record<string, string> = { limit: String(input.limit), start: String(input.start) };
  if (input.category !== undefined) params.cat = input.category;
  if (input.search !== undefined) params.search = input.search;
  if (input.nzo_id !== undefined) params.nzo_ids = input.nzo_id;
  return params;
}

// ─── Queue control schemas ────────────────────────────────────────────────────

export const SabSpeedLimitSchema = z.object({
  limit: z.union([z.string().regex(/^(?:\d+(?:\.\d+)?[KM]|(?:100|\d{1,2})%|0)$/i), z.number().nonnegative().finite()]).describe(
    "Speed in MB/s (0 = unlimited) or a percentage string like '50%'"
  ),
});

export const SabPauseTimedSchema = z.object({
  minutes: z.number().int().min(1).describe("Minutes to pause before auto-resuming"),
});

export const SabItemPrioritySchema = z.object({
  nzo_id: z.string().describe("NZO ID from sabnzbd_list_queue"),
  priority: z
    .enum(["force", "high", "normal", "low", "paused"])
    .describe("force > high > normal > low; paused = hold item without removing it"),
});

export const SabItemActionSchema = z.object({
  nzo_id: z.string().describe("NZO ID from sabnzbd_list_queue"),
});

export const SabRetrySchema = z.object({
  nzo_id: z.string().describe("NZO ID of a failed item from sabnzbd_get_history"),
});

export const SabClearHistorySchema = z.object({
  target: z.enum(["all", "failed"]).default("all").describe("Clear all history or only failed items"),
  nzo_id: z.string().optional().describe("Remove a specific item by NZO ID (overrides target)"),
});

// ─── Category schemas ─────────────────────────────────────────────────────────

export const SabCategorySetSchema = z.object({
  name: z.string().describe("Category name (creates if new, updates if exists)"),
  dir: z.string().optional().describe("Download path relative to complete_dir, or absolute"),
  pp: z
    .string()
    .optional()
    .describe("Post-processing: '' = default, '0' = skip, '1' = repair, '2' = unpack, '3' = delete"),
  script: z.string().optional().describe("Script filename in script_dir, 'Default', or 'None'"),
  priority: z
    .number()
    .optional()
    .describe("Priority: -2 = paused, -1 = low, 0 = normal, 1 = high, 2 = force"),
  newzbin: z.string().optional().describe("Newzbin category tags (comma-separated)"),
});

export const SabCategoryDeleteSchema = z.object({
  name: z.string().describe("Exact category name to delete"),
});

// ─── Server schemas ───────────────────────────────────────────────────────────

export const SabServerSetSchema = z.object({
  name: z.string().describe("Server identifier key (use existing name to edit, new name to add)"),
  host: z.string().optional().describe("Usenet server hostname or IP"),
  port: z.number().optional().describe("Port number (119 plain, 563 SSL)"),
  username: z.string().optional(),
  password: z.string().optional(),
  connections: z.number().optional().describe("Max simultaneous connections"),
  ssl: z.boolean().optional().describe("Enable SSL/TLS"),
  ssl_verify: z.number().optional().describe("SSL verification: 0 = off, 1 = minimal, 2 = strict"),
  enable: z.boolean().optional().describe("Enable this server"),
  priority: z.number().optional().describe("Server priority (0 = highest; higher number = lower priority)"),
  retention: z.number().optional().describe("Retention in days (0 = unlimited)"),
  required: z.boolean().optional().describe("Fail the download if this server is unavailable"),
  optional: z.boolean().optional().describe("Skip this server if unavailable without failing the download"),
  timeout: z.number().optional().describe("Connection timeout in seconds"),
  send_group: z.boolean().optional().describe("Send GROUP command before each article request"),
});

export const SabServerDeleteSchema = z.object({
  name: z.string().describe("Server name to delete"),
});

// ─── Config schemas ───────────────────────────────────────────────────────────

export const SabSetSwitchSchema = z.object({
  key: z.string().refine(key => SWITCH_KEYS.includes(key), "Unsupported switch key").describe(
    "Switch name from sabnzbd_get_switches, e.g. 'direct_unpack', 'pre_check', 'top_only', 'auto_disconnect', 'pause_on_post_processing', 'no_dupes'"
  ),
  value: z
    .union([z.string(), z.number(), z.boolean()])
    .describe("Value to set | booleans are accepted as true/false or 1/0"),
});

export const SabSetFolderSchema = z.object({
  key: z
    .enum(["download_dir", "complete_dir", "nzb_backup_dir", "admin_dir", "dirscan_dir", "script_dir", "log_dir"])
    .describe("Folder key to update"),
  path: z.string().describe("Absolute path"),
});

export const SabSetGeneralSchema = z.object({
  key: z.string().refine(key => GENERAL_KEYS.includes(key), "Unsupported general setting key").describe(
    "Setting key from sabnzbd_get_general, e.g. 'bandwidth_perc', 'bandwidth_max', 'refresh_rate', 'language', 'host', 'port'"
  ),
  value: z.union([z.string(), z.number()]).describe("New value"),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_MAP: Record<string, string> = {
  force: "2",
  high: "1",
  normal: "0",
  low: "-1",
  paused: "-2",
};

const SWITCH_KEYS = [
  "direct_unpack",
  "pre_check",
  "pause_on_post_processing",
  "top_only",
  "auto_disconnect",
  "enable_all_par",
  "no_dupes",
  "deobfuscate_final_filenames",
  "ignore_unrar_dates",
  "flat_unpack",
  "ssl_verify",
  "safe_postproc",
  "fail_hopeless_jobs",
];

const FOLDER_KEYS = [
  "download_dir",
  "complete_dir",
  "nzb_backup_dir",
  "admin_dir",
  "dirscan_dir",
  "script_dir",
  "log_dir",
];

const FOLDER_LABELS: Record<string, string> = {
  download_dir: "Temporary (incomplete)",
  complete_dir: "Completed",
  nzb_backup_dir: "NZB backup",
  admin_dir: "Admin",
  dirscan_dir: "Watched folder",
  script_dir: "Scripts",
  log_dir: "Logs",
};

const GENERAL_KEYS = ["host", "port", "bandwidth_perc", "bandwidth_max", "refresh_rate", "language", "username"];

const GENERAL_LABELS: Record<string, string> = {
  host: "Host",
  port: "Port",
  bandwidth_perc: "Bandwidth limit %",
  bandwidth_max: "Max bandwidth (MB/s, 0=unlimited)",
  refresh_rate: "Web UI refresh rate (s)",
  language: "Language",
  username: "Web UI username",
};

// ─── Existing implementations ─────────────────────────────────────────────────

export async function sabnzbdGetStatus(client: SabnzbdClient): Promise<string> {
  const data = await client.api<{ queue: SabQueue }>("queue");
  const q = data.queue;
  const pausedStr = q.paused ? " [PAUSED]" : "";
  const dlSpeed = parseFloat(q.kbpersec ?? "0") || 0;
  const mbLeft = parseFloat(q.mbleft) || 0;
  const mbTotal = parseFloat(q.mb) || 0;
  return [
    `SABnzbd${pausedStr}`,
    `Speed: ${speed(dlSpeed / 1024)} | Remaining: ${bytes(mbLeft * 1024 * 1024)} / ${bytes(mbTotal * 1024 * 1024)} | ETA: ${q.timeleft}`,
    `Disk free: ${parseFloat(q.diskspace1).toFixed(1)} GB | Queue: ${q.noofslots_total ?? q.slots.length} item(s)`,
  ].join("\n");
}

export async function sabnzbdListQueue(client: SabnzbdClient, input = SabQueueSchema.parse({})): Promise<string> {
  const data = await client.api<{ queue: SabQueue }>("queue", listParams(input));
  const slots = data.queue.slots;
  if (!slots.length) return "SABnzbd queue is empty.";
  return `Showing ${slots.length} queue items at offset ${input.start}.\n` + slots
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
  const data = await client.api<{ history: SabHistory }>("history", { ...listParams(input), failed_only: input.failed_only ? "1" : "0" });
  const slots = data.history.slots;
  if (!slots.length) return "No SABnzbd history.";
  return slots
    .map((s) => {
      const ts = new Date(s.completed * 1000).toISOString().replace("T", " ").slice(0, 16);
      const cat = s.category ? ` [${s.category}]` : "";
      const fail = s.fail_message ? ` | Failure: ${s.fail_message}` : "";
      return `${s.name}${cat} | ${s.status}${fail}\n  id:${s.nzo_id} | ${s.size} | ${ts}`;
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

// ─── Queue control ────────────────────────────────────────────────────────────

export async function sabnzbdSetSpeedLimit(
  client: SabnzbdClient,
  input: z.infer<typeof SabSpeedLimitSchema>
): Promise<string> {
  await client.api("config", { name: "speedlimit", value: typeof input.limit === "number" ? (input.limit === 0 ? "0" : `${input.limit}M`) : input.limit.replace(/%$/, "") });
  const label = String(input.limit) === "0" ? "unlimited" : typeof input.limit === "number" ? `${input.limit} MB/s` : input.limit;
  return `Speed limit set to ${label}.`;
}

export async function sabnzbdPauseTimed(
  client: SabnzbdClient,
  input: z.infer<typeof SabPauseTimedSchema>
): Promise<string> {
  await client.api("config", { name: "set_pause", value: String(input.minutes) });
  return `SABnzbd paused for ${input.minutes} minute(s), then auto-resumes.`;
}

export async function sabnzbdSetItemPriority(
  client: SabnzbdClient,
  input: z.infer<typeof SabItemPrioritySchema>
): Promise<string> {
  await client.api("queue", { name: "priority", value: input.nzo_id, value2: PRIORITY_MAP[input.priority] });
  return `Priority for ${input.nzo_id} set to ${input.priority}.`;
}

export async function sabnzbdPauseItem(
  client: SabnzbdClient,
  input: z.infer<typeof SabItemActionSchema>
): Promise<string> {
  await client.api("queue", { name: "pause", value: input.nzo_id });
  return `Paused item ${input.nzo_id}.`;
}

export async function sabnzbdResumeItem(
  client: SabnzbdClient,
  input: z.infer<typeof SabItemActionSchema>
): Promise<string> {
  await client.api("queue", { name: "resume", value: input.nzo_id });
  return `Resumed item ${input.nzo_id}.`;
}

export async function sabnzbdRetryItem(
  client: SabnzbdClient,
  input: z.infer<typeof SabRetrySchema>
): Promise<string> {
  await client.api("retry", { value: input.nzo_id });
  return `Retry initiated for ${input.nzo_id}.`;
}

export async function sabnzbdClearHistory(
  client: SabnzbdClient,
  input: z.infer<typeof SabClearHistorySchema>
): Promise<string> {
  const value = input.nzo_id ?? input.target;
  await client.api("history", { name: "delete", value });
  return input.nzo_id ? `Removed ${input.nzo_id} from history.` : `Cleared ${input.target} history.`;
}

// ─── Categories ───────────────────────────────────────────────────────────────

export async function sabnzbdListCategories(client: SabnzbdClient): Promise<string> {
  const data = await client.api<any>("get_config", { section: "categories" });
  const cats: any[] = data.config?.categories ?? [];
  if (!cats.length) return "No categories configured.";
  return cats
    .map((c) => {
      const dir = c.dir ? ` | dir: ${c.dir}` : "";
      const script = c.script ? ` | script: ${c.script}` : "";
      const pp = c.pp !== undefined && c.pp !== "" ? ` | pp: ${c.pp}` : "";
      return `${c.name}${dir}${script}${pp} | priority: ${c.priority ?? 0}`;
    })
    .join("\n");
}

export async function sabnzbdSetCategory(
  client: SabnzbdClient,
  input: z.infer<typeof SabCategorySetSchema>
): Promise<string> {
  const extra: Record<string, string> = { section: "categories", name: input.name };
  if (input.dir !== undefined) extra["dir"] = input.dir;
  if (input.pp !== undefined) extra["pp"] = input.pp;
  if (input.script !== undefined) extra["script"] = input.script;
  if (input.priority !== undefined) extra["priority"] = String(input.priority);
  if (input.newzbin !== undefined) extra["newzbin"] = input.newzbin;
  await client.api("set_config", extra);
  return `Category "${input.name}" saved.`;
}

export async function sabnzbdDeleteCategory(
  client: SabnzbdClient,
  input: z.infer<typeof SabCategoryDeleteSchema>
): Promise<string> {
  await client.api("del_config", { section: "categories", keyword: input.name });
  return `Category "${input.name}" deleted.`;
}

// ─── Servers ──────────────────────────────────────────────────────────────────

export async function sabnzbdListServers(client: SabnzbdClient): Promise<string> {
  const data = await client.api<any>("get_config", { section: "servers" });
  const servers: any[] = data.config?.servers ?? [];
  if (!servers.length) return "No servers configured.";
  return servers
    .map((s) => {
      const status = Number(s.enable) ? "enabled" : "disabled";
      const ssl = Number(s.ssl) ? " SSL" : "";
      const tag = Number(s.required) ? " [required]" : Number(s.optional) ? " [optional]" : "";
      return `${s.displayname || s.host} (${s.name})\n  ${s.host}:${s.port}${ssl} | ${s.connections} conn | priority: ${s.priority} | ${status}${tag}`;
    })
    .join("\n\n");
}

export async function sabnzbdSetServer(
  client: SabnzbdClient,
  input: z.infer<typeof SabServerSetSchema>
): Promise<string> {
  const extra: Record<string, string> = { section: "servers", name: input.name };
  if (input.host !== undefined) extra["host"] = input.host;
  if (input.port !== undefined) extra["port"] = String(input.port);
  if (input.username !== undefined) extra["username"] = input.username;
  if (input.password !== undefined) extra["password"] = input.password;
  if (input.connections !== undefined) extra["connections"] = String(input.connections);
  if (input.ssl !== undefined) extra["ssl"] = input.ssl ? "1" : "0";
  if (input.ssl_verify !== undefined) extra["ssl_verify"] = String(input.ssl_verify);
  if (input.enable !== undefined) extra["enable"] = input.enable ? "1" : "0";
  if (input.priority !== undefined) extra["priority"] = String(input.priority);
  if (input.retention !== undefined) extra["retention"] = String(input.retention);
  if (input.required !== undefined) extra["required"] = input.required ? "1" : "0";
  if (input.optional !== undefined) extra["optional"] = input.optional ? "1" : "0";
  if (input.timeout !== undefined) extra["timeout"] = String(input.timeout);
  if (input.send_group !== undefined) extra["send_group"] = input.send_group ? "1" : "0";
  await client.api("set_config", extra);
  return `Server "${input.name}" saved.`;
}

export async function sabnzbdDeleteServer(
  client: SabnzbdClient,
  input: z.infer<typeof SabServerDeleteSchema>
): Promise<string> {
  await client.api("del_config", { section: "servers", keyword: input.name });
  return `Server "${input.name}" deleted.`;
}

// ─── Switches ─────────────────────────────────────────────────────────────────

export async function sabnzbdGetSwitches(client: SabnzbdClient): Promise<string> {
  const data = await client.api<any>("get_config", { section: "misc" });
  const misc = data.config?.misc ?? {};
  const lines = SWITCH_KEYS.filter((k) => misc[k] !== undefined).map((k) => `${k}: ${misc[k]}`);
  return lines.length ? lines.join("\n") : "No switch data returned.";
}

export async function sabnzbdSetSwitch(
  client: SabnzbdClient,
  input: z.infer<typeof SabSetSwitchSchema>
): Promise<string> {
  const val = typeof input.value === "boolean" ? (input.value ? "1" : "0") : String(input.value);
  await client.api("set_config", { section: "misc", keyword: input.key, value: val });
  return `${input.key} set to ${val}.`;
}

// ─── Folders ──────────────────────────────────────────────────────────────────

export async function sabnzbdGetFolders(client: SabnzbdClient): Promise<string> {
  const data = await client.api<any>("get_config", { section: "misc" });
  const misc = data.config?.misc ?? {};
  return FOLDER_KEYS.filter((k) => misc[k] !== undefined)
    .map((k) => `${FOLDER_LABELS[k]}: ${misc[k] || "(not set)"}`)
    .join("\n");
}

export async function sabnzbdSetFolder(
  client: SabnzbdClient,
  input: z.infer<typeof SabSetFolderSchema>
): Promise<string> {
  await client.api("set_config", { section: "misc", keyword: input.key, value: input.path });
  return `${FOLDER_LABELS[input.key]} set to "${input.path}".`;
}

// ─── General ──────────────────────────────────────────────────────────────────

export async function sabnzbdGetGeneral(client: SabnzbdClient): Promise<string> {
  const data = await client.api<any>("get_config", { section: "misc" });
  const misc = data.config?.misc ?? {};
  return GENERAL_KEYS.filter((k) => misc[k] !== undefined)
    .map((k) => `${GENERAL_LABELS[k]}: ${misc[k]}`)
    .join("\n");
}

export async function sabnzbdSetGeneral(
  client: SabnzbdClient,
  input: z.infer<typeof SabSetGeneralSchema>
): Promise<string> {
  await client.api("set_config", { section: "misc", keyword: input.key, value: String(input.value) });
  return `${GENERAL_LABELS[input.key] ?? input.key} set to "${input.value}".`;
}

export async function sabnzbdGetWarnings(client: SabnzbdClient): Promise<string> {
  const data = await client.api<{ warnings: Array<{ text: string; type: string; time: number }> }>("warnings");
  return data.warnings.map(w => `${w.type}: ${w.text}`).join("\n") || "No active SABnzbd warnings.";
}

export async function sabnzbdGetJob(client: SabnzbdClient, input: z.infer<typeof SabJobSchema>): Promise<string> {
  const queue = await client.api<{ queue: SabQueue }>("queue", { nzo_ids: input.nzo_id, limit: "1" });
  const active = queue.queue.slots.find(s => s.nzo_id === input.nzo_id);
  if (active) return JSON.stringify(active, (key, value) => /password|apikey/i.test(key) ? undefined : value, 2);
  const history = await client.api<{ history: SabHistory }>("history", { nzo_ids: input.nzo_id, limit: "1" });
  const completed = history.history.slots.find(s => s.nzo_id === input.nzo_id);
  if (!completed) throw new Error(`SABnzbd job ${input.nzo_id} was not found in queue or history.`);
  return JSON.stringify({ id: completed.nzo_id, name: completed.name, status: completed.status,
    category: completed.category, failure: completed.fail_message, storage: completed.storage,
    temporaryPath: completed.path, stages: completed.stage_log }, null, 2);
}
