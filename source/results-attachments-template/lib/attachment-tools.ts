const key = { type: 'string', minLength: 1, maxLength: 80, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const attachmentId = { type: 'string', pattern: '^att_[a-f0-9]{48}$' };
const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });
const identity = { taskId: key, revision: key };
const bound = { ...identity, attachmentId };
const upload = { ...identity, assignmentReceipt: { type: 'string', format: 'uuid' }, requestKey: key, purpose: { type: 'string', enum: ['input', 'result'] } };
const file = { fileName: text(200), mimeType: text(150), sizeBytes: { type: 'integer', minimum: 0, maximum: 16777216 }, sha256: hash };
const schema = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const annotations = (readOnlyHint: boolean, destructiveHint = false) => ({ readOnlyHint, destructiveHint, openWorldHint: false, idempotentHint: true });
const boundary = 'Only task-authorized selected files, never secrets or an entire project. Site account and exact task/revision bind every attachment. No local directory access or conversation messages. Files expire one hour after upload begins; reads never extend expiry. Expired/deleted data is denied immediately; physical cleanup runs on access/delete, not a scheduled retention guarantee.';
const definitions = [
  { name: 'begin_attachment_upload', description: `Begin/resume a programmatic byte upload. Same requestKey and metadata return the same attachment; changed metadata conflicts. File <=16MiB; chunks 256KiB. Program reads the authorized local file, never sends large base64 through model context. ${boundary}`, inputSchema: schema({ ...upload, ...file }), annotations: annotations(false) },
  { name: 'upload_attachment_chunk', description: `Store one exact 256KiB chunk, except the last, with its SHA-256. An identical retry succeeds; changed chunk conflicts. Use programmatic tool-to-file transfer. ${boundary}`, inputSchema: schema({ ...bound, offset: { type: 'integer', minimum: 0 }, dataBase64: text(349528), sha256: hash }), annotations: annotations(false) },
  { name: 'finish_attachment_upload', description: `Seal uploaded bytes only after full size and SHA-256 match. No incomplete file is readable. ${boundary}`, inputSchema: schema(bound), annotations: annotations(false) },
  { name: 'import_attachment', description: `Save an actual ChatGPT file using the host-provided file reference (file_id/download_url), including a generated file when the host supports exporting it. Do not invent a URL or substitute sandbox:/ or /mnt/data paths. Prefer this for returning existing generated images/documents without regeneration. Optional independent expected size/hash are verified against downloaded original bytes. No download URL or bearer token is stored or returned. ${boundary}`, inputSchema: schema({ ...upload, file: schema({ download_url: text(8192), file_id: text(256), mime_type: text(150), file_name: text(200) }, ['download_url', 'file_id']), fileName: text(200), mimeType: text(150), expectedSizeBytes: { type: 'integer', minimum: 0, maximum: 16777216 }, expectedSha256: hash }, [...Object.keys(upload), 'file']), _meta: { 'openai/fileParams': ['file'] }, annotations: annotations(false) },
  { name: 'get_attachment', description: `Read attachment metadata and readiness for an exact task/revision. Metadata alone does not prove original bytes were downloaded. ${boundary}`, inputSchema: schema(bound), annotations: annotations(true) },
  { name: 'list_task_attachments', description: `List selected attachments bound to this task/revision, including pending/deleted/expired state. Follow nextCursor if present. Never scans a local directory. ${boundary}`, inputSchema: schema({ ...identity, cursor: text(2048) }, Object.keys(identity)), annotations: annotations(true) },
  { name: 'read_attachment_chunk', description: `Download up to 256KiB of original bytes as base64 with a chunk SHA-256 and full-file metadata. Decode/write/check the whole file in a program; do not relay full files through model context. ${boundary}`, inputSchema: schema({ ...bound, offset: { type: 'integer', minimum: 0 }, maxBytes: { type: 'integer', minimum: 1, maximum: 262144 } }, [...Object.keys(bound), 'offset']), annotations: annotations(true) },
  { name: 'preview_attachment', description: `Return actual uploaded image/audio bytes as native MCP image/audio content, <=4MiB. This is a preview; use byte download for saving the original and independent full SHA-256 verification. Documents/large files require chunks. ${boundary}`, inputSchema: schema(bound), annotations: annotations(true) },
  { name: 'delete_attachment', description: `Delete a task-bound attachment's original bytes and staging chunks. Only the authenticated owner can delete it. Repeated deletion is safe. ${boundary}`, inputSchema: schema(bound), annotations: annotations(false, true) },
];
const metadata = {
  attachmentId, taskId: key, revision: key, assignmentReceipt: { type: 'string' },
  fileName: text(200), mimeType: text(150), sizeBytes: { type: 'integer' }, sha256: hash,
  purpose: { type: 'string', enum: ['input', 'result'] }, state: { type: 'string', enum: ['uploading', 'ready', 'deleted', 'expired'] },
  readable: { type: 'boolean' }, receipt: { type: 'string' }, createdAt: { type: 'string' }, expiresAt: { type: 'string' },
};
const extraOutputs: Record<string, Record<string, unknown>> = {
  import_attachment: { rejectedFileHost: { type: 'string', description: 'Plain rejected hostname only; no file path, signature or URL.' } },
  begin_attachment_upload: { chunkBytes: { type: 'integer' } },
  upload_attachment_chunk: { attachmentId, offset: { type: 'integer' }, sizeBytes: { type: 'integer' }, sha256: hash },
  list_task_attachments: { ...identity, attachments: { type: 'array', items: schema(metadata) }, nextCursor: { type: ['string', 'null'] } },
  read_attachment_chunk: { offset: { type: 'integer' }, returnedBytes: { type: 'integer' }, chunkSha256: hash, dataBase64: { type: 'string' }, nextOffset: { type: 'integer' }, eof: { type: 'boolean' } },
  delete_attachment: { attachmentId },
};
export const attachmentTools = definitions.map(tool => ({
  ...tool,
  outputSchema: schema({
    status: { type: 'string' },
    channel: schema({schemaVersion:{type:'integer',enum:[1]},mcpUrl:text(2048),principalId:text(256)}),
    ...(['upload_attachment_chunk', 'list_task_attachments', 'delete_attachment'].includes(tool.name) ? {} : metadata),
    ...extraOutputs[tool.name],
  }, ['status']),
}));
