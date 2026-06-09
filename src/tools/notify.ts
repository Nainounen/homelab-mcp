import { z } from "zod";
import { sendTelegramNotification } from "../notify.js";

export const NotifyTelegramSchema = z.object({
  message: z.string().describe("Message to send to Telegram"),
});

export async function notifyTelegram(input: z.infer<typeof NotifyTelegramSchema>): Promise<string> {
  await sendTelegramNotification(input.message);
  return `Sent to Telegram: "${input.message}"`;
}
