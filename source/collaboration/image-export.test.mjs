import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareDelegation,packetDigest} from './prepare.mjs';
const api=new Function('return ('+await readFile(new URL('./host-runtime.js',import.meta.url),'utf8')+')')();
const thread='11111111-1111-4111-8111-111111111111',receipt='22222222-2222-4222-8222-222222222222',id='att_'+'a'.repeat(48);
function fixture({busy=false,unchanged=false,otherTask=false,uploading=false,loseAck=false,legacy=false,turnOffset=0,wrappedPrompt=false}={}){
 const packet=prepareDelegation({taskId:'image-fixture',goal:'Generate original image and return original file',context:'Internal transport details',criteria:['Export and submit original'],imagePrompt:'生成一张横版武侠高手对决图：云雾山巅古桥，两位剑客交锋，电影光影，无文字。',kind:'design',receiveAttachments:true,imageGeneration:true},{schemaVersion:1,targetThreadId:thread,authorizedRoot:'fixture-root',workspaceId:'fixture-workspace'});
 if(legacy){delete packet.imagePrompt;packet.packetId=packetDigest(packet);}
 let time=10000,original='',result=null,deleted=false;const messages=[],states=[];
 const meta={attachmentId:id,taskId:packet.assignment.taskId,revision:'r1',assignmentReceipt:receipt,purpose:'result',fileName:'image.png',mimeType:'image/png',sizeBytes:8,sha256:'a'.repeat(64),readable:true};
 const host={readThread:async()=>({thread:{id:thread,kind:'chatgpt',status:{type:busy?'running':'idle'},updatedAt:(unchanged?10:12)+turnOffset},turns:[{status:'completed',startedAt:10+turnOffset,items:[{type:'userMessage',content:[{type:'text',text:otherTask?'other task':wrappedPrompt?'other request '+original:original}]}]}]}),publishAssignment:async()=>({status:'stored',taskId:packet.assignment.taskId,materialMode:'external',assignmentReceipt:receipt}),getTaskResult:async args=>result??{status:'not_found',...args},sendMessage:async args=>{messages.push(args.prompt);if(messages.length===1)original=args.prompt;else{if(loseAck)throw new Error('lost export acknowledgement');result={status:'found',taskId:packet.assignment.taskId,revision:'r1',receipt:'33333333-3333-4333-8333-333333333333',result:{taskId:packet.assignment.taskId,revision:'r1',assignmentReceipt:receipt,status:'completed',summary:'original file exported',materialsRead:[],findings:[],requests:[],limitations:[],attachmentIds:[id]}};}return{isError:false};}};
 const attachments={host:{list_task_attachments:async()=>({status:'found',attachments:uploading?[{...meta,state:'uploading'}]:[],nextCursor:null}),get_attachment:async()=>{if(deleted)throw Object.assign(new Error('deleted'),{code:'attachment_deleted'});return meta;},delete_attachment:async()=>{deleted=true;return{status:'deleted',attachmentId:id};}},api:{upload:async()=>{},download:async()=>({...meta,path:'fixture-out/image.png'})},io:{describe:async()=>({sizeBytes:8,sha256:'a'.repeat(64)})},outputRoot:'fixture-out'};
 const options={deliveryAuthorized:true,timeoutMs:100000,now:()=>time,sleep:async ms=>{time+=ms;},checkpoint:async s=>states.push(structuredClone(s)),attachments};
 return{packet,host,options,messages,states};
}
test('first image message contains only creative content; a separate bound export returns files and cleans up',async()=>{
 const f=fixture(),out=await api.delegateAndWait(f.packet,f.host,f.options);
 assert.equal(out.status,'completed');assert.equal(f.messages.length,2);assert.equal(out.metrics.automaticExportMessagesSent,1);assert.equal(out.downloads.length,1);assert.equal(out.cleanup.pending.length,0);
 assert.ok(f.messages[1].includes('不生成'));assert.ok(f.messages[1].includes(receipt));
 assert.equal(f.messages[0],f.packet.imagePrompt);assert.ok(!f.messages[0].includes(receipt));assert.ok(!f.messages[0].includes(f.packet.assignment.taskId));assert.ok(!f.messages[0].includes('submit_task_result'));
 const again=await api.delegateAndWait(f.packet,f.host,{...f.options,resume:out.state});assert.equal(again.status,'completed');assert.equal(f.messages.length,2);
});
test('image export names the verified application while the generation prompt remains creative only',async()=>{
 const f=fixture();f.host.applicationName='Owner Private Results';
 const out=await api.delegateAndWait(f.packet,f.host,f.options);
 assert.equal(out.status,'completed');assert.equal(f.messages.length,2);
 assert.equal(f.messages[0],f.packet.imagePrompt);
 assert.ok(f.messages[1].startsWith('请使用已连接的「Owner Private Results」应用'));
 assert.ok(f.messages[1].includes(receipt));assert.equal(out.metrics.automaticExportMessagesSent,1);
});

test('elapsed time or idle alone, another turn, and an uploading result never trigger continuation',async()=>{
 for(const mode of [{busy:true},{unchanged:true},{otherTask:true},{uploading:true},{turnOffset:-10},{turnOffset:10},{wrappedPrompt:true}]){const f=fixture(mode),out=await api.delegateAndWait(f.packet,f.host,f.options);assert.equal(out.status,'timeout');assert.equal(f.messages.length,1);}
});
test('lost export acknowledgement remains uncertain and resume never repeats it',async()=>{
 const f=fixture({loseAck:true}),out=await api.delegateAndWait(f.packet,f.host,f.options);assert.equal(out.status,'blocked');assert.equal(out.state.imageExport.delivery,'uncertain');assert.equal(f.messages.length,2);
 const resumed=await api.delegateAndWait(f.packet,f.host,{...f.options,resume:out.state});assert.equal(resumed.status,'delivery_uncertain');assert.equal(f.messages.length,2);
});
test('image generation must explicitly enable original-file transport; text completion alone is rejected',()=>{
 assert.throws(()=>prepareDelegation({goal:'image',kind:'design',imageGeneration:true},{schemaVersion:1,targetThreadId:thread,authorizedRoot:'root',workspaceId:'w'}),/IMAGE_RESULT_TRANSPORT_REQUIRED/);
 const f=fixture();assert.throws(()=>api.verifyResult({status:'found',taskId:f.packet.assignment.taskId,revision:'r1',receipt, result:{taskId:f.packet.assignment.taskId,revision:'r1',assignmentReceipt:receipt,status:'completed',summary:'image path',findings:[],materialsRead:[],limitations:[],requests:[]}},f.packet,receipt),/IMAGE_RESULT_FILE_REQUIRED/);
});
test('missing original send-window state stops before another message',async()=>{
 const f=fixture({busy:true}),first=await api.delegateAndWait(f.packet,f.host,f.options);
 const bad=structuredClone(first.state);delete bad.imageExport.generationRequestedAt;
 await assert.rejects(api.delegateAndWait(f.packet,f.host,{...f.options,resume:bad}),/IMAGE_REQUEST_TIMESTAMP_REQUIRED/);
 assert.equal(f.messages.length,1);
});
test('previously sent legacy image packets retain their metadata-based completion correlation',async()=>{
 const f=fixture({legacy:true}),first=await api.delegateAndWait(f.packet,f.host,{...f.options,timeoutMs:1});
 assert.equal(first.status,'timeout');assert.equal(f.messages.length,1);assert.ok(f.messages[0].includes(receipt));
 const resumed=await api.delegateAndWait(f.packet,f.host,{...f.options,resume:first.state});assert.equal(resumed.status,'completed');assert.equal(f.messages.length,2);
});
test('a separate creative prompt is pinned in the packet; missing prompts or undeclared delivery of input files fail locally',()=>{
 const f=fixture(),changed={...f.packet,imagePrompt:f.packet.imagePrompt+' different'};assert.notEqual(packetDigest(changed),f.packet.packetId);
 const profile={schemaVersion:1,targetThreadId:thread,authorizedRoot:'root',workspaceId:'w'},request={goal:'Return image',kind:'design',imageGeneration:true,receiveAttachments:true};
 assert.throws(()=>prepareDelegation(request,profile),/IMAGE_PROMPT_REQUIRED/);
 assert.throws(()=>prepareDelegation({...request,imagePrompt:'Create scene',directMaterials:[{path:'reference.txt',wholeFile:true,text:'reference'}]},profile),/IMAGE_PROMPT_REQUIRES_PREPROVIDED_MATERIALS/);
});
