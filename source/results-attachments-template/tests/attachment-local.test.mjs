import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import * as local from '../scripts/attachment-local.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-attachment-test-'));
  t.after(async () => {
    const actual = await fs.realpath(root), parent = await fs.realpath(os.tmpdir());
    assert.equal(path.dirname(actual).toLowerCase(), parent.toLowerCase());
    assert.ok(path.basename(actual).startsWith('codex-attachment-test-'));
    await fs.rm(actual, { recursive: true });
  });
  return root;
}
test('local upload rejects traversal, secrets, junction and changed bytes', async t => {
  const root = await fixture(t), outside = await fixture(t);
  await fs.writeFile(path.join(root, 'note.txt'), 'hello');
  const metadata = await local.describe(root, 'note.txt');
  assert.equal(metadata.sha256, digest(Buffer.from('hello')));
  assert.equal((await local.readChunk(root, 'note.txt', metadata.sha256, 0)).dataBase64, Buffer.from('hello').toString('base64'));
  await assert.rejects(local.describe(root, '../outside.txt'));
  await assert.rejects(local.describe(root, '.env'));
  await fs.writeFile(path.join(outside, 'outside.txt'), 'not authorized');
  await fs.symlink(outside, path.join(root, 'junction'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(local.describe(root, 'junction/outside.txt'), e => e.code === 'LINK_NOT_ALLOWED');
  await fs.writeFile(path.join(root, 'note.txt'), 'other');
  await assert.rejects(local.readChunk(root, 'note.txt', metadata.sha256, 0), e => e.code === 'FILE_CHANGED');
});
test('download independently checks hashes and never overwrites existing files', async t => {
  const root = await fixture(t), bytes = Buffer.from('returned original bytes');
  const metadata = { fileName: 'result.txt', sizeBytes: bytes.length, sha256: digest(bytes) };
  const state = await local.startDownload(root, metadata);
  const chunk = { offset: 0, dataBase64: bytes.toString('base64'), chunkSha256: digest(bytes), returnedBytes: bytes.length };
  await assert.rejects(local.appendChunk(state, { ...chunk, chunkSha256: '0'.repeat(64) }), e => e.code === 'CHUNK_INTEGRITY_MISMATCH');
  await local.appendChunk(state, chunk);
  const saved = await local.finishDownload(state);
  assert.equal(saved.sha256, digest(await fs.readFile(saved.path)));
  const another = await local.startDownload(root, metadata);
  await local.appendChunk(another, chunk);
  await assert.rejects(local.finishDownload(another), e => e.code === 'EEXIST');
  assert.deepEqual(await fs.readFile(saved.path), bytes);
  await local.cancelDownload(another);
  assert.deepEqual(await fs.readdir(root), ['result.txt']);
});
