import { constants, openSync, closeSync, writeSync, fsyncSync } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { SOURCE_AUDIT_TARGET } from './audit-blob-deployment-sources.mjs';

export const DEPLOYMENT_CONFIG_PATHS = Object.freeze(['src/package.json', 'src/package-lock.json', 'src/next-env.d.ts', 'src/tsconfig.json']);
export const DEPLOYMENT_CONFIG_LIMITS = Object.freeze({ requests: 12, concurrency: 2, headerBytes: 16_384, responseBytes: 1_048_576,
  fileBytes: 262_144, totalResponseBytes: 4_194_304, headersMs: 15_000, bodyMs: 20_000, globalMs: 120_000 });
const codes = new Set(['invalid_options', 'invalid_manifest', 'private_path', 'occupied_path', 'persistence_failed', 'request_budget',
  'transport_error', 'http_status', 'invalid_response', 'response_limit', 'invalid_content', 'headers_timeout', 'body_timeout', 'global_timeout', 'cancelled', 'capture_failed']);
export class DeploymentConfigCaptureError extends Error {
  constructor(code) { const safe = codes.has(code) ? code : 'capture_failed'; super(`Deployment configuration capture stopped (${safe}).`); this.code = safe; }
}
const fail = code => { throw new DeploymentConfigCaptureError(code); };
const safeCode = error => new DeploymentConfigCaptureError(error instanceof DeploymentConfigCaptureError ? error.code : 'capture_failed').code;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
function validateManifest(input) {
  let m; try { m = JSON.parse(JSON.stringify(input)); } catch { fail('invalid_manifest'); }
  const keys = ['formatVersion', 'allocation', 'teamId', 'projectId', 'sourceCommit', 'sourceManifest', 'sourceManifestFingerprint', 'previousControlCalls', 'controlCallCeiling', 'priorContentInventory', 'selections'];
  if (!object(m) || Object.keys(m).length !== keys.length || !keys.every(key => Object.hasOwn(m, key)) || m.formatVersion !== 1 || m.allocation !== 'CLISOURCECONFIG1' ||
    m.teamId !== SOURCE_AUDIT_TARGET.teamId || m.projectId !== SOURCE_AUDIT_TARGET.projectId || !/^[a-f0-9]{40}$/.test(m.sourceCommit) ||
    m.previousControlCalls !== 26 || m.controlCallCeiling !== 66 || !/^[a-f0-9]{64}$/.test(m.sourceManifestFingerprint) ||
    !object(m.sourceManifest) || hash(JSON.stringify(m.sourceManifest)) !== m.sourceManifestFingerprint || m.sourceManifest.formatVersion !== 1 ||
    m.sourceManifest.allocation !== 'CLISOURCE1' || m.sourceManifest.teamId !== m.teamId || m.sourceManifest.projectId !== m.projectId ||
    !Array.isArray(m.sourceManifest.deployments) || m.sourceManifest.deployments.length !== 3 || !Array.isArray(m.priorContentInventory) || m.priorContentInventory.length !== 20 ||
    !Array.isArray(m.selections) || m.selections.length !== 12) fail('invalid_manifest');
  const deployments = new Set();
  for (const d of m.sourceManifest.deployments) {
    if (!object(d) || !/^dpl_[A-Za-z0-9]{8,64}$/.test(d.id) || deployments.has(d.id) || d.ownerId !== m.teamId || d.projectId !== m.projectId ||
      d.source !== 'cli' || d.gitDirty !== true || d.readyState !== 'READY') fail('invalid_manifest');
    deployments.add(d.id);
  }
  const paths = new Set(), identifiers = new Set();
  for (const [selected, rows] of [[false, m.priorContentInventory], [true, m.selections]]) for (const row of rows) {
    if (!object(row) || Object.keys(row).length !== 3 || !deployments.has(row.deploymentId) || !uid(row.uid) || typeof row.path !== 'string' ||
      (selected ? !DEPLOYMENT_CONFIG_PATHS.includes(row.path) : !/^(?:src\/)?(?:app|lib)\/.+\.(?:[cm]?[jt]sx?|json)$/.test(row.path)) || row.path.length > 1024 || /[\\\u0000-\u001f\u007f]/.test(row.path) ||
      row.path.split('/').some(part => part === '.' || part === '..') || /(?:^|\/)(?:\.env|secrets?|credentials?|outputs?|node_modules)(?:[./]|$)/i.test(row.path)) fail('invalid_manifest');
    const path = `${row.deploymentId}:${row.path}`, identifier = `${row.deploymentId}:${row.uid}`;
    if (paths.has(path) || identifiers.has(identifier)) fail('invalid_manifest'); paths.add(path); identifiers.add(identifier);
  }
  for (const id of deployments) if (DEPLOYMENT_CONFIG_PATHS.some(path => !m.selections.some(row => row.deploymentId === id && row.path === path))) fail('invalid_manifest');
  return m;
}
function singleRequest(url, { headers, signal }) {
  return new Promise((yes, no) => {
    const req = httpsRequest(url, { method: 'GET', headers, signal, agent: false, maxHeaderSize: DEPLOYMENT_CONFIG_LIMITS.headerBytes }, res =>
      yes({ status: res.statusCode, rawHeaders: res.rawHeaders, body: Readable.toWeb(res), complete: () => res.complete }));
    req.maxHeadersCount = 0; req.once('error', no); req.end();
  });
}
function responseLength(response) {
  if (!Array.isArray(response.rawHeaders) || response.rawHeaders.length % 2) fail('invalid_response');
  const values = new Map(); let bytes = 0;
  for (let i = 0; i < response.rawHeaders.length; i += 2) {
    const [name, value] = response.rawHeaders.slice(i, i + 2); if (typeof name !== 'string' || typeof value !== 'string') fail('invalid_response');
    bytes += Buffer.byteLength(name) + Buffer.byteLength(value) + 4; if (bytes > DEPLOYMENT_CONFIG_LIMITS.headerBytes) fail('invalid_response');
    const key = name.toLowerCase(); if (!['content-length', 'content-encoding'].includes(key)) continue;
    if (values.has(key)) fail('invalid_response'); values.set(key, value);
  }
  const length = values.get('content-length'), encoding = values.get('content-encoding');
  if ((encoding !== undefined && encoding !== 'identity') || (length !== undefined && !/^(0|[1-9][0-9]{0,9})$/.test(length))) fail('invalid_response');
  if (length !== undefined && Number(length) > DEPLOYMENT_CONFIG_LIMITS.responseBytes) fail('response_limit');
  return length === undefined ? undefined : Number(length);
}
function decoded(bytes) {
  let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('invalid_content'); }
  const encoded = typeof value === 'string' ? value : object(value) && Object.keys(value).every(key => ['data', 'encoding'].includes(key)) &&
    (value.encoding === undefined || value.encoding === 'base64') ? value.data : undefined;
  if (typeof encoded !== 'string' || encoded.length > Math.ceil(DEPLOYMENT_CONFIG_LIMITS.fileBytes / 3) * 4 || encoded.length % 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) fail('invalid_content');
  const raw = Buffer.from(encoded, 'base64'); if (raw.length > DEPLOYMENT_CONFIG_LIMITS.fileBytes || raw.toString('base64') !== encoded) fail('invalid_content');
  let content; try { content = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { fail('invalid_content'); }
  return { content, bytes: raw.length, sha256: hash(raw) };
}
async function directorySync(directory) { const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY); try { await handle.sync(); } finally { await handle.close(); } }
async function immutable(directory, name, value) {
  let handle;
  try {
    handle = await open(join(directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const bytes = Buffer.from(JSON.stringify(value) + '\n');
    for (let offset = 0; offset < bytes.length;) { const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset); if (bytesWritten <= 0) fail('persistence_failed'); offset += bytesWritten; }
    await handle.sync(); await handle.close(); handle = undefined; await directorySync(directory);
  } catch { fail('persistence_failed'); } finally { await handle?.close().catch(() => {}); }
}
function immutableSync(directory, name, value) {
  let fd, parent; try {
    fd = openSync(join(directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const bytes = Buffer.from(JSON.stringify(value) + '\n'); for (let offset = 0; offset < bytes.length;) { const n = writeSync(fd, bytes, offset, bytes.length - offset, offset); if (n <= 0) fail('persistence_failed'); offset += n; }
    fsyncSync(fd); closeSync(fd); fd = undefined; parent = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY); fsyncSync(parent);
  } catch { fail('persistence_failed'); } finally { if (fd !== undefined) closeSync(fd); if (parent !== undefined) closeSync(parent); }
}
function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((yes, no) => {
    const cancelled = () => no(signal.reason); signal.addEventListener('abort', cancelled, { once: true });
    Promise.resolve(promise).then(yes, no).finally(() => signal.removeEventListener('abort', cancelled));
  });
}

/** Import-only data capture. The operator binds this reviewed manifest to retained
 * trees/receipts. The helper neither discovers files nor proves writer freeze. */
export async function captureDeploymentConfigs({ manifest, token, outputDirectory, signal, transport = singleRequest,
  headersMs = 15_000, bodyMs = 20_000, globalMs = 120_000 } = {}) {
  if (typeof outputDirectory !== 'string' || !outputDirectory || typeof token !== 'string' || !/^[A-Za-z0-9._~+/-]{16,16384}={0,2}$/.test(token) || typeof transport !== 'function' ||
    (signal !== undefined && !(signal instanceof AbortSignal)) || [headersMs, bodyMs, globalMs].some((n, i) => !Number.isSafeInteger(n) || n <= 0 || n > [15_000, 20_000, 120_000][i])) fail('invalid_options');
  const m = validateManifest(manifest), directory = resolve(outputDirectory);
  try { const stat = await lstat(directory); if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700 || await realpath(directory) !== directory) fail('private_path'); }
  catch { fail('private_path'); }
  const names = ['ALLOCATION.json', 'RESULT.json', ...Array.from({ length: 12 }, (_, i) => [`reservation-${i + 1}.json`, `config-${i + 1}.json`]).flat()];
  for (const name of names) { try { await lstat(join(directory, name)); } catch (error) { if (error?.code === 'ENOENT') continue; fail('private_path'); } fail('occupied_path'); }
  const controller = new AbortController(), state = { allocation: 'CLISOURCECONFIG1', status: 'running', priorControlCalls: 26, controlCallCeiling: 66,
    reservedRequests: 0, transportCalls: 0, capturedFiles: 0, sourceBytes: 0, responseBytes: 0, writerFreezeProven: false, configSafetyReviewed: false, cancelled: false };
  const stop = code => { if (!controller.signal.aborted) controller.abort(new DeploymentConfigCaptureError(code)); };
  const cancelled = () => { state.cancelled = true; stop('cancelled'); };
  const check = () => { if (controller.signal.aborted) throw controller.signal.reason; };
  let queue = Promise.resolve(), next = 0, timer;
  async function capture(index) {
    const selected = m.selections[index];
    const reservation = queue.then(async () => {
      check(); if (state.reservedRequests >= 12 || 26 + state.reservedRequests + 1 > 66) fail('request_budget');
      const ordinal = ++state.reservedRequests;
      try { await immutable(directory, `reservation-${ordinal}.json`, { allocation: m.allocation, ordinal, cumulativeReservedControlCalls: 26 + ordinal, selectionIndex: index + 1, ...selected }); }
      catch { stop('persistence_failed'); fail('persistence_failed'); }
    }); queue = reservation.catch(() => {}); await reservation; check();
    const url = new URL(`/v8/deployments/${encodeURIComponent(selected.deploymentId)}/files/${encodeURIComponent(selected.uid)}`, 'https://api.vercel.com'); url.searchParams.set('teamId', m.teamId);
    let phaseTimer, response, reader;
    try {
      check(); state.transportCalls++;
      const pending = Promise.resolve(transport(url, { method: 'GET', redirect: 'error', headers: { authorization: `Bearer ${token}`, 'accept-encoding': 'identity' }, signal: controller.signal }));
      void pending.then(value => { if (controller.signal.aborted) void value?.body?.cancel().catch(() => {}); }, () => {});
      phaseTimer = setTimeout(() => stop('headers_timeout'), headersMs); response = await abortable(pending, controller.signal); clearTimeout(phaseTimer);
      if (response?.status !== 200) fail('http_status'); const length = responseLength(response);
      if (!response.body || typeof response.body.getReader !== 'function' || typeof response.complete !== 'function') fail('invalid_response');
      reader = response.body.getReader(); const chunks = []; let bytes = 0; phaseTimer = setTimeout(() => stop('body_timeout'), bodyMs);
      while (true) { const item = await abortable(reader.read(), controller.signal); if (item.done) break;
        if (!(item.value instanceof Uint8Array)) fail('invalid_response'); bytes += item.value.byteLength; state.responseBytes += item.value.byteLength;
        if (bytes > DEPLOYMENT_CONFIG_LIMITS.responseBytes || state.responseBytes > DEPLOYMENT_CONFIG_LIMITS.totalResponseBytes) fail('response_limit'); chunks.push(item.value); }
      if (response.complete() !== true || (length !== undefined && bytes !== length)) fail('invalid_response'); check();
      const file = decoded(Buffer.concat(chunks, bytes)); check();
      await immutable(directory, `config-${index + 1}.json`, { formatVersion: 1, ...selected, ...file }); check();
      state.capturedFiles++; state.sourceBytes += file.bytes;
    } catch (error) { stop(error instanceof DeploymentConfigCaptureError ? error.code : 'transport_error'); throw controller.signal.reason; }
    finally { clearTimeout(phaseTimer); if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); } else if (response?.body) void response.body.cancel().catch(() => {}); }
  }
  signal?.addEventListener('abort', cancelled, { once: true }); if (signal?.aborted) cancelled(); timer = setTimeout(() => stop('global_timeout'), globalMs);
  try {
    await immutable(directory, 'ALLOCATION.json', { ...m, manifestFingerprint: hash(JSON.stringify(m)), limits: { ...DEPLOYMENT_CONFIG_LIMITS, headersMs, bodyMs, globalMs }, startedAt: new Date().toISOString() }); check();
    await Promise.allSettled(Array.from({ length: 2 }, async () => { while (!controller.signal.aborted) { const index = next++; if (index >= 12) return; try { await capture(index); } catch { return; } } }));
    check(); if (state.capturedFiles !== 12) fail('capture_failed'); state.status = 'captured'; state.code = 'configs_captured';
  } catch (error) { state.status = 'failed'; state.code = controller.signal.aborted ? safeCode(controller.signal.reason) : safeCode(error); }
  finally {
    await queue; if (controller.signal.aborted) { state.status = 'failed'; state.code = safeCode(controller.signal.reason); }
    state.cumulativeReservedControlCalls = 26 + state.reservedRequests;
    // Immutable final record: no asynchronous boundary after cancellation check.
    try { immutableSync(directory, 'RESULT.json', { ...state, finishedAt: new Date().toISOString() }); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', cancelled); }
  }
  return { ...state };
}
