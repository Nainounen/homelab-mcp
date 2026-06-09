import axios, { AxiosInstance } from "axios";
import http from "http";

const keepAliveAgent = new http.Agent({ keepAlive: true });

export class SabnzbdClient {
  private http: AxiosInstance;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.apiKey = apiKey;
    this.http = axios.create({ baseURL: baseUrl, httpAgent: keepAliveAgent, timeout: 15_000 });
  }

  async api<T>(mode: string, extra?: Record<string, string>): Promise<T> {
    const params = { output: "json", apikey: this.apiKey, mode, ...extra };
    const r = await this.http.get<T>("/sabnzbd/api", { params });
    return r.data;
  }
}

export function createSabnzbdClient(): SabnzbdClient {
  const url = process.env.SABNZBD_URL;
  const key = process.env.SABNZBD_API_KEY;
  if (!url || !key) throw new Error("Missing SABNZBD_URL or SABNZBD_API_KEY in .env");
  return new SabnzbdClient(url, key);
}
