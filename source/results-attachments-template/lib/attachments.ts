import { env } from 'cloudflare:workers';
import { createAttachmentService, AttachmentError, type AttachmentStore } from './attachment-core';
import { getReview } from './reviews';
import { attachmentTools } from './attachment-tools';
export { attachmentTools };
function service() {
  const bucket = env.BUCKET;
  if (!bucket) throw new AttachmentError('attachment_storage_unavailable');
  const store: AttachmentStore = {
    async get(key) { const object = await bucket.get(key); return object ? { bytes: new Uint8Array(await object.arrayBuffer()), etag: object.etag } : null; },
    async put(key, bytes, condition) {
      const value = await bucket.put(key, bytes as ArrayBufferView, condition?.absent ? { onlyIf: { etagDoesNotMatch: '*' } } : condition?.etag ? { onlyIf: { etagMatches: condition.etag } } : {});
      return value !== null;
    },
    async remove(keys) { if (keys.length) await bucket.delete(keys); },
    async list(prefix, cursor) { const page = await bucket.list({ prefix, limit: 32, ...(cursor ? { cursor } : {}) }); return { keys: page.objects.map(o => o.key), ...(page.truncated ? { cursor: page.cursor } : {}) }; },
  };
  return createAttachmentService({ store, assignment: (user, taskId, revision) => getReview(user, 'assignment:' + taskId, revision) });
}
const methods = { begin_attachment_upload: 'begin', upload_attachment_chunk: 'uploadChunk', finish_attachment_upload: 'finish', import_attachment: 'importFile', get_attachment: 'get', list_task_attachments: 'list', read_attachment_chunk: 'readChunk', preview_attachment: 'preview', delete_attachment: 'remove' } as const;
export async function getBoundAttachment(user: string, taskId: string, revision: string, attachmentId: string) {
  return service().get(user, { taskId, revision, attachmentId });
}
export async function attachmentCall(name: keyof typeof methods, user: string, args: any) {
  try {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new AttachmentError('invalid_arguments');
    const descriptor = attachmentTools.find(t => t.name === name)!;
    if (Object.keys(args).some(k => !Object.hasOwn(descriptor.inputSchema.properties, k)) || descriptor.inputSchema.required.some(k => !Object.hasOwn(args, k))) throw new AttachmentError('invalid_arguments');
    const value = await service()[methods[name]](user, args);
    if (name === 'preview_attachment') {
      const { dataBase64, contentType, ...metadata } = value as Record<string, any>;
      return { content: [{ type: contentType, data: dataBase64, mimeType: metadata.mimeType }], structuredContent: metadata };
    }
    return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
  } catch (error) {
    const value = { status: error instanceof AttachmentError ? error.code : 'attachment_storage_unavailable', ...(error instanceof AttachmentError && error.rejectedFileHost ? { rejectedFileHost: error.rejectedFileHost } : {}) };
    return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError: true };
  }
}
