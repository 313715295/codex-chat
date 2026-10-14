export const MAX_FILE_BYTES = 16 * 1024 * 1024;
export const CHUNK_BYTES = 256 * 1024;
export const RETENTION_MS = 60 * 60 * 1000;
const encoder = new TextEncoder();
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const idPattern = /^att_[a-f0-9]{48}$/;
// The host FileRef broker selects regional Azure origins. Resolve these to
// OpenAI's HTTPS CDN; a name prefix never authorizes a direct Azure request.
const azureFileOrigin = /^oai(sdmnt[a-z0-9]{1,40})\.blob\.core\.windows\.net$/;
type RecordData = Record<string, any>;
export interface AttachmentStore {
  get(key: string): Promise<{ bytes: Uint8Array; etag: string } | null>;
  put(key: string, bytes: Uint8Array, condition?: { absent?: boolean; etag?: string }): Promise<boolean>;
  remove(keys: string[]): Promise<void>;
  list(prefix: string, cursor?: string): Promise<{ keys: string[]; cursor?: string }>;
}
export class AttachmentError extends Error {
  code: string;
  rejectedFileHost?: string;
  constructor(code: string, rejectedFileHost?: string) {
    super(code); this.code = code;
    // Diagnostic exposes only a plain host, never a path, query or credential.
    if (rejectedFileHost && /^[a-z0-9.-]{1,253}$/.test(rejectedFileHost)) this.rejectedFileHost = rejectedFileHost;
  }
}
function fail(code: string): never { throw new AttachmentError(code); }
export async function sha256(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), b => b.toString(16).padStart(2, '0')).join('');
}
const jsonBytes = (value: unknown) => encoder.encode(JSON.stringify(value));
function validateIdentity(a: RecordData) {
  if (!a || typeof a.taskId !== 'string' || typeof a.revision !== 'string' || !keyPattern.test(a.taskId) || !keyPattern.test(a.revision)) fail('invalid_task_identity');
}
function validateUploadIdentity(a: RecordData) {
  if (!['input', 'result'].includes(a.purpose) || typeof a.requestKey !== 'string' || !keyPattern.test(a.requestKey)) fail('invalid_upload_identity');
}
function validateFile(a: RecordData) {
  if (typeof a.fileName !== 'string' || !a.fileName || a.fileName.length > 200 || /[\\/\x00-\x1f\x7f:]/.test(a.fileName) || ['.', '..'].includes(a.fileName)) fail('invalid_file_name');
  if (/^(\.env(?:\..*)?|id_rsa|id_ed25519|credentials(?:\..*)?|tokens?(?:\..*)?)$/i.test(a.fileName)) fail('sensitive_file_name');
  if (typeof a.mimeType !== 'string' || !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(a.mimeType) || a.mimeType.length > 150) fail('invalid_mime_type');
  if (!Number.isSafeInteger(a.sizeBytes) || a.sizeBytes < 0 || a.sizeBytes > MAX_FILE_BYTES) fail('file_size_limit');
  if (typeof a.sha256 !== 'string' || !hashPattern.test(a.sha256)) fail('invalid_sha256');
  validateUploadIdentity(a);
}
export function validatePlatformUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 8192) fail('invalid_platform_file_url');
  let u: URL;
  try { u = new URL(value as string); } catch { return fail('invalid_platform_file_url'); }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password || u.hash || (u.port && u.port !== '443')) fail('invalid_platform_file_url');
  const azure = host.match(azureFileOrigin);
  if (azure) {
    for (const name of ['sp', 'sr', 'se', 'sig', 'sv']) if (u.searchParams.getAll(name).length !== 1) fail('invalid_platform_file_scope');
    const expiry = Date.parse(u.searchParams.get('se')!);
    if (u.searchParams.get('sp') !== 'r' || u.searchParams.get('sr') !== 'b' ||
      !Number.isFinite(expiry) || expiry <= Date.now() || !u.searchParams.get('sv') ||
      !/^[A-Za-z0-9+/=]{16,256}$/.test(u.searchParams.get('sig')!)) fail('invalid_platform_file_scope');
    u.hostname = azure[1] + '.oaiusercontent.com';
    return u;
  }
  if (!(host === 'oaiusercontent.com' || host.endsWith('.oaiusercontent.com') || host === 'files.openai.com')) throw new AttachmentError('unsupported_platform_file_host', host);
  return u;
}
export function decodeBase64(value: unknown) {
  if (typeof value !== 'string' || value.length > Math.ceil(CHUNK_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail('invalid_chunk_encoding');
  let text: string;
  try { text = atob(value as string); } catch { return fail('invalid_chunk_encoding'); }
  const bytes = Uint8Array.from(text, c => c.charCodeAt(0));
  if (encodeBase64(bytes) !== value) fail('noncanonical_chunk_encoding');
  return bytes;
}
export function encodeBase64(bytes: Uint8Array) {
  let result = '';
  for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
}
export function createAttachmentService(options: {
  store: AttachmentStore;
  assignment: (user: string, taskId: string, revision: string) => Promise<{ receipt: string } | null>;
  now?: () => number;
  fetch?: typeof fetch;
}) {
  const store = options.store;
  const now = options.now ?? Date.now;
  const request = options.fetch ?? fetch;
  const ownerPrefix = async (user: string) => 'attachments/' + await sha256(encoder.encode(user)) + '/';
  const manifestKey = async (user: string, id: string) => (await ownerPrefix(user)) + 'meta/' + id + '.json';
  const dataKey = async (user: string, id: string) => (await ownerPrefix(user)) + 'data/' + id;
  const publicMetadata = (m: RecordData) => ({
    attachmentId: m.attachmentId, taskId: m.taskId, revision: m.revision, assignmentReceipt: m.assignmentReceipt,
    fileName: m.fileName, mimeType: m.mimeType, sizeBytes: m.sizeBytes, sha256: m.sha256,
    purpose: m.purpose, state: m.state, readable: m.state === 'ready', receipt: m.receipt,
    createdAt: new Date(m.createdAt).toISOString(), expiresAt: new Date(m.expiresAt).toISOString(),
  });
  async function cleanData(user: string, m: RecordData) {
    const base = await dataKey(user, m.attachmentId);
    await store.remove([base + '/file', ...Array.from({ length: Math.ceil(m.sizeBytes / CHUNK_BYTES) }, (_, i) => base + '/part-' + i)]);
  }
  async function load(user: string, a: RecordData, allowInactive = false) {
    validateIdentity(a);
    if (!idPattern.test(a.attachmentId)) fail('invalid_attachment_id');
    const key = await manifestKey(user, a.attachmentId);
    const object = await store.get(key);
    if (!object) fail('attachment_not_found');
    const m = JSON.parse(new TextDecoder().decode(object.bytes));
    if (m.taskId !== a.taskId || m.revision !== a.revision) fail('attachment_task_mismatch');
    if (now() >= m.expiresAt && !['deleted', 'expired'].includes(m.state)) {
      const expired = { ...m, state: 'expired' };
      if (await store.put(key, jsonBytes(expired), { etag: object.etag })) await cleanData(user, m);
      if (!allowInactive) fail('attachment_expired');
      return { m: expired, key, etag: (await store.get(key))?.etag ?? object.etag };
    }
    if (!allowInactive && m.state === 'deleted') fail('attachment_deleted');
    if (!allowInactive && m.state === 'expired') fail('attachment_expired');
    return { m, key, etag: object.etag };
  }
  async function begin(user: string, a: RecordData) {
    validateIdentity(a); validateFile(a);
    const assignment = await options.assignment(user, a.taskId, a.revision);
    if (!assignment || assignment.receipt !== a.assignmentReceipt) fail('assignment_mismatch');
    const attachmentId = 'att_' + (await sha256(jsonBytes([user, a.taskId, a.revision, a.requestKey]))).slice(0, 48);
    const key = await manifestKey(user, attachmentId);
    const intent = {
      attachmentId, taskId: a.taskId, revision: a.revision, assignmentReceipt: a.assignmentReceipt,
      fileName: a.fileName, mimeType: a.mimeType, sizeBytes: a.sizeBytes, sha256: a.sha256,
      purpose: a.purpose, requestKey: a.requestKey,
    };
    const manifest = { ...intent, state: 'uploading', receipt: crypto.randomUUID(), createdAt: now(), expiresAt: now() + RETENTION_MS };
    await store.put(key, jsonBytes(manifest), { absent: true });
    const loaded = await load(user, { ...a, attachmentId });
    for (const field of Object.keys(intent)) if (loaded.m[field] !== intent[field as keyof typeof intent]) fail('upload_conflict');
    return { status: loaded.m.state === 'ready' ? 'found' : 'created', ...publicMetadata(loaded.m), chunkBytes: CHUNK_BYTES };
  }
  async function commit(user: string, a: RecordData, bytes: Uint8Array) {
    const loaded = await load(user, a);
    const m = loaded.m;
    if (bytes.length !== m.sizeBytes || await sha256(bytes) !== m.sha256) fail('file_integrity_mismatch');
    if (m.state === 'ready') return { status: 'found', ...publicMetadata(m) };
    if (m.state !== 'uploading') fail('upload_not_active');
    const base = await dataKey(user, m.attachmentId);
    // A completed object is immutable. Concurrent finalizers must agree on bytes.
    await store.put(base + '/file', bytes, { absent: true });
    const body = await store.get(base + '/file');
    if (!body || body.bytes.length !== m.sizeBytes || await sha256(body.bytes) !== m.sha256) fail('file_integrity_mismatch');
    const ready = { ...m, state: 'ready' };
    if (!await store.put(loaded.key, jsonBytes(ready), { etag: loaded.etag })) {
      const current = await load(user, a, true);
      if (current.m.state === 'ready') return { status: 'found', ...publicMetadata(current.m) };
      await cleanData(user, m);
      fail('upload_not_active');
    }
    await store.remove(Array.from({ length: Math.ceil(m.sizeBytes / CHUNK_BYTES) }, (_, i) => base + '/part-' + i));
    return { status: 'stored', ...publicMetadata(ready) };
  }
  async function uploadChunk(user: string, a: RecordData) {
    const { m } = await load(user, a);
    if (!Number.isSafeInteger(a.offset) || a.offset < 0 || a.offset >= m.sizeBytes || a.offset % CHUNK_BYTES !== 0) fail('invalid_chunk_range');
    const bytes = decodeBase64(a.dataBase64);
    if (bytes.length !== Math.min(CHUNK_BYTES, m.sizeBytes - a.offset)) fail('invalid_chunk_length');
    const digest = await sha256(bytes);
    if (!hashPattern.test(a.sha256) || digest !== a.sha256) fail('chunk_integrity_mismatch');
    if (m.state === 'ready') {
      const file = await store.get((await dataKey(user, m.attachmentId)) + '/file');
      if (!file || await sha256(file.bytes.subarray(a.offset, a.offset + bytes.length)) !== digest) fail('chunk_conflict');
      return { status: 'found', attachmentId: m.attachmentId, offset: a.offset, sizeBytes: bytes.length, sha256: digest };
    }
    if (m.state !== 'uploading') fail('upload_not_active');
    const part = (await dataKey(user, m.attachmentId)) + '/part-' + a.offset / CHUNK_BYTES;
    await store.put(part, bytes, { absent: true });
    const saved = await store.get(part);
    if (!saved || await sha256(saved.bytes) !== digest) fail('chunk_conflict');
    // Deletion/expiry may race a chunk write; never leave bytes behind a tombstone.
    const current = await load(user, a, true);
    if (current.m.state !== 'uploading') {
      await store.remove([part]);
      if (current.m.state !== 'ready') fail('upload_not_active');
    }
    return { status: 'stored', attachmentId: m.attachmentId, offset: a.offset, sizeBytes: bytes.length, sha256: digest };
  }
  async function finish(user: string, a: RecordData) {
    const { m } = await load(user, a);
    if (m.state === 'ready') return { status: 'found', ...publicMetadata(m) };
    const bytes = new Uint8Array(m.sizeBytes);
    for (let offset = 0; offset < m.sizeBytes; offset += CHUNK_BYTES) {
      const part = await store.get((await dataKey(user, m.attachmentId)) + '/part-' + offset / CHUNK_BYTES);
      if (!part || part.bytes.length !== Math.min(CHUNK_BYTES, m.sizeBytes - offset)) fail('upload_incomplete');
      bytes.set(part.bytes, offset);
    }
    return commit(user, a, bytes);
  }
  async function get(user: string, a: RecordData) {
    const { m } = await load(user, a);
    return { status: 'found', ...publicMetadata(m) };
  }
  async function readChunk(user: string, a: RecordData) {
    const { m } = await load(user, a);
    if (m.state !== 'ready') fail('attachment_not_ready');
    const maxBytes = a.maxBytes ?? CHUNK_BYTES;
    if (!Number.isSafeInteger(a.offset) || a.offset < 0 || a.offset > m.sizeBytes || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > CHUNK_BYTES) fail('invalid_chunk_range');
    const file = await store.get((await dataKey(user, m.attachmentId)) + '/file');
    if (!file || file.bytes.length !== m.sizeBytes) fail('attachment_storage_missing');
    const bytes = file.bytes.subarray(a.offset, Math.min(m.sizeBytes, a.offset + maxBytes));
    return { status: 'found', ...publicMetadata(m), offset: a.offset, returnedBytes: bytes.length, chunkSha256: await sha256(bytes), dataBase64: encodeBase64(bytes), nextOffset: a.offset + bytes.length, eof: a.offset + bytes.length === m.sizeBytes };
  }
  async function preview(user: string, a: RecordData) {
    const { m } = await load(user, a);
    if (m.state !== 'ready') fail('attachment_not_ready');
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'audio/wav', 'audio/mpeg', 'audio/ogg'].includes(m.mimeType) || m.sizeBytes > 4 * 1024 * 1024) fail('preview_not_supported_use_chunks');
    const file = await store.get((await dataKey(user, m.attachmentId)) + '/file');
    if (!file || await sha256(file.bytes) !== m.sha256) fail('file_integrity_mismatch');
    return { status: 'found', ...publicMetadata(m), contentType: m.mimeType.startsWith('image/') ? 'image' : 'audio', dataBase64: encodeBase64(file.bytes) };
  }
  async function remove(user: string, a: RecordData) {
    const loaded = await load(user, a, true);
    if (!['deleted', 'expired'].includes(loaded.m.state)) {
      if (!await store.put(loaded.key, jsonBytes({ ...loaded.m, state: 'deleted' }), { etag: loaded.etag })) fail('attachment_changed_retry');
    }
    await cleanData(user, loaded.m);
    return { status: 'deleted', attachmentId: loaded.m.attachmentId };
  }
  async function list(user: string, a: RecordData) {
    validateIdentity(a);
    if (a.cursor !== undefined && (typeof a.cursor !== 'string' || !a.cursor || a.cursor.length > 2048)) fail('invalid_cursor');
    if (!await options.assignment(user, a.taskId, a.revision)) fail('assignment_not_found');
    const page = await store.list((await ownerPrefix(user)) + 'meta/', a.cursor);
    const attachments = [];
    for (const key of page.keys) {
      const object = await store.get(key);
      if (!object) continue;
      const m = JSON.parse(new TextDecoder().decode(object.bytes));
      if (m.taskId === a.taskId && m.revision === a.revision) {
        const loaded = await load(user, { ...a, attachmentId: m.attachmentId }, true);
        attachments.push(publicMetadata(loaded.m));
      }
    }
    return { status: 'found', taskId: a.taskId, revision: a.revision, attachments, nextCursor: page.cursor ?? null };
  }
  async function importFile(user: string, a: RecordData) {
    validateIdentity(a); validateUploadIdentity(a);
    const assignment = await options.assignment(user, a.taskId, a.revision);
    if (!assignment || assignment.receipt !== a.assignmentReceipt) fail('assignment_mismatch');
    if (!a.file || typeof a.file.file_id !== 'string' || !a.file.file_id || a.file.file_id.length > 256) fail('platform_file_reference_required');
    if (Object.keys(a.file).some(k => !['file_id', 'download_url', 'mime_type', 'file_name'].includes(k))) fail('invalid_arguments');
    if (a.expectedSha256 !== undefined && (typeof a.expectedSha256 !== 'string' || !hashPattern.test(a.expectedSha256))) fail('invalid_sha256');
    if (a.expectedSizeBytes !== undefined && (!Number.isSafeInteger(a.expectedSizeBytes) || a.expectedSizeBytes < 0 || a.expectedSizeBytes > MAX_FILE_BYTES)) fail('file_size_limit');
    validateFile({ ...a, fileName: a.fileName ?? a.file.file_name, mimeType: a.mimeType ?? a.file.mime_type ?? 'application/octet-stream', sizeBytes: 0, sha256: '0'.repeat(64) });
    function resolveFileUrl(value: string) {
      const checked = validatePlatformUrl(value);
      if (new URL(value).hostname.match(azureFileOrigin) && (a.expectedSha256 === undefined || a.expectedSizeBytes === undefined)) fail('platform_file_integrity_required');
      return checked;
    }
    let url = resolveFileUrl(a.file.download_url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      let response: Response | undefined;
      for (let redirects = 0; redirects < 4; redirects++) {
        response = await request(url.href, { redirect: 'manual', signal: controller.signal });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location');
        if (!location) fail('platform_download_failed');
        await response.body?.cancel();
        url = resolveFileUrl(new URL(location, url).href);
        response = undefined;
      }
      if (!response?.ok || !response.body) fail('platform_download_failed');
      if (Number(response.headers.get('content-length') ?? 0) > MAX_FILE_BYTES) { await response.body.cancel(); fail('file_size_limit'); }
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body.getReader();
      try {
        while (true) {
          const piece = await reader.read(); if (piece.done) break;
          size += piece.value.length;
          if (size > MAX_FILE_BYTES) { await reader.cancel(); fail('file_size_limit'); }
          chunks.push(piece.value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const digest = await sha256(bytes);
      if (a.expectedSha256 !== undefined && a.expectedSha256 !== digest) fail('file_integrity_mismatch');
      if (a.expectedSizeBytes !== undefined && a.expectedSizeBytes !== size) fail('file_integrity_mismatch');
      const started = await begin(user, { ...a, fileName: a.fileName ?? a.file.file_name, mimeType: a.mimeType ?? a.file.mime_type ?? response.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream', sizeBytes: size, sha256: digest });
      return commit(user, { ...a, attachmentId: started.attachmentId }, bytes);
    } catch (error) {
      if (error instanceof AttachmentError) throw error;
      return fail('platform_download_failed');
    } finally { clearTimeout(timer); }
  }
  return { begin, uploadChunk, finish, get, readChunk, preview, remove, list, importFile };
}
