// A small reusable host entry. Empty lookups, the single image continuation and
// file transfers remain inside this program; no model API or copied credentials.
(() => {
  const fail=code=>{throw Object.assign(new Error(code),{code});};
  const quote=v=>"'"+v.replaceAll("'","''")+"'";
  function utf8Bytes(s){let n=0;for(const c of s){const k=c.codePointAt(0);n+=k<128?1:k<2048?2:k<65536?3:4;}return n;}
  function json(raw){if(raw?.isError)fail('LOCAL_ATTACHMENT_IO_FAILED');try{return JSON.parse(raw.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'));}catch{fail('LOCAL_ATTACHMENT_IO_NOT_JSON');}}
  async function run(tools,inventory,options){
    const {scriptRoot,requestPath,packetPath,outputRoot,nodePath='C:/Program Files/nodejs/node.exe'}=options;
    for(const p of [scriptRoot,outputRoot,nodePath,requestPath??packetPath])if(typeof p!=='string'||!p||/[\r\n\0]/.test(p))fail('ENTRY_PATH_REQUIRED');
    if(!!requestPath===!!packetPath)fail('ONE_REQUEST_OR_PACKET_REQUIRED');
    const started=Date.now(),calls={};
    const measured=new Proxy(tools,{get(target,name){const fn=target[name];if(typeof fn!=='function')return fn;return async(...args)=>{calls[name]=(calls[name]??0)+1;return await fn(...args);};}});
    const command=async(args,max=2000)=>{
      const r=await measured.exec_command({cmd:'& '+args.map(quote).join(' '),max_output_tokens:max});
      if(r.exit_code!==0||r.session_id)fail(/^[A-Z][A-Z0-9_]+$/.test(r.output?.trim()??'')?r.output.trim():'LOCAL_PREPARATION_FAILED');
      return r.output;
    };
    const preparePath=scriptRoot.replaceAll('\\','/')+'/prepare.mjs';
    let selected=packetPath;
    if(requestPath)selected=JSON.parse(await command([nodePath,preparePath,'prepare',requestPath])).packetPath;
    const job=JSON.parse(await command([nodePath,preparePath,'load',selected],30000));
    async function readModule(name){
      const r=await measured.exec_command({cmd:'Get-Content -LiteralPath '+quote(scriptRoot+'/'+name)+' -Raw',max_output_tokens:22000});
      if(r.exit_code!==0||r.session_id)fail('ENTRY_MODULE_READ_FAILED');return new Function('return (\n'+r.output+'\n)')();
    }
    const api=await readModule('host-runtime.js'),attachment=job.packet.attachments?await readModule('attachment-host-runtime.js'):null;
    const uri='file:///'+encodeURI((scriptRoot+'/attachment-local.mjs').replaceAll('\\','/')).replaceAll('#','%23').replaceAll('?','%3F');
    if(attachment){const init=await measured.mcp__node_repl__js({code:'var collaborationFiles = await import('+JSON.stringify(uri)+'); var collaborationFS = await import("node:fs/promises"); await collaborationFS.mkdir('+JSON.stringify(outputRoot)+',{recursive:true}); nodeRepl.write({ready:true});',title:'准备任务文件传输'});if(init.isError)fail('LOCAL_ATTACHMENT_IO_FAILED');}
    const io={};
    for(const method of ['describe','readChunk','startDownload','appendChunk','finishDownload','cancelDownload'])io[method]=async(...args)=>{
      const code='nodeRepl.write(JSON.stringify(await collaborationFiles['+JSON.stringify(method)+'](...'+JSON.stringify(args)+')));';
      if(utf8Bytes(code)>64000)fail('LOCAL_FILE_BRIDGE_CODE_LIMIT');
      return json(await measured.mcp__node_repl__js({code,title:'程序传输原文件并核验'}));
    };
    let sent=job.resume?.delivery==='sent',exported=job.resume?.imageExport?.delivery==='sent';
    const checkpoint=async s=>{
      const patch='*** Begin Patch\n*** Add File: '+job.statePath.replaceAll('\\','/')+'\n+'+JSON.stringify(s,null,2).split('\n').join('\n+')+'\n*** End Patch';
      const r=await measured.apply_patch(patch);if(r?.isError)fail('CHECKPOINT_NOT_SAVED');
      if(!sent&&s.delivery==='sent'){sent=true;options.onProgress?.({stage:'sent'});}
      if(!exported&&s.imageExport?.delivery==='sent'){exported=true;options.onProgress?.({stage:'automatic-image-export'});}
    };
    const outcome=await api.delegateAndWait(job.packet,api.bindHost(measured,inventory,job.packet.connection),{
      deliveryAuthorized:options.deliveryAuthorized,resume:job.resume,timeoutMs:options.timeoutMs,pollIntervalMs:options.pollIntervalMs,
      execution:api.bindExecution(measured,{nodePath,preparePath,packetPath:selected}),checkpoint,
      ...(attachment?{attachments:{api:attachment,host:attachment.bind(measured,inventory,job.packet.connection?.toolPrefix,job.packet.connection),io,outputRoot}}:{})
    });
    const metrics={startedAt:new Date(started).toISOString(),endedAt:new Date().toISOString(),elapsedMs:Date.now()-started,toolCalls:calls,waitProgramModelAPICalls:0};
    const path=outputRoot.replaceAll('\\','/')+'/outcome.json';
    const saved=await measured.apply_patch('*** Begin Patch\n*** Add File: '+path+'\n+'+JSON.stringify({outcome,metrics},null,2).split('\n').join('\n+')+'\n*** End Patch');
    if(saved?.isError)fail('OUTCOME_NOT_SAVED');
    return {outcome,metrics,recordPath:path};
  }
  return {run,utf8Bytes};
})()
