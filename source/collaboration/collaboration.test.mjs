import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {prepareDelegation,packetDigest,chatId,bindConversation} from './prepare.mjs';
import {installEntry} from './install.mjs';
import {buildPlugin} from './build-plugin.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const api=new Function('return (\n'+await readFile(join(here,'host-runtime.js'),'utf8')+'\n)')();
const threadId='6ac8a56d-6a94-83ee-a96b-e6c467cfe8f9';
const receipt='3a680583-40a2-474e-a3f0-fd8bef3c7306';
const resultReceipt='dc0f9aba-9302-46be-9e69-ca4dbf5fafdf';
const profile={schemaVersion:1,targetThreadId:threadId,targetTitle:'Synthetic Chat',authorizedRoot:'fixture-root',workspaceId:'fixture-workspace'};
const packet=()=>prepareDelegation({taskId:'fixture-task',revision:'r1',goal:'Review the supplied synthetic calculation',directMaterials:[{path:'src/price.js',wholeFile:true,text:'export const price = 100;\r\n'}]},profile);
const wrapped=value=>({content:[{type:'text',text:'Action completed.'}],structuredContent:{content:[{type:'text',text:JSON.stringify(value)}],isError:false},isError:false});
function found(p,change={}){return {status:'found',taskId:p.assignment.taskId,revision:p.assignment.revision,receipt:resultReceipt,result:{taskId:p.assignment.taskId,revision:p.assignment.revision,assignmentReceipt:receipt,status:'completed',summary:'Synthetic fixture only',findings:[],materialsRead:p.assignment.files.map(f=>({path:f.path,sha256:f.sha256,source:'direct',totalLines:f.totalLines})),limitations:['No real Chat or network used'],requests:[],...change}};}
function fixture(p,{responses=[],readKind='chatgpt',sendError=false,publishStatus='stored'}={}){
  const calls=[],states=[];let time=0;
  const host={
    readThread:async args=>{calls.push({role:'read',args});return wrapped({thread:{id:p.target.threadId,kind:readKind,title:'Synthetic Chat'}});},
    publishAssignment:async args=>{calls.push({role:'publish',args});return wrapped({status:publishStatus,taskId:p.assignment.taskId,materialMode:'external',assignmentReceipt:receipt});},
    sendMessage:async args=>{calls.push({role:'send',args});if(sendError)throw new Error('fixture send acknowledgement lost');return {content:[{type:'text',text:'Sent'}],isError:false};},
    getTaskResult:async args=>{calls.push({role:'get',args});const value=responses.shift()??{status:'not_found',...args};return typeof value==='function'?value():wrapped(value);}
  };
  const options={deliveryAuthorized:true,now:()=>time,sleep:async ms=>{time+=ms;},checkpoint:async s=>states.push({...s})};
  return {host,options,calls,states};
}

test('one entry publishes external metadata, sends known text once, waits through empty results, and verifies binding',async()=>{
  const p=packet(),f=fixture(p,{responses:[{status:'not_found',taskId:'fixture-task',revision:'r1'},{status:'not_found',taskId:'fixture-task',revision:'r1'},found(p)]});
  const out=await api.delegateAndWait(p,f.host,f.options);
  assert.equal(out.status,'completed');assert.equal(out.resultReceipt,resultReceipt);assert.equal(out.wait.lookups,3);assert.equal(out.wait.elapsedMs,10000);
  assert.equal(f.calls.filter(c=>c.role==='send').length,1);assert.deepEqual(f.states.map(s=>s.delivery),['not_sent','sending','sent']);
  assert.ok(f.calls.find(c=>c.role==='send').args.prompt.includes(p.directMaterials[0].text.replaceAll('\r','\\r').replaceAll('\n','\\n')));
  const stored=JSON.stringify(f.calls.find(c=>c.role==='publish').args);assert.equal(stored.includes('export const'),false);assert.equal(p.assignment.materialMode,'external');
});
test('without human delegation authorization no native tool is called',async()=>{
  const p=packet(),f=fixture(p);await assert.rejects(api.delegateAndWait(p,f.host,{...f.options,deliveryAuthorized:false}),/MESSAGE_AUTHORIZATION_REQUIRED/);assert.equal(f.calls.length,0);
});
test('empty lookups keep the original invocation pending instead of returning to the model',async()=>{
  const p=packet(),f=fixture(p,{responses:[{status:'not_found',taskId:'fixture-task',revision:'r1'},{status:'not_found',taskId:'fixture-task',revision:'r1'},found(p)]});
  let finishSleep,returned=false;
  const running=api.delegateAndWait(p,f.host,{...f.options,sleep:()=>new Promise(resolve=>{finishSleep=resolve;})}).then(v=>{returned=true;return v;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(returned,false);assert.equal(f.calls.filter(c=>c.role==='get').length,2);
  finishSleep();const out=await running;assert.equal(out.status,'completed');assert.equal(f.calls.filter(c=>c.role==='send').length,1);
});
test('a Codex target or changed target ID stops before publication and sending',async()=>{
  const p=packet(),f=fixture(p,{readKind:'codex'});const out=await api.delegateAndWait(p,f.host,f.options);
  assert.equal(out.errorCode,'TARGET_IS_NOT_EXPECTED_CHAT');assert.deepEqual(f.calls.map(c=>c.role),['read']);
});
test('publication conflict cannot send a message',async()=>{
  const p=packet(),f=fixture(p,{publishStatus:'conflict'});assert.equal((await api.delegateAndWait(p,f.host,f.options)).errorCode,'ASSIGNMENT_NOT_STORED');assert.equal(f.calls.some(c=>c.role==='send'),false);
});
test('timeout persists sent binding and resume retrieves the result without republishing or resending',async()=>{
  const p=packet(),f=fixture(p);const timed=await api.delegateAndWait(p,f.host,{...f.options,timeoutMs:20000});
  assert.equal(timed.status,'timeout');assert.equal(timed.state.delivery,'sent');assert.equal(timed.wait.lookups,3);
  const g=fixture(p,{responses:[found(p)]});const resumed=await api.delegateAndWait(p,g.host,{...g.options,resume:timed.state});
  assert.equal(resumed.status,'completed');assert.deepEqual(g.calls.map(c=>c.role),['get']);
});
test('unknown message acknowledgement is persisted and never blindly resent',async()=>{
  const p=packet(),f=fixture(p,{sendError:true});const first=await api.delegateAndWait(p,f.host,f.options);
  assert.equal(first.state.delivery,'uncertain');const g=fixture(p);const resumed=await api.delegateAndWait(p,g.host,{...g.options,resume:first.state});
  assert.equal(resumed.status,'delivery_uncertain');assert.deepEqual(g.calls.map(c=>c.role),['get']);
});
test('wrong task, assignment receipt, or material version cannot resume Codex with a claimed successful result',async()=>{
  for(const change of [{taskId:'other'},{assignmentReceipt:'00000000-0000-4000-8000-000000000000'},{materialsRead:[{path:'src/price.js',source:'direct',sha256:'0'.repeat(64)}]}]){
    const p=packet(),f=fixture(p,{responses:[{status:'not_found',taskId:'fixture-task',revision:'r1'},found(p,change)]});
    const out=await api.delegateAndWait(p,f.host,f.options);assert.equal(out.status,'blocked');assert.match(out.errorCode,/MISMATCH/);
  }
});
test('needs_materials is returned once, with no automatic new revision or further Chat turn',async()=>{
  const p=packet(),f=fixture(p,{responses:[{status:'not_found',taskId:'fixture-task',revision:'r1'},found(p,{status:'needs_materials',requests:['docs/rules.md line2']})]});
  const out=await api.delegateAndWait(p,f.host,f.options);assert.equal(out.status,'needs_materials');assert.equal(f.calls.filter(c=>c.role==='send').length,1);assert.equal(out.state.revision,'r1');
});
test('cancellation during waiting returns without another lookup or message',async()=>{
  const p=packet(),f=fixture(p);let cancel=false;
  const out=await api.delegateAndWait(p,f.host,{...f.options,isCancelled:()=>cancel,sleep:async()=>{cancel=true;}});
  assert.equal(out.status,'cancelled');assert.equal(out.state.delivery,'sent');assert.equal(f.calls.filter(c=>c.role==='get').length,2);
});
test('a hung result tool is bounded by the remaining wait time',async()=>{
  const p=packet(),f=fixture(p,{responses:[{status:'not_found',taskId:'fixture-task',revision:'r1'},()=>new Promise(()=>{})]});
  const out=await api.delegateAndWait(p,f.host,{...f.options,timeoutMs:5});assert.equal(out.status,'blocked');assert.equal(out.errorCode,'HOST_TOOL_TIMEOUT');assert.equal(out.stage,'waiting');
});
test('retired local-access configuration fails before any host effects; sent file packets can still resume',async()=>{
  for(const extra of [{materialRequests:[]},{localReader:{url:'https://fixture.invalid/mcp'}}])assert.throws(()=>prepareDelegation({goal:'fixture',...extra},profile),/RETIRED_LOCAL_ACCESS/);
  for(const extra of [{materialRequests:[{path:'docs/rules.md',startLine:2,maxLines:1}]},{localReader:{url:'https://fixture.invalid/mcp'}}]){
    const p={...packet(),...extra};p.packetId=packetDigest(p);const f=fixture(p);
    await assert.rejects(api.delegateAndWait(p,f.host,f.options),/RETIRED_LOCAL_ACCESS/);assert.equal(f.calls.length,0);
  }
  const legacy={...packet(),materialRequests:[],localReader:null};legacy.packetId=packetDigest(legacy);
  const f=fixture(legacy,{responses:[found(legacy)]});assert.equal((await api.delegateAndWait(legacy,f.host,f.options)).status,'completed');assert.equal(f.calls.some(c=>c.role==='send'),false);
});
test('directory escape, sensitive paths, snapshot bodies, and missing full-file version are rejected locally',()=>{
  for(const path of ['../private','C:/other','docs\\rules.md','.env','docs/token.txt','docs/.git/config'])assert.throws(()=>prepareDelegation({goal:'fixture',directMaterials:[{path,wholeFile:true,text:'fixture'}]},profile),/INVALID_DIRECT_PATH/);
  assert.throws(()=>prepareDelegation({goal:'fixture',files:[{path:'a.txt',sha256:'0'.repeat(64),content:'whole project'}]},profile),/METADATA_ONLY/);
  assert.throws(()=>prepareDelegation({goal:'fixture',directMaterials:[{path:'a.txt',text:'a\n',startLine:2,endLine:2}]},profile),/FULL_FILE_METADATA/);
});
test('a direct range keeps the declared whole-file hash rather than hashing the slice as the file',()=>{
  const p=prepareDelegation({goal:'range',files:[{path:'a.txt',sha256:'a'.repeat(64),totalLines:5}],directMaterials:[{path:'a.txt',text:'line2\n',startLine:2,endLine:2}]},profile);
  assert.equal(p.directMaterials[0].sha256,'a'.repeat(64));assert.equal(p.directMaterials[0].wholeFile,false);assert.equal(p.assignment.files[0].totalLines,5);
});
test('resume binding cannot be switched to a different packet or recipient',async()=>{
  const p=packet(),f=fixture(p);await assert.rejects(api.delegateAndWait(p,f.host,{...f.options,resume:{packetId:'0'.repeat(64),threadId,taskId:'fixture-task',revision:'r1',delivery:'sent',assignmentReceipt:receipt}}),/RESUME_BINDING_MISMATCH/);assert.equal(f.calls.length,0);
});
test('tool discovery fails before effects when a host tool is missing or ambiguous',()=>{
  assert.throws(()=>api.bindHost({},[]),/MISSING_OR_AMBIGUOUS/);
  const inventory=['mcp__codex_app__read_thread','mcp__codex_app__send_message_to_thread','service_a_publish_assignment','service_b_publish_assignment','service_a_get_task_result'].map(name=>({name}));
  assert.throws(()=>api.bindHost(Object.fromEntries(inventory.map(t=>[t.name,()=>{}])),inventory),/MISSING_OR_AMBIGUOUS/);
});
test('binding and installed entry use friend-local paths and do not overwrite an unrelated skill',async()=>{
  const base=await mkdtemp(join(tmpdir(),'collaboration-entry-'));
  try{
    const root=join(base,'materials');await mkdir(root);
    const bound=await bindConversation('https://chatgpt.com/c/'+threadId,root,{base:join(base,'state'),codexThreadId:'00000000-0000-4000-8000-000000000001'});assert.equal(bound.targetThreadId,threadId);
    assert.throws(()=>chatId('https://chatgpt.com/c/'+threadId+'?token=x'));
    const dest=join(base,'installed');const installed=await installEntry({destination:dest});assert.equal(installed.messageSent,false);assert.equal(installed.serviceStarted,false);
    assert.ok(new Function('return (\n'+await readFile(join(dest,'scripts/host-runtime.js'),'utf8')+'\n)')().delegateAndWait);
    await installEntry({destination:dest});
    const other=join(base,'unrelated');await mkdir(other);await writeFile(join(other,'SKILL.md'),'existing');await assert.rejects(installEntry({destination:other}),/EXISTING_SKILL_NOT_OWNED/);assert.equal(await readFile(join(other,'SKILL.md'),'utf8'),'existing');
  }finally{await rm(base,{recursive:true,force:true});}
});
test('portable Codex plugin carries the executable entry and does not claim copied account connections',async()=>{
  const base=await mkdtemp(join(tmpdir(),'collaboration-plugin-'));
  try{
    const built=await buildPlugin(base);assert.equal(built.fileCount,16);assert.equal(built.messageSent,false);
    const manifest=JSON.parse(await readFile(join(base,'plugin.json'),'utf8'));assert.equal(manifest.name,'codex-chat-delegation');
    const status=JSON.parse(await readFile(join(base,'STATUS.json'),'utf8'));assert.equal(status.chatExtraSkillRequired,false);assert.equal(status.modelApiUsedDuringWait,false);assert.equal(status.friendEndToEndAcceptancePassed,false);
    const generatedApi=new Function('return (\n'+await readFile(join(base,'skills/codex-chat-delegate/scripts/host-runtime.js'),'utf8')+'\n)')();
    const p=packet(),f=fixture(p,{responses:[found(p)]});assert.equal((await generatedApi.delegateAndWait(p,f.host,f.options)).status,'completed');assert.equal(f.calls.some(c=>c.role==='send'),false);
    await assert.rejects(buildPlugin(base),/EEXIST/);
  }finally{await rm(base,{recursive:true,force:true});}
});
test('host runtime works in a plain V8 context without Node or URL globals',async()=>{
  const isolated=runInNewContext('('+await readFile(join(here,'host-runtime.js'),'utf8')+')',{setTimeout,clearTimeout});
  const p=packet();
  const f=fixture(p,{responses:[{status:'not_found',taskId:'fixture-task',revision:'r1'},found(p)]});
  assert.equal((await isolated.delegateAndWait(p,f.host,f.options)).status,'completed');
});

test('missing material is returned through results and Codex supplies it in a new bound revision',async()=>{
  const first=packet(),requested=found(first,{status:'needs_materials',requests:['docs/rules.md lines 2-2: supply the discount rule']});
  const f=fixture(first,{responses:[{status:'not_found',taskId:first.assignment.taskId,revision:first.assignment.revision},requested]});
  const pending=await api.delegateAndWait(first,f.host,f.options);assert.equal(pending.status,'needs_materials');assert.equal(f.calls.filter(c=>c.role==='send').length,1);
  const supplied=prepareDelegation({taskId:first.assignment.taskId,revision:'r2',goal:first.assignment.goal,
    directMaterials:[{path:'src/price.js',wholeFile:true,text:first.directMaterials[0].text},{path:'docs/rules.md',wholeFile:true,text:'Apply twenty percent discount.\n'}]},profile);
  const g=fixture(supplied,{responses:[{status:'not_found',taskId:supplied.assignment.taskId,revision:'r2'},found(supplied)]});
  const result=await api.delegateAndWait(supplied,g.host,g.options);assert.equal(result.status,'completed');assert.equal(result.state.revision,'r2');
  assert.equal(g.calls.filter(c=>c.role==='send').length,1);assert.equal(result.result.materialsRead.length,2);
  assert.equal(g.calls.find(c=>c.role==='publish').args.files.some(x=>Object.hasOwn(x,'content')),false);
});

test('metadata alone and retired local evidence cannot be claimed as received material',async()=>{
  const p=prepareDelegation({taskId:'fixture-task',goal:'fixture',files:[{path:'not-sent.txt',sha256:'a'.repeat(64)}]},profile);
  for(const source of ['direct','local_reader']){
    const f=fixture(p,{responses:[found(p,{materialsRead:[{path:'not-sent.txt',sha256:'a'.repeat(64),source}]})]});
    const result=await api.delegateAndWait(p,f.host,f.options);assert.equal(result.status,'blocked');assert.equal(result.errorCode,'RESULT_MATERIAL_MISMATCH');
  }
});
