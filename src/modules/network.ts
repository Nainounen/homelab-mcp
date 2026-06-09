import { ToolModule } from "../types.js";
import { DevboxSSH } from "../ssh.js";
import * as impl from "../tools/network.js";

export function networkModule(devbox: DevboxSSH): ToolModule {
  return {
    domain: "Network",
    tools: [
      {
        name: "wol_send",
        description: "Send a Wake-on-LAN magic packet to wake a machine by its MAC address. Requires wakeonlan or etherwake on the devbox.",
        inputSchema: {
          type: "object",
          properties: {
            mac: { type: "string", description: "MAC address of the machine to wake (e.g. AA:BB:CC:DD:EE:FF)" },
            broadcast: { type: "string", description: "Broadcast address (default: 255.255.255.255)" },
          },
          required: ["mac"],
        },
      },
      {
        name: "tailscale_status",
        description: "Show Tailscale VPN status on the devbox: connected peers, IPs, and which devices are online.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
    ],

    async handle(name, args) {
      switch (name) {
        case "wol_send":          return impl.wolSend(devbox, impl.WolSchema.parse(args));
        case "tailscale_status":  return impl.tailscaleStatus(devbox);
        default: return null;
      }
    },
  };
}
