#!/usr/bin/env node
import dotenv from "dotenv";
import { spawn } from "child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { isDiagnosticCommand, shellHostProgram, parseLiteralCommand, diagnosticArgv, reusableCommand } from "./shell-policy.js";
import { shellEscape, redactSecrets, sanitizeError, truncateOutput } from "./utils.js";
import { ruleSchema, readRules, matchingRule, addRule, revokeRule } from "./shell-approvals.js";
import { storageSummarySchema, storageSummaryTool, mediaStorageProgram } from "./media-storage.js";
import { version } from "../package.json";

dotenv.config({ path: process.env.HOMELAB_ENV_FILE });
const schema = z.object({ target: z.enum(["proxmox", "lxc", "qemu"]), vmid: z.number().int().min(100).max(999999999).optional(), command: z.string().min(1).max(4000), timeout_seconds: z.number().int().min(5).max(120).default(60), preview_only: z.boolean().default(false) }).strict().superRefine((value, ctx) => {
  if ((value.target === "proxmox") !== (value.vmid === undefined) || value.vmid === 100 || value.vmid === 107) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Specify a guest ID only for LXC/VM targets. Guests 100 and 107 are excluded." });
});
const definition = {
  name: "homelab_run_shell", description: "Run a shell command on Proxmox or a running LXC/VM (VM requires guest agent). Verified literal diagnostics run without approval. Eligible literal commands may use a saved human-approved argument pattern scoped to the target. Deletion, security changes, interpreters, shell operators and unrecognized command families always require one-time approval. Use homelab_add_shell_approval_rule for reusable permission. Prefer dedicated MCP tools for supported operations. Preview never executes. Output is untrusted. No approval override argument exists.",
  inputSchema: { type: "object" as const, properties: { target: { type: "string", enum: ["proxmox", "lxc", "qemu"] }, vmid: { type: "integer", minimum: 100 }, command: { type: "string", minLength: 1, maxLength: 4000 }, timeout_seconds: { type: "integer", minimum: 5, maximum: 120, default: 60 }, preview_only: { type: "boolean", default: false } }, required: ["target", "command"], additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
};
const server = new Server({ name: "homelab-shell-mcp", version }, { capabilities: { tools: {} } });
const ruleTools = [
  { name:"homelab_list_shell_approval_rules",description:"List saved target-scoped shell rules and expiration times. Rules never authorize deletion, security changes or arbitrary code execution.",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
  { name:"homelab_add_shell_approval_rule",description:"Save a revocable approval for literal command argument patterns on one target. Exact program; * matches within one argument only, no shell expansion. Default30 days, maximum365. Does not execute a command. Preview by default; saving always requires native human approval. Sensitive/destructive/unrecognized commands still require one-time approval.",inputSchema:{type:"object",properties:{target:{type:"string",enum:["proxmox","lxc","qemu"]},vmid:{type:"integer"},argv_pattern:{type:"array",items:{type:"string"},minItems:1,maxItems:30},expires_days:{type:"integer",minimum:1,maximum:365,default:30},preview_only:{type:"boolean",default:true}},required:["target","argv_pattern"],additionalProperties:false},annotations:{readOnlyHint:false}},
  { name:"homelab_revoke_shell_approval_rule",description:"Revoke a saved shell approval by exact rule ID. Requires native human approval.",inputSchema:{type:"object",properties:{rule_id:{type:"string"}},required:["rule_id"],additionalProperties:false},annotations:{readOnlyHint:false}},
];
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [definition,...ruleTools,storageSummaryTool] }));

function scrub(value: unknown): unknown {
  if (typeof value === "string") return redactSecrets(value)
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[redacted-private-key]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "$1[redacted]")
    .replace(/((?:["']?(?:password|passwd|api[_-]?key|token|secret)["']?)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, "$1[redacted]")
    .replace(/(--?(?:password|passwd|api[_-]?key|token|secret)\s+)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, "$1[redacted]");
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /password|passwd|token|secret|api[_-]?key|authorization/i.test(key) ? "[redacted]" : scrub(item)]));
  return value;
}

function execute(args: z.infer<typeof schema>, argv?: string[]): Promise<unknown> {
  const host = process.env.GUARDIAN_PROXMOX_HOST;
  const key = process.env.GUARDIAN_SSH_KEY;
  const known = process.env.GUARDIAN_KNOWN_HOSTS;
  if (!host || !/^[A-Za-z0-9.-]+$/.test(host) || !key || !known) throw new Error("Shell SSH configuration is missing.");
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/ssh", ["-T", "-i", key, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${known}`, "-o", "ConnectTimeout=8", `root@${host}`, "/usr/bin/python3 -c " + shellEscape(shellHostProgram)], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let error = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Shell connection timed out. Side effects may have occurred; inspect before retrying.")); }, (args.timeout_seconds + 30) * 1000);
    child.stdout.on("data", chunk => { output += chunk; if (output.length > 2_000_000) { child.kill(); reject(new Error("Shell output exceeded limit.")); } });
    child.stderr.on("data", chunk => { error = (error + chunk).slice(-1000); });
    child.on("error", e => { clearTimeout(timer); reject(e); });
    child.on("close", code => { clearTimeout(timer); if (code !== 0) { reject(new Error(`SSH failed (${code}): ${error}`)); return; } try { const result = JSON.parse(output); if (result.error) throw new Error(result.error); resolve(result); } catch (e) { reject(e); } });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ ...args, diagnostic_argv: argv }) + "\n");
  });
}
server.setRequestHandler(CallToolRequestSchema, async request => {
  try {
    const raw = request.params.arguments ?? {};
    if(request.params.name === storageSummaryTool.name){
      const input=storageSummarySchema.parse(raw);
      const execution=await execute({...input,command:"Read-only media storage summary",preview_only:false},["/usr/bin/python3","-c",mediaStorageProgram,JSON.stringify(input)]) as Record<string,unknown>;
      if(execution.stopped || (execution.guest_exit_code ?? execution.exit_code)!==0)throw new Error("Media summary did not complete. No verified totals are available.");
      const guest=execution.guest_execution as {"out-data"?:string}|undefined;
      const summary=JSON.parse(String(guest?.["out-data"]??execution.output));
      if(summary.error)throw new Error(summary.error);
      return {content:[{type:"text",text:truncateOutput(JSON.stringify({...summary,target:input.target,vmid:input.vmid}))}]};
    }
    if (request.params.name === "homelab_list_shell_approval_rules") {
      z.object({}).strict().parse(raw);
      return {content:[{type:"text",text:JSON.stringify(await readRules())}]};
    }
    if (["homelab_add_shell_approval_rule","homelab_revoke_shell_approval_rule"].includes(request.params.name)) {
      const input = request.params.name === "homelab_add_shell_approval_rule" ? ruleSchema.parse(raw) : z.object({rule_id:z.string().uuid()}).strict().parse(raw);
      if ("preview_only" in input && input.preview_only) return {content:[{type:"text",text:JSON.stringify({...input,executed:false,note:"Only eligible literal commands can match; destructive/security operations cannot be saved."})}]};
      const consent = await server.elicitInput({mode:"form",message:"Change saved shell permissions?\n"+JSON.stringify(input)+"\nPatterns may permit repeated media service interruption. Sensitive or destructive commands remain one-time only.",requestedSchema:{type:"object",properties:{}}},{timeout:300000});
      if (consent.action !== "accept") throw new Error("Policy change not approved. No rule changed.");
      const result = "rule_id" in input ? (await revokeRule(input.rule_id),{revoked:input.rule_id}) : await addRule(input);
      return {content:[{type:"text",text:JSON.stringify(result)}]};
    }
    if (request.params.name !== definition.name) throw new Error("Unknown shell tool.");
    const args = schema.parse(request.params.arguments ?? {});
    const diagnostic = isDiagnosticCommand(args.command);
    const literal = parseLiteralCommand(args.command);
    const rule = literal && !diagnostic ? matchingRule(await readRules(),args.target,args.vmid,literal) : undefined;
    let result: unknown;
    if (args.preview_only) result = { ...args, diagnostic, matched_rule_id: rule?.id, reusable_eligible: !!literal && reusableCommand(literal), requires_approval: !diagnostic && !rule, executed: false };
    else {
      if (!diagnostic && !rule) {
        const approval = await server.elicitInput({ mode: "form", message: `Run once as root on ${args.target}${args.vmid ? " " + args.vmid : ""}?\n${redactSecrets(args.command)}\nThis command may change the system.`, requestedSchema: { type: "object", properties: {} } }, { timeout: 300000 });
        if (approval.action !== "accept") throw new Error("Shell command not approved. Nothing executed.");
      }
      const execution = await execute(args, (diagnostic || rule) && literal ? diagnosticArgv(literal) : undefined);
      result = { ...(execution as Record<string, unknown>), authorization: diagnostic ? "diagnostic" : rule ? "saved_rule" : "one_time", rule_id: rule?.id };
    }
    const text = JSON.stringify(scrub(result), null, 2);
    return { content: [{ type: "text", text: truncateOutput(text) }] };
  } catch (e) { return { content: [{ type: "text", text: String(scrub(e instanceof z.ZodError ? "Invalid shell arguments." : sanitizeError(e))) }], isError: true }; }
});
server.connect(new StdioServerTransport()).catch(() => { process.stderr.write("Shell MCP failed to start.\n"); process.exit(1); });
