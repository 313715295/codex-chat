// Portable Codex orchestration component. It binds existing authenticated host
// tools, not an invented public result URL or an account-specific app ID.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readResultConnection,validateResultConnection} from './result-connection.mjs';
const packageRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export async function buildPlugin(destination,{resultConnection=null,requireResultsConnection=false}={}){
  if(requireResultsConnection&&!resultConnection)throw new Error('REGISTERED_RESULTS_CONNECTION_REQUIRED');
  const connection=resultConnection?validateResultConnection(resultConnection):null;
  const manifest={$schema:'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',name:'codex-chat-delegation',version:'0.3.7',description:'按用户指令或项目规则允许的范围协作、收发材料与结果；生图可选逐条发送，用户自行下载'};
  if(connection)manifest.extensions={'com.openai':{apps:'./.app.json'}};
  const files={
    'plugin.json':JSON.stringify(manifest,null,2)+'\n',
    'STATUS.json':JSON.stringify({orchestrationImplemented:true,host:'Codex desktop with native messaging tools',invocation:'only within Chat collaboration or file exchange permitted by user instructions or applicable user-authorized project rules',serviceOwnership:'each user initializes and owns a private result service',frameworkSharedBackend:false,personalResultsMappingIncluded:!!connection,portableAcrossAccounts:!connection,resultsConnection:connection?'personal registered MCP mapping; do not distribute to friends':'initialize or reuse the current account own private service',registeredResultsConnectionIncluded:!!connection,consumerAccountConnected:false,crossAccountAccessVerified:false,publicDirectorySubmissionReady:false,materialDelivery:'Codex sends text or selected attachments; Chat requests missing material through needs_materials',chatExtraSkillRequired:false,modelApiUsedDuringWait:false,backgroundIdleWakeImplemented:false,friendEndToEndAcceptancePassed:false},null,2)+'\n'
  };
  if(connection){
    files['.app.json']=JSON.stringify({apps:{'codex-chat-results':{id:connection.registeredMcpId}}},null,2)+'\n';
    files['RESULTS-CONNECTION.json']=JSON.stringify(connection,null,2)+'\n';
  }
  const sources={
    'skills/codex-chat-delegate/SKILL.md':'skill/codex-chat-delegate/SKILL.md',
    'skills/codex-chat-delegate/agents/openai.yaml':'skill/codex-chat-delegate/agents/openai.yaml',
    'skills/codex-chat-delegate/references/host-entry.md':'skill/codex-chat-delegate/references/host-entry.md',
    'skills/codex-chat-delegate/scripts/host-runtime.js':'source/collaboration/host-runtime.js',
    'skills/codex-chat-delegate/scripts/job-entry.js':'source/collaboration/job-entry.js',
    'skills/codex-chat-delegate/scripts/result-connection.mjs':'source/collaboration/result-connection.mjs',
    'skills/codex-chat-delegate/scripts/prepare.mjs':'source/collaboration/prepare.mjs',
    'skills/codex-chat-delegate/scripts/bindings.mjs':'source/collaboration/bindings.mjs',
    'skills/codex-chat-delegate/scripts/attachment-local.mjs':'source/collaboration/attachment-local.mjs',
    'skills/codex-chat-delegate/scripts/attachment-host-runtime.js':'source/collaboration/attachment-host-runtime.js',
    'skills/codex-chat-delegate/references/attachments.md':'skill/codex-chat-delegate/references/attachments.md',
    'skills/codex-chat-delegate/scripts/own-results-runtime.js':'source/collaboration/own-results-runtime.js',
    'skills/codex-chat-delegate/scripts/pack-own-results.mjs':'source/collaboration/pack-own-results.mjs',
    'skills/codex-chat-delegate/scripts/own-results-local.mjs':'source/collaboration/own-results-local.mjs',
    'skills/codex-chat-delegate/references/own-results-setup.md':'skill/codex-chat-delegate/references/own-results-setup.md'
  };
  for(const [name,path]of Object.entries(sources))files[name]=await readFile(join(packageRoot,path),'utf8');
  for(const [name,body]of Object.entries(files)){const path=join(resolve(destination),name);await mkdir(dirname(path),{recursive:true});await writeFile(path,body,{flag:'wx'});}
  return {status:'built',destination:resolve(destination),fileCount:Object.keys(files).length,registeredResultsConnectionIncluded:!!connection,consumerAccountConnected:false,messageSent:false,serviceStarted:false};
}
async function main(args){
  const destination=args.shift();
  if(!destination)throw new Error('Usage: build-plugin.mjs <new output directory> [--results-connection <host-generated JSON>] [--require-results]');
  let resultConnection=null,requireResultsConnection=false;
  while(args.length){
    const flag=args.shift();
    if(flag==='--require-results'&&!requireResultsConnection){requireResultsConnection=true;continue;}
    if(flag==='--results-connection'&&!resultConnection&&args.length){resultConnection=await readResultConnection(args.shift());continue;}
    throw new Error('INVALID_BUILD_OPTION');
  }
  return buildPlugin(destination,{resultConnection,requireResultsConnection});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2)).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
