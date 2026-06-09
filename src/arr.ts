import axios, { AxiosInstance } from "axios";

export class ArrClient {
  private http: AxiosInstance;

  constructor(baseUrl: string, apiKey: string, apiPath = "api/v3") {
    this.http = axios.create({
      baseURL: `${baseUrl}/${apiPath}`,
      headers: { "X-Api-Key": apiKey },
      timeout: 45_000,
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

  async put<T>(path: string, data?: unknown): Promise<T> {
    const r = await this.http.put<T>(path, data);
    return r.data;
  }

  async delete(path: string, params?: Record<string, unknown>): Promise<void> {
    await this.http.delete(path, { params });
  }

  async deleteWithBody(path: string, body: unknown, params?: Record<string, unknown>): Promise<void> {
    await this.http.delete(path, { data: body, params });
  }
}

/** Creates an ArrClient for v1-based apps (Lidarr, Readarr) */
export function createArrV1Client(url: string, key: string): ArrClient {
  return new ArrClient(url, key, "api/v1");
}

export function createRadarrClient(): ArrClient {
  const url = process.env.RADARR_URL;
  const key = process.env.RADARR_API_KEY;
  if (!url || !key) throw new Error("Missing RADARR_URL or RADARR_API_KEY");
  return new ArrClient(url, key);
}

export function createSonarrClient(): ArrClient {
  const url = process.env.SONARR_URL;
  const key = process.env.SONARR_API_KEY;
  if (!url || !key) throw new Error("Missing SONARR_URL or SONARR_API_KEY");
  return new ArrClient(url, key);
}
