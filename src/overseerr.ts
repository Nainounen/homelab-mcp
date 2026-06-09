import axios, { AxiosInstance } from "axios";
import http from "http";

const keepAliveAgent = new http.Agent({ keepAlive: true });

export class OverseerrClient {
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

  async delete(path: string): Promise<void> {
    await this.http.delete(path);
  }
}

export function createOverseerrClient(): OverseerrClient {
  const url = process.env.OVERSEERR_URL;
  const key = process.env.OVERSEERR_API_KEY;
  if (!url || !key) throw new Error("Missing OVERSEERR_URL or OVERSEERR_API_KEY");
  return new OverseerrClient(url, key);
}
