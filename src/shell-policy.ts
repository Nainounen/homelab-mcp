export function parseLiteralCommand(command: string): string[] | null {
  if (command !== command.trim() || /[\r\n;&|<>`$()]/.test(command)) return null;
  const args: string[] = []; let token = ""; let quote = ""; let started = false;
  for (const char of command) {
    if (quote) { if (char === quote) quote = ""; else token += char; started = true; }
    else if (char === "'" || char === '"') { quote = char; started = true; }
    else if (/\s/.test(char)) { if (started) { args.push(token); token = ""; started = false; } }
    else { if (/[!*?\[\]{}\\]/.test(char)) return null; token += char; started = true; }
  }
  if (quote) return null;
  if (started) args.push(token);
  if (args.length && /^\/(?:usr\/)?(?:s?bin)\/[A-Za-z][A-Za-z0-9_-]*$/.test(args[0])) args[0]=args[0].split("/").pop()!;
  return args.length && /^[A-Za-z][A-Za-z0-9_-]*$/.test(args[0]) ? args : null;
}

function approvedServiceAction(args: string[]): boolean {
  const [program,action,...targets] = args;
  const media = /^(plexmediaserver|radarr|sonarr|seerr|sabnzbd)(?:\.service)?$/;
  return ["systemctl","docker"].includes(program) && ["restart","start","stop","reload"].includes(action) && targets.length > 0 && targets.every(target=>media.test(target));
}

export function reusableCommand(args: string[]): boolean {
  if (args.some(arg => arg.startsWith("/") && /(?:^|\/)\.{1,2}(?:\/|$)/.test(arg))) return false;
  if (args.some(arg => /(?:^|\/)(?:\.ssh|\.env(?:\.[^/]*)?|shadow|gshadow|sudoers|authorized_keys|id_rsa|id_ed25519)(?:$|\/)|\/etc\/homelab-mcp|\/root\/\.hermes/i.test(arg))) return false;
  if (approvedServiceAction(args)) return true;
  const [program, ...rest] = args;
  const plainFlags = (pattern: RegExp) => rest.every(arg => pattern.test(arg));
  if (program === "find") {
    let i=0;
    if(rest[i]==="-P")i++;
    let paths=0;
    while(i<rest.length && rest[i].startsWith("/")) {if(!/^\/[A-Za-z0-9/_. -]*$/.test(rest[i]))return false;paths++;i++;}
    if(!paths)return false;
    for(;i<rest.length;i++){
      const arg=rest[i];
      if(["-print","-print0","-prune","-quit","-xdev","-depth","-ignore_readdir_race","-o","-a"].includes(arg))continue;
      if(["-maxdepth","-mindepth"].includes(arg)&&/^\d{1,3}$/.test(rest[i+1]??"")){i++;continue;}
      if(arg==="-type"&&/^[fdl]$/.test(rest[i+1]??"")){i++;continue;}
      if(["-name","-iname","-path","-ipath"].includes(arg)&&rest[i+1]!==undefined){i++;continue;}
      if(["-mtime","-mmin","-atime","-amin"].includes(arg)&&/^[+-]?\d+$/.test(rest[i+1]??"")){i++;continue;}
      if(arg==="-size"&&/^[+-]?\d+[cwbkMG]?$/.test(rest[i+1]??"")){i++;continue;}
      if(arg==="-printf"&&rest[i+1]!==undefined&&rest[i+1].length<=200){i++;continue;}
      return false;
    }
    return true;
  }
  if (["ss","netstat"].includes(program)) return plainFlags(/^-[tulpenarx46H]+$/);
  if (program === "ip") return /^(?:-brief |-[46] )?(?:addr|address|link|route) show(?: [A-Za-z0-9_.:-]+)?$/.test(rest.join(" "));
  if (["pct","qm"].includes(program)) return rest.join(" ") === "list" || (rest.length===2 && ["status","config"].includes(rest[0]) && /^\d+$/.test(rest[1]) && ![100,107].includes(Number(rest[1])));
  if (program === "hostname") return plainFlags(/^-[Ifs]$/);
  if (program === "uptime") return plainFlags(/^-[ps]$/);
  if (program === "uname") return plainFlags(/^-[asnrvmo]+$/);
  if (program === "free") return plainFlags(/^--(?:human|mega|giga|bytes|wide)$|^-[hmbgwt]+$/);
  if (program === "df") return plainFlags(/^-[hTkiaP]+$|^\/[A-Za-z0-9/_. -]*$/);
  if (program === "lsblk") return plainFlags(/^-[fablnp]+$|^--(?:fs|bytes|list|paths)$/);
  if (program === "ps") return rest.join(" ") === "aux" || rest.join(" ") === "-ef" || /^-eo (pid,comm(?:,pcpu,pmem)?|comm)$/.test(rest.join(" "));
  if (program === "zpool") return rest[0] === "status" && rest.slice(1).every(arg => arg === "-v" || /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(arg));
  if (program === "smartctl") return rest.length === 2 && /^-(a|x|H)$/.test(rest[0]) && /^\/dev\/(sd[a-z]{1,3}|nvme\d+n\d+)$/.test(rest[1]);
  if (program === "nvidia-smi") return rest.length === 0 || rest.join(" ") === "--query-gpu=name --format=csv,noheader";
  if (program === "systemctl") {
    const filtered = rest.filter(arg => ["--no-pager", "--plain", "--full", "-l"].includes(arg) === false);
    if (["--failed", "list-units", "list-unit-files"].includes(filtered[0])) return filtered.slice(1).every(arg => /^--(?:type|state)=[A-Za-z,]+$/.test(arg));
    return ["status", "is-active", "is-enabled", "is-failed"].includes(filtered[0]) && filtered.length >= 2 && filtered.slice(1).every(arg => /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,127}$/.test(arg));
  }
  if (program === "journalctl") {
    for (let i = 0; i < rest.length; i++) {
      if (["--no-pager", "--utc", "-x", "-b", "-e"].includes(rest[i])) continue;
      if (["-u", "--unit", "--since", "--until", "-p", "--priority", "-n", "--lines"].includes(rest[i]) && rest[i+1] && !rest[i+1].startsWith("-")) { if (["-n", "--lines"].includes(rest[i]) && !/^[1-9]\d{0,2}$/.test(rest[i+1])) return false; i++; continue; }
      return false;
    }
    return true;
  }
  if (program === "docker") {
    if (rest[0] === "ps") return rest.slice(1).every(arg => ["-a", "--all", "--no-trunc", "-q", "--quiet"].includes(arg));
    if (rest[0] === "stats") return rest.includes("--no-stream") && rest.slice(1).every(arg => arg === "--no-stream" || /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(arg));
    if (rest[0] === "logs") return /^(?:logs (?:--timestamps |--since [A-Za-z0-9:_.-]+ )?--tail [1-9]\d{0,2} [A-Za-z0-9][A-Za-z0-9_.-]*)$/.test(rest.join(" "));
    return false;
  }
  if (["ls", "stat", "du"].includes(program)) return rest.every(arg => /^-[A-Za-z]+$/.test(arg) || /^\/[A-Za-z0-9/_. -]*$/.test(arg)) && !rest.some(arg => arg === "-L");
  if (["cat", "head", "tail"].includes(program)) {
    return rest.length > 0 && rest.every((arg,i) => /^\/var\/log\/[A-Za-z0-9/_.-]+$/.test(arg) || /^\/proc\/(?:meminfo|cpuinfo|loadavg|uptime|version)$/.test(arg) || (program !== "cat" && (arg === "-n" || (rest[i-1] === "-n" && /^[1-9]\d{0,2}$/.test(arg)))));
  }
  return false;
}

export function isDiagnosticCommand(command: string): boolean {
  const args = parseLiteralCommand(command);
  // File contents require a saved explicit rule, apart from fixed proc diagnostics.
  return !!args && !approvedServiceAction(args) && reusableCommand(args) && (!(["cat", "head", "tail"].includes(args[0])) || args.slice(1).every(arg => arg.startsWith("/proc/")));
}

export function diagnosticArgv(args: string[]): string[] {
  const result = [...args];
  if (["systemctl", "journalctl"].includes(args[0]) && !args.includes("--no-pager")) result.push("--no-pager");
  if (args[0] === "journalctl" && !args.some(arg => ["-n", "--lines"].includes(arg))) result.push("-n", "200");
  return result;
}

export function matchesCommandPattern(pattern: string[], args: string[]): boolean {
  if (pattern.length !== args.length || pattern[0] !== args[0]) return false;
  return pattern.every((token,i) => {
    const expression = token.split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join(".*");
    return new RegExp("^"+expression+"$").test(args[i]);
  });
}

export const shellHostProgram = String.raw`
import json, subprocess, sys, os, signal, selectors, time
r = json.loads(sys.stdin.readline())
p = None
try:
    target = r["target"]
    command = r["command"]
    if target not in ["proxmox", "lxc", "qemu"] or not isinstance(command, str) or not 1 <= len(command) <= 4000:
        raise ValueError("Invalid shell request")
    timeout = r["timeout_seconds"]
    if type(timeout) is not int or not 5 <= timeout <= 120:
        raise ValueError("Invalid timeout")
    # The MCP computes argv only for its verified literal diagnostic commands.
    argv = r.get("diagnostic_argv") or ["/bin/bash", "-c", command]
    if not isinstance(argv, list) or not argv or not all(isinstance(a, str) for a in argv):
        raise ValueError("Invalid command arguments")
    if r.get("diagnostic_argv") and argv[0] in ["cat", "head", "tail"]:
        # Validate file locations inside the actual guest, before reading as root.
        reader = "import os,sys,stat\nargs=sys.argv[1:]\nfor i,value in enumerate(args[1:],1):\n if not value.startswith('/'):\n  continue\n if value in ['/proc/meminfo','/proc/cpuinfo','/proc/loadavg','/proc/uptime','/proc/version']:\n  fd=os.open(value,os.O_RDONLY|os.O_NOFOLLOW)\n elif value.startswith('/var/log/'):\n  parts=value[len('/var/log/'):].split('/')\n  if any(part in ['', '.', '..'] for part in parts):\n   raise SystemExit('Invalid approved log path')\n  directory=os.open('/var/log',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)\n  try:\n   for part in parts[:-1]:\n    child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=directory)\n    os.close(directory)\n    directory=child\n   fd=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW,dir_fd=directory)\n  finally:\n   os.close(directory)\n else:\n  raise SystemExit('Approved read path escapes its allowed location')\n if not stat.S_ISREG(os.fstat(fd).st_mode):\n  raise SystemExit('Approved reads require a regular file')\n os.set_inheritable(fd,True)\n args[i]='/proc/self/fd/'+str(fd)\nos.execvp(args[0],args)\n"
        argv = ["/usr/bin/python3", "-c", reader] + argv
    if target != "proxmox":
        vmid = r.get("vmid")
        if type(vmid) is not int or not 100 <= vmid <= 999999999 or vmid in [100, 107]:
            raise ValueError("Guest is excluded or invalid")
        inventory = json.loads(subprocess.check_output(["/usr/bin/pvesh", "get", "/cluster/resources", "--output-format", "json"], timeout=15))
        node = subprocess.check_output(["/bin/hostname"], text=True, timeout=5).strip()
        guest = next((g for g in inventory if g.get("vmid") == vmid and g.get("type") == target and g.get("node") == node), None)
        if not guest or guest.get("status") != "running":
            raise ValueError("Guest is not running on this node or its type does not match")
        argv = ["/usr/sbin/pct", "exec", str(vmid), "--"] + argv if target == "lxc" else ["/usr/sbin/qm", "guest", "exec", str(vmid), "--timeout", str(timeout + 10), "--", "/usr/bin/timeout", "--signal=TERM", "--kill-after=5s", str(timeout) + "s"] + argv
    os.chdir("/root")
    p = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True, env={"PATH":"/usr/sbin:/usr/bin:/sbin:/bin", "LANG":"C.UTF-8"})
    sel = selectors.DefaultSelector(); sel.register(p.stdout, selectors.EVENT_READ)
    output = bytearray(); deadline = time.monotonic() + timeout + (15 if target == "qemu" else 0); stopped = None
    while sel.get_map() or p.poll() is None:
        if time.monotonic() >= deadline:
            stopped = "timeout"; break
        if not sel.get_map():
            time.sleep(0.1)
        for key, mask in sel.select(min(0.5, max(0, deadline-time.monotonic()))):
            chunk = os.read(key.fd, 8192)
            if not chunk:
                sel.unregister(key.fileobj); continue
            output.extend(chunk)
            if len(output) > 200000:
                stopped = "output_limit"; break
        if stopped: break
    if stopped:
        os.killpg(p.pid, signal.SIGKILL)
    p.wait(timeout=5)
    result = {"target":target,"vmid":r.get("vmid"),"host_exit_code":p.returncode,"stopped":stopped,"output":output[:200000].decode("utf-8",errors="replace"),"note":"Timeout does not undo side effects. Inspect before retrying; detached child processes cannot be guaranteed stopped."}
    if target == "qemu":
        try:
            execution = json.loads(result["output"])
            result.update({"guest_execution":execution,"guest_exited":execution.get("exited"),"guest_exit_code":execution.get("exitcode"),"guest_outcome_unknown":not execution.get("exited",False)})
        except ValueError:
            result["guest_outcome_unknown"] = True
    else:
        result["exit_code"] = p.returncode
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({"error":str(e)[:500]}))
finally:
    if p is not None and p.poll() is None:
        try:
            os.killpg(p.pid, signal.SIGKILL)
            p.wait(timeout=5)
        except ProcessLookupError:
            pass
`;
