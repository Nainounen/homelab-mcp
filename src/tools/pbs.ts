import { z } from "zod";
import { PbsClient } from "../pbs.js";
import { bytes } from "../utils.js";

export const PbsBackupSchema = z.object({
  datastore: z.string().describe("Datastore name to back up to"),
  namespace: z.string().optional().describe("Namespace within the datastore (optional)"),
});

export const PbsTasksSchema = z.object({
  limit: z.number().optional().default(20).describe("Number of recent tasks to return"),
});

interface PbsDatastore {
  store: string;
  "total": number;
  used: number;
  avail: number;
}

interface PbsTask {
  upid: string;
  type: string;
  status?: string;
  starttime: number;
  endtime?: number;
  user: string;
}

interface PbsSnapshot {
  "backup-id": string;
  "backup-time": number;
  "backup-type": string;
  size?: number;
}

export async function pbsGetStatus(client: PbsClient): Promise<string> {
  const datastores = await client.get<PbsDatastore[]>("/admin/datastore");

  const lines: string[] = ["Proxmox Backup Server\n"];
  for (const ds of datastores) {
    const usedPct = ds.total > 0 ? ((ds.used / ds.total) * 100).toFixed(1) : "?";
    lines.push(`Datastore: ${ds.store}`);
    lines.push(`  ${bytes(ds.used)} / ${bytes(ds.total)} used (${usedPct}%) | ${bytes(ds.avail)} free`);
  }

  return lines.join("\n");
}

export async function pbsListSnapshots(client: PbsClient): Promise<string> {
  const datastores = await client.get<PbsDatastore[]>("/admin/datastore");
  const lines: string[] = [];

  for (const ds of datastores) {
    const snaps = await client.get<PbsSnapshot[]>(
      `/admin/datastore/${ds.store}/snapshots`
    ).catch(() => [] as PbsSnapshot[]);

    lines.push(`## ${ds.store} (${snaps.length} snapshot(s))`);
    snaps.slice(0, 10).forEach((s) => {
      const date = new Date(s["backup-time"] * 1000).toLocaleString();
      const size = s.size ? ` | ${bytes(s.size)}` : "";
      lines.push(`  ${s["backup-type"]}/${s["backup-id"]} — ${date}${size}`);
    });
    lines.push("");
  }

  return lines.join("\n") || "No snapshots found.";
}

export async function pbsGetTasks(
  client: PbsClient,
  input: z.infer<typeof PbsTasksSchema>
): Promise<string> {
  const tasks = await client.get<PbsTask[]>(
    `/nodes/${client.node}/tasks`,
    { limit: input.limit, sort_by: "starttime-desc" }
  );

  if (!tasks.length) return "No recent tasks.";

  return tasks.map((t) => {
    const start  = new Date(t.starttime * 1000).toLocaleString();
    const dur    = t.endtime ? `${t.endtime - t.starttime}s` : "running";
    const status = t.status ?? "running";
    return `${start} | ${t.type} | ${status} | ${dur} | ${t.user}`;
  }).join("\n");
}
