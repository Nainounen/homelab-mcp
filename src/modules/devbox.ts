import { ToolModule } from "../types.js";
import { DevboxSSH } from "../ssh.js";
import * as impl from "../tools/devbox.js";

const DEFAULT_PROJECTS_DIR = process.env.DEVBOX_PROJECTS_DIR || "/opt/projects";

export function devboxModule(ssh: DevboxSSH): ToolModule {
  return {
    domain: "Devbox",
    tools: [
      {
        name: "devbox_exec",
        description: "Execute a shell command on the devbox via SSH. Dangerous commands are blocked.",
        inputSchema: {
          type: "object",
          properties: {
            command: { type: "string", description: "Shell command to run" },
            cwd: { type: "string", description: "Working directory (default: /root)" },
          },
          required: ["command"],
        },
      },
      {
        name: "devbox_read_file",
        description: "Read the contents of a file on the devbox (up to 100 KB).",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string", description: "Absolute path of the file to read" } },
          required: ["path"],
        },
      },
      {
        name: "devbox_write_file",
        description: "Write content to a file on the devbox. Parent directories are created automatically.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Absolute path of the file to write" },
            content: { type: "string", description: "File content to write" },
          },
          required: ["path", "content"],
        },
      },
      {
        name: "devbox_list_dir",
        description: "List directory contents on the devbox (ls -la).",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string", description: "Absolute path of the directory to list" } },
          required: ["path"],
        },
      },
      {
        name: "devbox_docker_ps",
        description: "Show all running Docker containers on the devbox.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "devbox_docker_compose",
        description: "Run docker compose up/down/restart/pull/logs for a project on the devbox.",
        inputSchema: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["up", "down", "restart", "pull", "logs"] },
            project_dir: { type: "string", description: "Absolute path to the docker-compose project directory" },
            service: { type: "string", description: "Optional: target a specific service" },
          },
          required: ["action", "project_dir"],
        },
      },
      {
        name: "devbox_git",
        description: "Run git status, pull, log, or clone on the devbox.",
        inputSchema: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["status", "pull", "log", "clone"] },
            repo_dir: { type: "string", description: "Absolute path to the git repository" },
            repo_url: { type: "string", description: "Remote repository URL (required for clone)" },
            branch: { type: "string", description: "Branch to clone (default: main)" },
          },
          required: ["action", "repo_dir"],
        },
      },
      {
        name: "devbox_project_deploy",
        description: "Deploy a project: git pull, docker compose pull, docker compose up -d, then show status.",
        inputSchema: {
          type: "object",
          properties: { project_dir: { type: "string", description: "Absolute path to the docker-compose project directory" } },
          required: ["project_dir"],
        },
      },
      {
        name: "devbox_project_status",
        description: "Health check for a deployed project: container status and recent logs.",
        inputSchema: {
          type: "object",
          properties: { project_dir: { type: "string", description: "Absolute path to the docker-compose project directory" } },
          required: ["project_dir"],
        },
      },
      {
        name: "devbox_project_list",
        description: "Scan a base path for docker-compose projects and show git remote + container status for each.",
        inputSchema: {
          type: "object",
          properties: {
            base_path: { type: "string", description: `Base path to scan (default: ${DEFAULT_PROJECTS_DIR})` },
          },
        },
      },
    ],

    async handle(name, args) {
      switch (name) {
        case "devbox_exec":           return impl.devboxExec(ssh, impl.ExecSchema.parse(args));
        case "devbox_read_file":      return impl.devboxReadFile(ssh, impl.ReadFileSchema.parse(args));
        case "devbox_write_file":     return impl.devboxWriteFile(ssh, impl.WriteFileSchema.parse(args));
        case "devbox_list_dir":       return impl.devboxListDir(ssh, impl.ListDirSchema.parse(args));
        case "devbox_docker_ps":      return impl.devboxDockerPs(ssh);
        case "devbox_docker_compose": return impl.devboxDockerCompose(ssh, impl.DockerComposeSchema.parse(args));
        case "devbox_git":            return impl.devboxGit(ssh, impl.GitSchema.parse(args));
        case "devbox_project_deploy": return impl.devboxProjectDeploy(ssh, impl.ProjectDeploySchema.parse(args));
        case "devbox_project_status": return impl.devboxProjectStatus(ssh, impl.ProjectStatusSchema.parse(args));
        case "devbox_project_list":   return impl.devboxProjectList(ssh, impl.ProjectListSchema.parse(args));
        default: return null;
      }
    },
  };
}
