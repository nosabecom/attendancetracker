import { constants as fsConstants } from 'node:fs';
import { link, mkdir, open, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

const PAGE_SIZE = 1000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const SAFE_ERRORS = new Set([
  'invalid_options', 'invalid_page', 'cursor_loop', 'duplicate_pathname',
  'invalid_metadata', 'invalid_response', 'response_not_found', 'response_status',
  'response_body', 'response_too_large', 'invalid_json', 'snapshot_changed',
  'output_exists', 'output_write', 'token_missing', 'cli_usage', 'sdk_error',
]);

export class BlobExportError extends Error {
  constructor(code) {
    super(`Blob export failed (${SAFE_ERRORS.has(code) ? code : 'export_failed'}).`);
    this.name = 'BlobExportError';
    this.code = SAFE_ERRORS.has(code) ? code : 'export_failed';
  }
}

function fail(code) { throw new BlobExportError(code); }
function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) fail('invalid_metadata');
  return date.toISOString();
}
function metadata(blob) {
  if (!blob || typeof blob.pathname !== 'string' || !blob.pathname || /[\\\u0000-\u001f\u007f]/.test(blob.pathname)) fail('invalid_metadata');
  const item = { pathname: blob.pathname, uploadedAt: iso(blob.uploadedAt) };
  if (blob.size !== undefined) {
    if (!Number.isSafeInteger(blob.size) || blob.size < 0) fail('invalid_metadata');
    item.size = blob.size;
  }
  if (blob.etag !== undefined) {
    if (typeof blob.etag !== 'string') fail('invalid_metadata');
    item.etag = blob.etag;
  }
  return item;
}

async function listAll(list) {
  const all = [], seenPaths = new Set(), seenCursors = new Set();
  let cursor;
  do {
    let page;
    try { page = await list({ limit: PAGE_SIZE, ...(cursor === undefined ? {} : { cursor }) }); }
    catch { fail('sdk_error'); }
    if (!page || !Array.isArray(page.blobs) || typeof page.hasMore !== 'boolean') fail('invalid_page');
    for (const raw of page.blobs) {
      const item = metadata(raw);
      if (seenPaths.has(item.pathname)) fail('duplicate_pathname');
      seenPaths.add(item.pathname);
      all.push(item);
    }
    if (!page.hasMore) break;
    if (typeof page.cursor !== 'string' || page.cursor.length === 0 || seenCursors.has(page.cursor)) fail('cursor_loop');
    seenCursors.add(page.cursor);
    cursor = page.cursor;
  } while (true);
  return all.sort((a, b) => a.pathname < b.pathname ? -1 : a.pathname > b.pathname ? 1 : 0);
}

async function readStream(stream, maxBytes) {
  if (!stream || typeof stream.getReader !== 'function') fail('response_body');
  const reader = stream.getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) fail('response_body');
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel().catch(() => {});
        fail('response_too_large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

async function fetchValue(get, item, maxBytes) {
  let result;
  try { result = await get(item.pathname, { access: 'private', useCache: false }); }
  catch { fail('sdk_error'); }
  if (!result) fail('response_not_found');
  if (result.statusCode !== 200) fail('response_status');
  let bytes;
  try { bytes = await readStream(result.stream, maxBytes); }
  catch (error) {
    if (error instanceof BlobExportError) throw error;
    fail('response_body');
  }
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { fail('invalid_json'); }
  return { pathname: item.pathname, uploadedAt: item.uploadedAt, value };
}

function compareSnapshots(before, after) {
  if (before.length !== after.length) fail('snapshot_changed');
  const later = new Map(after.map(item => [item.pathname, item]));
  for (const first of before) {
    const second = later.get(first.pathname);
    if (!second || first.uploadedAt !== second.uploadedAt ||
      (first.size !== undefined && first.size !== second.size) ||
      (first.etag !== undefined && first.etag !== second.etag)) fail('snapshot_changed');
  }
}

async function publishPrivate(outputPath, data) {
  const destination = resolve(outputPath), parent = dirname(destination);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temporary = resolve(parent, `.blob-export-${randomBytes(12).toString('hex')}.tmp`);
  let handle;
  try {
    handle = await open(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close(); handle = undefined;
    try { await link(temporary, destination); } catch (error) {
      if (error?.code === 'EEXIST' || error?.code === 'EISDIR' || error?.code === 'EPERM') fail('output_exists');
      throw error;
    }
    await unlink(temporary);
  } catch (error) {
    try { await handle?.close(); } catch {}
    try { await unlink(temporary); } catch {}
    if (error instanceof BlobExportError) throw error;
    fail('output_write');
  }
}

/** Export a stable private Blob listing to a new, owner-only JSON file. */
export async function exportBlobSnapshot({ sdk, outputPath, maxBytes = DEFAULT_MAX_BYTES, concurrency = 2, now = () => new Date() } = {}) {
  if (!sdk || typeof sdk.list !== 'function' || typeof sdk.get !== 'function' || typeof outputPath !== 'string' || !outputPath ||
    !Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 3) fail('invalid_options');
  const before = await listAll(sdk.list.bind(sdk));
  const blobs = new Array(before.length);
  let next = 0, failure;
  async function worker() {
    while (!failure) {
      const index = next++;
      if (index >= before.length) return;
      try { blobs[index] = await fetchValue(sdk.get.bind(sdk), before[index], maxBytes); }
      catch (error) { failure ??= error; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, before.length || 1) }, worker));
  if (failure) throw failure;
  const after = await listAll(sdk.list.bind(sdk));
  compareSnapshots(before, after);
  const snapshot = { formatVersion: 1, exportedAt: iso(now()), blobs };
  await publishPrivate(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  return { outputPath: resolve(outputPath), count: blobs.length };
}

async function main(argv) {
  if (argv.length !== 2 || argv[0] !== '--output' || !argv[1]) fail('cli_usage');
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) fail('token_missing');
  const { list, get } = await import('@vercel/blob');
  const result = await exportBlobSnapshot({ sdk: { list, get }, outputPath: argv[1] });
  process.stdout.write(`Exported ${result.count} blobs to ${result.outputPath}\n`);
}

const invokedPath = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  main(process.argv.slice(2)).catch(error => {
    const code = error instanceof BlobExportError ? error.code : 'export_failed';
    process.stderr.write(`Blob export failed (${code}).\n`);
    process.exitCode = 1;
  });
}
