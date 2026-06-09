import axios, { AxiosInstance } from "axios";

export class BazarrClient {
  private http: AxiosInstance;

  constructor(baseUrl: string, apiKey: string) {
    this.http = axios.create({
      baseURL: baseUrl,
      headers: { "X-API-KEY": apiKey },
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

export function createBazarrClient(): BazarrClient {
  const url = process.env.BAZARR_URL;
  const key = process.env.BAZARR_API_KEY;
  if (!url || !key) throw new Error("Missing BAZARR_URL or BAZARR_API_KEY in .env");
  return new BazarrClient(url, key);
}
