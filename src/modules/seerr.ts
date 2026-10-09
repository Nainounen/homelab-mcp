import { ToolModule } from "../types.js";
import { OverseerrClient } from "../overseerr.js";
import * as impl from "../tools/overseerr.js";

export function seerrModule(client: OverseerrClient): ToolModule {
  return {
    domain: "Seerr",
    tools: [
      { name: "seerr_get_request", description: "Inspect a request, media availability, season statuses and linked Arr IDs.",
        inputSchema: { type: "object", properties: { request_id: { type: "integer", minimum: 1 } }, required: ["request_id"] } },
      { name: "seerr_retry_request", description: "Preview or retry a failed request in Seerr. Applying sends it to the configured Arr service.",
        inputSchema: { type: "object", properties: { request_id: { type: "integer", minimum: 1 }, preview_only: { type: "boolean", default: true } }, required: ["request_id"] } },
      {
        name: "seerr_list_requests",
        description: "List media requests from family members in Seerr.",
        inputSchema: {
          type: "object",
          properties: {
            filter: {
              type: "string",
              enum: ["all", "pending", "approved", "declined", "available", "processing", "failed", "completed", "unavailable"],
              description: "Filter by status (default: all)",
            },
            take: { type: "integer", minimum: 1, maximum: 100, description: "Number of results (default 20)" },
            skip: { type: "integer", minimum: 0, description: "Pagination offset (default 0)" },
            include_titles: { type: "boolean", default: false, description: "Fetch titles using extra metadata calls; disabled by default for speed" },
          },
        },
      },
      {
        name: "seerr_approve_request",
        description: "Approve a pending media request in Seerr.",
        inputSchema: {
          type: "object",
          properties: { request_id: { type: "integer", minimum: 1, description: "Request ID" }, preview_only: { type: "boolean", default: true, description: "Preview by default; false only after human approval" } },
          required: ["request_id"],
        },
      },
      {
        name: "seerr_decline_request",
        description: "Decline a media request in Seerr.",
        inputSchema: {
          type: "object",
          properties: { request_id: { type: "integer", minimum: 1, description: "Request ID" }, preview_only: { type: "boolean", default: true, description: "Preview by default; false only after human approval" } },
          required: ["request_id"],
        },
      },
      {
        name: "seerr_delete_request",
        description: "Delete a media request from Seerr entirely.",
        inputSchema: {
          type: "object",
          properties: { request_id: { type: "integer", minimum: 1, description: "Request ID" }, preview_only: { type: "boolean", default: true, description: "Preview by default; false only after human approval" } },
          required: ["request_id"],
        },
      },
      {
        name: "seerr_stats",
        description: "Show request statistics from Seerr: total, pending, approved, declined, etc.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
    ],

    async handle(name, args) {
      switch (name) {
        case "seerr_get_request": return impl.overseerrGetRequest(client, impl.OverseerrRequestSchema.parse(args));
        case "seerr_retry_request": return impl.overseerrRetryRequest(client, impl.OverseerrRequestActionSchema.parse(args));
        case "seerr_list_requests":  return impl.overseerrListRequests(client, impl.OverseerrListSchema.parse(args));
        case "seerr_approve_request": return impl.overseerrApproveRequest(client, impl.OverseerrRequestActionSchema.parse(args));
        case "seerr_decline_request": return impl.overseerrDeclineRequest(client, impl.OverseerrRequestActionSchema.parse(args));
        case "seerr_delete_request": return impl.overseerrDeleteRequest(client, impl.OverseerrRequestActionSchema.parse(args));
        case "seerr_stats":          return impl.overseerrGetStats(client);
        default: return null;
      }
    },
  };
}
