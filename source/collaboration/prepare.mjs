// Local preparation only. Native messaging and authenticated result tools run in
// the Codex host, never through shell HTTP or copied account credentials.
import {readFile,writeFile,mkdir,realpath,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {join,resolve,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {describe} from './attachment-local.mjs';
import {sourceThreadId,bindingPath,readBinding,saveBinding,unbind,acquireExecution,finishExecution,registerAccount,listAccounts,switchAccount} from './bindings.mjs';
import {validateResultConnection} from './result-connection.mjs';

export const stateRoot=join(process.env.LOCALAPPDATA??homedir(),'CodexChatReader');
const sha=text=>createHash('sha256').update(text).digest('hex');
const lineCount=text=>(text.match(/[^\n]*\n|[^\n]+$/g)||[]).length;
const validHash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const validPath=v=>typeof v==='string'&&v.length>0&&v.length<=300&&!/[\\:\x00-\x1f\x7f]/.test(v)&&
  v.split('/').every(s=>s&&s!=='.'&&s!=='..'&&!/[. ]$/.test(s)&&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s)&&
    !/^(\.env(?:\..*)?|\.(git|ssh|aws|gnupg|codex)|credentials(?:[._-].*)?|secrets?(?:[._-].*)?|tokens?(?:[._-].*)?|id_rsa|id_ed25519)$/i.test(s)&&!/\.(key|pem|p12|pfx|keystore)$/i.test(s));
const insist=(yes,code)=>{if(!yes)throw new Error(code);};
function text(v,max=32768,required=false){
  insist(typeof v==='string'&&v.isWellFormed()&&!v.includes('\0')&&Buffer.byteLength(v)<=max&&(!required||v.length>0),'INVALID_TEXT');return v;
}
function paths(values){insist(Array.isArray(values)&&values.length<=256&&values.every(validPath)&&new Set(values).size===values.length,'INVALID_PATHS');return [...values];}
function stable(v){if(Array.isArray(v))return '['+v.map(stable).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';return JSON.stringify(v);}
export function packetDigest(packet){const {packetId,...body}=packet;return sha(stable(body));}
export function chatId(value){
  insist(typeof value==='string'&&/^https:\/\/chatgpt\.com\/c\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value),'EXACT_CHAT_CONVERSATION_URL_REQUIRED');
  return value.slice(value.lastIndexOf('/')+1);
}

export function prepareDelegation(input,profile,{attachmentMetadata=[]}={}){
  insist(input&&typeof input==='object'&&!Array.isArray(input),'INVALID_REQUEST');
  insist(!Object.hasOwn(input,'materialRequests')&&!Object.hasOwn(input,'localReader'),'RETIRED_LOCAL_ACCESS_CONFIGURATION');
  insist(profile?.schemaVersion===1&&typeof profile.workspaceId==='string'&&profile.workspaceId&&
    typeof profile.authorizedRoot==='string'&&typeof profile.targetThreadId==='string','COLLABORATION_NOT_BOUND');
  const files=new Map();
  for(const f of input.files??[]){
    insist(validPath(f.path)&&validHash(f.sha256)&&!Object.hasOwn(f,'content')&&!files.has(f.path),'METADATA_ONLY_REQUIRED');
    const metadata={path:f.path,sha256:f.sha256};
    for(const n of ['sizeBytes','totalLines'])if(f[n]!==undefined){insist(Number.isSafeInteger(f[n])&&f[n]>=0,'INVALID_FILE_METADATA');metadata[n]=f[n];}
    files.set(f.path,metadata);
  }
  const directMaterials=[];
  let directBytes=0;
  for(const m of input.directMaterials??[]){
    insist(validPath(m.path)&&!directMaterials.some(f=>f.path===m.path),'INVALID_DIRECT_PATH');
    const body=text(m.text,262144);directBytes+=Buffer.byteLength(body);
    insist(directBytes<=524288,'DIRECT_TEXT_BUDGET_EXCEEDED');
    let metadata=files.get(m.path),scope;
    if(m.wholeFile===true){
      const computed={path:m.path,sha256:sha(body),sizeBytes:Buffer.byteLength(body),totalLines:lineCount(body)};
      insist(!metadata||metadata.sha256===computed.sha256,'DIRECT_VERSION_MISMATCH');
      metadata=computed;scope={wholeFile:true,startLine:1,endLine:computed.totalLines};
    }else{
      insist(metadata&&Number.isSafeInteger(m.startLine)&&m.startLine>=1&&Number.isSafeInteger(m.endLine)&&
        m.endLine>=m.startLine&&m.endLine-m.startLine+1===lineCount(body),'RANGE_REQUIRES_FULL_FILE_METADATA');
      insist(metadata.totalLines===undefined||m.endLine<=metadata.totalLines,'INVALID_DIRECT_RANGE');
      scope={wholeFile:false,startLine:m.startLine,endLine:m.endLine};
    }
    files.set(m.path,metadata);directMaterials.push({path:m.path,text:body,sha256:metadata.sha256,...scope});
  }
  const attachmentRequests=[];
  insist(Array.isArray(input.attachments??[])&&(input.attachments??[]).length<=32,'INVALID_ATTACHMENT_SELECTION');
  for(const selected of input.attachments??[]){
    const measured=attachmentMetadata.find(f=>f.path===selected.path);
    insist(validPath(selected.path)&&!attachmentRequests.some(f=>f.path===selected.path)&&measured&&validHash(measured.sha256)&&
      Number.isSafeInteger(measured.sizeBytes)&&measured.sizeBytes>=0&&measured.sizeBytes<=16777216,'MEASURED_ATTACHMENT_REQUIRED');
    insist(typeof selected.mimeType==='string'&&selected.mimeType.length<=150&&/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(selected.mimeType),'INVALID_ATTACHMENT_MIME');
    const previous=files.get(selected.path);
    insist(!previous||previous.sha256===measured.sha256,'ATTACHMENT_VERSION_MISMATCH');
    files.set(selected.path,{path:selected.path,sha256:measured.sha256,sizeBytes:measured.sizeBytes});
    attachmentRequests.push({path:selected.path,mimeType:selected.mimeType,sha256:measured.sha256,sizeBytes:measured.sizeBytes});
  }
  const proposedId=input.taskId??'C2C-'+randomUUID(),revision=input.revision??'r1';
  const prefix=profile.sourceThreadId?'C'+sha(sourceThreadId(profile.sourceThreadId)+(profile.accountId?'|'+profile.accountId:'')).slice(0,12)+'-':'';
  const taskId=prefix&&typeof proposedId==='string'&&!proposedId.startsWith(prefix)?prefix+proposedId:proposedId;
  insist([taskId,revision].every(v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(v)),'INVALID_TASK_ID');
  const kind=input.kind??'review';insist(['review','design','planning'].includes(kind),'INVALID_TASK_KIND');
  const criteria=input.criteria??['仅根据已提供正文和实际取得的附件完成声明范围，列明证据与未完成项。'];
  insist(Array.isArray(criteria)&&criteria.length>=1&&criteria.length<=32,'INVALID_CRITERIA');criteria.forEach(v=>text(v,4096,true));
  const assignment={taskId,revision,kind,goal:text(input.goal,8192,true),context:text(input.context??''),
    criteria:[...criteria],baseVersion:text(input.baseVersion??'not-provided',512),targetVersion:text(input.targetVersion??'declared-current',512),
    changedPaths:paths(input.changedPaths??directMaterials.map(m=>m.path)),
    focusPaths:paths(input.focusPaths??[...new Set([...directMaterials,...attachmentRequests].map(m=>m.path))]),
    navigation:text(input.navigation??'材料路径用于标识已传材料；缺项通过 needs_materials 请求 Codex 补充必要正文或原文件，并说明用途及已知路径、行范围。'),
    materialMode:'external',workspaceId:profile.workspaceId,files:[...files.values()]};
  insist(assignment.files.length<=256&&Buffer.byteLength(stable(assignment))<=1048576,'ASSIGNMENT_BUDGET_EXCEEDED');
  const packet={schemaVersion:1,target:{threadId:profile.targetThreadId,title:profile.targetTitle??''},assignment,directMaterials};
  if(profile.sourceThreadId)packet.source={codexThreadId:sourceThreadId(profile.sourceThreadId),authorizedRoot:profile.authorizedRoot};
  if(profile.accountId){insist(profile.connection?.accountId===profile.accountId,'ACCOUNT_CONNECTION_REQUIRED');packet.connection=validateResultConnection(profile.connection);}
  if(attachmentRequests.length||input.receiveAttachments===true){packet.attachments={root:profile.authorizedRoot,requests:attachmentRequests};}
  if(input.imageGeneration!==undefined){
    insist(typeof input.imageGeneration==='boolean','INVALID_IMAGE_GENERATION_MODE');
    if(input.imageGeneration){
      insist(kind==='design'&&input.receiveAttachments===true,'IMAGE_RESULT_TRANSPORT_REQUIRED');
      insist(typeof input.imagePrompt==='string'&&input.imagePrompt.trim(),'IMAGE_PROMPT_REQUIRED');
      insist(!assignment.files.length&&!directMaterials.length,'IMAGE_PROMPT_REQUIRES_PREPROVIDED_MATERIALS');
      packet.imageGeneration=true;packet.imagePrompt=text(input.imagePrompt,8192,true);
    }
  }
  if(input.imagePrompt!==undefined){
    insist(input.imageGeneration===true,'IMAGE_PROMPT_REQUIRES_IMAGE_MODE');
  }
  packet.packetId=packetDigest(packet);insist(Buffer.byteLength(JSON.stringify(packet))<=1048576,'DELEGATION_PACKET_TOO_LARGE');return packet;
}

export async function readJson(path,maxBytes=1048576){
  const f=await stat(path);insist(f.isFile()&&f.size<=maxBytes,'CONFIG_TOO_LARGE');
  return JSON.parse(await readFile(path,'utf8'));
}
export async function bindConversation(url,authorizedRoot,{base=stateRoot,title='',codexThreadId=sourceThreadId(),accountId}={}){
  const root=await realpath(resolve(authorizedRoot));insist((await stat(root)).isDirectory(),'AUTHORIZED_DIRECTORY_REQUIRED');
  const profile={schemaVersion:1,sourceThreadId:sourceThreadId(codexThreadId),targetThreadId:chatId(url).toLowerCase(),targetTitle:title,authorizedRoot:root,workspaceId:'local-'+sha(root).slice(0,16)};
  if(accountId)profile.accountId=accountId;
  return saveBinding(base,profile);
}
export async function loadForThread(packetPath,{base=stateRoot,codexThreadId=sourceThreadId()}={}){
  const packet=await readJson(packetPath);insist(packet.packetId===packetDigest(packet),'PACKET_CHANGED');
  insist((packet.materialRequests===undefined||Array.isArray(packet.materialRequests)&&packet.materialRequests.length===0)&&
    (packet.localReader===undefined||packet.localReader===null),'RETIRED_LOCAL_ACCESS_CONFIGURATION');
  const id=sourceThreadId(codexThreadId),profile=await readBinding(base,id);
  insist(packet.target.threadId===profile.targetThreadId&&packet.assignment.workspaceId===profile.workspaceId&&
    (!packet.source||(packet.source.codexThreadId===id&&packet.source.authorizedRoot===profile.authorizedRoot))&&
    (profile.accountId?JSON.stringify(packet.connection)===JSON.stringify(profile.connection):!packet.connection)&&
    (!packet.attachments||packet.attachments.root===profile.authorizedRoot),'PACKET_THREAD_BINDING_MISMATCH');
  return {packet,sourceThreadId:id};
}
async function main(args){
  if(args[0]==='accounts'&&args.length===1){console.log(JSON.stringify(await listAccounts(stateRoot)));return;}
  if(args[0]==='account-register'&&(args.length===2||args.length===3)){console.log(JSON.stringify(await registerAccount(stateRoot,await readJson(args[1],16384),{alias:args[2]??''})));return;}
  if(args[0]==='account-switch'&&args.length===2){console.log(JSON.stringify({status:'switched',profile:await switchAccount(stateRoot,args[1]),messageSent:false}));return;}
  if(args[0]==='account-bind'&&(args.length===3||args.length===4)){
    const available=await listAccounts(stateRoot),account=available.accounts.find(a=>a.connection.accountId===args[1]);insist(account,'ACCOUNT_NOT_CONFIGURED');
    const root=args[3]??account.binding?.authorizedRoot;insist(root,'CHOOSE_AUTHORIZED_DIRECTORY_FIRST');
    console.log(JSON.stringify({status:'bound',profile:await bindConversation(args[2],root,{accountId:args[1]}),messageSent:false}));return;
  }
  if(args[0]==='show'&&args.length===1){console.log(JSON.stringify({profile:await readBinding(stateRoot),bindingPath:bindingPath(stateRoot)}));return;}
  if(args[0]==='unbind'&&args.length===1){console.log(JSON.stringify(await unbind(stateRoot)));return;}
  if(args[0]==='bind'&&(args.length===2||args.length===3)){
    let root=args[2];
    if(!root)try{root=(await readBinding(stateRoot)).authorizedRoot;}catch(e){if(e.message!=='COLLABORATION_NOT_BOUND_FOR_THREAD')throw e;}
    insist(root,'CHOOSE_AUTHORIZED_DIRECTORY_FIRST');
    let accountId;try{accountId=(await readBinding(stateRoot)).accountId;}catch(e){if(e.message!=='COLLABORATION_NOT_BOUND_FOR_THREAD')throw e;}
    const profile=await bindConversation(args[1],root,{accountId});console.log(JSON.stringify({status:'bound',profilePath:bindingPath(stateRoot),profile,messageSent:false}));return;
  }
  if(args[0]==='prepare'&&args.length===2){
    const profile=await readBinding(stateRoot);
    insist(profile.accountId&&profile.connection,'ACCOUNT_CONNECTION_REQUIRED');
    const input=await readJson(args[1]);
    const attachmentMetadata=[];
    for(const selection of input.attachments??[])attachmentMetadata.push({path:selection.path,...await describe(profile.authorizedRoot,selection.path)});
    const packet=prepareDelegation(input,profile,{attachmentMetadata});
    const runs=join(stateRoot,'collaboration-tasks',profile.sourceThreadId);
    const rel=relative(profile.authorizedRoot,runs);insist(rel.startsWith('..')||isAbsolute(rel),'STATE_MUST_BE_OUTSIDE_AUTHORIZED_ROOT');
    await mkdir(runs,{recursive:true});
    const packetPath=join(runs,packet.assignment.taskId+'-'+packet.assignment.revision+'-'+packet.packetId.slice(0,12)+'.json');
    try{await writeFile(packetPath,JSON.stringify(packet,null,2)+'\n',{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;insist(packetDigest(await readJson(packetPath))===packet.packetId,'EXISTING_PACKET_MISMATCH');}
    console.log(JSON.stringify({status:'prepared',packetPath,statePath:packetPath+'.state.json',taskId:packet.assignment.taskId,revision:packet.assignment.revision,packetId:packet.packetId,messageSent:false}));return;
  }
  if(args[0]==='load'&&args.length===2){
    const {packet}=await loadForThread(args[1]);
    let resume=null;try{resume=await readJson(args[1]+'.state.json',262144);}catch(e){if(e.code!=='ENOENT')throw e;}
    console.log(JSON.stringify({packet,resume,packetPath:resolve(args[1]),statePath:resolve(args[1])+'.state.json'}));return;
  }
  if(args[0]==='claim'&&args.length===2){const job=await loadForThread(args[1]);console.log(JSON.stringify(await acquireExecution(stateRoot,job.sourceThreadId,job.packet)));return;}
  if(args[0]==='finish'&&args.length===4){
    insist(['terminal','pending'].includes(args[3]),'INVALID_EXECUTION_FINISH');const job=await loadForThread(args[1]);
    console.log(JSON.stringify(await finishExecution(stateRoot,{sourceThreadId:job.sourceThreadId,packetId:job.packet.packetId,waiterId:args[2]},{terminal:args[3]==='terminal'})));return;
  }
  throw new Error('Usage: prepare.mjs bind <exact Chat URL> [authorized directory] | show | unbind | prepare <request.json> | load <packet.json> | claim <packet.json> | finish <packet.json> <waiterId> <terminal|pending>');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
