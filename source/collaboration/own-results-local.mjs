// Local durable setup state. No credentials, networking or service execution.
import {readFile,writeFile,rename,mkdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const keys=['phase','projectId','ownerPrivateConfirmed','commitSha','deploymentId','versionId'];
async function optional(path) {try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function atomic(path,value) {
 const temp=path+'.'+randomUUID()+'.tmp';
 try {await writeFile(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx'});await rename(temp,path);}
 finally {await rm(temp,{force:true});}
}
export async function localSetup(directory,operation,value) {
 directory=resolve(directory);const config=join(directory,'.openai','hosting.json'),
 journal=join(directory,'.openai','own-results-setup.json');
 const hosting=await optional(config);
 if(!hosting || hosting.d1!=='DB' || !hosting.capabilities?.includes('mcp'))
  throw new Error('OWN_RESULTS_TEMPLATE_CONFIG_REQUIRED');
 if(operation==='read')return {hosting,state:await optional(journal)};
 if(operation==='hosting') {
  const id=value?.project_id;
  if(typeof id!=='string' || !id || id.length>256 || /[\x00-\x20\x7f]/.test(id) ||
    Object.keys(value).some(k=>k!=='project_id'))throw new Error('EXACT_PROJECT_ID_ONLY');
  if(hosting.project_id && hosting.project_id!==id)throw new Error('EXISTING_PROJECT_CANNOT_BE_REPLACED');
  await atomic(config,{...hosting,project_id:id});return {status:'saved',projectId:id};
 }
 if(operation==='checkpoint') {
  if(!value || Object.keys(value).some(k=>!keys.includes(k)) ||
    typeof value.phase!=='string' || value.phase.length>40)throw new Error('UNSAFE_SETUP_STATE');
  const old=await optional(journal);
  if(old?.projectId && value.projectId!==old.projectId)throw new Error('SETUP_PROJECT_CANNOT_BE_REPLACED');
  if(hosting.project_id && value.projectId && hosting.project_id!==value.projectId)throw new Error('SETUP_PROJECT_MISMATCH');
  await mkdir(join(directory,'.openai'),{recursive:true});
  await atomic(journal,value);return {status:'saved',phase:value.phase};
 }
 throw new Error('UNKNOWN_LOCAL_SETUP_OPERATION');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 const [dir,operation,encoded]=process.argv.slice(2);
 Promise.resolve().then(()=>{
  if(!dir)throw new Error('OWN_RESULTS_DIRECTORY_REQUIRED');
  if(operation==='read')return localSetup(dir,operation);
  if(!encoded || encoded.length>4096 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw new Error('SAFE_JSON_PAYLOAD_REQUIRED');
  return localSetup(dir,operation,JSON.parse(Buffer.from(encoded,'base64').toString('utf8')));
 }).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
