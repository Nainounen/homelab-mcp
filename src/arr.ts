import axios, { AxiosInstance } from "axios";
import http from "http";
import https from "https";
import { bytes, withRetry } from "./utils.js";

const keepAliveAgent = new http.Agent({ keepAlive: true });
const keepAliveHttpsAgent = new https.Agent({ keepAlive: true });

export class ArrClient {
  private http: AxiosInstance;

  constructor(baseUrl: string, apiKey: string, apiPath = "api/v3") {
    this.http = axios.create({
      baseURL: `${baseUrl}/${apiPath}`,
      headers: { "X-Api-Key": apiKey },
      httpAgent: keepAliveAgent,
      httpsAgent: keepAliveHttpsAgent,
      timeout: 45_000,
    });
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const r = await withRetry(() => this.http.get<T>(path, { params }));
    return r.data;
  }

  async post<T>(path: string, data?: unknown): Promise<T> {
    const r = await withRetry(() => this.http.post<T>(path, data));
    return r.data;
  }

  async postOnce<T>(path: string, data?: unknown, timeoutMs?: number): Promise<T> { return (await this.http.post<T>(path,data,timeoutMs ? {timeout:timeoutMs} : undefined)).data; }

  async putOnce<T>(path: string, data?: unknown): Promise<T> { return (await this.http.put<T>(path,data)).data; }

  async put<T>(path: string, data?: unknown): Promise<T> {
    const r = await withRetry(() => this.http.put<T>(path, data));
    return r.data;
  }

  async delete(path: string, params?: Record<string, unknown>): Promise<void> {
    await withRetry(() => this.http.delete(path, { params }));
  }

  async deleteOnce(path: string): Promise<void> {
    await this.http.delete(path);
  }

  async deleteWithBody(path: string, body: unknown, params?: Record<string, unknown>): Promise<void> {
    await withRetry(() => this.http.delete(path, { data: body, params }));
  }

  async deleteWithBodyOnce(path: string, body: unknown, params?: Record<string, unknown>): Promise<void> {
    await this.http.delete(path, { data: body, params });
  }
}

export async function getArrRecords<T>(client: ArrClient, endpoint: string): Promise<T[]> {
  const records: T[] = [];
  for (let page = 1; ; page++) {
    const result = await client.get<{ records: T[]; totalRecords?: number }>(endpoint, {
      page,
      pageSize: 100,
    });
    records.push(...result.records);
    if (!result.records.length || result.totalRecords === undefined || records.length >= result.totalRecords) {
      return records;
    }
  }
}

export interface ArrCommand {
  id: number;
  name?: string;
  status: string;
  message?: string;
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

export interface ArrLanguage {
  id: number;
  name: string;
}

export interface ArrMediaFile {
  id: number;
  path: string;
  size: number;
  seasonNumber?: number;
  languages?: ArrLanguage[];
  quality?: { quality?: { name: string } };
  mediaInfo?: { audioLanguages?: string; subtitles?: string; audioCodec?: string };
}

export function describeArrFile(file: ArrMediaFile): string {
  return `[fileId:${file.id}] ${file.path}\n` +
    `  Quality: ${file.quality?.quality?.name ?? "unknown"} | Size: ${bytes(file.size)}\n` +
    `  Assigned languages: ${file.languages?.map((l) => l.name).join(", ") || "unknown"}\n` +
    `  Reported audio languages: ${file.mediaInfo?.audioLanguages || "unknown"} | Codec: ${file.mediaInfo?.audioCodec || "unknown"}\n` +
    `  Reported subtitles: ${file.mediaInfo?.subtitles || "unknown"}`;
}

export async function listArrLanguages(client: ArrClient): Promise<string> {
  const languages = await client.get<ArrLanguage[]>("/language");
  return languages.map((language) => `[${language.id}] ${language.name}`).join("\n");
}

export async function listArrQualityProfiles(client: ArrClient): Promise<string> {
  const profiles = await client.get<Array<{
    id: number;
    name: string;
    upgradeAllowed?: boolean;
    cutoff?: number;
    minFormatScore?: number;
    cutoffFormatScore?: number;
  }>>("/qualityprofile");
  if (!profiles.length) return "No quality profiles configured.";
  return profiles.map((profile) =>
    `[${profile.id}] ${profile.name} | Upgrades allowed: ${profile.upgradeAllowed ?? false} | Quality cutoff ID: ${profile.cutoff ?? "unknown"} | Minimum custom format score: ${profile.minFormatScore ?? 0} | Custom format cutoff: ${profile.cutoffFormatScore ?? 0}`
  ).join("\n");
}

export function filterArrLanguages<T extends { languages?: ArrLanguage[] }>(releases: T[], language?: string): T[] {
  if (!language) return releases;
  const target = language.trim().toLowerCase();
  return releases.filter((release) => release.languages?.some((item) => item.name.toLowerCase() === target));
}

export async function submitArrCommand(
  client: ArrClient,
  name: string,
  target: Record<string, unknown>,
  previewOnly: boolean,
  statusTool: string
): Promise<string> {
  const payload = { name, ...target };
  if (previewOnly) return `Preview only: ${JSON.stringify(payload)}. After human approval, set preview_only: false to submit this command.`;
  const command = await client.post<ArrCommand>("/command", payload);
  return `Submitted ${name}. [commandId:${command.id}] Status: ${command.status}. Use ${statusTool} to check completion.`;
}
