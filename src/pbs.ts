import axios, { AxiosInstance } from "axios";
import https from "https";

/**
 * Proxmox Backup Server API client.
 *
 * TLS: PBS commonly uses self-signed certificates.  Set PBS_TLS_VERIFY=true
 * to enable certificate validation (requires a trusted CA or custom CA bundle
 * via NODE_EXTRA_CA_CERTS).
 */
export class PbsClient {
  private http: AxiosInstance;
  readonly node: string;

  constructor(baseUrl: string, tokenId: string, secret: string, node: string) {
    this.node = node;
    const tlsVerify = process.env.PBS_TLS_VERIFY === "true";
    if (!tlsVerify) {
      process.stderr.write("[homelab-mcp] WARNING: PBS TLS verification disabled (set PBS_TLS_VERIFY=true to enable)\n");
    }
    this.http = axios.create({
      baseURL: `${baseUrl}/api2/json`,
      headers: { Authorization: `PBSAPIToken=${tokenId}:${secret}` },
      timeout: 20_000,
      httpsAgent: new https.Agent({ rejectUnauthorized: tlsVerify, keepAlive: true }),
    });
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const r = await this.http.get<{ data: T }>(path, { params });
    return r.data.data;
  }

  async post<T>(path: string, data?: unknown): Promise<T> {
    const r = await this.http.post<{ data: T }>(path, data);
    return r.data.data;
  }
}

export function createPbsClient(): PbsClient {
  const url     = process.env.PBS_URL;
  const tokenId = process.env.PBS_TOKEN_ID;   // e.g. root@pam!mcp
  const secret  = process.env.PBS_TOKEN_SECRET;
  const node    = process.env.PBS_NODE ?? "localhost";
  if (!url || !tokenId || !secret) {
    throw new Error("Missing PBS_URL, PBS_TOKEN_ID, or PBS_TOKEN_SECRET in .env");
  }
  return new PbsClient(url, tokenId, secret, node);
}
