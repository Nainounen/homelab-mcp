import { promises as fs } from "fs";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { z } from "zod";
import { matchesCommandPattern, reusableCommand } from "./shell-policy.js";

const file = "/etc/homelab-mcp/shell-approvals.json";
export const ruleSchema = z.object({
  target: z.enum(["proxmox", "lxc", "qemu"]), vmid: z.number().int().min(100).max(999999999).optional(),
  argv_pattern: z.array(z.string().min(1).max(200).regex(/^[A-Za-z0-9 /_.:@,=*'-]+$/)).min(1).max(30),
  expires_days: z.number().int().min(1).max(365).default(30), preview_only: z.boolean().default(true),
}).strict().superRefine((value,ctx) => {
  if ((value.target === "proxmox") !== (value.vmid === undefined) || [100,107].includes(value.vmid ?? 0)) ctx.addIssue({code:z.ZodIssueCode.custom,message:"Invalid or excluded rule target."});
  if (!["find","hostname","uptime","uname","free","df","lsblk","ps","zpool","smartctl","nvidia-smi","systemctl","journalctl","docker","ls","stat","du","cat","head","tail","ss","netstat","ip","pct","qm"].includes(value.argv_pattern[0])) ctx.addIssue({code:z.ZodIssueCode.custom,message:"Only reviewed command families support reusable rules. Other programs require one-time consent."});
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(value.argv_pattern[0])) ctx.addIssue({code:z.ZodIssueCode.custom,message:"Program must be exact; wildcards are permitted only in argument tokens."});
});
const storedSchema = z.object({id:z.string().uuid(),target:z.enum(["proxmox","lxc","qemu"]),vmid:z.number().int().optional(),argv_pattern:z.array(z.string()),expires_at:z.number(),created_at:z.number()}).strict();
export type ApprovalRule = z.infer<typeof storedSchema>;

export async function readRules(): Promise<ApprovalRule[]> {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64000 || (stat.mode & 0o077) !== 0 || stat.uid !== 0) throw new Error("Approval store must be a private root-owned regular file.");
    return z.array(storedSchema).max(100).parse(JSON.parse(await fs.readFile(file,"utf8")));
  } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
}

export function matchingRule(rules: ApprovalRule[], target: string, vmid: number | undefined, argv: string[]): ApprovalRule | undefined {
  if (!reusableCommand(argv)) return undefined;
  return rules.find(rule => rule.target === target && rule.vmid === vmid && rule.expires_at > Date.now() && matchesCommandPattern(rule.argv_pattern,argv));
}

async function acquireLock(): Promise<() => Promise<void>> {
  const lock=file+".lock";
  const handle=await fs.open(lock,"a",0o600);await handle.close();
  const stat=await fs.lstat(lock);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o077)!==0)throw new Error("Approval lock must be a private root-owned regular file.");
  return new Promise((resolve,reject)=>{
    const child=spawn("/usr/bin/flock",["-x","-w","5",lock,"/usr/bin/python3","-c","import sys; print('LOCKED', flush=True); sys.stdin.read()"],{stdio:["pipe","pipe","ignore"]});
    let acquired=false;
    const timer=setTimeout(()=>{child.stdin.end();child.kill();reject(new Error("Approval store lock timed out. No policy changed."));},6500);
    child.on("error",()=>{clearTimeout(timer);reject(new Error("Approval locking is unavailable. No policy changed."));});
    child.on("close",()=>{clearTimeout(timer);if(!acquired)reject(new Error("Approval store is busy. No policy changed."));});
    child.stdout.once("data",chunk=>{
      if(String(chunk).trim()!=="LOCKED")return;
      acquired=true;clearTimeout(timer);
      resolve(async()=>{if(child.exitCode!==null)return;await new Promise<void>(done=>{child.once("close",()=>done());child.stdin.end();});});
    });
    child.stdin.on("error",()=>{});
  });
}

async function mutate(change: (rules: ApprovalRule[]) => ApprovalRule[]): Promise<void> {
  // The OS releases this lock when the MCP exits or crashes and its pipe closes.
  const release=await acquireLock();
  const temp=file+"."+randomUUID()+".tmp";
  try {
    const rules=change((await readRules()).filter(rule=>rule.expires_at>Date.now()));
    if(rules.length>100)throw new Error("Approval rule limit reached. Revoke unused rules first.");
    const data=JSON.stringify(rules);
    if(Buffer.byteLength(data,"utf8")>64000)throw new Error("Approval store size limit reached. Existing rules were preserved.");
    await fs.writeFile(temp,data,{mode:0o600,flag:"wx"});
    await fs.rename(temp,file);
  } finally {await fs.unlink(temp).catch(()=>{});await release();}
}

export async function addRule(input: z.infer<typeof ruleSchema>): Promise<ApprovalRule> {
  const rule = {id:randomUUID(),target:input.target,vmid:input.vmid,argv_pattern:input.argv_pattern,created_at:Date.now(),expires_at:Date.now()+input.expires_days*86400000};
  await mutate(rules=>[...rules,rule]);
  return rule;
}
export async function revokeRule(id:string): Promise<void> { await mutate(rules=>rules.filter(rule=>rule.id!==id)); }
