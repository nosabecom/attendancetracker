#!/usr/bin/env node
/** One-shot setup of the already-owned, never-deployed development target.
 * --evidence PRIVATE_JSON --key-file PRIVATE_FILE --ledger PRIVATE_EMPTY_DIR --apply
 * Evidence: {target:TARGET, observedAt:ISO, source:'convex-dashboard-agent-observation',
 * neverDeployed:true, evidenceDigest:sha256, capabilitySha256:sha256, reviewedSourceCommit:HEAD}.
 * The evidence is an operator assertion, not a claim this script observed the dashboard.
 * Ledger and the fixed home-directory allocation marker must be retained permanently.
 */
import { constants, open, lstat, realpath, readdir, readFile } from 'node:fs/promises';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference, getFunctionName } from 'convex/server';
import { readPrivate, sourceBinding } from './execute-production-import.mjs';
import { publicationEnvironment } from './hosted-validation-policy.mjs';
import { checkPublicationSelection } from './check-convex-publication-selection.mjs';
import { publishOnce } from './prepare-production-backend.mjs';
import { runImport } from './import-blob.mjs';

export const TARGET = Object.freeze({ name: 'amicable-koala-816', projectId: 3365270, kind: 'cloud', deploymentType: 'dev', cloudUrl: 'https://amicable-koala-816.convex.cloud', siteUrl: 'https://amicable-koala-816.convex.site' });
export const FINGERPRINT = 'a3ceb7886db76f635b60fcb05541abfc3d7f425cb0322d2211afd2299eb037ba';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EMPTY = { formatVersion: 1, exportedAt: '2026-10-02T01:02:03.004Z', blobs: [] };
const hash = x => createHash('sha256').update(x).digest('hex');
const fail = code => { throw new Error(code); };
const check = (condition, code) => { if (!condition) fail(code); };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const obj = x => x && typeof x === 'object' && !Array.isArray(x);
const ENV = ['JWT_PRIVATE_KEY', 'JWKS', 'ATTENDANCE_GATEWAY_KEY', 'ATTENDANCE_GATEWAY_AUDIENCE'];
const costs = { 'migration:initialize': 1, 'migration:begin': 2, 'migration:freeze': 1, 'migration:verifyNext': 1, 'migration:activate': 2, 'operations:setAvailability': 1, 'migration:status': 0, 'operations:availability': 0 };
export function validateEvidence(e, code, now = Date.now()) {
  check(obj(e) && equal(e.target, TARGET) && e.source === 'convex-dashboard-agent-observation' && e.neverDeployed === true &&
    /^[a-f0-9]{64}$/.test(e.evidenceDigest ?? '') && /^[a-f0-9]{64}$/.test(e.capabilitySha256 ?? '') &&
    e.reviewedSourceCommit === code.commit && /^[a-f0-9]{40}$/.test(code.commit), 'evidence_invalid');
  const t = Date.parse(e.observedAt); check(Number.isFinite(t) && now - t <= 86400000 && t - now <= 300000, 'evidence_stale');
}
export function validateCanonical(v) { check(obj(v) && v.convexCloudUrl === TARGET.cloudUrl && v.convexSiteUrl === TARGET.siteUrl, 'canonical_mismatch'); }
export function validateEmptyTables(v) {
  check(obj(v) && Array.isArray(v.page) && v.page.length === 0 && v.isDone === true && typeof v.continueCursor === 'string', 'tables_not_verified_empty');
}
export function validateEnvironment(v) {
  check(Array.isArray(v) && v.length <= 1000 && v.every(x => obj(x) && typeof x.name === 'string' && typeof x.value === 'string') && new Set(v.map(x => x.name)).size === v.length, 'environment_unsupported');
  return new Map(v.map(x => [x.name, x.value]));
}
export function validateLimits(v, required = false) {
  check(obj(v) && Array.isArray(v.usageLimits) && v.usageLimits.length <= 1 && (!required || v.usageLimits.length === 1) && v.usageLimits.every(x => x.metric === 'functionCalls' && x.window === 'day' && x.limitType === 'disable' && x.limit === 1000 && x.enabled === true), 'limit_conflict');
  return v.usageLimits.length === 1;
}
export function generateConfiguration() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { JWT_PRIVATE_KEY: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString().trimEnd().replace(/\n/g, ' '), JWKS: JSON.stringify({ keys: [{ use: 'sig', ...publicKey.export({ format: 'jwk' }) }] }), ATTENDANCE_GATEWAY_KEY: randomBytes(32).toString('hex'), ATTENDANCE_GATEWAY_AUDIENCE: `attendance-development-${randomBytes(16).toString('hex')}` };
}
async function privateDir(path) {
  check(path === resolve(path), 'directory_invalid'); const s = await lstat(path);
  check(await realpath(path) === path && s.isDirectory() && !s.isSymbolicLink() && s.uid === process.getuid() && (s.mode & 0o777) === 0o700, 'directory_invalid');
}
async function retain(path, value) {
  const h = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await h.writeFile(typeof value === 'string' ? value : JSON.stringify(value) + '\n'); await h.sync(); } finally { await h.close(); }
  const d = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { await d.sync(); } finally { await d.close(); }
}
export async function claimAllocation(marker, value) { await retain(marker, value); }
async function setupDigest() {
  const files = ['scripts/prepare-owned-development.mjs', 'scripts/prepare-production-backend.mjs', 'scripts/import-blob.mjs', 'scripts/hosted-validation-policy.mjs', 'scripts/check-convex-publication-selection.mjs', 'node_modules/convex/src/cli/lib/data.ts', 'node_modules/convex/src/cli/lib/run.ts', 'node_modules/convex/src/cli/lib/env.ts'];
  return hash(JSON.stringify(await Promise.all(files.map(async p => [p, hash(await readFile(join(ROOT, p)))]))));
}
async function protocolCheck() {
  const [pkg, data, run, env] = await Promise.all(['package.json', 'src/cli/lib/data.ts', 'src/cli/lib/run.ts', 'src/cli/lib/env.ts'].map(p => readFile(join(ROOT, 'node_modules/convex', p), 'utf8')));
  check(JSON.parse(pkg).version === '1.49.0' && data.includes('functionName: "_system/cli/tables"') && run.includes('paginationOpts: {') && run.includes('10000') && env.includes('functionName: "_system/cli/queryEnvironmentVariables"') && env.includes('"/api/update_environment_variables"'), 'protocol_unsupported');
}
function cleanBackend(commit) {
  const paths = ['convex', 'lib', 'patches', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'convex.json'];
  execFileSync('git', ['diff', '--quiet', commit, '--', ...paths], { cwd: ROOT });
  check(!execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', ...paths], { cwd: ROOT, encoding: 'utf8' }).trim(), 'source_dirty');
}
export async function prepareOwnedDevelopment({ evidencePath, keyFile, ledger, apply = false }, deps = {}) {
  await protocolCheck();
  const code = await sourceBinding(), setup = await setupDigest(); (deps.cleanBackend ?? cleanBackend)(code.commit);
  if (!apply) return { dryRun: true, target: TARGET, reviewedSourceCommit: code.commit };
  check([evidencePath, keyFile, ledger].every(x => typeof x === 'string' && x === resolve(x)) && new Set([evidencePath, keyFile, ledger]).size === 3, 'paths_invalid');
  const evidence = JSON.parse((await readPrivate(evidencePath, 16384)).toString('utf8'));
  validateEvidence(evidence, code, deps.now?.() ?? Date.now());
  const bytes = await readPrivate(keyFile, 16384), key = bytes.toString('utf8');
  check(Buffer.from(key).equals(bytes) && hash(bytes) === evidence.capabilitySha256, 'capability_mismatch');
  const envFileContent = publicationEnvironment(TARGET.cloudUrl, key);
  const selection = checkPublicationSelection();
  check(selection.directTargetSelected && selection.opaqueCapabilityPreserved && selection.realNetworkRequests === 0 && selection.claimRequests === 0, 'selection_invalid');
  await privateDir(ledger); await privateDir(dirname(ledger)); check((await readdir(ledger)).length === 0, 'ledger_used');
  // A fixed marker prevents switching ledger directories to reset this allocation.
  const marker = deps.allocationMarker ?? join(homedir(), '.attendance-owned-development-amicable-koala-816.json');
  await claimAllocation(marker, { target: TARGET, ledger, evidenceDigest: evidence.evidenceDigest, code, setup });
  let controls = 0, calls = 0, writes = 0, publications = 0, phase = 'allocation', closing = false;
  const save = (name, value) => retain(join(ledger, name), value);
  try {
    await save('allocation.json', { target: TARGET, evidence, code, setup, selection, limits: { controls: 20, publications: 1, applicationCalls: 40, logicalWrites: 40 } });
    async function request(path, method = 'GET', body, app = false, cost = 0) {
      check(closing || !deps.signal?.aborted, 'cancelled');
      if (app) { check(calls < (closing ? 40 : 38) && writes + cost <= (closing ? 40 : 39), 'app_budget'); calls++; writes += cost; }
      else { check(controls < 20, 'control_budget'); controls++; }
      const ordinal = app ? calls : controls, prefix = `${app ? 'app' : 'control'}-${String(ordinal).padStart(3, '0')}`;
      await save(`${prefix}.reservation.json`, { phase, path, method, bodySha256: body === undefined ? null : hash(JSON.stringify(body)), cost, outcome: 'submitted_or_uncertain' });
      const signal = deps.signal && !closing ? AbortSignal.any([deps.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000);
      const response = await (deps.transport ?? fetch)(TARGET.cloudUrl + path, { method, redirect: 'error', signal, headers: { Authorization: `Convex ${key}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      check(response.ok && response.body, 'request_failed');
      const reader = response.body.getReader(), chunks = []; let length = 0;
      try { for (;;) { const r = await reader.read(); if (r.done) break; length += r.value.length; check(length <= 1048576, 'response_too_large'); chunks.push(Buffer.from(r.value)); } } finally { await reader.cancel().catch(() => {}); }
      const raw = Buffer.concat(chunks); const value = raw.length ? JSON.parse(raw.toString('utf8')) : null;
      await save(`${prefix}.response.json`, { success: true, responseSha256: hash(raw) }); return value;
    }
    const client = new ConvexHttpClient(TARGET.cloudUrl, { logger: false, fetch: async (url, init) => {
      check(url === TARGET.cloudUrl + '/api/query' || url === TARGET.cloudUrl + '/api/mutation', 'rpc_scope');
      const body = JSON.parse(init.body), fn = body.path, system = ['_system/cli/tables', '_system/cli/queryEnvironmentVariables'].includes(fn);
      check(system ? url.endsWith('/query') : Object.hasOwn(costs, fn), 'rpc_scope');
      const value = await request(new URL(url).pathname, 'POST', body, !system, system ? 0 : costs[fn]);
      return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
    } });
    client.setAdminAuth(key);
    const query = (name, args = {}) => client.query(makeFunctionReference(name), args);
    const mutation = (name, args) => client.mutation(makeFunctionReference(name), args);
    phase = 'identity and empty tables'; validateCanonical(await request('/api/v1/get_canonical_urls'));
    validateEmptyTables(await query('_system/cli/tables', { paginationOpts: { cursor: null, numItems: 10000 } }));
    phase = 'baseline'; const before = validateEnvironment(await query('_system/cli/queryEnvironmentVariables'));
    check(ENV.every(n => !before.has(n)), 'environment_conflict');
    const present = validateLimits(await request('/api/v1/list_usage_limits'));
    phase = 'guard'; if (!present) await request('/api/v1/create_usage_limit', 'POST', { metric: 'functionCalls', window: 'day', limitType: 'disable', limit: 1000, enabled: true });
    validateLimits(await request('/api/v1/list_usage_limits'), true);
    const config = generateConfiguration(); await save('generated-configuration.json', config); await save('publication-target.env', envFileContent);
    phase = 'configuration'; await request('/api/update_environment_variables', 'POST', { changes: ENV.map(name => ({ name, value: config[name] })) });
    const after = validateEnvironment(await query('_system/cli/queryEnvironmentVariables'));
    check(ENV.every(n => after.get(n) === config[n]) && [...before].every(([n, v]) => after.get(n) === v) && after.size === before.size + ENV.length, 'environment_readback');
    phase = 'publication'; check(equal(await sourceBinding(), code) && await setupDigest() === setup, 'source_changed'); (deps.cleanBackend ?? cleanBackend)(code.commit);
    const logs = [];
    try {
      for (const name of ['publication.stdout', 'publication.stderr']) logs.push(await open(join(ledger, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600));
      publications++; await save('publication.reservation.json', { target: TARGET, source: code, internalRequests: 'unknown', outcome: 'submitted_or_uncertain' });
      const result = await (deps.publish ?? publishOnce)({ envFile: join(ledger, 'publication-target.env'), stdout: logs[0].fd, stderr: logs[1].fd, signal: deps.signal });
      await save('publication.outcome.json', result); check(result?.status === 0 && result.signal === null && result.uncertain === false, 'publication_uncertain');
    } finally { for (const h of logs) { await h.sync(); await h.close(); } }
    validateCanonical(await request('/api/v1/get_canonical_urls'));
    phase = 'empty import'; let activationAttempted = false, closed = false;
    const wrapper = { setAdminAuth: v => check(v === key, 'import_key'), query: (ref, args) => query(getFunctionName(ref), args), mutation: (ref, args) => {
      const name = getFunctionName(ref); check(Object.hasOwn(costs, name) && name !== 'migration:stage', 'import_scope');
      if (name === 'migration:activate') activationAttempted = true;
      return mutation(name, args);
    } };
    try {
      for (const step of ['stage', 'verify', 'activate']) {
        let result;
        await runImport(['--input', 'empty', '--url', TARGET.cloudUrl, '--apply', `--${step}`], { env: { CONVEX_DEPLOY_KEY: key }, readJson: async () => EMPTY, createClient: () => wrapper, report: value => { result = value; } });
        check(result?.fingerprint === FINGERPRINT && result.phase === ({ stage: 'staged', verify: 'verified', activate: 'active' })[step], 'import_state');
      }
    } finally {
      if (activationAttempted) {
        phase = 'close availability'; closing = true;
        let v, observed;
        try { v = await mutation('operations:setAvailability', { fingerprint: FINGERPRINT, readsEnabled: false, writesEnabled: false }); }
        finally { observed = await query('operations:availability', { fingerprint: FINGERPRINT }); }
        closed = v?.readsEnabled === false && v?.writesEnabled === false && observed?.readsEnabled === false && observed?.writesEnabled === false;
        check(closed, 'availability_not_closed');
      }
    }
    check(closed && !deps.signal?.aborted && equal(await sourceBinding(), code) && await setupDigest() === setup, 'final_verification'); (deps.cleanBackend ?? cleanBackend)(code.commit);
    const manifest = { version: 1, formatVersion: 1, kind: 'owned-development', team: 'nomokaro625-9385-s-projects', project: 'convex-cyan-garden', isNewDeployment: false, ownedEmptyDevelopment: true,
      deploymentName: TARGET.name, deploymentType: 'dev', reference: 'dev/vercel', projectId: TARGET.projectId, cloudUrl: TARGET.cloudUrl, siteUrl: TARGET.siteUrl,
      managementIdentity: { id: 6789777, kind: TARGET.kind, name: TARGET.name, deploymentType: TARGET.deploymentType, projectId: TARGET.projectId, isDefault: false, reference: 'dev/vercel', deploymentUrl: TARGET.cloudUrl, evidenceDigest: evidence.evidenceDigest, observedAt: evidence.observedAt },
      reviewedSourceCommit: code.commit, sourceDigest: code.digest, setupDigest: setup, publication: 'succeeded', environmentConfigured: true, limitVerified: true, adminCapabilityVerified: true, adminKey: key, config, fingerprint: FINGERPRINT, availabilityClosed: true,
      setupUsage: { controlRequests: controls, applicationCalls: calls, logicalWriteReservations: writes }, controls, applicationCalls: calls, logicalWrites: writes, cliPublications: publications, cliInternalRequests: 'unknown' };
    await save('owned-development-manifest.json', manifest);
    check(!deps.signal?.aborted,'cancelled');
    return { target: TARGET, manifest: join(ledger, 'owned-development-manifest.json'), controls, applicationCalls: calls, logicalWrites: writes, cliPublications: publications };
  } catch (error) { await save('stopped.json', { phase, controls, applicationCalls: calls, logicalWrites: writes, cliPublications: publications }).catch(() => {}); throw error; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2), opts = {}; let valid = true;
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a === '--apply' && !opts.apply) opts.apply = true; else if (['--evidence', '--key-file', '--ledger'].includes(a) && argv[i + 1] && !Object.hasOwn(opts, a)) opts[a] = argv[++i]; else valid = false; }
  if (!valid || (opts.apply && (!opts['--evidence'] || !opts['--key-file'] || !opts['--ledger']))) { console.error('Invalid arguments'); process.exitCode = 1; }
  else { const controller = new AbortController(); process.once('SIGINT', () => controller.abort()); process.once('SIGTERM', () => controller.abort()); try { console.log(JSON.stringify(await prepareOwnedDevelopment({ evidencePath: opts['--evidence'], keyFile: opts['--key-file'], ledger: opts['--ledger'], apply: !!opts.apply }, { signal: controller.signal }))); } catch { console.error('Owned development setup stopped; retain the private ledger and marker.'); process.exitCode = 1; } }
}
