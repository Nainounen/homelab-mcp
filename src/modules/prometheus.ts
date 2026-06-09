import { ToolModule } from "../types.js";
import { PrometheusClient } from "../prometheus.js";
import * as impl from "../tools/prometheus.js";

export function prometheusModule(client: PrometheusClient): ToolModule {
  return {
    domain: "Prometheus",
    tools: [
      {
        name: "prometheus_snapshot",
        description: "Quick homelab metrics snapshot: CPU%, RAM, disk usage, network throughput, container count, and scrape target health.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "prometheus_query",
        description: "Run an arbitrary PromQL query against Prometheus. Use for ad-hoc metrics: container CPU/RAM, disk trends, network IO, etc.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "PromQL expression to evaluate" },
            unit: {
              type: "string",
              enum: ["bytes", "percent", "seconds", "none"],
              description: "Unit hint for formatting values (default: none)",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "prometheus_range_query",
        description: "Run a PromQL range query to get historical metric values over time. Useful for trend analysis (e.g. CPU over last 24h).",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "PromQL expression to evaluate" },
            duration: {
              type: "string",
              description: "Lookback window, e.g. '1h', '6h', '24h', '7d' (default: '1h')",
            },
            step: {
              type: "string",
              description: "Resolution step, e.g. '5m', '1h' (default: auto based on duration)",
            },
            unit: {
              type: "string",
              enum: ["bytes", "percent", "seconds", "none"],
              description: "Unit hint for formatting values (default: none)",
            },
          },
          required: ["query"],
        },
      },
    ],

    async handle(name, args) {
      switch (name) {
        case "prometheus_snapshot":    return impl.prometheusSnapshot(client);
        case "prometheus_query":       return impl.prometheusQuery(client, impl.PrometheusQuerySchema.parse(args));
        case "prometheus_range_query": return impl.prometheusRangeQuery(client, impl.PrometheusRangeQuerySchema.parse(args));
        default: return null;
      }
    },
  };
}
