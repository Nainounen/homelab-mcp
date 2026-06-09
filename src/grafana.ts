import axios, { AxiosInstance } from "axios";

export interface GrafanaDashboard {
  uid: string;
  title: string;
  url: string;
  type: string;
  folderTitle?: string;
  tags: string[];
}

export interface GrafanaPanel {
  id: number;
  type: string;
  title: string;
}

export class GrafanaClient {
  private http: AxiosInstance;

  constructor(baseUrl: string, token: string) {
    this.http = axios.create({
      baseURL: baseUrl,
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15_000,
    });
  }

  async searchDashboards(): Promise<GrafanaDashboard[]> {
    const r = await this.http.get<GrafanaDashboard[]>("/api/search?type=dash-db");
    return r.data;
  }

  async queryPanelData(uid: string, panelId: number, from = "now-1h", to = "now"): Promise<unknown> {
    // Fetch the full dashboard JSON to extract the panel's target queries + data source
    const r = await this.http.get<{
      dashboard: {
        panels: Array<{
          id: number;
          datasource?: { type: string; uid: string } | string;
          targets?: Array<{ expr?: string; target?: string; query?: string; [k: string]: unknown }>;
        }>;
      };
    }>(`/api/dashboards/uid/${uid}`);

    const panel = r.data.dashboard.panels?.find((p) => p.id === panelId);
    if (!panel) throw new Error(`Panel ${panelId} not found in dashboard ${uid}`);
    if (!panel.targets?.length) throw new Error(`Panel ${panelId} has no query targets`);

    // Resolve data source UID
    let dsUid: string | undefined;
    if (panel.datasource && typeof panel.datasource === "object") {
      dsUid = panel.datasource.uid;
    }

    const res = await this.http.post<{ results: Record<string, { frames?: unknown[] }> }>(
      "/api/ds/query",
      {
        from,
        to,
        queries: panel.targets.map((t) => ({ ...t, datasource: panel.datasource, datasourceId: dsUid })),
      }
    );

    return res.data.results;
  }

  async getDashboard(uid: string): Promise<{ title: string; panels: GrafanaPanel[] }> {
    const r = await this.http.get<{ dashboard: { title: string; panels: GrafanaPanel[] } }>(
      `/api/dashboards/uid/${uid}`
    );
    const db = r.data.dashboard;
    const panels: GrafanaPanel[] = [];
    const walk = (list: GrafanaPanel[]) => {
      for (const p of list) {
        if (p.title) panels.push({ id: p.id, type: p.type, title: p.title });
        if ((p as unknown as { panels?: GrafanaPanel[] }).panels) {
          walk((p as unknown as { panels: GrafanaPanel[] }).panels);
        }
      }
    };
    walk(db.panels ?? []);
    return { title: db.title, panels };
  }
}

export function createGrafanaClient(): GrafanaClient {
  const url = process.env.GRAFANA_URL;
  const token = process.env.GRAFANA_TOKEN;
  if (!url || !token) throw new Error("Missing GRAFANA_URL or GRAFANA_TOKEN in .env");
  return new GrafanaClient(url, token);
}
