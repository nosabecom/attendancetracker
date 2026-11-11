import { constants, openSync, closeSync, fstatSync, writeSync, ftruncateSync, fsyncSync } from 'node:fs';
import { lstat, realpath, open, link, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

export const KNOWN_ROSTER_STORE = 'store_raW6bHbRonffwrRf';
export const KNOWN_ROSTER_LIMITS = Object.freeze({ requests: 1, headerBytes: 16_384, bodyBytes: 65_536, headersMs: 15_000, bodyMs: 30_000, globalMs: 60_000 });
const codes = new Set(['invalid_options', 'invalid_target', 'invalid_token', 'destination_private', 'output_exists', 'attempt_exists', 'attempt_write', 'output_write', 'invalid_response', 'invalid_headers', 'encoding_unsupported', 'content_type', 'length_mismatch', 'response_too_large', 'response_body', 'invalid_json', 'invalid_roster', 'transport_error', 'response_status', 'redirect_denied', 'headers_timeout', 'body_timeout', 'global_timeout', 'canceled', 'rescue_failed']);
export class KnownRosterRescueError extends Error {
  constructor(code) { const safe = codes.has(code) ? code : 'rescue_failed'; super(`Known roster rescue failed (${safe}).`); this.name = 'KnownRosterRescueError'; this.code = safe; }
}
const fail = code => { throw new KnownRosterRescueError(code); };
const safeError = error => new KnownRosterRescueError(error instanceof KnownRosterRescueError ? error.code : 'rescue_failed');
const credential = token => { if (typeof token !== 'string' || !/^vercel_blob_rw_raW6bHbRonffwrRf_[A-Za-z0-9]{16,256}$/.test(token)) fail('invalid_token'); };
const timestamp = now => { const value = now(); if (!Number.isFinite(value)) fail('invalid_options'); return new Date(value).toISOString(); };
function privateTarget(value) {
  if (!object(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'classId') || !Object.hasOwn(value, 'revision')) fail('invalid_target');
  const { classId, revision } = value;
  if (typeof classId !== 'string' || !/^[a-f0-9]{32}$/.test(classId) || revision !== 2) fail('invalid_target');
  // The selected class identifier comes from the operator's private allocation,
  // never from this public source or an arbitrary URL. Host and path shape are fixed.
  return Object.freeze({ storeId: KNOWN_ROSTER_STORE, classId, revision: 2,
    url: `https://raw6bhbronffwrrf.private.blob.vercel-storage.com/classes/${classId}/versions/0000000002.json?cache=0` });
}

// One fixed-origin HTTPS request. No SDK/environment authentication, pooling,
// redirects or retries. Setting maxHeadersCount before end prevents Node's
// field-count truncation from hiding duplicate tail validators.
function singleRequest(url, { headers, signal }) {
  return new Promise((resolveResponse, reject) => {
    const req = httpsRequest(url, { method: 'GET', headers, signal, agent: false, maxHeaderSize: KNOWN_ROSTER_LIMITS.headerBytes }, response => {
      resolveResponse({ status: response.statusCode, rawHeaders: response.rawHeaders, body: Readable.toWeb(response), complete: () => response.complete });
    });
    req.maxHeadersCount = 0;
    req.once('error', reject); req.end();
  });
}
function headers(response) {
  if (!Array.isArray(response?.rawHeaders) || response.rawHeaders.length % 2) fail('invalid_headers');
  const values = new Map(), relevant = new Set(['content-length', 'content-encoding', 'content-type', 'etag']);
  let bytes = 0;
  for (let i = 0; i < response.rawHeaders.length; i += 2) {
    const name = response.rawHeaders[i], value = response.rawHeaders[i + 1];
    if (typeof name !== 'string' || typeof value !== 'string') fail('invalid_headers');
    bytes += Buffer.byteLength(name) + Buffer.byteLength(value) + 4;
    if (bytes > KNOWN_ROSTER_LIMITS.headerBytes) fail('invalid_headers');
    const key = name.toLowerCase();
    if (relevant.has(key)) { if (values.has(key)) fail('invalid_headers'); values.set(key, value); }
  }
  const encoding = values.get('content-encoding');
  if (encoding !== undefined && encoding.trim().toLowerCase() !== 'identity') fail('encoding_unsupported');
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(values.get('content-type') || '')) fail('content_type');
  const length = values.get('content-length');
  if (length === undefined) return undefined;
  if (!/^(0|[1-9][0-9]{0,9})$/.test(length)) fail('invalid_headers');
  const size = Number(length);
  if (size > KNOWN_ROSTER_LIMITS.bodyBytes) fail('response_too_large');
  return size;
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const segment = value => typeof value === 'string' && value.length > 0 && !/[\/\\\u0000-\u001f\u007f]/.test(value) && value !== '.' && value !== '..';
function roster(bytes) {
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('invalid_json'); }
  if (!object(value) || value.revision !== 2 ||
    !Object.keys(value).every(key => ['revision', 'students', 'teachers'].includes(key)) ||
    !Array.isArray(value.students) || value.students.length < 1 || value.students.length > 1000) fail('invalid_roster');
  const ids = new Set();
  for (const student of value.students) {
    if (!object(student) || Object.keys(student).length !== 3 || !['id', 'name', 'code'].every(key => Object.hasOwn(student, key)) ||
      !segment(student.id) || ids.has(student.id) || typeof student.name !== 'string' || !student.name.trim() || student.name.length > 160 ||
      typeof student.code !== 'string' || student.code.length > 160) fail('invalid_roster');
    ids.add(student.id);
  }
  if (value.teachers !== undefined && (!Array.isArray(value.teachers) || value.teachers.length > 50 || !value.teachers.every(teacher =>
    object(teacher) && Object.keys(teacher).length === 2 && segment(teacher.owner) && typeof teacher.username === 'string' && /^[a-z0-9._-]{3,40}$/.test(teacher.username)))) fail('invalid_roster');
  return value.students.length;
}
async function absent(path, code) {
  try { await lstat(path); } catch (error) { if (error?.code === 'ENOENT') return; fail('destination_private'); }
  fail(code);
}
async function destination(outputPath, provenancePath, attemptPath) {
  const paths = [outputPath, provenancePath, attemptPath].map(path => resolve(path));
  const parent = dirname(paths[0]);
  if (new Set(paths).size !== 3 || paths.some(path => dirname(path) !== parent)) fail('invalid_options');
  try {
    const stat = await lstat(parent);
    if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700 || stat.uid !== process.getuid() || await realpath(parent) !== parent) fail('destination_private');
  } catch { fail('destination_private'); }
  await absent(paths[0], 'output_exists'); await absent(paths[1], 'output_exists'); await absent(paths[2], 'attempt_exists');
  try {
    const handle = await open(paths[2], constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    return { output: paths[0], provenance: paths[1], attempt: paths[2], parent, handle, identity: await handle.stat() };
  } catch (error) { fail(error?.code === 'EEXIST' ? 'attempt_exists' : 'attempt_write'); }
}
async function persist(handle, value, code) {
  try {
    const bytes = Buffer.from(JSON.stringify(value) + '\n');
    for (let offset = 0; offset < bytes.length;) { const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset); if (!bytesWritten) fail(code); offset += bytesWritten; }
    await handle.truncate(bytes.length); await handle.sync();
  } catch { fail(code); }
}
async function syncDirectory(parent) { const file = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY); try { await file.sync(); } finally { await file.close(); } }
function abortable(work, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolveWork, reject) => {
    const aborted = () => reject(signal.reason); signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(work).then(resolveWork, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}
function repair(path, identity, record) {
  let fd;
  try {
    fd = openSync(path, constants.O_WRONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (stat.dev !== identity.dev || stat.ino !== identity.ino || !stat.isFile() || (stat.mode & 0o777) !== 0o600) fail('attempt_write');
    const bytes = Buffer.from(JSON.stringify(record) + '\n');
    for (let offset = 0; offset < bytes.length;) { const written = writeSync(fd, bytes, offset, bytes.length - offset, offset); if (!written) fail('attempt_write'); offset += written; }
    ftruncateSync(fd, bytes.length); fsyncSync(fd);
  } finally { if (fd !== undefined) closeSync(fd); }
}

/**
 * Rescue only this immutable historical revision. The private attempt and
 * provenance are authoritative; no captured file is a consistent full snapshot
 * or cutover input. No network occurs on import or failed preflight. A failed
 * attempt is retained and may not be replayed under another pathname.
 * Operational failures return safe aggregates; preflight and unrepaired
 * persistence errors throw. Target selection must be bound by the operator's
 * separate private allocation; the helper cannot verify that external approval.
 */
export async function rescueKnownRoster({ token, target: targetInput, outputPath, provenancePath, attemptPath, transport = singleRequest, signal,
  headersMs = KNOWN_ROSTER_LIMITS.headersMs, bodyMs = KNOWN_ROSTER_LIMITS.bodyMs, globalMs = KNOWN_ROSTER_LIMITS.globalMs, now = Date.now } = {}) {
  if (![outputPath, provenancePath, attemptPath].every(path => typeof path === 'string' && path) || typeof transport !== 'function' || typeof now !== 'function' ||
    (signal !== undefined && !(signal instanceof AbortSignal)) || ![headersMs, bodyMs, globalMs].every(value => Number.isSafeInteger(value) && value > 0) ||
    headersMs > KNOWN_ROSTER_LIMITS.headersMs || bodyMs > KNOWN_ROSTER_LIMITS.bodyMs || globalMs > KNOWN_ROSTER_LIMITS.globalMs) fail('invalid_options');
  credential(token); const target = privateTarget(targetInput);
  const startedAt = timestamp(now), destinationState = await destination(outputPath, provenancePath, attemptPath);
  const { output, provenance, attempt, parent, handle, identity } = destinationState;
  const record = { formatVersion: 1, allocation: 'ROSTERRESCUE1', classification: ['UNFROZEN', 'PROVISIONAL', 'NON-CANONICAL', 'NOT CUTOVER-READY'],
    target, limits: { ...KNOWN_ROSTER_LIMITS, headersMs, bodyMs, globalMs }, startedAt,
    status: 'running', objectAttempts: 0, receivedBodyBytes: 0, bodyComplete: false, rescueComplete: false, usableForCutover: false,
    snapshotPublished: false, provenancePublished: false };
  const controller = new AbortController();
  const stop = code => { if (!controller.signal.aborted) controller.abort(new KnownRosterRescueError(code)); };
  const canceled = () => stop('canceled');
  const check = () => { if (controller.signal.aborted) throw controller.signal.reason; };
  const failed = error => { record.status = 'failed'; record.code = safeError(error).code; record.bodyComplete = false; record.rescueComplete = false; };
  let globalTimer, phaseTimer, activeResponse, temporaryHandle, provenanceIdentity, persistentFailure;
  const temporaries = new Set();
  async function publish(path, bytes) {
    check();
    const temporary = resolve(parent, `.known-roster-${randomBytes(12).toString('hex')}.tmp`); temporaries.add(temporary);
    temporaryHandle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await temporaryHandle.writeFile(bytes); await temporaryHandle.sync();
    const stat = await temporaryHandle.stat(); await temporaryHandle.close(); temporaryHandle = undefined; check();
    try { await link(temporary, path); } catch { fail('output_write'); }
    if (path === output) record.snapshotPublished = true;
    else { record.provenancePublished = true; provenanceIdentity = stat; }
    await syncDirectory(parent); check();
  }
  try {
    signal?.addEventListener('abort', canceled, { once: true }); if (signal?.aborted) canceled();
    globalTimer = setTimeout(() => stop('global_timeout'), globalMs);
    await persist(handle, record, 'attempt_write'); await syncDirectory(parent); check();
    record.objectAttempts = 1; await persist(handle, record, 'attempt_write'); check();
    let pending;
    try { pending = Promise.resolve(transport(new URL(target.url), { method: 'GET', redirect: 'error',
      headers: { authorization: `Bearer ${token}`, 'accept-encoding': 'identity' }, signal: controller.signal })); }
    catch { fail('transport_error'); }
    void pending.then(response => { if (controller.signal.aborted) void response?.body?.cancel().catch(() => {}); }, () => {});
    phaseTimer = setTimeout(() => stop('headers_timeout'), headersMs);
    try { activeResponse = await abortable(pending, controller.signal); } catch (error) { throw controller.signal.aborted ? controller.signal.reason : new KnownRosterRescueError('transport_error'); }
    clearTimeout(phaseTimer);
    if (!Number.isInteger(activeResponse?.status) || activeResponse.status < 100 || activeResponse.status > 599) fail('invalid_response');
    record.httpStatus = activeResponse.status;
    if (activeResponse.status !== 200) fail(activeResponse.status >= 300 && activeResponse.status < 400 ? 'redirect_denied' : 'response_status');
    const length = headers(activeResponse);
    if (!activeResponse.body || typeof activeResponse.body.getReader !== 'function' || typeof activeResponse.complete !== 'function') fail('response_body');
    const reader = activeResponse.body.getReader(), chunks = [];
    phaseTimer = setTimeout(() => stop('body_timeout'), bodyMs);
    try {
      while (true) {
        const { done, value } = await abortable(reader.read(), controller.signal); if (done) break;
        if (!(value instanceof Uint8Array)) fail('response_body');
        record.receivedBodyBytes += value.byteLength;
        if (record.receivedBodyBytes > KNOWN_ROSTER_LIMITS.bodyBytes) fail('response_too_large');
        if (length !== undefined && record.receivedBodyBytes > length) fail('length_mismatch');
        chunks.push(value);
      }
      if (activeResponse.complete() !== true) fail('response_body');
      if (length !== undefined && record.receivedBodyBytes !== length) fail('length_mismatch');
    } catch (error) { void reader.cancel().catch(() => {}); throw error instanceof KnownRosterRescueError ? error : new KnownRosterRescueError('response_body'); }
    finally { clearTimeout(phaseTimer); reader.releaseLock(); }
    check();
    const bytes = Buffer.concat(chunks, record.receivedBodyBytes);
    record.studentCount = roster(bytes); record.finishedAt = timestamp(now); record.bodyComplete = true;
    await publish(output, bytes);
    record.status = 'rescued'; record.rescueComplete = true;
    // Mark the intended provenance publication inside that immutable JSON; the
    // authoritative attempt is not successful until both files are durable.
    await publish(provenance, Buffer.from(JSON.stringify({ ...record, provenancePublished: true }) + '\n'));
    await persist(handle, record, 'attempt_write'); check();
  } catch (error) {
    failed(controller.signal.aborted ? controller.signal.reason : error);
    stop(record.code);
    record.finishedAt = timestamp(now);
    try { await persist(handle, record, 'attempt_write'); } catch { persistentFailure = true; }
  } finally {
    let cleanupFailed = false;
    clearTimeout(phaseTimer);
    if (activeResponse?.body && !activeResponse.body.locked) void activeResponse.body.cancel().catch(() => {});
    try { await temporaryHandle?.close(); } catch { cleanupFailed = true; }
    for (const temporary of temporaries) { try { await unlink(temporary); } catch (error) { if (error?.code !== 'ENOENT') cleanupFailed = true; } }
    try { await handle.close(); } catch { persistentFailure = true; }
    if (cleanupFailed || persistentFailure || controller.signal.aborted) {
      failed(new KnownRosterRescueError(persistentFailure ? 'attempt_write' : cleanupFailed ? 'output_write' : controller.signal.reason.code));
      // Both repairs are attempted independently. No await separates the final
      // cancellation decision, synchronous repairs and listener removal.
      let repairFailed = false;
      try { repair(attempt, identity, record); } catch { repairFailed = true; }
      if (provenanceIdentity) { try { repair(provenance, provenanceIdentity, record); } catch { repairFailed = true; } }
      persistentFailure ||= repairFailed;
    }
    clearTimeout(globalTimer); signal?.removeEventListener('abort', canceled);
  }
  if (persistentFailure) fail('attempt_write');
  // Deliberately exclude filenames, identifiers, raw bytes, header values and
  // arbitrary errors. Private provenance retains the fixed class association.
  return { status: record.status, ...(record.code ? { code: record.code } : {}), objectAttempts: record.objectAttempts,
    receivedBodyBytes: record.receivedBodyBytes, bodyComplete: record.bodyComplete, rescueComplete: record.rescueComplete,
    usableForCutover: false, ...(record.httpStatus ? { httpStatus: record.httpStatus } : {}), ...(record.studentCount ? { studentCount: record.studentCount } : {}) };
}
