import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,access} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {spawnSync} from 'node:child_process';
import {buildPlugin} from './build-plugin.mjs';
import {validateResultConnection} from './result-connection.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const api=runInNewContext('('+await readFile(join(here,'publisher-runtime.js'),'utf8')+')');
// Synthetic identifiers only. These fixtures are never submitted to a platform.
const projectId='fixture-project';
const mcpUrl='https://result-fixture.example.com/mcp';
const site=()=>({id:projectId,current_user_role:'owner',status:'active',
  current_live_url:'https://result-fixture.example.com',
  mcp_connection:{mcp_url:mcpUrl,oauth_resource:mcpUrl,plugin_id:'plugin_asdk_app_fixture'},
  auth_client_id:'fixture-web-login-client',siwc_bypass_bearer_token:'fixture-do-not-package',
  source_repository_credential:{token:'fixture-do-not-package'}});
const inspect=(hosting,getSite)=>api.inspectResultConnection(hosting,getSite,{expectedMcpUrl:mcpUrl});

test('missing publisher project stops before any platform lookup or mutation',async()=>{
  let called=0;
  const result=await inspect({},async()=>{called++;return site();});
  assert.equal(result.status,'blocked');assert.equal(result.errorCode,'PUBLISHER_PROJECT_ID_REQUIRED');
  assert.equal(called,0);assert.equal(result.accountConnected,false);assert.equal(result.permissionsChanged,false);
});

test('host metadata is unwrapped in plain V8 and only credential-free connection fields leave the bridge',async()=>{
  let called=0;
  const result=await inspect({project_id:projectId},async args=>{
    called++;assert.deepEqual(JSON.parse(JSON.stringify(args)),{project_id:projectId,include_mcp_connection:true});
    return {structuredContent:{content:[{type:'text',text:JSON.stringify(site())}]}};
  });
  assert.equal(called,1);assert.equal(result.status,'ready_to_package');
  const reference=validateResultConnection(JSON.parse(JSON.stringify(result.connection)));
  assert.equal(reference.registeredMcpId,'plugin_asdk_app_fixture');
  assert.equal(JSON.stringify(result).includes('fixture-do-not-package'),false);
  assert.equal(JSON.stringify(result).includes('fixture-web-login-client'),false);
  assert.equal(result.accountConnected,false);assert.equal(result.crossAccountAccessVerified,false);
});

test('wrong project, publication, role or registered resource cannot become an installable mapping',async()=>{
  const cases=[
    [{id:'other-project'},'PUBLISHER_PROJECT_MISMATCH'],
    [{current_user_role:null},'PUBLISHER_ROLE_REQUIRED'],
    [{status:'creating'},'PUBLISHED_RESULTS_SERVICE_MISMATCH'],
    [{current_live_url:'https://other.example.com'},'PUBLISHED_RESULTS_SERVICE_MISMATCH'],
    [{mcp_connection:{...site().mcp_connection,oauth_resource:'https://other.example.com/mcp'}},'REGISTERED_RESULTS_CONNECTION_NOT_READY'],
    [{mcp_connection:{...site().mcp_connection,plugin_id:null}},'REGISTERED_RESULTS_MCP_ID_REQUIRED']
  ];
  for(const [change,errorCode]of cases){
    const result=await inspect({project_id:projectId},async()=>({...site(),...change}));
    assert.equal(result.status,'blocked');assert.equal(result.errorCode,errorCode);assert.equal(result.connection,undefined);
  }
  const denied=await inspect({project_id:projectId},async()=>({isError:true,content:[]}));
  assert.equal(denied.errorCode,'PUBLISHER_METADATA_ACCESS_FAILED');
});

test('a verified shape packages the exact mapping without claiming consumer authentication or public submission',async()=>{
  const base=await mkdtemp(join(tmpdir(),'publisher-plugin-'));
  try{
    const reference=JSON.parse(JSON.stringify(api.connectionFromSite(site(),{projectId,expectedMcpUrl:mcpUrl})));
    const built=await buildPlugin(base,{resultConnection:reference,requireResultsConnection:true});
    assert.equal(built.fileCount,18);assert.equal(built.registeredResultsConnectionIncluded,true);
    const manifest=JSON.parse(await readFile(join(base,'plugin.json'),'utf8'));
    assert.deepEqual(manifest.extensions,{'com.openai':{apps:'./.app.json'}});
    assert.deepEqual(JSON.parse(await readFile(join(base,'.app.json'),'utf8')),
      {apps:{'codex-chat-results':{id:'plugin_asdk_app_fixture'}}});
    const status=JSON.parse(await readFile(join(base,'STATUS.json'),'utf8'));
    assert.equal(status.consumerAccountConnected,false);assert.equal(status.crossAccountAccessVerified,false);
    assert.equal(status.frameworkSharedBackend,false);assert.equal(status.portableAcrossAccounts,false);
    assert.equal(status.publicDirectorySubmissionReady,false);assert.equal(status.friendEndToEndAcceptancePassed,false);
    assert.equal((await readFile(join(base,'RESULTS-CONNECTION.json'),'utf8')).includes('fixture-do-not-package'),false);
  }finally{await rm(base,{recursive:true,force:true});}
});

test('credential fields and unsafe resources are rejected before creating package output',async()=>{
  const base=await mkdtemp(join(tmpdir(),'publisher-reject-'));
  try{
    const reference=JSON.parse(JSON.stringify(api.connectionFromSite(site(),{projectId,expectedMcpUrl:mcpUrl})));
    const cases=[{...reference,clientSecret:'fixture'},
      {...reference,mcpUrl:'http://result-fixture.example.com/mcp'},
      {...reference,mcpUrl:'https://name:fixture@result-fixture.example.com/mcp'},
      {...reference,mcpUrl:mcpUrl+'?token=fixture'},
      {...reference,oauthResource:'https://other.example.com/mcp'},
      {...reference,registeredMcpId:'fixture-web-login-client'}];
    for(let i=0;i<cases.length;i++){
      const output=join(base,'invalid-'+i);
      await assert.rejects(buildPlugin(output,{resultConnection:cases[i],requireResultsConnection:true}));
      await assert.rejects(access(output),{code:'ENOENT'});
    }
  }finally{await rm(base,{recursive:true,force:true});}
});

test('release command cannot silently produce a preview when the real connection is absent',async()=>{
  const base=await mkdtemp(join(tmpdir(),'publisher-cli-'));
  try{
    const output=join(base,'release');
    const run=spawnSync(process.execPath,[join(here,'build-plugin.mjs'),output,'--require-results'],{encoding:'utf8',timeout:10000});
    assert.equal(run.status,1);assert.match(run.stderr,/REGISTERED_RESULTS_CONNECTION_REQUIRED/);
    await assert.rejects(access(output),{code:'ENOENT'});
  }finally{await rm(base,{recursive:true,force:true});}
});
