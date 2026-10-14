import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const LIMIT = 16 * 1024 * 1024, CHUNK = 256 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const safeName = name => typeof name === 'string' && name.length > 0 && name.length <= 200 &&
  !/[\\/:\x00-\x1f\x7f]/.test(name) && !/[. ]$/.test(name) && !['.', '..'].includes(name) &&
  !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) &&
  !/^(\.env(?:\..*)?|\.(git|ssh|aws|gnupg|codex)|credentials(?:[._-].*)?|secrets?(?:[._-].*)?|tokens?(?:[._-].*)?|id_rsa|id_ed25519)$/i.test(name) && !/\.(key|pem|p12|pfx|keystore)$/i.test(name);
async function rootPath(root) {
  if (!path.isAbsolute(root)) fail('ABSOLUTE_AUTHORIZED_ROOT_REQUIRED');
  const parts = path.resolve(root).slice(path.parse(root).root.length).split(path.sep).filter(Boolean);
  let current = path.parse(root).root;
  for (const part of parts) { current = path.join(current, part); if ((await fs.lstat(current)).isSymbolicLink()) fail('LINK_NOT_ALLOWED'); }
  if (!(await fs.stat(root)).isDirectory()) fail('ROOT_NOT_DIRECTORY');
  return fs.realpath(root);
}
async function selected(root, relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || path.isAbsolute(relative) || !relative.split('/').every(safeName)) fail('INVALID_SELECTED_PATH');
  const base = await rootPath(root);
  let file = base;
  for (const part of relative.split('/')) {
    file = path.join(file, part);
    if ((await fs.lstat(file)).isSymbolicLink()) fail('LINK_NOT_ALLOWED');
  }
  const actual = await fs.realpath(file), rel = path.relative(base, actual);
  if (!rel || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) fail('OUTSIDE_AUTHORIZED_ROOT');
  return actual;
}
async function snapshot(root, relative) {
  const file = await selected(root, relative), handle = await fs.open(file, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > LIMIT) fail('FILE_SIZE_OR_TYPE_LIMIT');
    const bytes = await handle.readFile(), after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino || bytes.length !== before.size) fail('FILE_CHANGED');
    if (await selected(root, relative) !== file) fail('FILE_CHANGED');
    return bytes;
  } finally { await handle.close(); }
}
export async function describe(root, relative) {
  const bytes = await snapshot(root, relative);
  return { fileName: relative.split('/').at(-1), sizeBytes: bytes.length, sha256: digest(bytes) };
}
export async function readChunk(root, relative, expectedSha256, offset) {
  const bytes = await snapshot(root, relative);
  if (digest(bytes) !== expectedSha256) fail('FILE_CHANGED');
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= bytes.length || offset % CHUNK !== 0) fail('INVALID_OFFSET');
  const chunk = bytes.subarray(offset, offset + CHUNK);
  return { offset, dataBase64: chunk.toString('base64'), sha256: digest(chunk), sizeBytes: chunk.length };
}
async function temporary(root, name) {
  if (!/^attachment-[a-f0-9-]{36}\.partial$/.test(name)) fail('INVALID_TEMP_FILE');
  return selected(root, name);
}
export async function startDownload(root, metadata) {
  if (!safeName(metadata.fileName) || !/^[a-f0-9]{64}$/.test(metadata.sha256) || !Number.isSafeInteger(metadata.sizeBytes) || metadata.sizeBytes < 0 || metadata.sizeBytes > LIMIT) fail('INVALID_DOWNLOAD_METADATA');
  const base = await rootPath(root), tempName = 'attachment-' + randomUUID() + '.partial';
  const file = path.join(base, tempName);
  await (await fs.open(file, 'wx')).close();
  return { root: base, tempName, fileName: metadata.fileName, sizeBytes: metadata.sizeBytes, sha256: metadata.sha256 };
}
export async function appendChunk(state, chunk) {
  const file = await temporary(state.root, state.tempName);
  if (typeof chunk.dataBase64 !== 'string' || chunk.dataBase64.length > Math.ceil(CHUNK / 3) * 4) fail('INVALID_CHUNK');
  const bytes = Buffer.from(chunk.dataBase64, 'base64');
  if (bytes.toString('base64') !== chunk.dataBase64 || digest(bytes) !== chunk.chunkSha256 || bytes.length !== chunk.returnedBytes) fail('CHUNK_INTEGRITY_MISMATCH');
  const handle = await fs.open(file, 'r+');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== chunk.offset || !Number.isSafeInteger(chunk.offset) || stat.size + bytes.length > state.sizeBytes) fail('INVALID_OFFSET');
    let written = 0;
    while (written < bytes.length) written += (await handle.write(bytes, written, bytes.length - written, chunk.offset + written)).bytesWritten;
  } finally { await handle.close(); }
  return { nextOffset: chunk.offset + bytes.length };
}
export async function finishDownload(state) {
  const file = await temporary(state.root, state.tempName), bytes = await fs.readFile(file);
  if (bytes.length !== state.sizeBytes || digest(bytes) !== state.sha256) fail('FILE_INTEGRITY_MISMATCH');
  if (!safeName(state.fileName)) fail('INVALID_DOWNLOAD_METADATA');
  const destination = path.join(await rootPath(state.root), state.fileName);
  // Exclusive copy preserves any pre-existing user file, including symlinks.
  await fs.copyFile(file, destination, fs.constants.COPYFILE_EXCL);
  await fs.unlink(file);
  return { path: destination, sizeBytes: bytes.length, sha256: digest(bytes) };
}
export async function cancelDownload(state) { await fs.unlink(await temporary(state.root, state.tempName)); }
