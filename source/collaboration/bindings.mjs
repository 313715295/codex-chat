// Durable per-Codex bindings and execution guards. No network or credentials.
import {readFile,writeFile,open,rename,mkdir,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import process from 'node:process';
import {validateResultConnection} from './result-connection.mjs';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash=/^[a-f0-9]{64}$/;
const key=/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const insist=(yes,code)=>{if(!yes)fail(code);};
export function sourceThreadId(value=process.env.CODEX_THREAD_ID){
  insist(typeof value==='string'&&uuid.test(value.toLowerCase()),'CURRENT_CODEX_THREAD_ID_REQUIRED');return value.toLowerCase();
}
export function bindingPath(base){return join(base,'bindings.json');}
function validate(store){
  if(store?.schemaVersion===1){
    insist(Object.keys(store).length===3&&store.bindings&&store.activeTasks,'INVALID_BINDING_STORE');
    store={...store,schemaVersion:2,accounts:{},savedBindings:{}};
  }
  if(store?.schemaVersion===2){
    insist(Object.keys(store).length===(Object.hasOwn(store,'pausedTasks')?6:5),'INVALID_BINDING_STORE');
    store={...store,schemaVersion:3,targets:{},routedTasks:{}};
  }
  insist(store?.schemaVersion===3&&store.bindings&&store.activeTasks&&store.accounts&&store.savedBindings&&store.targets&&store.routedTasks&&
    Object.keys(store).length===(Object.hasOwn(store,'pausedTasks')?8:7)&&typeof store.bindings==='object'&&typeof store.activeTasks==='object'&&
    !Array.isArray(store.bindings)&&!Array.isArray(store.activeTasks),'INVALID_BINDING_STORE');
  insist(Object.keys(store.bindings).length<=1000,'BINDING_STORE_LIMIT');
  insist(!Array.isArray(store.accounts)&&!Array.isArray(store.savedBindings)&&Object.keys(store.accounts).length<=100,'INVALID_ACCOUNT_STORE');
  insist([store.accounts,store.savedBindings,store.targets,store.routedTasks].every(record),'INVALID_BINDING_STORE');
  for(const [id,a]of Object.entries(store.accounts)){
    const c=validateResultConnection(a?.connection);
    insist(Object.keys(a).length===2&&typeof a.alias==='string'&&a.alias.length<=100&&c.schemaVersion===2&&c.accountId===id,'INVALID_ACCOUNT_PROFILE');
  }
  const chats=new Map();
  const check=(id,p)=>{
    insist(uuid.test(id)&&p?.schemaVersion===1&&Object.keys(p).length===(p.accountId?7:6)&&p.sourceThreadId===id&&uuid.test(p.targetThreadId)&&
      typeof p.authorizedRoot==='string'&&p.authorizedRoot&&typeof p.workspaceId==='string'&&p.workspaceId&&
      typeof p.targetTitle==='string'&&(!p.accountId||store.accounts[p.accountId]),'INVALID_THREAD_BINDING');
    const prior=chats.get(p.targetThreadId);insist(!prior||prior===id,'CHAT_ALREADY_BOUND');chats.set(p.targetThreadId,id);
  };
  for(const [id,byAccount]of Object.entries(store.savedBindings)){
    insist(uuid.test(id)&&byAccount&&typeof byAccount==='object'&&!Array.isArray(byAccount),'INVALID_SAVED_BINDING');
    for(const [account,p]of Object.entries(byAccount)){insist(p.accountId===account,'INVALID_SAVED_BINDING');check(id,p);}
  }
  for(const [id,p]of Object.entries(store.bindings))check(id,p);
  let targetCount=0;
  for(const [id,byAccount]of Object.entries(store.targets)){
    insist(uuid.test(id)&&record(byAccount),'INVALID_TARGET_STORE');
    for(const [account,targets]of Object.entries(byAccount)){
      insist(record(targets)&&store.accounts[account],'INVALID_TARGET_STORE');
      for(const [chat,p]of Object.entries(targets)){
        insist(chat===p.targetThreadId&&p.accountId===account,'INVALID_TARGET_STORE');check(id,p);
        insist(++targetCount<=1000,'TARGET_STORE_LIMIT');
      }
    }
  }
  const occupied=new Set();
  for(const [id,task]of Object.entries(store.activeTasks)){
    insist(store.bindings[id]&&hash.test(task?.packetId)&&Object.keys(task).length===4&&key.test(task.taskId)&&key.test(task.revision)&&
      (task.waiterId===null||uuid.test(task.waiterId)),'INVALID_ACTIVE_TASK');
    occupied.add(store.bindings[id].targetThreadId);
  }
  let routedCount=0;
  for(const [id,tasks]of Object.entries(store.routedTasks)){
    insist(uuid.test(id)&&record(tasks),'INVALID_ROUTED_TASK_STORE');
    for(const [packetId,entry]of Object.entries(tasks)){
      const task=entry?.task,p=entry?.profile;
      insist(Object.keys(entry??{}).length===3&&task?.packetId===packetId&&hash.test(packetId)&&Object.keys(task).length===4&&
        key.test(task.taskId)&&key.test(task.revision)&&(task.waiterId===null||uuid.test(task.waiterId)),'INVALID_ROUTED_TASK');
      check(id,p);
      insist(store.bindings[id]?.accountId===p.accountId&&JSON.stringify(entry.connection)===JSON.stringify(store.accounts[p.accountId].connection),'ROUTED_CONNECTION_CHANGED');
      insist(JSON.stringify(store.targets[id]?.[p.accountId]?.[p.targetThreadId])===JSON.stringify(p),'ROUTED_TARGET_CHANGED');
      insist(!occupied.has(p.targetThreadId),'CHAT_HAS_PENDING_TASK');occupied.add(p.targetThreadId);
      insist(++routedCount<=1000,'ROUTED_TASK_STORE_LIMIT');
    }
  }
  if(Object.hasOwn(store,'pausedTasks')){
    insist(store.pausedTasks&&typeof store.pausedTasks==='object'&&!Array.isArray(store.pausedTasks),'INVALID_PAUSED_TASK_STORE');
    let count=0;
    for(const [id,tasks]of Object.entries(store.pausedTasks)){
      insist(uuid.test(id)&&tasks&&typeof tasks==='object'&&!Array.isArray(tasks),'INVALID_PAUSED_TASK_STORE');
      for(const [packetId,p]of Object.entries(tasks)){
        const task=p?.task;
        insist(hash.test(packetId)&&Object.keys(p??{}).length===(p.routeTarget===true?5:4)&&task?.packetId===packetId&&Object.keys(task).length===4&&
          key.test(task.taskId)&&key.test(task.revision)&&task.waiterId===null&&typeof p.pausedAt==='string'&&
          Number.isFinite(Date.parse(p.pausedAt))&&store.activeTasks[id]?.packetId!==packetId&&!store.routedTasks[id]?.[packetId],'INVALID_PAUSED_TASK');
        check(id,p.profile);
        insist(!occupied.has(p.profile.targetThreadId),'CHAT_HAS_PENDING_TASK');occupied.add(p.profile.targetThreadId);
        insist(JSON.stringify(p.connection)===JSON.stringify(p.profile.accountId?store.accounts[p.profile.accountId].connection:null),'PAUSED_CONNECTION_CHANGED');
        insist(++count<=1000,'PAUSED_TASK_STORE_LIMIT');
      }
    }
  }
  return store;
}
async function readStore(base){
  try{
    const path=bindingPath(base);insist((await stat(path)).size<=2097152,'BINDING_STORE_TOO_LARGE');
    return validate(JSON.parse(await readFile(path,'utf8')));
  }catch(e){if(e.code==='ENOENT')return {schemaVersion:3,bindings:{},activeTasks:{},accounts:{},savedBindings:{},targets:{},routedTasks:{}};throw e;}
}
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
const hasRouted=(store,id)=>Object.keys(store.routedTasks[id]??{}).length>0;
function targetProfile(store,id,chat){
  const current=store.bindings[id];insist(current?.accountId,'ACCOUNT_CONNECTION_REQUIRED');
  const p=store.targets[id]?.[current.accountId]?.[chat];insist(p,'CHAT_TARGET_NOT_CONFIGURED');return p;
}
function tasksIn(store){
  return [...Object.entries(store.activeTasks).map(([id,task])=>({id,task,profile:store.bindings[id]})),
    ...Object.entries(store.routedTasks).flatMap(([id,tasks])=>Object.values(tasks).map(entry=>({id,...entry})))];
}
async function mutate(base,change){
  await mkdir(base,{recursive:true});const lock=join(base,'bindings.lock');let handle;
  const deadline=Date.now()+2000;
  while(!handle){
    try{handle=await open(lock,'wx');}
    catch(e){if(e.code!=='EEXIST')throw e;if(Date.now()>=deadline)fail('BINDING_STORE_BUSY');await new Promise(r=>setTimeout(r,25));}
  }
  const lockId=randomUUID(),temp=bindingPath(base)+'.'+lockId+'.tmp';
  try{
    await handle.writeFile(JSON.stringify({lockId,pid:process.pid})+'\n');
    const store=await readStore(base),value=await change(store);validate(store);
    await writeFile(temp,JSON.stringify(store,null,2)+'\n',{flag:'wx'});await rename(temp,bindingPath(base));return value;
  }finally{
    await handle.close();await rm(temp,{force:true});
    // A crash leaves an explicit lock for inspection; never steal it by age.
    const owner=JSON.parse(await readFile(lock,'utf8'));insist(owner.lockId===lockId,'BINDING_LOCK_CHANGED');await rm(lock);
  }
}
export async function readBinding(base,id=sourceThreadId()){
  id=sourceThreadId(id);const store=await readStore(base),profile=store.bindings[id];
  insist(profile,'COLLABORATION_NOT_BOUND_FOR_THREAD');
  return {...profile,...(profile.accountId?{connection:{...store.accounts[profile.accountId].connection}}:{})};
}
export async function readTarget(base,chat,id=sourceThreadId()){
  id=sourceThreadId(id);const store=await readStore(base),p=targetProfile(store,id,chat);
  return {...p,connection:{...store.accounts[p.accountId].connection},routeTarget:true};
}
export async function listTargets(base,id=sourceThreadId()){
  id=sourceThreadId(id);const store=await readStore(base),accountId=store.bindings[id]?.accountId;
  return {accountId:accountId??null,defaultTarget:store.bindings[id]??null,
    targets:Object.values(store.targets[id]?.[accountId]??{}),
    pending:tasksIn(store).filter(e=>e.id===id).map(e=>({...e.task,targetThreadId:e.profile.targetThreadId}))};
}
export async function saveTarget(base,profile){
  const id=sourceThreadId(profile.sourceThreadId);
  return mutate(base,store=>{
    insist(profile.accountId&&store.bindings[id]?.accountId===profile.accountId,'TARGET_CURRENT_ACCOUNT_REQUIRED');
    for(const e of tasksIn(store))if(e.profile.targetThreadId===profile.targetThreadId)
      insist(e.id===id&&JSON.stringify(e.profile)===JSON.stringify(profile),'TARGET_HAS_PENDING_TASK');
    for(const tasks of Object.values(store.pausedTasks??{}))for(const e of Object.values(tasks))if(e.profile.targetThreadId===profile.targetThreadId)
      insist(e.profile.sourceThreadId===id&&JSON.stringify(e.profile)===JSON.stringify(profile),'TARGET_HAS_PAUSED_TASK');
    store.targets[id]??={};store.targets[id][profile.accountId]??={};
    store.targets[id][profile.accountId][profile.targetThreadId]={...profile};
    return {...profile,connection:{...store.accounts[profile.accountId].connection},routeTarget:true};
  });
}
export async function removeTarget(base,chat,id=sourceThreadId()){
  id=sourceThreadId(id);return mutate(base,store=>{
    const p=targetProfile(store,id,chat);
    insist(!tasksIn(store).some(e=>e.profile.targetThreadId===chat),'TARGET_HAS_PENDING_TASK');
    insist(!Object.values(store.pausedTasks??{}).some(tasks=>Object.values(tasks).some(e=>e.profile.targetThreadId===chat)),'TARGET_HAS_PAUSED_TASK');
    delete store.targets[id][p.accountId][chat];return {status:'target_removed',targetThreadId:chat,messageSent:false};
  });
}
export async function saveBinding(base,profile){
  const id=sourceThreadId(profile.sourceThreadId);
  return mutate(base,store=>{
    for(const [other,p]of Object.entries(store.bindings))insist(other===id||p.targetThreadId!==profile.targetThreadId,'CHAT_ALREADY_BOUND');
    if(store.activeTasks[id]||hasRouted(store,id))insist(JSON.stringify(store.bindings[id])===JSON.stringify(profile),'BINDING_HAS_PENDING_TASK');
    store.bindings[id]={...profile};
    if(profile.accountId){store.savedBindings[id]??={};store.savedBindings[id][profile.accountId]={...profile};}
    return {...profile,...(profile.accountId?{connection:{...store.accounts[profile.accountId].connection}}:{})};
  });
}
export async function registerAccount(base,connection,{alias=''}={}){
  connection=validateResultConnection(connection);insist(connection.schemaVersion===2,'VERIFIED_ACCOUNT_REFERENCE_REQUIRED');
  insist(typeof alias==='string'&&alias.length<=100&&!/[\x00-\x1f]/.test(alias),'INVALID_ACCOUNT_ALIAS');
  return mutate(base,store=>{
    const old=store.accounts[connection.accountId];
    if(old&&JSON.stringify(old.connection)!==JSON.stringify(connection))
      for(const entry of tasksIn(store))insist(entry.profile.accountId!==connection.accountId,'ACCOUNT_HAS_PENDING_TASK');
    store.accounts[connection.accountId]={alias:alias||old?.alias||'',connection};
    return {status:'account_saved',accountId:connection.accountId,alias:store.accounts[connection.accountId].alias};
  });
}
export async function listAccounts(base,id=sourceThreadId()){
  id=sourceThreadId(id);const store=await readStore(base);
  return {activeAccountId:store.bindings[id]?.accountId??null,accounts:Object.values(store.accounts).map(a=>({...a,binding:store.savedBindings[id]?.[a.connection.accountId]??null})),
    pausedTasks:Object.values(store.pausedTasks?.[id]??{}).map(p=>({packetId:p.task.packetId,taskId:p.task.taskId,revision:p.task.revision,accountId:p.profile.accountId??null,targetThreadId:p.profile.targetThreadId,pausedAt:p.pausedAt}))};
}
function packetMatches(packet,profile,connection){
  return packet.target?.threadId===profile.targetThreadId&&packet.assignment?.workspaceId===profile.workspaceId&&
    (!packet.source||(packet.source.codexThreadId===profile.sourceThreadId&&packet.source.authorizedRoot===profile.authorizedRoot))&&
    (profile.accountId?JSON.stringify(packet.connection)===JSON.stringify(connection):!packet.connection)&&
    (!packet.attachments||packet.attachments.root===profile.authorizedRoot);
}
// Explicit local pause only; a running waiter must first stop through its host.
// Keep the exact account, Chat, task and connection so pause never means success.
export async function pauseExecution(base,id,packet){
  id=sourceThreadId(id);
  return mutate(base,store=>{
    const routed=packet.source?.routeTarget===true,entry=routed?store.routedTasks[id]?.[packet.packetId]:null;
    const active=routed?entry?.task:store.activeTasks[id],profile=routed?entry?.profile:store.bindings[id];
    insist(active&&active.packetId===packet.packetId&&active.taskId===packet.assignment?.taskId&&active.revision===packet.assignment?.revision,'EXECUTION_PACKET_MISMATCH');
    insist(active.waiterId===null,'TASK_ALREADY_RUNNING');
    const connection=profile.accountId?store.accounts[profile.accountId].connection:null;
    insist(packetMatches(packet,profile,connection),'EXECUTION_BINDING_MISMATCH');
    store.pausedTasks??={};store.pausedTasks[id]??={};
    insist(!store.pausedTasks[id][packet.packetId],'TASK_ALREADY_PAUSED');
    store.pausedTasks[id][packet.packetId]={task:{...active},profile:{...profile},connection,pausedAt:new Date().toISOString(),...(routed?{routeTarget:true}:{})};
    if(routed)delete store.routedTasks[id][packet.packetId];else delete store.activeTasks[id];
    return {status:'paused',sourceThreadId:id,packetId:packet.packetId,taskId:active.taskId,messageSent:false};
  });
}
export async function resumeExecution(base,id,packet){
  id=sourceThreadId(id);
  return mutate(base,store=>{
    const paused=store.pausedTasks?.[id]?.[packet.packetId];
    insist(paused&&paused.task.taskId===packet.assignment?.taskId&&paused.task.revision===packet.assignment?.revision,'PAUSED_TASK_NOT_FOUND');
    insist(packetMatches(packet,paused.profile,paused.connection),'EXECUTION_BINDING_MISMATCH');
    insist((packet.source?.routeTarget===true)===(paused.routeTarget===true),'EXECUTION_BINDING_MISMATCH');
    if(paused.routeTarget){
      insist(JSON.stringify(targetProfile(store,id,packet.target.threadId))===JSON.stringify(paused.profile),'ROUTED_TARGET_CHANGED');
      store.routedTasks[id]??={};store.routedTasks[id][packet.packetId]={task:{...paused.task},profile:{...paused.profile},connection:paused.connection};
    }else{
      insist(!store.activeTasks[id]&&!hasRouted(store,id),'BINDING_HAS_PENDING_TASK');
      store.bindings[id]={...paused.profile};
      if(paused.profile.accountId){store.savedBindings[id]??={};store.savedBindings[id][paused.profile.accountId]={...paused.profile};}
      store.activeTasks[id]={...paused.task};
    }
    delete store.pausedTasks[id][packet.packetId];
    if(!Object.keys(store.pausedTasks[id]).length)delete store.pausedTasks[id];
    if(!Object.keys(store.pausedTasks).length)delete store.pausedTasks;
    return {status:'pending',sourceThreadId:id,packetId:packet.packetId,taskId:paused.task.taskId,messageSent:false};
  });
}
export async function switchAccount(base,accountId,id=sourceThreadId()){
  id=sourceThreadId(id);
  await mutate(base,store=>{
    insist(!store.activeTasks[id]&&!hasRouted(store,id),'BINDING_HAS_PENDING_TASK');
    insist(store.accounts[accountId],'ACCOUNT_NOT_CONFIGURED');
    const target=store.savedBindings[id]?.[accountId];insist(target,'ACCOUNT_CHAT_BINDING_REQUIRED');
    store.bindings[id]={...target};
  });
  return readBinding(base,id);
}
export async function unbind(base,id=sourceThreadId()){
  id=sourceThreadId(id);return mutate(base,store=>{
    insist(!store.activeTasks[id]&&!hasRouted(store,id),'BINDING_HAS_PENDING_TASK');
    const current=store.bindings[id];if(current?.accountId)delete store.savedBindings[id]?.[current.accountId];
    delete store.bindings[id];return {status:'unbound',sourceThreadId:id};
  });
}
export async function acquireExecution(base,id,packet){
  id=sourceThreadId(id);insist(hash.test(packet.packetId)&&key.test(packet.assignment?.taskId)&&key.test(packet.assignment?.revision),'INVALID_EXECUTION_PACKET');
  return mutate(base,store=>{
    const routed=packet.source?.routeTarget===true;
    insist(packet.source?.routeTarget===undefined||routed,'INVALID_ROUTE_TARGET');
    const p=routed?targetProfile(store,id,packet.target?.threadId):store.bindings[id];insist(p&&p.targetThreadId===packet.target?.threadId&&p.workspaceId===packet.assignment.workspaceId&&
      (!packet.source||(packet.source.codexThreadId===id&&packet.source.authorizedRoot===p.authorizedRoot))&&
      (p.accountId?packet.connection&&JSON.stringify(packet.connection)===JSON.stringify(store.accounts[p.accountId].connection):!packet.connection)&&
      (!packet.attachments||packet.attachments.root===p.authorizedRoot),'EXECUTION_BINDING_MISMATCH');
    const prior=routed?store.routedTasks[id]?.[packet.packetId]?.task:store.activeTasks[id];
    insist(!prior||prior.packetId===packet.packetId,'THREAD_HAS_PENDING_TASK');
    insist(!prior?.waiterId,'TASK_ALREADY_RUNNING');
    for(const tasks of Object.values(store.pausedTasks??{}))for(const paused of Object.values(tasks)){
      insist(paused.task.packetId!==packet.packetId,'TASK_IS_PAUSED');
      insist(paused.profile.targetThreadId!==packet.target.threadId,'CHAT_HAS_PAUSED_TASK');
      insist(paused.task.taskId!==packet.assignment.taskId||paused.task.revision!==packet.assignment.revision,'TASK_ID_IN_USE');
    }
    for(const e of tasksIn(store)){
      if(e.id===id&&e.task===prior)continue;
      insist(e.profile.targetThreadId!==packet.target.threadId,'CHAT_HAS_PENDING_TASK');
      insist(e.task.taskId!==packet.assignment.taskId||e.task.revision!==packet.assignment.revision,'TASK_ID_IN_USE');
    }
    const waiterId=randomUUID(),task={packetId:packet.packetId,taskId:packet.assignment.taskId,revision:packet.assignment.revision,waiterId};
    if(routed){store.routedTasks[id]??={};store.routedTasks[id][packet.packetId]={task,profile:{...p},connection:{...store.accounts[p.accountId].connection}};}
    else store.activeTasks[id]=task;
    return {sourceThreadId:id,packetId:packet.packetId,waiterId};
  });
}
export async function finishExecution(base,lease,{terminal=false}={}){
  const id=sourceThreadId(lease?.sourceThreadId);insist(hash.test(lease.packetId)&&uuid.test(lease.waiterId),'INVALID_EXECUTION_LEASE');
  return mutate(base,store=>{
    const routed=store.routedTasks[id]?.[lease.packetId],active=routed?.task??store.activeTasks[id];
    insist(active&&active.packetId===lease.packetId&&active.waiterId===lease.waiterId,'EXECUTION_LEASE_MISMATCH');
    if(terminal){if(routed)delete store.routedTasks[id][lease.packetId];else delete store.activeTasks[id];}else active.waiterId=null;
    return {status:terminal?'finished':'pending',sourceThreadId:id,packetId:lease.packetId};
  });
}
