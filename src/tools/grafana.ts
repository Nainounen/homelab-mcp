import { z } from "zod";
import { GrafanaClient } from "../grafana.js";

export const GrafanaGetDashboardSchema = z.object({
  uid: z.string().describe("Dashboard UID (from grafana_list_dashboards)"),
});

export const GrafanaQueryPanelSchema = z.object({
  uid: z.string().describe("Dashboard UID (from grafana_list_dashboards)"),
  panel_id: z.number().describe("Panel ID (from grafana_get_dashboard)"),
  from: z.string().optional().default("now-1h").describe("Start time (default: now-1h)"),
  to: z.string().optional().default("now").describe("End time (default: now)"),
});

export async function grafanaListDashboards(client: GrafanaClient): Promise<string> {
  const dashboards = await client.searchDashboards();
  if (!dashboards.length) return "No dashboards found.";
  return dashboards
    .map((d) => {
      const folder = d.folderTitle ? ` [${d.folderTitle}]` : "";
      return `${d.title}${folder}\n  uid:${d.uid} | tags:${d.tags.join(", ") || "none"}`;
    })
    .join("\n\n");
}

export async function grafanaQueryPanel(
  client: GrafanaClient,
  input: z.infer<typeof GrafanaQueryPanelSchema>
): Promise<string> {
  const results = await client.queryPanelData(input.uid, input.panel_id, input.from, input.to) as Record<string, {
    frames?: Array<{ schema?: { fields: Array<{ name: string }> }; data?: { values: unknown[][] } }>;
  }>;

  const lines: string[] = [];
  for (const [refId, result] of Object.entries(results)) {
    const frames = result.frames ?? [];
    for (const frame of frames) {
      const fields = frame.schema?.fields ?? [];
      const values = frame.data?.values ?? [];
      if (!fields.length) continue;

      lines.push(`[${refId}] ${fields.map((f) => f.name).join(" | ")}`);
      const rowCount = Math.min((values[0] as unknown[])?.length ?? 0, 10);
      for (let i = 0; i < rowCount; i++) {
        const row = values.map((col) => {
          const v = (col as unknown[])[i];
          if (typeof v === "number" && fields[values.indexOf(col)]?.name?.toLowerCase().includes("time")) {
            return new Date(v).toLocaleTimeString();
          }
          return typeof v === "number" ? v.toFixed(4).replace(/\.?0+$/, "") : String(v ?? "null");
        });
        lines.push(`  ${row.join(" | ")}`);
      }
      if ((values[0] as unknown[])?.length > 10) {
        lines.push(`  ... (${(values[0] as unknown[]).length} total data points)`);
      }
    }
  }

  return lines.join("\n") || "No data returned.";
}

export async function grafanaGetDashboard(
  client: GrafanaClient,
  input: z.infer<typeof GrafanaGetDashboardSchema>
): Promise<string> {
  const { title, panels } = await client.getDashboard(input.uid);
  if (!panels.length) return `Dashboard "${title}" has no panels.`;
  const lines = panels.map((p) => `  [${p.id}] ${p.type.padEnd(12)} ${p.title}`);
  return `${title}\n${lines.join("\n")}`;
}
