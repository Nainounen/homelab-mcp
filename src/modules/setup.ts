import { ToolModule } from "../types.js";
import * as impl from "../tools/setup.js";

/**
 * Setup wizard — AI-guided onboarding for new homelab-mcp installations.
 *
 * When a user says "set up my homelab" or "configure this," Claude can invoke
 * homelab_setup to read the current .env state, interactively collect missing
 * values, write them back, and then test connectivity — all through conversation.
 */
export function setupModule(): ToolModule {
  return {
    domain: "Setup",
    tools: [
      {
        name: "homelab_setup",
        description:
          "AI-guided setup wizard for homelab-mcp. " +
          "Use this when the user wants to set up, configure, or troubleshoot their homelab services. " +
          "Three modes: " +
          "'status' — reads .env and reports what's configured vs missing, " +
          "'configure' — saves key=value settings to .env, " +
          "'test' — pings all configured services to verify connectivity. " +
          "Call 'status' first to see what the user needs to provide, " +
          "then guide them through each missing value one section at a time, " +
          "saving with 'configure' as you go. " +
          "Finish with 'test' to confirm everything works.",
        inputSchema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["status", "configure", "test"],
              description: "What to do: 'status' shows what's configured vs missing, 'configure' saves one or more settings, 'test' checks connectivity",
            },
            updates: {
              type: "array",
              description: "Key-value pairs to write to .env. Only used with action='configure'.",
              items: {
                type: "object",
                properties: {
                  key: { type: "string", description: "Environment variable name (e.g. PROXMOX_HOST)" },
                  value: { type: "string", description: "Value to set" },
                },
                required: ["key", "value"],
              },
            },
          },
          required: ["action"],
        },
      },
    ],

    async handle(name, args) {
      switch (name) {
        case "homelab_setup":
          return impl.homelabSetup(impl.SetupSchema.parse(args));
        default:
          return null;
      }
    },
  };
}
