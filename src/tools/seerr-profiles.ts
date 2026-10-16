import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { isAxiosError } from "axios";
import { OverseerrClient } from "../overseerr.js";

interface Settings { id:number; name:string; activeProfileId:number; activeProfileName:string; activeAnimeProfileId?:number; activeAnimeProfileName?:string; is4k:boolean; isDefault:boolean; [key:string]:unknown }
interface Profile {id:number;name:string}
export const seerrProfileSchema=z.object({service:z.enum(["sonarr","radarr"]),server_id:z.number().int().min(0),profile_id:z.number().int().positive(),expected_current_profile_id:z.number().int().positive(),anime:z.boolean().default(false),preview_only:z.boolean().default(true)}).strict();

export async function seerrProfileSettings(client:OverseerrClient):Promise<string> {
 const result=[];
 for(const service of ["sonarr","radarr"]){
  const servers=await client.get<Settings[]>("/settings/"+service);
  for(const server of servers){
   // /test only fetches remote profiles/folders; it does not save a connection.
   const tested=await client.post<{profiles:Profile[]}>("/settings/"+service+"/test",server);
   result.push({service,server_id:server.id,name:server.name,is4k:server.is4k,isDefault:server.isDefault,profile_id:server.activeProfileId,profile_name:server.activeProfileName,anime_profile_id:server.activeAnimeProfileId,profiles:tested.profiles.map(p=>({id:p.id,name:p.name}))});
  }
 }
 return JSON.stringify({servers:result,note:"Seerr selects profiles defined by the linked Arr instance. These defaults affect future requests, not existing file quality."});
}
export async function seerrSetProfile(client:OverseerrClient,input:z.infer<typeof seerrProfileSchema>):Promise<string> {
 if(input.anime&&input.service!=="sonarr")throw new Error("Anime profile is available only for Sonarr.");
 const servers=await client.get<Settings[]>("/settings/"+input.service);
 const server=servers.find(row=>row.id===input.server_id);
 if(!server)throw new Error("Seerr server not found.");
 const current=input.anime?server.activeAnimeProfileId:server.activeProfileId;
 if(current!==input.expected_current_profile_id)throw new Error("Seerr default changed. Inspect settings before applying.");
 const tested=await client.post<{profiles:Profile[]}>("/settings/"+input.service+"/test",server);
 const selected=tested.profiles.find(p=>p.id===input.profile_id);
 if(!selected)throw new Error("Selected profile does not belong to this linked Arr instance.");
 const preview={service:input.service,server_id:server.id,name:server.name,anime:input.anime,before:current,after:{id:selected.id,name:selected.name},preview:input.preview_only,note:"Changes the default for future requests on this connection; existing movies/series are unaffected."};
 if(input.preview_only)return JSON.stringify(preview);
 // The API exposes id on reads but rejects this read-only field in PUT bodies.
 const {id:serverId,...writable}=server;
 const updated={...writable,...(input.anime?{activeAnimeProfileId:selected.id,activeAnimeProfileName:selected.name}:{activeProfileId:selected.id,activeProfileName:selected.name})};
 let writeError: unknown;
 try{await client.put("/settings/"+input.service+"/"+serverId,updated);}catch(error){writeError=error;}
 // A timeout can happen after the save. Read back once before reporting failure.
 let fresh: Settings | undefined;
 try{fresh=(await client.get<Settings[]>("/settings/"+input.service)).find(row=>row.id===serverId);}
 catch{throw new Error("Seerr write verification failed. Inspect settings before retrying; the change may have been saved.");}
 const verified=(input.anime?fresh?.activeAnimeProfileId:fresh?.activeProfileId)===selected.id;
 if(!verified){
  const status=isAxiosError(writeError)?writeError.response?.status:undefined;
  throw new Error(`Seerr profile was not verified${status?` (HTTP ${status})`:""}. Inspect settings before retrying.`);
 }
 return JSON.stringify({...preview,submitted:true,verified:true,reconciled_after_error:Boolean(writeError)});
}
export const seerrProfileTools:Tool[]=[
 {name:"seerr_get_quality_profile_settings",description:"List linked servers, selected default/anime profiles and available Arr profiles without returning credentials. Read-only connection tests query profiles and folders.",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:"seerr_set_quality_profile",description:"Select an existing linked Arr profile as Seerr's future-request default. Guard current profile ID. Optional anime selection for Sonarr. Preview by default; applying requires human approval. Does not change existing files.",inputSchema:{type:"object",properties:{service:{type:"string",enum:["sonarr","radarr"]},server_id:{type:"integer",minimum:0},profile_id:{type:"integer",minimum:1},expected_current_profile_id:{type:"integer",minimum:1},anime:{type:"boolean",default:false},preview_only:{type:"boolean",default:true}},required:["service","server_id","profile_id","expected_current_profile_id"],additionalProperties:false},annotations:{readOnlyHint:false}},
];
