import { constants } from 'node:fs';
import { lstat, open, readFile, realpath, link, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { BLOB_PROBE_TARGET, BlobCredentialProbeError, readBlobProbeCredential } from './probe-blob-credential.mjs';

export const OIDC_BODY_PROBE_LIMITS = Object.freeze({ listRequests: 1, objectRequests: 1, listBytes: 16 * 1024, objectBytes: 64 * 1024, headersMs: 15_000, bodyMs: 15_000, globalMs: 60_000 });
const codes = new Set([
  'invalid_options', 'invalid_token', 'oidc_claims', 'oidc_expiry', 'protocol_version',
  'credential_private', 'credential_format', 'destination_private', 'output_exists',
  'attempt_exists', 'attempt_write', 'output_write', 'request_budget', 'transport_error',
  'invalid_response', 'response_body', 'response_too_large', 'invalid_json', 'invalid_page',
  'empty_listing', 'object_size', 'encoding_unsupported', 'invalid_headers', 'length_mismatch',
  'etag_unsupported', 'etag_mismatch', 'auth_denied_inconclusive', 'http_status_inconclusive',
  'redirect_denied', 'headers_timeout', 'body_timeout', 'global_timeout', 'canceled', 'cli_usage',
]);
export class BlobOidcBodyProbeError extends Error {
  constructor(code) {
    const safe = codes.has(code) ? code : 'probe_failed';
    super(`Blob OIDC body probe failed (${safe}).`);
    this.name = 'BlobOidcBodyProbeError'; this.code = safe;
  }
}
const fail = code => { throw new BlobOidcBodyProbeError(code); };
const safeError = error => new BlobOidcBodyProbeError(error instanceof BlobOidcBodyProbeError || error instanceof BlobCredentialProbeError ? error.code : 'probe_failed');

// Pinned primary source: @vercel/blob 2.8.2 dist/index.js list() and get(URL),
// chunk-XKVPKJPO.js API v13/requestApi(). get(URL) preserves the listed URL's
// path encoding and adds cache=0 for private useCache:false. No SDK auth/retries.
async function protocol() {
  try {
    const entry = createRequire(import.meta.url).resolve('@vercel/blob');
    if (JSON.parse(await readFile(resolve(dirname(entry), '..', 'package.json'), 'utf8')).version !== '2.8.2') fail('protocol_version');
  } catch { fail('protocol_version'); }
}
function credential(token, now) {
  if (typeof token !== 'string' || token.length > 16_384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) fail('invalid_token');
  let claims;
  try { claims = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(token.split('.')[1], 'base64url'))); }
  catch { fail('oidc_claims'); }
  if (!claims || Array.isArray(claims) || claims.project_id !== BLOB_PROBE_TARGET.projectId ||
    claims.owner_id !== BLOB_PROBE_TARGET.teamId || claims.environment !== 'development') fail('oidc_claims');
  const time = now();
  if (!Number.isFinite(time) || !Number.isSafeInteger(claims.exp) || claims.exp * 1000 - time < 30_000 ||
    (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf * 1000 > time))) fail('oidc_expiry');
  // Claim decoding is not JWT signature/issuer verification.
}
function singleRequest(url, { headers, signal }) {
  return new Promise((resolveResponse, reject) => {
    const req = httpsRequest(url, { method: 'GET', headers, signal, agent: false }, response => {
      resolveResponse({ status: response.statusCode, headers: response.headers, body: Readable.toWeb(response) });
    });
    req.once('error', reject); req.end();
  });
}
function header(response, name) {
  const value = typeof response.headers?.get === 'function' ? response.headers.get(name) : response.headers?.[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') fail('invalid_headers');
  return value;
}
function bodyHeaders(response, expected) {
  const encoding = header(response, 'content-encoding');
  if (encoding !== undefined && encoding.trim().toLowerCase() !== 'identity') fail('encoding_unsupported');
  const length = header(response, 'content-length');
  if (length === undefined) return undefined;
  if (!/^(0|[1-9][0-9]{0,9})$/.test(length)) fail('invalid_headers');
  const bytes = Number(length);
  if (expected !== undefined && bytes !== expected) fail('length_mismatch');
  return bytes;
}
function listedObject(page) {
  if (!page || !Array.isArray(page.blobs) || page.blobs.length > 1 || typeof page.hasMore !== 'boolean') fail('invalid_page');
  if (page.blobs.length === 0) fail('empty_listing');
  const row = page.blobs[0];
  if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.pathname !== 'string' ||
    !row.pathname || row.pathname.length > 1024 || /[\\\u0000-\u001f\u007f]/.test(row.pathname) ||
    typeof row.uploadedAt !== 'string' || !Number.isFinite(new Date(row.uploadedAt).getTime()) ||
    !Number.isSafeInteger(row.size) || row.size < 0 ||
    (row.etag !== undefined && (typeof row.etag !== 'string' || row.etag.length > 512))) fail('invalid_page');
  if (row.size > OIDC_BODY_PROBE_LIMITS.objectBytes) fail('object_size');
  let url;
  try {
    url = new URL(row.url);
    if (url.origin !== `https://${BLOB_PROBE_TARGET.storeId.slice(6).toLowerCase()}.private.blob.vercel-storage.com` ||
      url.username || url.password || url.search || url.hash || decodeURIComponent(url.pathname.slice(1)) !== row.pathname) fail('invalid_page');
  } catch { fail('invalid_page'); }
  url.searchParams.set('cache', '0');
  return { url, size: row.size, etag: row.etag };
}
function compareEtag(listed, response) {
  const received = header(response, 'etag');
  if (listed === undefined || received === undefined) return;
  // Identity normalization only: exact, quoted, strong ASCII entity tags.
  // Weak tags, unquoted hashes and quote-format changes stop this diagnostic.
  const strong = /^"[\x21\x23-\x7e]{1,256}"$/;
  if (!strong.test(listed) || !strong.test(received)) fail('etag_unsupported');
  if (listed !== received) fail('etag_mismatch');
}
async function absent(path, code) {
  try { await lstat(path); } catch (error) { if (error?.code === 'ENOENT') return; fail('destination_private'); }
  fail(code);
}
async function preflight(outputPath, attemptPath) {
  const output = resolve(outputPath), attempt = resolve(attemptPath), parent = dirname(output);
  if (output === attempt || dirname(attempt) !== parent) fail('invalid_options');
  try {
    const stat = await lstat(parent);
    if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700 ||
      (typeof process.getuid === 'function' && stat.uid !== process.getuid()) || await realpath(parent) !== parent) fail('destination_private');
  } catch { fail('destination_private'); }
  await absent(output, 'output_exists'); await absent(attempt, 'attempt_exists');
  try { return { output, attempt, parent, handle: await open(attempt, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600) }; }
  catch (error) { fail(error?.code === 'EEXIST' ? 'attempt_exists' : 'attempt_write'); }
}
async function writeRecord(handle, record, code) {
  try {
    const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
    for (let offset = 0; offset < bytes.length;) {
      const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset);
      if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0) fail(code);
      offset += bytesWritten;
    }
    await handle.truncate(bytes.length); await handle.sync();
  } catch { fail(code); }
}
async function syncDirectory(parent) {
  const handle = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}
function abortable(work, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolveWork, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(work).then(resolveWork, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

/** At most one LIST and one complete body, for this principal/store/time only. */
export async function probeBlobOidcBody({ token, outputPath, attemptPath, transport = singleRequest, signal, now = Date.now,
  headersMs = 15_000, bodyMs = 15_000, globalMs = 60_000 } = {}) {
  if (typeof outputPath !== 'string' || !outputPath || typeof attemptPath !== 'string' || !attemptPath ||
    typeof transport !== 'function' || typeof now !== 'function' || (signal !== undefined && !(signal instanceof AbortSignal)) ||
    ![headersMs, bodyMs, globalMs].every(value => Number.isSafeInteger(value) && value > 0) || headersMs > 15_000 || bodyMs > 15_000 || globalMs > 60_000) fail('invalid_options');
  credential(token, now); await protocol();
  const { output, attempt, parent, handle } = await preflight(outputPath, attemptPath);
  const record = { formatVersion: 1, status: 'running', credentialKind: 'oidc', scope: 'single_body_principal_store_time',
    operation: 'list_one_then_get_one', claimsValidation: 'decoded_not_signature_verified', signatureVerified: false,
    listAttempts: 0, objectAttempts: 0, listBodyBytes: 0, objectBodyBytes: 0, bodyComplete: false };
  const controller = new AbortController();
  const stop = error => { if (!controller.signal.aborted) controller.abort(safeError(error)); };
  const canceled = () => stop(new BlobOidcBodyProbeError('canceled'));
  let timer, globalTimer, activeResponse, temporary, temporaryHandle, published = false, outputIdentity, persistenceFailure;
  function failed(error) {
    const safe = safeError(error);
    record.status = ['auth_denied_inconclusive', 'http_status_inconclusive'].includes(safe.code) ? 'inconclusive' : 'failed';
    record.code = safe.code; record.bodyComplete = false;
  }
  async function repair() {
    const results = await Promise.allSettled([
      (async () => {
        const file = await open(attempt, constants.O_WRONLY | constants.O_NOFOLLOW);
        try { await writeRecord(file, record, 'attempt_write'); } finally { await file.close(); }
      })(),
      ...(published ? [(async () => {
        const file = await open(output, constants.O_WRONLY | constants.O_NOFOLLOW);
        try {
          const stat = await file.stat();
          if (stat.dev !== outputIdentity.dev || stat.ino !== outputIdentity.ino) fail('output_write');
          await writeRecord(file, record, 'output_write');
        } finally { await file.close(); }
      })()] : []),
    ]);
    if (results.some(result => result.status === 'rejected')) fail('attempt_write');
  }
  async function request(operation, url) {
    const counter = operation === 'list' ? 'listAttempts' : 'objectAttempts';
    if (controller.signal.aborted) throw controller.signal.reason;
    if (record[counter] !== 0) fail('request_budget');
    record[counter] = 1; await writeRecord(handle, record, 'attempt_write');
    credential(token, now);
    if (controller.signal.aborted) throw controller.signal.reason;
    const store = BLOB_PROBE_TARGET.storeId.slice(6);
    const headers = { authorization: `Bearer ${token}`, 'accept-encoding': 'identity' };
    if (operation === 'list') Object.assign(headers, { 'x-api-version': '13', 'x-vercel-blob-store-id': store,
      'x-api-blob-request-id': `${store}:${Date.now()}:${randomBytes(8).toString('hex')}`, 'x-api-blob-request-attempt': '0' });
    try {
      const pending = Promise.resolve(transport(url, { method: 'GET', redirect: 'error', headers, signal: controller.signal }));
      void pending.then(response => { if (controller.signal.aborted) void response?.body?.cancel().catch(() => {}); }, () => {});
      timer = setTimeout(() => stop(new BlobOidcBodyProbeError('headers_timeout')), headersMs);
      activeResponse = await abortable(pending, controller.signal);
      clearTimeout(timer);
      const status = activeResponse?.status;
      if (!Number.isInteger(status) || status < 100 || status > 599) fail('invalid_response');
      record[operation === 'list' ? 'listHttpStatus' : 'objectHttpStatus'] = status;
      if (status !== 200) fail([401, 403].includes(status) ? 'auth_denied_inconclusive' : status >= 300 && status < 400 ? 'redirect_denied' : 'http_status_inconclusive');
      return activeResponse;
    } catch (error) {
      throw controller.signal.aborted ? controller.signal.reason : error instanceof BlobOidcBodyProbeError ? error : new BlobOidcBodyProbeError('transport_error');
    } finally { clearTimeout(timer); }
  }
  async function consume(response, operation, expected) {
    const length = bodyHeaders(response, expected), cap = operation === 'list' ? 16_384 : 65_536;
    if (length !== undefined && length > cap) fail('response_too_large');
    if (!response.body || typeof response.body.getReader !== 'function') fail('response_body');
    const reader = response.body.getReader(), chunks = operation === 'list' ? [] : undefined;
    const counter = operation === 'list' ? 'listBodyBytes' : 'objectBodyBytes';
    timer = setTimeout(() => stop(new BlobOidcBodyProbeError('body_timeout')), bodyMs);
    try {
      while (true) {
        const { done, value } = await abortable(reader.read(), controller.signal);
        if (done) break;
        if (!(value instanceof Uint8Array)) fail('response_body');
        record[counter] += value.byteLength;
        if (record[counter] > cap) fail('response_too_large');
        if (expected !== undefined && record[counter] > expected) fail('length_mismatch');
        chunks?.push(value);
      }
      if ((expected !== undefined && record[counter] !== expected) || (length !== undefined && record[counter] !== length)) fail('length_mismatch');
      return chunks ? Buffer.concat(chunks) : undefined;
    } catch (error) {
      const safe = error instanceof BlobOidcBodyProbeError ? error : new BlobOidcBodyProbeError('response_body');
      stop(safe); void reader.cancel().catch(() => {}); throw safe;
    }
    finally { clearTimeout(timer); reader.releaseLock(); }
  }
  try {
    await writeRecord(handle, record, 'attempt_write'); await syncDirectory(parent);
    signal?.addEventListener('abort', canceled, { once: true }); if (signal?.aborted) canceled();
    globalTimer = setTimeout(() => stop(new BlobOidcBodyProbeError('global_timeout')), globalMs);
    try {
      const list = await request('list', new URL('https://vercel.com/api/blob?limit=1'));
      const bytes = await consume(list, 'list');
      let page;
      try { page = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('invalid_json'); }
      const item = listedObject(page);
      const object = await request('object', item.url);
      compareEtag(item.etag, object);
      await consume(object, 'object', item.size);
      record.status = 'retrieved'; record.code = 'body_retrieved'; record.bodyComplete = true;
    } catch (error) {
      stop(error); failed(controller.signal.reason); void activeResponse?.body?.cancel().catch(() => {});
    }
    if (controller.signal.aborted) failed(controller.signal.reason);
    temporary = resolve(parent, `.blob-oidc-body-${randomBytes(12).toString('hex')}.tmp`);
    temporaryHandle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await writeRecord(temporaryHandle, record, 'output_write'); outputIdentity = await temporaryHandle.stat();
    await temporaryHandle.close(); temporaryHandle = undefined;
    try { await link(temporary, output); } catch (error) { fail(error?.code === 'EEXIST' ? 'output_exists' : 'output_write'); }
    published = true; await syncDirectory(parent); await writeRecord(handle, record, 'attempt_write');
  } catch (error) {
    persistenceFailure = safeError(error); stop(error); failed(error);
    try { await writeRecord(handle, record, 'attempt_write'); } catch { persistenceFailure = new BlobOidcBodyProbeError('attempt_write'); }
  } finally {
    try {
      let cleanupCode;
      try { await temporaryHandle?.close(); } catch { cleanupCode = 'output_write'; }
      if (temporary) {
        try { await unlink(temporary); } catch (error) { if (error?.code !== 'ENOENT') { cleanupCode = 'output_write'; record.temporaryCleaned = false; } }
      }
      try { await handle.close(); } catch { cleanupCode = 'attempt_write'; }
      const interrupted = !persistenceFailure && controller.signal.aborted && record.code !== controller.signal.reason.code;
      if (cleanupCode || interrupted || (persistenceFailure && published)) {
        if (cleanupCode) { persistenceFailure = new BlobOidcBodyProbeError(cleanupCode); failed(persistenceFailure); }
        else if (interrupted) failed(controller.signal.reason);
        try { await repair(); } catch { persistenceFailure = new BlobOidcBodyProbeError('attempt_write'); }
      }
    } finally { clearTimeout(timer); clearTimeout(globalTimer); signal?.removeEventListener('abort', canceled); }
  }
  if (persistenceFailure) throw persistenceFailure;
  return { ...record };
}

export async function runBlobOidcBodyProbeCli(argv, { stdout = process.stdout, stderr = process.stderr, signal, run = probeBlobOidcBody } = {}) {
  try {
    if (argv.length !== 7 || argv[0] !== '--run') fail('cli_usage');
    const flags = new Map();
    for (let i = 1; i < argv.length; i += 2) {
      if (!['--oidc-json', '--output', '--attempt'].includes(argv[i]) || !argv[i + 1] || flags.has(argv[i])) fail('cli_usage');
      flags.set(argv[i], argv[i + 1]);
    }
    if (flags.size !== 3) fail('cli_usage');
    const token = await readBlobProbeCredential(flags.get('--oidc-json'), 'oidc');
    const result = await run({ token, outputPath: flags.get('--output'), attemptPath: flags.get('--attempt'), signal });
    const code = result.code === 'body_retrieved' || codes.has(result.code) ? result.code : 'probe_failed';
    stdout.write(`Blob OIDC body probe: ${code}; scope one body/principal/store/time.\nOIDC claims decoded; JWT signature not verified.\n`);
    return result.status === 'retrieved' && code === 'body_retrieved' && result.bodyComplete === true ? 0 : 2;
  } catch (error) { stderr.write(`Blob OIDC body probe failed (${safeError(error).code}).\n`); return 1; }
}
const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
if (invoked === import.meta.url) {
  const controller = new AbortController(), cancel = () => controller.abort();
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, cancel);
  process.exitCode = await runBlobOidcBodyProbeCli(process.argv.slice(2), { signal: controller.signal });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.removeListener(signal, cancel);
}
