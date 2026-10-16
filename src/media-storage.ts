import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import path from "path";

export const storageSummarySchema=z.object({target:z.enum(["proxmox","lxc","qemu"]),vmid:z.number().int().min(100).max(999999999).optional(),path:z.string().min(1).max(1000),timeout_seconds:z.number().int().min(5).max(120).default(60)}).strict().superRefine((input,ctx)=>{
 if((input.target==="proxmox")!==(input.vmid===undefined)||[100,107].includes(input.vmid??0))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Invalid or excluded target."});
 const roots=["/media_main","/data/media","/media","/mnt/media"];
 if(path.posix.normalize(input.path)!==input.path||!roots.some(root=>input.path===root||input.path.startsWith(root+"/")))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Select an exact absolute path under a supported media root."});
});
export const storageSummaryTool:Tool={name:"homelab_media_storage_summary",description:"Read-only video file count and byte totals grouped by Remux/Bluray/WEB/other filename hints under a supported media root. No custom Python command approval needed. Does not read contents or follow symlinks. Bounded by deadline, depth64 and1million entries; partial/error counts are reported. Filename hints do not establish actual encoding quality.",inputSchema:{type:"object",properties:{target:{type:"string",enum:["proxmox","lxc","qemu"]},vmid:{type:"integer",minimum:100},path:{type:"string"},timeout_seconds:{type:"integer",minimum:5,maximum:120,default:60}},required:["target","path"],additionalProperties:false},annotations:{readOnlyHint:true}};

export const mediaStorageProgram=String.raw`
import json,os,stat,sys,time
request=json.loads(sys.argv[1])
root=request["path"]
roots=["/media_main","/data/media","/media","/mnt/media"]
if os.path.normpath(root)!=root or not any(root==base or root.startswith(base+"/") for base in roots):
    raise SystemExit("Invalid media root")
counts={key:{"files":0,"bytes":0} for key in ["Remux","Bluray","WEB","other"]}
seen=0; errors=0; symlinks=0; complete=True
reason=None; deadline=time.monotonic()+max(1,request["timeout_seconds"]-2)
extensions=(".mkv",".mp4",".ts",".avi",".m2ts",".mov",".m4v",".webm")
def walk(directory,depth):
    global seen,errors,symlinks,complete,reason
    if depth>64:
        complete=False; reason="depth_limit"; return
    with os.scandir(directory) as entries:
        for entry in entries:
            if time.monotonic()>=deadline or seen>=1000000:
                complete=False; reason="deadline_or_entry_limit"; return
            seen+=1
            try:
                info=entry.stat(follow_symlinks=False)
                if stat.S_ISLNK(info.st_mode):
                    symlinks+=1; continue
                if stat.S_ISDIR(info.st_mode):
                    child=os.open(entry.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=directory)
                    try: walk(child,depth+1)
                    finally: os.close(child)
                    if reason=="deadline_or_entry_limit": return
                elif stat.S_ISREG(info.st_mode) and entry.name.lower().endswith(extensions):
                    name=entry.name.lower()
                    kind="Remux" if "remux" in name else "Bluray" if "bluray" in name or "blu-ray" in name else "WEB" if "web" in name else "other"
                    counts[kind]["files"]+=1; counts[kind]["bytes"]+=info.st_size
            except OSError:
                errors+=1; complete=False
handle=None
try:
    handle=os.open("/",os.O_RDONLY|os.O_DIRECTORY)
    for component in root.strip("/").split("/"):
        if component in ["", ".", ".."]: raise ValueError("Invalid path component")
        child=os.open(component,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=handle)
        os.close(handle); handle=child
    walk(handle,0)
    print(json.dumps({"path":root,"complete":complete,"limit_reason":reason,"entries_inspected":seen,"errors":errors,"symlinks_skipped":symlinks,"groups":counts,"total_files":sum(row["files"] for row in counts.values()),"total_bytes":sum(row["bytes"] for row in counts.values()),"note":"Logical file sizes and filename-based categories only; not allocated disk space, actual codec or playback verification."}))
except (OSError,ValueError) as error:
    print(json.dumps({"error":"Media path could not be inspected: "+type(error).__name__}))
finally:
    if handle is not None: os.close(handle)
`;
