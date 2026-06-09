import { describe, it, expect } from "vitest";

/**
 * Replicate the sanitizeError function from index.ts to test independently.
 */
function sanitizeError(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message
      // Redact apikey query params first (before the URL pattern eats the whole URL)
      .replace(/apikey=[^\s&]+/gi, "apikey=[redacted]")
      .replace(/https?:\/\/[^\s]+/g, "[redacted-url]")
      .replace(/\/[a-zA-Z0-9_-]{20,}/g, "/[redacted-token]");
    return msg;
  }
  return String(err);
}

describe("sanitizeError", () => {
  it("redacts URLs from error messages", () => {
    const err = new Error("Failed to connect to http://192.168.1.14:7878/api/v3/movie");
    expect(sanitizeError(err)).not.toContain("192.168.1.14");
    expect(sanitizeError(err)).toContain("[redacted-url]");
  });

  it("redacts HTTPS URLs", () => {
    const err = new Error("SSL error for https://192.168.1.10:8006/api2/json/nodes");
    expect(sanitizeError(err)).not.toContain("192.168.1.10");
    expect(sanitizeError(err)).toContain("[redacted-url]");
  });

  it("redacts API keys in query params", () => {
    // When the apikey is inside a URL, the URL regex eats the whole thing.
    // Both the URL and the secret are protected.
    const err = new Error("Request failed: http://host/api?apikey=abc123secret456&mode=queue");
    const sanitized = sanitizeError(err);
    expect(sanitized).not.toContain("abc123secret456");
    expect(sanitized).toContain("[redacted-url]");
  });

  it("redacts standalone apikey params (no URL context)", () => {
    const err = new Error("Invalid apikey=my-secret-token-12345 for request");
    const sanitized = sanitizeError(err);
    expect(sanitized).not.toContain("my-secret-token-12345");
    expect(sanitized).toContain("apikey=[redacted]");
  });

  it("redacts long token-like path segments", () => {
    const err = new Error("Not found: /api/abcdefghijklmnopqrstuvwxyz1234567890/resource");
    const sanitized = sanitizeError(err);
    expect(sanitized).not.toContain("abcdefghijklmnopqrstuvwxyz1234567890");
    expect(sanitized).toContain("[redacted-token]");
  });

  it("preserves short path segments", () => {
    const err = new Error("Not found: /api/v1/movie/123");
    const sanitized = sanitizeError(err);
    expect(sanitized).toContain("/api/v1");
  });

  it("handles non-Error values", () => {
    expect(sanitizeError("plain string")).toBe("plain string");
    expect(sanitizeError(42)).toBe("42");
    expect(sanitizeError(null)).toBe("null");
  });

  it("multiple URLs in one message", () => {
    const err = new Error("Chain: http://host1:8080 -> http://host2:9090 failed");
    const sanitized = sanitizeError(err);
    const redactions = sanitized.match(/\[redacted-url\]/g);
    expect(redactions?.length).toBe(2);
  });
});
