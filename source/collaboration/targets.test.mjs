import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {registerAccount,readBinding,readTarget,listTargets,removeTarget,acquireExecution,finishExecution,pauseExecution,resumeExecution,switchAccount,unbind} from './bindings.mjs';
import {bindConversation,prepareDelegation,loadForThread,packetDigest} from './prepare.mjs';
const source='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const chats=['00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000102'];
const connection={schemaVersion:2,source:'openai-sites:get_site',projectId:'synthetic-targets',siteRole:'owner',registeredMcpId:'plugin_asdk_app_synthetic',mcpUrl:'https://targets.example/mcp',oauthResource:'https://targets.example/mcp',accountId:'account-a',principalId:'synthetic-principal',toolPrefix:'mcp__synthetic_'};
async function fixture(fn){
 const temporaryRoot=await realpath(tmpdir()),base=await mkdtemp(join(temporaryRoot,'codex-chat-targets-')),root=join(base,'materials'),state=join(base,'state');await mkdir(root);
 try{
   await registerAccount(state,connection);const options={base:state,codexThreadId:source,accountId:connection.accountId};
   await bindConversation('https://chatgpt.com/c/'+chats[0],root,options);
   for(const chat of chats)await bindConversation('https://chatgpt.com/c/'+chat,root,{...options,asTarget:true,title:chat});
   const profiles=await Promise.all(chats.map(chat=>readTarget(state,chat,source)));
   const packets=profiles.map(p=>prepareDelegation({taskId:'same-request-name',goal:'synthetic review',targetThreadId:p.targetThreadId,directMaterials:[{path:'note.txt',wholeFile:true,text:'alpha\n'}]},p));
   return await fn({base,root,state,options,profiles,packets});
 }finally{await rm(base,{recursive:true,force:true});}
}
test('same Codex and account can run two Chat jobs with one shared material root and distinct task namespaces',()=>fixture(async({state,packets,profiles})=>{
 assert.notEqual(packets[0].assignment.taskId,packets[1].assignment.taskId);assert.equal(profiles[0].authorizedRoot,profiles[1].authorizedRoot);
 const leases=await Promise.all(packets.map(p=>acquireExecution(state,source,p)));
 assert.equal((await listTargets(state,source)).pending.length,2);assert.equal((await readBinding(state,source)).targetThreadId,chats[0]);
 await finishExecution(state,leases[0],{terminal:true});assert.equal((await listTargets(state,source)).pending[0].packetId,packets[1].packetId);
 await assert.rejects(finishExecution(state,{...leases[1],waiterId:leases[0].waiterId},{terminal:true}),/EXECUTION_LEASE_MISMATCH/);
 await finishExecution(state,leases[1],{terminal:true});assert.equal((await listTargets(state,source)).pending.length,0);
}));
test('one pending Chat blocks competing packets and configuration changes, but another Chat remains usable',()=>fixture(async({state,options,root,packets,profiles})=>{
 const lease=await acquireExecution(state,source,packets[0]);
 await assert.rejects(acquireExecution(state,source,packets[0]),/TASK_ALREADY_RUNNING/);
 const next=prepareDelegation({goal:'another task'},profiles[0]);
 await assert.rejects(acquireExecution(state,source,next),/CHAT_HAS_PENDING_TASK/);
 await assert.rejects(unbind(state,source),/BINDING_HAS_PENDING_TASK/);
 await assert.rejects(switchAccount(state,connection.accountId,source),/BINDING_HAS_PENDING_TASK/);
 await assert.rejects(registerAccount(state,{...connection,principalId:'changed'}),/ACCOUNT_HAS_PENDING_TASK/);
 await assert.rejects(removeTarget(state,chats[0],source),/TARGET_HAS_PENDING_TASK/);
 await assert.rejects(bindConversation('https://chatgpt.com/c/'+chats[1],root,options),/BINDING_HAS_PENDING_TASK/);
 const second=await acquireExecution(state,source,packets[1]);await finishExecution(state,second,{terminal:true});
 await finishExecution(state,lease,{terminal:false});
 await assert.rejects(acquireExecution(state,source,next),/CHAT_HAS_PENDING_TASK/);
 const resumed=await acquireExecution(state,source,packets[0]);await finishExecution(state,resumed,{terminal:true});
}));
test('routed pause/resume does not replace another job or the default Chat and preserves exact material scope',()=>fixture(async({base,root,state,options,packets})=>{
 const leases=await Promise.all(packets.map(p=>acquireExecution(state,source,p)));
 await finishExecution(state,leases[1],{terminal:false});await pauseExecution(state,source,packets[1]);
 const otherRoot=join(base,'other');await mkdir(otherRoot);
 await assert.rejects(bindConversation('https://chatgpt.com/c/'+chats[1],otherRoot,{...options,asTarget:true,title:chats[1]}),/TARGET_HAS_PAUSED_TASK/);
 await assert.rejects(removeTarget(state,chats[1],source),/TARGET_HAS_PAUSED_TASK/);
 await resumeExecution(state,source,packets[1]);
 assert.equal((await listTargets(state,source)).pending.length,2);assert.equal((await readBinding(state,source)).targetThreadId,chats[0]);
 const file=join(base,'packet.json');await writeFile(file,JSON.stringify(packets[1]));
 assert.deepEqual((await loadForThread(file,{base:state,codexThreadId:source})).packet,packets[1]);
 const tampered={...packets[1],target:{...packets[1].target,threadId:chats[0]},source:{...packets[1].source,authorizedRoot:root+'-other'}};tampered.packetId=packetDigest(tampered);await writeFile(file,JSON.stringify(tampered));
 await assert.rejects(loadForThread(file,{base:state,codexThreadId:source}),/PACKET_THREAD_BINDING_MISMATCH/);
 const resumed=await acquireExecution(state,source,packets[1]);await finishExecution(state,resumed,{terminal:true});await finishExecution(state,leases[0],{terminal:true});
}));
test('registered Chat ownership remains exclusive across Codex threads, including nondefault targets',()=>fixture(async({root,state,options})=>{
 await assert.rejects(bindConversation('https://chatgpt.com/c/'+chats[1],root,{...options,codexThreadId:other}),/CHAT_ALREADY_BOUND/);
 await removeTarget(state,chats[1],source);await bindConversation('https://chatgpt.com/c/'+chats[1],root,{...options,codexThreadId:other});
}));
test('schema 2 migration preserves saved accounts and a paused task exactly while registering targets',()=>fixture(async({state})=>{
 const file=join(state,'bindings.json'),saved=JSON.parse(await readFile(file,'utf8'));
 delete saved.targets;delete saved.routedTasks;saved.schemaVersion=2;
 const profile={...saved.bindings[source],targetThreadId:'00000000-0000-4000-8000-000000000199'};
 const paused={task:{packetId:'f'.repeat(64),taskId:'legacy-task',revision:'r1',waiterId:null},profile,connection,pausedAt:'2026-10-15T00:00:00.000Z'};
 saved.pausedTasks={[source]:{[paused.task.packetId]:paused}};await writeFile(file,JSON.stringify(saved));
 const before=await readFile(file,'utf8');await readBinding(state,source);assert.equal(await readFile(file,'utf8'),before);
 await bindConversation('https://chatgpt.com/c/'+chats[1],profile.authorizedRoot,{base:state,codexThreadId:source,accountId:connection.accountId,asTarget:true});
 const after=JSON.parse(await readFile(file,'utf8'));assert.equal(after.schemaVersion,3);
 assert.deepEqual(after.pausedTasks,saved.pausedTasks);assert.deepEqual(after.savedBindings,saved.savedBindings);assert.deepEqual(after.accounts,saved.accounts);assert.deepEqual(after.bindings,saved.bindings);
}));
