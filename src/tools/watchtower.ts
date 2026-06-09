import { z } from "zod";
import { DevboxSSH } from "../ssh.js";

export const ContainerUpdateSchema = z.object({
  container: z.string().describe("Container name to update (pull latest image and restart)"),
  project_dir: z.string().optional().describe("Docker compose project dir — if set, uses compose pull + up instead of raw docker"),
});

export async function containerCheckUpdates(ssh: DevboxSSH): Promise<string> {
  // Get all running container image digests, then pull and compare
  const list = await ssh.exec(
    `docker ps --format "{{.Names}}\\t{{.Image}}" 2>/dev/null`
  );
  if (!list.stdout.trim()) return "No running containers found.";

  const containers = list.stdout.trim().split("\n").map((l) => {
    const [name, image] = l.split("\t");
    return { name, image };
  });

  const lines: string[] = [];
  for (const { name, image } of containers) {
    const before = await ssh.exec(`docker inspect --format "{{.Image}}" ${name} 2>/dev/null`);
    const pull   = await ssh.exec(`docker pull ${image} 2>&1 | tail -1`);
    const after  = await ssh.exec(`docker inspect --format "{{.Image}}" ${name} 2>/dev/null`);

    const hasUpdate = before.stdout.trim() !== after.stdout.trim();
    const status    = pull.stdout.includes("up to date") ? "up to date" : hasUpdate ? "UPDATED" : "up to date";
    lines.push(`${name} (${image}): ${status}`);
  }

  return lines.join("\n");
}

export async function containerUpdate(
  ssh: DevboxSSH,
  input: z.infer<typeof ContainerUpdateSchema>
): Promise<string> {
  const lines: string[] = [];

  if (input.project_dir) {
    const pull = await ssh.exec(`cd "${input.project_dir}" && docker compose pull ${input.container} 2>&1`);
    lines.push(`[pull] ${(pull.stdout || pull.stderr || "done").trim()}`);
    const up   = await ssh.exec(`cd "${input.project_dir}" && docker compose up -d ${input.container} 2>&1`);
    lines.push(`[up]   ${(up.stdout || up.stderr || "done").trim()}`);
  } else {
    const pull    = await ssh.exec(`docker pull $(docker inspect --format "{{.Config.Image}}" ${input.container}) 2>&1`);
    lines.push(`[pull] ${(pull.stdout || pull.stderr || "done").trim()}`);
    const restart = await ssh.exec(`docker restart ${input.container} 2>&1`);
    if (restart.exitCode !== 0) throw new Error(restart.stderr);
    lines.push(`[restart] ${input.container} restarted`);
  }

  return lines.join("\n");
}
