import { ToolModule } from "../types.js";
import { SabnzbdClient } from "../sabnzbd.js";
import * as impl from "../tools/sabnzbd.js";

export function sabnzbdModule(client: SabnzbdClient): ToolModule {
  return {
    domain: "SABnzbd",
    tools: [
      {
        name: "sabnzbd_get_status",
        description: "Show SABnzbd global status: download speed, remaining data, ETA, disk space, paused state, and queue size.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "sabnzbd_list_queue",
        description: "List active SABnzbd download queue with progress, ETA, and category for each NZB.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "sabnzbd_get_history",
        description: "Show recent SABnzbd download history with status, size, completion time, and any failure messages.",
        inputSchema: {
          type: "object",
          properties: { limit: { type: "number", description: "Number of history entries to return (default: 20)" } },
        },
      },
      {
        name: "sabnzbd_pause_queue",
        description: "Pause the SABnzbd download queue.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "sabnzbd_resume_queue",
        description: "Resume the SABnzbd download queue.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "sabnzbd_delete_item",
        description: "Delete an item from the SABnzbd queue by its NZO ID. Optionally also deletes downloaded files.",
        inputSchema: {
          type: "object",
          properties: {
            nzo_id: { type: "string", description: "NZO ID of the queue item to delete" },
            delete_files: { type: "boolean", description: "Also delete downloaded files (default false)" },
          },
          required: ["nzo_id"],
        },
      },
    ],

    async handle(name, args) {
      switch (name) {
        case "sabnzbd_get_status":  return impl.sabnzbdGetStatus(client);
        case "sabnzbd_list_queue":  return impl.sabnzbdListQueue(client);
        case "sabnzbd_get_history": return impl.sabnzbdGetHistory(client, impl.SabHistorySchema.parse(args));
        case "sabnzbd_pause_queue": return impl.sabnzbdPauseQueue(client);
        case "sabnzbd_resume_queue": return impl.sabnzbdResumeQueue(client);
        case "sabnzbd_delete_item": return impl.sabnzbdDeleteItem(client, impl.SabDeleteSchema.parse(args));
        default: return null;
      }
    },
  };
}
