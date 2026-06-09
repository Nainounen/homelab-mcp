import { ToolModule } from "../types.js";
import { ProxmoxClient } from "../proxmox.js";
import { ProxmoxSSH } from "../ssh.js";
import * as impl from "../tools/proxmox.js";

const vmIdProps = {
  vmid: { type: "number", description: "VM or container ID" },
  type: { type: "string", enum: ["qemu", "lxc"], description: "qemu for VMs, lxc for containers" },
} as const;

export function proxmoxModule(client: ProxmoxClient, ssh: ProxmoxSSH): ToolModule {
  return {
    domain: "Proxmox",
    tools: [
      {
        name: "proxmox_list_nodes",
        description: "List all Proxmox nodes with their status, CPU usage, RAM usage, and uptime.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "proxmox_list_vms",
        description: "List all VMs (QEMU) and LXC containers on the configured Proxmox node.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "proxmox_start_vm",
        description: "Start a VM or LXC container by its VMID.",
        inputSchema: { type: "object", properties: { ...vmIdProps }, required: ["vmid", "type"] },
      },
      {
        name: "proxmox_stop_vm",
        description: "Stop (graceful shutdown) a VM or LXC container by its VMID.",
        inputSchema: { type: "object", properties: { ...vmIdProps }, required: ["vmid", "type"] },
      },
      {
        name: "proxmox_restart_vm",
        description: "Restart a VM or LXC container by its VMID.",
        inputSchema: { type: "object", properties: { ...vmIdProps }, required: ["vmid", "type"] },
      },
      {
        name: "proxmox_get_metrics",
        description: "Get detailed CPU, RAM, disk, and uptime metrics for a specific VM or LXC container.",
        inputSchema: { type: "object", properties: { ...vmIdProps }, required: ["vmid", "type"] },
      },
      {
        name: "proxmox_get_node_metrics",
        description: "Get resource usage (CPU, RAM, disk, load average, uptime) for the Proxmox node itself.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "proxmox_create_ct",
        description: "Create a new Debian 12 LXC container on the Proxmox node.",
        inputSchema: {
          type: "object",
          properties: {
            hostname: { type: "string", description: "Hostname for the new container" },
            cores: { type: "number", description: "Number of CPU cores" },
            memory: { type: "number", description: "RAM in MB" },
            disk: { type: "number", description: "Root disk size in GB" },
            ip: { type: "string", description: "Static IPv4 address (e.g. 192.168.1.50)" },
            password: { type: "string", description: "Root password for the container" },
          },
          required: ["hostname", "cores", "memory", "disk", "ip", "password"],
        },
      },
      {
        name: "proxmox_get_logs",
        description: "Retrieve the last N log lines from a VM or LXC container (default 100 lines).",
        inputSchema: {
          type: "object",
          properties: { ...vmIdProps, lines: { type: "number", description: "Number of log lines" } },
          required: ["vmid", "type"],
        },
      },
      {
        name: "proxmox_exec",
        description: "Execute a shell command on the Proxmox host via SSH. Use for disk operations and host-level administration. Destructive commands are blocked.",
        inputSchema: {
          type: "object",
          properties: {
            command: { type: "string", description: "Shell command to run on the Proxmox host" },
            cwd: { type: "string", description: "Working directory (default: /)" },
          },
          required: ["command"],
        },
      },
    ],

    async handle(name, args) {
      switch (name) {
        case "proxmox_list_nodes":     return impl.proxmoxListNodes(client);
        case "proxmox_list_vms":       return impl.proxmoxListVms(client);
        case "proxmox_start_vm":       return impl.proxmoxStartVm(client, impl.VmActionSchema.parse(args));
        case "proxmox_stop_vm":        return impl.proxmoxStopVm(client, impl.VmActionSchema.parse(args));
        case "proxmox_restart_vm":     return impl.proxmoxRestartVm(client, impl.VmActionSchema.parse(args));
        case "proxmox_get_metrics":    return impl.proxmoxGetMetrics(client, impl.VmMetricsSchema.parse(args));
        case "proxmox_get_node_metrics": return impl.proxmoxGetNodeMetrics(client);
        case "proxmox_create_ct":      return impl.proxmoxCreateCt(client, impl.CreateCtSchema.parse(args));
        case "proxmox_get_logs":       return impl.proxmoxGetLogs(client, impl.GetLogsSchema.parse(args));
        case "proxmox_exec":           return impl.proxmoxExec(ssh, impl.PveExecSchema.parse(args));
        default: return null;
      }
    },
  };
}
