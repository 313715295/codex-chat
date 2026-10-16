import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const entry=new Function('return ('+await readFile(new URL('./job-entry.js',import.meta.url),'utf8')+')')();
function fixture({resume=false,oversized=false,imageGeneration=false,imageSendOnly=false}={}){
 const commands=[],bridges=[],patches=[];
 const packet={...(imageSendOnly?{}:{attachments:{}}),connection:{toolPrefix:'test_'},...(imageGeneration?{imageGeneration:true}:{}),...(imageSendOnly?{imageGeneration:true,imageDelivery:'manual'}:{})};
 const job={packet,statePath:'C:/test/state.json',resume:resume?{delivery:'sent'}:null};
 const core='({bindHost:(t,i,c,o)=>o,bindExecution:()=>({}),delegateAndWait:async(packet,host,options)=>{await options.checkpoint({delivery:"sent"});if(packet.imageDelivery==="manual")return {status:"sent",imageSendOnly:host.imageSendOnly,hasAttachmentIO:!!options.attachments};await options.attachments.io.appendChunk({},'+JSON.stringify({dataBase64:'a'.repeat(oversized?65000:55000)})+');return {status:"completed",didRequestModel:false,waitStrategy:options.waitStrategy,completionFallback:options.completionFallback,pollIntervalMs:options.pollIntervalMs};}})';
 const tools={exec_command:async args=>{commands.push(args.cmd);return {exit_code:0,output:args.cmd.startsWith('Get-Content')?(args.cmd.includes('attachment-host-runtime.js')?'({bind:()=>({})})':core):JSON.stringify(args.cmd.includes("'prepare'")?{packetPath:'C:/test/packet.json'}:job)};},apply_patch:async p=>{patches.push(p);return {};},mcp__node_repl__js:async args=>{bridges.push(args.code);return {content:[{type:'text',text:args.code.includes('appendChunk')?'{}':'{"ready":true}'}]};}};
 const options={scriptRoot:"C:/tool's/scripts",outputRoot:'C:/test/out',deliveryAuthorized:true,...(resume?{packetPath:'C:/test/packet.json'}:{requestPath:'C:/test/request.json'})};
 for(const name of ['mcp__codex_app__read_thread','mcp__codex_app__send_message_to_thread','mcp__codex_apps__sites_get_site'])tools[name]=async()=>{};
 return {tools,options,commands,bridges,patches};
}
test('one program loads dependencies internally, initializes file IO and records only its outcome',async()=>{
 const f=fixture(),result=await entry.run(f.tools,[],f.options);
 assert.equal(result.outcome.status,'completed');assert.equal(result.metrics.waitProgramModelAPICalls,0);
 assert.equal(f.commands.filter(c=>c.includes("'prepare'")).length,1);assert.ok(f.commands.every(c=>c.includes("tool''s")));
 assert.equal(f.bridges.length,2);assert.ok(f.bridges.every(c=>entry.utf8Bytes(c)<=64000));assert.equal(f.patches.length,2);
});
test('resume uses the existing packet and never prepares a second task',async()=>{
 const f=fixture({resume:true});await entry.run(f.tools,[],f.options);assert.equal(f.commands.filter(c=>c.includes("'prepare'")).length,0);
});

test('ordinary jobs retain result polling; new images bypass attachment IO and historical auto-return is refused',async()=>{
 const f=fixture(),normal=await entry.run(f.tools,[],f.options);
 assert.equal(normal.outcome.waitStrategy,'result');assert.equal(normal.outcome.completionFallback,true);assert.equal(normal.outcome.pollIntervalMs,30000);
 const g=fixture({imageSendOnly:true}),image=await entry.run(g.tools,[],g.options);
 assert.equal(image.outcome.status,'sent');assert.equal(image.outcome.imageSendOnly,true);assert.equal(image.outcome.hasAttachmentIO,false);assert.equal(g.bridges.length,0);
 const legacy=fixture({imageGeneration:true});await assert.rejects(entry.run(legacy.tools,[],legacy.options),/LEGACY_IMAGE_RETURN_DISABLED/);assert.equal(legacy.bridges.length,0);
});
test('an oversized local file bridge is refused before invoking the tool',async()=>{
 const f=fixture({oversized:true});await assert.rejects(entry.run(f.tools,[],f.options),/LOCAL_FILE_BRIDGE_CODE_LIMIT/);assert.equal(f.bridges.length,1);
 assert.equal(entry.utf8Bytes('中文🙂'),10);
});

test('without the authenticated desktop bridge entry fails before local preparation or network side effects',async()=>{
 const f=fixture();delete f.tools.mcp__codex_app__send_message_to_thread;
 await assert.rejects(entry.run(f.tools,[],f.options),/HOST_BRIDGE_REQUIRED/);
 await assert.rejects(entry.runMany(f.tools,[],{...f.options,jobs:[f.options]}),/HOST_BRIDGE_REQUIRED/);
 assert.equal(f.commands.length,0);assert.equal(f.patches.length,0);assert.equal(f.bridges.length,0);
 assert.equal(entry.describe().standaloneMcp,false);assert.ok(entry.describe().methods.runMany);
});

function batchFixture({sameChat=false,otherAccount=false,failJob=false,withAttachments=false,withMessages=false}={}){
 const calls=[],started=[],finished=[],pending=[];let bridgeActive=0,bridgeConcurrent=0,messageActive=0,messageConcurrent=0;
 const packets=[0,1].map(i=>({packetId:'packet'+i,target:{threadId:'chat'+(sameChat?0:i)},assignment:{taskId:'task'+i,revision:'r1'},source:{codexThreadId:'codex1',routeTarget:true},connection:{accountId:'account'+(otherAccount?i:0)},...(withAttachments?{attachments:{}}:{})}));
 const core='({bindHost:t=>({send:a=>t.mcp__codex_app__send_message_to_thread(a)}),bindExecution:()=>({}),delegateAndWait:async(p,h,o)=>globalThis.batchTestHook(p,o,h)})';
 const tools={exec_command:async args=>{
   calls.push(args.cmd);if(args.cmd.startsWith('Get-Content'))return {exit_code:0,output:args.cmd.includes('attachment-host-runtime.js')?'({bind:()=>({})})':core};
   const i=args.cmd.includes('packet1')?1:0;return {exit_code:0,output:JSON.stringify({packet:packets[i],resume:null,statePath:'C:/states/'+i+'.json'})};
 },apply_patch:async()=>({})};
 tools.mcp__node_repl__js=async()=>{bridgeActive++;bridgeConcurrent=Math.max(bridgeConcurrent,bridgeActive);await new Promise(r=>setTimeout(r,2));bridgeActive--;return {content:[{type:'text',text:'{}'}]};};
 for(const name of ['mcp__codex_app__read_thread','mcp__codex_app__send_message_to_thread','mcp__codex_apps__sites_get_site'])tools[name]=async()=>{};
 tools.mcp__codex_app__send_message_to_thread=async()=>{messageActive++;messageConcurrent=Math.max(messageConcurrent,messageActive);await new Promise(r=>setTimeout(r,2));messageActive--;return {isError:false};};
 const options={scriptRoot:'C:/scripts',deliveryAuthorized:true,jobs:[0,1].map(i=>({packetPath:'C:/packet'+i+'.json',outputRoot:'C:/output'+i}))};
 globalThis.batchTestHook=async(p,o,h)=>{
   started.push(p.assignment.taskId);
   if(withMessages)await h.send({threadId:p.target.threadId,prompt:p.assignment.taskId});
   if(withAttachments)await o.attachments.io.appendChunk({},{dataBase64:'YQ=='});
   await new Promise(resolve=>{pending.push(resolve);if(pending.length===2)pending.splice(0).forEach(r=>r());});
   finished.push(p.assignment.taskId);if(failJob&&p.assignment.taskId==='task1')throw new Error('SYNTHETIC_CHANNEL_FAILURE');
   return {status:'completed',result:{summary:p.assignment.taskId}};
 };
 return {tools,options,calls,started,finished,get bridgeConcurrent(){return bridgeConcurrent;},get messageConcurrent(){return messageConcurrent;}};
}
test('two Chat jobs really overlap and a failed peer does not discard the completed outcome',async()=>{
 const f=batchFixture({failJob:true});
 try{
   const result=await entry.runMany(f.tools,[],f.options);
   assert.deepEqual(f.started,['task0','task1']);assert.equal(f.finished.length,2);
   assert.equal(result.status,'partial');assert.equal(result.jobs[0].outcome.result.summary,'task0');
   assert.equal(result.jobs[1].errorCode,'SYNTHETIC_CHANNEL_FAILURE');assert.equal(result.jobs[1].packetPath,'C:/packet1.json');
   assert.equal(result.jobs[0].metrics.waitProgramModelAPICalls,0);assert.equal(result.metrics.waitProgramModelAPICalls,0);
 }finally{delete globalThis.batchTestHook;}
});
test('concurrent Chat file jobs share one serialized local bridge and keep distinct outcome paths',async()=>{
 const f=batchFixture({withAttachments:true});
 try{const r=await entry.runMany(f.tools,[],f.options);assert.equal(r.status,'completed');assert.equal(f.bridgeConcurrent,1);
   assert.notEqual(r.jobs[0].recordPath,r.jobs[1].recordPath);assert.equal(r.metrics.toolCalls.mcp__node_repl__js,4);
 }finally{delete globalThis.batchTestHook;}
});
test('desktop sends are serialized while the two jobs still wait concurrently',async()=>{
 const f=batchFixture({withMessages:true});
 try{const r=await entry.runMany(f.tools,[],f.options);assert.equal(r.status,'completed');assert.equal(f.messageConcurrent,1);
   assert.equal(f.started.length,2);assert.equal(f.finished.length,2);assert.equal(r.metrics.toolCalls.mcp__codex_app__send_message_to_thread,2);
 }finally{delete globalThis.batchTestHook;}
});
test('batch validates every scope, Chat and output directory before dispatch',async()=>{
 for(const config of [{sameChat:true},{otherAccount:true},{}]){
   const f=batchFixture(config);if(!Object.keys(config).length)f.options.jobs[1].outputRoot='C:/output0/nested';
   try{await assert.rejects(entry.runMany(f.tools,[],f.options),/BATCH_/);assert.equal(f.started.length,0);}
   finally{delete globalThis.batchTestHook;}
 }
});
