import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative,isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {packOwnResults} from './pack-own-results.mjs';

async function fixture(fn){
 const parent=await realpath(tmpdir()),base=await mkdtemp(join(parent,'own-results-pack-'));
 const directory=join(base,'source'),sitesPluginRoot=join(base,'plugin'),archivePath=join(base,'out','service.tar.gz');
 try{
  await mkdir(join(directory,'.openai'),{recursive:true});await mkdir(join(directory,'dist/.openai'),{recursive:true});
  await mkdir(join(sitesPluginRoot,'skills/sites/scripts'),{recursive:true});
  await writeFile(join(directory,'.openai/hosting.json'),JSON.stringify({d1:'DB',r2:'BUCKET',artifact_metadata:{title:'fixture'}}));
  await writeFile(join(directory,'dist/.openai/hosting.json'),JSON.stringify({artifact_metadata:{title:'fixture'}}));
  // Isolate archive construction from the platform helper and network/build.
  await writeFile(join(sitesPluginRoot,'skills/sites/scripts/prepare-site-build.cjs'),
   "const fs=require('fs'),p=require('path');const out=process.argv[3];fs.mkdirSync(out,{recursive:true});fs.writeFileSync(p.join(out,'worker.js'),'export default {}');console.log('worker');");
  return await fn({base,directory,sitesPluginRoot,archivePath});
 }finally{
  const target=await realpath(base),r=relative(parent,target);assert.ok(r&&!r.startsWith('..')&&!isAbsolute(r));
  await rm(target,{recursive:true,force:true});
 }
}
test('Windows service archive retains dist root, hosting attribution, migrations and exact bytes', {skip:process.platform!=='win32'},()=>fixture(async paths=>{
 await mkdir(join(paths.directory,'drizzle'));await writeFile(join(paths.directory,'drizzle/0000.sql'),'CREATE TABLE fixture(id TEXT);');
 const packed=await packOwnResults(paths),bytes=await readFile(paths.archivePath);
 assert.equal(packed.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(packed.sizeBytes,bytes.length);
 const out=join(paths.base,'extracted');await mkdir(out);
 const result=spawnSync('tar.exe',['-xzf',paths.archivePath,'-C',out],{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);
 assert.equal(await readFile(join(out,'dist/worker.js'),'utf8'),'export default {}');
 assert.equal(await readFile(join(out,'dist/.openai/drizzle/0000.sql'),'utf8'),'CREATE TABLE fixture(id TEXT);');
 const hosting=JSON.parse(await readFile(join(out,'dist/.openai/hosting.json'),'utf8'));
 assert.equal(hosting.d1,'DB');assert.equal(hosting.r2,'BUCKET');assert.deepEqual(hosting.artifact_metadata,{title:'fixture'});
 await assert.rejects(packOwnResults(paths),/NEW_SITE_ARCHIVE_REQUIRED/);
 assert.deepEqual(await readFile(paths.archivePath),bytes);
}));
test('conflicting build attribution stops before emitting a service archive',()=>fixture(async paths=>{
 await writeFile(join(paths.directory,'dist/.openai/hosting.json'),JSON.stringify({artifact_metadata:{title:'different'}}));
 await assert.rejects(packOwnResults(paths),/CONFLICTING_SITE_ATTRIBUTION/);
 await assert.rejects(access(paths.archivePath),{code:'ENOENT'});
}));
