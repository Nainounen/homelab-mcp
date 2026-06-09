import axios, { AxiosInstance } from "axios";
import http from "http";
import https from "https";
import { withRetry } from "./utils.js";

const keepAliveAgent = new http.Agent({ keepAlive: true });
const keepAliveHttpsAgent = new https.Agent({ keepAlive: true });

interface AuthTicket {
  ticket: string;
  csrfToken: string;
  expiresAt: number;
}

interface ProxmoxConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  node: string;
}

/**
 * Proxmox VE REST API client with automatic ticket refresh.
 * Tickets expire after 2 hours; this client renews them transparently.
 *
 * TLS: Proxmox uses self-signed certificates by default.  Set
 * PROXMOX_TLS_VERIFY=true to enable certificate validation (requires a trusted
 * CA or custom CA bundle via NODE_EXTRA_CA_CERTS).
 */
export class ProxmoxClient {
  private config: ProxmoxConfig;
  private auth: AuthTicket | null = null;
  private http: AxiosInstance;

  constructor(config: ProxmoxConfig) {
    this.config = config;
    const tlsVerify = process.env.PROXMOX_TLS_VERIFY === "true";
    if (!tlsVerify) {
      process.stderr.write("[homelab-mcp] WARNING: Proxmox TLS verification disabled (set PROXMOX_TLS_VERIFY=true to enable)\n");
    }
    this.http = axios.create({
      baseURL: `https://${config.host}:${config.port}/api2/json`,
      httpsAgent: new https.Agent({ rejectUnauthorized: tlsVerify, keepAlive: true }),
      timeout: 15000,
    });
  }

  /** Authenticate and store ticket. Called automatically before any request. */
  private async authenticate(): Promise<void> {
    const res = await this.http.post("/access/ticket", null, {
      params: {
        username: this.config.user,
        password: this.config.password,
      },
    });
    const { ticket, CSRFPreventionToken } = res.data.data;
    this.auth = {
      ticket,
      csrfToken: CSRFPreventionToken,
      // Tickets are valid for 2 hours; refresh 5 minutes early
      expiresAt: Date.now() + 115 * 60 * 1000,
    };
  }

  /** Return auth headers, refreshing ticket if expired. */
  private async getHeaders(write = false): Promise<Record<string, string>> {
    if (!this.auth || Date.now() >= this.auth.expiresAt) {
      await this.authenticate();
    }
    const headers: Record<string, string> = {
      Cookie: `PVEAuthCookie=${this.auth!.ticket}`,
    };
    if (write) {
      headers["CSRFPreventionToken"] = this.auth!.csrfToken;
    }
    return headers;
  }

  /** GET helper */
  async get<T = unknown>(path: string): Promise<T> {
    const headers = await this.getHeaders();
    const res = await withRetry(() => this.http.get<{ data: T }>(path, { headers }));
    return res.data.data;
  }

  /** POST helper */
  async post<T = unknown>(
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const headers = await this.getHeaders(true);
    const res = await withRetry(() => this.http.post<{ data: T }>(path, body ?? null, {
      headers,
    }));
    return res.data.data;
  }

  get node(): string {
    return this.config.node;
  }
}

/**
 * Build a ProxmoxClient from environment variables.
 * Throws if required variables are missing.
 */
export function createProxmoxClient(): ProxmoxClient {
  const required = [
    "PROXMOX_HOST",
    "PROXMOX_PORT",
    "PROXMOX_USER",
    "PROXMOX_PASSWORD",
    "PROXMOX_NODE",
  ];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`Missing env var: ${key}`);
  }
  return new ProxmoxClient({
    host: process.env.PROXMOX_HOST!,
    port: parseInt(process.env.PROXMOX_PORT!, 10),
    user: process.env.PROXMOX_USER!,
    password: process.env.PROXMOX_PASSWORD!,
    node: process.env.PROXMOX_NODE!,
  });
}
