// Evaluate this pure expression in functions.exec. Bytes stay in program/tool IO.
(() => {
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  function unpack(value) {
    for (let i = 0; i < 5; i++) {
      if (value?.isError) fail(value.structuredContent?.status ?? 'ATTACHMENT_TOOL_FAILED');
      if (typeof value?.status === 'string') return value;
      if (value?.structuredContent) { value = value.structuredContent; continue; }
      const texts = value?.content?.filter(c => c.type === 'text');
      if (texts?.length === 1) { try { value = JSON.parse(texts[0].text); continue; } catch {} }
      fail('INVALID_TOOL_RESULT');
    }
    fail('INVALID_TOOL_RESULT');
  }
  function bind(tools, inventory, prefix = 'mcp__codex_apps__codex_chat_',connection) {
    const names = new Set(inventory.map(t => t.name)), host = {};
    for (const suffix of ['begin_attachment_upload', 'upload_attachment_chunk', 'finish_attachment_upload', 'get_attachment', 'read_attachment_chunk', 'delete_attachment', 'list_task_attachments']) {
      const name = prefix + suffix;
      if(suffix==='list_task_attachments'&&!names.has(name))continue;
      if (!names.has(name) || typeof tools[name] !== 'function') fail('MISSING_ATTACHMENT_TOOL:' + suffix);
      host[suffix] = async args => {
        const data=unpack(await tools[name](args)),c=data.channel;
        if(connection&&(!c||c.schemaVersion!==1||c.mcpUrl!==connection.mcpUrl||c.principalId!==connection.principalId))fail('CONNECTED_CHANNEL_IDENTITY_MISMATCH');
        return data;
      };
    }
    host.toolPrefix=prefix;return host;
  }
  async function upload(host, io, request) {
    const metadata = await io.describe(request.root, request.relativePath);
    if ((request.expectedSha256 !== undefined && request.expectedSha256 !== metadata.sha256) ||
        (request.expectedSizeBytes !== undefined && request.expectedSizeBytes !== metadata.sizeBytes)) fail('FILE_CHANGED');
    const started = await host.begin_attachment_upload({ ...request.binding, requestKey: request.requestKey, purpose: request.purpose, ...metadata, mimeType: request.mimeType });
    if (started.sha256 !== metadata.sha256 || started.sizeBytes !== metadata.sizeBytes || started.assignmentReceipt !== request.binding.assignmentReceipt) fail('UPLOAD_BINDING_MISMATCH');
    const bound = { taskId: request.binding.taskId, revision: request.binding.revision, attachmentId: started.attachmentId };
    if (!started.readable) for (let offset = 0; offset < metadata.sizeBytes; offset += started.chunkBytes) {
      const chunk = await io.readChunk(request.root, request.relativePath, metadata.sha256, offset);
      const reply = await host.upload_attachment_chunk({ ...bound, offset, dataBase64: chunk.dataBase64, sha256: chunk.sha256 });
      if (reply.sha256 !== chunk.sha256 || reply.sizeBytes !== chunk.sizeBytes || reply.offset !== offset || reply.attachmentId !== started.attachmentId) fail('UPLOAD_CHUNK_MISMATCH');
    }
    const finished = await host.finish_attachment_upload(bound);
    if (!finished.readable || finished.sha256 !== metadata.sha256 || finished.sizeBytes !== metadata.sizeBytes) fail('UPLOAD_INTEGRITY_MISMATCH');
    return finished;
  }
  async function download(host, io, bound, outputRoot, {chunkBytes=40960,parallelReads=3}={}) {
    if(!Number.isSafeInteger(chunkBytes)||chunkBytes<1||chunkBytes>40960||!Number.isSafeInteger(parallelReads)||parallelReads<1||parallelReads>3)fail('INVALID_DOWNLOAD_BUDGET');
    const metadata = await host.get_attachment(bound);
    if (!metadata.readable || metadata.attachmentId !== bound.attachmentId || metadata.taskId !== bound.taskId || metadata.revision !== bound.revision) fail('DOWNLOAD_BINDING_MISMATCH');
    const state = await io.startDownload(outputRoot, metadata);
    try {
      let offset = 0,scheduled=0;
      const pending=new Map();
      function fill(){while(pending.size<parallelReads&&scheduled<metadata.sizeBytes){
        const at=scheduled;scheduled+=chunkBytes;
        const promise=Promise.resolve().then(()=>host.read_attachment_chunk({...bound,offset:at,maxBytes:chunkBytes}));
        promise.catch(()=>{});pending.set(at,promise);
      }}
      fill();
      while (offset < metadata.sizeBytes) {
        // At most three read-only requests; writes stay ordered. The JS bridge
        // retains its strict 64,000-byte review budget.
        const chunk=await pending.get(offset);pending.delete(offset);
        if (chunk.sha256 !== metadata.sha256 || chunk.attachmentId !== bound.attachmentId || chunk.sizeBytes !== metadata.sizeBytes || chunk.offset !== offset || chunk.returnedBytes < 1 || chunk.nextOffset !== offset + chunk.returnedBytes) fail('DOWNLOAD_CHUNK_MISMATCH');
        if(chunk.returnedBytes!==Math.min(chunkBytes,metadata.sizeBytes-offset))fail('DOWNLOAD_CHUNK_LENGTH_MISMATCH');
        fill();
        const saved = await io.appendChunk(state, chunk);
        if (saved.nextOffset !== chunk.nextOffset) fail('DOWNLOAD_OFFSET_MISMATCH');
        offset = saved.nextOffset;
        if (chunk.eof !== (offset === metadata.sizeBytes)) fail('DOWNLOAD_EOF_MISMATCH');
      }
      const file = await io.finishDownload(state);
      if (file.sha256 !== metadata.sha256 || file.sizeBytes !== metadata.sizeBytes) fail('DOWNLOAD_INTEGRITY_MISMATCH');
      return { ...metadata, ...file };
    } catch (error) { try { await io.cancelDownload(state); } catch {} throw error; }
  }
  return { bind, upload, download, unpack };
})()
