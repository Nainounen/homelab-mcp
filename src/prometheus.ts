import axios, { AxiosInstance } from "axios";

export interface PrometheusResult {
  metric: Record<string, string>;
  value: [number, string];
}

export interface PrometheusRangeResult {
  metric: Record<string, string>;
  values: Array<[number, string]>;
}

export class PrometheusClient {
  private http: AxiosInstance;

  constructor(baseUrl: string) {
    this.http = axios.create({ baseURL: baseUrl, timeout: 15_000 });
  }

  async query(promql: string): Promise<PrometheusResult[]> {
    const r = await this.http.get<{ status: string; data: { result: PrometheusResult[] } }>(
      "/api/v1/query",
      { params: { query: promql } }
    );
    if (r.data.status !== "success") throw new Error(`Prometheus error: ${r.data.status}`);
    return r.data.data.result;
  }

  async queryRange(promql: string, start: string, end: string, step: string): Promise<PrometheusRangeResult[]> {
    const r = await this.http.get<{ status: string; data: { result: PrometheusRangeResult[] } }>(
      "/api/v1/query_range",
      { params: { query: promql, start, end, step } }
    );
    if (r.data.status !== "success") throw new Error(`Prometheus error: ${r.data.status}`);
    return r.data.data.result;
  }

  async targets(): Promise<Array<{ job: string; instance: string; health: string; lastError?: string }>> {
    const r = await this.http.get<{ status: string; data: { activeTargets: Array<{ labels: Record<string,string>; health: string; lastError?: string }> } }>(
      "/api/v1/targets"
    );
    return r.data.data.activeTargets.map((t) => ({
      job: t.labels.job,
      instance: t.labels.instance,
      health: t.health,
      lastError: t.lastError,
    }));
  }
}

export function createPrometheusClient(): PrometheusClient {
  const url = process.env.PROMETHEUS_URL;
  if (!url) throw new Error("Missing PROMETHEUS_URL in .env");
  return new PrometheusClient(url);
}
