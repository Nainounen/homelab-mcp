import axios, { AxiosInstance } from "axios";

export class AdGuardClient {
  private http: AxiosInstance;

  constructor(baseUrl: string, username: string, password: string) {
    this.http = axios.create({
      baseURL: `${baseUrl}/control`,
      auth: { username, password },
      timeout: 10_000,
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

export function createAdGuardClient(): AdGuardClient {
  const url  = process.env.ADGUARD_URL;
  const user = process.env.ADGUARD_USER;
  const pass = process.env.ADGUARD_PASSWORD;
  if (!url || !user || !pass) throw new Error("Missing ADGUARD_URL, ADGUARD_USER, or ADGUARD_PASSWORD in .env");
  return new AdGuardClient(url, user, pass);
}
