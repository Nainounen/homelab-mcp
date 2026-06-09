import { ToolModule } from "../types.js";
import { QnapSSH } from "../qnap.js";
import * as impl from "../tools/qnap.js";

export function qnapModule(getClient: () => QnapSSH): ToolModule {
  return {
    domain: "QNAP",
    tools: [
      {
        name: "qnap_status",
        description: "Show QNAP NAS status: RAID health, drive temperatures, and storage usage per share.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "qnap_disk_health",
        description: "Show SMART health data for all drives in the QNAP NAS.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "qnap_storage_usage",
        description: "Show detailed storage usage for all QNAP shares and LVM volume group.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "qnap_raid_status",
        description: "Check QNAP RAID array health — confirms all drives are healthy and synced.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
    ],

    async handle(name, _args) {
      switch (name) {
        case "qnap_status":        return impl.qnapStatus(getClient());
        case "qnap_disk_health":   return impl.qnapDiskHealth(getClient());
        case "qnap_storage_usage": return impl.qnapStorageUsage(getClient());
        case "qnap_raid_status":   return impl.qnapRaidStatus(getClient());
        default: return null;
      }
    },
  };
}
