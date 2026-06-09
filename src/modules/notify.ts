import { ToolModule } from "../types.js";
import * as impl from "../tools/notify.js";

export function notifyModule(): ToolModule {
  return {
    domain: "Notifications",
    tools: [
      {
        name: "notify_telegram",
        description: "Send a message to Telegram via the homelab bot. Use to confirm destructive operations, report issues found via MCP, or send homelab alerts.",
        inputSchema: {
          type: "object",
          properties: { message: { type: "string", description: "Message to send" } },
          required: ["message"],
        },
      },
    ],

    async handle(name, args) {
      switch (name) {
        case "notify_telegram": return impl.notifyTelegram(impl.NotifyTelegramSchema.parse(args));
        default: return null;
      }
    },
  };
}
