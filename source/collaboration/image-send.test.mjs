import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareDelegation,packetDigest} from './prepare.mjs';
const api=new Function('return ('+await readFile(new URL('./host-runtime.js',import.meta.url),'utf8')+')')();
const thread='11111111-1111-4111-8111-111111111111';
const profile={schemaVersion:1,targetThreadId:thread,authorizedRoot:'fixture-root',workspaceId:'fixture-workspace'};
const request={goal:'Send chosen image instructions',kind:'design',imageGeneration:true};
function fixture({prompts=['Draw a swordsman'],busy=false,unmatched=false,offset=0,loseAck=false,turnError=false,lag=2000}={}){
 const packet=prepareDelegation({...request,imagePrompts:prompts},profile),messages=[],states=[],releases=[];
 let time=10000,last=null,probes=0;
 const host={
  readThread:async()=>{
   probes++;
   return {thread:{id:thread,kind:'chatgpt',status:{type:busy||last&&time-last.started<lag?'running':'idle'}},
    turns:last?[{id:'turn-'+messages.length,status:turnError?'failed':'completed',startedAt:last.started/1000+offset,
     completedAt:(last.started+lag)/1000+offset,items:[{type:'userMessage',content:[{type:'text',text:unmatched?'Unrelated message':last.prompt}]}]}]:[]};
  },
  sendMessage:async args=>{messages.push(args);last={prompt:args.prompt,started:time};if(loseAck)throw new Error('lost acknowledgement');return {isError:false};}
 };
 const options={deliveryAuthorized:true,timeoutMs:10000,threadProbeIntervalMs:1000,now:()=>time,sleep:async ms=>{time+=ms;},
  checkpoint:async state=>states.push(structuredClone(state)),execution:{acquire:async()=>({waiterId:'fixture'}),release:async(_,value)=>releases.push(value)}};
 return {packet,host,options,messages,states,releases,probes:()=>probes};
}

test('image instructions are opt-in, normalize one or several prompts, and reject automatic return or hidden materials',()=>{
 const single=prepareDelegation({...request,imagePrompt:'Draw a bridge'},profile);
 assert.equal(single.imageDelivery,'manual');assert.deepEqual(single.imagePrompts,['Draw a bridge']);assert.equal(single.attachments,undefined);
 assert.equal(prepareDelegation({goal:'Ordinary design',kind:'design'},profile).imageGeneration,undefined);
 for(const extra of [{receiveAttachments:true,imagePrompt:'Draw'}, {imageDelivery:'automatic',imagePrompt:'Draw'},
  {imagePrompt:'Draw',imagePrompts:['Draw']},{imagePrompts:[]},{imagePrompts:Array(17).fill('Draw')},
  {imagePrompts:['Draw',' ']},{imagePrompts:['x'.repeat(8193)]},
  {imagePrompt:'Draw',directMaterials:[{path:'secret.txt',wholeFile:true,text:'not sent'}]}])
  assert.throws(()=>prepareDelegation({...request,...extra},profile));
 const changed={...single,imagePrompts:['A different image']};assert.notEqual(packetDigest(changed),single.packetId);
});

test('a single prompt returns immediately on acknowledgement with no generation or file success claim',async()=>{
 const f=fixture(),out=await api.delegateAndWait(f.packet,f.host,f.options);
 assert.equal(out.status,'sent');assert.equal(out.sentCount,1);assert.equal(out.manualDownload,true);assert.equal(out.generationVerified,false);
 assert.equal(out.wait.elapsedMs,0);assert.equal(out.metrics.resultLookups,0);assert.equal(out.metrics.automaticExportMessagesSent,0);
 assert.deepEqual(f.messages,[{threadId:thread,prompt:'Draw a swordsman'}]);assert.equal(f.probes(),1);
 assert.deepEqual(f.releases,[{terminal:true}]);assert.equal(out.downloads,undefined);
 const again=await api.delegateAndWait(f.packet,f.host,{...f.options,resume:out.state});assert.equal(again.status,'sent');assert.equal(f.messages.length,1);
});

test('a target system error blocks the image queue before sending',async()=>{
 const f=fixture();f.host.readThread=async()=>({thread:{id:thread,kind:'chatgpt',status:{type:'systemError'}},turns:[]});
 const out=await api.delegateAndWait(f.packet,f.host,f.options);
 assert.equal(out.status,'blocked');assert.equal(out.errorCode,'TARGET_CHAT_SYSTEM_ERROR');assert.equal(f.messages.length,0);assert.deepEqual(f.releases,[{terminal:true}]);
});

test('several prompts wait for each matched completed turn and return as soon as the final prompt is sent',async()=>{
 const f=fixture({prompts:['Draw bridge','Draw mountain','Draw river']}),out=await api.delegateAndWait(f.packet,f.host,f.options);
 assert.equal(out.status,'sent');assert.equal(out.sentCount,3);assert.equal(out.wait.elapsedMs,4000);
 assert.deepEqual(f.messages.map(m=>m.prompt),f.packet.imagePrompts);
 assert.equal(out.state.instructions[0].turnEnded,true);assert.equal(out.state.instructions[1].turnEnded,true);
 assert.equal(out.state.instructions[2].turnEnded,false);assert.equal(out.metrics.nativeMessagesSent,3);
 assert.equal(out.metrics.resultLookups,0);assert.deepEqual(f.releases,[{terminal:true}]);
});

test('an unfinished image turn keeps the same tool invocation pending with no extra message',async()=>{
 const f=fixture({prompts:['Draw one','Draw two'],lag:1000});let release,returned=false;
 const running=api.delegateAndWait(f.packet,f.host,{...f.options,sleep:ms=>new Promise(resolve=>{release=async()=>{await f.options.sleep(ms);resolve();};})})
  .then(out=>{returned=true;return out;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(returned,false);assert.equal(f.messages.length,1);
 await release();const out=await running;assert.equal(out.status,'sent');assert.equal(f.messages.length,2);
});

test('a stale completed turn with identical text inside the clock window cannot advance the next instruction',async()=>{
 const f=fixture({prompts:['Draw one','Draw one'],lag:0}),original=f.host.readThread;let reads=0;
 f.host.readThread=async()=>{
  if(++reads<=2)return {thread:{id:thread,kind:'chatgpt',status:'idle'},turns:[{id:'before-batch',status:'completed',startedAt:10,completedAt:10,
   items:[{type:'userMessage',content:[{type:'text',text:'Draw one'}]}]}]};
  return original();
 };
 const out=await api.delegateAndWait(f.packet,f.host,f.options);
 assert.equal(out.status,'sent');assert.equal(out.wait.elapsedMs,1000);assert.equal(out.state.instructions[0].priorTurnId,'before-batch');
 assert.equal(out.state.instructions[0].turnId,'turn-1');assert.equal(out.state.instructions[1].priorTurnId,'turn-1');
});

test('an active or unknown initial target and a wrong target stop before any image message',async()=>{
 const f=fixture({busy:true}),out=await api.delegateAndWait(f.packet,f.host,f.options);
 assert.equal(out.errorCode,'TARGET_CHAT_BUSY_OR_UNKNOWN');assert.equal(f.messages.length,0);assert.deepEqual(f.releases,[{terminal:true}]);
 const g=fixture();g.host.readThread=async()=>({thread:{id:thread,kind:'codex',status:'idle'}});
 assert.equal((await api.delegateAndWait(g.packet,g.host,g.options)).errorCode,'TARGET_IS_NOT_EXPECTED_CHAT');assert.equal(g.messages.length,0);
});

test('idle from another prompt, another time window, or a failed turn cannot advance the batch',async()=>{
 for(const mode of [{unmatched:true},{offset:-10},{offset:10},{turnError:true}]){
  const f=fixture({...mode,prompts:['Draw one','Draw two']}),out=await api.delegateAndWait(f.packet,f.host,f.options);
  assert.equal(out.status,'timeout');assert.equal(out.sentCount,1);assert.equal(f.messages.length,1);
  assert.deepEqual(f.releases,[{terminal:false}]);
 }
});

test('timeout resumes the original queue without resending acknowledged instructions',async()=>{
 const f=fixture({prompts:['Draw one','Draw two'],lag:4000});
 const first=await api.delegateAndWait(f.packet,f.host,{...f.options,timeoutMs:2000});assert.equal(first.status,'timeout');assert.equal(first.sentCount,1);
 const next=await api.delegateAndWait(f.packet,f.host,{...f.options,resume:first.state});
 assert.equal(next.status,'sent');assert.deepEqual(f.messages.map(m=>m.prompt),['Draw one','Draw two']);assert.deepEqual(f.releases,[{terminal:false},{terminal:true}]);
});

test('a lost send acknowledgement persists uncertainty and blocks further messages on resume',async()=>{
 const f=fixture({loseAck:true,prompts:['Draw one','Draw two']}),out=await api.delegateAndWait(f.packet,f.host,f.options);
 assert.equal(out.status,'delivery_uncertain');assert.equal(out.state.instructions[0].delivery,'uncertain');
 const next=await api.delegateAndWait(f.packet,f.host,{...f.options,resume:out.state});
 assert.equal(next.status,'delivery_uncertain');assert.equal(f.messages.length,1);assert.deepEqual(f.releases,[{terminal:false},{terminal:false}]);
});

test('cancelling between prompts leaves the rest unsent',async()=>{
 const f=fixture({prompts:['Draw one','Draw two']});
 const out=await api.delegateAndWait(f.packet,f.host,{...f.options,isCancelled:()=>f.messages.length===1});
 assert.equal(out.status,'cancelled');assert.equal(out.sentCount,1);assert.equal(f.messages.length,1);assert.deepEqual(f.releases,[{terminal:false}]);
});

test('changed packet, corrupted delivery state, or missing authorization cannot send',async()=>{
 const f=fixture(),out=await api.delegateAndWait(f.packet,f.host,f.options);
 for(const resume of [{...out.state,packetId:'0'.repeat(64)},{...out.state,delivery:'not_sent'},
  {...out.state,instructions:[{...out.state.instructions[0],sentAt:null}]}])
  await assert.rejects(api.delegateAndWait(f.packet,f.host,{...f.options,resume}));
 const g=fixture();await assert.rejects(api.delegateAndWait(g.packet,g.host,{...g.options,deliveryAuthorized:false}),/MESSAGE_AUTHORIZATION_REQUIRED/);assert.equal(g.probes(),0);
});

test('identity and execution guards still precede sending; owner mismatch cannot send',async()=>{
 const f=fixture();f.packet.source={codexThreadId:thread,authorizedRoot:'fixture-root'};
 f.packet.connection={schemaVersion:2,source:'openai-sites:get_site',siteRole:'owner',accountId:'fixture',principalId:'fixture',toolPrefix:'mcp__fixture_'};
 f.packet.packetId=packetDigest(f.packet);f.host.connection=f.packet.connection;f.host.verifyAccount=async()=>{throw Object.assign(new Error('wrong owner'),{code:'CURRENT_ACCOUNT_OR_SERVICE_MISMATCH'});};
 await assert.rejects(api.delegateAndWait(f.packet,f.host,{...f.options,execution:null}),/EXECUTION_GUARD_REQUIRED/);
 const out=await api.delegateAndWait(f.packet,f.host,f.options);assert.equal(out.errorCode,'CURRENT_ACCOUNT_OR_SERVICE_MISMATCH');assert.equal(f.messages.length,0);
});

test('send-only host binding requires native messages but no MCP result or attachment tools',()=>{
 const names=['mcp__codex_app__read_thread','mcp__codex_app__send_message_to_thread'];
 const host=api.bindHost(Object.fromEntries(names.map(n=>[n,async()=>({isError:false})])),names.map(name=>({name})),null,{imageSendOnly:true});
 assert.equal(typeof host.sendMessage,'function');assert.equal(host.publishAssignment,undefined);assert.equal(host.getTaskResult,undefined);
});
