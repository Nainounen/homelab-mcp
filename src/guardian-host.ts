import { spawn } from "child_process";

// Only this fixed program is sent over SSH. Inputs are JSON data, never shell code.
export const guardianHostProgram = String.raw`
import json, subprocess, sys, re, fcntl, os
r = json.loads(sys.stdin.readline())
def run(args, allow_failure=False):
    p = subprocess.run(args, capture_output=True, text=True, timeout=25)
    if p.returncode and not allow_failure:
        raise RuntimeError(p.stderr.strip()[:500] or "Command failed")
    return p.stdout[:50000]
def api(path):
    return json.loads(run(["pvesh", "get", path, "--output-format", "json"]))
def pending(path):
    return [p for p in api(path + "/pending") if p.get("key") in ["memory", "cores", "sockets", "balloon"]]
try:
    action = r["action"]
    node = run(["hostname"]).strip()
    inventory = api("/cluster/resources")
    guests = [{k:g.get(k) for k in ["vmid", "type", "name", "node", "status", "mem", "maxmem", "cpu", "maxcpu"]} for g in inventory if g.get("type") in ["lxc", "qemu"]]
    if action == "inventory":
        result = guests
    elif action == "host":
        result = {"node":node, "load":run(["uptime"]).strip(), "memory":run(["free", "-m"]), "storage":run(["pvesm", "status"]), "zfs":run(["zpool", "status", "-x"], True)}
    else:
        vmid = r["vmid"]
        kind = r["type"]
        if type(vmid) is not int or not 100 <= vmid <= 999999999 or kind not in ["lxc", "qemu"]:
            raise ValueError("Invalid guest")
        if vmid in [100, 107]:
            raise ValueError("This guest is excluded from infrastructure operations")
        guest = next((g for g in guests if g["vmid"] == vmid and g["type"] == kind and g["node"] == node), None)
        if not guest:
            raise ValueError("Guest ID, type or node does not match current inventory")
        path = "/nodes/" + node + "/" + kind + "/" + str(vmid)
        if action in ["memory", "cores"] and r.get("preview_only", True) is False:
            lock_dir = "/run/hermes-operations"
            os.makedirs(lock_dir, mode=0o700, exist_ok=True)
            info = os.stat(lock_dir)
            if info.st_uid != 0 or info.st_mode & 0o077:
                raise ValueError("Unsafe infrastructure lock directory")
            lock = open(lock_dir + "/" + str(vmid) + ".lock", "a")
            fcntl.flock(lock, fcntl.LOCK_EX)
        config = api(path + "/config")
        filtered = {k:config[k] for k in ["name", "hostname", "memory", "cores", "sockets", "cpulimit", "agent", "onboot", "balloon"] if k in config}
        if action == "guest":
            result = {"guest":guest, "config":filtered, "pending":pending(path)}
        elif action in ["memory", "cores"]:
            field = action
            value = r["value"]
            expected = r["expected"]
            current = int(config.get(field, 0))
            if type(value) is not int or type(expected) is not int:
                raise ValueError("Integer values required")
            if current != expected:
                raise ValueError("Guest configuration changed; inspect it and preview again")
            if field == "memory":
                total = int(run(["awk", "/MemTotal/ {print $2}", "/proc/meminfo"]).strip()) // 1024
                if not 256 <= value <= total:
                    raise ValueError("Memory must be at least 256 MiB and no greater than host RAM")
            elif not 1 <= value <= 32:
                raise ValueError("CPU cores must be between 1 and 32")
            result = {"guest":guest, "field":field, "before":current, "requested":value, "preview":r.get("preview_only", True), "automatic_restart":False}
            if r.get("preview_only", True) is False:
                cmd = "pct" if kind == "lxc" else "qm"
                run([cmd, "set", str(vmid), "--" + field, str(value)])
                after = api(path + "/config")
                result.update({"configured_value":after.get(field), "pending":pending(path), "runtime_verified":False})
        elif action in ["services", "logs", "disk"]:
            if guest["status"] != "running":
                raise ValueError("Guest is not running")
            if action == "services":
                command = ["systemctl", "--failed", "--no-pager", "--plain"]
            elif action == "disk":
                command = ["df", "-h"]
            else:
                service = r["service"]
                lines = r.get("lines", 60)
                if not isinstance(service, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.@-]{0,127}", service) or type(lines) is not int or not 1 <= lines <= 200:
                    raise ValueError("Invalid service or line count")
                command = ["journalctl", "--no-pager", "-u", service, "-n", str(lines)]
            if kind == "lxc":
                result = {"guest":guest, "output":run(["pct", "exec", str(vmid), "--"] + command)}
            else:
                result = {"guest":guest, "execution":json.loads(run(["qm", "guest", "exec", str(vmid), "--"] + command))}
        else:
            raise ValueError("Unsupported operation")
    print(json.dumps({"ok":True, "result":result}))
except Exception as e:
    print(json.dumps({"ok":False, "error":str(e)[:500]}))
`;

export async function guardianHost(action: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const host = process.env.GUARDIAN_PROXMOX_HOST;
  const key = process.env.GUARDIAN_SSH_KEY;
  const knownHosts = process.env.GUARDIAN_KNOWN_HOSTS;
  if (!host || !/^[a-zA-Z0-9.-]+$/.test(host) || !key || !knownHosts) {
    throw new Error("Infrastructure SSH host, key and pinned known-hosts file must be configured.");
  }
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/ssh", ["-T", "-i", key, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${knownHosts}`, "-o", "ConnectTimeout=8",
      `root@${host}`, "homelab-operation"],
      { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Infrastructure read or action timed out. Inspect current state before retrying a write.")); }, 40_000);
    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
      if (stdout.length > 1_000_000) { child.kill(); reject(new Error("Infrastructure output exceeded its limit.")); }
    });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-2000); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error(`SSH failed (${code}): ${stderr.slice(0, 500)}`)); return; }
      try {
        const response = JSON.parse(stdout);
        if (!response.ok) throw new Error(response.error);
        resolve(response.result);
      } catch (error) { reject(error); }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ ...args, action }) + "\n");
  });
}
