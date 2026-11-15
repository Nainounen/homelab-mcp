import axios, { AxiosInstance } from "axios";
import http from "http";

const keepAliveAgent = new http.Agent({ keepAlive: true });

export class SeerrClient {
  private http: AxiosInstance;

  constructor(baseUrl: string, apiKey: string) {
    this.http = axios.create({
      baseURL: `${baseUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, "")}/api/v1`,
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

  async put<T>(path: string, data?: unknown): Promise<T> { return (await this.http.put<T>(path,data)).data; }

  async delete(path: string): Promise<void> {
    await this.http.delete(path);
  }
}

export function createSeerrClient(): SeerrClient {
  // The OVERSEERR_* names from before the rename to Seerr keep working.
  const url = process.env.SEERR_URL || process.env.OVERSEERR_URL;
  const key = process.env.SEERR_API_KEY || process.env.OVERSEERR_API_KEY;
  if (!url || !key) throw new Error("Missing SEERR_URL or SEERR_API_KEY");
  return new SeerrClient(url, key);
}
