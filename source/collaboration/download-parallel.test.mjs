import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import * as local from './attachment-local.mjs';
const api=new Function('return ('+await fs.readFile(new URL('./attachment-host-runtime.js',import.meta.url),'utf8')+')')();
const sha=b=>createHash('sha256').update(b).digest('hex');
async function setup(t,corrupt=false){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'parallel-download-'));
 t.after(async()=>{const actual=await fs.realpath(root);assert.equal(path.dirname(actual).toLowerCase(),(await fs.realpath(os.tmpdir())).toLowerCase());assert.ok(path.basename(actual).startsWith('parallel-download-'));await fs.rm(actual,{recursive:true});});
 const bytes=Buffer.alloc(40960*5+13);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
 const bound={taskId:'parallel',revision:'r1',attachmentId:'att_'+'a'.repeat(48)};
 const metadata={...bound,readable:true,sizeBytes:bytes.length,sha256:sha(bytes),fileName:'original.bin'};
 let active=0,maximum=0;const requested=[],finished=[],written=[];
 const host={get_attachment:async()=>metadata,read_attachment_chunk:async args=>{
  active++;maximum=Math.max(maximum,active);requested.push(args);await new Promise(r=>setTimeout(r,args.offset===0?20:1));
  active--;finished.push(args.offset);const part=bytes.subarray(args.offset,args.offset+args.maxBytes),actual=Buffer.from(part);if(corrupt&&args.offset===40960)actual[0]^=1;
  return {...metadata,offset:args.offset,returnedBytes:part.length,nextOffset:args.offset+part.length,eof:args.offset+part.length===bytes.length,dataBase64:actual.toString('base64'),chunkSha256:sha(part)};
 }};
 const io={...local,appendChunk:async(state,chunk)=>{written.push(chunk.offset);return local.appendChunk(state,chunk);}};
 return {root,bytes,bound,host,io,requested,finished,written,maximum:()=>maximum};
}
test('bounded parallel reads complete out of order but writes and full-file verification stay ordered',async t=>{
 const f=await setup(t),file=await api.download(f.host,f.io,f.bound,f.root);
 assert.equal(f.maximum(),3);assert.equal(f.requested.length,6);assert.ok(f.requested.every(a=>a.maxBytes===40960));assert.notEqual(f.finished[0],0);
 assert.deepEqual(f.written,[0,40960,81920,122880,163840,204800]);assert.deepEqual(await fs.readFile(file.path),f.bytes);assert.equal(file.sha256,sha(f.bytes));
 assert.deepEqual(await fs.readdir(f.root),['original.bin']);
});
test('corrupted parallel data cannot become a saved file and its partial file is removed',async t=>{
 const f=await setup(t,true);await assert.rejects(api.download(f.host,f.io,f.bound,f.root),/CHUNK_INTEGRITY_MISMATCH/);
 assert.ok(f.maximum()<=3);assert.deepEqual(await fs.readdir(f.root),[]);
});
