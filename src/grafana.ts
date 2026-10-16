import axios, { AxiosInstance } from "axios";
import http from "http";

const keepAliveAgent = new http.Agent({ keepAlive: true });

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
      httpAgent: keepAliveAgent,
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
          panels?: Array<unknown>;
          datasource?: { type: string; uid: string } | string;
          targets?: Array<{ expr?: string; target?: string; query?: string; [k: string]: unknown }>;
        }>;
        templating?: { list?: Array<{ name: string; type?: string; query?: string; current?: { value?: string | string[] } }> };
      };
    }>(`/api/dashboards/uid/${uid}`);

    type QueryPanel = (typeof r.data.dashboard.panels)[number];
    const findPanel = (panels: QueryPanel[]): QueryPanel | undefined => {
      for (const item of panels) {
        if (item.id === panelId) return item;
        const nested = findPanel((item.panels ?? []) as QueryPanel[]);
        if (nested) return nested;
      }
      return undefined;
    };
    const panel = findPanel(r.data.dashboard.panels ?? []);
    if (!panel) throw new Error(`Panel ${panelId} not found in dashboard ${uid}`);
    if (!panel.targets?.length) throw new Error(`Panel ${panelId} has no query targets`);

    const sources = await this.http.get<Array<{ uid: string; name: string; type: string; isDefault?: boolean }>>("/api/datasources");
    const resolveDatasource = (value: unknown): { uid: string; type: string } => {
      let uid = typeof value === "string" ? value : (value as { uid?: string } | undefined)?.uid;
      const type = typeof value === "object" && value ? (value as { type?: string }).type : undefined;
      const variable = uid?.match(/^(?:\$\{([A-Za-z0-9_]+)\}|\$([A-Za-z0-9_]+))$/);
      if (variable) {
        const variableItem = r.data.dashboard.templating?.list?.find(item => item.name === (variable[1] ?? variable[2]));
        const selected = variableItem?.current?.value;
        if (typeof selected === "string" && selected) uid = selected;
        else if (Array.isArray(selected) && selected.length === 1) uid = selected[0];
        else {
          const candidates = variableItem?.type === "datasource" ? sources.data.filter(item => item.type === variableItem.query) : [];
          if (candidates.length !== 1) throw new Error("Datasource variable has no single selected value or unique matching datasource.");
          uid = candidates[0].uid;
        }
      }
      if (uid === "__expr__") return { uid, type: "__expr__" };
      let source = uid
        ? sources.data.find(item => item.uid === uid || item.name === uid)
        : sources.data.find(item => item.isDefault && (!type || item.type === type));
      if (!source && uid) {
        const matches = sources.data.filter(item => item.name.toLowerCase() === uid!.toLowerCase() && (!type || item.type === type));
        if (matches.length === 1) source = matches[0];
      }
      if (!source) throw new Error("Panel datasource could not be resolved. Check the dashboard's selected datasource.");
      return { uid: source.uid, type: source.type };
    };

    const res = await this.http.post<{ results: Record<string, { frames?: unknown[]; error?: string }> }>(
      "/api/ds/query",
      {
        from,
        to,
        queries: panel.targets.map((t, index) => ({ ...t, refId: t.refId ?? String.fromCharCode(65 + index),
          datasource: resolveDatasource(t.datasource ?? panel.datasource), maxDataPoints: 500, intervalMs: 1000 })),
      }
    );

    for (const [refId, result] of Object.entries(res.data.results ?? {})) {
      if (result.error) throw new Error(`Grafana query ${refId} failed: ${result.error}`);
    }
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
