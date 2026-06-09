import { UptimeKumaClient } from "../uptime-kuma.js";

interface MonitorMetric {
  name: string;
  type: string;
  url: string;
  status: number; // 1 = up, 0 = down
  ping: number | null;
}

function parseMetrics(raw: string): MonitorMetric[] {
  const monitors = new Map<string, Partial<MonitorMetric>>();

  for (const line of raw.split("\n")) {
    if (line.startsWith("#") || !line.trim()) continue;

    const labelMatch = line.match(/^(\w+)\{([^}]*)\}\s+([\d.]+)/);
    if (!labelMatch) continue;

    const [, metricName, labelsRaw, value] = labelMatch;
    const labels: Record<string, string> = {};
    for (const part of labelsRaw.split(",")) {
      const [k, v] = part.split("=");
      if (k && v) labels[k.trim()] = v.replace(/"/g, "").trim();
    }

    const id = labels.monitor_id;
    if (!id) continue;

    if (!monitors.has(id)) monitors.set(id, {});
    const m = monitors.get(id)!;

    if (metricName === "monitor_status") {
      m.name   = labels.monitor_name ?? id;
      m.type   = labels.monitor_type ?? "?";
      m.url    = labels.monitor_url ?? "";
      m.status = parseFloat(value);
    }
    if (metricName === "monitor_response_time") {
      m.ping = parseFloat(value);
    }
  }

  return [...monitors.values()].filter((m): m is MonitorMetric =>
    m.name !== undefined && m.status !== undefined
  ) as MonitorMetric[];
}

export async function uptimeStatus(client: UptimeKumaClient): Promise<string> {
  const raw = await client.getMetrics();
  const monitors = parseMetrics(raw);

  if (!monitors.length) return "No Uptime Kuma monitors found (check /metrics is enabled).";

  const up      = monitors.filter((m) => m.status === 1);
  const down    = monitors.filter((m) => m.status === 0);
  const unknown = monitors.filter((m) => m.status !== 0 && m.status !== 1);

  const fmt = (m: MonitorMetric) => {
    const ping = m.ping !== null ? ` | ${m.ping}ms` : "";
    const url  = m.url ? ` | ${m.url}` : "";
    return `  ${m.name}${ping}${url}`;
  };

  const lines: string[] = [
    `Uptime Kuma — ${monitors.length} monitor(s): ${up.length} up, ${down.length} down, ${unknown.length} unknown`,
  ];

  if (down.length)    { lines.push("\nDOWN:");    lines.push(...down.map(fmt)); }
  if (up.length)      { lines.push("\nUP:");      lines.push(...up.map(fmt)); }
  if (unknown.length) { lines.push("\nUNKNOWN:"); lines.push(...unknown.map(fmt)); }

  return lines.join("\n");
}
