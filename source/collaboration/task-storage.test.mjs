import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {bindConversation,prepareDelegation,loadForThread} from './prepare.mjs';
import {acquireExecution,finishExecution,pauseExecution} from './bindings.mjs';
import {prepareTask,saveState,finishTask,pruneCompleted} from './task-storage.mjs';
const id='00000000-0000-4000-8000-000000000001',chat='00000000-0000-4000-8000-000000000101';
const receipt='11111111-1111-4111-8111-111111111111',resultReceipt='22222222-2222-4222-8222-222222222222';
const DAY=86400000;
async function fixture(fn,{receive=false,image=false}={}){
  const temp=await fs.mkdtemp(join(tmpdir(),'codex-task-cache-')),base=join(temp,'state'),materials=join(temp,'materials');await fs.mkdir(materials);
  try{
    const profile=await bindConversation('https://chatgpt.com/c/'+chat,materials,{base,codexThreadId:id});
    const packet=prepareDelegation(image?{goal:'fixture image',kind:'design',imageGeneration:true,imagePrompts:['synthetic landscape']}:
      {goal:'fixture review',directMaterials:[{path:'note.txt',wholeFile:true,text:'SOURCE_BODY_NOT_IN_RECEIPT\n'}],receiveAttachments:receive},profile);
    const folder=join(base,'collaboration-tasks',id);await fs.mkdir(folder,{recursive:true});
    const packetPath=join(folder,packet.assignment.taskId+'-'+packet.assignment.revision+'-'+packet.packetId.slice(0,12)+'.json');await fs.writeFile(packetPath,JSON.stringify(packet));
    const state={schemaVersion:1,packetId:packet.packetId,taskId:packet.assignment.taskId,revision:packet.assignment.revision,threadId:chat,delivery:'sent',assignmentReceipt:receipt,inputAttachments:[],downloads:[],deletedAttachmentIds:[]};
    const result={taskId:state.taskId,revision:state.revision,assignmentReceipt:receipt,status:'completed',summary:'fixture result',findings:[],materialsRead:[],limitations:[],requests:[]};
    const outcome={status:'completed',state,result,resultReceipt,...(receive?{downloads:[],cleanup:{deleted:[],pending:[]}}:{})};
    const scope={base,codexThreadId:id},outputRoot=join(temp,'outputs');
    const finish=extra=>finishTask({packetPath,outputRoot,outcome,metrics:{},now:1000,...scope,...extra});
    return await fn({temp,base,folder,materials,packet,packetPath,state,outcome,scope,outputRoot,finish});
  }finally{
    const actual=await fs.realpath(temp),allowed=await fs.realpath(tmpdir()),rel=relative(allowed,actual);
    assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel));await fs.rm(actual,{recursive:true,force:true});
  }
}

test('finished cache ages for seven days, then leaves a compact receipt while outputs and bindings stay intact',()=>fixture(async f=>{
  const saved=await f.finish();assert.equal(saved.cacheEligible,true);
  const bindings=await fs.readFile(join(f.base,'bindings.json'),'utf8');
  const report=await fs.readFile(saved.recordPath,'utf8');await fs.writeFile(join(f.outputRoot,'final.txt'),'USER_RESULT');
  assert.equal((await pruneCompleted({...f.scope,now:1000+7*DAY-1,dryRun:false})).archived,0);
  const preview=await pruneCompleted({...f.scope,now:1000+7*DAY,dryRun:true});assert.equal(preview.eligible,1);await fs.access(f.packetPath);
  const cleaned=await pruneCompleted({...f.scope,now:1000+7*DAY,dryRun:false});assert.equal(cleaned.archived,1);assert.deepEqual(cleaned.problems,[]);
  await assert.rejects(fs.access(f.packetPath),/ENOENT/);
  const compact=await fs.readFile(f.packetPath+'.state.json','utf8'),receipt=JSON.parse(compact);
  assert.equal(receipt.type,'codex-chat-receipt');assert.equal(receipt.evidence.resultReceipt,resultReceipt);assert.ok(!compact.includes('SOURCE_BODY_NOT_IN_RECEIPT'));
  assert.equal(await fs.readFile(saved.recordPath,'utf8'),report);assert.equal(await fs.readFile(join(f.outputRoot,'final.txt'),'utf8'),'USER_RESULT');
  assert.equal(await fs.readFile(join(f.base,'bindings.json'),'utf8'),bindings);
  await assert.rejects(loadForThread(f.packetPath,f.scope),/TASK_ARCHIVED_WITH_RECEIPT/);
  assert.equal((await pruneCompleted({...f.scope,now:1000+8*DAY,dryRun:false})).archived,0);
}));

test('active, pending and paused executions protect even an aged completion record',async()=>{
  for(const phase of ['active','pending','paused'])await fixture(async f=>{
    await f.finish();const lease=await acquireExecution(f.base,id,f.packet);
    if(phase!=='active')await finishExecution(f.base,lease,{terminal:false});
    if(phase==='paused')await pauseExecution(f.base,id,f.packet);
    const before=await fs.readFile(join(f.base,'bindings.json'),'utf8');
    const pruned=await pruneCompleted({...f.scope,now:1000+30*DAY,dryRun:false});assert.equal(pruned.archived,0);await fs.access(f.packetPath);
    assert.equal(await fs.readFile(join(f.base,'bindings.json'),'utf8'),before);
  });
});

test('timeout, uncertainty, needs-materials and incomplete remote cleanup never become age-deletable',async()=>{
  for(const status of ['timeout','delivery_uncertain','needs_materials','cleanup-failed','release-failed'])await fixture(async f=>{
    if(status==='cleanup-failed')f.outcome.cleanup.pending.push({attachmentId:'fixture',errorCode:'TEST'});
    else if(status==='release-failed')f.outcome.executionCleanup={pending:true};
    else{f.outcome.status=status;if(status==='delivery_uncertain')f.state.delivery='uncertain';}
    const saved=await f.finish();assert.equal(saved.cacheEligible,false);
    assert.equal((await pruneCompleted({...f.scope,now:1000+90*DAY,dryRun:false})).archived,0);await fs.access(f.packetPath);
  },{receive:true});
});

test('legacy and unknown files stay put, and cleanup never scans another Codex cache',()=>fixture(async f=>{
  await saveState({packetPath:f.packetPath,state:f.state,...f.scope});
  const unknown=join(f.folder,'unrelated.json');await fs.writeFile(unknown,'unknown');
  const foreign=join(f.base,'collaboration-tasks','00000000-0000-4000-8000-000000000002');await fs.mkdir(foreign);await fs.writeFile(join(foreign,'keep.txt'),'another Codex');
  const result=await pruneCompleted({...f.scope,now:1000+90*DAY,dryRun:false});assert.equal(result.archived,0);
  await fs.access(f.packetPath);assert.equal(await fs.readFile(unknown,'utf8'),'unknown');assert.equal(await fs.readFile(join(foreign,'keep.txt'),'utf8'),'another Codex');
}));

test('record writes work in the file bridge without a process global or CLI module imports',()=>fixture(async f=>{
  const args={packetPath:f.packetPath,outputRoot:f.outputRoot,outcome:f.outcome,metrics:{},now:1000,...f.scope};
  const program='globalThis.process=undefined; const storage=await import('+JSON.stringify(new URL('./task-storage.mjs',import.meta.url).href)+'); const args='+JSON.stringify(args)+'; await storage.prepareTask(args); await storage.saveState({...args,state:args.outcome.state}); const saved=await storage.finishTask(args); if(saved.cacheEligible!==true)throw new Error("BRIDGE_WRITE_FAILED");';
  const child=spawnSync(process.execPath,['--input-type=module','--eval',program],{encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(await fs.readFile(f.packetPath+'.state.json','utf8')).localRetention.eligible,true);
}));

test('stale eligible metadata cannot delete a newer uncertain send state',()=>fixture(async f=>{
  await f.finish();const state=JSON.parse(await fs.readFile(f.packetPath+'.state.json','utf8'));state.delivery='uncertain';
  await saveState({packetPath:f.packetPath,state,...f.scope});
  assert.equal((await pruneCompleted({...f.scope,now:1000+30*DAY,dryRun:false})).archived,0);await fs.access(f.packetPath);
}));

test('cache junctions, packet changes and state identity mismatches fail without touching other files',async()=>{
  await fixture(async f=>{
    await assert.rejects(saveState({packetPath:f.packetPath,state:{...f.state,packetId:'0'.repeat(64)},...f.scope}),/STATE_MISMATCH/);
    await f.finish();const packet=JSON.parse(await fs.readFile(f.packetPath,'utf8'));packet.assignment.goal='changed';await fs.writeFile(f.packetPath,JSON.stringify(packet));
    const result=await pruneCompleted({...f.scope,now:1000+30*DAY,dryRun:false});assert.equal(result.archived,0);assert.equal(result.problems.length,1);await fs.access(f.packetPath);
  });
  await fixture(async f=>{
    await f.finish();const held=resolve(f.temp,'held-cache');
    for(const target of [resolve(f.folder),held])assert.ok(target.startsWith(resolve(f.temp)+sep));
    await fs.rename(f.folder,held);await fs.symlink(held,f.folder,process.platform==='win32'?'junction':'dir');
    await assert.rejects(pruneCompleted({...f.scope,now:1000+30*DAY,dryRun:false}),/TASK_CACHE_LINK_NOT_ALLOWED/);
    await fs.access(join(held,f.packetPath.split(/[\\/]/).at(-1)));
  });
});

test('unrelated output reports are never overwritten and resumed completion keeps its original retention time',()=>fixture(async f=>{
  await fs.mkdir(f.outputRoot);const report=join(f.outputRoot,'outcome.json');await fs.writeFile(report,'{"other":true}');
  await assert.rejects(prepareTask({packetPath:f.packetPath,outputRoot:f.outputRoot,...f.scope}),/TASK_REPORT_PATH_OCCUPIED/);
  await assert.rejects(f.finish(),/TASK_REPORT_PATH_OCCUPIED/);assert.equal(await fs.readFile(report,'utf8'),'{"other":true}');
  await fs.unlink(report);await f.finish();await f.finish({now:1000+3*DAY});
  assert.equal((await pruneCompleted({...f.scope,now:1000+7*DAY,dryRun:true})).eligible,1);
}));

test('a fully delivered optional image queue can compact receipts without claiming generation or deleting images',()=>fixture(async f=>{
  Object.assign(f.state,{mode:'image-send-only',instructions:[{delivery:'sent',sentAt:10}]});
  Object.assign(f.outcome,{status:'sent',sentCount:1,generationVerified:false});delete f.outcome.result;delete f.outcome.resultReceipt;
  assert.equal((await f.finish()).cacheEligible,true);
  assert.equal((await pruneCompleted({...f.scope,now:1000+7*DAY,dryRun:false})).archived,1);
  const receipt=JSON.parse(await fs.readFile(f.packetPath+'.state.json','utf8'));assert.equal(receipt.evidence.generationVerified,false);assert.equal(receipt.evidence.status,'sent');
},{image:true}));
