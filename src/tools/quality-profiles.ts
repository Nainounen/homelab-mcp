import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { createHash } from "crypto";
import { z } from "zod";
import { ArrClient } from "../arr.js";
import { createOverseerrClient, OverseerrClient } from "../overseerr.js";

interface QualityItem { id?: number; name?: string; allowed: boolean; quality?: { id: number; name: string }; items?: QualityItem[] }
interface Profile { id?: number; name: string; upgradeAllowed: boolean; cutoff: number; items: QualityItem[]; formatItems?: Array<{format:number;name?:string;score:number}>; minFormatScore?:number; cutoffFormatScore?:number; minUpgradeFormatScore?:number; language?:number }
const options = {
  name:z.string().trim().min(1).max(100).optional(),
  allowed_quality_ids:z.array(z.number().int().positive()).min(1).max(100).optional(),
  cutoff_id:z.number().int().positive().optional(), upgrade_allowed:z.boolean().optional(),
  min_format_score:z.number().int().min(-10000).max(10000).optional(),
  cutoff_format_score:z.number().int().min(-10000).max(10000).optional(),
  format_scores:z.array(z.object({format_id:z.number().int().positive(),score:z.number().int().min(-10000).max(10000)}).strict()).max(100).optional(),
  preview_only:z.boolean().default(true),
};
export const createProfileSchema = z.object({...options,name:z.string().trim().min(1).max(100),template_profile_id:z.number().int().positive()}).strict();
export const editProfileSchema = z.object({...options,profile_id:z.number().int().positive(),expected_digest:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const profileIdSchema=z.object({profile_id:z.number().int().positive()}).strict();
export const deleteProfileSchema = z.object({
 profile_id: z.number().int().positive(),
 expected_name: z.string().trim().min(1).max(100),
 expected_digest: z.string().regex(/^[a-f0-9]{64}$/),
 preview_only: z.boolean().default(true),
}).strict();
function digest(profile:Profile):string {return createHash("sha256").update(JSON.stringify(profile)).digest("hex");}
function leaves(items:QualityItem[]):QualityItem[] {return items.flatMap(item=>item.items?.length ? leaves(item.items) : [item]);}

export async function profileDetails(client:ArrClient,input:z.infer<typeof profileIdSchema>):Promise<string> {
 const profile=await client.get<Profile>("/qualityprofile/"+input.profile_id);
 return JSON.stringify({digest:digest(profile),profile,note:"Quality ordering and groups are preserved by create/edit. Creation clones a template; cutoff may reference a quality or group ID. Profile changes do not replace existing files."});
}
export async function saveProfile(client:ArrClient,input:z.infer<typeof createProfileSchema>|z.infer<typeof editProfileSchema>):Promise<string> {
 const editing="profile_id" in input;
 const source=await client.get<Profile>("/qualityprofile/"+(editing?input.profile_id:input.template_profile_id));
 if(editing && digest(source)!==input.expected_digest)throw new Error("Profile changed since inspection. Read its current digest again.");
 const next:Profile=structuredClone(source);
 if(input.name!==undefined)next.name=input.name;
 const profiles=await client.get<Profile[]>("/qualityprofile");
 if(profiles.some(p=>p.name.toLowerCase()===next.name.toLowerCase()&&(!editing||p.id!==source.id)))throw new Error("A profile with this name already exists.");
 if(input.allowed_quality_ids){
  const available=leaves(next.items);if(input.allowed_quality_ids.some(id=>!available.some(item=>item.quality?.id===id)))throw new Error("Unknown quality ID; use the template's quality IDs.");
  const validateGroups=(items:QualityItem[])=>{for(const item of items){if(item.items?.length){const ids=leaves(item.items).map(child=>child.quality?.id);const chosen=ids.filter(id=>input.allowed_quality_ids!.includes(id??-1));if(chosen.length&&chosen.length!==ids.length)throw new Error("Select all qualities in a group, or none. This tool preserves groups; use a different template for separate qualities.");validateGroups(item.items);}}};validateGroups(next.items);
  const update=(items:QualityItem[])=>{for(const item of items){if(item.items?.length){update(item.items);item.allowed=item.items.some(child=>child.allowed);}else item.allowed=input.allowed_quality_ids!.includes(item.quality!.id);}};update(next.items);
 }
 if(input.cutoff_id!==undefined)next.cutoff=input.cutoff_id;
 const cutoffValid=(items:QualityItem[]):boolean=>items.some(item=>(item.allowed&&(item.quality?.id===next.cutoff||item.id===next.cutoff))||(item.items?.length&&cutoffValid(item.items)));
 if(!cutoffValid(next.items))throw new Error("Cutoff must name an allowed quality or allowed group. Include cutoff_id when disabling the existing cutoff.");
 if(input.upgrade_allowed!==undefined)next.upgradeAllowed=input.upgrade_allowed;
 if(input.min_format_score!==undefined)next.minFormatScore=input.min_format_score;
 if(input.cutoff_format_score!==undefined)next.cutoffFormatScore=input.cutoff_format_score;
 for(const update of input.format_scores??[]){const item=next.formatItems?.find(row=>row.format===update.format_id);if(!item)throw new Error("Custom format is not present in the template.");item.score=update.score;}
 if(!editing)delete next.id;
 if(input.preview_only)return JSON.stringify({preview:true,operation:editing?"edit":"create",before:editing?source:undefined,template_digest:digest(source),after:next,note:editing?"All items using this profile may have different future download/upgrade eligibility. No existing file is replaced.":"Clones quality ordering and groups; does not assign any library item."});
 let result:Profile;
 try {result=editing?await client.putOnce<Profile>("/qualityprofile/"+source.id,next):await client.postOnce<Profile>("/qualityprofile",next);}catch{throw new Error("Profile write was not confirmed. Inspect profiles before retrying; it may have applied.");}
 return JSON.stringify({submitted:true,profile_id:result.id,name:result.name,digest:digest(result),note:"No file replacement or search was submitted."});
}

export async function deleteProfile(
 client: ArrClient,
 app: "sonarr" | "radarr",
 input: z.infer<typeof deleteProfileSchema>,
 seerr: OverseerrClient = createOverseerrClient(),
): Promise<string> {
 const profile = await client.get<Profile>("/qualityprofile/" + input.profile_id);
 if (profile.name !== input.expected_name) throw new Error("Profile name does not match the requested removal. Inspect profiles again.");
 if (digest(profile) !== input.expected_digest) throw new Error("Profile changed since inspection. Read its current digest again.");
 interface Reference { id: number; title?: string; name?: string; path?: string; qualityProfileId?: number; defaultQualityProfileId?: number }
 interface SeerrServer { id: number; name: string; activeProfileId: number; activeAnimeProfileId?: number }
 const [library, lists, folders, collections, servers] = await Promise.all([
  client.get<Reference[]>(app === "sonarr" ? "/series" : "/movie"),
  client.get<Reference[]>("/importlist"),
  client.get<Reference[]>("/rootfolder"),
  app === "radarr" ? client.get<Reference[]>("/collection") : Promise.resolve([] as Reference[]),
  seerr.get<SeerrServer[]>("/settings/" + app),
 ]);
 const references = [
  ...library.filter(row => row.qualityProfileId === input.profile_id).map(row => ({type: "library", id: row.id, name: row.title})),
  ...lists.filter(row => row.qualityProfileId === input.profile_id).map(row => ({type: "import_list", id: row.id, name: row.name})),
  ...folders.filter(row => row.defaultQualityProfileId === input.profile_id).map(row => ({type: "root_folder", id: row.id, name: row.path})),
  ...collections.filter(row => row.qualityProfileId === input.profile_id).map(row => ({type: "collection", id: row.id, name: row.title})),
  ...servers.filter(row => row.activeProfileId === input.profile_id).map(row => ({type: "seerr_default", id: row.id, name: row.name})),
  ...(app === "sonarr" ? servers.filter(row => row.activeAnimeProfileId === input.profile_id).map(row => ({type: "seerr_anime_default", id: row.id, name: row.name})) : []),
 ];
 const preview = {preview: input.preview_only, app, profile_id: input.profile_id, name: profile.name, digest: digest(profile), deletable: references.length === 0, references,
  note: "Removes only an unused profile. Checks library, import lists, root-folder and collection defaults, and all Seerr connections for this app conservatively by profile ID. Does not reassign media, change defaults, delete files or submit searches."};
 if (input.preview_only) return JSON.stringify(preview);
 if (references.length) throw new Error("Profile is still referenced. Inspect the removal preview; no changes made.");
 const fresh = await client.get<Profile>("/qualityprofile/" + input.profile_id);
 if (digest(fresh) !== input.expected_digest) throw new Error("Profile changed during inspection. Preview again before removal.");
 try { await client.deleteOnce("/qualityprofile/" + input.profile_id); }
 catch { throw new Error("Profile removal was not confirmed. Inspect profiles before retrying; it may have applied."); }
 const remaining = await client.get<Profile[]>("/qualityprofile");
 if (remaining.some(row => row.id === input.profile_id)) throw new Error("Profile removal was submitted but could not be verified. Inspect profiles before retrying.");
 return JSON.stringify({...preview, submitted: true, verified: true});
}

export function qualityProfileTools(app:"sonarr"|"radarr"): Tool[] {
 const common={name:{type:"string",maxLength:100},allowed_quality_ids:{type:"array",items:{type:"integer",minimum:1},minItems:1},cutoff_id:{type:"integer",minimum:1},upgrade_allowed:{type:"boolean"},min_format_score:{type:"integer"},cutoff_format_score:{type:"integer"},format_scores:{type:"array",items:{type:"object",properties:{format_id:{type:"integer"},score:{type:"integer"}},required:["format_id","score"],additionalProperties:false}},preview_only:{type:"boolean",default:true}};
 return [
  {name:app+"_get_quality_profile",description:"Inspect full quality profile, quality/group IDs, format scores and digest for guarded edits.",inputSchema:{type:"object",properties:{profile_id:{type:"integer",minimum:1}},required:["profile_id"],additionalProperties:false},annotations:{readOnlyHint:true}},
  {name:app+"_create_quality_profile",description:"Create a new profile by cloning an existing template with optional allowed quality, cutoff, upgrade and format-score changes. Ordering/groups preserved. Preview by default; applying requires human approval. No file replacement or assignment.",inputSchema:{type:"object",properties:{...common,template_profile_id:{type:"integer",minimum:1}},required:["name","template_profile_id"],additionalProperties:false},annotations:{readOnlyHint:false}},
  {name:app+"_edit_quality_profile",description:"Edit an existing profile using its current digest. Affects future download eligibility of all assigned items; preview by default and requires approval. Does not replace files.",inputSchema:{type:"object",properties:{...common,profile_id:{type:"integer",minimum:1},expected_digest:{type:"string",pattern:"^[a-f0-9]{64}$"}},required:["profile_id","expected_digest"],additionalProperties:false},annotations:{readOnlyHint:false}},
  {name:app+"_delete_quality_profile",description:"Remove one unused quality profile, guarded by its exact name and observed digest. Preview lists references and whether removal is allowed. Blocks library, import-list, root-folder, collection and Seerr default references. Applying requires human approval and verifies removal. Does not reassign media or delete files.",inputSchema:{type:"object",properties:{profile_id:{type:"integer",minimum:1},expected_name:{type:"string",minLength:1,maxLength:100},expected_digest:{type:"string",pattern:"^[a-f0-9]{64}$"},preview_only:{type:"boolean",default:true}},required:["profile_id","expected_name","expected_digest"],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false}},
 ];
}
