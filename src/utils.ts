import { ArrClient } from "./arr.js";

export function bytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  return `${n} B`;
}

export function speed(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB/s`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(0)} KB/s`;
  return "0 KB/s";
}

export interface QualityProfile {
  id: number;
  name: string;
}

export async function getFirstQualityProfileId(client: ArrClient, appName: string): Promise<number> {
  const profiles = await client.get<QualityProfile[]>("/qualityprofile");
  if (!profiles.length) throw new Error(`No quality profiles found in ${appName}`);
  const any = profiles.find((p) => p.name.toLowerCase() === "any");
  return (any ?? profiles[0]).id;
}

/**
 * Strip internal details (URLs, IPs, file paths, tokens) from error messages
 * before returning them to the MCP client. Full errors are always logged to stderr.
 */
export function sanitizeError(err: unknown): string {
  if (err instanceof Error) {
    // Axios errors contain the full URL (with API keys in query params)
    const msg = err.message
      // Redact apikey query params first (before URL regex eats the whole URL)
      .replace(/apikey=[^\s&]+/gi, "apikey=[redacted]")
      .replace(/https?:\/\/[^\s]+/g, "[redacted-url]")
      .replace(/\/[a-zA-Z0-9_-]{20,}/g, "/[redacted-token]");
    return msg;
  }
  return String(err);
}

// ─── TTL cache for expensive / static tool results ────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

/**
 * Get-or-compute a cached value with a TTL in milliseconds.
 * Used for tools like homelab_capabilities (static) and homelab_health (30s stale OK).
 */
export function cached<T>(key: string, ttlMs: number, factory: () => Promise<T>): Promise<T> {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiresAt) {
    return Promise.resolve(entry.value as T);
  }
  return factory().then((value) => {
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  });
}
