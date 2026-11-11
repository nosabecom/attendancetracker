#!/usr/bin/env node
/**
 * OFFLINE unless --apply. This prepares ONLY the pinned existing production
 * backend. It never creates a deployment/key, initializes an import, or opens
 * application traffic. Publication is not evidence of empty tables or READY.
 *
 * --input PRIVATE_FROZEN --plan PRIVATE_REVIEWED_PLAN --key-file PRIVATE_RAW_KEY
 * --ledger PRIVATE_EMPTY_DIRECTORY --apply
 *
 * Reviewed plan: formatVersion:1, allocation:PRODUCTION_BACKEND_SETUP1,
 * target:PRODUCTION_TARGET, source:describeSource(raw).source, code:sourceBinding(),
 * setupDigest:setupBinding(), ledgerDirectory:absolute path, budgets:SETUP_LIMITS,
 * gates:{source:{reviewed,evidenceDigest,continuousHold:true,reconciled:true},
 * identity:{reviewed,evidenceDigest,target,source,observedAt,state:NeverDeployed},
 * capability:{reviewed,evidenceDigest,kind:PRODUCTION_DEPLOYMENT,target,rawSha256},
 * quota:{reviewed,evidenceDigest,team,plan:CONVEX_BASE,source,observedAt,
 * allProjects:true,timezone:UTC,billingPeriod:{start,end},resources:{metric:{used,limit}}}}.
 * Identity/quota source is convex-dashboard-user-report or
 * convex-dashboard-agent-observation. Quota uses SETUP_HEADROOM. These assertions
 * require genuine, privately reviewed UI/key evidence supplied by the operator;
 * this helper cannot manufacture or independently authenticate that evidence.
 *
 * The plan and ledger share a private parent. An exclusive pinned-target marker
 * there prevents another ledger path for this allocation. Keep that marker and
 * EVERY reservation/outcome, including uncertainty. No retry, resume, recovery,
 * reset, cleanup, or READY manifest generation is provided. A changed plan/path
 * is not a new allowance. Setup's 20 controls and one CLI publication are separate
 * from production import's 55 calls; CLI internal requests/billing are unknown.
 */
import { constants, open, lstat, realpath, readdir, readFile } from 'node:fs/promises';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { PRODUCTION_TARGET, describeSource, sourceBinding, readPrivate } from './execute-production-import.mjs';
import { stable } from '../lib/convex-migration-plan.mjs';
import { publicationEnvironment } from './hosted-validation-policy.mjs';
import { checkPublicationSelection } from './check-convex-publication-selection.mjs';

export const SETUP_LIMITS = Object.freeze({ controlAttempts: 20, cliPublications: 1 });
export const SETUP_HEADROOM = Object.freeze({ functionCalls: 1000, databaseIoGb: 0.025, databaseStorageGb: 0.005 });
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOCATION = 'PRODUCTION_BACKEND_SETUP1';
const ENV_NAMES = Object.freeze(['JWT_PRIVATE_KEY', 'JWKS', 'ATTENDANCE_GATEWAY_KEY', 'ATTENDANCE_GATEWAY_AUDIENCE']);
const ENV_QUERY = '_system/cli/queryEnvironmentVariables';
const SPEC_QUERY = '_system/cli/modules:apiSpec';
const sha = data => createHash('sha256').update(data).digest('hex');
const same = (a, b) => stable(a) === stable(b);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const check = (condition, code) => { if (!condition) throw new ProductionSetupError(code); };
const fields = (value, names, code) => check(object(value) && same(Object.keys(value).sort(), [...names].sort()), code);
const cancelled = signal => check(!signal?.aborted, 'cancelled');
export class ProductionSetupError extends Error {
  constructor(code) { super(`Production backend setup stopped (${code}).`); this.name = 'ProductionSetupError'; this.code = code; }
}
function json(data) {
  try { return JSON.parse(data.toString('utf8')); } catch { throw new ProductionSetupError('private_json_invalid'); }
}
export function parseArgs(argv) {
  const options = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].slice(2);
    check(argv[i].startsWith('--') && !Object.hasOwn(options, name === 'apply' ? '_applied' : name), 'invalid_arguments');
    if (name === 'apply') { check(!options.apply, 'invalid_arguments'); options.apply = true; }
    else {
      check(['input', 'plan', 'key-file', 'ledger'].includes(name) && argv[i + 1] && !argv[i + 1].startsWith('--'), 'invalid_arguments');
      options[name] = argv[++i];
    }
  }
  check(options.input && (!options.apply || (options.plan && options['key-file'] && options.ledger)), 'invalid_arguments');
  return options;
}

/** Bind this helper, selector/formatter, and installed protocol primary sources. */
export async function setupBinding() {
  const sdk = join(ROOT, 'node_modules/convex');
  check(json(await readFile(join(sdk, 'package.json'))).version === '1.49.0', 'protocol_version');
  const paths = ['scripts/prepare-production-backend.mjs', 'scripts/hosted-validation-policy.mjs',
    'scripts/check-convex-publication-selection.mjs', 'node_modules/convex/src/cli/lib/env.ts',
    'node_modules/convex/src/cli/lib/functionSpec.ts', 'node_modules/convex/src/cli/lib/usageLimits.ts',
    'node_modules/convex/src/browser/http_client.ts'];
  const bound = [];
  for (const path of paths) bound.push([path, sha(await readFile(join(ROOT, path)))]);
  // env.ts names the system query; http_client.ts supplies its one-shot query
  // transport. No guessed environment-list REST endpoint or WS subscription.
  const env = await readFile(join(sdk, 'src/cli/lib/env.ts'), 'utf8');
  const spec = await readFile(join(sdk, 'src/cli/lib/functionSpec.ts'), 'utf8');
  check(env.includes(`functionName: "${ENV_QUERY}"`) && env.includes('"/api/update_environment_variables"') &&
    spec.includes(`functionName: "${SPEC_QUERY}"`), 'protocol_unsupported');
  return sha(stable(bound));
}
async function cleanSource() {
  const paths = ['app', 'convex', 'lib', 'patches', 'scripts', 'tests', 'package.json', 'pnpm-lock.yaml',
    'pnpm-workspace.yaml', 'convex.json', 'tsconfig.json'];
  try {
    const { stdout } = await promisify(execFile)('git', ['status', '--porcelain=v1', '--untracked-files=all', '--', ...paths],
      { cwd: ROOT, env: { PATH: process.env.PATH, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 1024 * 1024 });
    check(stdout.length === 0, 'source_tree_dirty');
  } catch { throw new ProductionSetupError('source_tree_dirty'); }
}
async function privateDirectory(path) {
  const full = resolve(path), stat = await lstat(full);
  check(path === full && await realpath(full) === full && stat.isDirectory() && !stat.isSymbolicLink() &&
    stat.uid === process.getuid() && (stat.mode & 0o777) === 0o700, 'private_directory');
  return full;
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function exclusive(path, value, mode = 0o400) {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(value); await handle.chmod(mode); await handle.sync(); }
  finally { await handle.close(); }
  await syncDirectory(dirname(path));
}
const retain = (dir, name, value) => exclusive(join(dir, name), `${JSON.stringify(value)}\n`);
function recent(value, now, code) {
  const time = Date.parse(value);
  check(Number.isFinite(time) && now - time <= 86400000 && time - now <= 300000, code);
  return time;
}
const dashboardSource = value => ['convex-dashboard-user-report', 'convex-dashboard-agent-observation'].includes(value);
function validatePlan(plan, source, code, setupDigest, ledger, now) {
  fields(plan, ['formatVersion', 'allocation', 'target', 'source', 'code', 'setupDigest', 'ledgerDirectory', 'budgets', 'gates'], 'plan_shape');
  check(plan.formatVersion === 1 && plan.allocation === ALLOCATION && same(plan.target, PRODUCTION_TARGET), 'target_mismatch');
  check(same(plan.source, source), 'frozen_source_mismatch');
  check(same(plan.code, code) && plan.setupDigest === setupDigest, 'source_code_mismatch');
  check(plan.ledgerDirectory === ledger && ledger === resolve(ledger) && same(plan.budgets, SETUP_LIMITS), 'allocation_mismatch');
  fields(plan.gates, ['source', 'identity', 'capability', 'quota'], 'plan_gates');
  for (const gate of Object.values(plan.gates)) check(object(gate) && gate.reviewed === true && hash(gate.evidenceDigest), 'plan_gates');
  fields(plan.gates.source, ['reviewed', 'evidenceDigest', 'continuousHold', 'reconciled'], 'source_gate');
  check(plan.gates.source.continuousHold === true && plan.gates.source.reconciled === true, 'source_gate');
  const identity = plan.gates.identity;
  fields(identity, ['reviewed', 'evidenceDigest', 'target', 'source', 'observedAt', 'state'], 'identity_gate');
  check(same(identity.target, PRODUCTION_TARGET) && dashboardSource(identity.source) && identity.state === 'NeverDeployed', 'identity_gate');
  recent(identity.observedAt, now, 'identity_stale');
  const capability = plan.gates.capability;
  fields(capability, ['reviewed', 'evidenceDigest', 'kind', 'target', 'rawSha256'], 'capability_gate');
  check(capability.kind === 'PRODUCTION_DEPLOYMENT' && same(capability.target, PRODUCTION_TARGET) && hash(capability.rawSha256), 'capability_gate');
  const q = plan.gates.quota;
  fields(q, ['reviewed', 'evidenceDigest', 'team', 'plan', 'source', 'observedAt', 'allProjects', 'timezone', 'billingPeriod', 'resources'], 'quota_gate');
  check(q.team === PRODUCTION_TARGET.team && q.plan === 'CONVEX_BASE' && dashboardSource(q.source), 'quota_gate');
  const observed = recent(q.observedAt, now, 'quota_stale');
  fields(q.billingPeriod, ['start', 'end'], 'quota_period');
  const start = Date.parse(q.billingPeriod.start), end = Date.parse(q.billingPeriod.end);
  check(q.allProjects === true && q.timezone === 'UTC' && Number.isFinite(start) && Number.isFinite(end) &&
    new Date(start).toISOString() === q.billingPeriod.start && new Date(end).toISOString() === q.billingPeriod.end &&
    start <= now && now < end && start <= observed && observed < end, 'quota_period');
  fields(q.resources, Object.keys(SETUP_HEADROOM), 'quota_gate');
  for (const [metric, headroom] of Object.entries(SETUP_HEADROOM)) {
    const r = q.resources[metric]; fields(r, ['used', 'limit'], 'quota_gate');
    check(Number.isFinite(r.used) && Number.isFinite(r.limit) && r.used >= 0 && r.limit > 0 &&
      r.limit - r.used >= headroom && (metric !== 'functionCalls' || (Number.isSafeInteger(r.used) && Number.isSafeInteger(r.limit))), 'quota_headroom');
  }
}
function canonical(value) {
  check(object(value) && value.convexCloudUrl === PRODUCTION_TARGET.cloudUrl &&
    value.convexSiteUrl === PRODUCTION_TARGET.siteUrl, 'canonical_identity_mismatch');
}
function environment(value) {
  check(Array.isArray(value) && value.length <= 1000 && value.every(entry => object(entry) &&
    typeof entry.name === 'string' && typeof entry.value === 'string') &&
    new Set(value.map(entry => entry.name)).size === value.length, 'environment_unsupported');
  return new Map(value.map(entry => [entry.name, entry.value]));
}
function limits(value, required = false) {
  check(object(value) && Array.isArray(value.usageLimits) && value.usageLimits.every(x => object(x) &&
    typeof x.metric === 'string' && x.metric.length > 0 && ['day', 'month'].includes(x.window) &&
    ['disable', 'warning'].includes(x.limitType) && Number.isFinite(x.limit) && x.limit >= 0 &&
    typeof x.enabled === 'boolean'), 'limits_unsupported');
  check(value.usageLimits.length <= 1 && (!required || value.usageLimits.length === 1) &&
    value.usageLimits.every(x => x.metric === 'functionCalls' && x.window === 'day' &&
      x.limitType === 'disable' && x.limit === 1000 && x.enabled === true), 'existing_limit_conflict');
  return value.usageLimits.length === 1;
}
function generateConfiguration() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { JWT_PRIVATE_KEY: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString().trimEnd().replace(/\n/g, ' '),
    JWKS: JSON.stringify({ keys: [{ use: 'sig', ...publicKey.export({ format: 'jwk' }) }] }),
    ATTENDANCE_GATEWAY_KEY: randomBytes(32).toString('hex'),
    ATTENDANCE_GATEWAY_AUDIENCE: `attendance-production-${randomBytes(16).toString('hex')}` };
}
function inspectSpec(value) {
  check(Array.isArray(value), 'published_spec_unsupported');
  const expected = ['migration:initialize', 'migration:begin', 'migration:stage', 'migration:freeze',
    'migration:verifyNext', 'migration:activate', 'migration:status', 'operations:setAvailability', 'operations:availability'];
  for (const name of expected) {
    const [module, fn] = name.split(':'), found = value.filter(x => x?.identifier === `${module}.js:${fn}`);
    // cli/lib/run.ts consumes these exact apiSpec fields and strips `.js`.
    check(found.length === 1 &&
      found[0].functionType === (['migration:status', 'operations:availability'].includes(name) ? 'Query' : 'Mutation'), 'published_spec_mismatch');
  }
  const activate = value.find(x => x?.identifier === 'migration.js:activate');
  // The installed primary sources define the validator and visibility encodings,
  // but apiSpec is typed any[]. Observe a supported shape when actually returned;
  // do not guess alternate encodings or equate publication with READY evidence.
  const readOnlyMetadata = activate.args?.type === 'object' && activate.args.value?.readOnly?.optional === true &&
    activate.args.value.readOnly.fieldType?.type === 'boolean' ? 'observed_supported_shape' : 'operator_review_required';
  const visibilityMetadata = expected.every(name => value.find(x => x?.identifier === name.replace(':', '.js:'))?.visibility?.kind === 'internal') ?
    'observed_supported_shape' : 'operator_review_required';
  return { identifierTypesVerified: true, readOnlyMetadata, visibilityMetadata,
    publishedFunctionMetadataVerified: readOnlyMetadata === 'observed_supported_shape' && visibilityMetadata === 'observed_supported_shape' };
}

async function bounded(operation, signal) {
  check(!signal.aborted, 'control_request_failed');
  let stop;
  const interruption = new Promise((_, reject) => {
    stop = () => reject(new ProductionSetupError('control_request_failed'));
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
  });
  try { return await Promise.race([operation, interruption]); }
  finally { signal.removeEventListener('abort', stop); }
}

// Detached publication owns this Linux session/process group exclusively.
// A successful or failed leader can leave children after its `close` event.
// Kill on EVERY terminal exit; zombies are already stopped and cannot publish.
async function closePublicationGroup(group) {
  if (process.platform !== 'linux' || !Number.isSafeInteger(group) || group <= 0) return { confirmed: false, lingering: true };
  try { process.kill(-group, 'SIGKILL'); }
  catch (error) { return { confirmed: error.code === 'ESRCH', lingering: error.code !== 'ESRCH' }; }
  const deadline = performance.now() + 2000;
  do {
    let live = false;
    for (const pid of await readdir('/proc')) {
      if (!/^[0-9]+$/.test(pid)) continue;
      let stat;
      try { stat = await readFile(`/proc/${pid}/stat`, 'utf8'); }
      catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') continue; return { confirmed: false, lingering: true }; }
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (Number(fields[2]) === group && !['Z', 'X'].includes(fields[0])) { live = true; break; }
    }
    if (!live) return { confirmed: true, lingering: true };
    if (performance.now() >= deadline) return { confirmed: false, lingering: true };
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  } while (true);
}

/** Exactly one child process group; private handles never become console output. */
export async function publishOnce({ envFile, stdout, stderr, signal }) {
  cancelled(signal);
  return await new Promise((resolvePublication, reject) => {
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG || 'C.UTF-8',
      CI: '1', CONVEX_DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1' };
    let child, timer, killTimer, uncertain = false;
    const stop = () => {
      uncertain = true;
      if (child?.pid) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch {}
        killTimer ??= setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 2000);
      }
    };
    try {
      child = spawn('pnpm', ['exec', 'convex', 'deploy', '--typecheck', 'enable', '--codegen', 'disable', '--env-file', envFile],
        { cwd: ROOT, env, detached: true, stdio: ['ignore', stdout, stderr] });
      timer = setTimeout(stop, 180000);
      signal?.addEventListener('abort', stop, { once: true });
      child.once('error', () => { uncertain = true; });
      child.once('close', async (status, terminationSignal) => {
        // Finish and verify the owned group even when the leader exited on its
        // own, including status 0. Unknown cleanup can never report success.
        if (child.pid) {
          try {
            const cleanup = await closePublicationGroup(child.pid);
            if (!cleanup.confirmed || cleanup.lingering) uncertain = true;
          }
          catch { uncertain = true; }
        }
        clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', stop);
        resolvePublication({ status, signal: terminationSignal, uncertain: uncertain || !!signal?.aborted });
      });
      if (signal?.aborted) stop();
    } catch { clearTimeout(timer); signal?.removeEventListener('abort', stop); reject(new ProductionSetupError('publication_uncertain')); }
  });
}

export async function runProductionBackendSetup(argv, dependencies = {}) {
  let ledger, controls = 0, publications = 0, phase = 'offline preflight', owned = false;
  const signal = dependencies.signal, now = dependencies.now ?? Date.now;
  try {
    const options = parseArgs(argv);
    const { source } = describeSource(await readPrivate(options.input));
    const code = await sourceBinding(), setupDigest = await setupBinding();
    cancelled(signal);
    if (!options.apply) {
      const result = { dryRun: true, target: PRODUCTION_TARGET, controlAttempts: 0, cliPublications: 0,
        frozenObjects: source.blobCount, importInitialized: false, readyManifestCreated: false };
      dependencies.report?.(result); return result;
    }
    ledger = options.ledger;
    const paths = [options.input, options.plan, options['key-file'], ledger].map(path => resolve(path));
    check(new Set(paths).size === paths.length && dirname(resolve(options.plan)) === dirname(ledger), 'private_paths_conflict');
    const plan = json(await readPrivate(options.plan, 1024 * 1024));
    validatePlan(plan, source, code, setupDigest, ledger, now());
    await (dependencies.cleanSource ?? cleanSource)();
    const keyBytes = await readPrivate(options['key-file'], 16384), key = keyBytes.toString('utf8');
    check(Buffer.from(key).equals(keyBytes) && sha(keyBytes) === plan.gates.capability.rawSha256, 'capability_mismatch');
    let targetBody;
    try { targetBody = publicationEnvironment(PRODUCTION_TARGET.cloudUrl, key); }
    catch { throw new ProductionSetupError('capability_invalid'); }
    const selection = (dependencies.selectorCheck ?? checkPublicationSelection)();
    check(selection?.directTargetSelected === true && selection.opaqueCapabilityPreserved === true && selection.realNetworkRequests === 0 && selection.claimRequests === 0, 'selector_check_failed');
    await privateDirectory(ledger); await privateDirectory(dirname(ledger));
    check((await readdir(ledger)).length === 0, 'allocation_already_used');
    // Root-level marker is intentionally retained forever, even on later failure.
    await retain(dirname(ledger), `production-backend-${PRODUCTION_TARGET.deploymentName}-${ALLOCATION}.json`,
      { allocation: ALLOCATION, target: PRODUCTION_TARGET, source, code, setupDigest, ledgerDirectory: ledger });
    owned = true;
    await retain(ledger, 'allocation.json', { ...plan, createdAt: new Date(now()).toISOString(), selection });
    const transport = dependencies.transport ?? fetch;
    async function request(path, method = 'GET', body) {
      cancelled(signal); check(controls < SETUP_LIMITS.controlAttempts, 'control_budget_exceeded');
      const ordinal = ++controls, name = String(ordinal).padStart(6, '0');
      await retain(ledger, `request-${name}.reservation.json`, { ordinal, phase, path, method,
        requestBodySha256: body === undefined ? null : sha(JSON.stringify(body)), outcome: 'submitted_or_uncertain' });
      cancelled(signal);
      let value;
      try {
        const timeout = AbortSignal.timeout(20000);
        const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
        const response = await bounded(transport(`${PRODUCTION_TARGET.cloudUrl}${path}`, { method, redirect: 'error',
          signal: requestSignal,
          headers: { Authorization: `Convex ${key}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), requestSignal);
        check(response.ok && response.body, 'control_request_failed');
        const reader = response.body.getReader(), chunks = []; let size = 0;
        try {
          for (;;) { const next = await bounded(reader.read(), requestSignal); if (next.done) break;
            size += next.value.byteLength; check(size <= 1024 * 1024, 'control_response_limit'); chunks.push(Buffer.from(next.value)); }
        } finally { void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch {} }
        const raw = Buffer.concat(chunks); value = raw.length ? json(raw) : null;
        // Existing/builtin values and provider log lines have no evidentiary
        // purpose here. Keep only environment names; compare values in memory.
        const retainedValue = path !== '/api/query' ? value : {
          status: ['success', 'error'].includes(value?.status) ? value.status : 'unsupported',
          ...(value?.status === 'success' ? { value: body?.path === ENV_QUERY ?
            (Array.isArray(value.value) ? value.value.map(entry => ({ name: entry?.name })) : 'unsupported') : value.value } : {}),
        };
        await retain(ledger, `request-${name}.response.json`, { ordinal, value: retainedValue });
        cancelled(signal); return value;
      } catch {
        await retain(ledger, `request-${name}.uncertain.json`, { ordinal, outcome: 'failed_cancelled_or_uncertain' });
        throw new ProductionSetupError(signal?.aborted ? 'cancelled' : 'control_request_failed');
      }
    }
    // The installed SDK constructs/validates the exact system-query envelope;
    // every underlying intentional HTTP dispatch is reserved by request().
    const client = new ConvexHttpClient(PRODUCTION_TARGET.cloudUrl, { logger: false, fetch: async (url, init) => {
      check(url === `${PRODUCTION_TARGET.cloudUrl}/api/query` && init.method === 'POST', 'query_scope');
      const body = json(Buffer.from(init.body));
      check([ENV_QUERY, SPEC_QUERY].includes(body.path) && body.format === 'convex_encoded_json' &&
        same(body.args, [{}]), 'query_scope');
      const response = await request('/api/query', 'POST', body);
      return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
    } });
    client.setAdminAuth(key);
    const query = async name => {
      try { return await client.query(makeFunctionReference(name), {}); }
      catch (error) { throw error instanceof ProductionSetupError ? error : new ProductionSetupError('system_query_failed'); }
    };
    phase = 'canonical identity before configuration'; canonical(await request('/api/v1/get_canonical_urls'));
    phase = 'baseline usage'; const usage = await request('/api/v1/get_current_usage');
    check(object(usage) && object(usage.metrics), 'usage_unsupported');
    phase = 'baseline limits'; const present = limits(await request('/api/v1/list_usage_limits'));
    phase = 'existing environment'; const before = environment(await query(ENV_QUERY));
    check(ENV_NAMES.every(name => !before.has(name)), 'existing_environment_conflict');
    await retain(ledger, 'existing-environment-names.json', [...before.keys()].sort());
    phase = 'daily function limit';
    if (!present) await request('/api/v1/create_usage_limit', 'POST', { metric: 'functionCalls', window: 'day', limitType: 'disable', limit: 1000, enabled: true });
    limits(await request('/api/v1/list_usage_limits'), true);
    phase = 'private configuration'; const config = generateConfiguration();
    await retain(ledger, 'generated-configuration.json', config);
    await exclusive(join(ledger, 'publication-target.env'), targetBody);
    phase = 'environment configuration';
    await request('/api/update_environment_variables', 'POST', { changes: ENV_NAMES.map(name => ({ name, value: config[name] })) });
    const after = environment(await query(ENV_QUERY));
    check(ENV_NAMES.every(name => after.get(name) === config[name]) &&
      [...before].every(([name, value]) => after.get(name) === value) && after.size === before.size + ENV_NAMES.length, 'environment_readback_mismatch');
    phase = 'publication preflight';
    check(same(await sourceBinding(), code) && await setupBinding() === setupDigest, 'source_code_mismatch');
    await (dependencies.cleanSource ?? cleanSource)();
    validatePlan(plan, source, code, setupDigest, ledger, now()); cancelled(signal);
    const logs = [];
    try {
      for (const name of ['publication.stdout', 'publication.stderr']) {
        const handle = await open(join(ledger, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        logs.push(handle); await handle.sync();
      }
      await syncDirectory(ledger);
      check(publications < SETUP_LIMITS.cliPublications, 'publication_budget_exceeded');
      publications++;
      await retain(ledger, 'publication.reservation.json', { ordinal: publications, outcome: 'submitted_or_uncertain',
        source: code, setupDigest, target: PRODUCTION_TARGET, timeoutMs: 180000, internalRequests: 'unknown' });
      phase = 'publication'; cancelled(signal);
      let result;
      try {
        result = await (dependencies.publish ?? publishOnce)({ envFile: join(ledger, 'publication-target.env'),
          stdout: logs[0].fd, stderr: logs[1].fd, signal });
      } catch {
        await retain(ledger, 'publication.uncertain.json', { outcome: 'failed_cancelled_or_uncertain' });
        throw new ProductionSetupError('publication_uncertain');
      }
      await retain(ledger, 'publication.outcome.json', { status: Number.isInteger(result?.status) ? result.status : null,
        signal: result?.signal ? 'terminated' : null, uncertain: result?.uncertain !== false || !!signal?.aborted });
      check(result?.status === 0 && result.signal === null && result.uncertain === false, 'publication_uncertain'); cancelled(signal);
    } finally {
      for (const handle of logs) { await handle.chmod(0o400); await handle.sync(); await handle.close(); }
      await syncDirectory(ledger);
    }
    phase = 'canonical identity after publication'; canonical(await request('/api/v1/get_canonical_urls'));
    phase = 'published function metadata'; const metadata = inspectSpec(await query(SPEC_QUERY));
    phase = 'final source check';
    check(same(await sourceBinding(), code) && await setupBinding() === setupDigest, 'source_code_mismatch');
    await (dependencies.cleanSource ?? cleanSource)(); cancelled(signal);
    await retain(ledger, 'publication-receipt.json', { formatVersion: 1, allocation: ALLOCATION, target: PRODUCTION_TARGET,
      source, code, setupDigest, completedAt: new Date(now()).toISOString(), controlAttempts: controls, cliPublications: publications,
      cliInternalRequests: 'unknown', canonicalUrlsVerified: true, exactConfigurationReadback: true, ...metadata,
      importInitialized: false, targetTableCounts: 'not inspected', readyManifestCreated: false,
      operatorReviewRequired: true, stoppedRecordInvalidatesReceipt: true });
    cancelled(signal);
    const result = { dryRun: false, setup: 'published', target: PRODUCTION_TARGET, controlAttempts: controls,
      cliPublications: publications, importInitialized: false, readyManifestCreated: false };
    dependencies.report?.(result); return result;
  } catch (error) {
    const safe = error instanceof ProductionSetupError ? error : new ProductionSetupError('setup_guard_failed');
    if (owned) await retain(ledger, 'stopped.json', { phase, code: safe.code, controlAttempts: controls,
      cliPublications: publications, operatorReviewRequired: true }).catch(() => {});
    throw safe;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    const result = await runProductionBackendSetup(process.argv.slice(2), { signal: controller.signal });
    console.log(result.dryRun ? 'Offline production setup preflight passed; no requests or publication.' :
      'Production backend publication completed. Import and READY review remain separate.');
  } catch (error) {
    console.error(error instanceof ProductionSetupError ? error.message : 'Production backend setup stopped (setup_guard_failed).');
    process.exitCode = 1;
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
