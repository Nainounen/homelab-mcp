import { z } from "zod";
import { PrometheusClient } from "../prometheus.js";

function fmt(v: string, unit?: string): string {
  const n = parseFloat(v);
  if (isNaN(n)) return v;
  if (unit === "bytes") {
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`;
    return `${n} B`;
  }
  if (unit === "percent") return `${n.toFixed(1)}%`;
  if (unit === "seconds") {
    if (n >= 3600) return `${(n / 3600).toFixed(1)}h`;
    if (n >= 60) return `${(n / 60).toFixed(1)}m`;
    return `${n.toFixed(1)}s`;
  }
  return n.toFixed(4).replace(/\.?0+$/, "");
}

export const PrometheusQuerySchema = z.object({
  query: z.string().describe("PromQL expression to evaluate"),
  unit: z.enum(["bytes", "percent", "seconds", "none"]).optional().default("none")
    .describe("Unit hint for formatting values (bytes, percent, seconds, none)"),
});

export const PrometheusSnapshotSchema = z.object({});

// Pre-built homelab snapshot: CPU, RAM, disk, network, container count
export async function prometheusSnapshot(client: PrometheusClient): Promise<string> {
  const queries: Array<[string, string, string]> = [
    ["CPU usage", `100 - (avg(irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)`, "percent"],
    ["RAM used", `node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes`, "bytes"],
    ["RAM total", `node_memory_MemTotal_bytes`, "bytes"],
    ["Disk used /mnt/data", `node_filesystem_size_bytes{mountpoint="/mnt/data"} - node_filesystem_avail_bytes{mountpoint="/mnt/data"}`, "bytes"],
    ["Disk free /mnt/data", `node_filesystem_avail_bytes{mountpoint="/mnt/data"}`, "bytes"],
    ["Net RX (5m avg)", `irate(node_network_receive_bytes_total{device="eth0"}[5m])`, "bytes"],
    ["Net TX (5m avg)", `irate(node_network_transmit_bytes_total{device="eth0"}[5m])`, "bytes"],
    ["Running containers", `count(container_last_seen{name!=""})`, "none"],
  ];

  const results = await Promise.allSettled(
    queries.map(([, q]) => client.query(q))
  );

  const lines: string[] = [];
  for (let i = 0; i < queries.length; i++) {
    const [label, , unit] = queries[i];
    const res = results[i];
    if (res.status === "fulfilled" && res.value.length > 0) {
      lines.push(`${label}: ${fmt(res.value[0].value[1], unit)}`);
    } else {
      lines.push(`${label}: n/a`);
    }
  }

  const targetsRes = await client.targets().catch(() => []);
  const down = targetsRes.filter((t) => t.health !== "up");
  lines.push(`Scrape targets: ${targetsRes.length} total, ${down.length} down`);
  if (down.length) lines.push(...down.map((t) => `  ⚠ ${t.job} (${t.instance}): ${t.lastError ?? "unknown"}`));

  return lines.join("\n");
}

export const PrometheusRangeQuerySchema = z.object({
  query: z.string().describe("PromQL expression to evaluate"),
  duration: z.string().optional().default("1h").describe("Lookback window, e.g. '1h', '6h', '24h', '7d'"),
  step: z.string().optional().describe("Resolution step, e.g. '5m', '1h' (default: auto)"),
  unit: z.enum(["bytes", "percent", "seconds", "none"]).optional().default("none")
    .describe("Unit hint for formatting values"),
});

function parseDurationToSeconds(d: string): number {
  const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
  const match = d.match(/^(\d+)([smhdw])$/);
  if (!match) return 3600;
  return parseInt(match[1]) * (units[match[2]] ?? 3600);
}

export async function prometheusRangeQuery(
  client: PrometheusClient,
  input: z.infer<typeof PrometheusRangeQuerySchema>
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const durationSecs = parseDurationToSeconds(input.duration ?? "1h");
  const start = String(now - durationSecs);
  const end = String(now);

  const autoStep = Math.max(60, Math.floor(durationSecs / 100));
  const step = input.step ?? `${autoStep}s`;

  const results = await client.queryRange(input.query, start, end, step);
  if (!results.length) return "No results.";

  const unit = input.unit === "none" ? undefined : input.unit;
  return results.map((r) => {
    const labels = Object.entries(r.metric)
      .filter(([k]) => k !== "__name__")
      .map(([k, v]) => `${k}="${v}"`)
      .join(", ");
    const header = labels ? `{${labels}}` : r.metric.__name__ ?? "result";
    const first = fmt(r.values[0][1], unit);
    const last = fmt(r.values[r.values.length - 1][1], unit);
    const nums = r.values.map(([, v]) => parseFloat(v)).filter((n) => !isNaN(n));
    const avg = nums.length ? fmt(String(nums.reduce((a, b) => a + b) / nums.length), unit) : "n/a";
    const max = nums.length ? fmt(String(Math.max(...nums)), unit) : "n/a";
    return `${header}\n  first=${first} last=${last} avg=${avg} max=${max} (${r.values.length} points)`;
  }).join("\n\n");
}

export async function prometheusQuery(
  client: PrometheusClient,
  input: z.infer<typeof PrometheusQuerySchema>
): Promise<string> {
  const results = await client.query(input.query);
  if (!results.length) return "No results.";
  return results
    .map((r) => {
      const labels = Object.entries(r.metric)
        .filter(([k]) => k !== "__name__")
        .map(([k, v]) => `${k}="${v}"`)
        .join(", ");
      const val = fmt(r.value[1], input.unit === "none" ? undefined : input.unit);
      return labels ? `{${labels}} = ${val}` : val;
    })
    .join("\n");
}
