import { z } from "zod";
import { DevboxSSH } from "../ssh.js";

// ─── Input schemas ────────────────────────────────────────────────────────────

export const ExecSchema = z.object({
  command: z.string().describe("Shell command to execute on the devbox"),
  cwd: z
    .string()
    .optional()
    .default("/root")
    .describe("Working directory (default: /root)"),
});

export const ReadFileSchema = z.object({
  path: z.string().describe("Absolute path of the file to read"),
});

export const WriteFileSchema = z.object({
  path: z.string().describe("Absolute path of the file to write"),
  content: z.string().max(1_048_576, "Content exceeds 1 MB limit").describe("File content to write (max 1 MB)"),
});

export const ListDirSchema = z.object({
  path: z.string().describe("Absolute path of the directory to list"),
});

export const DockerComposeSchema = z.object({
  action: z
    .enum(["up", "down", "restart", "pull", "logs"])
    .describe("Docker Compose action to perform"),
  project_dir: z
    .string()
    .describe("Absolute path to the docker-compose project directory"),
  service: z
    .string()
    .optional()
    .describe("Optional: target a specific service within the compose project"),
});

export const GitSchema = z.object({
  action: z
    .enum(["status", "pull", "log", "clone"])
    .describe("Git action: status, pull, log (last 20 commits), or clone"),
  repo_dir: z
    .string()
    .describe("Absolute path to the git repository directory (target directory for clone)"),
  repo_url: z
    .string()
    .optional()
    .describe("Remote repository URL (required for clone action)"),
  branch: z
    .string()
    .optional()
    .describe("Branch name to clone (default: main)"),
});

const DEFAULT_PROJECTS_DIR = process.env.DEVBOX_PROJECTS_DIR || "/opt/projects";

export const ProjectDeploySchema = z.object({
  project_dir: z
    .string()
    .describe("Absolute path to the docker-compose project directory"),
});

export const ProjectStatusSchema = z.object({
  project_dir: z
    .string()
    .describe("Absolute path to the docker-compose project directory"),
});

export const ProjectListSchema = z.object({
  base_path: z
    .string()
    .optional()
    .default(DEFAULT_PROJECTS_DIR)
    .describe(`Base path to scan for docker-compose projects (default: ${DEFAULT_PROJECTS_DIR})`),
});

// ─── Tool implementations ─────────────────────────────────────────────────────

/**
 * Execute an arbitrary shell command on the devbox via SSH.
 * Dangerous commands are blocked before transmission.
 */
export async function devboxExec(
  ssh: DevboxSSH,
  input: z.infer<typeof ExecSchema>
): Promise<string> {
  const result = await ssh.exec(input.command, input.cwd);
  const parts: string[] = [];
  if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
  if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
  parts.push(`exit code: ${result.exitCode}`);
  return parts.join("\n\n");
}

/**
 * Read a file from the devbox (max 100 KB).
 */
export async function devboxReadFile(
  ssh: DevboxSSH,
  input: z.infer<typeof ReadFileSchema>
): Promise<string> {
  const result = await ssh.exec(`cat "${input.path}"`);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `cat exited with code ${result.exitCode}`);
  }
  const MAX = 100 * 1024;
  if (result.stdout.length > MAX) {
    return result.stdout.slice(0, MAX) + "\n\n[truncated at 100 KB]";
  }
  return result.stdout;
}

/**
 * Write content to a file on the devbox.
 * Parent directories are created automatically.
 */
export async function devboxWriteFile(
  ssh: DevboxSSH,
  input: z.infer<typeof WriteFileSchema>
): Promise<string> {
  await ssh.writeFile(input.path, input.content);
  return `Wrote ${input.content.length} bytes to ${input.path}`;
}

/**
 * List directory contents on the devbox (ls -la).
 */
export async function devboxListDir(
  ssh: DevboxSSH,
  input: z.infer<typeof ListDirSchema>
): Promise<string> {
  const result = await ssh.exec(`ls -la "${input.path}"`);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `ls exited with code ${result.exitCode}`);
  }
  return result.stdout;
}

/**
 * Show running Docker containers on the devbox.
 */
export async function devboxDockerPs(ssh: DevboxSSH): Promise<string> {
  const result = await ssh.exec(
    `docker ps --format "table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}"`
  );
  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr || `docker ps exited with code ${result.exitCode}`
    );
  }
  return result.stdout || "(no running containers)";
}

/**
 * Run docker compose up/down/restart/logs for a project.
 * Logs returns the last 100 lines.
 */
export async function devboxDockerCompose(
  ssh: DevboxSSH,
  input: z.infer<typeof DockerComposeSchema>
): Promise<string> {
  const svc = input.service ? ` ${input.service}` : "";
  let cmd: string;

  switch (input.action) {
    case "up":
      cmd = `docker compose up -d${svc}`;
      break;
    case "down":
      cmd = `docker compose down${svc}`;
      break;
    case "restart":
      cmd = `docker compose restart${svc}`;
      break;
    case "pull":
      cmd = `docker compose pull${svc}`;
      break;
    case "logs":
      cmd = `docker compose logs --tail=100${svc}`;
      break;
  }

  const result = await ssh.exec(cmd, input.project_dir);
  const out = [result.stdout, result.stderr].filter(Boolean).join("\n");
  return out || `(docker compose ${input.action} completed with no output)`;
}

/**
 * Run a git status, pull, clone, or log command on the devbox.
 */
export async function devboxGit(
  ssh: DevboxSSH,
  input: z.infer<typeof GitSchema>
): Promise<string> {
  let cmd: string;
  let cwd: string | undefined = input.repo_dir;

  switch (input.action) {
    case "status":
      cmd = "git status";
      break;
    case "pull":
      cmd = "git pull";
      break;
    case "log":
      cmd = "git log --oneline -20";
      break;
    case "clone": {
      const url = input.repo_url;
      if (!url) throw new Error("repo_url is required for clone action");
      const branch = input.branch || "main";
      // Ensure parent directory exists
      const dir = input.repo_dir;
      const parent = dir.substring(0, dir.lastIndexOf("/"));
      if (parent) {
        await ssh.exec(`mkdir -p "${parent}"`);
      }
      cmd = `git clone -b ${branch} ${url} "${dir}"`;
      cwd = undefined; // clone runs from any directory
      break;
    }
  }

  const result = await ssh.exec(cmd, cwd);
  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr || `git ${input.action} exited with code ${result.exitCode}`
    );
  }
  return result.stdout || "(no output)";
}

// ─── Project management ───────────────────────────────────────────────────────

/**
 * Deploy a project: git pull (if a git repo), docker compose up -d, then quick status.
 * One tool call replaces the git pull + compose up + docker ps dance.
 */
export async function devboxProjectDeploy(
  ssh: DevboxSSH,
  input: z.infer<typeof ProjectDeploySchema>
): Promise<string> {
  const lines: string[] = [];
  const dir = input.project_dir;

  // 1. Git pull if it's a git repo
  const gitCheck = await ssh.exec(
    `test -d "${dir}/.git" && echo "yes" || echo "no"`
  );
  if (gitCheck.stdout.trim() === "yes") {
    const pull = await ssh.exec(`cd "${dir}" && git pull`);
    const pullOut = (pull.stdout || pull.stderr || "").trim();
    lines.push(`[git pull] ${pullOut || "up to date"}`);
  }

  // 2. Pull latest images
  const pull = await ssh.exec(`cd "${dir}" && docker compose pull 2>&1`);
  const pullOut = (pull.stdout || pull.stderr || "").trim();
  lines.push(`[compose pull] ${pullOut || "done"}`);

  // 3. Docker compose up -d
  const up = await ssh.exec(`cd "${dir}" && docker compose up -d 2>&1`);
  const upOut = (up.stdout || up.stderr || "").trim();
  lines.push(`[compose up] ${upOut || "done"}`);

  // 4. Quick container status
  const ps = await ssh.exec(
    `cd "${dir}" && docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>&1`
  );
  lines.push(`[status]\n${ps.stdout || "(no containers)"}`);

  return lines.join("\n\n");
}

/**
 * Health check for a deployed project: container status, uptime, port mappings,
 * and the last 20 lines of logs.
 */
export async function devboxProjectStatus(
  ssh: DevboxSSH,
  input: z.infer<typeof ProjectStatusSchema>
): Promise<string> {
  const lines: string[] = [];
  const dir = input.project_dir;

  // Container status
  const ps = await ssh.exec(
    `cd "${dir}" && docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>&1`
  );
  lines.push(`Containers:\n${ps.stdout || "(no containers running)"}`);

  // Recent logs (last 20 lines, truncated to 3000 chars to avoid bloat)
  const logs = await ssh.exec(
    `cd "${dir}" && docker compose logs --tail=20 2>&1`
  );
  const logText = (logs.stdout || logs.stderr || "").trim();
  if (logText) {
    lines.push(
      `\nRecent logs:\n${logText.length > 3000 ? logText.slice(-3000) + "\n...[truncated]" : logText}`
    );
  }

  return lines.join("\n");
}

/**
 * Scan a base path for docker-compose projects and show git remote + container
 * status for each.
 */
export async function devboxProjectList(
  ssh: DevboxSSH,
  input: z.infer<typeof ProjectListSchema>
): Promise<string> {
  const find = await ssh.exec(
    `find "${input.base_path}" -maxdepth 2 \( -name "docker-compose.yml" -o -name "compose.yml" \) 2>/dev/null`
  );

  const composeFiles = find.stdout.trim().split("\n").filter(Boolean);
  if (composeFiles.length === 0) {
    return `No docker-compose projects found under ${input.base_path}`;
  }

  const lines: string[] = [`Projects under ${input.base_path}:\n`];

  for (const file of composeFiles) {
    const dir = file.substring(0, file.lastIndexOf("/"));
    const name = dir.split("/").pop() || dir;

    // Git remote
    const git = await ssh.exec(
      `cd "${dir}" 2>/dev/null && git remote get-url origin 2>/dev/null || echo "(no git)"`
    );
    const remote = git.stdout.trim() || "(no git remote)";

    // Container status
    const ps = await ssh.exec(
      `cd "${dir}" && docker compose ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null`
    );
    const status = ps.stdout?.trim() || "(no containers)";

    lines.push(`### ${name}`);
    lines.push(`Path: ${dir}`);
    lines.push(`Git: ${remote}`);
    lines.push(`${status}\n`);
  }

  return lines.join("\n");
}
