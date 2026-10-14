import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const entry=new Function('return ('+await readFile(new URL('./job-entry.js',import.meta.url),'utf8')+')')();
function fixture({resume=false,oversized=false}={}){
 const commands=[],bridges=[],patches=[];
 const packet={attachments:{},connection:{toolPrefix:'test_'}};
 const job={packet,statePath:'C:/test/state.json',resume:resume?{delivery:'sent'}:null};
 const core='({bindHost:()=>({}),bindExecution:()=>({}),delegateAndWait:async(packet,host,options)=>{await options.checkpoint({delivery:"sent"});await options.attachments.io.appendChunk({},'+JSON.stringify({dataBase64:'a'.repeat(oversized?65000:55000)})+');return {status:"completed",didRequestModel:false};}})';
 const tools={exec_command:async args=>{commands.push(args.cmd);return {exit_code:0,output:args.cmd.startsWith('Get-Content')?(args.cmd.includes('attachment-host-runtime.js')?'({bind:()=>({})})':core):JSON.stringify(args.cmd.includes("'prepare'")?{packetPath:'C:/test/packet.json'}:job)};},apply_patch:async p=>{patches.push(p);return {};},mcp__node_repl__js:async args=>{bridges.push(args.code);return {content:[{type:'text',text:args.code.includes('appendChunk')?'{}':'{"ready":true}'}]};}};
 const options={scriptRoot:"C:/tool's/scripts",outputRoot:'C:/test/out',deliveryAuthorized:true,...(resume?{packetPath:'C:/test/packet.json'}:{requestPath:'C:/test/request.json'})};
 return {tools,options,commands,bridges,patches};
}
test('one program loads dependencies internally, initializes file IO and records only its outcome',async()=>{
 const f=fixture(),result=await entry.run(f.tools,[],f.options);
 assert.equal(result.outcome.status,'completed');assert.equal(result.metrics.waitProgramModelAPICalls,0);
 assert.equal(f.commands.filter(c=>c.includes("'prepare'")).length,1);assert.ok(f.commands.every(c=>c.includes("tool''s")));
 assert.equal(f.bridges.length,2);assert.ok(f.bridges.every(c=>entry.utf8Bytes(c)<=64000));assert.equal(f.patches.length,2);
});
test('resume uses the existing packet and never prepares a second task',async()=>{
 const f=fixture({resume:true});await entry.run(f.tools,[],f.options);assert.equal(f.commands.filter(c=>c.includes("'prepare'")).length,0);
});
test('an oversized local file bridge is refused before invoking the tool',async()=>{
 const f=fixture({oversized:true});await assert.rejects(entry.run(f.tools,[],f.options),/LOCAL_FILE_BRIDGE_CODE_LIMIT/);assert.equal(f.bridges.length,1);
 assert.equal(entry.utf8Bytes('中文🙂'),10);
});
