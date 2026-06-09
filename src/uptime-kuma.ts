import axios, { AxiosInstance } from "axios";

export class UptimeKumaClient {
  private http: AxiosInstance;

  constructor(baseUrl: string, username: string, password: string) {
    this.http = axios.create({
      baseURL: baseUrl,
      auth: { username, password },
      timeout: 10_000,
    });
  }

  /** Returns raw Prometheus-format metrics text from /metrics */
  async getMetrics(): Promise<string> {
    const r = await this.http.get<string>("/metrics", { responseType: "text" });
    return r.data;
  }
}

export function createUptimeKumaClient(): UptimeKumaClient {
  const url  = process.env.UPTIME_KUMA_URL;
  const user = process.env.UPTIME_KUMA_USER;
  const pass = process.env.UPTIME_KUMA_PASSWORD;
  if (!url || !user || !pass) {
    throw new Error("Missing UPTIME_KUMA_URL, UPTIME_KUMA_USER, or UPTIME_KUMA_PASSWORD in .env");
  }
  return new UptimeKumaClient(url, user, pass);
}
