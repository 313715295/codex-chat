import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {registerAccount,listAccounts,switchAccount,readBinding,acquireExecution,finishExecution} from './bindings.mjs';
import {bindConversation,prepareDelegation,loadForThread} from './prepare.mjs';
import {validateResultConnection} from './result-connection.mjs';
const here=dirname(fileURLToPath(import.meta.url)),api=new Function('return ('+await readFile(join(here,'host-runtime.js'),'utf8')+')')();
const source='00000000-0000-4000-8000-000000000001',chatA='00000000-0000-4000-8000-000000000101',chatB='00000000-0000-4000-8000-000000000102';
const connection=(name)=>validateResultConnection({schemaVersion:2,source:'openai-sites:get_site',projectId:'synthetic-'+name,siteRole:'owner',registeredMcpId:'plugin_asdk_app_'+name,mcpUrl:'https://'+name+'.example/mcp',oauthResource:'https://'+name+'.example/mcp',accountId:'account-'+name,principalId:'site-principal-'+name,toolPrefix:'mcp__synthetic_'+name+'_'});
const ca=connection('a'),cb=connection('b');
const site=c=>({id:c.projectId,status:'active',current_user_role:'owner',current_live_url:c.mcpUrl.slice(0,-4),mcp_connection:{mcp_url:c.mcpUrl,oauth_resource:c.mcpUrl,plugin_id:c.registeredMcpId},access_policy:{access_mode:'custom',allowed_account_user_ids:[c.accountId],allowed_users:[{account_user_id:c.accountId,role:'owner'}],allowed_groups:[],allowed_tenant_group_ids:[],allowed_workspace_group_ids:[],allowed_editors:[]}});
const channel=c=>({schemaVersion:1,mcpUrl:c.mcpUrl,principalId:c.principalId});
test('export application name comes from the verified owner service, without unsafe control characters',async()=>{
 let title='Private application';
 const tools={mcp__codex_apps__sites_get_site:async()=>({...site(ca),title}),mcp__codex_app__read_thread:async()=>{},mcp__codex_app__send_message_to_thread:async()=>{},[ca.toolPrefix+'publish_assignment']:async()=>{},[ca.toolPrefix+'get_task_result']:async a=>({status:'not_found',...a,channel:channel(ca)})};
 const host=api.bindHost(tools,Object.keys(tools).map(name=>({name})),ca);
 await host.verifyAccount();assert.equal(host.applicationName,title);
 title='another\n instruction';await host.verifyAccount();assert.equal(host.applicationName,undefined);
});
async function fixture(fn){
 const temporaryRoot=await realpath(tmpdir());
 const base=await mkdtemp(join(temporaryRoot,'codex-chat-accounts-')),root=join(base,'materials'),state=join(base,'state');await mkdir(root);
 try{return await fn({base,root,state});}finally{assert.ok(resolve(base).startsWith(resolve(temporaryRoot)));await rm(base,{recursive:true,force:true});}
}
const bind=(state,root,c,chat)=>bindConversation('https://chatgpt.com/c/'+chat,root,{base:state,codexThreadId:source,accountId:c.accountId});
const packet=p=>prepareDelegation({taskId:'account-test',goal:'synthetic review',directMaterials:[{path:'note.txt',wholeFile:true,text:'alpha\n'}]},p);
test('A to B to A retains each Chat and root for the same Codex; packets pin identities and namespaces',()=>fixture(async({base,root,state})=>{
 await registerAccount(state,ca,{alias:'A'});await registerAccount(state,cb,{alias:'B'});
 const pa=packet(await bind(state,root,ca,chatA)),other=join(base,'b-materials');await mkdir(other);
 const pb=packet(await bind(state,other,cb,chatB));assert.notEqual(pa.assignment.taskId,pb.assignment.taskId);
 assert.equal((await switchAccount(state,ca.accountId,source)).targetThreadId,chatA);
 assert.equal((await readBinding(state,source)).authorizedRoot,root);
 assert.equal((await switchAccount(state,cb.accountId,source)).authorizedRoot,other);
 assert.deepEqual(pb.connection,cb);assert.equal((await listAccounts(state,source)).accounts.length,2);
}));
test('a pending A task blocks B switch and channel reconfiguration, including while no waiter is running',()=>fixture(async({root,state})=>{
 await registerAccount(state,ca);await registerAccount(state,cb);await bind(state,root,cb,chatB);const p=packet(await bind(state,root,ca,chatA));
 const lease=await acquireExecution(state,source,p);await finishExecution(state,lease,{terminal:false});
 await assert.rejects(switchAccount(state,cb.accountId,source),/BINDING_HAS_PENDING_TASK/);
 await assert.rejects(registerAccount(state,{...ca,toolPrefix:'mcp__changed_'}),/ACCOUNT_HAS_PENDING_TASK/);
 await assert.rejects(bind(state,root,cb,chatB),/BINDING_HAS_PENDING_TASK/);
 const resumed=await acquireExecution(state,source,p);await finishExecution(state,resumed,{terminal:true});
 assert.equal((await switchAccount(state,cb.accountId,source)).targetThreadId,chatB);
}));
test('saved B blocks another Codex claiming its Chat even while A is active; roots may be shared',()=>fixture(async({root,state})=>{
 await registerAccount(state,ca);await registerAccount(state,cb);await bind(state,root,cb,chatB);await bind(state,root,ca,chatA);
 await assert.rejects(bindConversation('https://chatgpt.com/c/'+chatB,root,{base:state,codexThreadId:chatA,accountId:cb.accountId}),/CHAT_ALREADY_BOUND/);
}));
test('old schema is migrated without changing its target; it needs explicit verified account binding',()=>fixture(async({root,state})=>{
 await mkdir(state);const old={schemaVersion:1,bindings:{[source]:{schemaVersion:1,sourceThreadId:source,targetThreadId:chatA,targetTitle:'',authorizedRoot:root,workspaceId:'old'}},activeTasks:{}};
 await writeFile(join(state,'bindings.json'),JSON.stringify(old));assert.equal((await readBinding(state,source)).accountId,undefined);
 await registerAccount(state,ca);assert.equal((await readBinding(state,source)).targetThreadId,chatA);
 assert.equal(JSON.parse(await readFile(join(state,'bindings.json'),'utf8')).schemaVersion,2);
 assert.equal((await bind(state,root,ca,chatA)).connection.accountId,ca.accountId);
}));
test('a stale A packet cannot load or acquire after B is selected; a channel changed with no task also invalidates old packets',()=>fixture(async({base,root,state})=>{
 await registerAccount(state,ca);await registerAccount(state,cb);const p=packet(await bind(state,root,ca,chatA));
 const file=join(base,'packet.json');await writeFile(file,JSON.stringify(p));await bind(state,root,cb,chatB);
 await assert.rejects(loadForThread(file,{base:state,codexThreadId:source}),/PACKET_THREAD_BINDING_MISMATCH/);
 await assert.rejects(acquireExecution(state,source,p),/EXECUTION_BINDING_MISMATCH/);
 await switchAccount(state,ca.accountId,source);await registerAccount(state,{...ca,principalId:'new-principal'});
 await assert.rejects(loadForThread(file,{base:state,codexThreadId:source}),/PACKET_THREAD_BINDING_MISMATCH/);
}));
test('identity discovery uses the native private owner and independently matches the actual MCP channel, ignoring unrelated services',async()=>{
 const tools={mcp__codex_apps__sites_get_site:async()=>site(ca)};
 for(const c of [ca,cb]){tools[c.toolPrefix+'publish_assignment']=async()=>assert.fail('must not mutate');tools[c.toolPrefix+'get_task_result']=async a=>({status:'not_found',...a,channel:channel(c)});}
 const inventory=Object.keys(tools).map(name=>({name}));assert.deepEqual(await api.discoverAccount(tools,inventory,{projectId:ca.projectId}),ca);
 tools[ca.toolPrefix+'get_task_result']=async a=>({status:'not_found',...a,channel:{...channel(ca),mcpUrl:cb.mcpUrl}});
 await assert.rejects(api.discoverAccount(tools,inventory,{projectId:ca.projectId}),/ACCOUNT_CHANNEL_NOT_CONNECTED_OR_UPGRADE_REQUIRED/);
});
test('wrong native account stops before publishing or sending, and a different connected principal cannot read results',()=>fixture(async({root,state})=>{
 await registerAccount(state,ca);const p=packet(await bind(state,root,ca,chatA));let mutations=0;
 const tools={mcp__codex_apps__sites_get_site:async()=>site(cb),mcp__codex_app__read_thread:async()=>assert.fail('must not inspect target'),mcp__codex_app__send_message_to_thread:async()=>{mutations++;}};
 tools[ca.toolPrefix+'publish_assignment']=async()=>{mutations++;};
 tools[ca.toolPrefix+'get_task_result']=async a=>({status:'not_found',...a,channel:{...channel(ca),principalId:'another-account'}});
 const host=api.bindHost(tools,Object.keys(tools).map(name=>({name})),ca);
 const result=await api.delegateAndWait(p,host,{deliveryAuthorized:true,execution:{acquire:q=>acquireExecution(state,source,q),release:(l,o)=>finishExecution(state,l,o)}});
 assert.equal(result.stage,'account-check');assert.equal(result.status,'blocked');assert.equal(mutations,0);
 await assert.rejects(host.getTaskResult({taskId:'test',revision:'r1'}),/CONNECTED_CHANNEL_IDENTITY_MISMATCH/);
}));
test('bound tool family never falls back to another service, and account references cannot contain credentials',()=>{
 const tools={mcp__codex_app__read_thread:async()=>{},mcp__codex_app__send_message_to_thread:async()=>{},[cb.toolPrefix+'publish_assignment']:async()=>{},[cb.toolPrefix+'get_task_result']:async()=>{}};
 assert.throws(()=>api.bindHost(tools,Object.keys(tools).map(name=>({name})),ca),/MISSING_OR_AMBIGUOUS_HOST_TOOL/);
 assert.throws(()=>validateResultConnection({...ca,token:'secret'}),/CREDENTIAL_FREE_RESULTS_REFERENCE_REQUIRED/);
 assert.throws(()=>validateResultConnection({...ca,siteRole:'editor'}),/OWN_ACCOUNT_OWNER_REQUIRED/);
});
test('current-account detection restores the saved B route without using inaccessible A or modifying any service',async()=>{
 let calls=0;
 const profiles=[ca,cb].map(c=>({connection:c,binding:{targetThreadId:c===ca?chatA:chatB}}));
 const tools={mcp__codex_apps__sites_get_site:async({project_id})=>{if(project_id===ca.projectId)throw Error('not accessible');return site(cb);},mcp__codex_app__read_thread:async({threadId})=>({thread:{id:threadId,kind:'chatgpt'}})};
 tools[cb.toolPrefix+'publish_assignment']=async()=>{calls++;};
 tools[cb.toolPrefix+'get_task_result']=async a=>({status:'not_found',...a,channel:channel(cb)});
 const result=await api.resolveCurrentAccount(tools,Object.keys(tools).map(name=>({name})),profiles);
 assert.equal(result.status,'ready');assert.equal(result.accountId,cb.accountId);assert.equal(result.binding.targetThreadId,chatB);assert.equal(calls,0);
 tools.mcp__codex_app__read_thread=async()=>({thread:{id:chatA,kind:'chatgpt'}});
 assert.equal((await api.resolveCurrentAccount(tools,Object.keys(tools).map(name=>({name})),profiles)).errorCode,'ACCOUNT_LOGIN_OR_FIRST_SETUP_REQUIRED');
});
