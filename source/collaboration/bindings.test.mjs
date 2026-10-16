import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {bindConversation,prepareDelegation,loadForThread} from './prepare.mjs';
import {readBinding,acquireExecution,finishExecution,unbind} from './bindings.mjs';

const run=promisify(execFile),here=dirname(fileURLToPath(import.meta.url));
const api=new Function('return (\n'+await readFile(join(here,'host-runtime.js'),'utf8')+'\n)')();
const sourceA='00000000-0000-4000-8000-000000000001',sourceB='00000000-0000-4000-8000-000000000002';
const chatA='00000000-0000-4000-8000-000000000101',chatB='00000000-0000-4000-8000-000000000102';
async function fixture(fn){
  const base=await mkdtemp(join(tmpdir(),'codex-chat-bindings-')),root=join(base,'materials'),state=join(base,'state');await mkdir(root);
  try{return await fn({base,root,state});}
  finally{assert.ok(resolve(base).startsWith(resolve(tmpdir())+'\\')||resolve(base).startsWith(resolve(tmpdir())+'/'));await rm(base,{recursive:true,force:true});}
}
const bind=(state,root,id,chat)=>bindConversation('https://chatgpt.com/c/'+chat,root,{base:state,codexThreadId:id});
const packet=p=>prepareDelegation({taskId:'same-request-name',goal:'Synthetic binding test',directMaterials:[{path:'note.txt',wholeFile:true,text:'alpha\n'}]},p);

test('two concurrent Codex bindings may share one real materials directory without overwriting each other',()=>fixture(async({root,state})=>{
  const [a,b]=await Promise.all([bind(state,root,sourceA,chatA),bind(state,root,sourceB,chatB)]);
  assert.equal(a.authorizedRoot,await realpath(root));assert.equal(b.authorizedRoot,a.authorizedRoot);
  assert.equal((await readBinding(state,sourceA)).targetThreadId,chatA);assert.equal((await readBinding(state,sourceB)).targetThreadId,chatB);
  const pa=packet(a),pb=packet(b);assert.notEqual(pa.assignment.taskId,pb.assignment.taskId);assert.notEqual(pa.packetId,pb.packetId);
  const next=prepareDelegation({taskId:pa.assignment.taskId,revision:'r2',goal:pa.assignment.goal,directMaterials:pa.directMaterials},a);
  assert.equal(next.assignment.taskId,pa.assignment.taskId);assert.equal(next.assignment.revision,'r2');
}));
test('competing claims of one Chat allow exactly one binding, not silent reassignment',()=>fixture(async({root,state})=>{
  const attempts=await Promise.allSettled([bind(state,root,sourceA,chatA),bind(state,root,sourceB,chatA)]);
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(attempts.find(r=>r.status==='rejected').reason.code,'CHAT_ALREADY_BOUND');
  const store=JSON.parse(await readFile(join(state,'bindings.json'),'utf8'));assert.equal(Object.keys(store.bindings).length,1);
}));
test('a legacy global profile is preserved and never implicitly adopted by another Codex',()=>fixture(async({root,state})=>{
  await mkdir(state);const legacy=JSON.stringify({schemaVersion:1,targetThreadId:chatA,authorizedRoot:root});
  await writeFile(join(state,'collaboration.json'),legacy);
  await assert.rejects(readBinding(state,sourceB),/COLLABORATION_NOT_BOUND_FOR_THREAD/);
  await bind(state,root,sourceA,chatA);assert.equal(await readFile(join(state,'collaboration.json'),'utf8'),legacy);
}));
test('packets cannot load in a different Codex thread even when the material root is identical',()=>fixture(async({base,root,state})=>{
  const a=await bind(state,root,sourceA,chatA);await bind(state,root,sourceB,chatB);
  const path=join(base,'packet.json');await writeFile(path,JSON.stringify(packet(a)));
  assert.equal((await loadForThread(path,{base:state,codexThreadId:sourceA})).sourceThreadId,sourceA);
  await assert.rejects(loadForThread(path,{base:state,codexThreadId:sourceB}),/PACKET_THREAD_BINDING_MISMATCH/);
}));
test('distinct Chat tasks can run concurrently, while duplicate waiters and another task in the same Chat are blocked',()=>fixture(async({root,state})=>{
  const a=await bind(state,root,sourceA,chatA),b=await bind(state,root,sourceB,chatB),pa=packet(a),pb=packet(b);
  const [la,lb]=await Promise.all([acquireExecution(state,sourceA,pa),acquireExecution(state,sourceB,pb)]);
  await assert.rejects(acquireExecution(state,sourceA,pa),/TASK_ALREADY_RUNNING/);
  const newer=prepareDelegation({goal:'Another synthetic task'},a);await assert.rejects(acquireExecution(state,sourceA,newer),/THREAD_HAS_PENDING_TASK/);
  await finishExecution(state,la,{terminal:false});await assert.rejects(acquireExecution(state,sourceA,newer),/THREAD_HAS_PENDING_TASK/);
  const resumed=await acquireExecution(state,sourceA,pa);assert.notEqual(resumed.waiterId,la.waiterId);
  await finishExecution(state,resumed,{terminal:true});await finishExecution(state,lb,{terminal:true});
  const next=await acquireExecution(state,sourceA,newer);await finishExecution(state,next,{terminal:true});
}));
test('pending tasks prevent directory changes and unbinding; a finished task permits explicit reassignment',()=>fixture(async({base,root,state})=>{
  const a=await bind(state,root,sourceA,chatA),pa=packet(a),lease=await acquireExecution(state,sourceA,pa);
  const root2=join(base,'other-materials');await mkdir(root2);
  await assert.rejects(bind(state,root2,sourceA,chatA),/BINDING_HAS_PENDING_TASK/);
  await assert.rejects(unbind(state,sourceA),/BINDING_HAS_PENDING_TASK/);
  await finishExecution(state,lease,{terminal:true});await unbind(state,sourceA);
  assert.equal((await bind(state,root,sourceB,chatA)).targetThreadId,chatA);
}));
test('another packet or waiter cannot release an execution guard',()=>fixture(async({root,state})=>{
  const a=await bind(state,root,sourceA,chatA),pa=packet(a),lease=await acquireExecution(state,sourceA,pa);
  await assert.rejects(finishExecution(state,{...lease,waiterId:sourceB},{terminal:true}),/EXECUTION_LEASE_MISMATCH/);
  await assert.rejects(finishExecution(state,{...lease,packetId:'0'.repeat(64)},{terminal:true}),/EXECUTION_LEASE_MISMATCH/);
  await finishExecution(state,lease,{terminal:true});
}));
test('the real CLI uses caller context for binding, preparation, cross-thread denial and execution resume',()=>fixture(async({base,root})=>{
  const env=id=>({...process.env,LOCALAPPDATA:base,CODEX_THREAD_ID:id});
  const cli=async(id,...args)=>JSON.parse((await run(process.execPath,[join(here,'prepare.mjs'),...args],{env:env(id)})).stdout);
  await Promise.all([cli(sourceA,'bind','https://chatgpt.com/c/'+chatA,root),cli(sourceB,'bind','https://chatgpt.com/c/'+chatB,root)]);
  const connection=join(base,'account.json');await writeFile(connection,JSON.stringify({schemaVersion:2,source:'openai-sites:get_site',projectId:'fixture',siteRole:'owner',registeredMcpId:'plugin_asdk_app_fixture',mcpUrl:'https://fixture.example/mcp',oauthResource:'https://fixture.example/mcp',accountId:'fixture-account',principalId:'fixture-principal',toolPrefix:'mcp__fixture_'}));
  await cli(sourceA,'account-register',connection);
  await cli(sourceA,'account-bind','fixture-account','https://chatgpt.com/c/'+chatA,root);
  await cli(sourceB,'account-bind','fixture-account','https://chatgpt.com/c/'+chatB,root);
  const request=join(base,'request.json');await writeFile(request,JSON.stringify({goal:'CLI fixture',directMaterials:[{path:'note.txt',wholeFile:true,text:'alpha\n'}]}));
  const prepared=await cli(sourceA,'prepare',request);assert.ok(prepared.packetPath.includes(sourceA));
  await assert.rejects(cli(sourceB,'load',prepared.packetPath),e=>e.stderr.includes('PACKET_THREAD_BINDING_MISMATCH'));
  const first=await cli(sourceA,'claim',prepared.packetPath);await assert.rejects(cli(sourceA,'claim',prepared.packetPath),e=>e.stderr.includes('TASK_ALREADY_RUNNING'));
  assert.equal((await cli(sourceA,'finish',prepared.packetPath,first.waiterId,'pending')).status,'pending');
  const packetBytes=await readFile(prepared.packetPath);const statePath=prepared.packetPath+'.state.json';await writeFile(statePath,JSON.stringify({delivery:'sent',assignmentReceipt:'preserve-this-receipt'}));
  const stateBytes=await readFile(statePath);
  assert.equal((await cli(sourceA,'pause',prepared.packetPath)).status,'paused');
  assert.equal((await cli(sourceA,'accounts')).pausedTasks.length,1);
  await assert.rejects(cli(sourceB,'resume',prepared.packetPath),e=>e.stderr.includes('PAUSED_TASK_NOT_FOUND'));
  assert.equal((await cli(sourceA,'resume',prepared.packetPath)).status,'pending');
  assert.deepEqual(await readFile(prepared.packetPath),packetBytes);assert.deepEqual(await readFile(statePath),stateBytes);
  const resumed=await cli(sourceA,'claim',prepared.packetPath);assert.equal((await cli(sourceA,'finish',prepared.packetPath,resumed.waiterId,'terminal')).status,'finished');
}));
test('the host requires a guard, keeps timed-out Chat work pending, and resumes without a second message',()=>fixture(async({root,state})=>{
  const a=await bind(state,root,sourceA,chatA),pa=packet(a),receipt='00000000-0000-4000-8000-000000000201';let time=0,sends=0,complete=false;
  const host={readThread:async()=>({thread:{id:chatA,kind:'chatgpt'}}),
    publishAssignment:async()=>({status:'stored',taskId:pa.assignment.taskId,materialMode:'external',assignmentReceipt:receipt}),
    sendMessage:async()=>{sends++;return {isError:false};},
    getTaskResult:async()=>complete?{status:'found',taskId:pa.assignment.taskId,revision:'r1',receipt:'00000000-0000-4000-8000-000000000202',
      result:{taskId:pa.assignment.taskId,revision:'r1',assignmentReceipt:receipt,status:'completed',summary:'fixture',findings:[],materialsRead:[],limitations:[],requests:[]}}:
      {status:'not_found',taskId:pa.assignment.taskId,revision:'r1'}};
  const options={deliveryAuthorized:true,now:()=>time,sleep:async ms=>{time+=ms;},timeoutMs:1000,pollIntervalMs:1000,
    execution:{acquire:p=>acquireExecution(state,sourceA,p),release:(lease,out)=>finishExecution(state,lease,out)}};
  await assert.rejects(api.delegateAndWait(pa,host,{...options,execution:undefined}),/EXECUTION_GUARD_REQUIRED/);assert.equal(sends,0);
  const first=await api.delegateAndWait(pa,host,options);assert.equal(first.status,'timeout');assert.equal(sends,1);
  await assert.rejects(acquireExecution(state,sourceA,prepareDelegation({goal:'Next task'},a)),/THREAD_HAS_PENDING_TASK/);
  complete=true;const resumed=await api.delegateAndWait(pa,host,{...options,resume:first.state});
  assert.equal(resumed.status,'completed');assert.equal(sends,1);assert.equal(resumed.didRequestModel,false);
  const next=await acquireExecution(state,sourceA,prepareDelegation({goal:'Next task'},a));await finishExecution(state,next,{terminal:true});
}));
test('a refused execution claim calls no message or result tools',()=>fixture(async({root,state})=>{
  const a=await bind(state,root,sourceA,chatA),pa=packet(a),lease=await acquireExecution(state,sourceA,pa);let calls=0;
  const host=Object.fromEntries(['readThread','sendMessage','publishAssignment','getTaskResult'].map(name=>[name,async()=>{calls++;}]));
  const result=await api.delegateAndWait(pa,host,{deliveryAuthorized:true,execution:{acquire:p=>acquireExecution(state,sourceA,p),release:(l,out)=>finishExecution(state,l,out)}});
  assert.equal(result.errorCode,'TASK_ALREADY_RUNNING');assert.equal(calls,0);await finishExecution(state,lease,{terminal:true});
}));
