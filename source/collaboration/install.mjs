// Install the small Codex-side entry; no Chat connection, service, or permission change.
import {readFile,writeFile,mkdir,copyFile,access} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const packageRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export async function installEntry({destination=join(process.env.CODEX_HOME??join(homedir(),'.codex'),'skills','codex-chat-delegate')}={}){
  const version=process.versions.node.split('.').map(Number);
  if(process.arch!=='x64'||version[0]!==24||version[1]<18)throw new Error('NODE_24_18_OR_LATER_24_X_X64_REQUIRED');
  const marker=join(destination,'INSTALLATION.json');
  try{
    await access(destination);
    const existing=JSON.parse(await readFile(marker,'utf8'));
    if(existing.managedBy!=='codex-chat-business-loop')throw new Error('EXISTING_SKILL_NOT_OWNED');
  }catch(e){if(e.code!=='ENOENT')throw e;try{await access(destination);throw new Error('EXISTING_SKILL_NOT_OWNED');}catch(check){if(check.code!=='ENOENT')throw check;}}
  const sources={
    'SKILL.md':'skill/codex-chat-delegate/SKILL.md',
    'agents/openai.yaml':'skill/codex-chat-delegate/agents/openai.yaml',
    'references/host-entry.md':'skill/codex-chat-delegate/references/host-entry.md',
    'references/requests.md':'skill/codex-chat-delegate/references/requests.md',
    'scripts/host-runtime.js':'source/collaboration/host-runtime.js',
    'scripts/job-entry.js':'source/collaboration/job-entry.js',
    'scripts/prepare.mjs':'source/collaboration/prepare.mjs',
    'scripts/bindings.mjs':'source/collaboration/bindings.mjs',
    'scripts/result-connection.mjs':'source/collaboration/result-connection.mjs',
    'scripts/attachment-local.mjs':'source/collaboration/attachment-local.mjs',
    'scripts/attachment-host-runtime.js':'source/collaboration/attachment-host-runtime.js',
    'references/attachments.md':'skill/codex-chat-delegate/references/attachments.md',
    'scripts/own-results-runtime.js':'source/collaboration/own-results-runtime.js',
    'scripts/pack-own-results.mjs':'source/collaboration/pack-own-results.mjs',
    'scripts/own-results-local.mjs':'source/collaboration/own-results-local.mjs',
    'references/own-results-setup.md':'skill/codex-chat-delegate/references/own-results-setup.md'
  };
  for(const [out,input]of Object.entries(sources)){const target=join(destination,out);await mkdir(dirname(target),{recursive:true});await copyFile(join(packageRoot,input),target);}
  await writeFile(marker,JSON.stringify({managedBy:'codex-chat-business-loop',packageRoot,version:'0.3.10',implicitInvocation:true},null,2)+'\n');
  return {status:'installed',destination,serviceStarted:false,messageSent:false,permissionsChanged:false,discoveryRequiresHostRefresh:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  installEntry().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
