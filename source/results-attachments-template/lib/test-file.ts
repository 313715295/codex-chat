// Immutable synthetic bytes only. No local paths, user files, storage, or network access.
export const FILE_ID='synthetic-15mib-v1';
export const FILE_SIZE=15*1024*1024;
export const MAX_CHUNK=256*1024;
export function bytesAt(offset:number,length:number):Uint8Array {
 const out=new Uint8Array(length);const end=offset+length;
 for(let block=Math.floor(offset/4096);block*4096<end;block++) {
  let x=(0x9e3779b9 ^ block)>>>0;
  for(let j=0;j<4096;j++) {x^=x<<13;x^=x>>>17;x^=x<<5;const pos=block*4096+j;if(pos>=offset&&pos<end)out[pos-offset]=x&255;}
 }
 return out;
}
export async function sha256(data:Uint8Array) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(data).buffer))).map(b=>b.toString(16).padStart(2,'0')).join('');}
export const FILE_SHA='61aa9c06b37677ed80a1204091e50da43835da923640180bb3988de1a0478d30';
export const fileTools=[
 {name:'get_test_file_manifest',description:'Read metadata for one immutable synthetic 15 MiB test file. No project files. Metadata is not proof of download. Do not print or send full chunks into the model context.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},
 {name:'read_test_file_chunk',description:'Read a bounded raw-byte range from the synthetic test file as base64, not extracted text. No database. First test a small block. Full transfer requires programmatic tool-result-to-file handling; do not relay 20 MiB of base64 through model context. Verify decoded bytes and SHA-256 in the receiving container.',inputSchema:{type:'object',properties:{fileId:{type:'string',enum:[FILE_ID]},offset:{type:'integer',minimum:0,maximum:FILE_SIZE},length:{type:'integer',minimum:1,maximum:MAX_CHUNK}},required:['fileId','offset','length'],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}}
];
export async function readTestFile(name:string,args:unknown) {
 if(!args||typeof args!=='object'||Array.isArray(args))return {status:'invalid_arguments'};
 const a=args as Record<string,unknown>;
 if(name==='get_test_file_manifest') {
  if(Object.keys(a).length)return {status:'invalid_arguments'};
  return {status:'available',fileId:FILE_ID,fileName:'synthetic-15MiB.bin',sizeBytes:FILE_SIZE,sha256:FILE_SHA,maxChunkBytes:MAX_CHUNK,encoding:'base64',mimeType:'application/octet-stream',synthetic:true};
 }
 if(Object.keys(a).some(k=>!['fileId','offset','length'].includes(k))||a.fileId!==FILE_ID||!Number.isInteger(a.offset)||!Number.isInteger(a.length)||Number(a.offset)<0||Number(a.offset)>FILE_SIZE||Number(a.length)<1||Number(a.length)>MAX_CHUNK)return {status:'invalid_arguments'};
 const offset=Number(a.offset);const length=Math.min(Number(a.length),FILE_SIZE-offset);const data=bytesAt(offset,length);
 let binary='';for(let i=0;i<data.length;i+=4096)binary+=String.fromCharCode(...data.subarray(i,i+4096));
 return {status:'ok',fileId:FILE_ID,offset,length,dataBase64:btoa(binary),chunkSha256:await sha256(data),nextOffset:offset+length,eof:offset+length===FILE_SIZE};
}
