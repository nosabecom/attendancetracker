#!/usr/bin/env node
/**
 * OFFLINE by default. This does not publish code, obtain credentials, establish
 * production identity, grant an allocation, or switch the public gateway.
 *
 * node scripts/execute-production-import.mjs --input /private/frozen.json
 * --apply additionally requires --phase stage|verify|activate-readonly,
 * --manifest /private/ready.json --key-file /private/key --ledger /private/ledger.
 * Every later invocation, including another phase, requires --resume.
 *
 * READY MANIFEST (private, reviewed, externally supplied): formatVersion:1,
 * allocation:PRODUCTION_IMPORT1, target:PRODUCTION_TARGET, source:describeSource's
 * source, code:sourceBinding(), ledgerDirectory:absolute path, budgets:LIMITS,
 * gates:{source:{reviewed:true,evidenceDigest,continuousHold:true,reconciled:true},
 * identity:{reviewed:true,evidenceDigest,target:PRODUCTION_TARGET},
 * publication:{reviewed:true,evidenceDigest,codeDigest,atomicReadOnlyActivation:true},
 * quota:{reviewed:true,evidenceDigest,team,plan:CONVEX_BASE,
 * source:convex-dashboard-user-report|convex-dashboard-agent-observation,
 * observedAt,allProjects:true,timezone:UTC,
 * billingPeriod:{start,end},resources:{metric:{used,limit}}}}. Period endpoints
 * are canonical UTC ISO timestamps and the current instant is in [start,end).
 * This is a conservative validity window INSIDE the dashboard's displayed date
 * labels, not an assertion of provider billing/reset instants. Preserve the
 * displayed period and plan evidence privately; CONVEX_BASE is the verified
 * integration identifier for the dashboard's Free plan.
 * Quota metrics/headroom are QUOTA_HEADROOM. Quota may refresh between attempts;
 * all other bindings and the cumulative allocation remain identical.
 *
 * JSON assertions are NOT independent identity/publication/quota proof. Root must
 * attest the canonical production identity, actual reviewed frozen raw SHA-256,
 * published code (including atomic read-only activation), held source/gateway,
 * and fresh all-team quota before supplying this manifest. Never log the ready
 * manifest, source/plan fingerprints, key, request bodies, or ledger contents.
 *
 * Reservations cap deliberate client dispatches/logical writes, not provider
 * billing, OCC retries, backend work, publication, hosting, or reconciliation.
 * Failed/cancelled/uncertain requests remain spent. No retry or cleanup RPC is
 * implicit. A crash retains LOCK; explicit offline operator recovery must first
 * establish no live owner and preserve/validate this same allocation/history.
 * --recover-interrupted --resume (without --apply/key) explicitly recovers ONLY
 * a provably dead local Linux process's lock and a missing final attempt outcome.
 * It validates all reservations, marks that attempt failed at its actual spent
 * totals, retains recovery evidence, and removes only the verified lock inode.
 * Run the separately explicit --apply --resume phase after offline recovery.
 * Torn records, live/unknown owners, and an interrupted recovery need operator
 * review; there is no age-based unlocking, history rewrite, or replacement ledger.
 */
import { constants, open, lstat, realpath, readdir, readFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { transformBlobSnapshot } from '../lib/blob-migration.mjs';
import { buildMigrationPlan, stable, migrationTables, bytes } from '../lib/convex-migration-plan.mjs';

export const PRODUCTION_TARGET = Object.freeze({
  cloudUrl: 'https://tremendous-elk-298.convex.cloud',
  siteUrl: 'https://tremendous-elk-298.convex.site',
  deploymentName: 'tremendous-elk-298', deploymentType: 'prod',
  team: 'nomokaro625-9385-s-projects', project: 'convex-cyan-garden',
});
export const LIMITS = Object.freeze({ applicationCalls: 55, verificationCalls: 40, logicalWrites: 774 });
export const QUOTA_HEADROOM = Object.freeze({ functionCalls: 55, databaseIoGb: 0.025, databaseStorageGb: 0.005 });
const EXPECTED = Object.freeze({ accounts: 3, legacyClaims: 0, classes: 2, rosterVersions: 3,
  rosterMembers: 132, memberships: 3, sessions: 7, closures: 1, attendance: 198 });
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = value => createHash('sha256').update(value).digest('hex');
const digest = value => sha(stable(value));
const same = (a, b) => stable(a) === stable(b);
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const check = (value, code) => { if (!value) throw new ProductionImportError(code); };
const fields = (value, names, code = 'ledger_invalid') => check(record(value) &&
  same(Object.keys(value).sort(), [...names].sort()), code);
export class ProductionImportError extends Error {
  constructor(code) { super(`Production import failed (${code}).`); this.name = 'ProductionImportError'; this.code = code; }
}
const abortCheck = signal => check(!signal?.aborted, 'cancelled');
const named = (kind, ordinal) => `${kind}-${String(ordinal).padStart(6, '0')}.json`;

export function parseArgs(argv) {
  const o = { apply: false, resume: false, 'recover-interrupted': false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (['--apply', '--resume', '--recover-interrupted'].includes(flag)) {
      check(!o[flag.slice(2)], 'invalid_arguments'); o[flag.slice(2)] = true;
    } else {
      check(['--input', '--manifest', '--key-file', '--ledger', '--phase'].includes(flag) &&
        !Object.hasOwn(o, flag.slice(2)) && argv[i + 1] && !argv[i + 1].startsWith('--'), 'invalid_arguments');
      o[flag.slice(2)] = argv[++i];
    }
  }
  check(o.input && (!o.phase || ['stage', 'verify', 'activate-readonly'].includes(o.phase)) &&
    (!o.apply || (o.phase && o.manifest && o['key-file'] && o.ledger)) &&
    (!o['recover-interrupted'] || (!o.apply && o.resume && o.manifest && o.ledger)), 'invalid_arguments');
  return o;
}

async function privateDirectory(path) {
  const full = resolve(path), stat = await lstat(full);
  check(await realpath(full) === full && stat.isDirectory() && !stat.isSymbolicLink() &&
    stat.uid === process.getuid() && (stat.mode & 0o777) === 0o700, 'private_directory');
  return full;
}
export async function readPrivate(path, maximum = 512 * 1024 * 1024) {
  let handle;
  try {
    const full = resolve(path);
    await privateDirectory(dirname(full));
    const stat = await lstat(full);
    check(await realpath(full) === full && stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 &&
      stat.uid === process.getuid() && [0o400, 0o600].includes(stat.mode & 0o777) &&
      stat.size <= maximum, 'private_file');
    handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
    const after = await handle.stat();
    check(after.ino === stat.ino && after.dev === stat.dev && after.size === stat.size &&
      after.uid === stat.uid && after.mode === stat.mode, 'private_file');
    const data = await handle.readFile();
    const final = await handle.stat();
    check(data.length <= maximum && final.size === stat.size && final.mtimeMs === stat.mtimeMs &&
      final.ctimeMs === stat.ctimeMs, 'private_file_changed');
    return data;
  } catch (error) {
    if (error instanceof ProductionImportError) throw error;
    throw new ProductionImportError('private_file_unavailable');
  } finally { await handle?.close(); }
}
function json(data, code = 'invalid_private_json') {
  try { return JSON.parse(data.toString('utf8')); } catch { throw new ProductionImportError(code); }
}
const chunkDocuments = chunk => chunk.reduce((n, op) => n + (op.kind === 'account' ? 3 :
  op.kind === 'version' ? 1 + op.data.students.length : op.kind === 'provenance' ? 0 : 1), 0);
export function describeSource(raw) {
  let canonical, plan;
  try { canonical = transformBlobSnapshot(json(raw)); plan = buildMigrationPlan(canonical); }
  catch { throw new ProductionImportError('invalid_frozen_source'); }
  const source = { rawSha256: sha(raw), contentFingerprint: canonical.contentFingerprint,
    manifestDigest: plan.manifestDigest, exportedAt: canonical.exportedAt,
    blobCount: canonical.summary.inventory.blobs, expectedCounts: plan.expectedCounts,
    tableCounts: plan.tableCounts, chunkDocuments: plan.chunks.map(chunkDocuments),
    chunkBytes: plan.chunks.map(bytes) };
  check(source.blobCount === 298 && same(plan.expectedCounts, EXPECTED) &&
    plan.chunks.length === 7 && plan.tableCounts.reduce((a, b) => a + b, 0) === 357 &&
    source.chunkDocuments.reduce((a, b) => a + b, 0) === 357, 'frozen_counts_mismatch');
  return { source, canonical, plan };
}

/** Public source bytes only. No .env, generated private config, or git status. */
export async function sourceBinding() {
  const paths = ['scripts/execute-production-import.mjs', 'package.json',
    'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'convex.json'];
  async function walk(relative) {
    for (const entry of (await readdir(join(ROOT, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && /\.(ts|mjs|json|js|patch)$/.test(entry.name)) paths.push(path);
      else check(!entry.isSymbolicLink(), 'source_binding_failed');
    }
  }
  await walk('convex'); await walk('lib');
  try { await walk('patches'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const sdk = resolve(fileURLToPath(import.meta.resolve('convex/browser')), '../../../../');
  const pkg = json(await readFile(join(sdk, 'package.json')));
  check(pkg.version === '1.49.0', 'sdk_version');
  const files = [];
  for (const path of paths.sort()) files.push([path, sha(await readFile(join(ROOT, path)))]);
  files.push(['convex@1.49.0/http_client', sha(await readFile(fileURLToPath(import.meta.resolve('convex/browser')).replace(/index\.js$/, 'http_client.js')))]);
  const { stdout } = await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: ROOT, maxBuffer: 128,
    env: { PATH: process.env.PATH, GIT_OPTIONAL_LOCKS: '0' } });
  const commit = stdout.trim(); check(/^[a-f0-9]{40}$/.test(commit), 'source_binding_failed');
  return { commit, digest: digest(files) };
}
async function requireCleanSource() {
  try {
    const { stdout } = await promisify(execFile)('git', ['status', '--porcelain=v1', '--untracked-files=normal'],
      { cwd: ROOT, maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH, GIT_OPTIONAL_LOCKS: '0' } });
    check(stdout.length === 0, 'source_tree_dirty');
  } catch { throw new ProductionImportError('source_tree_dirty'); }
}

function validateManifest(m, source, code, ledger, now) {
  fields(m, ['formatVersion', 'allocation', 'target', 'source', 'code', 'ledgerDirectory', 'budgets', 'gates'], 'manifest_shape');
  check(m.formatVersion === 1 && m.allocation === 'PRODUCTION_IMPORT1' && same(m.target, PRODUCTION_TARGET), 'target_mismatch');
  check(same(m.source, source), 'frozen_manifest_mismatch');
  check(same(m.code, code), 'source_code_mismatch');
  check(m.ledgerDirectory === resolve(ledger) && ledger === resolve(ledger) && same(m.budgets, LIMITS), 'allocation_mismatch');
  fields(m.gates, ['source', 'identity', 'publication', 'quota'], 'manifest_gates');
  for (const gate of Object.values(m.gates)) check(record(gate) && gate.reviewed === true && isHash(gate.evidenceDigest), 'manifest_gates');
  fields(m.gates.source, ['reviewed', 'evidenceDigest', 'continuousHold', 'reconciled'], 'manifest_gates');
  check(m.gates.source.continuousHold === true && m.gates.source.reconciled === true, 'source_gate');
  fields(m.gates.identity, ['reviewed', 'evidenceDigest', 'target'], 'manifest_gates');
  check(same(m.gates.identity.target, PRODUCTION_TARGET), 'identity_gate');
  fields(m.gates.publication, ['reviewed', 'evidenceDigest', 'codeDigest', 'atomicReadOnlyActivation'], 'manifest_gates');
  check(m.gates.publication.codeDigest === code.digest && m.gates.publication.atomicReadOnlyActivation === true, 'publication_gate');
  const q = m.gates.quota;
  fields(q, ['reviewed', 'evidenceDigest', 'team', 'plan', 'source', 'observedAt', 'resources',
    'billingPeriod', 'allProjects', 'timezone'], 'quota_gate');
  const observed = Date.parse(q.observedAt);
  check(q.team === PRODUCTION_TARGET.team && q.plan === 'CONVEX_BASE' &&
    ['convex-dashboard-user-report', 'convex-dashboard-agent-observation'].includes(q.source) &&
    Number.isFinite(observed) && now - observed <= 86400000 && observed - now <= 300000, 'quota_stale');
  fields(q.billingPeriod, ['start', 'end'], 'quota_period');
  const start = Date.parse(q.billingPeriod.start), end = Date.parse(q.billingPeriod.end);
  check(q.allProjects === true && q.timezone === 'UTC' && Number.isFinite(start) && Number.isFinite(end) &&
    new Date(start).toISOString() === q.billingPeriod.start && new Date(end).toISOString() === q.billingPeriod.end &&
    start <= now && now < end && start <= observed && observed < end, 'quota_period');
  fields(q.resources, Object.keys(QUOTA_HEADROOM), 'quota_gate');
  for (const [metric, required] of Object.entries(QUOTA_HEADROOM)) {
    const r = q.resources[metric]; fields(r, ['used', 'limit'], 'quota_gate');
    check(Number.isFinite(r.used) && Number.isFinite(r.limit) && r.used >= 0 && r.limit > 0 &&
      r.limit - r.used >= required && (metric !== 'functionCalls' || (count(r.used) && count(r.limit))), 'quota_headroom');
  }
  // Mutable fresh quota evidence is retained per attempt, never a budget reset.
  return { formatVersion: 1, allocation: m.allocation, target: m.target, source, code,
    ledgerDirectory: m.ledgerDirectory, budgets: LIMITS,
    gates: { source: m.gates.source, identity: m.gates.identity, publication: m.gates.publication } };
}

const RPC = Object.freeze({
  'migration:initialize': ['mutation', 1], 'migration:begin': ['mutation', 1],
  'migration:stage': ['mutation', null], 'migration:status': ['query', 0],
  'migration:freeze': ['mutation', 1], 'migration:verifyNext': ['mutation', 1],
  'migration:activate': ['mutation', 2], 'operations:setAvailability': ['mutation', 1],
  'operations:availability': ['query', 0],
});
async function directorySync(directory) {
  const h = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await h.sync(); } finally { await h.close(); }
}
async function immutable(directory, name, value) {
  const h = await open(join(directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await h.writeFile(`${JSON.stringify(value)}\n`); await h.chmod(0o400); await h.sync(); }
  finally { await h.close(); }
  await directorySync(directory);
}
async function processOwner() {
  check(process.platform === 'linux', 'process_identity_unavailable');
  const stat = await readFile(`/proc/${process.pid}/stat`, 'utf8');
  return { pid: process.pid, hostname: hostname(), bootId: (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(),
    processStart: stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] };
}
function validateOwner(owner) {
  fields(owner, ['pid', 'hostname', 'bootId', 'processStart']);
  check(count(owner.pid) && owner.pid > 0 && typeof owner.hostname === 'string' && owner.hostname.length <= 255 &&
    /^[a-f0-9-]{36}$/.test(owner.bootId) && /^[0-9]{1,32}$/.test(owner.processStart), 'ledger_invalid');
}
async function ownerIsDead(owner) {
  validateOwner(owner); const current = await processOwner();
  check(owner.hostname === current.hostname, 'recovery_owner_unverifiable');
  if (owner.bootId !== current.bootId) return true;
  try {
    const stat = await readFile(`/proc/${owner.pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] !== owner.processStart;
  } catch (error) {
    check(error.code === 'ENOENT', 'recovery_owner_unverifiable'); return true;
  }
}

async function auditLedger(directory, binding, { recovery = false } = {}) {
  check(same(json(await readPrivate(join(directory, 'ALLOCATION.json'), 128 * 1024)), binding), 'allocation_binding_mismatch');
  const names = (await readdir(directory)).filter(n => n !== 'LOCK' && !(recovery && n === 'RECOVERY_LOCK'));
  check(names.length <= 1024 && names.every(n => n === 'ALLOCATION.json' || /^(attempt|outcome|interrupted|reservation|recovery)-[0-9]{6}\.json$/.test(n)), 'ledger_invalid');
  const attempts = names.filter(n => n.startsWith('attempt-')).sort();
  const reservations = names.filter(n => n.startsWith('reservation-')).sort();
  const outcomes = names.filter(n => n.startsWith('outcome-'));
  const incomplete = attempts.length > 0 && !names.includes(named('outcome', attempts.length));
  check(outcomes.length === attempts.length - Number(recovery && incomplete), 'ledger_incomplete');
  for (let i = 0; i < attempts.length; i++) {
    check(attempts[i] === named('attempt', i + 1), 'ledger_sequence');
    const a = json(await readPrivate(join(directory, attempts[i]), 16384));
    fields(a, ['ordinal', 'phase', 'resume', 'bindingDigest', 'quotaDigest', 'startedAt']);
    check(a.ordinal === i + 1 && ['stage', 'verify', 'activate-readonly'].includes(a.phase) &&
      typeof a.resume === 'boolean' && (i === 0 || a.resume) && a.bindingDigest === digest(binding) && isHash(a.quotaDigest) &&
      Number.isFinite(Date.parse(a.startedAt)), 'ledger_invalid');
  }
  let totals = { applicationCalls: 0, verificationCalls: 0, logicalWrites: 0 }, chain = digest(binding), previousAttempt = 0;
  const totalsByAttempt = new Map([[0, { ...totals }]]);
  for (let i = 0; i < reservations.length; i++) {
    check(reservations[i] === named('reservation', i + 1), 'ledger_sequence');
    const r = json(await readPrivate(join(directory, reservations[i]), 16384));
    fields(r, ['ordinal', 'attempt', 'kind', 'function', 'argsDigest', 'chunkOrdinal', 'logicalWrites', 'verificationCalls', 'previous', 'totals']);
    const spec = RPC[r.function];
    check(r.ordinal === i + 1 && count(r.attempt) && r.attempt >= Math.max(1, previousAttempt) &&
      r.attempt <= attempts.length && spec && r.kind === spec[0] && isHash(r.argsDigest) && r.previous === chain, 'ledger_invalid');
    const cost = r.function === 'migration:stage' ?
      (count(r.chunkOrdinal) && r.chunkOrdinal < binding.source.chunkDocuments.length ? 2 * binding.source.chunkDocuments[r.chunkOrdinal] + 2 : -1) : spec[1];
    check(r.logicalWrites === cost && (r.function === 'migration:stage' || r.chunkOrdinal === null) &&
      r.verificationCalls === Number(r.function === 'migration:verifyNext'), 'ledger_invalid');
    totals = { applicationCalls: totals.applicationCalls + 1, verificationCalls: totals.verificationCalls + r.verificationCalls,
      logicalWrites: totals.logicalWrites + cost };
    check(same(r.totals, totals) && Object.keys(LIMITS).every(k => totals[k] <= LIMITS[k]), 'ledger_budget');
    totalsByAttempt.set(r.attempt, { ...totals }); chain = digest(r); previousAttempt = r.attempt;
  }
  let priorTotals = totalsByAttempt.get(0);
  for (let i = 1; i <= attempts.length; i++) {
    priorTotals = totalsByAttempt.get(i) ?? priorTotals; totalsByAttempt.set(i, priorTotals);
    if (recovery && incomplete && i === attempts.length) continue;
    const out = json(await readPrivate(join(directory, named('outcome', i)), 16384));
    fields(out, ['attempt', 'status', 'code', 'totals']);
    check(out.attempt === i && ['completed', 'failed'].includes(out.status) &&
      (out.status === 'completed' ? out.code === null : typeof out.code === 'string' && /^[a-z_]{1,64}$/.test(out.code)) &&
      same(out.totals, priorTotals), 'ledger_invalid');
  }
  for (const name of names.filter(n => n.startsWith('interrupted-'))) {
    const r = json(await readPrivate(join(directory, name), 16384)); fields(r, ['attempt', 'status', 'code']);
    check(name === named('interrupted', r.attempt) && count(r.attempt) && r.attempt >= 1 &&
      r.attempt <= attempts.length && r.status === 'failed' && r.code === 'cancelled', 'ledger_invalid');
  }
  const recoveries = names.filter(n => n.startsWith('recovery-')).sort();
  for (let i = 0; i < recoveries.length; i++) {
    check(recoveries[i] === named('recovery', i + 1), 'ledger_sequence');
    const r = json(await readPrivate(join(directory, recoveries[i]), 16384));
    fields(r, ['ordinal', 'bindingDigest', 'lockDigest', 'owner', 'recoveredAttempt', 'totals']); validateOwner(r.owner);
    check(r.ordinal === i + 1 && r.bindingDigest === digest(binding) && isHash(r.lockDigest) && count(r.recoveredAttempt) &&
      r.recoveredAttempt <= attempts.length && same(r.totals, totalsByAttempt.get(r.recoveredAttempt)), 'ledger_invalid');
  }
  return { attempts: attempts.length, recoveries: recoveries.length, incomplete, totals, chain };
}

async function recoverLedger(directory, binding, signal) {
  directory = await privateDirectory(directory); abortCheck(signal);
  const lockPath = join(directory, 'LOCK'), lockStat = await lstat(lockPath);
  const lockRaw = await readPrivate(lockPath, 16384), lock = json(lockRaw);
  fields(lock, ['bindingDigest', 'owner']); check(lock.bindingDigest === digest(binding), 'allocation_binding_mismatch');
  check(await ownerIsDead(lock.owner), 'recovery_owner_live');
  try { await immutable(directory, 'RECOVERY_LOCK', { bindingDigest: digest(binding), owner: await processOwner() }); }
  catch { throw new ProductionImportError('recovery_locked'); }
  // Failure retains both locks. Recovery never rewrites or discards torn history.
  const history = await auditLedger(directory, binding, { recovery: true }); abortCheck(signal);
  if (history.incomplete) await immutable(directory, named('outcome', history.attempts),
    { attempt: history.attempts, status: 'failed', code: 'interrupted_process', totals: history.totals });
  await immutable(directory, named('recovery', history.recoveries + 1), { ordinal: history.recoveries + 1,
    bindingDigest: digest(binding), lockDigest: sha(lockRaw), owner: lock.owner,
    recoveredAttempt: history.attempts, totals: history.totals });
  abortCheck(signal);
  const after = await lstat(lockPath);
  check(after.ino === lockStat.ino && after.dev === lockStat.dev && same(json(await readPrivate(lockPath, 16384)), lock), 'recovery_lock_changed');
  await unlink(lockPath); await directorySync(directory);
  await unlink(join(directory, 'RECOVERY_LOCK')); await directorySync(directory);
  return history.totals;
}

async function ledgerOpen(directory, binding, resume, phase, quota, now) {
  directory = await privateDirectory(directory);
  try { await immutable(directory, 'LOCK', { bindingDigest: digest(binding), owner: await processOwner() }); }
  catch { throw new ProductionImportError('ledger_locked'); }
  let releaseAllowed = false;
  const release = async () => {
    if (releaseAllowed) { await unlink(join(directory, 'LOCK')); await directorySync(directory); }
  };
  try {
    let names = (await readdir(directory)).filter(n => n !== 'LOCK');
    if (!names.includes('ALLOCATION.json')) {
      check(!resume && names.length === 0 && phase === 'stage', 'allocation_missing');
      await immutable(directory, 'ALLOCATION.json', binding); names = ['ALLOCATION.json'];
    } else {
      check(resume, 'resume_required');
    }
    const history = await auditLedger(directory, binding);
    let { totals, chain } = history;
    const attempt = history.attempts + 1;
    check(attempt <= 128, 'attempt_limit');
    await immutable(directory, named('attempt', attempt), { ordinal: attempt, phase, resume,
      bindingDigest: digest(binding), quotaDigest: digest(quota), startedAt: new Date(now).toISOString() });
    let finished = false, closed = false;
    return {
      snapshot: () => ({ ...totals }),
      reserve: async (fn, args) => {
        const spec = RPC[fn]; check(spec, 'dispatch_forbidden');
        const writes = fn === 'migration:stage' ? 2 * binding.source.chunkDocuments[args.ordinal] + 2 : spec[1];
        check(count(writes), 'invalid_reservation');
        const next = { applicationCalls: totals.applicationCalls + 1,
          verificationCalls: totals.verificationCalls + Number(fn === 'migration:verifyNext'), logicalWrites: totals.logicalWrites + writes };
        check(Object.keys(LIMITS).every(k => next[k] <= LIMITS[k]), 'budget_exceeded');
        const r = { ordinal: next.applicationCalls, attempt, kind: spec[0], function: fn,
          argsDigest: digest(args), chunkOrdinal: fn === 'migration:stage' ? args.ordinal : null,
          logicalWrites: writes, verificationCalls: Number(fn === 'migration:verifyNext'), previous: chain, totals: next };
        await immutable(directory, named('reservation', r.ordinal), r);
        totals = next; chain = digest(r); return r;
      },
      finish: async (status, code = null) => {
        await immutable(directory, named('outcome', attempt), { attempt, status, code, totals }); finished = true;
      },
      interrupted: async () => immutable(directory, named('interrupted', attempt), { attempt, status: 'failed', code: 'cancelled' }),
      close: async () => { if (!closed) { releaseAllowed = finished; await release(); closed = true; } },
    };
  } catch (error) {
    // Invalid/torn history retains its lock for explicit operator recovery.
    if (['resume_required', 'allocation_missing', 'allocation_binding_mismatch'].includes(error.code)) { releaseAllowed = true; await release(); }
    throw error;
  }
}

/** One physical HTTPS request. Node follows no redirects and does no retries. */
function singleHttpsRequest(url, init) {
  return new Promise((resolveResponse, reject) => {
    const req = httpsRequest(url, { method: 'POST', headers: init.headers, signal: init.signal,
      maxHeaderSize: 8192, agent: false }, response => {
      const body = new ReadableStream({
        start(controller) {
          response.pause();
          response.on('data', chunk => { response.pause(); controller.enqueue(new Uint8Array(chunk)); });
          response.on('end', () => controller.close());
          response.on('error', () => controller.error(new ProductionImportError('transport_failed')));
        }, pull() { response.resume(); }, cancel() { response.destroy(); req.destroy(); },
      });
      resolveResponse(new Response(body, { status: response.statusCode, headers: response.headers }));
    });
    req.on('error', () => reject(new ProductionImportError('transport_failed')));
    req.end(init.body);
  });
}

function boundedTransport(getTicket, { transport = singleHttpsRequest, signal, timeoutMs = 20000 } = {}) {
  return async (url, init) => {
    const ticket = getTicket();
    check(ticket && ticket.fetches++ === 0 && url === `${PRODUCTION_TARGET.cloudUrl}/api/${ticket.reservation.kind}` &&
      init.method === 'POST' && typeof init.body === 'string' && Buffer.byteLength(init.body) <= 2 * 1024 * 1024 + 4096, 'transport_scope');
    const envelope = json(Buffer.from(init.body), 'transport_scope');
    check(envelope.path === ticket.reservation.function && envelope.args?.length === 1 &&
      digest(envelope.args[0]) === ticket.reservation.argsDigest && envelope.format === 'convex_encoded_json', 'transport_scope');
    const headers = new Headers(init.headers);
    check([...headers].reduce((n, [k, v]) => n + k.length + v.length, 0) <= 16384, 'request_headers');
    abortCheck(signal);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    let rejectAbort;
    const interrupted = new Promise((_, reject) => { rejectAbort = () => reject(new ProductionImportError(signal?.aborted ? 'cancelled' : 'request_timeout')); });
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    let reader, response;
    try {
      response = await Promise.race([transport(url, { ...init, headers: Object.fromEntries(headers),
        redirect: 'error', cache: 'no-store', signal: controller.signal }), interrupted]);
      check(response.status === 200 && !response.redirected && response.url !== undefined &&
        (!response.url || response.url === url), 'backend_request_failed');
      check([...response.headers].length <= 64 && [...response.headers].reduce((n, [k, v]) => n + k.length + v.length, 0) <= 8192,
        'response_headers');
      const declared = response.headers.get('content-length');
      check(declared === null || (/^[0-9]+$/.test(declared) && Number(declared) <= 65536), 'response_too_large');
      reader = response.body?.getReader(); check(reader, 'backend_response');
      const chunks = []; let size = 0;
      while (true) {
        const part = await Promise.race([reader.read(), interrupted]);
        if (part.done) break;
        size += part.value.length; check(size <= 65536, 'response_too_large'); chunks.push(Buffer.from(part.value));
      }
      const body = json(Buffer.concat(chunks), 'backend_response');
      check(body.status === 'success' && Object.hasOwn(body, 'value'), 'backend_request_failed');
      abortCheck(signal);
      // Strip SDK logLines and error text even with logger:false.
      return new Response(JSON.stringify({ status: 'success', value: body.value }), { status: 200 });
    } catch (error) {
      controller.abort();
      if (error instanceof ProductionImportError) throw error;
      throw new ProductionImportError(signal?.aborted ? 'cancelled' : 'backend_request_failed');
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', rejectAbort);
      if (reader) void reader.cancel().catch(() => {});
      else if (response?.body) void response.body.cancel().catch(() => {});
    }
  };
}

function checkpoint(value, chunkCount, { previous, tableRequired = false } = {}) {
  check(record(value) && typeof value.runId === 'string' && /^[a-z0-9]{32}$/.test(value.runId) &&
    ['import', 'verify', 'verified', 'active'].includes(value.phase) && count(value.nextChunk) && value.nextChunk <= chunkCount &&
    (!previous || value.runId === previous.runId) &&
    (value.phase === 'import' || value.nextChunk === chunkCount), 'invalid_server_checkpoint');
  fields(value, tableRequired ? ['runId', 'phase', 'nextChunk', 'table'] : ['runId', 'phase', 'nextChunk'], 'invalid_server_checkpoint');
  if (tableRequired) check(count(value.table) && value.table <= migrationTables.length &&
    ((['verified', 'active'].includes(value.phase)) ? value.table === migrationTables.length : value.table < migrationTables.length) &&
    (value.phase !== 'import' || value.table === 0), 'invalid_server_checkpoint');
  return value;
}

/** Injection is OFFLINE test infrastructure; CLI uses the strict HTTPS path. */
export async function runProductionImport(argv, { transport, signal, report = value => process.stdout.write(`${JSON.stringify(value)}\n`),
  now = () => Date.now(), beforeFinalize } = {}) {
  let ledger, terminal = false, completed = false;
  try {
    const o = parseArgs(argv);
    const { source, canonical, plan } = describeSource(await readPrivate(o.input));
    const safe = { counts: plan.expectedCounts, chunks: plan.chunks.length, targetDocuments: 357 };
    let manifest, binding;
    if (o.manifest) {
      manifest = json(await readPrivate(o.manifest, 128 * 1024));
      binding = validateManifest(manifest, source, await sourceBinding(), o.ledger ?? manifest.ledgerDirectory, now());
    }
    if (o['recover-interrupted']) {
      const reserved = await recoverLedger(o.ledger, binding, signal);
      abortCheck(signal); const result = { recovered: true, phase: 'offline-recovery', reserved };
      report(result); return result;
    }
    if (!o.apply) { report({ dryRun: true, ...safe }); return { dryRun: true, ...safe }; }
    if (!transport) await requireCleanSource();
    abortCheck(signal);
    ledger = await ledgerOpen(o.ledger, binding, o.resume, o.phase, manifest.gates.quota, now());
    abortCheck(signal);
    const key = (await readPrivate(o['key-file'], 16384)).toString('utf8');
    check(key.length > 0 && key.length <= 16384 && !/[\u0000-\u0020\u007f]/.test(key), 'invalid_key_file');
    let ticket;
    const client = new ConvexHttpClient(PRODUCTION_TARGET.cloudUrl, { logger: false,
      fetch: boundedTransport(() => ticket, { transport, signal }) });
    client.setAdminAuth(key);
    const call = async (fn, args) => {
      abortCheck(signal);
      const reservation = await ledger.reserve(fn, args);
      abortCheck(signal);
      ticket = { reservation, fetches: 0 };
      try {
        const value = await client[reservation.kind](makeFunctionReference(fn), args, { skipQueue: true });
        check(ticket.fetches === 1, 'transport_scope'); abortCheck(signal); return value;
      } catch (error) {
        if (error instanceof ProductionImportError) throw error;
        throw new ProductionImportError(signal?.aborted ? 'cancelled' : 'backend_request_failed');
      } finally { ticket = undefined; }
    };
    const match = { fingerprint: source.contentFingerprint, manifestDigest: source.manifestDigest };
    let state;
    if (o.phase === 'stage') {
      // Both are server-idempotent, reserved even on resume. begin supplies the
      // committed nextChunk even if initialize/begin's previous response was lost.
      check(await call('migration:initialize', {}) === null, 'invalid_server_response');
      state = checkpoint(await call('migration:begin', { ...match, exportedAt: canonical.exportedAt,
        chunkCount: plan.chunks.length, tableCounts: plan.tableCounts, expectedCounts: plan.expectedCounts }), plan.chunks.length);
      if (state.phase === 'import') {
        for (let ordinal = state.nextChunk; ordinal < plan.chunks.length; ordinal++) {
          const next = await call('migration:stage', { runId: state.runId, ordinal, operations: plan.chunks[ordinal] });
          fields(next, ['nextChunk'], 'invalid_server_checkpoint');
          check(next.nextChunk === ordinal + 1, 'invalid_server_checkpoint'); state = { ...state, nextChunk: next.nextChunk };
        }
      }
    } else {
      state = checkpoint(await call('migration:status', match), plan.chunks.length, { tableRequired: true });
      if (o.phase === 'verify' && !['verified', 'active'].includes(state.phase)) {
        check(state.nextChunk === plan.chunks.length, 'incomplete_import');
        const frozen = await call('migration:freeze', { runId: state.runId });
        fields(frozen, ['phase'], 'invalid_server_checkpoint');
        check(['verify', 'verified'].includes(frozen.phase) && (state.phase !== 'verify' || frozen.phase === 'verify'), 'invalid_server_checkpoint');
        state = { ...state, ...frozen };
        while (state.phase === 'verify') {
          const next = await call('migration:verifyNext', { runId: state.runId });
          fields(next, ['phase', 'table'], 'invalid_server_checkpoint');
          check(['verify', 'verified'].includes(next.phase) && count(next.table) && next.table >= state.table &&
            next.table <= state.table + 1 && (next.phase === 'verified' ? next.table === migrationTables.length : next.table < migrationTables.length),
          'invalid_server_checkpoint');
          state = { ...state, ...next };
        }
      } else if (o.phase === 'activate-readonly') {
        check(['verified', 'active'].includes(state.phase), 'verification_required');
        if (state.phase === 'verified') {
          const activated = await call('migration:activate', { runId: state.runId, readOnly: true });
          fields(activated, ['phase'], 'invalid_server_response');
          check(activated.phase === 'active', 'invalid_server_response'); state = { ...state, ...activated };
        }
        const desired = { readsEnabled: true, writesEnabled: false };
        check(same(await call('operations:setAvailability', { fingerprint: source.contentFingerprint, ...desired }), desired), 'read_only_not_confirmed');
        check(same(await call('operations:availability', { fingerprint: source.contentFingerprint }), desired), 'read_only_not_confirmed');
      }
    }
    const phase = o.phase === 'activate-readonly' ? 'active-readonly' : state.phase === 'import' ? 'staged' : state.phase;
    await beforeFinalize?.(); abortCheck(signal);
    await ledger.finish('completed'); terminal = true;
    if (signal?.aborted) { await ledger.interrupted(); throw new ProductionImportError('cancelled'); }
    await ledger.close(); abortCheck(signal);
    const result = { phase, ...safe, reserved: ledger.snapshot() };
    report(result); completed = true; return result;
  } catch (error) {
    const safe = error instanceof ProductionImportError ? error : new ProductionImportError('execution_failed');
    if (ledger && !terminal) { await ledger.finish('failed', safe.code); terminal = true; }
    else if (ledger && signal?.aborted && !completed) {
      try { await ledger.interrupted(); } catch { /* Existing immutable cancellation marker is sufficient. */ }
    }
    throw safe;
  } finally { if (ledger && terminal) await ledger.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  try { await runProductionImport(process.argv.slice(2), { signal: controller.signal }); }
  catch (error) {
    const code = error instanceof ProductionImportError ? error.code : 'execution_failed';
    process.stderr.write(`Production import failed (${code}).\n`); process.exitCode = 1;
  } finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
}
