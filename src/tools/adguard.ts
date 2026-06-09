import { z } from "zod";
import { AdGuardClient } from "../adguard.js";

export const AdGuardCheckHostSchema = z.object({
  host: z.string().describe("Hostname or domain to check (e.g. ads.example.com)"),
});

export const AdGuardToggleSchema = z.object({
  enable: z.boolean().describe("true to enable filtering, false to disable"),
});

interface AdGuardStats {
  num_dns_queries: number;
  num_blocked_filtering: number;
  num_replaced_safebrowsing: number;
  avg_processing_time: number;
  top_queried_domains: Array<Record<string, number>>;
  top_blocked_domains: Array<Record<string, number>>;
}

interface AdGuardStatus {
  dns_addresses: string[];
  dns_port: number;
  http_port: number;
  protection_enabled: boolean;
  running: boolean;
  version: string;
}

export async function adguardGetStats(client: AdGuardClient): Promise<string> {
  const [stats, status] = await Promise.all([
    client.get<AdGuardStats>("/stats"),
    client.get<AdGuardStatus>("/status"),
  ]);

  const blockPct = stats.num_dns_queries > 0
    ? ((stats.num_blocked_filtering / stats.num_dns_queries) * 100).toFixed(1)
    : "0";

  const lines: string[] = [
    `AdGuard Home — v${status.version} | Protection: ${status.protection_enabled ? "ON" : "OFF"}`,
    `Queries: ${stats.num_dns_queries.toLocaleString()} | Blocked: ${stats.num_blocked_filtering.toLocaleString()} (${blockPct}%)`,
    `Avg response: ${(stats.avg_processing_time * 1000).toFixed(1)}ms`,
  ];

  const topQueried = stats.top_queried_domains?.slice(0, 5) ?? [];
  if (topQueried.length) {
    lines.push("\nTop queried:");
    topQueried.forEach((d) => {
      const [name, count] = Object.entries(d)[0];
      lines.push(`  ${name} — ${count}`);
    });
  }

  const topBlocked = stats.top_blocked_domains?.slice(0, 5) ?? [];
  if (topBlocked.length) {
    lines.push("\nTop blocked:");
    topBlocked.forEach((d) => {
      const [name, count] = Object.entries(d)[0];
      lines.push(`  ${name} — ${count}`);
    });
  }

  return lines.join("\n");
}

export async function adguardCheckHost(
  client: AdGuardClient,
  input: z.infer<typeof AdGuardCheckHostSchema>
): Promise<string> {
  const r = await client.post<{ reason: string; filter_id?: number; rule?: string }>(
    "/filtering/check_host",
    { name: input.host }
  );
  if (r.reason === "NotFilteredNotFound") return `${input.host} — NOT blocked (no matching rule)`;
  return `${input.host} — BLOCKED\n  Reason: ${r.reason}${r.rule ? `\n  Rule: ${r.rule}` : ""}`;
}

export async function adguardToggleProtection(
  client: AdGuardClient,
  input: z.infer<typeof AdGuardToggleSchema>
): Promise<string> {
  await client.post("/protection", { enabled: input.enable });
  return `AdGuard protection ${input.enable ? "enabled" : "disabled"}.`;
}
