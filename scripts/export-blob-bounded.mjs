import { constants } from 'node:fs';
import { lstat, open, readFile, realpath, link, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

const MiB = 1024 * 1024;
export const BLOB_RECOVERY_LIMITS = Object.freeze({
  metadataRequests: 2, objects: 400, concurrency: 2,
  objectBytes: 2 * MiB, metadataBytes: 2 * MiB, totalBodyBytes: 64 * MiB,
  headersMs: 15_000, bodyMs: 30_000, globalMs: 300_000,
});
export const PRODUCTION_BLOB_STORE = 'store_raW6bHbRonffwrRf';
const codes = new Set([
  'invalid_options', 'invalid_token', 'store_mismatch', 'protocol_version',
  'destination_private', 'output_exists', 'attempt_exists', 'attempt_write',
  'transport_error', 'response_status', 'response_body', 'response_too_large',
  'total_body_limit', 'invalid_json', 'invalid_page', 'pagination', 'object_limit',
  'invalid_metadata', 'duplicate_pathname', 'snapshot_changed', 'request_budget',
  'headers_timeout', 'body_timeout', 'global_timeout', 'canceled', 'output_write',
  'cli_usage', 'token_missing',
]);

export class BoundedBlobExportError extends Error {
  constructor(code) {
    const safe = codes.has(code) ? code : 'export_failed';
    super(`Bounded Blob export failed (${safe}).`);
    this.name = 'BoundedBlobExportError';
    this.code = safe;
  }
}
const fail = code => { throw new BoundedBlobExportError(code); };
const safeError = error => new BoundedBlobExportError(error instanceof BoundedBlobExportError ? error.code : 'export_failed');

// Protocol copied narrowly from installed @vercel/blob 2.8.2: list uses API v13
// GET https://vercel.com/api/blob?limit=..., get uses the private store with
// cache=0 and an explicit Bearer token. That SDK has no injected fetch option;
// list retries ten times by default. Do not use it or mutate its global env.
async function assertInstalledProtocol() {
  try {
    const entry = createRequire(import.meta.url).resolve('@vercel/blob');
    const pkg = JSON.parse(await readFile(resolve(dirname(entry), '..', 'package.json'), 'utf8'));
    if (pkg.version !== '2.8.2') fail('protocol_version');
  } catch { fail('protocol_version'); }
}

// One https.request invocation, no redirect following, pool, SDK, OIDC, retry
// agent, global dispatcher, or environment-selected endpoint. An injected test
// transport must likewise represent one request and honor AbortSignal.
function singleRequest(url, { headers, signal }) {
  return new Promise((resolveResponse, reject) => {
    const req = httpsRequest(url, { method: 'GET', headers, signal, agent: false }, response => {
      resolveResponse({ status: response.statusCode, body: Readable.toWeb(response) });
    });
    req.once('error', reject);
    req.end();
  });
}

function identity(token, expectedStoreId) {
  if (typeof expectedStoreId !== 'string' || !/^store_[A-Za-z0-9]{16}$/.test(expectedStoreId)) fail('invalid_options');
  const match = typeof token === 'string' && /^vercel_blob_rw_([A-Za-z0-9]{16})_[A-Za-z0-9]{16,256}$/.exec(token);
  if (!match) fail('invalid_token');
  if (`store_${match[1]}` !== expectedStoreId) fail('store_mismatch');
  const host = `${match[1].toLowerCase()}.private.blob.vercel-storage.com`;
  if (host !== `${expectedStoreId.slice(6).toLowerCase()}.private.blob.vercel-storage.com`) fail('store_mismatch');
  return { storeId: match[1], origin: `https://${host}` };
}

function objectUrl(origin, pathname) {
  const url = new URL(`${origin}/${pathname.split('/').map(encodeURIComponent).join('/')}`);
  if (url.origin !== origin) fail('invalid_metadata');
  return url;
}

function inventory(page, origin, maxBytes) {
  if (!page || !Array.isArray(page.blobs) || typeof page.hasMore !== 'boolean') fail('invalid_page');
  if (page.hasMore) fail('pagination');
  if (page.blobs.length > BLOB_RECOVERY_LIMITS.objects) fail('object_limit');
  const seen = new Set();
  return page.blobs.map(raw => {
    if (!raw || typeof raw.pathname !== 'string' || !raw.pathname || raw.pathname.length > 1024 ||
      /[\\\u0000-\u001f\u007f]/.test(raw.pathname) || raw.pathname.split('/').some(part => part === '.' || part === '..') ||
      !Number.isSafeInteger(raw.size) || raw.size < 0 || typeof raw.uploadedAt !== 'string' ||
      (raw.etag !== undefined && typeof raw.etag !== 'string')) fail('invalid_metadata');
    if (raw.size > maxBytes) fail('response_too_large');
    const date = new Date(raw.uploadedAt);
    if (!Number.isFinite(date.getTime())) fail('invalid_metadata');
    // Validate the listing's URL but never use it as a request destination.
    try {
      const url = new URL(raw.url);
      if (url.origin !== origin || url.username || url.password || url.search || url.hash ||
        decodeURIComponent(url.pathname.slice(1)) !== raw.pathname) fail('invalid_metadata');
      objectUrl(origin, raw.pathname);
    } catch { fail('invalid_metadata'); }
    if (seen.has(raw.pathname)) fail('duplicate_pathname');
    seen.add(raw.pathname);
    return { pathname: raw.pathname, size: raw.size, uploadedAt: date.toISOString(), ...(raw.etag === undefined ? {} : { etag: raw.etag }) };
  }).sort((a, b) => a.pathname < b.pathname ? -1 : a.pathname > b.pathname ? 1 : 0);
}

async function absent(path, code) {
  try { await lstat(path); } catch (error) { if (error?.code === 'ENOENT') return; fail('destination_private'); }
  fail(code);
}

async function destination(outputPath, attemptPath) {
  const output = resolve(outputPath), attempt = resolve(attemptPath), parent = dirname(output);
  if (output === attempt || dirname(attempt) !== parent) fail('invalid_options');
  try {
    const dir = await lstat(parent);
    if (!dir.isDirectory() || (dir.mode & 0o777) !== 0o700 ||
      (typeof process.getuid === 'function' && dir.uid !== process.getuid()) || await realpath(parent) !== parent) fail('destination_private');
  } catch { fail('destination_private'); }
  await absent(output, 'output_exists');
  await absent(attempt, 'attempt_exists');
  let handle;
  try { handle = await open(attempt, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) { fail(error?.code === 'EEXIST' ? 'attempt_exists' : 'attempt_write'); }
  return { output, parent, handle };
}

function abortable(work, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolveWork, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(work).then(resolveWork, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

/**
 * Single-use recovery run. Requires an existing owner-only 0700 directory and
 * explicit non-reusable attemptPath in that directory. The record is retained
 * even on failure; another run requires a separately reviewed allocation.
 * No network occurs on module import, preflight failure, or attempt replay.
 */
export async function exportBoundedBlobSnapshot({
  token, expectedStoreId = PRODUCTION_BLOB_STORE, outputPath, attemptPath,
  transport = singleRequest, signal,
  maxBytes = BLOB_RECOVERY_LIMITS.objectBytes, maxTotalBytes = BLOB_RECOVERY_LIMITS.totalBodyBytes,
  headersMs = BLOB_RECOVERY_LIMITS.headersMs, bodyMs = BLOB_RECOVERY_LIMITS.bodyMs,
  globalMs = BLOB_RECOVERY_LIMITS.globalMs, now = () => new Date(),
} = {}) {
  if (typeof outputPath !== 'string' || !outputPath || typeof attemptPath !== 'string' || !attemptPath ||
    typeof transport !== 'function' || typeof now !== 'function' ||
    (signal !== undefined && !(signal instanceof AbortSignal)) ||
    ![maxBytes, maxTotalBytes, headersMs, bodyMs, globalMs].every(value => Number.isSafeInteger(value) && value > 0) ||
    maxBytes > BLOB_RECOVERY_LIMITS.objectBytes || maxTotalBytes > BLOB_RECOVERY_LIMITS.totalBodyBytes ||
    headersMs > BLOB_RECOVERY_LIMITS.headersMs || bodyMs > BLOB_RECOVERY_LIMITS.bodyMs || globalMs > BLOB_RECOVERY_LIMITS.globalMs) fail('invalid_options');
  const auth = identity(token, expectedStoreId);
  await assertInstalledProtocol();
  const { output, parent, handle } = await destination(outputPath, attemptPath);
  const record = {
    formatVersion: 1, status: 'running',
    limits: { metadataRequests: 2, objectRequests: 400, concurrency: 2, objectBytes: maxBytes, totalBodyBytes: maxTotalBytes, headersMs, bodyMs, globalMs },
    metadataAttempts: 0, objectAttempts: 0, bodyBytes: 0,
  };
  const controller = new AbortController();
  const stop = code => { if (!controller.signal.aborted) controller.abort(new BoundedBlobExportError(code)); };
  const canceled = () => stop('canceled');
  let globalTimer, temporary, temporaryHandle, failure, publication = false;
  let queue = Promise.resolve();
  const objectAttempts = new Set();
  const persistRecord = async fileHandle => {
    try {
      const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesWritten } = await fileHandle.write(bytes, offset, bytes.length - offset, offset);
        if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0) fail('attempt_write');
        offset += bytesWritten;
      }
      await fileHandle.truncate(bytes.length);
      await fileHandle.sync();
    } catch { fail('attempt_write'); }
  };
  const persist = () => persistRecord(handle);
  const reserve = (kind, pathname) => {
    const work = queue.then(async () => {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (kind === 'metadata') {
        if (record.metadataAttempts >= 2) fail('request_budget');
        record.metadataAttempts++;
      } else {
        if (record.objectAttempts >= 400 || objectAttempts.has(pathname)) fail('request_budget');
        objectAttempts.add(pathname);
        record.objectAttempts++;
      }
      // Durable reservation precedes the physical request, including failures.
      await persist();
      if (controller.signal.aborted) throw controller.signal.reason;
    });
    queue = work.catch(() => {});
    return work;
  };
  async function readBody(body, cap) {
    if (!body || typeof body.getReader !== 'function') fail('response_body');
    const reader = body.getReader(), chunks = [];
    let bytes = 0;
    const timer = setTimeout(() => stop('body_timeout'), bodyMs);
    try {
      while (true) {
        const { done, value } = await abortable(reader.read(), controller.signal);
        if (done) break;
        if (!(value instanceof Uint8Array)) fail('response_body');
        bytes += value.byteLength;
        record.bodyBytes += value.byteLength;
        if (bytes > cap) fail('response_too_large');
        if (record.bodyBytes > maxTotalBytes) fail('total_body_limit');
        chunks.push(value);
      }
      return Buffer.concat(chunks, bytes);
    } catch (error) {
      stop(safeError(error).code);
      void reader.cancel().catch(() => {});
      throw error;
    } finally { clearTimeout(timer); reader.releaseLock(); }
  }
  async function request(kind, pathname, url, explicitToken) {
    if (explicitToken !== token) fail('invalid_token');
    await reserve(kind, pathname);
    // A peer can fail between reserve's last microtask and this continuation.
    if (controller.signal.aborted) throw controller.signal.reason;
    const headers = { authorization: `Bearer ${explicitToken}` };
    if (kind === 'metadata') Object.assign(headers, {
      'x-api-version': '13', 'x-vercel-blob-store-id': auth.storeId,
      'x-api-blob-request-id': `${auth.storeId}:${Date.now()}:${randomBytes(8).toString('hex')}`,
      'x-api-blob-request-attempt': '0',
    });
    let timer;
    try {
      // Keep this synchronous between the abort check/reservation and transport.
      const pending = Promise.resolve(transport(url, { method: 'GET', headers, signal: controller.signal, redirect: 'error' }));
      void pending.then(response => {
        if (controller.signal.aborted) void response?.body?.cancel().catch(() => {});
      }, () => {});
      timer = setTimeout(() => stop('headers_timeout'), headersMs);
      const response = await abortable(pending, controller.signal);
      clearTimeout(timer);
      if (response?.status !== 200) {
        void response?.body?.cancel().catch(() => {});
        fail('response_status');
      }
      const bytes = await readBody(response.body, kind === 'metadata' ? BLOB_RECOVERY_LIMITS.metadataBytes : maxBytes);
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { fail('invalid_json'); }
    } catch (error) {
      const safe = error instanceof BoundedBlobExportError ? error : new BoundedBlobExportError('transport_error');
      stop(safe.code);
      throw controller.signal.reason;
    } finally { clearTimeout(timer); }
  }
  const list = explicitToken => request('metadata', undefined, new URL('https://vercel.com/api/blob?limit=400'), explicitToken);
  const get = (pathname, explicitToken) => {
    const url = objectUrl(auth.origin, pathname);
    url.searchParams.set('cache', '0');
    return request('object', pathname, url, explicitToken);
  };
  try {
    await persist();
    // Make the exclusive attempt entry durable before admitting any requests.
    const directory = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY);
    try { await directory.sync(); } finally { await directory.close(); }
    signal?.addEventListener('abort', canceled, { once: true });
    if (signal?.aborted) canceled();
    globalTimer = setTimeout(() => stop('global_timeout'), globalMs);
    const before = inventory(await list(token), auth.origin, maxBytes);
    if (before.reduce((sum, item) => sum + item.size, record.bodyBytes) > maxTotalBytes) fail('total_body_limit');
    const blobs = new Array(before.length);
    let next = 0;
    async function worker() {
      while (!controller.signal.aborted && !failure) {
        const index = next++;
        if (index >= before.length) return;
        const item = before[index];
        try {
          const value = await get(item.pathname, token);
          blobs[index] = { pathname: item.pathname, uploadedAt: item.uploadedAt, value };
        } catch (error) {
          failure ??= safeError(error);
          stop(failure.code);
        }
      }
    }
    await Promise.allSettled(Array.from({ length: Math.min(2, before.length) }, worker));
    if (failure) throw failure;
    if (controller.signal.aborted) throw controller.signal.reason;
    const after = inventory(await list(token), auth.origin, maxBytes);
    if (JSON.stringify(before) !== JSON.stringify(after)) fail('snapshot_changed');
    const exportedAt = now();
    if (!(exportedAt instanceof Date) || !Number.isFinite(exportedAt.getTime())) fail('invalid_options');
    const snapshot = `${JSON.stringify({ formatVersion: 1, exportedAt: exportedAt.toISOString(), blobs })}\n`;
    if (controller.signal.aborted) throw controller.signal.reason;
    temporary = resolve(parent, `.blob-bounded-${randomBytes(12).toString('hex')}.tmp`);
    temporaryHandle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await temporaryHandle.writeFile(snapshot);
    await temporaryHandle.sync();
    await temporaryHandle.close(); temporaryHandle = undefined;
    if (controller.signal.aborted) throw controller.signal.reason;
    try { await link(temporary, output); }
    catch (error) { fail(error?.code === 'EEXIST' ? 'output_exists' : 'output_write'); }
    publication = true;
    if (controller.signal.aborted) throw controller.signal.reason;
    try {
      const directory = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY);
      try { await directory.sync(); } finally { await directory.close(); }
    } catch { fail('output_write'); }
    if (controller.signal.aborted) throw controller.signal.reason;
    record.status = 'succeeded';
    record.objectCount = blobs.length;
    await persist();
    return { count: blobs.length, metadataAttempts: record.metadataAttempts, objectAttempts: record.objectAttempts, bodyBytes: record.bodyBytes };
  } catch (error) {
    failure = safeError(error);
    stop(failure.code);
    await queue;
    record.status = 'failed';
    record.code = failure.code;
    record.snapshotPublished = publication;
    await persist();
    throw failure;
  } finally {
    try {
      let cleanupCode, temporaryCleaned = true;
      try { await temporaryHandle?.close(); } catch { cleanupCode = 'output_write'; }
      if (temporary) {
        try { await unlink(temporary); }
        catch (error) {
          if (error?.code !== 'ENOENT') { cleanupCode = 'output_write'; temporaryCleaned = false; }
        }
      }
      try { await handle.close(); } catch { cleanupCode = 'attempt_write'; }
      // Signals remain observed through success persistence and all async
      // cleanup. Repair stale success bytes after close, also for failed cleanup.
      if (cleanupCode || (controller.signal.aborted && record.status === 'succeeded')) {
        const error = cleanupCode ? new BoundedBlobExportError(cleanupCode) : safeError(controller.signal.reason);
        record.status = 'failed';
        record.code = error.code;
        record.snapshotPublished = publication;
        if (cleanupCode) record.temporaryCleaned = temporaryCleaned;
        let repair;
        try {
          repair = await open(resolve(attemptPath), constants.O_WRONLY | constants.O_NOFOLLOW);
          await persistRecord(repair);
        } catch { fail('attempt_write'); }
        finally { if (repair) { try { await repair.close(); } catch { fail('attempt_write'); } } }
        throw error;
      }
    } finally {
      // No await between the last outcome check and listener removal.
      clearTimeout(globalTimer);
      signal?.removeEventListener('abort', canceled);
    }
  }
}

/** Opt-in CLI; credentials are read only from the environment, never argv. */
export async function runBoundedBlobExportCli(argv, {
  env = process.env, stdout = process.stdout, stderr = process.stderr,
  run = exportBoundedBlobSnapshot, signal,
} = {}) {
  try {
    if (argv[0] !== '--run' || ![5, 7].includes(argv.length)) fail('cli_usage');
    const options = new Map();
    for (let i = 1; i < argv.length; i += 2) {
      if (!['--output', '--attempt', '--store'].includes(argv[i]) || !argv[i + 1] || options.has(argv[i])) fail('cli_usage');
      options.set(argv[i], argv[i + 1]);
    }
    if (!options.has('--output') || !options.has('--attempt')) fail('cli_usage');
    const token = env.BLOB_READ_WRITE_TOKEN;
    if (!token) fail('token_missing');
    const result = await run({ token, outputPath: options.get('--output'), attemptPath: options.get('--attempt'), expectedStoreId: options.get('--store') ?? PRODUCTION_BLOB_STORE, signal });
    stdout.write(`Bounded Blob export completed: ${result.count} objects, ${result.metadataAttempts} metadata requests, ${result.objectAttempts} object requests.\n`);
    return 0;
  } catch (error) {
    stderr.write(`Bounded Blob export failed (${safeError(error).code}).\n`);
    return 1;
  }
}

const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
if (invoked === import.meta.url) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  process.exitCode = await runBoundedBlobExportCli(process.argv.slice(2), { signal: controller.signal });
  process.removeListener('SIGINT', cancel);
  process.removeListener('SIGTERM', cancel);
}
