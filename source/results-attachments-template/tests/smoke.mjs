import {registerHooks} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sqlite=new DatabaseSync(':memory:');
sqlite.exec(readFileSync(new URL('../drizzle/0000_clean_weapon_omega.sql',import.meta.url),'utf8'));
globalThis.__testEnv = {
 DB: {
  prepare(sql) {
   return {
    bind(...args) {
     return {
      async run() { return sqlite.prepare(sql).run(...args); },
      async first() { return sqlite.prepare(sql).get(...args) || null; }
     };
    }
   };
  }
 }
};
registerHooks({resolve(specifier,ctx,next){if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export const env=globalThis.__testEnv',shortCircuit:true};if((specifier.startsWith('../../lib/')||specifier.startsWith('./'))&&!/\.[a-z]+$/i.test(specifier))specifier+='.ts';return next(specifier,ctx)}});
const {POST}=await import('../app/mcp/route.ts');
async function call(method,params={},user='test-owner'){const h={'Content-Type':'application/json'};if(user)h['oai-authenticated-user-id']=user;const r=await POST(new Request('https://fixture.invalid/mcp',{method:'POST',headers:h,body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}));return {status:r.status,body:await r.json()}}
assert.equal((await call('initialize',{protocolVersion:'2025-06-18'})).body.result.protocolVersion,'2025-06-18');
const inventory=(await call('tools/list',{},null)).body.result.tools;assert.ok(inventory.some(t=>t.name==='read_attachment_chunk'));assert.ok(inventory.some(t=>t.name==='submit_task_result'));
assert.ok(inventory.some(t=>t.name==='get_collaboration_entry'));
const entry=(await call('tools/call',{name:'get_collaboration_entry',arguments:{}})).body.result.structuredContent;
assert.equal(entry.skillRequired,false);assert.match(entry.hostBootstrap,/entry-info\.mjs/);
assert.equal(entry.channel.principalId,'test-owner');
assert.equal((await call('tools/call',{name:'get_collaboration_entry',arguments:{}},null)).status,401);
assert.equal((await call('tools/call',{name:'get_collaboration_entry',arguments:{path:'outside'}})).body.result.isError,true);
for(const tool of inventory.filter(t=>t.outputSchema)){
 assert.ok(tool.outputSchema.properties.channel,'Account identity must be declared in every typed attachment response');
 const reply=(await call('tools/call',{name:tool.name,arguments:{}})).body.result.structuredContent;
 assert.deepEqual(reply.channel,{schemaVersion:1,mcpUrl:'https://fixture.invalid/mcp',principalId:'test-owner'});
 assert.ok(Object.keys(reply).every(k=>Object.hasOwn(tool.outputSchema.properties,k)),'Response must conform to declared top-level keys');
}
const otherIdentity=(await call('tools/call',{name:'get_task_result',arguments:{taskId:'channel-check',revision:'r1'}},'another-account')).body.result.structuredContent;
assert.equal(otherIdentity.channel.principalId,'another-account');
assert.equal((await call('tools/call',{name:'get_review',arguments:{taskId:'t',revision:'r1'}},null)).status,401);
const args={taskId:'C2C-SMOKE',revision:'r1',result:'C2C-RESULT-OK\n中文✓'};
const submit=()=>call('tools/call',{name:'submit_review',arguments:args});
const first=(await submit()).body.result.structuredContent;
assert.equal(first.status,'stored');
assert.equal((await submit()).body.result.structuredContent.receipt,first.receipt);
const read=await call('tools/call',{name:'get_review',arguments:{taskId:args.taskId,revision:'r1'}});
assert.equal(read.body.result.structuredContent.result,args.result);
assert.equal(read.body.result.structuredContent.receipt,first.receipt);
const conflict=await call('tools/call',{name:'submit_review',arguments:{...args,result:'different'}});
assert.equal(conflict.body.result.structuredContent.status,'conflict');
assert.equal(conflict.body.result.isError,true);
assert.equal((await call('tools/call',{name:'get_review',arguments:{taskId:args.taskId,revision:'r1'}},'different-user')).body.result.structuredContent.status,'not_found');
assert.equal((await call('tools/call',{name:'get_review',arguments:{taskId:args.taskId,revision:'r2'}})).body.result.structuredContent.status,'not_found');
assert.equal((await call('tools/call',{name:'submit_review',arguments:{...args,userId:'other'}})).body.result.isError,true);
console.log('PASS: 12 checks; exact Unicode roundtrip, persistent receipt, conflict, auth, user isolation, missing revision, validation. Local SQLite adapter only, not a live Chat/Codex integration test.');

assert.equal((await call('server/discover')).body.result.resultType,'complete');
assert.equal((await call('events/list')).body.result.events[0].name,'review.submitted');
assert.equal((await call('events/subscribe',{})).body.error.data.reason,'delivery_not_enabled');
assert.equal((await call('events/subscribe',{},null)).status,401);
console.log('PASS: 4 discovery-only checks. No callbacks sent or secrets stored.');

for (const [label,text] of [['ascii','a'.repeat(1048576)],['unicode','中'.repeat(349525)+'a'],['escapes','\u0000'.repeat(1048576)]]) {
 const args={taskId:'LIMIT-'+label,revision:'r1',result:text};
 const put=await call('tools/call',{name:'submit_review',arguments:args});
 assert.equal(put.status,200); assert.equal(put.body.result.structuredContent.status,'stored');
 const get=await call('tools/call',{name:'get_review',arguments:{taskId:args.taskId,revision:'r1'}});
 assert.equal(get.body.result.structuredContent.result,text);
 assert.equal(Buffer.byteLength(text),1048576);
 const reject=await call('tools/call',{name:'submit_review',arguments:{...args,revision:'over',result:text+'a'}});
 assert.equal(reject.body.result.isError,true);
}
console.log('PASS: 1MiB ASCII, Unicode, JSON control-character roundtrips and 1MiB+1 rejection.');

const manifest=(await call('tools/call',{name:'get_test_file_manifest',arguments:{}})).body.result.structuredContent;
assert.equal(manifest.sizeBytes,15728640);
const {createHash}=await import('node:crypto');
const hash=createHash('sha256');let total=0;
for(let offset=0;offset<manifest.sizeBytes;offset+=manifest.maxChunkBytes){
 const row=(await call('tools/call',{name:'read_test_file_chunk',arguments:{fileId:manifest.fileId,offset,length:manifest.maxChunkBytes}})).body.result.structuredContent;
 const data=Buffer.from(row.dataBase64,'base64');
 assert.equal(data.length,row.length);assert.equal(createHash('sha256').update(data).digest('hex'),row.chunkSha256);
 assert.equal(row.offset,offset);assert.equal(row.nextOffset,offset+data.length);assert.equal(row.eof,row.nextOffset===manifest.sizeBytes);
 hash.update(data);total+=data.length;
}
assert.equal(total,manifest.sizeBytes);assert.equal(hash.digest('hex'),manifest.sha256);
for(const [offset,length] of [[-1,1],[0,0],[0,262145],[15728641,1],[0.5,1]])assert.equal((await call('tools/call',{name:'read_test_file_chunk',arguments:{fileId:manifest.fileId,offset,length}})).body.result.isError,true);
assert.equal((await call('tools/call',{name:'get_test_file_manifest',arguments:{}},null)).status,401);
const last=(await call('tools/call',{name:'read_test_file_chunk',arguments:{fileId:manifest.fileId,offset:15728635,length:10}})).body.result.structuredContent;assert.equal(last.length,5);assert.equal(last.eof,true);
const eof=(await call('tools/call',{name:'read_test_file_chunk',arguments:{fileId:manifest.fileId,offset:15728640,length:1}})).body.result.structuredContent;assert.equal(eof.length,0);assert.equal(eof.eof,true);
console.log('PASS: synthetic file full 15MiB / 60 chunks decoded with chunk hashes and aggregate SHA-256, bounds and auth. Local handler test, not Chat receipt.');

for(const [name,type,mime] of [['read_test_image','image','image/png'],['read_test_audio','audio','audio/wav']]){
 const value=(await call('tools/call',{name,arguments:{}})).body.result;
 assert.equal(value.content.length,1);assert.equal(value.content[0].type,type);assert.equal(value.content[0].mimeType,mime);
 const data=Buffer.from(value.content[0].data,'base64');assert.ok(data.length>1000);
 if(type==='audio')assert.equal(data.subarray(0,4).toString(),'RIFF');else assert.equal(data.subarray(1,4).toString(),'PNG');
 assert.equal((await call('tools/call',{name,arguments:{}},null)).status,401);
 assert.equal((await call('tools/call',{name,arguments:{path:'/secret'}})).body.result.isError,true);
}
console.log('PASS: typed image/audio content, bytes and authentication; no transcript/caption in returned metadata. Does not prove recipient sensory perception.');
const invoke=async(name,args,user='test-owner')=>(await call('tools/call',{name,arguments:args},user)).body.result;
const assignment={taskId:'ASSIGNMENT-SMOKE',revision:'r1',kind:'review',goal:'Review discount calculation',context:'Synthetic sample only',criteria:['price=100 rate=0.2 should return 80'],baseVersion:'sample-v0',targetVersion:'sample-v1',changedPaths:['src/price.js','missing.txt'],focusPaths:['src/price.js'],navigation:'src/price.js: implementation; docs/rules.md: supplementary rule; missing.txt: not supplied',files:[{path:'src/price.js',content:'export function discountedPrice(price, rate) {\n  return price - rate;\n}\n'},{path:'docs/rules.md',content:'rate is a fraction: 0.2 means twenty percent.\nResult is price * (1 - rate).\n'}]};
const published=(await invoke('publish_assignment',assignment)).structuredContent;assert.equal(published.status,'stored');
const reordered=Object.fromEntries(Object.entries(assignment).reverse());assert.equal((await invoke('publish_assignment',reordered)).structuredContent.assignmentReceipt,published.assignmentReceipt);
assert.equal((await invoke('publish_assignment',{...assignment,goal:'Changed'})).structuredContent.status,'conflict');
const details=(await invoke('get_assignment',{taskId:assignment.taskId,revision:'r1'})).structuredContent;assert.deepEqual(details.unprovidedPaths,['missing.txt']);assert.equal('content' in details.files[0],false);
const scope={taskId:assignment.taskId,revision:'r1',path:'src/price.js'};
const material=(await invoke('read_material',{...scope,startLine:2,endLine:2})).structuredContent;assert.equal(material.content,'  return price - rate;');assert.equal(material.nextStartLine,3);assert.equal(material.assignmentReceipt,published.assignmentReceipt);
assert.equal((await invoke('read_material',{...scope,path:'missing.txt'})).structuredContent.status,'material_not_provided');
assert.equal((await invoke('get_assignment',{taskId:assignment.taskId,revision:'r1'},'other-user')).structuredContent.status,'not_found');
for(const p of ['/etc/passwd','../x','C:/x','a\\b','a//b','.env','a/./b'])assert.equal((await invoke('publish_assignment',{...assignment,revision:'bad',files:[{path:p,content:'x'}]})).isError,true);
assert.equal((await invoke('publish_assignment',{...assignment,revision:'dup',files:[assignment.files[0],assignment.files[0]]})).isError,true);
assert.equal((await invoke('publish_assignment',{...assignment,revision:'bigline',files:[{path:'a.txt',content:'中'.repeat(2731)}]})).isError,true);
const resultArgs={taskId:assignment.taskId,revision:'r1',assignmentReceipt:published.assignmentReceipt,status:'completed',summary:'Found incorrect discount formula in the reviewed sample.',findings:[{severity:'error',path:'src/price.js',startLine:2,message:'Use price*(1-rate). Current sample returns99.8 rather than80.'}],materialsRead:published.files.map(f=>({path:f.path,sha256:f.sha256})),limitations:['Only supplied synthetic files were reviewed. missing.txt was not inspected.'],requests:[]};
assert.equal((await invoke('submit_task_result',{...resultArgs,assignmentReceipt:crypto.randomUUID()})).structuredContent.status,'assignment_mismatch');
assert.equal((await invoke('submit_task_result',{...resultArgs,materialsRead:[{path:'src/price.js',sha256:'0'.repeat(64)}]})).structuredContent.status,'material_mismatch');
const savedResult=(await invoke('submit_task_result',resultArgs)).structuredContent;assert.equal(savedResult.status,'stored');assert.equal((await invoke('submit_task_result',resultArgs)).structuredContent.receipt,savedResult.receipt);
assert.equal((await invoke('submit_task_result',{...resultArgs,summary:'different'})).structuredContent.status,'conflict');
assert.equal((await invoke('get_task_result',{taskId:assignment.taskId,revision:'r1'})).structuredContent.result.summary,resultArgs.summary);
assert.equal((await invoke('get_task_result',{taskId:assignment.taskId,revision:'r1'},'other-user')).structuredContent.status,'not_found');
assert.equal((await invoke('get_review',{taskId:assignment.taskId,revision:'r1'})).structuredContent.status,'not_found');
const newVersion=await invoke('publish_assignment',{...assignment,revision:'r2',files:[{path:'empty.txt',content:''},{path:'many.txt',content:Array(20).fill('中'.repeat(2000)).join('\n')}]});assert.equal(newVersion.structuredContent.status,'stored');
const empty=(await invoke('read_material',{taskId:assignment.taskId,revision:'r2',path:'empty.txt'})).structuredContent;assert.equal(empty.totalLines,0);assert.equal(empty.content,'');assert.equal(empty.nextStartLine,null);
let line=1,restored=[];while(line!==null){const page=(await invoke('read_material',{taskId:assignment.taskId,revision:'r2',path:'many.txt',startLine:line})).structuredContent;assert.ok(page.returnedBytes<=65536);restored.push(page.content);line=page.nextStartLine;}
assert.equal(restored.join('\n'),Array(20).fill('中'.repeat(2000)).join('\n'));
const needs={...resultArgs,revision:'r2',assignmentReceipt:newVersion.structuredContent.assignmentReceipt,status:'needs_materials',findings:[],materialsRead:[],requests:['Please supply src/price.js for r2.']};assert.equal((await invoke('submit_task_result',needs)).structuredContent.status,'stored');assert.equal((await invoke('submit_task_result',{...needs,status:'completed',requests:[]})).structuredContent.status,'conflict');
assert.equal((await invoke('read_material',scope)).structuredContent.content,assignment.files[0].content);
console.log('PASS: assignment flow, exact paths, stable retry/conflict, user isolation, receipt/hash binding, missing materials, pagination, empty files and immutable supplement workflow.');

assert.equal((await invoke('publish_assignment',{...assignment,revision:'badunicode',files:[{path:'a.txt',content:String.fromCharCode(0xD800)}]})).isError,true);
const directText='DO_NOT_STORE_THIS_FILE_BODY';
const directHash=createHash('sha256').update(directText).digest('hex');
const ext={...assignment,taskId:'EXTERNAL-TEST',materialMode:'external',workspaceId:'synthetic-local-workspace',files:[{path:'src/price.js',sha256:directHash,sizeBytes:15728640,totalLines:1}]};
const extSaved=(await invoke('publish_assignment',ext)).structuredContent;
assert.equal(extSaved.status,'stored');assert.equal(extSaved.files[0].verification,'submitter_declared_hash');
assert.equal((await invoke('publish_assignment',ext)).structuredContent.assignmentReceipt,extSaved.assignmentReceipt);
assert.equal((await invoke('publish_assignment',{...ext,revision:'body',files:[{path:'src/price.js',content:directText}]})).structuredContent.status,'invalid_arguments');
const {workspaceId:unusedWorkspace,...missingWorkspace}=ext;assert.equal((await invoke('publish_assignment',{...missingWorkspace,revision:'missing-ws'})).structuredContent.status,'invalid_arguments');
const extRead=(await invoke('get_assignment',{taskId:ext.taskId,revision:'r1'})).structuredContent;assert.equal(extRead.materialMode,'external');assert.equal('content' in extRead.files[0],false);
const extMaterial=(await invoke('read_material',{taskId:ext.taskId,revision:'r1',path:'docs/rules.md'})).structuredContent;
assert.equal(extMaterial.status,'material_not_provided');assert.equal(extMaterial.workspaceId,ext.workspaceId);assert.equal('content' in extMaterial,false);
const extResult={...resultArgs,taskId:ext.taskId,assignmentReceipt:extSaved.assignmentReceipt,findings:[],materialsRead:[{path:'src/price.js',sha256:directHash,source:'direct',totalLines:1}]};
assert.equal((await invoke('submit_task_result',{...extResult,materialsRead:[{path:'src/price.js',sha256:directHash}]})).structuredContent.status,'invalid_arguments');
assert.equal((await invoke('submit_task_result',{...extResult,materialsRead:[{path:'src/price.js',sha256:'b'.repeat(64),source:'direct'}]})).structuredContent.status,'material_mismatch');
assert.equal((await invoke('submit_task_result',{...extResult,materialsRead:[{path:'docs/rules.md',sha256:'a'.repeat(64),source:'local_reader'}]})).structuredContent.status,'invalid_arguments');
assert.equal((await invoke('submit_task_result',{...extResult,materialsRead:[{path:'docs/rules.md',sha256:'a'.repeat(64),source:'direct'}]})).structuredContent.status,'material_mismatch');
assert.equal((await invoke('submit_task_result',{...extResult,findings:[{severity:'error',path:'unread.md',message:'No evidence'}]})).structuredContent.status,'material_mismatch');
assert.equal((await invoke('submit_task_result',extResult,'other-user')).structuredContent.status,'not_found');
const extOutcome=(await invoke('submit_task_result',extResult)).structuredContent;assert.equal(extOutcome.status,'stored');
assert.equal((await invoke('submit_task_result',extResult)).structuredContent.receipt,extOutcome.receipt);
assert.ok(!JSON.stringify(sqlite.prepare('SELECT * FROM reviews WHERE task_id=?').all('assignment:'+ext.taskId)).includes(directText));
const second=(await invoke('publish_assignment',{...ext,revision:'needs',files:[]})).structuredContent;
const missing={...extResult,revision:'needs',assignmentReceipt:second.assignmentReceipt,status:'needs_materials',materialsRead:[],requests:['docs/rules.md lines 2-2: need the discount rule']};
assert.equal((await invoke('submit_task_result',missing)).structuredContent.status,'stored');
assert.equal((await invoke('get_task_result',{taskId:ext.taskId,revision:'needs'})).structuredContent.result.requests[0],missing.requests[0]);
const rule='Discount is twenty percent.';const ruleHash=createHash('sha256').update(rule).digest('hex');
const third=(await invoke('publish_assignment',{...ext,revision:'supplied',files:[...ext.files,{path:'docs/rules.md',sha256:ruleHash,sizeBytes:Buffer.byteLength(rule),totalLines:1}]})).structuredContent;
const completed={...extResult,revision:'supplied',assignmentReceipt:third.assignmentReceipt,materialsRead:[...extResult.materialsRead,{path:'docs/rules.md',sha256:ruleHash,source:'direct',totalLines:1}]};
assert.equal((await invoke('submit_task_result',completed)).structuredContent.status,'stored');
assert.equal((await invoke('get_task_result',{taskId:ext.taskId,revision:'supplied'})).structuredContent.result.status,'completed');
assert.equal((await invoke('get_task_result',{taskId:ext.taskId,revision:'needs'})).structuredContent.result.status,'needs_materials');
assert.equal((await invoke('submit_task_result',{...completed,findings:[{severity:'error',path:'src/price.js',startLine:999,message:'Invalid declared bound'}]})).structuredContent.status,'material_mismatch');
console.log('PASS: external metadata stores no file body; retired local-read evidence rejected; needs_materials retained; Codex-supplied new revision completed with exact receipt/hash/source checks. Local route checks only.');
sqlite.close();
