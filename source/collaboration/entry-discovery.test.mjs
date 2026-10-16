import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {entryInfo} from './entry-info.mjs';
import {installEntry,retireLegacySkill} from './install.mjs';
import {collaborationEntry,collaborationEntryTool} from '../results-attachments-template/lib/collaboration-entry.ts';

test('MCP entry bootstrap loads the local runtime without reading a skill',async()=>{
  const bundle=await entryInfo({hostBundle:true}),reply=collaborationEntry({});let calls=0;
  assert.equal(collaborationEntryTool.annotations.readOnlyHint,true);assert.equal(reply.skillRequired,false);
  const actual=await new Function('tools','return (async()=>{'+reply.hostBootstrap+'\nreturn {entry,info:bundle.info};})()')({exec_command:async args=>{
    calls++;assert.match(args.cmd,/CodexChat\/INSTALLATION\.json/);assert.ok(!args.cmd.includes('SKILL.md'));return {exit_code:0,output:JSON.stringify(bundle)};
  }});
  assert.equal(calls,1);assert.equal(actual.info.skillRequired,false);assert.equal(typeof actual.entry.runMany,'function');
  await assert.rejects(actual.entry.run({},[],{}),/HOST_BRIDGE_REQUIRED/);
  assert.equal(collaborationEntry({unexpected:'path'}).status,'invalid_arguments');
});

test('default installation registers neutral runtime discovery and leaves legacy files until verified',async()=>{
  const base=await mkdtemp(join(tmpdir(),'transport-install-'));
  try{
    const legacy=join(base,'legacy');await mkdir(legacy);await writeFile(join(legacy,'SKILL.md'),'custom original');
    const result=await installEntry({installationDirectory:join(base,'local'),skillDirectory:legacy});
    const record=JSON.parse(await readFile(result.installationPath,'utf8'));
    assert.equal(record.skillRequired,false);assert.equal(record.scriptRoot,result.scriptRoot);assert.equal(result.skillInstalled,false);
    assert.equal(await readFile(join(legacy,'SKILL.md'),'utf8'),'custom original');
    assert.equal(result.legacy.status,'preserved_until_entry_verified');
  }finally{await rm(base,{recursive:true,force:true});}
});

test('verified migration retires owned discovery with a backup and preserves runtime, bindings and paused data',async()=>{
  const base=await mkdtemp(join(tmpdir(),'transport-retire-'));
  try{
    const legacy=join(base,'legacy'),local=join(base,'local');await mkdir(join(legacy,'agents'),{recursive:true});await mkdir(join(legacy,'scripts'));
    await writeFile(join(legacy,'INSTALLATION.json'),JSON.stringify({managedBy:'codex-chat-business-loop',version:'0.3.11'}));
    await writeFile(join(legacy,'SKILL.md'),'locally edited instructions');await writeFile(join(legacy,'agents/openai.yaml'),'original policy');
    await writeFile(join(legacy,'scripts/host-runtime.js'),'legacy runtime for existing callers');
    await writeFile(join(base,'bindings.json'),'binding and paused-task sentinel');
    const result=await installEntry({installationDirectory:local,skillDirectory:legacy,retireLegacy:true});
    assert.equal(result.legacy.status,'retired');
    await assert.rejects(readFile(join(legacy,'SKILL.md')),/ENOENT/);
    assert.equal(await readFile(join(result.legacy.backup,'SKILL.md'),'utf8'),'locally edited instructions');
    assert.equal(await readFile(join(legacy,'scripts/host-runtime.js'),'utf8'),'legacy runtime for existing callers');
    assert.equal(await readFile(join(base,'bindings.json'),'utf8'),'binding and paused-task sentinel');
    assert.equal((await retireLegacySkill({installationDirectory:local,skillDirectory:legacy})).status,'already_retired');
  }finally{await rm(base,{recursive:true,force:true});}
});

test('another owner skill and installation record are never overwritten',async()=>{
  const base=await mkdtemp(join(tmpdir(),'transport-other-owner-'));
  try{
    const legacy=join(base,'legacy'),local=join(base,'local');await mkdir(legacy);await mkdir(local);
    await writeFile(join(legacy,'INSTALLATION.json'),JSON.stringify({managedBy:'someone-else'}));await writeFile(join(legacy,'SKILL.md'),'unrelated');
    assert.equal((await retireLegacySkill({installationDirectory:local,skillDirectory:legacy})).status,'not_managed');
    await writeFile(join(local,'INSTALLATION.json'),JSON.stringify({managedBy:'someone-else'}));
    await assert.rejects(installEntry({installationDirectory:local}),/EXISTING_INSTALLATION_NOT_OWNED/);
    assert.equal(await readFile(join(legacy,'SKILL.md'),'utf8'),'unrelated');
  }finally{await rm(base,{recursive:true,force:true});}
});

test('retirement rejects a junction in discovery parents before moving any file',async()=>{
  const base=await mkdtemp(join(tmpdir(),'transport-retire-link-'));
  try{
    const legacy=join(base,'legacy'),outside=join(base,'outside');await mkdir(legacy);await mkdir(outside);
    await writeFile(join(legacy,'INSTALLATION.json'),JSON.stringify({managedBy:'codex-chat-business-loop'}));await writeFile(join(legacy,'SKILL.md'),'keep');
    await writeFile(join(outside,'openai.yaml'),'outside policy');await symlink(outside,join(legacy,'agents'),process.platform==='win32'?'junction':'dir');
    await assert.rejects(retireLegacySkill({installationDirectory:join(base,'local'),skillDirectory:legacy}),/LEGACY_DISCOVERY_PARENT_NOT_REGULAR/);
    assert.equal(await readFile(join(legacy,'SKILL.md'),'utf8'),'keep');assert.equal(await readFile(join(outside,'openai.yaml'),'utf8'),'outside policy');
  }finally{await rm(base,{recursive:true,force:true});}
});
