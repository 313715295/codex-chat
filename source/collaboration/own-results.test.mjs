import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {runInNewContext} from 'node:vm';
import {buildFriendPackage} from './build-friend-package.mjs';
import {checkPackage} from './install-package.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const api=runInNewContext('('+await readFile(join(here,'own-results-runtime.js'),'utf8')+')');
const plain=x=>JSON.parse(JSON.stringify(x));
const site=()=>({id:'fixture-project',current_user_role:'owner',status:'active',current_live_url:'https://fixture.example.com',
mcp_connection:{mcp_url:'https://fixture.example.com/mcp',oauth_resource:'https://fixture.example.com/mcp',plugin_id:'plugin_asdk_app_fixture'},
siwc_bypass_bearer_token:'fixture-secret'});
function ioFixture(events) {return {checkpoint:async s=>events.push(['checkpoint',plain(s)]),
persistHosting:async h=>events.push(['hosting',plain(h)]),
syncSource:async s=>{events.push(['sync',s.projectId]);assert.equal(s.credential.token,'fixture-source-secret');return {project_id:s.projectId,commit_sha:'a'.repeat(40)};},
waitForDeployment:async s=>{events.push(['wait',s.deploymentId]);return {project_id:s.projectId,id:s.deploymentId,status:'succeeded'};}};}
test('new account creates exactly one private service and saves identity before source/publication',async()=>{
 const events=[];let created=0,got=0;
 const host={create:async()=>{created++;events.push(['create']);return {id:'fixture-project',source_repository_credential:{token:'fixture-source-secret'}};},
 getSite:async()=>{events.push(['get']);return got++===0?{...site(),current_live_url:null,mcp_connection:null}:site();},
 credential:async()=>{throw Error('not needed');},
 publish:async s=>{events.push(['publish']);assert.equal(s.project_id,'fixture-project');return {project_id:s.project_id,id:'fixture-deployment',version_id:'fixture-version',status:'building'};}};
 const result=await api.ensureOwnResults({hosting:{d1:'DB',r2:null,capabilities:['mcp']},slug:'fixture-results',setupAuthorized:true},host,ioFixture(events));
 assert.equal(created,1);assert.equal(result.status,'ready');assert.equal(result.reused,false);
 assert.deepEqual(events.slice(0,4).map(x=>x[0]),['checkpoint','create','hosting','checkpoint']);
 assert.equal(events.find(x=>x[0]==='hosting')[1].d1,'DB');
 assert.equal(JSON.stringify(events).includes('fixture-source-secret'),false);
 assert.equal(JSON.stringify(result).includes('fixture-secret'),false);
 assert.equal(result.accountConnectionVerified,false);
});

test('local setup persists atomically and refuses replacing identity or saving secrets',async()=>{
 const {localSetup}=await import('./own-results-local.mjs');
 const base=await mkdtemp(join(tmpdir(),'own-results-state-'));
 try {
  await mkdir(join(base,'.openai'));await writeFile(join(base,'.openai/hosting.json'),JSON.stringify({d1:'DB',r2:null,capabilities:['mcp']}));
  await localSetup(base,'checkpoint',{phase:'creating'});
  await localSetup(base,'hosting',{project_id:'fixture-project'});
  await localSetup(base,'checkpoint',{phase:'created',projectId:'fixture-project',ownerPrivateConfirmed:true});
  assert.equal((await localSetup(base,'read')).hosting.project_id,'fixture-project');
  await assert.rejects(localSetup(base,'hosting',{project_id:'other-project'}),/EXISTING_PROJECT_CANNOT_BE_REPLACED/);
  await assert.rejects(localSetup(base,'checkpoint',{phase:'ready',projectId:'fixture-project',token:'fixture-secret'}),/UNSAFE_SETUP_STATE/);
  assert.equal((await localSetup(base,'read')).state.phase,'created');
 }finally {await rm(base,{recursive:true,force:true});}
});
test('daily reuse uses exact owner project and performs no creation, push, installation or publication',async()=>{
 let gets=0;const events=[];
 const result=await api.ensureOwnResults({hosting:{project_id:'fixture-project'},ownerPrivateConfirmed:true},
 {getSite:async args=>{gets++;assert.equal(args.project_id,'fixture-project');return site();}},ioFixture(events));
 assert.equal(result.reused,true);assert.equal(gets,1);assert.deepEqual(events.map(x=>x[0]),['checkpoint']);
});
test('uncertain creation, wrong owner and unconfirmed privacy stop without retry or changing access',async()=>{
 let calls=0;const host={create:async()=>{calls++;},getSite:async()=>{calls++;return {...site(),current_user_role:'editor'};}};
 await assert.rejects(api.ensureOwnResults({hosting:{},state:{phase:'creating'},setupAuthorized:true,slug:'fixture-results'},host,ioFixture([])),/CREATION_OUTCOME_UNCERTAIN/);
 assert.equal(calls,0);
 await assert.rejects(api.ensureOwnResults({hosting:{project_id:'fixture-project'},ownerPrivateConfirmed:true},host,ioFixture([])),/OWN_ACCOUNT_OWNER_REQUIRED/);
 await assert.rejects(api.ensureOwnResults({hosting:{project_id:'fixture-project'}},{getSite:async()=>site()},ioFixture([])),/PRIVATE_AUDIENCE_MUST_BE_CONFIRMED/);
 await assert.rejects(api.ensureOwnResults({hosting:{},state:{token:'fixture-secret'}},host,ioFixture([])),/UNSAFE_SETUP_STATE/);
});
test('resume waits for the same deployment and does not republish',async()=>{
 let got=0;const events=[];
 const result=await api.ensureOwnResults({hosting:{project_id:'fixture-project'},state:{phase:'building',projectId:'fixture-project',deploymentId:'fixture-deployment',versionId:'fixture-version',ownerPrivateConfirmed:true}},
 {getSite:async()=>got++?site():{...site(),current_live_url:null,mcp_connection:null}},ioFixture(events));
 assert.equal(result.status,'ready');assert.equal(events.filter(x=>x[0]==='wait').length,1);
 assert.equal(events.find(x=>x[0]==='wait')[1],'fixture-deployment');
 assert.equal(events.some(x=>x[0]==='sync'),false);
});
test('current share package is complete, excludes retired local service entries and detects altered files',async()=>{
 const base=await mkdtemp(join(tmpdir(),'friend-files-package-'));
 try {
  const output=join(base,'package');const built=await buildFriendPackage(output);
  assert.equal(built.version,'0.3.6');assert.equal(built.accountMappingIncluded,false);assert.equal(built.credentialsIncluded,false);
  const manifest=JSON.parse(await readFile(join(output,'PACKAGE-MANIFEST.json'),'utf8'));
  assert.ok(manifest.files['source/results-attachments-template/build/sites-vite-plugin.ts']);
  assert.ok(manifest.files['source/results-attachments-template/build/connector-preview-plugin.mjs']);
  assert.ok(!Object.keys(manifest.files).some(p=>p.includes('/.sites-runtime/')));
  assert.ok(Object.keys(manifest.files).every(p=>!p.startsWith('source/reader/')&&!p.startsWith('skill/codex-chat-reader/')&&!p.endsWith('.exe')));
  assert.equal((await checkPackage(output)).verifiedFiles,Object.keys(manifest.files).length);
  await writeFile(join(output,'source/collaboration/prepare.mjs'),'tampered');
  await assert.rejects(checkPackage(output),/PACKAGE_FILE_HASH_MISMATCH/);
  await assert.rejects(buildFriendPackage(output),/NEW_PACKAGE_DIRECTORY_REQUIRED/);
 }finally{await rm(base,{recursive:true,force:true});}
});
