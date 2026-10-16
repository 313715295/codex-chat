import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareDelegation,packetDigest} from './prepare.mjs';
const api=new Function('return ('+await readFile(new URL('./host-runtime.js',import.meta.url),'utf8')+')')();
const thread='11111111-1111-4111-8111-111111111111',receipt='22222222-2222-4222-8222-222222222222';
function fixture({busy=false,wrong=false,stale=false,failed=false,missing=false,loseAck=false,probeError=false,userOnly=false,readyAt=0}={}){
 const packet=prepareDelegation({taskId:'thread-wait-fixture',goal:'Review synthetic arithmetic only',kind:'review'},
   {schemaVersion:1,targetThreadId:thread,authorizedRoot:'fixture-root',workspaceId:'fixture-workspace'});
 let time=10000;const messages=[],reads=[],gets=[],states=[];
 const result=()=>({status:'found',taskId:packet.assignment.taskId,revision:'r1',receipt:'33333333-3333-4333-8333-333333333333',
   result:{taskId:packet.assignment.taskId,revision:'r1',assignmentReceipt:receipt,status:'completed',summary:'Synthetic outcome',findings:[],materialsRead:[],limitations:[],requests:[]}});
 const host={
  readThread:async()=>{
   reads.push(time);
   if(!messages.length)return {thread:{id:thread,kind:'chatgpt'}};
   if(probeError)throw Object.assign(new Error('fixture probe unavailable'),{code:'HOST_TOOL_TIMEOUT'});
   const n=messages.length-1,start=messages[n].at/1000+(stale?-100:0);
   return {thread:{id:thread,kind:'chatgpt',status:{type:busy?'running':'idle'},updatedAt:start+2},
    turns:[{id:'turn-'+n,status:failed?'failed':busy?'inProgress':'completed',error:failed?{message:'fixture failure'}:null,
      startedAt:start,completedAt:busy?null:start+2,items:[{type:'userMessage',content:[{type:'text',text:wrong?'unrelated task':messages[n].prompt}]},...(!userOnly?[{type:'agentMessage',text:'Synthetic response'}]:[])]}]};
  },
  publishAssignment:async()=>({status:'stored',taskId:packet.assignment.taskId,materialMode:'external',assignmentReceipt:receipt}),
  sendMessage:async({prompt})=>{messages.push({prompt,at:time});if(loseAck&&messages.length===2)throw new Error('lost acknowledgement');return {isError:false};},
  getTaskResult:async args=>{gets.push(time);return messages.length&&time>=readyAt&&(!missing||messages.length>=2)?result():{status:'not_found',...args};}
 };
 const options={deliveryAuthorized:true,waitStrategy:'thread',timeoutMs:610000,now:()=>time,sleep:async ms=>{time+=ms;},checkpoint:async s=>states.push(structuredClone(s))};
 return {packet,host,options,messages,reads,gets,states,setTime:v=>{time=v;}};
}
test('a correlated completed turn retrieves the exact outcome without ten-second result polling',async()=>{
 const f=fixture(),out=await api.delegateAndWait(f.packet,f.host,f.options);
 assert.equal(out.status,'completed');assert.equal(f.messages.length,1);assert.equal(f.gets.length,2);
 assert.equal(out.state.turnMonitor.turnId,'turn-0');assert.equal(out.metrics.fallbackChecks,0);
});
test('five-minute fallback recovers a ready result even when the Chat turn still reports running',async()=>{
 const f=fixture({busy:true}),out=await api.delegateAndWait(f.packet,f.host,f.options);
 assert.equal(out.status,'completed');assert.deepEqual(f.gets,[10000,310000]);assert.equal(out.metrics.fallbackChecks,1);
 assert.equal(f.messages.length,1);assert.equal(out.wait.elapsedMs,300000);
});
test('a missing or errored status probe never disables the independent result fallback',async()=>{
 for(const mode of [{wrong:true},{stale:true},{probeError:true}]){
  const f=fixture(mode),out=await api.delegateAndWait(f.packet,f.host,f.options);
  assert.equal(out.status,'completed');assert.deepEqual(f.gets,[10000,310000]);assert.equal(f.messages.length,1);
  if(mode.probeError)assert.ok(out.metrics.threadProbeErrors>0);
 }
});
test('unchanged state stays in the same invocation through multiple fallback checks and exits at the budget',async()=>{
 const f=fixture({busy:true,readyAt:Infinity}),out=await api.delegateAndWait(f.packet,f.host,f.options);
 assert.equal(out.status,'timeout');assert.equal(out.wait.elapsedMs,610000);assert.deepEqual(f.gets,[10000,310000,610000]);
 assert.equal(out.metrics.fallbackChecks,2);assert.equal(f.messages.length,1);assert.equal(out.didRequestModel,false);
});
test('a finished turn missing its submission gets only one bound submission reminder',async()=>{
 const f=fixture({missing:true}),out=await api.delegateAndWait(f.packet,f.host,f.options);
 assert.equal(out.status,'completed');assert.equal(f.messages.length,2);assert.equal(out.metrics.automaticResultMessagesSent,1);
 assert.ok(f.messages[1].prompt.includes(receipt));assert.ok(f.messages[1].prompt.includes('不重新审核'));
 assert.equal(out.state.turnMonitor.phase,'result-submit');
 const resumed=await api.delegateAndWait(f.packet,f.host,{...f.options,resume:out.state});
 assert.equal(resumed.status,'completed');assert.equal(f.messages.length,2);
});
test('an uncertain submission reminder is persisted and never repeated on resume',async()=>{
 const f=fixture({missing:true,loseAck:true}),first=await api.delegateAndWait(f.packet,f.host,f.options);
 assert.equal(first.status,'blocked');assert.equal(first.state.resultSubmission.delivery,'uncertain');
 f.host.getTaskResult=async args=>({status:'not_found',...args});
 const again=await api.delegateAndWait(f.packet,f.host,{...f.options,resume:first.state});
 assert.equal(again.status,'delivery_uncertain');assert.equal(f.messages.length,2);
});
test('a submission reminder that also finishes without a result is never repeated',async()=>{
 const f=fixture({missing:true,readyAt:Infinity}),out=await api.delegateAndWait(f.packet,f.host,f.options);
 assert.equal(out.status,'timeout');assert.equal(f.messages.length,2);assert.equal(out.metrics.automaticResultMessagesSent,1);
 assert.equal(out.metrics.fallbackChecks,2);
});
test('a historical image export that finishes without a submission gets one report-only reminder, never another export',async()=>{
 const f=fixture({missing:true,readyAt:Infinity});
 const packet=prepareDelegation({taskId:'thread-image-missing',goal:'Return generated image',kind:'design',imagePrompt:'生成一张简洁山水图，无文字。',imageGeneration:true},
  {schemaVersion:1,targetThreadId:thread,authorizedRoot:'fixture-root',workspaceId:'fixture-workspace'});
 packet.imagePrompt=packet.imagePrompts[0];delete packet.imageDelivery;delete packet.imagePrompts;
 packet.attachments={root:'fixture-root',requests:[]};packet.packetId=packetDigest(packet);
 f.host.publishAssignment=async()=>({status:'stored',taskId:packet.assignment.taskId,materialMode:'external',assignmentReceipt:receipt});
 const attachments={host:{list_task_attachments:async()=>({status:'found',attachments:[],nextCursor:null}),get_attachment:async()=>{},delete_attachment:async()=>{}},api:{upload:async()=>{},download:async()=>{}},io:{describe:async()=>{}},outputRoot:'fixture-out'};
 const out=await api.delegateAndWait(packet,f.host,{...f.options,attachments});
 assert.equal(out.status,'timeout');assert.equal(f.messages.length,3);assert.equal(out.metrics.automaticExportMessagesSent,1);assert.equal(out.metrics.automaticResultMessagesSent,1);
 assert.ok(f.messages[2].prompt.includes('本轮不重新导出、不上传、不生成图片'));
});
test('only the correlated failed turn stops the task, and cancellation prevents follow-up messages',async()=>{
 const f=fixture({failed:true}),out=await api.delegateAndWait(f.packet,f.host,f.options);
 assert.equal(out.errorCode,'CHAT_TURN_FAILED');assert.equal(f.messages.length,1);
 const g=fixture({busy:true,readyAt:Infinity});let cancelled=false;
 const stopped=await api.delegateAndWait(g.packet,g.host,{...g.options,isCancelled:()=>cancelled,sleep:async()=>{cancelled=true;}});
 assert.equal(stopped.status,'cancelled');assert.equal(g.messages.length,1);
});
test('a previously sent packet without a new turn anchor is recovered by fallback without guessing or resending',async()=>{
 const f=fixture({busy:true,readyAt:Infinity}),first=await api.delegateAndWait(f.packet,f.host,{...f.options,timeoutMs:1000});
 delete first.state.turnMonitor;let reads=0;f.host.getTaskResult=async args=>++reads===1?{status:'not_found',...args}:
  {status:'found',taskId:args.taskId,revision:args.revision,receipt:'33333333-3333-4333-8333-333333333333',result:{taskId:args.taskId,revision:args.revision,assignmentReceipt:receipt,status:'completed',summary:'Recovered',findings:[],materialsRead:[],limitations:[],requests:[]}};
 const resumed=await api.delegateAndWait(f.packet,f.host,{...f.options,resume:first.state});
 assert.equal(resumed.status,'completed');assert.equal(f.messages.length,1);assert.equal(resumed.metrics.fallbackChecks,1);
});

const resultFirst=options=>({...options,waitStrategy:'result',completionFallback:true,pollIntervalMs:30000});

test('a user-only completed placeholder never triggers an existing-result reminder; result polling continues',async()=>{
 const f=fixture({userOnly:true,readyAt:Infinity}),out=await api.delegateAndWait(f.packet,f.host,resultFirst(f.options));
 assert.equal(out.status,'timeout');assert.equal(f.messages.length,1);assert.equal(out.metrics.fallbackChecks,2);assert.equal(out.metrics.automaticResultMessagesSent,0);
 const g=fixture({userOnly:true,readyAt:340000}),ready=await api.delegateAndWait(g.packet,g.host,resultFirst(g.options));
 assert.equal(ready.status,'completed');assert.equal(g.messages.length,1);assert.equal(ready.metrics.automaticResultMessagesSent,0);
});

test('a target system error stops before publishing or sending a new task',async()=>{
 const f=fixture();f.host.readThread=async()=>({thread:{id:thread,kind:'chatgpt',status:{type:'systemError'}}});
 const out=await api.delegateAndWait(f.packet,f.host,resultFirst(f.options));
 assert.equal(out.status,'blocked');assert.equal(out.errorCode,'TARGET_CHAT_SYSTEM_ERROR');assert.equal(f.messages.length,0);assert.equal(out.state.assignmentReceipt,null);
});

test('five-minute fallback reports a target system error even when the acknowledged message has no visible turn',async()=>{
 const f=fixture({readyAt:Infinity}),read=f.host.readThread;
 f.host.readThread=async()=>f.messages.length?{thread:{id:thread,kind:'chatgpt',status:{type:'systemError'}},turns:[]}:read();
 const out=await api.delegateAndWait(f.packet,f.host,resultFirst(f.options));
 assert.equal(out.status,'blocked');assert.equal(out.errorCode,'TARGET_CHAT_SYSTEM_ERROR');assert.equal(out.wait.elapsedMs,300000);
 assert.equal(f.messages.length,1);assert.equal(out.metrics.fallbackChecks,1);assert.equal(out.metrics.automaticResultMessagesSent,0);
});

test('result-first waiting retrieves a ready outcome without probing the Chat turn before five minutes',async()=>{
 const f=fixture({busy:true,readyAt:100000}),out=await api.delegateAndWait(f.packet,f.host,resultFirst(f.options));
 assert.equal(out.status,'completed');assert.deepEqual(f.reads,[10000]);assert.equal(out.metrics.threadProbes,0);
 assert.deepEqual(f.gets,[10000,10000,40000,70000,100000]);assert.equal(out.metrics.fallbackChecks,0);assert.equal(f.messages.length,1);
});

test('result-first five-minute fallback checks the correlated completed turn and recovers a missing submission once',async()=>{
 const f=fixture({missing:true}),out=await api.delegateAndWait(f.packet,f.host,resultFirst(f.options));
 assert.equal(out.status,'completed');assert.deepEqual(f.reads,[10000,310000]);assert.equal(out.metrics.fallbackChecks,1);
 assert.equal(out.metrics.automaticResultMessagesSent,1);assert.equal(f.messages.length,2);assert.ok(f.messages[1].prompt.includes(receipt));
 assert.equal(f.gets.at(-1),340000);
});

test('an errored five-minute completion fallback leaves ordinary result polling active',async()=>{
 const f=fixture({probeError:true,readyAt:340000}),out=await api.delegateAndWait(f.packet,f.host,resultFirst(f.options));
 assert.equal(out.status,'completed');assert.deepEqual(f.reads,[10000,310000]);assert.equal(out.metrics.threadProbeErrors,1);
 assert.equal(f.messages.length,1);assert.equal(f.gets.at(-1),340000);
});

test('an uncertain result-first submission reminder is never repeated on resume',async()=>{
 const f=fixture({missing:true,loseAck:true}),first=await api.delegateAndWait(f.packet,f.host,resultFirst(f.options));
 assert.equal(first.status,'blocked');assert.equal(first.state.resultSubmission.delivery,'uncertain');
 f.host.getTaskResult=async args=>({status:'not_found',...args});
 const again=await api.delegateAndWait(f.packet,f.host,{...resultFirst(f.options),resume:first.state});
 assert.equal(again.status,'delivery_uncertain');assert.equal(f.messages.length,2);
});

test('result-first resume without a turn anchor never guesses a turn or sends another task',async()=>{
 const f=fixture({missing:true,readyAt:Infinity}),first=await api.delegateAndWait(f.packet,f.host,{...resultFirst(f.options),timeoutMs:1000});
 delete first.state.turnMonitor;
 const again=await api.delegateAndWait(f.packet,f.host,{...resultFirst(f.options),resume:first.state,timeoutMs:310000});
 assert.equal(again.status,'timeout');assert.equal(again.metrics.fallbackChecks,1);assert.equal(f.messages.length,1);
});

test('result-first empty checks remain in one invocation and repeated fallbacks never repeat the reminder',async()=>{
 const f=fixture({missing:true,readyAt:Infinity}),out=await api.delegateAndWait(f.packet,f.host,resultFirst(f.options));
 assert.equal(out.status,'timeout');assert.equal(out.wait.elapsedMs,610000);assert.equal(out.metrics.fallbackChecks,2);
 assert.equal(f.messages.length,2);assert.equal(out.metrics.automaticResultMessagesSent,1);assert.equal(out.didRequestModel,false);
});
