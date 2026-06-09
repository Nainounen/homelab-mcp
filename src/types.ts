import { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface ToolModule {
  /** Human-readable service name, e.g. "Proxmox", "Radarr". Used by homelab_capabilities. */
  domain: string;
  tools: Tool[];
  handle(name: string, args: Record<string, unknown>): Promise<string | null>;
}
