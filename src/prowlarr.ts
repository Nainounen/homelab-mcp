import axios, { AxiosInstance } from "axios";
import http from "http";

const keepAliveAgent = new http.Agent({ keepAlive: true });

export class ProwlarrClient {
  private http: AxiosInstance;

  constructor(baseUrl: string, apiKey: string) {
    this.http = axios.create({
      baseURL: `${baseUrl}/api/v1`,
      headers: { "X-Api-Key": apiKey },
      httpAgent: keepAliveAgent,
      timeout: 15_000,
    });
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const r = await this.http.get<T>(path, { params });
    return r.data;
  }

  async post<T>(path: string, data?: unknown): Promise<T> {
    const r = await this.http.post<T>(path, data);
    return r.data;
  }
}

export function createProwlarrClient(): ProwlarrClient {
  const url = process.env.PROWLARR_URL;
  const key = process.env.PROWLARR_API_KEY;
  if (!url || !key) throw new Error("Missing PROWLARR_URL or PROWLARR_API_KEY");
  return new ProwlarrClient(url, key);
}
