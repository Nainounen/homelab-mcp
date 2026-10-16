import axios, { AxiosInstance } from "axios";
import http from "http";

const keepAliveAgent = new http.Agent({ keepAlive: true });

export class BazarrClient {
  private http: AxiosInstance;

  constructor(baseUrl: string, apiKey: string) {
    this.http = axios.create({
      baseURL: baseUrl.replace(/\/$/, ""),
      headers: { "X-API-KEY": apiKey },
      httpAgent: keepAliveAgent,
      timeout: 60_000,
      maxRedirects: 0,
      maxBodyLength: 3 * 1024 * 1024,
      maxContentLength: 8 * 1024 * 1024,
    });
  }

  async request<T>(method: string, path: string, params: Record<string, unknown> = {}, data?: unknown): Promise<T> {
    if (!path.startsWith("/api/") || path.includes("..") || path.includes("?")) throw new Error("Invalid Bazarr API path");
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== undefined && item !== null) query.append(key, String(item));
      }
    }
    try {
      const response = await this.http.request<T>({ method, url: path, params: query, data, timeout: method === "GET" ? 60_000 : 180_000 });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && ["ECONNABORTED", "ETIMEDOUT"].includes(error.code ?? "") && method !== "GET") {
        throw new Error("Bazarr request timed out; it may still finish. Inspect jobs, history and media state before retrying. No automatic retry was made.");
      }
      throw error;
    }
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    return this.request<T>("GET", path, params);
  }

  async post<T>(path: string, data?: unknown): Promise<T> {
    return this.request<T>("POST", path, {}, data);
  }
}

export function createBazarrClient(): BazarrClient {
  const url = process.env.BAZARR_URL;
  const key = process.env.BAZARR_API_KEY;
  if (!url || !key) throw new Error("Missing BAZARR_URL or BAZARR_API_KEY in media environment");
  return new BazarrClient(url, key);
}
