import { ToolModule } from "../types.js";
import { DevboxSSH } from "../ssh.js";
import * as impl from "../tools/watchtower.js";

export function watchtowerModule(devbox: DevboxSSH): ToolModule {
  return {
    domain: "Container Updates",
    tools: [
      {
        name: "container_check_updates",
        description: "Pull latest images for all running containers on the devbox and report which have updates available.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "container_update",
        description: "Update a specific container on the devbox: pull the latest image and restart it. If project_dir is provided, uses docker compose pull + up instead.",
        inputSchema: {
          type: "object",
          properties: {
            container: { type: "string", description: "Container name to update" },
            project_dir: { type: "string", description: "Docker compose project dir (optional — uses compose if set)" },
          },
          required: ["container"],
        },
      },
    ],

    async handle(name, args) {
      switch (name) {
        case "container_check_updates": return impl.containerCheckUpdates(devbox);
        case "container_update":        return impl.containerUpdate(devbox, impl.ContainerUpdateSchema.parse(args));
        default: return null;
      }
    },
  };
}
