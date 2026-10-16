import { assignmentTools } from '../../lib/assignment-tools';
import { assignmentCall } from '../../lib/assignments';
import { mediaTools, readTestMedia } from '../../lib/test-media';
import { fileTools, readTestFile } from '../../lib/test-file';
import { events } from '../../lib/events';
import { tools, validate } from '../../lib/protocol';
import { getReview, submitReview } from '../../lib/reviews';
import { attachmentTools, attachmentCall } from '../../lib/attachments';
import { collaborationEntryTool, collaborationEntry } from '../../lib/collaboration-entry';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers});
const rpcError=(id:unknown,code:number,message:string,status=200)=>json({jsonrpc:'2.0',id,error:{code,message}},status);
export async function POST(req:Request) {
 const origin=req.headers.get('origin');
 if(origin&&!['https://chatgpt.com',new URL(req.url).origin].includes(origin))return json({error:'FORBIDDEN_ORIGIN'},403);
 if(!req.headers.get('content-type')?.includes('application/json'))return json({error:'JSON_REQUIRED'},415);
 if(Number(req.headers.get('content-length')||0)>8388608)return json({error:'REQUEST_TOO_LARGE'},413);
 let body:any;
 try {const raw=await req.text();if(new TextEncoder().encode(raw).length>8388608)return json({error:'REQUEST_TOO_LARGE'},413);body=JSON.parse(raw);}catch{return rpcError(null,-32700,'Parse error');}
 if(!body||Array.isArray(body)||body.jsonrpc!=='2.0'||typeof body.method!=='string')return rpcError(null,-32600,'Invalid request');
 const id=body.id??null;
 if(!Object.hasOwn(body,'id'))return new Response(null,{status:202,headers});
 if(typeof id!=='string'&&typeof id!=='number')return rpcError(null,-32600,'Invalid id');
 const modern=req.headers.get('mcp-protocol-version')==='2026-07-28' || body.method==='server/discover' || body.method.startsWith('events/');
 const result=(id:unknown,value:object)=>json({jsonrpc:'2.0',id,result:modern?{resultType:'complete',...value}:value});
 const channel={schemaVersion:1,mcpUrl:new URL(req.url).origin+'/mcp',principalId:req.headers.get('oai-authenticated-user-id')};
 const toolResult=(id:unknown,value:object,isError=false)=>{
  const bound={...value,channel};
  return result(id,{content:[{type:'text',text:JSON.stringify(bound)}],structuredContent:bound,...(isError?{isError:true}:{})});
 };
 console.info(JSON.stringify({event:'mcp_request',method:body.method,modern}));
 if(body.method==='server/discover') return result(id,{supportedVersions:['2026-07-28'],capabilities:{tools:{},events:{}},serverInfo:{name:'codex-chat-result-test',version:'1.2.1-codex-materials'}});
 if(body.method==='events/list') return result(id,{events,ttlMs:0,cacheScope:'private'});
 if(body.method==='events/subscribe'||body.method==='events/unsubscribe') {
   if(!req.headers.get('oai-authenticated-user-id'))return json({error:'AUTHENTICATED_USER_REQUIRED'},401);
   if(body.method==='events/unsubscribe')return result(id,{});
   return json({jsonrpc:'2.0',id,error:{code:-32015,message:'Event discovery preview only; callback delivery is not enabled. No subscription created and no callback secret stored.',data:{reason:'delivery_not_enabled'}}});
 }
 if(body.method==='initialize') {
  const versions=['2024-11-05','2025-03-26','2025-06-18','2025-11-25','2026-07-28'];
  const requested=body.params?.protocolVersion;
  return result(id,{protocolVersion:versions.includes(requested)?requested:'2025-06-18',capabilities:{tools:{listChanged:false}},serverInfo:{name:'codex-chat-result-test',version:'1.2.1-codex-materials'},instructions:'Codex desktop senders start with get_collaboration_entry; use the installed local host runtime, no separate skill. Chat receivers use task and attachment tools directly. Transfer tasks, selected files and results; the caller decides the work. Keep exact taskId/revision/assignmentReceipt: concurrent tasks never share receipts. materialsRead lists actual INPUT evidence only; OUTPUT files use attachmentIds, with mapping in summary/findings.message. Missing material: needs_materials and specific requests. Do not search unrelated files or change permissions. Original-byte transfer does not prove image/audio perception. Saving a result neither messages nor wakes Codex. Legacy review tools accept synthetic data only.'});
 }
 if(body.method==='ping')return result(id,{});
 if(body.method==='tools/list')return result(id,{tools:[collaborationEntryTool,...tools,...fileTools,...mediaTools,...assignmentTools,...attachmentTools],...(modern?{ttlMs:0,cacheScope:'private'}:{})});
 if(body.method!=='tools/call')return rpcError(id,-32601,'Method not found');
 const user=req.headers.get('oai-authenticated-user-id');
 if(!user)return json({error:'AUTHENTICATED_USER_REQUIRED'},401);
 const name=body.params?.name; const args=body.params?.arguments;
 if(name===collaborationEntryTool.name){const value=collaborationEntry(args);return toolResult(id,value,value.status==='invalid_arguments');}
 if(attachmentTools.some(t=>t.name===name)) {
  const value=await attachmentCall(name,user,args);
  const bound={...value.structuredContent,channel};
  return result(id,{...value,structuredContent:bound,content:value.content.map((c:any)=>c.type==='text'?{...c,text:JSON.stringify(bound)}:c)});
 }
 if(assignmentTools.some(t=>t.name===name)) {try {const value=await assignmentCall(name,user,args);return toolResult(id,value,!['stored','found','not_found','material_not_provided'].includes(String(value.status)));}catch{return toolResult(id,{status:'storage_unavailable',message:'Retry the identical task and revision later.'},true);}}
 if(mediaTools.some(t=>t.name===name)) {const value=readTestMedia(name,args);return result(id,value);}
 if(fileTools.some(t=>t.name===name)) {const value=await readTestFile(name,args);return toolResult(id,value,value.status==='invalid_arguments');}
 if(!tools.some(t=>t.name===name))return rpcError(id,-32602,'Unknown tool');
 if(!validate(name,args))return toolResult(id,{status:'invalid_arguments',message:'Use exact taskId/revision keys and synthetic text only. result must be 1–1048576 UTF-8 bytes.'},true);
 try {
  if(name==='submit_review') {const value=await submitReview(user,args.taskId,args.revision,args.result);return toolResult(id,value,value.status==='conflict');}
  const row=await getReview(user,args.taskId,args.revision);
  return toolResult(id,row?{status:'found',...row}:{status:'not_found',taskId:args.taskId,revision:args.revision});
 }catch {return toolResult(id,{status:'storage_unavailable',message:'Storage is unavailable. Retry later using the same taskId, revision and result.'},true);}
}
export function GET(){return new Response(null,{status:405,headers:{...headers,Allow:'POST'}});}
export function DELETE(){return new Response(null,{status:405,headers:{...headers,Allow:'POST'}});}
