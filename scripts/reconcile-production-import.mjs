#!/usr/bin/env node
/**
 * Offline by default; --apply uses a single, non-renewable read-only allocation.
 * Usage: --input PRIVATE_FROZEN [--apply --plan PRIVATE_PLAN --key-file PRIVATE_KEY --ledger PRIVATE_EMPTY_DIRECTORY]
 *
 * The private plan and 0700 ledger MUST have the fixed private parent
 * ~/.local/state/attendance-production-reconciliation (which must already exist,
 * be 0700, owned by the operator, and resolve to itself). The permanent exclusive
 * marker in that parent consumes this allocation even on failure. Never delete it
 * to retry. There is no resume, retry, recovery, cleanup, or reset. Reservations
 * are made durable before each possible physical request. Provider billing and
 * internal work are unknown and are not bounded by these client-side limits.
 *
 * Plan shape: {formatVersion:1,allocation:'PRODUCTION_RECONCILIATION1',target,
 * source,code,readerDigest,comparatorDigest,ledgerDirectory,budgets,gates}.
 * target/source/code are PRODUCTION_TARGET, describeSource(raw).source, and
 * sourceBinding(). Reader and comparator digests are SHA256 of these scripts.
 * budgets is RECONCILIATION_LIMITS. gates: {source:{reviewed,evidenceDigest,
 * continuousHold}, import:{reviewed,evidenceDigest,applicationCalls:36,
 * verificationCalls:21,logicalWrites:755,phase:'active-readonly'}, quota:{reviewed,
 * evidenceDigest,team,plan:'CONVEX_BASE',source,observedAt,allProjects:true,
 * timezone:'UTC',billingPeriod:{start,end},resources:{functionCalls,databaseIoGb,
 * databaseStorageGb}}, capability:{reviewed,evidenceDigest,rawSha256}}. Each
 * resource is {used,limit}; values require RECONCILIATION_HEADROOM. Source of
 * quota must be convex-dashboard-user-report or convex-dashboard-agent-observation.
 * These JSON assertions are NOT provider attestations: the operator must review
 * genuine external evidence, bind it by digest, and maintain the administrative
 * source/gateway/backend write hold continuously. Cross-query reads are not an
 * atomic snapshot against privileged interleaving.
 *
 * Complete table values and the reviewed plan remain private in immutable 0400
 * ledger records. Output contains only aggregate counts. Either stopped.json or
 * stopped-sync.json invalidates a receipt; a missing receipt means failure.
 * A receipt alone is insufficient: the supervising operator must also confirm
 * normal exit without cancellation and an intact ledger with no stopped or
 * uncertain evidence. Permanent storage failure can defeat both failure-record
 * paths; such a failure exits nonzero and must never be accepted as success.
 */
import { constants, lstat, open, readFile, readdir, realpath } from 'node:fs/promises';
import { closeSync, fchmodSync, fsyncSync, openSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { PRODUCTION_TARGET, describeSource, readPrivate, sourceBinding } from './execute-production-import.mjs';
import { stable } from '../lib/convex-migration-plan.mjs';

export const RECONCILIATION_LIMITS = Object.freeze({ requests: 17, queries: 15, writes: 0 });
export const RECONCILIATION_HEADROOM = Object.freeze({ functionCalls: 17, databaseIoGb: 0.025, databaseStorageGb: 0.005 });
export const RECONCILIATION_PARENT = join(homedir(), '.local/state/attendance-production-reconciliation');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOCATION = 'PRODUCTION_RECONCILIATION1';
const sha = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => stable(a) === stable(b);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const hash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const check = (x, code) => { if (!x) throw new ReconciliationError(code); };
const fields = (x, names, code) => check(object(x) && same(Object.keys(x).sort(), [...names].sort()), code);
const cancelled = signal => check(!signal?.aborted, 'cancelled');
export class ReconciliationError extends Error {
  constructor(code) { super(`Production reconciliation stopped (${code}).`); this.name = 'ReconciliationError'; this.code = code; }
}
function json(data) { try { return JSON.parse(data.toString('utf8')); } catch { throw new ReconciliationError('invalid_json'); } }
function args(argv) {
  const o = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (name === '--apply') { check(!o.apply, 'invalid_arguments'); o.apply = true; continue; }
    check(['--input', '--plan', '--key-file', '--ledger'].includes(name) && !Object.hasOwn(o, name.slice(2)) &&
      argv[i + 1] && !argv[i + 1].startsWith('--'), 'invalid_arguments');
    o[name.slice(2)] = argv[++i];
  }
  check(o.input && (!o.apply || (o.plan && o['key-file'] && o.ledger)), 'invalid_arguments'); return o;
}
async function privateDirectory(path) {
  const s = await lstat(path);
  check(path === resolve(path) && await realpath(path) === path && s.isDirectory() && !s.isSymbolicLink() &&
    s.uid === process.getuid() && (s.mode & 0o777) === 0o700, 'private_directory');
}
async function retain(directory, name, value) {
  const file = await open(join(directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(`${JSON.stringify(value)}\n`); await file.chmod(0o400); await file.sync(); }
  finally { await file.close(); }
  const dir = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await dir.sync(); } finally { await dir.close(); }
}
function retainSync(directory, name, value) {
  const file = openSync(join(directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(file, `${JSON.stringify(value)}\n`); fchmodSync(file, 0o400); fsyncSync(file); }
  finally { closeSync(file); }
  const dir = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(dir); } finally { closeSync(dir); }
}
/** A separate exclusive path survives a failed or partially-created async marker. */
export async function retainReconciliationFailure(directory, record, { asyncWrite = retain, syncWrite = retainSync } = {}) {
  try { await asyncWrite(directory, 'stopped.json', record); }
  catch { try { syncWrite(directory, 'stopped-sync.json', record); }
    catch { throw new ReconciliationError('failure_record_unavailable'); } }
}
export async function reconciliationBinding() {
  const paths = ['scripts/reconcile-production-import.mjs', 'scripts/reconcile-production-records.mjs'];
  const values = await Promise.all(paths.map(path => readFile(join(ROOT, path))));
  return { readerDigest: sha(values[0]), comparatorDigest: sha(values[1]) };
}
function validatePlan(p, source, code, binding, ledger, now) {
  fields(p, ['formatVersion', 'allocation', 'target', 'source', 'code', 'readerDigest', 'comparatorDigest', 'ledgerDirectory', 'budgets', 'gates'], 'plan_shape');
  check(p.formatVersion === 1 && p.allocation === ALLOCATION && same(p.target, PRODUCTION_TARGET), 'target_mismatch');
  check(same(p.source, source), 'source_mismatch');
  check(same(p.code, code) && p.readerDigest === binding.readerDigest && p.comparatorDigest === binding.comparatorDigest, 'code_mismatch');
  check(p.ledgerDirectory === ledger && ledger === resolve(ledger) && same(p.budgets, RECONCILIATION_LIMITS), 'allocation_mismatch');
  fields(p.gates, ['source', 'import', 'quota', 'capability'], 'plan_gates');
  for (const gate of Object.values(p.gates)) check(object(gate) && gate.reviewed === true && hash(gate.evidenceDigest), 'plan_gates');
  fields(p.gates.source, ['reviewed', 'evidenceDigest', 'continuousHold'], 'source_gate');
  check(p.gates.source.continuousHold === true, 'source_gate');
  fields(p.gates.import, ['reviewed', 'evidenceDigest', 'applicationCalls', 'verificationCalls', 'logicalWrites', 'phase'], 'import_gate');
  check(p.gates.import.applicationCalls === 36 && p.gates.import.verificationCalls === 21 &&
    p.gates.import.logicalWrites === 755 && p.gates.import.phase === 'active-readonly', 'import_gate');
  fields(p.gates.capability, ['reviewed', 'evidenceDigest', 'rawSha256'], 'capability_gate');
  check(hash(p.gates.capability.rawSha256), 'capability_gate');
  const q = p.gates.quota;
  fields(q, ['reviewed', 'evidenceDigest', 'team', 'plan', 'source', 'observedAt', 'allProjects', 'timezone', 'billingPeriod', 'resources'], 'quota_gate');
  const observed = Date.parse(q.observedAt);
  check(q.team === PRODUCTION_TARGET.team && q.plan === 'CONVEX_BASE' &&
    ['convex-dashboard-user-report', 'convex-dashboard-agent-observation'].includes(q.source) && Number.isFinite(observed) &&
    now - observed <= 86400000 && observed - now <= 300000, 'quota_stale');
  fields(q.billingPeriod, ['start', 'end'], 'quota_period');
  const start = Date.parse(q.billingPeriod.start), end = Date.parse(q.billingPeriod.end);
  check(q.allProjects === true && q.timezone === 'UTC' && Number.isFinite(start) && Number.isFinite(end) &&
    new Date(start).toISOString() === q.billingPeriod.start && new Date(end).toISOString() === q.billingPeriod.end &&
    start <= now && now < end && start <= observed && observed < end, 'quota_period');
  fields(q.resources, Object.keys(RECONCILIATION_HEADROOM), 'quota_gate');
  for (const [metric, amount] of Object.entries(RECONCILIATION_HEADROOM)) {
    const r = q.resources[metric]; fields(r, ['used', 'limit'], 'quota_gate');
    check(Number.isFinite(r.used) && Number.isFinite(r.limit) && r.used >= 0 && r.limit > 0 && r.limit - r.used >= amount &&
      (metric !== 'functionCalls' || (Number.isSafeInteger(r.used) && Number.isSafeInteger(r.limit))), 'quota_headroom');
  }
}
function singleRequest(url, init) {
  return new Promise((resolveResponse, reject) => {
    const req = httpsRequest(url, { method: init.method, headers: init.headers, signal: init.signal, maxHeaderSize: 8192, agent: false }, response => {
      const body = new ReadableStream({ start(controller) { response.pause();
        response.on('data', chunk => { response.pause(); controller.enqueue(new Uint8Array(chunk)); });
        response.on('end', () => controller.close()); response.on('error', () => controller.error(new ReconciliationError('transport_failed')));
      }, pull() { response.resume(); }, cancel() { response.destroy(); req.destroy(); } });
      resolveResponse(new Response(body, { status: response.statusCode, headers: response.headers }));
    });
    req.on('error', () => reject(new ReconciliationError('transport_failed'))); req.end(init.body);
  });
}
async function boundedRequest(url, init, { transport, signal, timeoutMs }) {
  cancelled(signal);
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const interrupted = new Promise((_, reject) => controller.signal.addEventListener('abort', () =>
    reject(new ReconciliationError(signal?.aborted ? 'cancelled' : 'request_timeout')), { once: true }));
  const timer = setTimeout(abort, timeoutMs); let response, reader;
  try {
    response = await Promise.race([transport(url, { ...init, redirect: 'error', signal: controller.signal }), interrupted]);
    check(response.status === 200 && !response.redirected && (!response.url || response.url === url), 'request_failed');
    check([...response.headers].length <= 64 && [...response.headers].reduce((n, [k, v]) => n + k.length + v.length, 0) <= 8192, 'response_headers');
    const len = response.headers.get('content-length');
    check(len === null || (/^[0-9]+$/.test(len) && Number(len) <= 4 * 1024 * 1024), 'response_limit');
    reader = response.body?.getReader(); check(reader, 'invalid_response');
    let size = 0; const chunks = [];
    while (true) { const part = await Promise.race([reader.read(), interrupted]); if (part.done) break;
      size += part.value.byteLength; check(size <= 4 * 1024 * 1024, 'response_limit'); chunks.push(Buffer.from(part.value)); }
    cancelled(signal); return json(Buffer.concat(chunks));
  } catch (error) { controller.abort(); if (error instanceof ReconciliationError) throw error;
    throw new ReconciliationError(signal?.aborted ? 'cancelled' : 'request_failed'); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); if (reader) void reader.cancel().catch(() => {});
    else if (response?.body) void response.body.cancel().catch(() => {}); }
}

/** Dependency injection exists only for synthetic, offline tests. */
export async function runProductionReconciliation(argv, dependencies = {}) {
  const { signal, now = Date.now, report = value => process.stdout.write(`${JSON.stringify(value)}\n`) } = dependencies;
  let ledger, owned = false, requests = 0, queries = 0, completed = false;
  try {
    const o = args(argv);
    const { source, canonical } = (dependencies.describeSource ?? describeSource)(await readPrivate(o.input));
    cancelled(signal);
    if (!o.apply) { const result = { dryRun: true, requests: 0, queries: 0, writes: 0 }; report(result); return result; }
    const parent = dependencies.markerParent ?? RECONCILIATION_PARENT;
    ledger = o.ledger;
    check(resolve(o.plan) === o.plan && resolve(ledger) === ledger && dirname(o.plan) === parent && dirname(ledger) === parent &&
      new Set([o.input, o.plan, o['key-file'], ledger].map(path => resolve(path))).size === 4, 'private_paths_conflict');
    await privateDirectory(parent); await privateDirectory(ledger);
    check((await readdir(ledger)).length === 0, 'allocation_already_used');
    const plan = json(await readPrivate(o.plan, 1024 * 1024));
    const code = await (dependencies.sourceBinding ?? sourceBinding)();
    const binding = await (dependencies.reconciliationBinding ?? reconciliationBinding)();
    validatePlan(plan, source, code, binding, ledger, now());
    const keyStat = await lstat(o['key-file']);
    check((keyStat.mode & 0o777) === 0o600, 'key_mode');
    const keyBytes = await readPrivate(o['key-file'], 16384), key = keyBytes.toString('utf8');
    check(Buffer.from(key).equals(keyBytes) && key.length > 0 && !/[\u0000-\u0020\u007f]/.test(key) &&
      sha(keyBytes) === plan.gates.capability.rawSha256, 'capability_mismatch');
    const comparator = dependencies.comparator ?? await import('./reconcile-production-records.mjs');
    const counts = comparator.RECONCILIATION_TABLE_COUNTS;
    check(object(counts) && Object.keys(counts).length === 11 && Object.values(counts).every(n => Number.isSafeInteger(n) && n >= 0) &&
      Object.values(counts).reduce((a, b) => a + b, 0) === 357 && typeof comparator.reconcileProductionRecords === 'function', 'comparator_invalid');
    cancelled(signal);
    await retain(parent, `production-${PRODUCTION_TARGET.deploymentName}-${ALLOCATION}.json`, { allocation: ALLOCATION, ledger });
    owned = true;
    await retain(ledger, 'allocation.json', plan);
    let ticket;
    async function request(path, method, body) {
      cancelled(signal); check(requests < 17 && (method !== 'POST' || queries < 15), 'budget_exceeded');
      const ordinal = ++requests; if (method === 'POST') queries++;
      await retain(ledger, `reservation-${String(ordinal).padStart(6, '0')}.json`,
        { ordinal, method, kind: method === 'POST' ? 'query' : 'canonical', requests, queries, writes: 0 });
      cancelled(signal);
      return boundedRequest(`${PRODUCTION_TARGET.cloudUrl}${path}`, {
        method, headers: { authorization: `Convex ${key}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body }),
      }, { transport: dependencies.transport ?? singleRequest, signal, timeoutMs: dependencies.timeoutMs ?? 20000 });
    }
    const client = new ConvexHttpClient(PRODUCTION_TARGET.cloudUrl, { logger: false, fetch: async (url, init) => {
      check(ticket && ticket.fetches++ === 0 && url === `${PRODUCTION_TARGET.cloudUrl}/api/query` && init.method === 'POST' &&
        typeof init.body === 'string' && Buffer.byteLength(init.body) <= 65536, 'query_scope');
      const envelope = json(Buffer.from(init.body));
      check(envelope.path === ticket.name && envelope.format === 'convex_encoded_json' && same(envelope.args, [ticket.args]), 'query_scope');
      const response = await request('/api/query', 'POST', init.body);
      check(object(response) && response.status === 'success' && Object.hasOwn(response, 'value'), 'request_failed');
      return new Response(JSON.stringify({ status: 'success', value: response.value }), { status: 200 });
    } });
    client.setAdminAuth(key);
    async function query(name, value) {
      check(['migration:status', 'operations:availability', '_system/cli/tableData'].includes(name), 'query_scope');
      ticket = { name, args: value, fetches: 0 };
      try { const result = await client.query(makeFunctionReference(name), value);
        check(ticket.fetches === 1, 'query_scope'); cancelled(signal); return result;
      } catch (error) { if (error instanceof ReconciliationError) throw error;
        throw new ReconciliationError(signal?.aborted ? 'cancelled' : 'request_failed'); }
      finally { ticket = undefined; }
    }
    const identity = async () => { const value = await request('/api/v1/get_canonical_urls', 'GET');
      check(object(value) && value.convexCloudUrl === PRODUCTION_TARGET.cloudUrl && value.convexSiteUrl === PRODUCTION_TARGET.siteUrl, 'canonical_mismatch'); };
    const match = { fingerprint: source.contentFingerprint, manifestDigest: source.manifestDigest };
    const status = async previous => { const value = await query('migration:status', match);
      fields(value, ['runId', 'phase', 'nextChunk', 'table'], 'checkpoint_invalid');
      check(typeof value.runId === 'string' && value.runId.length > 0 && value.phase === 'active' &&
        value.nextChunk === 7 && value.table === 19 && (!previous || same(value, previous)), 'checkpoint_invalid'); return value; };
    const availability = async () => check(same(await query('operations:availability', { fingerprint: source.contentFingerprint }),
      { readsEnabled: true, writesEnabled: false }), 'read_only_not_confirmed');
    await identity(); const before = await status(); await availability();
    const tables = {}, ids = new Set();
    for (const [table, expected] of Object.entries(counts)) {
      const value = await query('_system/cli/tableData', { table, order: 'asc', paginationOpts: { numItems: expected + 1, cursor: null } });
      await retain(ledger, `table-${table}.json`, value); cancelled(signal);
      // Convex 1.49.0 PaginationResult permits these two optional fields.
      check(object(value) && Object.keys(value).every(k => ['page', 'isDone', 'continueCursor', 'splitCursor', 'pageStatus'].includes(k)), 'page_invalid');
      check(Array.isArray(value.page) && value.page.length === expected && value.isDone === true && typeof value.continueCursor === 'string' &&
        (!Object.hasOwn(value, 'splitCursor') || value.splitCursor === null || typeof value.splitCursor === 'string') &&
        (!Object.hasOwn(value, 'pageStatus') || value.pageStatus === null || value.pageStatus === 'SplitRecommended'), 'page_invalid');
      for (const row of value.page) { check(object(row) && typeof row._id === 'string' && row._id.length > 0 && !ids.has(row._id), 'page_invalid'); ids.add(row._id); }
      tables[table] = value.page;
    }
    await availability(); await status(before); await identity();
    check(requests === 17 && queries === 15, 'budget_incomplete');
    let result;
    try { result = comparator.reconcileProductionRecords(canonical, tables); }
    catch { throw new ReconciliationError('records_mismatch'); }
    check(object(result) && result.ok === true && same(result.counts, counts), 'records_mismatch');
    check(same(await (dependencies.sourceBinding ?? sourceBinding)(), code) &&
      same(await (dependencies.reconciliationBinding ?? reconciliationBinding)(), binding), 'code_mismatch');
    await dependencies.beforeFinalize?.(); cancelled(signal);
    await retain(ledger, 'receipt.json', { allocation: ALLOCATION, counts, requests, queries, writes: 0,
      atomicSnapshot: false, stoppedRecordInvalidatesReceipt: true });
    cancelled(signal);
    const output = { reconciled: true, counts, requests, queries, writes: 0, atomicSnapshot: false };
    report(output); completed = true; return output;
  } catch (error) {
    const safe = error instanceof ReconciliationError ? error : new ReconciliationError('reconciliation_failed');
    if (owned && !completed) await retainReconciliationFailure(ledger, { code: safe.code, requests, queries, writes: 0 });
    throw safe;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const controller = new AbortController(); const stop = () => controller.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try { await runProductionReconciliation(process.argv.slice(2), { signal: controller.signal }); }
  catch (error) { process.stderr.write(`${error instanceof ReconciliationError ? error.message : 'Production reconciliation stopped (reconciliation_failed).'}\n`); process.exitCode = 1; }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
