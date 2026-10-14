import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttachmentService, sha256, encodeBase64, decodeBase64, validatePlatformUrl, CHUNK_BYTES, MAX_FILE_BYTES, RETENTION_MS } from '../lib/attachment-core.ts';
import { attachmentTools } from '../lib/attachment-tools.ts';

function fixture(fetch) {
  const objects = new Map();
  let serial = 0, clock = 1000;
  const store = {
    async get(key) { const value = objects.get(key); return value ? { bytes: value.bytes.slice(), etag: value.etag } : null; },
    async put(key, bytes, condition) {
      const current = objects.get(key);
      if (condition?.absent && current || condition?.etag && current?.etag !== condition.etag) return false;
      objects.set(key, { bytes: bytes.slice(), etag: String(++serial) }); return true;
    },
    async remove(keys) { keys.forEach(key => objects.delete(key)); },
    async list(prefix) { return { keys: [...objects.keys()].filter(key => key.startsWith(prefix)) }; }
  };
  const service = createAttachmentService({ store, now: () => clock, fetch, assignment: async (_, task, rev) => task === 'task1' && rev === 'r1' ? { receipt: '11111111-1111-4111-8111-111111111111' } : null });
  const identity = { taskId: 'task1', revision: 'r1', assignmentReceipt: '11111111-1111-4111-8111-111111111111', requestKey: 'file1', purpose: 'input' };
  async function begin(bytes, overrides = {}) { return service.begin('alice', { ...identity, fileName: 'note.txt', mimeType: 'text/plain', sizeBytes: bytes.length, sha256: await sha256(bytes), ...overrides }); }
  const bound = id => ({ taskId: 'task1', revision: 'r1', attachmentId: id });
  async function upload(bytes, overrides) {
    const metadata = await begin(bytes, overrides);
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      const chunk = bytes.subarray(offset, offset + CHUNK_BYTES);
      await service.uploadChunk('alice', { ...bound(metadata.attachmentId), offset, dataBase64: encodeBase64(chunk), sha256: await sha256(chunk) });
    }
    return service.finish('alice', bound(metadata.attachmentId));
  }
  return { service, store, objects, begin, upload, bound, identity, advance: ms => { clock += ms; } };
}
const bytes = text => new TextEncoder().encode(text);
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);

test('byte roundtrip across chunk boundaries, sealed only after full hash matches', async () => {
  const f = fixture(), original = new Uint8Array(CHUNK_BYTES + 17);
  for (let i = 0; i < original.length; i++) original[i] = i % 251;
  const pending = await f.begin(original), bound = f.bound(pending.attachmentId);
  await rejects(f.service.readChunk('alice', { ...bound, offset: 0 }), 'attachment_not_ready');
  await rejects(f.service.finish('alice', bound), 'upload_incomplete');
  const saved = await f.upload(original);
  const a = await f.service.readChunk('alice', { ...bound, offset: 0 }), b = await f.service.readChunk('alice', { ...bound, offset: a.nextOffset });
  const actual = new Uint8Array([...decodeBase64(a.dataBase64), ...decodeBase64(b.dataBase64)]);
  assert.deepEqual(actual, original); assert.equal(saved.sha256, await sha256(actual));
  assert.equal(b.eof, true); assert.equal(b.returnedBytes, 17);
  assert.equal([...f.objects.keys()].filter(key => key.includes('/part-')).length, 0);
});

test('same bytes resume with same receipt, conflicting intent and chunks are rejected', async () => {
  const f = fixture(), original = bytes('hello');
  const first = await f.begin(original), second = await f.begin(original);
  assert.equal(first.attachmentId, second.attachmentId); assert.equal(first.receipt, second.receipt);
  await rejects(f.begin(bytes('other')), 'upload_conflict');
  const a = { ...f.bound(first.attachmentId), offset: 0, dataBase64: encodeBase64(original), sha256: await sha256(original) };
  await f.service.uploadChunk('alice', a); await f.service.uploadChunk('alice', a);
  const altered = bytes('other');
  await rejects(f.service.uploadChunk('alice', { ...a, dataBase64: encodeBase64(altered), sha256: await sha256(altered) }), 'chunk_conflict');
  const saved = await f.service.finish('alice', f.bound(first.attachmentId));
  assert.equal((await f.upload(original)).receipt, saved.receipt);
});

test('hash mismatches, incomplete chunks and noncanonical encodings are rejected', async () => {
  const f = fixture(), original = bytes('hello'), m = await f.begin(original), a = f.bound(m.attachmentId);
  await rejects(f.service.uploadChunk('alice', { ...a, offset: 0, dataBase64: encodeBase64(original), sha256: '0'.repeat(64) }), 'chunk_integrity_mismatch');
  await rejects(f.service.uploadChunk('alice', { ...a, offset: 0, dataBase64: encodeBase64(bytes('x')), sha256: await sha256(bytes('x')) }), 'invalid_chunk_length');
  assert.throws(() => decodeBase64('Zh=='), error => error.code === 'noncanonical_chunk_encoding');
  const wrong = bytes('other');
  await f.service.uploadChunk('alice', { ...a, offset: 0, dataBase64: encodeBase64(wrong), sha256: await sha256(wrong) });
  await rejects(f.service.finish('alice', a), 'file_integrity_mismatch');
});

test('account, task, revision and assignment receipt isolation', async () => {
  const f = fixture(), m = await f.upload(bytes('hello')), a = f.bound(m.attachmentId);
  await rejects(f.service.get('bob', a), 'attachment_not_found');
  await rejects(f.service.get('alice', { ...a, taskId: 'task2' }), 'attachment_task_mismatch');
  await rejects(f.service.get('alice', { ...a, revision: 'r2' }), 'attachment_task_mismatch');
  await rejects(f.begin(bytes('x'), { assignmentReceipt: 'wrong' }), 'assignment_mismatch');
  await rejects(f.begin(bytes('x'), { taskId: undefined }), 'invalid_task_identity');
});

test('fixed expiry cannot be extended by read or retry; expiry cleans original bytes', async () => {
  const f = fixture(), m = await f.upload(bytes('hello')), a = f.bound(m.attachmentId);
  f.advance(RETENTION_MS - 1);
  assert.equal((await f.service.get('alice', a)).expiresAt, m.expiresAt);
  assert.equal((await f.begin(bytes('hello'))).expiresAt, m.expiresAt);
  f.advance(1);
  await rejects(f.service.get('alice', a), 'attachment_expired');
  assert.equal([...f.objects.keys()].filter(key => key.includes('/data/')).length, 0);
  assert.equal((await f.service.list('alice', a)).attachments[0].state, 'expired');
});

test('deletion denies reads, remains idempotent, and a late chunk is removed', async () => {
  const f = fixture(), original = bytes('hello'), m = await f.begin(original), a = f.bound(m.attachmentId);
  let release, entered;
  const paused = new Promise(resolve => { entered = resolve; });
  const oldPut = f.store.put;
  f.store.put = async (key, body, condition) => {
    if (key.includes('/part-')) { entered(); await new Promise(resolve => { release = resolve; }); }
    return oldPut(key, body, condition);
  };
  const upload = f.service.uploadChunk('alice', { ...a, offset: 0, dataBase64: encodeBase64(original), sha256: await sha256(original) });
  await paused; await f.service.remove('alice', a); release();
  await rejects(upload, 'upload_not_active');
  await rejects(f.service.get('alice', a), 'attachment_deleted');
  await f.service.remove('alice', a);
  assert.equal([...f.objects.keys()].filter(key => key.includes('/data/')).length, 0);
});

test('size, path, filename and upload identity limits', async () => {
  const f = fixture(), b = bytes('x');
  await rejects(f.begin(b, { sizeBytes: MAX_FILE_BYTES + 1 }), 'file_size_limit');
  await rejects(f.begin(b, { fileName: '../secret' }), 'invalid_file_name');
  await rejects(f.begin(b, { fileName: '.env' }), 'sensitive_file_name');
  await rejects(f.begin(b, { requestKey: undefined }), 'invalid_upload_identity');
  const empty = await f.upload(new Uint8Array(), { requestKey: 'empty' });
  assert.equal((await f.service.readChunk('alice', { ...f.bound(empty.attachmentId), offset: 0 })).eof, true);
});

test('host file import verifies original bytes and never persists the temporary URL', async () => {
  const original = bytes('downloaded original'), url = 'https://files.openai.com/file?signature=private';
  const f = fixture(async () => new Response(original, { status: 200 }));
  const m = await f.service.importFile('alice', { ...f.identity, purpose: 'result', file: { file_id: 'file_test', download_url: url, file_name: 'result.txt', mime_type: 'text/plain' }, expectedSizeBytes: original.length, expectedSha256: await sha256(original) });
  assert.equal(m.sha256, await sha256(original));
  for (const [key, object] of f.objects) if (key.includes('/meta/')) {
    const text = new TextDecoder().decode(object.bytes);
    assert.equal(text.includes('signature'), false); assert.equal(text.includes('file_test'), false);
  }
});

test('regional Azure FileRef resolves only to OpenAI CDN with read-only blob SAS and size/hash', async () => {
  const host = 'oaisdmntprjapaneast.blob.core.windows.net';
  const query = new URLSearchParams({ sp: 'r', sr: 'b', se: new Date(Date.now() + 600000).toISOString(), sv: '2026-02-06', sig: 'a'.repeat(44) });
  const url = 'https://' + host + '/files/original.png?' + query;
  assert.equal(validatePlatformUrl(url).hostname, 'sdmntprjapaneast.oaiusercontent.com');
  assert.equal(validatePlatformUrl(url.replace('prjapaneast', 'prkoreacentral')).hostname, 'sdmntprkoreacentral.oaiusercontent.com');
  assert.throws(() => validatePlatformUrl(url.replace('sp=r', 'sp=rw')), e => e.code === 'invalid_platform_file_scope');
  assert.throws(() => validatePlatformUrl(url.replace('sr=b', 'sr=c')), e => e.code === 'invalid_platform_file_scope');
  assert.throws(() => validatePlatformUrl(url + '&sp=r'), e => e.code === 'invalid_platform_file_scope');
  assert.throws(() => validatePlatformUrl(url.replace(host, 'other.blob.core.windows.net')), e => e.code === 'unsupported_platform_file_host');
  let calls = 0;
  const original = bytes('original image'), f = fixture(async input => { calls++; assert.equal(new URL(input).hostname, 'sdmntprjapaneast.oaiusercontent.com'); return new Response(original); });
  const args = { ...f.identity, fileName: 'original.png', mimeType: 'image/png', file: { file_id: 'file_test', download_url: url } };
  await rejects(f.service.importFile('alice', args), 'platform_file_integrity_required');
  assert.equal(calls, 0);
  const saved = await f.service.importFile('alice', { ...args, expectedSha256: await sha256(original), expectedSizeBytes: original.length });
  assert.equal(saved.sha256, await sha256(original)); assert.equal(calls, 1);
});

test('import validates authorization before network, rejects private redirects and oversized bodies', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } }); });
  const args = { ...f.identity, fileName: 'image.png', mimeType: 'image/png', file: { file_id: 'file_test', download_url: 'https://files.openai.com/file' } };
  await rejects(f.service.importFile('alice', { ...args, assignmentReceipt: 'wrong' }), 'assignment_mismatch');
  assert.equal(calls, 0);
  await rejects(f.service.importFile('alice', args), 'unsupported_platform_file_host'); assert.equal(calls, 1);
  for (const url of ['http://files.openai.com/a', 'https://user:pass@files.openai.com/a', 'https://files.openai.com.evil.test/a', 'https://localhost/a', 'sandbox:/mnt/data/a']) assert.throws(() => validatePlatformUrl(url));
  assert.throws(() => validatePlatformUrl('https://unexpected.example.com/file?signature=private'), error => error.code === 'unsupported_platform_file_host' && error.rejectedFileHost === 'unexpected.example.com' && !JSON.stringify(error).includes('private'));
  const tooLarge = fixture(async () => new Response(bytes('x'), { headers: { 'content-length': String(MAX_FILE_BYTES + 1) } }));
  await rejects(tooLarge.service.importFile('alice', args), 'file_size_limit');
});

test('preview exposes original media, checks integrity, and refuses documents', async () => {
  const f = fixture(), m = await f.upload(bytes('synthetic image bytes'), { fileName: 'image.png', mimeType: 'image/png' }), a = f.bound(m.attachmentId);
  assert.deepEqual(decodeBase64((await f.service.preview('alice', a)).dataBase64), bytes('synthetic image bytes'));
  const bodyKey = [...f.objects.keys()].find(key => key.endsWith('/file'));
  f.objects.get(bodyKey).bytes[0] ^= 1;
  await rejects(f.service.preview('alice', a), 'file_integrity_mismatch');
  const doc = await f.upload(bytes('doc'), { requestKey: 'doc' });
  await rejects(f.service.preview('alice', f.bound(doc.attachmentId)), 'preview_not_supported_use_chunks');
});

test('file descriptor follows official host schema and all tool names are unique', () => {
  const descriptor = attachmentTools.find(tool => tool.name === 'import_attachment');
  assert.deepEqual(descriptor._meta['openai/fileParams'], ['file']);
  assert.deepEqual(descriptor.inputSchema.properties.file.required, ['download_url', 'file_id']);
  assert.deepEqual(Object.keys(descriptor.inputSchema.properties.file.properties).sort(), ['download_url', 'file_id', 'file_name', 'mime_type']);
  assert.equal(new Set(attachmentTools.map(tool => tool.name)).size, attachmentTools.length);
});
