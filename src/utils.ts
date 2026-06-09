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

// ─── Retry logic for transient HTTP failures ───────────────────────────────────

function isRetryable(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as Record<string, unknown>).code;
    // Common network error codes from Axios / Node.js
    if (code === "ECONNRESET" || code === "ECONNREFUSED" || code === "ETIMEDOUT" ||
        code === "ENOTFOUND" || code === "EPIPE" || code === "ERR_BAD_RESPONSE") {
      return true;
    }
  }
  if (err && typeof err === "object" && "response" in err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    if (status !== undefined && status >= 500) return true;
  }
  return false;
}

/**
 * Retry a promise-returning function with exponential backoff on transient failures.
 *
 * @param fn      — async function to retry
 * @param options — max retries and base delay; reads HTTP_RETRIES env var as override
 *
 * Defaults to 3 retries (500ms → 1s → 2s). Set HTTP_RETRIES=0 to disable.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: { retries?: number; baseDelay?: number }
): Promise<T> {
  const envRetries = process.env.HTTP_RETRIES;
  const maxRetries = envRetries !== undefined ? parseInt(envRetries, 10) || 0 : (options?.retries ?? 3);
  const baseDelay = options?.baseDelay ?? 500;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries && isRetryable(err)) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
  throw lastErr;
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

// ─── Secret redaction — defense-in-depth against credential leaks in tool output ─

/**
 * Keys matching these patterns are considered secrets.
 * Their values are redacted from all tool output as a safety net.
 *
 * This is the single source of truth — setup.ts imports this list.
 */
export const SECRET_KEY_PATTERNS = ["PASSWORD", "API_KEY", "TOKEN", "SECRET"];

/** Cached list of secret values from .env, built once at startup. */
let _secretValues: string[] | null = null;

function getSecretValues(): string[] {
  if (_secretValues !== null) return _secretValues;
  _secretValues = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (!value || value.length < 8) continue;
    if (SECRET_KEY_PATTERNS.some((p) => key.includes(p))) {
      _secretValues.push(value);
    }
  }
  return _secretValues;
}

/**
 * Scan tool output for any configured secret values and replace them with
 * [redacted-secret]. This is defense-in-depth — secrets should never reach
 * tool output, but if an upstream API echoes a key or token in an error
 * message, this prevents it from reaching the AI.
 */
export function redactSecrets(output: string): string {
  const secrets = getSecretValues();
  if (secrets.length === 0) return output;
  let result = output;
  for (const secret of secrets) {
    // Split-and-join is faster than global regex for literal strings
    result = result.split(secret).join("[redacted-secret]");
  }
  return result;
}

// ─── TTL cache for expensive / static tool results ────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
let _cacheSetCount = 0;

/**
 * Evict stale entries from the cache periodically.
 * Only runs when the cache has grown beyond a threshold to avoid
 * unnecessary work for small caches.
 */
function evictStale(): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now >= entry.expiresAt) cache.delete(key);
  }
}

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
    // Evict stale entries every 100 sets or when cache grows beyond 1000 entries
    _cacheSetCount++;
    if (_cacheSetCount % 100 === 0 || cache.size > 1000) {
      evictStale();
    }
    return value;
  });
}
