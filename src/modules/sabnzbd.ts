import { z } from "zod";
import { ToolModule } from "../types.js";
import { SabnzbdClient } from "../sabnzbd.js";
import * as impl from "../tools/sabnzbd.js";

export function sabnzbdModule(client: SabnzbdClient): ToolModule {
  const mutationSchemas: Record<string, z.ZodTypeAny> = {
    sabnzbd_pause_queue: z.object({}), sabnzbd_resume_queue: z.object({}),
    sabnzbd_delete_item: impl.SabDeleteSchema, sabnzbd_set_speed_limit: impl.SabSpeedLimitSchema,
    sabnzbd_pause_timed: impl.SabPauseTimedSchema, sabnzbd_set_item_priority: impl.SabItemPrioritySchema,
    sabnzbd_pause_item: impl.SabItemActionSchema, sabnzbd_resume_item: impl.SabItemActionSchema,
    sabnzbd_retry_item: impl.SabRetrySchema, sabnzbd_clear_history: impl.SabClearHistorySchema,
    sabnzbd_set_category: impl.SabCategorySetSchema, sabnzbd_delete_category: impl.SabCategoryDeleteSchema,
    sabnzbd_set_server: impl.SabServerSetSchema, sabnzbd_delete_server: impl.SabServerDeleteSchema,
    sabnzbd_set_switch: impl.SabSetSwitchSchema, sabnzbd_set_folder: impl.SabSetFolderSchema,
    sabnzbd_set_general: impl.SabSetGeneralSchema,
  };
  const listProperties = {
    limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    start: { type: "integer", minimum: 0, default: 0 },
    category: { type: "string" }, search: { type: "string" }, nzo_id: { type: "string" },
  };
  return {
    domain: "SABnzbd",
    tools: ([
      { name: "sabnzbd_get_warnings", description: "Read active SABnzbd warning and error messages.",
        inputSchema: { type: "object", properties: {} } },
      { name: "sabnzbd_get_job", description: "Inspect one exact NZO ID in queue or history, including failures, output paths and post-processing stages.",
        inputSchema: { type: "object", properties: { nzo_id: { type: "string" } }, required: ["nzo_id"] } },
      // ── Status & queue ───────────────────────────────────────────────────────
      {
        name: "sabnzbd_get_status",
        description: "Show SABnzbd global status: download speed, remaining data, ETA, disk space, paused state, and queue size.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "sabnzbd_list_queue",
        description: "List active SABnzbd download queue with NZO IDs, progress, ETA, and category for each NZB.",
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
        description: "Pause the entire SABnzbd download queue indefinitely.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "sabnzbd_resume_queue",
        description: "Resume the SABnzbd download queue.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "sabnzbd_delete_item",
        description: "Remove an NZB from the SABnzbd queue by its NZO ID (from sabnzbd_list_queue).",
        inputSchema: {
          type: "object",
          properties: {
            nzo_id: { type: "string", description: "NZO ID of the queue item to delete" },
            delete_files: { type: "boolean", description: "Also delete downloaded files (default false)" },
          },
          required: ["nzo_id"],
        },
      },
      {
        name: "sabnzbd_set_speed_limit",
        description: "Set the SABnzbd global download speed limit. Pass 0 to remove the limit.",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              anyOf: [{ type: "number", minimum: 0 }, { type: "string", pattern: "^(?:[0-9]+(?:\\.[0-9]+)?[KMkm]|(?:100|[0-9]{1,2})%|0)$" }],
              description: "Speed in MB/s (e.g. 50), or a percentage string like '50%' of the configured max. 0 = unlimited.",
            },
          },
          required: ["limit"],
        },
      },
      {
        name: "sabnzbd_pause_timed",
        description: "Pause SABnzbd for a set number of minutes, then auto-resume.",
        inputSchema: {
          type: "object",
          properties: {
            minutes: { type: "number", description: "How many minutes to pause (minimum 1)" },
          },
          required: ["minutes"],
        },
      },
      {
        name: "sabnzbd_set_item_priority",
        description: "Change the download priority of a queued NZB. Use sabnzbd_list_queue to get NZO IDs.",
        inputSchema: {
          type: "object",
          properties: {
            nzo_id: { type: "string", description: "NZO ID from sabnzbd_list_queue" },
            priority: {
              type: "string",
              enum: ["force", "high", "normal", "low", "paused"],
              description: "force > high > normal > low; paused = hold item without removing it",
            },
          },
          required: ["nzo_id", "priority"],
        },
      },
      {
        name: "sabnzbd_pause_item",
        description: "Pause a specific queued NZB without removing it.",
        inputSchema: {
          type: "object",
          properties: { nzo_id: { type: "string", description: "NZO ID from sabnzbd_list_queue" } },
          required: ["nzo_id"],
        },
      },
      {
        name: "sabnzbd_resume_item",
        description: "Resume a previously paused NZB in the queue.",
        inputSchema: {
          type: "object",
          properties: { nzo_id: { type: "string", description: "NZO ID from sabnzbd_list_queue" } },
          required: ["nzo_id"],
        },
      },
      {
        name: "sabnzbd_retry_item",
        description: "Retry a failed download from SABnzbd history. Use sabnzbd_get_history to get NZO IDs of failed items.",
        inputSchema: {
          type: "object",
          properties: { nzo_id: { type: "string", description: "NZO ID of a failed item from sabnzbd_get_history" } },
          required: ["nzo_id"],
        },
      },
      {
        name: "sabnzbd_clear_history",
        description: "Remove completed or failed entries from SABnzbd history.",
        inputSchema: {
          type: "object",
          properties: {
            target: {
              type: "string",
              enum: ["all", "failed"],
              description: "Clear all entries or only failed ones (default: all)",
            },
            nzo_id: { type: "string", description: "Remove a specific item by NZO ID (overrides target)" },
          },
        },
      },

      // ── Categories ────────────────────────────────────────────────────────────
      {
        name: "sabnzbd_list_categories",
        description: "List all SABnzbd download categories with their folder, post-processing, script, and priority settings.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "sabnzbd_set_category",
        description: "Create or update a SABnzbd download category (upsert by name).",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Category name" },
            dir: { type: "string", description: "Download path relative to complete_dir, or absolute" },
            pp: { type: "string", description: "Post-processing: '' = default, '0' = skip, '1' = repair, '2' = unpack, '3' = delete" },
            script: { type: "string", description: "Script filename in script_dir, 'Default', or 'None'" },
            priority: { type: "number", description: "Priority: -2 = paused, -1 = low, 0 = normal, 1 = high, 2 = force" },
            newzbin: { type: "string", description: "Newzbin category tags (comma-separated)" },
          },
          required: ["name"],
        },
      },
      {
        name: "sabnzbd_delete_category",
        description: "Delete a SABnzbd download category by name.",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string", description: "Exact category name to delete" } },
          required: ["name"],
        },
      },

      // ── Servers ───────────────────────────────────────────────────────────────
      {
        name: "sabnzbd_list_servers",
        description: "List all configured usenet servers in SABnzbd with their host, connections, SSL, priority, and enabled state.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "sabnzbd_set_server",
        description: "Add or update a usenet server in SABnzbd (upsert by name). Pass only the fields you want to change when editing.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Server identifier (use existing name to edit, new name to add)" },
            host: { type: "string", description: "Usenet server hostname or IP" },
            port: { type: "number", description: "Port (119 plain, 563 SSL)" },
            username: { type: "string" },
            password: { type: "string" },
            connections: { type: "number", description: "Max simultaneous connections" },
            ssl: { type: "boolean", description: "Enable SSL/TLS" },
            ssl_verify: { type: "number", description: "SSL verification: 0 = off, 1 = minimal, 2 = strict" },
            enable: { type: "boolean", description: "Enable or disable this server" },
            priority: { type: "number", description: "Server priority (0 = highest)" },
            retention: { type: "number", description: "Retention in days (0 = unlimited)" },
            required: { type: "boolean", description: "Fail the download if this server is unavailable" },
            optional: { type: "boolean", description: "Skip this server if unavailable without failing the download" },
            timeout: { type: "number", description: "Connection timeout in seconds" },
            send_group: { type: "boolean", description: "Send GROUP command before each article request" },
          },
          required: ["name"],
        },
      },
      {
        name: "sabnzbd_delete_server",
        description: "Remove a usenet server from SABnzbd by its name.",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string", description: "Server name to delete" } },
          required: ["name"],
        },
      },

      // ── Switches ──────────────────────────────────────────────────────────────
      {
        name: "sabnzbd_get_switches",
        description: "Show all SABnzbd behaviour switches such as direct_unpack, pre_check, top_only, auto_disconnect, no_dupes, and more.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "sabnzbd_set_switch",
        description: "Enable or disable a SABnzbd behaviour switch. Use sabnzbd_get_switches to see available keys and current values.",
        inputSchema: {
          type: "object",
          properties: {
            key: { type: "string", description: "Switch name, e.g. 'direct_unpack', 'pre_check', 'top_only', 'auto_disconnect'" },
            value: { description: "New value — booleans accepted as true/false or 1/0" },
          },
          required: ["key", "value"],
        },
      },

      // ── Folders ───────────────────────────────────────────────────────────────
      {
        name: "sabnzbd_get_folders",
        description: "Show all SABnzbd folder paths: incomplete downloads, completed, NZB backup, scripts, watched folder, and logs.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "sabnzbd_set_folder",
        description: "Update a SABnzbd folder path.",
        inputSchema: {
          type: "object",
          properties: {
            key: {
              type: "string",
              enum: ["download_dir", "complete_dir", "nzb_backup_dir", "admin_dir", "dirscan_dir", "script_dir", "log_dir"],
              description: "Folder to update",
            },
            path: { type: "string", description: "Absolute path" },
          },
          required: ["key", "path"],
        },
      },

      // ── General ───────────────────────────────────────────────────────────────
      {
        name: "sabnzbd_get_general",
        description: "Show SABnzbd general settings: host, port, bandwidth limits, web UI refresh rate, and language.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "sabnzbd_set_general",
        description: "Update a SABnzbd general setting. Use sabnzbd_get_general to see available keys and current values.",
        inputSchema: {
          type: "object",
          properties: {
            key: { type: "string", description: "Setting key, e.g. 'bandwidth_perc', 'bandwidth_max', 'refresh_rate', 'language'" },
            value: { description: "New value" },
          },
          required: ["key", "value"],
        },
      },
    ] as ToolModule["tools"]).map(tool => {
      if (tool.name === "sabnzbd_list_queue" || tool.name === "sabnzbd_get_history") {
        tool.inputSchema.properties = { ...listProperties, ...(tool.name === "sabnzbd_get_history" ? { failed_only: { type: "boolean", default: false } } : {}) };
      }
      if (mutationSchemas[tool.name]) {
        tool.description += " Preview by default; set preview_only=false only after human approval.";
        tool.inputSchema.properties = { ...tool.inputSchema.properties, preview_only: { type: "boolean", default: true } };
      }
      return tool;
    }),

    async handle(name, args) {
      if (mutationSchemas[name]) {
        const input = mutationSchemas[name].parse(args);
        const preview = z.boolean().default(true).parse(args.preview_only);
        if (preview) {
          const safe = JSON.stringify(input, (key, value) => /password|username/i.test(key) ? "[redacted]" : value);
          return `Preview: ${name} ${safe}. No changes made. Set preview_only=false after human approval.`;
        }
      }
      switch (name) {
        case "sabnzbd_get_warnings": return impl.sabnzbdGetWarnings(client);
        case "sabnzbd_get_job": return impl.sabnzbdGetJob(client, impl.SabJobSchema.parse(args));
        case "sabnzbd_get_status":       return impl.sabnzbdGetStatus(client);
        case "sabnzbd_list_queue":       return impl.sabnzbdListQueue(client, impl.SabQueueSchema.parse(args));
        case "sabnzbd_get_history":      return impl.sabnzbdGetHistory(client, impl.SabHistorySchema.parse(args));
        case "sabnzbd_pause_queue":      return impl.sabnzbdPauseQueue(client);
        case "sabnzbd_resume_queue":     return impl.sabnzbdResumeQueue(client);
        case "sabnzbd_delete_item":      return impl.sabnzbdDeleteItem(client, impl.SabDeleteSchema.parse(args));
        case "sabnzbd_set_speed_limit":  return impl.sabnzbdSetSpeedLimit(client, impl.SabSpeedLimitSchema.parse(args));
        case "sabnzbd_pause_timed":      return impl.sabnzbdPauseTimed(client, impl.SabPauseTimedSchema.parse(args));
        case "sabnzbd_set_item_priority": return impl.sabnzbdSetItemPriority(client, impl.SabItemPrioritySchema.parse(args));
        case "sabnzbd_pause_item":       return impl.sabnzbdPauseItem(client, impl.SabItemActionSchema.parse(args));
        case "sabnzbd_resume_item":      return impl.sabnzbdResumeItem(client, impl.SabItemActionSchema.parse(args));
        case "sabnzbd_retry_item":       return impl.sabnzbdRetryItem(client, impl.SabRetrySchema.parse(args));
        case "sabnzbd_clear_history":    return impl.sabnzbdClearHistory(client, impl.SabClearHistorySchema.parse(args));
        case "sabnzbd_list_categories":  return impl.sabnzbdListCategories(client);
        case "sabnzbd_set_category":     return impl.sabnzbdSetCategory(client, impl.SabCategorySetSchema.parse(args));
        case "sabnzbd_delete_category":  return impl.sabnzbdDeleteCategory(client, impl.SabCategoryDeleteSchema.parse(args));
        case "sabnzbd_list_servers":     return impl.sabnzbdListServers(client);
        case "sabnzbd_set_server":       return impl.sabnzbdSetServer(client, impl.SabServerSetSchema.parse(args));
        case "sabnzbd_delete_server":    return impl.sabnzbdDeleteServer(client, impl.SabServerDeleteSchema.parse(args));
        case "sabnzbd_get_switches":     return impl.sabnzbdGetSwitches(client);
        case "sabnzbd_set_switch":       return impl.sabnzbdSetSwitch(client, impl.SabSetSwitchSchema.parse(args));
        case "sabnzbd_get_folders":      return impl.sabnzbdGetFolders(client);
        case "sabnzbd_set_folder":       return impl.sabnzbdSetFolder(client, impl.SabSetFolderSchema.parse(args));
        case "sabnzbd_get_general":      return impl.sabnzbdGetGeneral(client);
        case "sabnzbd_set_general":      return impl.sabnzbdSetGeneral(client, impl.SabSetGeneralSchema.parse(args));
        default: return null;
      }
    },
  };
}
