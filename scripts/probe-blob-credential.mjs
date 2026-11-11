import { constants } from 'node:fs';
import { lstat, open, readFile, realpath, link, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { parseEnv } from 'node:util';

export const BLOB_PROBE_TARGET = Object.freeze({
  storeId: 'store_raW6bHbRonffwrRf',
  projectId: 'prj_uOMK1a4PLAgsDr1A16InuImM1M3q',
  teamId: 'team_fmwIPLne9w30y7G5JQrs3fzl',
});
export const BLOB_PROBE_LIMITS = Object.freeze({ requests: 1, bodyBytes: 16 * 1024, headersMs: 15_000, bodyMs: 15_000, globalMs: 30_000 });
// Installed SDK getBlobError() distinguishes suspension from access denial.
// Retain only these fixed codes, never provider messages or discovered values.
const providerCodes = new Set(['forbidden', 'store_suspended', 'store_not_found',
  'oidc_environment_not_allowed', 'client_token_expired', 'rate_limited',
  'service_unavailable', 'not_allowed', 'unknown_error', 'bad_request']);
const codes = new Set([
  'invalid_options', 'invalid_token', 'store_mismatch', 'oidc_claims', 'oidc_expiry',
  'protocol_version', 'credential_private', 'credential_format', 'destination_private',
  'output_exists', 'attempt_exists', 'attempt_write', 'output_write', 'transport_error',
  'invalid_response', 'response_body', 'response_too_large', 'invalid_json', 'invalid_page',
  'auth_denied_inconclusive', 'http_status_inconclusive', 'redirect_denied',
  'headers_timeout', 'body_timeout', 'global_timeout', 'canceled', 'cli_usage',
]);
export class BlobCredentialProbeError extends Error {
  constructor(code, httpStatus) {
    const safe = codes.has(code) ? code : 'probe_failed';
    super(`Blob credential probe failed (${safe}).`);
    this.name = 'BlobCredentialProbeError';
    this.code = safe;
    if (Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) this.httpStatus = httpStatus;
  }
}
const fail = (code, status) => { throw new BlobCredentialProbeError(code, status); };
const safeError = error => new BlobCredentialProbeError(error instanceof BlobCredentialProbeError ? error.code : 'probe_failed', error instanceof BlobCredentialProbeError ? error.httpStatus : undefined);

// Primary local source: @vercel/blob 2.8.2 dist/index.js list(), and
// dist/chunk-XKVPKJPO.js requestApi()/BLOB_API_VERSION. This is the documented
// SDK LIST endpoint: it can return ONE metadata row; it is not a no-list probe.
// The SDK's default list retries and ambient OIDC/account auth are not used.
async function protocol() {
  try {
    const entry = createRequire(import.meta.url).resolve('@vercel/blob');
    if (JSON.parse(await readFile(resolve(dirname(entry), '..', 'package.json'), 'utf8')).version !== '2.8.2') fail('protocol_version');
  } catch { fail('protocol_version'); }
}
function singleRequest(url, { headers, signal }) {
  return new Promise((resolveResponse, reject) => {
    const req = httpsRequest(url, { method: 'GET', headers, signal, agent: false }, response => {
      resolveResponse({ status: response.statusCode, body: Readable.toWeb(response) });
    });
    req.once('error', reject);
    req.end();
  });
}
function credential({ kind, token, expectedStoreId, expectedProjectId, expectedTeamId, now }) {
  if (!['rw', 'oidc'].includes(kind) || !/^store_[A-Za-z0-9]{16}$/.test(expectedStoreId) ||
    !/^prj_[A-Za-z0-9]{8,64}$/.test(expectedProjectId) || !/^team_[A-Za-z0-9]{8,64}$/.test(expectedTeamId)) fail('invalid_options');
  if (typeof token !== 'string' || token.length > 16_384) fail('invalid_token');
  if (kind === 'rw') {
    const match = /^vercel_blob_rw_([A-Za-z0-9]{16})_[A-Za-z0-9]{16,256}$/.exec(token);
    if (!match) fail('invalid_token');
    if (`store_${match[1]}` !== expectedStoreId) fail('store_mismatch');
    return;
  }
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) fail('invalid_token');
  let claims;
  try { claims = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(token.split('.')[1], 'base64url'))); }
  catch { fail('oidc_claims'); }
  if (!claims || Array.isArray(claims) || claims.project_id !== expectedProjectId || claims.owner_id !== expectedTeamId || claims.environment !== 'development') fail('oidc_claims');
  const time = now();
  if (!Number.isFinite(time) || !Number.isSafeInteger(claims.exp) || claims.exp * 1000 - time < 30_000 ||
    (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf * 1000 > time))) fail('oidc_expiry');
  // Decoding and matching claims DOES NOT verify the JWT signature or issuer.
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
  await absent(output, 'output_exists');
  await absent(attempt, 'attempt_exists');
  try {
    return { output, attempt, parent, handle: await open(attempt, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600) };
  } catch (error) { fail(error?.code === 'EEXIST' ? 'attempt_exists' : 'attempt_write'); }
}
async function writeRecord(handle, record, code) {
  try {
    const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
    for (let offset = 0; offset < bytes.length;) {
      const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset);
      if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0) fail(code);
      offset += bytesWritten;
    }
    await handle.truncate(bytes.length);
    await handle.sync();
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

/** One credential, one store, one time. No global revocation inference. */
export async function probeBlobCredential({
  kind, token, outputPath, attemptPath,
  expectedStoreId = BLOB_PROBE_TARGET.storeId, expectedProjectId = BLOB_PROBE_TARGET.projectId, expectedTeamId = BLOB_PROBE_TARGET.teamId,
  transport = singleRequest, signal, now = Date.now,
  headersMs = BLOB_PROBE_LIMITS.headersMs, bodyMs = BLOB_PROBE_LIMITS.bodyMs, globalMs = BLOB_PROBE_LIMITS.globalMs,
} = {}) {
  if (typeof outputPath !== 'string' || !outputPath || typeof attemptPath !== 'string' || !attemptPath ||
    typeof transport !== 'function' || typeof now !== 'function' || (signal !== undefined && !(signal instanceof AbortSignal)) ||
    ![headersMs, bodyMs, globalMs].every(value => Number.isSafeInteger(value) && value > 0) ||
    headersMs > 15_000 || bodyMs > 15_000 || globalMs > 30_000) fail('invalid_options');
  const auth = { kind, token, expectedStoreId, expectedProjectId, expectedTeamId, now };
  credential(auth);
  await protocol();
  const { output, attempt, parent, handle } = await preflight(outputPath, attemptPath);
  const record = {
    formatVersion: 1, status: 'running', credentialKind: kind,
    scope: 'single_credential_store_time', operation: 'list_limit_1_metadata',
    ...(kind === 'oidc' ? { claimsValidation: 'decoded_not_signature_verified', signatureVerified: false } : { credentialValidation: 'local_store_match' }),
    requestAttempts: 0, responseBodyBytes: 0,
  };
  const controller = new AbortController();
  const stop = error => { if (!controller.signal.aborted) controller.abort(safeError(error)); };
  const canceled = () => stop(new BlobCredentialProbeError('canceled'));
  let timer, globalTimer, temporary, temporaryHandle, published = false, outputIdentity, persistenceFailure;
  function failed(error) {
    const safe = safeError(error);
    record.status = ['auth_denied_inconclusive', 'http_status_inconclusive'].includes(safe.code) ? 'inconclusive' : 'failed';
    record.code = safe.code;
    if (safe.httpStatus !== undefined) record.httpStatus = safe.httpStatus;
    delete record.metadataRowsObserved;
  }
  async function repair() {
    const results = await Promise.allSettled([
      (async () => {
        const attemptHandle = await open(attempt, constants.O_WRONLY | constants.O_NOFOLLOW);
        try { await writeRecord(attemptHandle, record, 'attempt_write'); } finally { await attemptHandle.close(); }
      })(),
      ...(published ? [(async () => {
        const outputHandle = await open(output, constants.O_WRONLY | constants.O_NOFOLLOW);
        try {
          const stat = await outputHandle.stat();
          if (stat.dev !== outputIdentity.dev || stat.ino !== outputIdentity.ino) fail('output_write');
          await writeRecord(outputHandle, record, 'output_write');
        } finally { await outputHandle.close(); }
      })()] : []),
    ]);
    if (results.some(result => result.status === 'rejected')) fail('attempt_write');
  }
  async function readBoundedBody(body) {
    if (!body || typeof body.getReader !== 'function') fail('response_body');
    const reader = body.getReader(), chunks = [];
    timer = setTimeout(() => stop(new BlobCredentialProbeError('body_timeout')), bodyMs);
    try {
      while (true) {
        const { done, value } = await abortable(reader.read(), controller.signal);
        if (done) break;
        if (!(value instanceof Uint8Array)) fail('response_body');
        record.responseBodyBytes += value.byteLength;
        if (record.responseBodyBytes > BLOB_PROBE_LIMITS.bodyBytes) fail('response_too_large');
        chunks.push(value);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      stop(error); void reader.cancel().catch(() => {}); throw error;
    } finally { clearTimeout(timer); reader.releaseLock(); }
  }
  try {
    await writeRecord(handle, record, 'attempt_write');
    await syncDirectory(parent);
    signal?.addEventListener('abort', canceled, { once: true });
    if (signal?.aborted) canceled();
    globalTimer = setTimeout(() => stop(new BlobCredentialProbeError('global_timeout')), globalMs);
    try {
      if (controller.signal.aborted) throw controller.signal.reason;
      record.requestAttempts = 1;
      await writeRecord(handle, record, 'attempt_write');
      credential(auth); // OIDC must still have >=30 seconds remaining at dispatch.
      if (controller.signal.aborted) throw controller.signal.reason;
      const store = expectedStoreId.slice(6);
      const pending = Promise.resolve(transport(new URL('https://vercel.com/api/blob?limit=1'), {
        method: 'GET', redirect: 'error', signal: controller.signal,
        headers: {
          authorization: `Bearer ${token}`, 'x-api-version': '13', 'x-vercel-blob-store-id': store,
          'x-api-blob-request-id': `${store}:${Date.now()}:${randomBytes(8).toString('hex')}`,
          'x-api-blob-request-attempt': '0',
        },
      }));
      void pending.then(response => { if (controller.signal.aborted) void response?.body?.cancel().catch(() => {}); }, () => {});
      timer = setTimeout(() => stop(new BlobCredentialProbeError('headers_timeout')), headersMs);
      let response;
      try { response = await abortable(pending, controller.signal); }
      catch (error) { throw controller.signal.aborted ? controller.signal.reason : new BlobCredentialProbeError('transport_error'); }
      clearTimeout(timer);
      if (!Number.isInteger(response?.status) || response.status < 100 || response.status > 599) fail('invalid_response');
      record.httpStatus = response.status;
      if (response.status !== 200) {
        if (kind === 'rw' && [401, 403].includes(response.status)) {
          const bytes = await readBoundedBody(response.body);
          let providerCode;
          try { providerCode = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))?.error?.code; }
          catch { /* An unreadable provider error remains inconclusive. */ }
          record.providerCode = providerCodes.has(providerCode) ? providerCode : 'unrecognized';
        } else {
          void response.body?.cancel().catch(() => {});
        }
        fail([401, 403].includes(response.status) ? 'auth_denied_inconclusive' : response.status >= 300 && response.status < 400 ? 'redirect_denied' : 'http_status_inconclusive', response.status);
      }
      const bytes = await readBoundedBody(response.body);
      let page;
      try { page = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { fail('invalid_json'); }
      if (!page || !Array.isArray(page.blobs) || page.blobs.length > 1 || typeof page.hasMore !== 'boolean') fail('invalid_page');
      for (const row of page.blobs) {
        if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.pathname !== 'string' ||
          !row.pathname || row.pathname.length > 1024 || /[\\\u0000-\u001f\u007f]/.test(row.pathname) ||
          !Number.isSafeInteger(row.size) || row.size < 0 || typeof row.uploadedAt !== 'string' ||
          !Number.isFinite(new Date(row.uploadedAt).getTime())) fail('invalid_page');
        try {
          const url = new URL(row.url);
          if (url.origin !== `https://${expectedStoreId.slice(6).toLowerCase()}.private.blob.vercel-storage.com` ||
            url.username || url.password || url.search || url.hash || decodeURIComponent(url.pathname.slice(1)) !== row.pathname) fail('invalid_page');
        } catch { fail('invalid_page'); }
      }
      record.status = 'accepted'; record.code = 'list_accepted'; record.metadataRowsObserved = page.blobs.length;
    } catch (error) { stop(error); failed(controller.signal.reason); }
    if (controller.signal.aborted) failed(controller.signal.reason);
    temporary = resolve(parent, `.blob-probe-${randomBytes(12).toString('hex')}.tmp`);
    temporaryHandle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await writeRecord(temporaryHandle, record, 'output_write');
    outputIdentity = await temporaryHandle.stat();
    await temporaryHandle.close(); temporaryHandle = undefined;
    try { await link(temporary, output); }
    catch (error) { fail(error?.code === 'EEXIST' ? 'output_exists' : 'output_write'); }
    published = true;
    await syncDirectory(parent);
    await writeRecord(handle, record, 'attempt_write');
  } catch (error) {
    persistenceFailure = safeError(error);
    stop(error); failed(error);
    try { await writeRecord(handle, record, 'attempt_write'); } catch { persistenceFailure = new BlobCredentialProbeError('attempt_write'); }
  } finally {
    try {
      let cleanupCode;
      try { await temporaryHandle?.close(); } catch { cleanupCode = 'output_write'; }
      if (temporary) {
        try { await unlink(temporary); }
        catch (error) { if (error?.code !== 'ENOENT') { cleanupCode = 'output_write'; record.temporaryCleaned = false; } }
      }
      try { await handle.close(); } catch { cleanupCode = 'attempt_write'; }
      const interrupted = !persistenceFailure && controller.signal.aborted && record.code !== controller.signal.reason.code;
      if (cleanupCode || interrupted || (persistenceFailure && published)) {
        if (cleanupCode) { persistenceFailure = new BlobCredentialProbeError(cleanupCode); failed(persistenceFailure); }
        else if (interrupted) failed(controller.signal.reason);
        try { await repair(); } catch { persistenceFailure = new BlobCredentialProbeError('attempt_write'); }
      }
    } finally {
      clearTimeout(timer); clearTimeout(globalTimer);
      signal?.removeEventListener('abort', canceled);
    }
  }
  if (persistenceFailure) throw persistenceFailure;
  return { ...record };
}

/** Read only a bounded, owner-owned 0600 file without following symlinks. */
export async function readBlobProbeCredential(path, kind) {
  if (typeof path !== 'string' || !path || !['rw', 'oidc'].includes(kind)) fail('invalid_options');
  let handle;
  try {
    const full = resolve(path), before = await lstat(full);
    if (!before.isFile() || (before.mode & 0o777) !== 0o600 || before.size > 65_536 ||
      (typeof process.getuid === 'function' && before.uid !== process.getuid()) || await realpath(full) !== full) fail('credential_private');
    handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
    const actual = await handle.stat();
    if (actual.dev !== before.dev || actual.ino !== before.ino) fail('credential_private');
    const bytes = Buffer.alloc(65_537);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > 65_536) fail('credential_private');
    let value;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
      value = kind === 'rw' ? parseEnv(text).BLOB_READ_WRITE_TOKEN : JSON.parse(text).token;
    } catch { fail('credential_format'); }
    if (typeof value !== 'string' || !value) fail('credential_format');
    return value;
  } catch (error) { throw error instanceof BlobCredentialProbeError ? safeError(error) : new BlobCredentialProbeError('credential_private'); }
  finally { try { await handle?.close(); } catch { fail('credential_private'); } }
}

export async function runBlobCredentialProbeCli(argv, { stdout = process.stdout, stderr = process.stderr, signal, run = probeBlobCredential } = {}) {
  try {
    if (argv.length !== 7 || argv[0] !== '--run') fail('cli_usage');
    const flags = new Map();
    for (let i = 1; i < argv.length; i += 2) {
      if (!['--rw-env', '--oidc-json', '--output', '--attempt'].includes(argv[i]) || !argv[i + 1] || flags.has(argv[i])) fail('cli_usage');
      flags.set(argv[i], argv[i + 1]);
    }
    if (!flags.has('--output') || !flags.has('--attempt') || flags.has('--rw-env') === flags.has('--oidc-json')) fail('cli_usage');
    const kind = flags.has('--rw-env') ? 'rw' : 'oidc';
    const token = await readBlobProbeCredential(flags.get(kind === 'rw' ? '--rw-env' : '--oidc-json'), kind);
    const result = await run({ kind, token, outputPath: flags.get('--output'), attemptPath: flags.get('--attempt'), signal });
    const code = result.code === 'list_accepted' || codes.has(result.code) ? result.code : 'probe_failed';
    const status = Number.isInteger(result.httpStatus) && result.httpStatus >= 100 && result.httpStatus <= 599 ? result.httpStatus : undefined;
    stdout.write(`Blob credential probe: ${code}${status === undefined ? '' : ` (HTTP ${status})`}; scope single credential/store/time.\n`);
    if (kind === 'oidc') stdout.write('OIDC claims were decoded; JWT signature was not verified.\n');
    return result.status === 'accepted' ? 0 : 2;
  } catch (error) { stderr.write(`Blob credential probe failed (${safeError(error).code}).\n`); return 1; }
}
const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
if (invoked === import.meta.url) {
  const controller = new AbortController(), cancel = () => controller.abort();
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, cancel);
  process.exitCode = await runBlobCredentialProbeCli(process.argv.slice(2), { signal: controller.signal });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.removeListener(signal, cancel);
}
