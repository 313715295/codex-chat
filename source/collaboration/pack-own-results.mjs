// Windows fallback for the Sites shell packager. Credentials are never inputs.
import {readFile,writeFile,mkdir,mkdtemp,cp,rm,realpath,lstat,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve,dirname,join,relative,isAbsolute,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';

function run(program,args){const r=spawnSync(program,args,{encoding:'utf8',windowsHide:true});if(r.error)throw r.error;if(r.status!==0)throw new Error(r.stderr?.trim()||'SITE_PACK_COMMAND_FAILED');return r.stdout.trim();}
async function regularTree(filename){const s=await lstat(filename);if(s.isDirectory()){for(const name of await readdir(filename))await regularTree(join(filename,name));}else if(!s.isFile()||s.isSymbolicLink())throw new Error('SITE_PACK_REGULAR_FILES_REQUIRED');}
export async function packOwnResults({directory,sitesPluginRoot,archivePath}){
 directory=await realpath(directory);sitesPluginRoot=await realpath(sitesPluginRoot);archivePath=resolve(archivePath);
 try{await lstat(archivePath);throw new Error('NEW_SITE_ARCHIVE_REQUIRED');}catch(e){if(e.code!=='ENOENT')throw e;}
 const parent=dirname(archivePath);await mkdir(parent,{recursive:true});const safeParent=await realpath(parent);
 const stage=await mkdtemp(join(safeParent,'.site-pack-')),dist=join(stage,'dist');
 try{
  const helper=join(sitesPluginRoot,'skills/sites/scripts/prepare-site-build.cjs');
  const kind=run(process.execPath,[helper,directory,dist]);
  const source=JSON.parse(await readFile(join(directory,'.openai/hosting.json'),'utf8'));
  let built={};try{built=JSON.parse(await readFile(join(directory,'dist/.openai/hosting.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(source.artifact_metadata!=null&&built.artifact_metadata!=null&&!isDeepStrictEqual(source.artifact_metadata,built.artifact_metadata))throw new Error('CONFLICTING_SITE_ATTRIBUTION');
  const hosting=kind==='worker'?source:JSON.parse(await readFile(join(dist,'.openai/hosting.json'),'utf8'));
  const attribution=built.artifact_metadata??source.artifact_metadata;if(attribution!=null)hosting.artifact_metadata=attribution;
  await mkdir(join(dist,'.openai'),{recursive:true});await writeFile(join(dist,'.openai/hosting.json'),JSON.stringify(hosting,null,2)+'\n');
  let hasMigrations=true;try{await lstat(join(directory,'drizzle'));}catch(e){if(e.code!=='ENOENT')throw e;hasMigrations=false;}
  if(hasMigrations){await regularTree(join(directory,'drizzle'));await cp(join(directory,'drizzle'),join(dist,'.openai/drizzle'),{recursive:true});}
  await regularTree(stage);run('tar.exe',['-czf',archivePath,'-C',stage,'dist']);
  const entries=run('tar.exe',['-tzf',archivePath]).split(/\r?\n/);
  if(!entries.includes('dist/.openai/hosting.json')||entries.some(p=>!p.startsWith('dist/')||p.split('/').includes('..')))throw new Error('INVALID_SITE_ARCHIVE_LAYOUT');
  const bytes=await readFile(archivePath);return {archive:archivePath,sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),kind};
 }finally{
  const safeStage=await realpath(stage),r=relative(safeParent,safeStage);
  if(!r||r.startsWith('..'+sep)||r==='..'||isAbsolute(r))throw new Error('SITE_PACK_CLEANUP_BOUNDARY');
  await rm(safeStage,{recursive:true,force:true});
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const [directory,sitesPluginRoot,archivePath]=process.argv.slice(2);packOwnResults({directory,sitesPluginRoot,archivePath}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});}
