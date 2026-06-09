import { ToolModule } from "../types.js";
import { PbsClient } from "../pbs.js";
import * as impl from "../tools/pbs.js";

export function pbsModule(client: PbsClient): ToolModule {
  return {
    domain: "Proxmox Backup Server",
    tools: [
      {
        name: "pbs_status",
        description: "Show Proxmox Backup Server datastore usage: total, used, and available space per datastore.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "pbs_list_snapshots",
        description: "List recent backup snapshots across all PBS datastores with timestamps and sizes.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "pbs_get_tasks",
        description: "Show recent PBS task history: backup jobs, verify tasks, garbage collection, with status and duration.",
        inputSchema: {
          type: "object",
          properties: { limit: { type: "number", description: "Number of tasks to return (default 20)" } },
        },
      },
    ],

    async handle(name, args) {
      switch (name) {
        case "pbs_status":         return impl.pbsGetStatus(client);
        case "pbs_list_snapshots": return impl.pbsListSnapshots(client);
        case "pbs_get_tasks":      return impl.pbsGetTasks(client, impl.PbsTasksSchema.parse(args));
        default: return null;
      }
    },
  };
}
