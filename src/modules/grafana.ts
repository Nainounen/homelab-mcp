import { ToolModule } from "../types.js";
import { GrafanaClient } from "../grafana.js";
import * as impl from "../tools/grafana.js";

export function grafanaModule(client: GrafanaClient): ToolModule {
  return {
    domain: "Grafana",
    tools: [
      {
        name: "grafana_list_dashboards",
        description: "List all Grafana dashboards with their UIDs, folder, and tags.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "grafana_get_dashboard",
        description: "Get the panel list for a Grafana dashboard by UID. Returns panel IDs, types, and titles.",
        inputSchema: {
          type: "object",
          properties: { uid: { type: "string", description: "Dashboard UID (from grafana_list_dashboards)" } },
          required: ["uid"],
        },
      },
      {
        name: "grafana_query_panel",
        description: "Query the actual data values from a specific Grafana dashboard panel. Returns the last N data points. Use grafana_get_dashboard first to find the panel_id.",
        inputSchema: {
          type: "object",
          properties: {
            uid: { type: "string", description: "Dashboard UID (from grafana_list_dashboards)" },
            panel_id: { type: "number", description: "Panel ID (from grafana_get_dashboard)" },
            from: { type: "string", description: "Start time (default: now-1h)" },
            to: { type: "string", description: "End time (default: now)" },
          },
          required: ["uid", "panel_id"],
        },
      },
    ],

    async handle(name, args) {
      switch (name) {
        case "grafana_list_dashboards": return impl.grafanaListDashboards(client);
        case "grafana_get_dashboard":   return impl.grafanaGetDashboard(client, impl.GrafanaGetDashboardSchema.parse(args));
        case "grafana_query_panel":     return impl.grafanaQueryPanel(client, impl.GrafanaQueryPanelSchema.parse(args));
        default: return null;
      }
    },
  };
}
