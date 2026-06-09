import { ToolModule } from "../types.js";
import { OverseerrClient } from "../overseerr.js";
import * as impl from "../tools/overseerr.js";

export function serrModule(client: OverseerrClient): ToolModule {
  return {
    domain: "Seerr",
    tools: [
      {
        name: "seerr_list_requests",
        description: "List media requests from family members in Seerr.",
        inputSchema: {
          type: "object",
          properties: {
            filter: {
              type: "string",
              enum: ["all", "pending", "approved", "declined", "available", "processing"],
              description: "Filter by status (default: all)",
            },
            take: { type: "number", description: "Number of results to return (default 20)" },
          },
        },
      },
      {
        name: "seerr_approve_request",
        description: "Approve a pending media request in Seerr.",
        inputSchema: {
          type: "object",
          properties: { request_id: { type: "number", description: "Request ID" } },
          required: ["request_id"],
        },
      },
      {
        name: "seerr_decline_request",
        description: "Decline a media request in Seerr.",
        inputSchema: {
          type: "object",
          properties: { request_id: { type: "number", description: "Request ID" } },
          required: ["request_id"],
        },
      },
      {
        name: "seerr_delete_request",
        description: "Delete a media request from Seerr entirely.",
        inputSchema: {
          type: "object",
          properties: { request_id: { type: "number", description: "Request ID" } },
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
