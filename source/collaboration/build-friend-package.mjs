import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export async function buildFriendPackage(destination){
 destination=path.resolve(destination);try{await fs.access(destination);throw new Error('NEW_PACKAGE_DIRECTORY_REQUIRED');}catch(e){if(e.code!=='ENOENT')throw e;}
 const files=new Map();
 const modules=['install.mjs','install-package.mjs','prepare.mjs','bindings.mjs','host-runtime.js','job-entry.js','attachment-local.mjs','attachment-host-runtime.js','own-results-local.mjs','own-results-runtime.js','pack-own-results.mjs','result-connection.mjs'];
 for(const name of modules)files.set('source/collaboration/'+name,await fs.readFile(path.join(root,'source/collaboration',name)));
 async function collect(relative){
  for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})){
   if(['node_modules','.git','dist','outputs','work','tsconfig.tsbuildinfo','.sites-runtime','.wrangler','.vinext','.next'].includes(entry.name))continue;
   const rel=relative+'/'+entry.name;
   if(entry.isSymbolicLink())throw new Error('PACKAGE_LINK_NOT_ALLOWED');
   if(entry.isDirectory())await collect(rel);else if(entry.isFile())files.set(rel,await fs.readFile(path.join(root,rel)));else throw new Error('REGULAR_PACKAGE_FILES_REQUIRED');
  }
 }
 await collect('skill/codex-chat-delegate');await collect('source/results-attachments-template');
 files.set('README.txt',await fs.readFile(path.join(root,'docs/getting-started.md')));
 for(const name of ['LICENSE','THIRD_PARTY_NOTICES.md','INSTALL_FOR_CODEX.md'])files.set(name,await fs.readFile(path.join(root,name)));
 files.set('Install.cmd',Buffer.from('@echo off\r\nsetlocal\r\nset "TASK_NODE=%ProgramFiles%\\nodejs\\node.exe"\r\nif not exist "%TASK_NODE%" (\r\n echo Node 24.18 or later 24.x x64 is required. Ask Codex to assist with the official installer.\r\n exit /b 1\r\n)\r\n"%TASK_NODE%" "%~dp0source\\collaboration\\install-package.mjs"\r\nexit /b %errorlevel%\r\n'));
 const hosting=JSON.parse(files.get('source/results-attachments-template/.openai/hosting.json').toString('utf8'));
 if(hosting.project_id||hosting.r2!=='BUCKET'||hosting.d1!=='DB')throw new Error('CLEAN_PRIVATE_ATTACHMENT_TEMPLATE_REQUIRED');
 for(const [name,body]of files){
  if(/(^|\/)(\.env(?:\..*)?|results-connection\.json|collaboration\.json|INSTALLATION\.json|own-results-setup\.json)$|\.(pem|pfx|key)$/i.test(name))throw new Error('PRIVATE_FILE_IN_PACKAGE');
  if(/appgprj_[a-z0-9]+|plugin_asdk_app_[a-z0-9]+|https:\/\/[^\s"']+\.chatgpt\.site|C:[\\/]+Users[\\/]+[^\\/]+[\\/]/i.test(body.toString('utf8')))throw new Error('PERSONAL_IDENTITY_IN_PACKAGE:'+name);
 }
 const manifest={version:'0.3.8',ownership:'each user owns their account-private service',accountMappingIncluded:false,credentialsIncluded:false,friendEndToEndAcceptancePassed:false,
 acceptance:{currentAccountRealChat:'text_and_file_roundtrip_passed',accountReturnNewChat:'synthetic_text_roundtrip_passed_current_machine_2026-10-16',pauseResumeAndChatSwitchLocal:'passed',multiAccountLocal:'passed',multiAccountReal:'deferred_by_user',newAccountFirstSetup:'partial_chat_system_error_blocked',freshZipServiceAndConnection:'passed_with_local_fixes_current_machine_2026-10-15',audioPerception:'not_passed',imageAutomaticExport:'disabled_after_unstable_retests',imageInstructionQueue:'three_instructions_passed_current_account_real_chat_2026-10-15',imageOutputContent:'not_verified_user_downloads_in_chat',eventWake:'not_implemented'},
 files:Object.fromEntries([...files].map(([n,b])=>[n,createHash('sha256').update(b).digest('hex')]))};
 files.set('PACKAGE-MANIFEST.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
 for(const [name,body]of files){const target=path.join(destination,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,body,{flag:'wx'});}
 return {status:'built',version:'0.3.8',destination,fileCount:files.size,accountMappingIncluded:false,credentialsIncluded:false,friendEndToEndAcceptancePassed:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)buildFriendPackage(process.argv[2]).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
