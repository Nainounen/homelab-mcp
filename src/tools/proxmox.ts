import { z } from "zod";
import { ProxmoxClient } from "../proxmox.js";
import { ProxmoxSSH } from "../ssh.js";
import { bytes } from "../utils.js";

// ── Rate limiting ──────────────────────────────────────────────────────────

const lastCtCreate = new Map<string, number>();

function checkCreateRate(node: string): void {
  const last = lastCtCreate.get(node) ?? 0;
  const elapsed = Date.now() - last;
  const COOLDOWN = 30_000; // 30 seconds between CT creations
  if (elapsed < COOLDOWN) {
    throw new Error(
      `Please wait ${Math.ceil((COOLDOWN - elapsed) / 1000)}s before creating another container.`
    );
  }
  lastCtCreate.set(node, Date.now());
}

type VmType = "qemu" | "lxc";

function uptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

/** Coerce unknown API values into finite numbers for stable formatting. */
function toFiniteNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// ─── Input schemas ────────────────────────────────────────────────────────────

export const VmActionSchema = z.object({
  vmid: z.number().int().positive().describe("VM or container ID"),
  type: z.enum(["qemu", "lxc"]).describe("qemu for VMs, lxc for containers"),
});

export const VmMetricsSchema = VmActionSchema;

export const CreateCtSchema = z.object({
  hostname: z.string().describe("Hostname for the new container"),
  cores: z.number().int().min(1).describe("Number of CPU cores"),
  memory: z.number().int().min(64).describe("RAM in MB"),
  disk: z.number().int().min(1).describe("Root disk size in GB"),
  ip: z.string().describe("Static IPv4 address (e.g. 192.168.1.50)"),
  password: z.string().describe("Root password for the container"),
});

export const GetLogsSchema = z.object({
  vmid: z.number().int().positive().describe("VM or container ID"),
  type: z.enum(["qemu", "lxc"]).describe("qemu for VMs, lxc for containers"),
  lines: z
    .number()
    .int()
    .min(1)
    .max(5000)
    .optional()
    .default(100)
    .describe("Number of log lines to return (default 100)"),
});

// ─── Tool implementations ─────────────────────────────────────────────────────

/**
 * List all Proxmox nodes with their status and resource usage.
 */
export async function proxmoxListNodes(
  client: ProxmoxClient
): Promise<string> {
  const nodes = await client.get<
    Array<{
      node: string;
      status: string;
      cpu: number;
      mem: number;
      maxmem: number;
      uptime: number;
    }>
  >("/nodes");

  return nodes
    .map(
      (n) =>
        `${n.node} | status=${n.status} cpu=${(n.cpu * 100).toFixed(1)}% ` +
        `ram=${bytes(n.mem)}/${bytes(n.maxmem)} uptime=${uptime(n.uptime)}`
    )
    .join("\n");
}

/**
 * List all VMs and LXC containers on the configured node.
 */
export async function proxmoxListVms(client: ProxmoxClient): Promise<string> {
  const node = client.node;
  const [vms, cts] = await Promise.all([
    client
      .get<
        Array<{
          vmid: number;
          name: string;
          status: string;
          cpu: number;
          mem: number;
          maxmem: number;
        }>
      >(`/nodes/${node}/qemu`)
      .catch(() => []),
    client
      .get<
        Array<{
          vmid: number;
          name: string;
          status: string;
          cpu: number;
          mem: number;
          maxmem: number;
        }>
      >(`/nodes/${node}/lxc`)
      .catch(() => []),
  ]);

  const format = (
    list: typeof vms,
    type: string
  ): string =>
    list
      .map(
        (v) =>
          `[${type}] ${v.vmid} ${v.name || "(no name)"} | ` +
          `status=${v.status} cpu=${(v.cpu * 100).toFixed(1)}% ` +
          `ram=${bytes(v.mem)}/${bytes(v.maxmem)}`
      )
      .join("\n");

  const lines = [format(vms, "vm"), format(cts, "ct")]
    .filter(Boolean)
    .join("\n");
  return lines || "No VMs or containers found";
}

/**
 * Start a VM or LXC container.
 */
export async function proxmoxStartVm(
  client: ProxmoxClient,
  input: z.infer<typeof VmActionSchema>
): Promise<string> {
  const path = `/nodes/${client.node}/${input.type}/${input.vmid}/status/start`;
  await client.post(path);
  return `Started ${input.type} ${input.vmid}`;
}

/**
 * Stop a VM or LXC container (graceful shutdown).
 */
export async function proxmoxStopVm(
  client: ProxmoxClient,
  input: z.infer<typeof VmActionSchema>
): Promise<string> {
  const path = `/nodes/${client.node}/${input.type}/${input.vmid}/status/stop`;
  await client.post(path);
  return `Stopped ${input.type} ${input.vmid}`;
}

/**
 * Restart a VM or LXC container.
 */
export async function proxmoxRestartVm(
  client: ProxmoxClient,
  input: z.infer<typeof VmActionSchema>
): Promise<string> {
  const path = `/nodes/${client.node}/${input.type}/${input.vmid}/status/reboot`;
  await client.post(path);
  return `Restarted ${input.type} ${input.vmid}`;
}

/**
 * Get detailed metrics for a specific VM or container.
 */
export async function proxmoxGetMetrics(
  client: ProxmoxClient,
  input: z.infer<typeof VmMetricsSchema>
): Promise<string> {
  const path = `/nodes/${client.node}/${input.type}/${input.vmid}/status/current`;
  const s = await client.get<{
    status: string;
    cpu: number;
    mem: number;
    maxmem: number;
    disk: number;
    maxdisk: number;
    uptime: number;
    name?: string;
  }>(path);

  return (
    `${s.name ?? input.vmid} | status=${s.status}\n` +
    `CPU:  ${(s.cpu * 100).toFixed(2)}%\n` +
    `RAM:  ${bytes(s.mem)} / ${bytes(s.maxmem)} (${((s.mem / s.maxmem) * 100).toFixed(1)}%)\n` +
    `Disk: ${bytes(s.disk)} / ${bytes(s.maxdisk)}\n` +
    `Up:   ${uptime(s.uptime)}`
  );
}

/**
 * Get resource usage for the Proxmox node itself.
 */
export async function proxmoxGetNodeMetrics(
  client: ProxmoxClient
): Promise<string> {
  const s = await client.get<{
    cpu: number;
    memory: { used: number; total: number };
    rootfs: { used: number; total: number };
    loadavg: Array<number | string>;
    uptime: number;
  }>(`/nodes/${client.node}/status`);

  const load = Array.isArray(s.loadavg)
    ? s.loadavg.slice(0, 3).map((v) => toFiniteNumber(v).toFixed(2)).join(", ")
    : "n/a";

  return (
    `Node: ${client.node}\n` +
    `CPU:  ${(s.cpu * 100).toFixed(2)}%\n` +
    `RAM:  ${bytes(s.memory.used)} / ${bytes(s.memory.total)}\n` +
    `Disk: ${bytes(s.rootfs.used)} / ${bytes(s.rootfs.total)}\n` +
    `Load: ${load}\n` +
    `Up:   ${uptime(s.uptime)}`
  );
}

/**
 * Create a new Debian 12 LXC container.
 * Returns the new CTID assigned by Proxmox.
 */
export async function proxmoxCreateCt(
  client: ProxmoxClient,
  input: z.infer<typeof CreateCtSchema>
): Promise<string> {
  // Rate limit — prevent rapid-fire CT creation
  checkCreateRate(client.node);

  // Get next available CTID
  const nextId = await client.get<number>("/cluster/nextid");

  await client.post(`/nodes/${client.node}/lxc`, {
    vmid: nextId,
    hostname: input.hostname,
    cores: input.cores,
    memory: input.memory,
    rootfs: `${process.env.PROXMOX_CT_STORAGE ?? "local-lvm"}:${input.disk}`,
    ostemplate: process.env.PROXMOX_CT_TEMPLATE ?? "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst",
    password: input.password,
    net0: `name=eth0,bridge=${process.env.PROXMOX_CT_BRIDGE ?? "vmbr0"},ip=${input.ip}/24,gw=${process.env.PROXMOX_GATEWAY}`,
    storage: process.env.PROXMOX_CT_STORAGE ?? "local-lvm",
    start: 1,
  });

  return `Created LXC container ${nextId} (${input.hostname}) with IP ${input.ip}`;
}

/**
 * Retrieve the last N log lines from a VM or container.
 */
export async function proxmoxGetLogs(
  client: ProxmoxClient,
  input: z.infer<typeof GetLogsSchema>
): Promise<string> {
  const path = `/nodes/${client.node}/${input.type}/${input.vmid}/log`;
  const lines = await client.get<Array<{ n: number; t: string }>>(path);
  const tail = lines.slice(-input.lines!);
  return tail.map((l) => l.t).join("\n") || "(no logs)";
}

// ─── Proxmox SSH exec ─────────────────────────────────────────────────────────

export const PveExecSchema = z.object({
  command: z.string().describe("Shell command to run on the Proxmox host"),
  cwd: z.string().optional().default("/").describe("Working directory (default: /)"),
});

export async function proxmoxExec(
  ssh: ProxmoxSSH,
  input: z.infer<typeof PveExecSchema>
): Promise<string> {
  const result = await ssh.exec(input.command, input.cwd);
  const parts: string[] = [];
  if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
  if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
  parts.push(`exit code: ${result.exitCode}`);
  return parts.join("\n\n");
}
