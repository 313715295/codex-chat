import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {prepareDelegation} from './prepare.mjs';
import * as io from './attachment-local.mjs';
import {createAttachmentService,CHUNK_BYTES} from '../results-attachments-template/lib/attachment-core.ts';
const here=path.dirname(fileURLToPath(import.meta.url));
const core=new Function('return (\n'+await fs.readFile(path.join(here,'host-runtime.js'),'utf8')+'\n)')();
const api=new Function('return (\n'+await fs.readFile(path.join(here,'attachment-host-runtime.js'),'utf8')+'\n)')();
const threadId='11111111-1111-4111-8111-111111111111',receipt='22222222-2222-4222-8222-222222222222';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t,{changeEvidence=false,wrongResultReceipt=false,withhold=false,receiveOnly=false,outputAsInput=false}={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'collaboration-attachment-'));
  t.after(async()=>{const actual=await fs.realpath(root),parent=await fs.realpath(os.tmpdir());assert.equal(path.dirname(actual).toLowerCase(),parent.toLowerCase());assert.ok(path.basename(actual).startsWith('collaboration-attachment-'));await fs.rm(actual,{recursive:true});});
  const output=path.join(root,'out');await fs.mkdir(output);
  const bytes=Buffer.alloc(CHUNK_BYTES+17);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
  await fs.writeFile(path.join(root,'input.bin'),bytes);
  const profile={schemaVersion:1,targetThreadId:threadId,targetTitle:'Fixture',authorizedRoot:root,workspaceId:'test-root'};
  const packet=prepareDelegation({taskId:'attachment-test',goal:'Return these original bytes',...(receiveOnly?{receiveAttachments:true}:{attachments:[{path:'input.bin',mimeType:'application/octet-stream'}]})},profile,{attachmentMetadata:[{path:'input.bin',...await io.describe(root,'input.bin')}]});
  const objects=new Map();let serial=0,time=Date.now(),result=null,sendCount=0,beginCount=0;
  const store={get:async k=>{const v=objects.get(k);return v?{bytes:v.bytes.slice(),etag:v.etag}:null;},put:async(k,b,c)=>{const v=objects.get(k);if(c?.absent&&v||c?.etag&&v?.etag!==c.etag)return false;objects.set(k,{bytes:b.slice(),etag:String(++serial)});return true;},remove:async ks=>ks.forEach(k=>objects.delete(k)),list:async prefix=>({keys:[...objects.keys()].filter(k=>k.startsWith(prefix))})};
  const service=createAttachmentService({store,now:()=>time,assignment:async()=>({receipt})});
  const methods={begin_attachment_upload:'begin',upload_attachment_chunk:'uploadChunk',finish_attachment_upload:'finish',get_attachment:'get',read_attachment_chunk:'readChunk',delete_attachment:'remove'};
  const host=Object.fromEntries(Object.entries(methods).map(([tool,method])=>[tool,async a=>{if(tool==='begin_attachment_upload')beginCount++;return service[method]('test-owner',a);} ]));
  const native={readThread:async()=>({thread:{id:threadId,kind:'chatgpt'}}),publishAssignment:async()=>({status:'stored',taskId:packet.assignment.taskId,materialMode:'external',assignmentReceipt:receipt}),
    getTaskResult:async a=>result??{status:'not_found',...a},sendMessage:async a=>{sendCount++;if(!receiveOnly)assert.ok(a.prompt.includes('read_attachment_chunk'));if(!withhold)await finish();return {isError:false,content:[]};}};
  async function finish() {
    const input=(await service.list('test-owner',{taskId:'attachment-test',revision:'r1'})).attachments.find(f=>f.purpose==='input');
    const bound={taskId:'attachment-test',revision:'r1'};
    if(!receiveOnly){
      let offset=0,parts=[];while(offset<input.sizeBytes){const c=await host.read_attachment_chunk({...bound,attachmentId:input.attachmentId,offset,maxBytes:32768});parts.push(Buffer.from(c.dataBase64,'base64'));offset=c.nextOffset;}
      assert.equal(digest(Buffer.concat(parts)),digest(bytes));
    }else assert.equal(input,undefined);
    const returned=await service.begin('test-owner',{taskId:'attachment-test',revision:'r1',assignmentReceipt:receipt,requestKey:'result-1',purpose:'result',fileName:'returned.bin',mimeType:'application/octet-stream',sizeBytes:bytes.length,sha256:digest(bytes)});
    const rb={...bound,attachmentId:returned.attachmentId};
    for(let offset=0;offset<bytes.length;offset+=CHUNK_BYTES){const c=bytes.subarray(offset,offset+CHUNK_BYTES);await host.upload_attachment_chunk({...rb,offset,dataBase64:c.toString('base64'),sha256:digest(c)});}
    await host.finish_attachment_upload(rb);
    const materialsRead=receiveOnly?(outputAsInput?[{path:'returned.bin',sha256:digest(bytes),source:'attachment',attachmentId:returned.attachmentId}]:[]):[{path:'input.bin',sha256:digest(bytes),source:'attachment',attachmentId:changeEvidence?'att_'+'a'.repeat(48):input.attachmentId}];
    result={status:'found',taskId:'attachment-test',revision:'r1',receipt:'33333333-3333-4333-8333-333333333333',result:{taskId:'attachment-test',revision:'r1',assignmentReceipt:wrongResultReceipt?threadId:receipt,status:'completed',summary:'Original bytes checked',materialsRead,attachmentIds:[returned.attachmentId],findings:[{severity:'info',message:'returned.bin: '+returned.attachmentId}],limitations:['Local fixture only'],requests:[]}};
  }
  const states=[],options={deliveryAuthorized:true,now:()=>time,sleep:async ms=>{time+=ms;},checkpoint:async state=>states.push(structuredClone(state)),attachments:{api,host,io,outputRoot:output}};
  return {root,output,packet,native,host,options,states,objects,finish,counts:()=>({sendCount,beginCount})};
}
test('one entry sends actual bytes, receives original bytes, independently hashes and deletes both sides',async t=>{
  const f=await fixture(t),out=await core.delegateAndWait(f.packet,f.native,f.options);
  assert.equal(out.status,'completed');assert.equal(out.downloads.length,1);assert.equal(out.cleanup.pending.length,0);assert.equal(out.cleanup.deleted.length,2);assert.equal(out.didRequestModel,false);assert.equal(f.counts().sendCount,1);
  assert.equal(digest(await fs.readFile(out.downloads[0].path)),out.downloads[0].sha256);
  assert.equal([...f.objects.keys()].filter(k=>k.includes('/data/')).length,0);
  await assert.rejects(f.host.get_attachment({taskId:'attachment-test',revision:'r1',attachmentId:out.downloads[0].attachmentId}),e=>e.code==='attachment_deleted');
  const resumed=await core.delegateAndWait(f.packet,f.native,{...f.options,resume:out.state});
  assert.equal(resumed.status,'completed');assert.equal(resumed.downloads.length,1);assert.equal(f.counts().sendCount,1);
});
test('authorization is checked before publication, upload or sending',async t=>{
  const f=await fixture(t);await assert.rejects(core.delegateAndWait(f.packet,f.native,{...f.options,deliveryAuthorized:false}),/MESSAGE_AUTHORIZATION_REQUIRED/);assert.deepEqual(f.counts(),{sendCount:0,beginCount:0});
});
test('receive-only output with empty input evidence downloads, verifies, cleans and resumes without another message',async t=>{
  const f=await fixture(t,{receiveOnly:true}),out=await core.delegateAndWait(f.packet,f.native,f.options);
  assert.equal(out.status,'completed');assert.equal(f.packet.assignment.files.length,0);assert.equal(out.result.materialsRead.length,0);
  assert.equal(out.downloads.length,1);assert.equal(digest(await fs.readFile(out.downloads[0].path)),out.downloads[0].sha256);
  assert.equal(out.cleanup.deleted.length,1);assert.equal(out.cleanup.pending.length,0);assert.deepEqual(f.counts(),{sendCount:1,beginCount:0});
  const resumed=await core.delegateAndWait(f.packet,f.native,{...f.options,resume:out.state});
  assert.equal(resumed.status,'completed');assert.equal(f.counts().sendCount,1);
});
test('receive-only output falsely listed as an input still fails before download or success cleanup',async t=>{
  const f=await fixture(t,{receiveOnly:true,outputAsInput:true}),out=await core.delegateAndWait(f.packet,f.native,f.options);
  assert.equal(out.status,'blocked');assert.equal(out.errorCode,'RESULT_MATERIAL_MISMATCH');
  assert.equal(out.state.downloads.length,0);assert.equal(out.state.deletedAttachmentIds.length,0);
});
test('file version changed after preparation fails before any attachment upload or Chat message',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.root,'input.bin'),'changed');const out=await core.delegateAndWait(f.packet,f.native,f.options);assert.equal(out.errorCode,'FILE_CHANGED');assert.deepEqual(f.counts(),{sendCount:0,beginCount:0});
});
test('wrong result receipt or wrong attachment evidence cannot be accepted or cleaned as success',async t=>{
  for(const opts of [{changeEvidence:true},{wrongResultReceipt:true}]){const f=await fixture(t,opts),out=await core.delegateAndWait(f.packet,f.native,f.options);assert.equal(out.status,'blocked');assert.match(out.errorCode,/MISMATCH/);assert.equal(out.state.downloads.length,0);assert.equal(out.state.deletedAttachmentIds.length,0);}
});
test('timeout resumes the same uploaded files and message, then downloads and cleans without resending',async t=>{
  const f=await fixture(t,{withhold:true});const first=await core.delegateAndWait(f.packet,f.native,{...f.options,timeoutMs:20000});assert.equal(first.status,'timeout');assert.equal(first.state.delivery,'sent');assert.equal(first.state.inputAttachments.length,1);
  await f.finish();const resumed=await core.delegateAndWait(f.packet,f.native,{...f.options,resume:first.state});assert.equal(resumed.status,'completed');assert.equal(f.counts().sendCount,1);assert.equal(resumed.cleanup.pending.length,0);
});
test('saved original changed after a result is completed is detected on resume',async t=>{
  const f=await fixture(t),first=await core.delegateAndWait(f.packet,f.native,f.options);await fs.writeFile(first.downloads[0].path,'changed');const resumed=await core.delegateAndWait(f.packet,f.native,{...f.options,resume:first.state});assert.equal(resumed.status,'blocked');assert.equal(resumed.errorCode,'SAVED_DOWNLOAD_CHANGED');assert.equal(f.counts().sendCount,1);
});
test('missing attachment transport stops before host effects',async t=>{
  const f=await fixture(t);await assert.rejects(core.delegateAndWait(f.packet,f.native,{deliveryAuthorized:true}),/ATTACHMENT_TRANSPORT_REQUIRED/);assert.equal(f.counts().sendCount,0);
});
test('cleanup failure remains explicit and resumes deletion without another message or download',async t=>{
  const f=await fixture(t),remove=f.host.delete_attachment;let failOnce=true;
  f.host.delete_attachment=async a=>{if(failOnce){failOnce=false;throw Object.assign(new Error('fixture cleanup failure'),{code:'fixture_cleanup_failure'});}return remove(a);};
  const first=await core.delegateAndWait(f.packet,f.native,f.options);assert.equal(first.status,'completed');assert.equal(first.cleanup.pending.length,1);assert.equal(first.cleanup.deleted.length,1);
  const resumed=await core.delegateAndWait(f.packet,f.native,{...f.options,resume:first.state});assert.equal(resumed.cleanup.pending.length,0);assert.equal(resumed.cleanup.deleted.length,2);assert.equal(f.counts().sendCount,1);assert.equal(resumed.downloads.length,1);
});
test('attachment expiry caps waiting without another upload, publication or message on resume',async t=>{
  const f=await fixture(t,{withhold:true});const first=await core.delegateAndWait(f.packet,f.native,{...f.options,timeoutMs:1});
  const expiry=Date.parse(first.state.inputAttachments[0].expiresAt);
  const resumed=await core.delegateAndWait(f.packet,f.native,{...f.options,resume:first.state,now:()=>expiry});assert.equal(resumed.status,'attachments_expired');assert.equal(f.counts().sendCount,1);assert.equal(f.counts().beginCount,1);
});
