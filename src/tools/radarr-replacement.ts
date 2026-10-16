import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import path from "path";
import { ArrClient, ArrCommand, filterArrLanguages, getArrRecords } from "../arr.js";

interface File {id:number;path?:string;size:number;quality?:{quality?:{id:number;name:string}};languages?:Array<{id:number;name:string}>}
interface Movie {id:number;tmdbId:number;title:string;path:string;hasFile:boolean;movieFile?:File;movieFileId?:number;qualityProfileId:number}
interface Release {guid:string;indexerId:number;title:string;size:number;quality?:{quality?:{id:number;name:string}};languages?:Array<{id:number;name:string}>;customFormatScore?:number;customFormats?:Array<{id:number;name:string}>;rejections?:string[];[key:string]:unknown}
interface Candidate {path:string;size:number;movie?:{id:number};quality?:File["quality"];languages?:Array<{id:number;name:string}>;rejections?:Array<{reason:string}>;folderName?:string;releaseGroup?:string;indexerFlags?:number}
export const saverSchema=z.object({min_size_gb:z.number().min(0).max(10000).default(10),quality_name:z.string().max(100).optional(),limit:z.number().int().min(1).max(100).default(20)}).strict();
export const planSchema=z.object({movie_id:z.number().int().positive(),target_quality_ids:z.array(z.number().int().positive()).min(1).max(20),limit:z.number().int().min(1).max(50).default(20),language:z.string().trim().min(1).default("English"),preferred_min_size_gb:z.number().positive().max(1000).default(4),preferred_max_size_gb:z.number().positive().max(1000).default(8)}).strict().refine(input=>input.preferred_min_size_gb<=input.preferred_max_size_gb,{message:"Preferred minimum size must not exceed maximum size."});
export const replacementDownloadSchema=z.object({movie_id:z.number().int().positive(),expected_movie_file_id:z.number().int().positive(),guid:z.string().min(1).max(1000),indexer_id:z.number().int().positive(),expected_quality_id:z.number().int().positive(),expected_release_size:z.number().int().positive(),allow_rejected:z.boolean().default(false),preview_only:z.boolean().default(true)}).strict();
export const replacementImportSchema=z.object({movie_id:z.number().int().positive(),expected_movie_file_id:z.number().int().positive(),candidate_path:z.string().min(1).max(2000),expected_candidate_size:z.number().int().positive(),expected_quality_id:z.number().int().positive(),allow_non_upgrade:z.boolean().default(false),preview_only:z.boolean().default(true)}).strict();
export const inspectReplacementSchema=replacementImportSchema.pick({movie_id:true,candidate_path:true});
export const bulkReplacementImportSchema=z.object({files:z.array(replacementImportSchema.omit({preview_only:true})).min(1).max(100),preview_only:z.boolean().default(true)}).strict().superRefine((input,ctx)=>{
 if(new Set(input.files.map(row=>row.movie_id)).size!==input.files.length||new Set(input.files.map(row=>row.candidate_path)).size!==input.files.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:"Select one unique downloaded file per unique movie."});
});
async function current(client:ArrClient,id:number,expected?:number):Promise<{movie:Movie;file:File}> {
 const movie=await client.get<Movie>("/movie/"+id);
 const file=movie.movieFile ?? (movie.movieFileId?await client.get<File>("/moviefile/"+movie.movieFileId):undefined);
 if(!movie.hasFile||!file?.id||!file.size)throw new Error("Movie has no verified current file. Use the regular import workflow.");
 if(expected!==undefined&&file.id!==expected)throw new Error("Movie file changed. Inspect and preview the replacement again.");
 return {movie,file};
}
export async function listSpaceSavers(client:ArrClient,input:z.infer<typeof saverSchema>):Promise<string> {
 const movies=await client.get<Movie[]>("/movie");
 const candidates=movies.filter(m=>m.hasFile&&m.movieFile&&m.movieFile.size>=input.min_size_gb*1073741824&&(!input.quality_name||m.movieFile.quality?.quality?.name.toLowerCase().includes(input.quality_name.toLowerCase()))).sort((a,b)=>b.movieFile!.size-a.movieFile!.size);
 return JSON.stringify({total:candidates.length,movies:candidates.slice(0,input.limit).map(m=>({movie_id:m.id,tmdb_id:m.tmdbId,title:m.title,file_id:m.movieFile!.id,size_bytes:m.movieFile!.size,quality:m.movieFile!.quality?.quality,quality_profile_id:m.qualityProfileId})),note:"Large-file candidates only. Smaller release availability and savings require a replacement plan; no search or change was submitted."});
}
export async function planReplacement(client:ArrClient,input:z.infer<typeof planSchema>):Promise<string> {
 const {movie,file}=await current(client,input.movie_id);
 const releases=await client.get<Release[]>("/release",{movieId:movie.id});
 const tier=(r:Release):number=>{
  if(!/x265|hevc|h[ .-]?265/i.test(r.title))return 3;
  if(r.size<input.preferred_min_size_gb*1e9)return 1;
  if(r.size>input.preferred_max_size_gb*1e9)return 2;
  return 0;
 };
 const candidates=filterArrLanguages(filterArrLanguages(releases,"English"),input.language).filter(r=>r.size>0&&r.size<file.size&&input.target_quality_ids.includes(r.quality?.quality?.id??-1)).sort((a,b)=>tier(a)-tier(b)||(b.customFormatScore??0)-(a.customFormatScore??0)||b.size-a.size||a.title.localeCompare(b.title));
 return JSON.stringify({movie_id:movie.id,title:movie.title,current_file:file,quality_profile_id:movie.qualityProfileId,ranking:{required_reported_language:"English",additional_reported_language:input.language==="English"?undefined:input.language,preferred_size_gb:[input.preferred_min_size_gb,input.preferred_max_size_gb],order:"HEVC in preferred size range, smaller HEVC fallback, larger HEVC fallback, other codecs; within each tier highest profile score first, then larger size"},total:candidates.length,releases:candidates.slice(0,input.limit).map(r=>({title:r.title,size_bytes:r.size,custom_format_score:r.customFormatScore??null,matched_custom_formats:r.customFormats??[],preference_tier:tier(r),estimated_savings_bytes:file.size-r.size,quality:r.quality?.quality,languages:r.languages,rejections:r.rejections,download_arguments:{movie_id:movie.id,expected_movie_file_id:file.id,guid:r.guid,indexer_id:r.indexerId,expected_quality_id:r.quality!.quality!.id,expected_release_size:r.size,preview_only:true}})),note:"No download submitted. Reported languages and title codec are unverified until the downloaded streams are checked. Unknown scores are sorted as zero. Review matching movie, edition and rejection reasons before selecting. Release size is an estimate. Automatic import may reject downgrades; use an explicitly approved replacement import once downloaded."});
}
const downloadingMovies=new Set<number>();
export async function downloadReplacement(client:ArrClient,input:z.infer<typeof replacementDownloadSchema>):Promise<string> {
 if(downloadingMovies.has(input.movie_id))throw new Error("This MCP session already has a replacement submission in progress for this movie. Wait and inspect queue/history before retrying.");
 downloadingMovies.add(input.movie_id);
 try{return await submitReplacementDownload(client,input);}finally{downloadingMovies.delete(input.movie_id);}
}
async function submitReplacementDownload(client:ArrClient,input:z.infer<typeof replacementDownloadSchema>):Promise<string> {
 const {movie,file}=await current(client,input.movie_id,input.expected_movie_file_id);
 const active=await getArrRecords<{movieId:number;downloadId?:string;title:string}>(client,"/queue");
 if(active.some(row=>row.movieId===movie.id))throw new Error("This movie already has a tracked download. Inspect its queue/history and finish or dismiss that job before submitting another replacement.");
 const releases=await client.get<Release[]>("/release",{movieId:movie.id});
 const release=releases.find(r=>r.guid===input.guid&&r.indexerId===input.indexer_id);
 if(!release||release.quality?.quality?.id!==input.expected_quality_id||release.size!==input.expected_release_size||release.size<=0||release.size>=file.size)throw new Error("Replacement release changed, is not smaller, or is no longer available. Re-run the plan.");
 if(!filterArrLanguages([release],"English").length)throw new Error("This replacement workflow requires reported English audio, even when acknowledging other rejection reasons. German and Italian are additional language preferences.");
 const preview={preview:input.preview_only,movie_id:movie.id,title:movie.title,current_file:file,replacement:{title:release.title,size_bytes:release.size,quality:release.quality?.quality,languages:release.languages,rejections:release.rejections},estimated_savings_bytes:file.size-release.size,note:"Downloads a replacement, leaving the current file in place while downloading. Radarr may reject automatic downgrade import; manual replacement is a separate approved action."};
 if(input.preview_only)return JSON.stringify(preview);
 if(release.rejections?.length&&!input.allow_rejected)throw new Error("Release has rejections. Inspect their reasons and explicitly acknowledge allow_rejected after human approval.");
 const started=Date.now();
 try{await client.postOnce("/release",release,120000);}catch{
  // A timed-out POST can still be accepted by Radarr. Never resend it here.
  for(let attempt=0;attempt<3;attempt++){
   if(attempt)await new Promise(resolve=>setTimeout(resolve,5000));
   try{
    const history=await client.get<{records:Array<{movieId:number;eventType:string;date:string;downloadId?:string;data?:{guid?:string;indexerId?:string}}> }>("/history",{movieId:movie.id,pageSize:100,sortKey:"date",sortDirection:"descending"});
    const grabbed=history.records.find(row=>row.movieId===movie.id&&row.eventType==="grabbed"&&Date.parse(row.date)>=started-2000&&row.data?.guid===release.guid&&Number(row.data?.indexerId)===release.indexerId&&row.downloadId);
    if(grabbed)return JSON.stringify({...preview,submitted:true,confirmed_via:"grab_history_after_uncertain_response",download_id:grabbed.downloadId,note:"Radarr recorded this exact release/indexer as grabbed despite the failed HTTP response. Do not resubmit. Check the download ID in queue/history; import remains a separate action."});
   }catch{}
  }
  throw new Error("Replacement download response was uncertain and no exact recent grab could be confirmed. Do not resubmit blindly. Inspect the queue/history first; it may still have been accepted.");
 }
 return JSON.stringify({...preview,submitted:true,note:"Download submitted. No file was explicitly deleted or manually imported. Monitor the queue; submission is not completed delivery."});
}
async function scanCandidate(client:ArrClient,movie:Movie,candidatePath:string):Promise<Candidate> {
 if(!path.posix.isAbsolute(candidatePath)||path.posix.normalize(candidatePath)!==candidatePath||candidatePath===movie.path||candidatePath.startsWith(movie.path.replace(/\/$/,"")+"/"))throw new Error("Replacement must be an exact absolute downloaded file outside the current movie folder.");
 // Radarr's controller treats movieId as a library scan, ignoring folder.
 const candidates=await client.get<Candidate[]>("/manualimport",{folder:path.posix.dirname(candidatePath),filterExistingFiles:true});
 const candidate=candidates.find(row=>row.path===candidatePath&&row.movie?.id===movie.id);
 if(!candidate)throw new Error("Downloaded candidate was not found or Radarr matched it to another movie. Use radarr_inspect_replacement with the exact Radarr-visible file path.");
 return candidate;
}
export async function inspectReplacement(client:ArrClient,input:z.infer<typeof inspectReplacementSchema>):Promise<string> {
 const {movie,file}=await current(client,input.movie_id);
 const candidate=await scanCandidate(client,movie,input.candidate_path);
 return JSON.stringify({movie_id:movie.id,title:movie.title,current_file:file,candidate,estimated_savings_bytes:file.size-candidate.size,import_arguments:{movie_id:movie.id,expected_movie_file_id:file.id,candidate_path:candidate.path,expected_candidate_size:candidate.size,expected_quality_id:candidate.quality?.quality?.id,allow_non_upgrade:false,preview_only:true},note:"Read-only inspection. Use these exact API values rather than queue/archive sizes or Plex paths. Review rejections before approving replacement. Radarr may remove/recycle the old file during import."});
}
async function prepareImport(client:ArrClient,input:z.infer<typeof replacementImportSchema>) {
 const {movie,file}=await current(client,input.movie_id,input.expected_movie_file_id);
 const candidate=await scanCandidate(client,movie,input.candidate_path);
 if(candidate.size!==input.expected_candidate_size||candidate.size<=0||candidate.size>=file.size||candidate.quality?.quality?.id!==input.expected_quality_id)throw new Error("Downloaded file quality/size changed or is not smaller. Use radarr_inspect_replacement and preview again.");
 const reasons=candidate.rejections?.map(r=>r.reason)??[];
 const nonUpgrade=/not an upgrade|existing file.*(?:quality|score)|(?:higher|equal|better) quality|quality.*(?:not wanted|not allowed)/i;
 if(reasons.some(reason=>!nonUpgrade.test(reason)))throw new Error("Candidate has a rejection other than quality/non-upgrade. Resolve it before replacement: "+reasons.join("; "));
 return {movie,file,candidate};
}
function importPayload(movie:Movie,candidate:Candidate) {
 return {path:candidate.path,folderName:candidate.folderName,movieId:movie.id,quality:candidate.quality,languages:candidate.languages??[],releaseGroup:candidate.releaseGroup??"",indexerFlags:candidate.indexerFlags??0};
}
const replacementNote="Manual replacement bypasses quality/non-upgrade rejection for these exact files. Radarr may remove/recycle old files during import; rollback is not guaranteed. Copy preserves downloaded sources. No pre-deletion, quality falsification or profile changes. Without download tracking, a stale queue row may need a separate reviewed dismissal.";
export async function importReplacement(client:ArrClient,input:z.infer<typeof replacementImportSchema>):Promise<string> {
 const {movie,file,candidate}=await prepareImport(client,input);
 const preview={preview:input.preview_only,movie_id:movie.id,title:movie.title,current_file:file,candidate,estimated_savings_bytes:file.size-candidate.size,note:replacementNote};
 if(input.preview_only)return JSON.stringify(preview);
 if(!input.allow_non_upgrade)throw new Error("Explicitly acknowledge allow_non_upgrade after approving the replacement's old-file removal effect.");
 const fresh=await current(client,movie.id,file.id);
 if(fresh.file.size!==file.size||fresh.movie.path!==movie.path)throw new Error("Current file size or movie folder changed during inspection. Preview again.");
 let command:ArrCommand;
 try{command=await client.postOnce<ArrCommand>("/command",{name:"ManualImport",importMode:"copy",files:[importPayload(movie,candidate)]});}catch{throw new Error("Replacement import was not confirmed. Inspect command/file state before retrying; it may have been queued.");}
 return JSON.stringify({submitted:true,movie_id:movie.id,previous_file_id:file.id,command_id:command.id,status:command.status,note:"Import queued, not completed. Use radarr_get_command and radarr_get_movie_file to verify replacement, then confirm availability in Plex. Do not resend the import while status is uncertain."});
}
export async function bulkImportReplacement(client:ArrClient,input:z.infer<typeof bulkReplacementImportSchema>):Promise<string> {
 const prepared=[];
 for(const row of input.files)prepared.push(await prepareImport(client,{...row,preview_only:true}));
 const preview={preview:input.preview_only,count:prepared.length,movies:prepared.map(({movie,file,candidate})=>({movie_id:movie.id,title:movie.title,previous_file_id:file.id,current_size_bytes:file.size,candidate_path:candidate.path,candidate_size_bytes:candidate.size,quality:candidate.quality,languages:candidate.languages,rejections:candidate.rejections,estimated_savings_bytes:file.size-candidate.size})),note:replacementNote};
 if(input.preview_only)return JSON.stringify(preview);
 if(input.files.some(row=>!row.allow_non_upgrade))throw new Error("Every replacement requires explicit allow_non_upgrade acknowledgement of old-file removal.");
 // Recheck the entire selection together after potentially lengthy candidate scans.
 const fresh=await client.get<Movie[]>("/movie");
 for(const {movie,file} of prepared){
  const latest=fresh.find(row=>row.id===movie.id);
  if(!latest?.hasFile||latest.movieFile?.id!==file.id||latest.movieFile.size!==file.size||latest.path!==movie.path)throw new Error("A current movie file or folder changed during batch inspection. Preview the batch again.");
 }
 let command:ArrCommand;
 try{command=await client.postOnce<ArrCommand>("/command",{name:"ManualImport",importMode:"copy",files:prepared.map(({movie,candidate})=>importPayload(movie,candidate))});}catch{throw new Error("Batch import was not confirmed. Inspect commands and movie files before retrying; it may have been queued. Do not resend the batch blindly.");}
 return JSON.stringify({...preview,submitted:true,command_id:command.id,status:command.status,note:"One batch queued, not completed or atomic. Individual files may fail; inspect radarr_get_command and verify every movie file before retrying or clearing queue rows. "+replacementNote});
}
export const replacementTools:Tool[]=[
 {name:"radarr_inspect_replacement",description:"Read an exact downloaded file as Radarr sees it, with matched movie, current file, size, quality, rejections and exact guarded import arguments. No import or deletion.",inputSchema:{type:"object",properties:{movie_id:{type:"integer",minimum:1},candidate_path:{type:"string"}},required:["movie_id","candidate_path"],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:"radarr_bulk_import_replacements",description:"Preview and manually import up to 100 explicitly selected smaller replacements despite quality/non-upgrade rejection. One approval covers fixed files/movie IDs and expected old file/size/quality. Other rejections blocked. Sends one ManualImport command in copy mode. Radarr may remove/recycle old files; partial success possible. Never pre-deletes media.",inputSchema:{type:"object",properties:{files:{type:"array",minItems:1,maxItems:100,items:{type:"object",properties:{movie_id:{type:"integer",minimum:1},expected_movie_file_id:{type:"integer",minimum:1},candidate_path:{type:"string"},expected_candidate_size:{type:"integer",minimum:1},expected_quality_id:{type:"integer",minimum:1},allow_non_upgrade:{type:"boolean",default:false}},required:["movie_id","expected_movie_file_id","candidate_path","expected_candidate_size","expected_quality_id"],additionalProperties:false}},preview_only:{type:"boolean",default:true}},required:["files"],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true}},
 {name:"radarr_list_space_savers",description:"Read largest movie files, optionally filtered by quality name, to identify space-saving candidates. Does not change or search downloads.",inputSchema:{type:"object",properties:{min_size_gb:{type:"number",minimum:0,default:10},quality_name:{type:"string"},limit:{type:"integer",minimum:1,maximum:100,default:20}},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:"radarr_plan_downgrade",description:"Search smaller releases with required reported language (English by default). Rank HEVC at 4-8 GB first, then smaller fallback, by descending profile custom-format points. Show matched formats, savings, languages, rejections and guarded download arguments. Verify actual audio/codec and edition before import. No download or deletion.",inputSchema:{type:"object",properties:{movie_id:{type:"integer",minimum:1},target_quality_ids:{type:"array",items:{type:"integer",minimum:1},minItems:1},limit:{type:"integer",minimum:1,maximum:50,default:20},language:{type:"string",minLength:1,default:"English",description:"Optional additional reported language. English remains mandatory."},preferred_min_size_gb:{type:"number",exclusiveMinimum:0,maximum:1000,default:4},preferred_max_size_gb:{type:"number",exclusiveMinimum:0,maximum:1000,default:8}},required:["movie_id","target_quality_ids"],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:"radarr_download_replacement",description:"Download a selected smaller release with current file/quality/size guards. Preview by default. Requires approval and rejection acknowledgement. Leaves the existing file while downloading; manual downgrade import may be necessary.",inputSchema:{type:"object",properties:{movie_id:{type:"integer"},expected_movie_file_id:{type:"integer"},guid:{type:"string"},indexer_id:{type:"integer"},expected_quality_id:{type:"integer"},expected_release_size:{type:"integer"},allow_rejected:{type:"boolean",default:false},preview_only:{type:"boolean",default:true}},required:["movie_id","expected_movie_file_id","guid","indexer_id","expected_quality_id","expected_release_size"],additionalProperties:false},annotations:{readOnlyHint:false}},
 {name:"radarr_import_replacement",description:"Explicitly replace a movie with an already downloaded smaller file despite quality/non-upgrade rejection. Exact file/movie/quality/size guards; other import errors rejected. Preview by default. Requires approval and allow_non_upgrade. Copy preserves source; Radarr may delete/recycle old media. Never pre-deletes the old file.",inputSchema:{type:"object",properties:{movie_id:{type:"integer"},expected_movie_file_id:{type:"integer"},candidate_path:{type:"string"},expected_candidate_size:{type:"integer"},expected_quality_id:{type:"integer"},allow_non_upgrade:{type:"boolean",default:false},preview_only:{type:"boolean",default:true}},required:["movie_id","expected_movie_file_id","candidate_path","expected_candidate_size","expected_quality_id"],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true}},
];
