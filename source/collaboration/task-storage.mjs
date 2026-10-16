// Managed local task cache only. Never deletes user materials, outputs or cloud data.
import fs from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {join,resolve,dirname,basename,sep,parse,isAbsolute} from 'node:path';
const defaultBase=()=>join(process.env.LOCALAPPDATA??homedir(),'CodexChatReader');
const DAY=86400000,RETENTION=7*DAY,MAX=1048576;
const hash=v=>createHash('sha256').update(v).digest('hex');
const json=v=>JSON.stringify(v,null,2)+'\n';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const insist=(v,code)=>{if(!v)fail(code);};
const same=(a,b)=>sep==='\\'?a.toLowerCase()===b.toLowerCase():a===b;
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
function sourceThreadId(value=process.env.CODEX_THREAD_ID){insist(uuid(value),'CURRENT_CODEX_THREAD_ID_REQUIRED');return value.toLowerCase();}
export function stable(v){if(Array.isArray(v))return '['+v.map(stable).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';return JSON.stringify(v);}
export function packetDigest(packet){const {packetId,...body}=packet;return hash(stable(body));}
async function directory(path){
  let cursor=parse(resolve(path)).root;
  for(const part of resolve(path).slice(cursor.length).split(sep).filter(Boolean)){
    cursor=join(cursor,part);const info=await fs.lstat(cursor);
    insist(info.isDirectory()&&!info.isSymbolicLink(),'TASK_CACHE_LINK_NOT_ALLOWED');
  }
  return fs.realpath(path);
}
async function readJson(path,optional=false){
  try{const info=await fs.lstat(path);insist(info.isFile()&&!info.isSymbolicLink()&&info.size<=MAX,'TASK_CACHE_FILE_NOT_REGULAR');return JSON.parse(await fs.readFile(path,'utf8'));}
  catch(e){if(optional&&e.code==='ENOENT')return null;throw e;}
}
async function atomicJson(path,value){
  const body=json(value);insist(Buffer.byteLength(body)<=MAX,'TASK_CACHE_SIZE_LIMIT');
  try{const info=await fs.lstat(path);insist(info.isFile()&&!info.isSymbolicLink(),'TASK_CACHE_FILE_NOT_REGULAR');}
  catch(e){if(e.code!=='ENOENT')throw e;}
  const temporary=path+'.'+randomUUID()+'.tmp';
  try{await fs.writeFile(temporary,body,{flag:'wx'});await fs.rename(temporary,path);}
  finally{await fs.rm(temporary,{force:true});}
}
async function managed(packetPath,{base=defaultBase(),codexThreadId=sourceThreadId()}={}){
  const id=sourceThreadId(codexThreadId),cache=await directory(join(resolve(base),'collaboration-tasks',id));
  const supplied=resolve(packetPath);insist(same(await directory(dirname(supplied)),cache),'TASK_CACHE_BOUNDARY');
  const path=join(cache,basename(supplied));
  const packet=await readJson(path);
  insist(packet.packetId===packetDigest(packet)&&packet.source?.codexThreadId===id,'TASK_CACHE_PACKET_MISMATCH');
  insist(basename(path)===packet.assignment.taskId+'-'+packet.assignment.revision+'-'+packet.packetId.slice(0,12)+'.json','TASK_CACHE_NAME_MISMATCH');
  return {packet,path,statePath:path+'.state.json',id,base:resolve(base)};
}
function checkState(state,packet){
  insist(state?.schemaVersion===1&&state.packetId===packet.packetId&&state.taskId===packet.assignment.taskId&&state.revision===packet.assignment.revision&&state.threadId===packet.target.threadId,'TASK_CACHE_STATE_MISMATCH');
}
async function reportLocation(outputRoot,packetId){
  insist(typeof outputRoot==='string'&&isAbsolute(outputRoot),'ABSOLUTE_OUTPUT_ROOT_REQUIRED');
  await fs.mkdir(outputRoot,{recursive:true});const output=await directory(outputRoot),recordPath=join(output,'outcome.json');
  const prior=await readJson(recordPath,true);insist(!prior||prior.outcome?.state?.packetId===packetId,'TASK_REPORT_PATH_OCCUPIED');
  return recordPath;
}
export async function prepareTask({packetPath,outputRoot,...scope}){
  const job=await managed(packetPath,scope),prior=await readJson(job.statePath,true);
  insist(prior?.type!=='codex-chat-receipt','TASK_ARCHIVED_WITH_RECEIPT');
  await reportLocation(outputRoot,job.packet.packetId);return {status:'ready'};
}
export async function saveState({packetPath,state,...scope}){
  const job=await managed(packetPath,scope);checkState(state,job.packet);
  const prior=await readJson(job.statePath,true);insist(prior?.type!=='codex-chat-receipt','TASK_ARCHIVED_WITH_RECEIPT');
  await atomicJson(job.statePath,state);return {status:'saved'};
}
function completion(outcome,packet){
  const s=outcome.state;if(outcome.executionCleanup?.pending)return false;
  if(outcome.status==='sent'&&packet.imageDelivery==='manual')return s.delivery==='sent'&&outcome.sentCount===packet.imagePrompts.length&&s.instructions?.length===packet.imagePrompts.length&&s.instructions.every(v=>v.delivery==='sent'&&Number.isFinite(v.sentAt));
  if(outcome.status!=='completed'||outcome.result?.status!=='completed'||!uuid(s.assignmentReceipt)||!uuid(outcome.resultReceipt)||
    outcome.result.taskId!==s.taskId||outcome.result.revision!==s.revision||outcome.result.assignmentReceipt!==s.assignmentReceipt)return false;
  if(packet.attachments){
    if(!outcome.cleanup||outcome.cleanup.pending?.length!==0)return false;
    const removed=new Set(outcome.cleanup.deleted??[]),downloads=new Set((outcome.downloads??[]).map(d=>d.attachmentId));
    if(!(s.inputAttachments??[]).every(d=>removed.has(d.attachmentId))||!(outcome.result.attachmentIds??[]).every(id=>removed.has(id)&&downloads.has(id)))return false;
  }
  return true;
}
export async function finishTask({packetPath,outputRoot,outcome,metrics,now=Date.now(),...scope}){
  insist(Number.isSafeInteger(now)&&now>=0,'INVALID_TASK_TIME');
  const job=await managed(packetPath,scope);checkState(outcome.state,job.packet);
  const recordPath=await reportLocation(outputRoot,job.packet.packetId);
  const existing=await readJson(job.statePath,true);insist(existing?.type!=='codex-chat-receipt','TASK_ARCHIVED_WITH_RECEIPT');
  const eligible=completion(outcome,job.packet),old=existing?.localRetention;
  const evidence={packetId:job.packet.packetId,sourceThreadId:job.id,targetThreadId:job.packet.target.threadId,taskId:job.packet.assignment.taskId,revision:job.packet.assignment.revision,
    status:outcome.status,assignmentReceipt:outcome.state.assignmentReceipt??null,resultReceipt:outcome.resultReceipt??null,
    resultSha256:outcome.result?hash(JSON.stringify(outcome.result)):null,recordPath,
    downloads:(outcome.downloads??[]).map(d=>({path:d.path,sizeBytes:d.sizeBytes,sha256:d.sha256,attachmentId:d.attachmentId})),
    ...(job.packet.imageDelivery==='manual'?{generationVerified:false,instructionSha256:job.packet.imagePrompts.map(p=>hash(p)),sentCount:outcome.sentCount??0}:{})};
  const finishedAt=eligible&&old?.eligible&&old.evidence?.resultReceipt===evidence.resultReceipt?old.finishedAt:new Date(now).toISOString();
  const state={...outcome.state,localRetention:{schemaVersion:1,eligible,finishedAt,evidence}};
  await atomicJson(recordPath,{outcome,metrics});await atomicJson(job.statePath,state);
  return {status:'saved',recordPath,cacheRetentionDays:7,cacheEligible:eligible};
}
export async function pruneCompleted({base=defaultBase(),codexThreadId=sourceThreadId(),now=Date.now(),dryRun=true,limit=100}={}){
  insist(Number.isSafeInteger(now)&&now>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=1000,'INVALID_CLEANUP_OPTIONS');
  const id=sourceThreadId(codexThreadId),folder=join(resolve(base),'collaboration-tasks',id);
  try{await directory(folder);}catch(e){if(e.code==='ENOENT')return {status:'checked',dryRun,archived:0,eligible:0,kept:0,problems:[]};throw e;}
  // Binding/CLI dependencies stay outside the restricted local file bridge.
  const {withBindingSnapshot}=await import('./bindings.mjs');
  return withBindingSnapshot(resolve(base),async store=>{
    const protectedIds=new Set([store.activeTasks[id]?.packetId,...Object.keys(store.routedTasks[id]??{}),...Object.keys(store.pausedTasks?.[id]??{})].filter(Boolean));
    const report={status:'checked',dryRun,archived:0,eligible:0,kept:0,problems:[]};
    const names=(await fs.readdir(folder)).filter(n=>n.endsWith('.json.state.json')).sort();
    for(const name of names){
      if(report.eligible>=limit)break;
      const statePath=join(folder,name),packetPath=statePath.slice(0,-'.state.json'.length);
      try{
        const state=await readJson(statePath),receipt=state?.type==='codex-chat-receipt',retention=receipt?state:state?.localRetention;
        const evidence=retention?.evidence,finished=Date.parse(retention?.finishedAt);
        if(!evidence||evidence.sourceThreadId!==id||protectedIds.has(evidence.packetId)||!Number.isFinite(finished)||now-finished<RETENTION||(!receipt&&retention.eligible!==true)) {report.kept++;continue;}
        const packet=await readJson(packetPath,true);
        if(!packet){report.kept++;continue;}
        const job=await managed(packetPath,{base,codexThreadId:id});
        insist(evidence.packetId===job.packet.packetId&&evidence.taskId===job.packet.assignment.taskId&&evidence.revision===job.packet.assignment.revision,'TASK_CACHE_RECEIPT_MISMATCH');
        if(protectedIds.has(job.packet.packetId)){report.kept++;continue;}
        if(!receipt){checkState(state,job.packet);if(state.delivery!=='sent'||['sending','uncertain'].includes(state.resultSubmission?.delivery)){report.kept++;continue;}}
        insist(['completed','sent'].includes(evidence.status)&&((evidence.status==='completed'&&uuid(evidence.resultReceipt))||(evidence.status==='sent'&&job.packet.imageDelivery==='manual')),'TASK_CACHE_COMPLETION_MISMATCH');
        report.eligible++;
        if(!dryRun){
          const compact={schemaVersion:1,type:'codex-chat-receipt',finishedAt:retention.finishedAt,archivedAt:new Date(now).toISOString(),evidence};
          await atomicJson(statePath,compact);
          // The receipt is durable before removing the full, verified managed packet.
          const current=await managed(packetPath,{base,codexThreadId:id});insist(current.packet.packetId===evidence.packetId,'TASK_CACHE_PACKET_CHANGED');
          await fs.unlink(current.path);report.archived++;
        }
      }catch(e){report.problems.push({file:name,errorCode:e.code??'TASK_CACHE_NOT_VERIFIED'});}
    }
    return report;
  });
}
if(import.meta.main){
  const args=process.argv.slice(2);
  if(args[0]!=='cleanup'||args.length>2||args[1]&&args[1]!=='--apply')throw new Error('Usage: task-storage.mjs cleanup [--apply]');
  pruneCompleted({dryRun:args[1]!=='--apply'}).then(v=>console.log(JSON.stringify(v))).catch(e=>{console.error(e.code??e.message);process.exitCode=1;});
}
