import axios, { AxiosInstance } from "axios";

export class TautulliClient {
  private http: AxiosInstance;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.apiKey = apiKey;
    this.http = axios.create({ baseURL: baseUrl, timeout: 15_000 });
  }

  async cmd<T>(command: string, extra?: Record<string, string | number>): Promise<T> {
    const params = { apikey: this.apiKey, cmd: command, ...extra };
    const r = await this.http.get<{ response: { result: string; data: T } }>("/api/v2", { params });
    const res = r.data.response;
    if (res.result !== "success") throw new Error(`Tautulli error for ${command}: ${res.result}`);
    return res.data;
  }
}

export function createTautulliClient(): TautulliClient {
  const url = process.env.TAUTULLI_URL;
  const key = process.env.TAUTULLI_API_KEY;
  if (!url || !key) throw new Error("Missing TAUTULLI_URL or TAUTULLI_API_KEY in .env");
  return new TautulliClient(url, key);
}
