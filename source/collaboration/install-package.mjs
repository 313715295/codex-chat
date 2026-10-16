import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {installEntry} from './install.mjs';
const packageRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export async function checkPackage(root=packageRoot){
 const version=process.versions.node.split('.').map(Number);
 if(process.arch!=='x64'||version[0]!==24||version[1]<18)throw new Error('NODE_24_18_OR_LATER_24_X_X64_REQUIRED');
 const manifest=JSON.parse(await fs.readFile(path.join(root,'PACKAGE-MANIFEST.json'),'utf8'));
 if(manifest.version!=='0.3.12'||!manifest.files||Object.keys(manifest.files).length>1000)throw new Error('INVALID_PACKAGE_MANIFEST');
 for(const [relative,expected] of Object.entries(manifest.files)){
  if(relative.includes('\\')||relative.startsWith('/')||relative.split('/').some(s=>!s||s==='..'||s==='.')||!/^[a-f0-9]{64}$/.test(expected))throw new Error('INVALID_PACKAGE_MANIFEST');
  const target=path.resolve(root,relative),base=path.resolve(root);
  if(!target.startsWith(base+path.sep))throw new Error('INVALID_PACKAGE_MANIFEST');
  let cursor=base;for(const segment of relative.split('/')){cursor=path.join(cursor,segment);if((await fs.lstat(cursor)).isSymbolicLink())throw new Error('PACKAGE_LINK_NOT_ALLOWED');}
  const bytes=await fs.readFile(target);
  if(createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error('PACKAGE_FILE_HASH_MISMATCH:'+relative);
 }
 return {status:'verified',version:manifest.version,node:process.versions.node,arch:process.arch,verifiedFiles:Object.keys(manifest.files).length,externalLocalDependencies:0,serviceDependencies:'locked package-lock.json; checked during account service initialization',permissionsChanged:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 Promise.resolve().then(async()=>{const check=await checkPackage();if(process.argv[2]==='--check')return check;if(process.argv.length>3||process.argv[2]&&process.argv[2]!=='--retire-legacy-skill')throw new Error('UNKNOWN_INSTALL_OPTION');return {...check,entry:await installEntry({retireLegacy:process.argv[2]==='--retire-legacy-skill'}),next:'Ask Codex to initialize or upgrade your own private service, verify get_collaboration_entry and the local host entry, then retire the managed legacy skill. No skill installation is required.'};}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
