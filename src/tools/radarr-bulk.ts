import { createHash } from "crypto";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ArrClient } from "../arr.js";

interface Movie {id:number;title:string;tmdbId:number;qualityProfileId:number}
interface Profile {id:number;name:string;[key:string]:unknown}
export const bulkProfileSchema=z.object({
 movies:z.array(z.object({movie_id:z.number().int().positive().max(2147483647),expected_profile_id:z.number().int().positive().max(2147483647)}).strict()).min(1).max(200),
 profile_id:z.number().int().positive().max(2147483647),expected_profile_digest:z.string().regex(/^[a-f0-9]{64}$/),preview_only:z.boolean().default(true),
}).strict().superRefine((input,ctx)=>{if(new Set(input.movies.map(m=>m.movie_id)).size!==input.movies.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:"Duplicate movie IDs are not allowed."});});

export async function bulkSetMovieProfile(client:ArrClient,input:z.infer<typeof bulkProfileSchema>):Promise<string> {
 const profile=await client.get<Profile>("/qualityprofile/"+input.profile_id);
 if(createHash("sha256").update(JSON.stringify(profile)).digest("hex")!==input.expected_profile_digest)throw new Error("Destination profile changed. Inspect its current digest and preview again.");
 const current=await client.get<Movie[]>("/movie");
 const selected=input.movies.map(request=>{
  const movie=current.find(m=>m.id===request.movie_id);
  if(!movie)throw new Error("A selected movie is no longer in Radarr. Inspect the selection again.");
  if(movie.qualityProfileId!==request.expected_profile_id)throw new Error("A selected movie's profile changed. Rebuild the batch preview.");
  return {movie_id:movie.id,tmdb_id:movie.tmdbId,title:movie.title,before_profile_id:movie.qualityProfileId,after_profile_id:profile.id};
 });
 const changed=selected.filter(m=>m.before_profile_id!==profile.id);
 const preview={preview:input.preview_only,movies:selected,destination_profile:{id:profile.id,name:profile.name},changes:changed.length,already_assigned:selected.length-changed.length,note:"One approval applies only to these IDs and this profile. Changes future download/upgrade eligibility; no explicit search, download, file move or deletion is submitted."};
 if(input.preview_only||!changed.length)return JSON.stringify(preview);
 try{await client.putOnce("/movie/editor",{movieIds:changed.map(m=>m.movie_id),qualityProfileId:profile.id});}catch{throw new Error("Bulk profile update was not confirmed. Inspect current movie profiles before retrying; some or all changes may have applied.");}
 const fresh=await client.get<Movie[]>("/movie");
 const results=selected.map(row=>({...row,verified:fresh.find(m=>m.id===row.movie_id)?.qualityProfileId===profile.id}));
 return JSON.stringify({...preview,submitted:true,movies:results,all_verified:results.every(row=>row.verified)});
}
export const bulkProfileTool:Tool={
 name:"radarr_bulk_set_quality_profile",
 description:"Assign one existing profile to an explicit batch of up to200 movies with expected current profile IDs and destination profile digest guards. Preview by default; one native human approval covers only this fixed batch. Sends one bulk update, no download or file deletion.",
 inputSchema:{type:"object",properties:{movies:{type:"array",minItems:1,maxItems:200,items:{type:"object",properties:{movie_id:{type:"integer",minimum:1},expected_profile_id:{type:"integer",minimum:1}},required:["movie_id","expected_profile_id"],additionalProperties:false}},profile_id:{type:"integer",minimum:1},expected_profile_digest:{type:"string",pattern:"^[a-f0-9]{64}$"},preview_only:{type:"boolean",default:true}},required:["movies","profile_id","expected_profile_digest"],additionalProperties:false},annotations:{readOnlyHint:false},
};
