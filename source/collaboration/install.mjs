// Installs local runtime discovery; legacy skill retirement is an explicit final migration step.
import {readFile,writeFile,mkdir,rename,lstat,mkdtemp} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const packageRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const managedBy='codex-chat-business-loop';
const localRoot=()=>join(process.env.LOCALAPPDATA??join(homedir(),'AppData','Local'),'CodexChat');
const legacyRoot=()=>join(process.env.CODEX_HOME??join(homedir(),'.codex'),'skills','codex-chat-delegate');
export async function retireLegacySkill({installationDirectory=localRoot(),skillDirectory=legacyRoot()}={}){
  const source=resolve(skillDirectory),base=resolve(installationDirectory);
  let marker;
  try{
    const folder=await lstat(source);
    if(!folder.isDirectory()||folder.isSymbolicLink())throw new Error('LEGACY_SKILL_LINK_NOT_ALLOWED');
    const markerPath=join(source,'INSTALLATION.json'),markerInfo=await lstat(markerPath);
    if(!markerInfo.isFile()||markerInfo.isSymbolicLink())throw new Error('LEGACY_MARKER_NOT_REGULAR');
    marker=JSON.parse(await readFile(markerPath,'utf8'));
  }catch(e){if(e.code==='ENOENT')return {status:'absent'};throw e;}
  if(marker.managedBy!==managedBy)return {status:'not_managed',changed:false};
  if(source===base||base.startsWith(source+sep))throw new Error('LEGACY_RETIRE_BOUNDARY');
  const selected=[];
  for(const name of ['SKILL.md','agents/openai.yaml']){
    const path=resolve(source,name);
    if(!path.startsWith(source+sep))throw new Error('LEGACY_RETIRE_BOUNDARY');
    try{
      let cursor=source;
      for(const segment of name.split('/').slice(0,-1)){cursor=join(cursor,segment);const parent=await lstat(cursor);if(!parent.isDirectory()||parent.isSymbolicLink())throw new Error('LEGACY_DISCOVERY_PARENT_NOT_REGULAR');}
      const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw new Error('LEGACY_DISCOVERY_FILE_NOT_REGULAR');selected.push({name,path});
    }
    catch(e){if(e.code!=='ENOENT')throw e;}
  }
  if(!selected.length)return {status:'already_retired',runtimeFilesPreserved:true};
  await mkdir(base,{recursive:true});
  const backup=await mkdtemp(join(base,'retired-skill-'));
  if(!resolve(backup).startsWith(base+sep)||source===base||base.startsWith(source+sep))throw new Error('LEGACY_RETIRE_BOUNDARY');
  for(const {name,path}of selected){
    const target=resolve(backup,name.replaceAll('/','-'));
    if(!target.startsWith(resolve(backup)+sep))throw new Error('LEGACY_RETIRE_BOUNDARY');
    await rename(path,target);
  }
  await writeFile(join(backup,'RETIREMENT.json'),JSON.stringify({managedBy,source,retiredAt:new Date().toISOString(),files:selected.map(f=>f.name),runtimeFilesPreserved:true},null,2)+'\n',{flag:'wx'});
  return {status:'retired',backup,removedDiscoveryFiles:selected.map(f=>f.name),runtimeFilesPreserved:true};
}
export async function installEntry({installationDirectory=localRoot(),skillDirectory=legacyRoot(),retireLegacy=false}={}){
  const version=process.versions.node.split('.').map(Number);
  if(process.arch!=='x64'||version[0]!==24||version[1]<18)throw new Error('NODE_24_18_OR_LATER_24_X_X64_REQUIRED');
  const {entryInfo}=await import('./entry-info.mjs'),info=await entryInfo();
  const destination=resolve(installationDirectory),marker=join(destination,'INSTALLATION.json');
  await mkdir(destination,{recursive:true});
  try{const existing=JSON.parse(await readFile(marker,'utf8'));if(existing.managedBy!==managedBy)throw new Error('EXISTING_INSTALLATION_NOT_OWNED');}
  catch(e){if(e.code!=='ENOENT')throw e;}
  const record={schemaVersion:1,managedBy,version:'0.3.12',packageRoot,scriptRoot:info.scriptRoot,nodePath:process.execPath,skillRequired:false};
  const temporary=join(destination,'.installation-'+process.pid+'-'+Date.now()+'.tmp');
  await writeFile(temporary,JSON.stringify(record,null,2)+'\n',{flag:'wx'});await rename(temporary,marker);
  const legacy=retireLegacy?await retireLegacySkill({installationDirectory:destination,skillDirectory}):{status:'preserved_until_entry_verified'};
  return {status:'installed',installationPath:marker,scriptRoot:info.scriptRoot,skillInstalled:false,legacy,serviceStarted:false,messageSent:false,permissionsChanged:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const flags=process.argv.slice(2);
  if(flags.length>1||flags.length&&flags[0]!=='--retire-legacy-skill')throw new Error('UNKNOWN_INSTALL_OPTION');
  installEntry({retireLegacy:flags[0]==='--retire-legacy-skill'}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
