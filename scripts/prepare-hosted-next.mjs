#!/usr/bin/env node
// One-attempt publisher for an owned Preview; execution requires Astra review.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, constants, openSync, fstatSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { checkVercelPrivateEnv } from './check-vercel-private-env.mjs';
import { readQuotaReview } from './hosted-validation-policy.mjs';

export const EXPECTED = Object.freeze({
  teamSlug: 'nomokaro625-9385s-projects', teamId: 'team_fmwIPLne9w30y7G5JQrs3fzl',
  projectId: 'prj_uOMK1a4PLAgsDr1A16InuImM1M3q',
  fingerprint: 'a3ceb7886db76f635b60fcb05541abfc3d7f425cb0322d2211afd2299eb037ba',
});
const assert = (condition, code) => { if (!condition) throw Error(code); };
const sourcePaths = ['app', 'convex', 'lib', 'patches', 'scripts', 'package.json',
  'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'convex.json', 'vercel.json',
  'proxy.ts', 'next.config.ts', 'next.config.js', 'next.config.mjs', 'tsconfig.json'];

// The input is read by a future publisher, never at module import time.
export function validateBackendManifest(m, previewName) {
  const i = m?.managementIdentity;
  assert(typeof previewName === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(previewName), 'preview_name');
  assert(m?.deploymentName === previewName && m.team === 'nomokaro625-9385-s-projects' &&
    m.project === 'convex-cyan-garden' && m.isNewDeployment === true &&
    /^attendance-validation-[a-f0-9]{32}$/.test(m.identifier ?? '') &&
    i?.kind === 'cloud' && i.name === previewName && i.deploymentType === 'preview' &&
    i.isDefault === false && Number.isSafeInteger(i.id) && Number.isSafeInteger(i.projectId) &&
    i.reference === `preview/${m.identifier}` && m.reference === i.reference &&
    m.cloudUrl === `https://${previewName}.convex.cloud` && i.deploymentUrl === m.cloudUrl &&
    m.siteUrl === `https://${previewName}.convex.site` && m.publication === 'succeeded' &&
    m.environmentConfigured === true && m.limitVerified === true && m.adminCapabilityVerified === true &&
    /^[a-f0-9]{40}$/.test(m.reviewedSourceCommit ?? ''), 'backend_manifest');
  assert(typeof m.adminKey === 'string' && m.adminKey.length > 0 && m.adminKey.length <= 16384 &&
    !/[\u0000-\u001f\u007f]/.test(m.adminKey) &&
    typeof m.config?.ATTENDANCE_GATEWAY_KEY === 'string' && m.config.ATTENDANCE_GATEWAY_KEY.length >= 32 &&
    typeof m.config.ATTENDANCE_GATEWAY_AUDIENCE === 'string' && m.config.ATTENDANCE_GATEWAY_AUDIENCE.length > 0 &&
    !/[\u0000-\u001f\u007f]/.test(m.config.ATTENDANCE_GATEWAY_KEY + m.config.ATTENDANCE_GATEWAY_AUDIENCE), 'backend_capability');
  return { name: previewName, id: i.id, projectId: i.projectId, reference: i.reference,
    cloudUrl: m.cloudUrl, siteUrl: m.siteUrl, fingerprint: EXPECTED.fingerprint };
}

export function validateClosedState(value) {
  assert(value?.readsEnabled === false && value?.writesEnabled === false, 'backend_not_closed');
}
export function validateDailyLimit(value) {
  const limits = value?.usageLimits;
  assert(Array.isArray(limits), 'limits_unavailable');
  const matches = limits.filter(x => x.metric === 'functionCalls' && x.window === 'day' && x.limitType === 'disable');
  assert(matches.length === 1 && matches[0].limit === 1000 && matches[0].enabled === true, 'daily_limit');
}
export function validateLiveIdentity(m, live, canonical) {
  const i = m.managementIdentity;
  assert(live?.id === i.id && live.projectId === i.projectId && live.kind === 'cloud' &&
    live.name === i.name && live.deploymentType === 'preview' && live.reference === i.reference &&
    live.isDefault === false && live.deploymentUrl === m.cloudUrl &&
    canonical?.convexCloudUrl === m.cloudUrl && canonical.convexSiteUrl === m.siteUrl, 'live_identity');
}

// This checks both the tracked review boundary and non-ignored source additions.
// The upload must still be made exclusively from `git archive` at this commit.
export function validateSource(reviewedCommit, backendCommit, git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) {
  assert(/^[a-f0-9]{40}$/.test(reviewedCommit ?? '') && /^[a-f0-9]{40}$/.test(backendCommit ?? ''), 'source_commit');
  assert(git(['rev-parse', 'HEAD']).trim() === reviewedCommit, 'head_mismatch');
  git(['diff', '--exit-code', backendCommit, reviewedCommit, '--', ...sourcePaths.filter(x => x !== 'scripts')]);
  git(['diff', '--exit-code', reviewedCommit, '--', ...sourcePaths]);
  assert(!git(['ls-files', '--others', '--exclude-standard', '--', ...sourcePaths]).trim(), 'untracked_source');
}

export function validateBuildHooks(vercel, pkg) {
  assert(vercel?.framework === 'nextjs' && vercel.installCommand === 'pnpm install --frozen-lockfile' &&
    vercel.buildCommand === 'pnpm build' && pkg?.scripts?.build === 'node --version && next build' &&
    !('devCommand' in vercel) && !('outputDirectory' in vercel) && !('functions' in vercel), 'build_hooks');
}
export function deploymentEnvironment(m) {
  return {
    NEXT_PUBLIC_ATTENDANCE_BACKEND: 'convex', NEXT_PUBLIC_CONVEX_URL: m.cloudUrl,
    NEXT_PUBLIC_CONVEX_SITE_URL: m.siteUrl,
    ATTENDANCE_GATEWAY_KEY: m.config.ATTENDANCE_GATEWAY_KEY,
    ATTENDANCE_GATEWAY_AUDIENCE: m.config.ATTENDANCE_GATEWAY_AUDIENCE,
    CONVEX_DEPLOY_KEY: '', BLOB_READ_WRITE_TOKEN: '',
  };
}
export function deploymentFlags() {
  const publicNames = ['NEXT_PUBLIC_ATTENDANCE_BACKEND', 'NEXT_PUBLIC_CONVEX_URL', 'NEXT_PUBLIC_CONVEX_SITE_URL'];
  const emptyNames = ['CONVEX_DEPLOY_KEY', 'BLOB_READ_WRITE_TOKEN'];
  const runtime = [...publicNames, 'ATTENDANCE_GATEWAY_KEY', 'ATTENDANCE_GATEWAY_AUDIENCE', ...emptyNames];
  const build = [...publicNames, ...emptyNames];
  return [...runtime.flatMap(name => ['--env', name]), ...build.flatMap(name => ['--build-env', name])];
}

// No network, private inputs, or child deployment process are touched here.
export async function offlineChecks(vercelPackageDirectory) {
  validateBuildHooks(JSON.parse(readFileSync('vercel.json', 'utf8')), JSON.parse(readFileSync('package.json', 'utf8')));
  return checkVercelPrivateEnv(vercelPackageDirectory);
}

export function readPrivateText(path) {
  assert(typeof path === 'string' && path.length > 0, 'private_input_missing');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    assert(stat.isFile() && stat.uid === process.getuid() && !(stat.mode & 0o077) && stat.size <= 65536,
      'private_input_permissions');
    return readFileSync(fd, 'utf8');
  } finally { closeSync(fd); }
}
export function readVercelToken(path) {
  const config = JSON.parse(readPrivateText(path));
  assert(typeof config.token === 'string' && config.token.length > 0 && config.token.length <= 16384 &&
    !/[\u0000-\u0020\u007f]/.test(config.token), 'vercel_auth');
  if (Number.isFinite(config.expiresAt)) {
    const expiry = config.expiresAt < 1e12 ? config.expiresAt * 1000 : config.expiresAt;
    assert(expiry > Date.now() + 60000, 'vercel_auth_expired');
  }
  return config.token;
}
export async function providerJson(url, { method = 'GET', headers = {}, body, timeoutMs = 10000,
  allowedStatuses = [200], fetchImpl = fetch } = {}) {
  const target = new URL(url);
  assert(target.protocol === 'https:' && !target.username && !target.password && !target.hash,
    'provider_url');
  const response = await fetchImpl(target.href, { method, redirect: 'error',
    signal: AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs))),
    headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const reader = response.body?.getReader(), chunks = [];
  let bytes = 0;
  if (reader) try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.byteLength; assert(bytes <= 1024 * 1024, 'provider_response_size');
      chunks.push(Buffer.from(next.value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  assert(allowedStatuses.includes(response.status), 'provider_status');
  const text = Buffer.concat(chunks).toString('utf8');
  return { status: response.status, body: text.length ? JSON.parse(text) : null };
}
export function validateVercelDeployment(data, expected, { requireReady = true } = {}) {
  const owners = [data?.ownerId, data?.teamId, data?.team?.id].filter(value => value !== undefined);
  const projects = [data?.projectId, data?.project?.id].filter(value => value !== undefined);
  assert(data?.id === expected.deploymentId && /^dpl_[A-Za-z0-9]+$/.test(data.id) &&
    owners.length > 0 && owners.every(value => value === EXPECTED.teamId) &&
    projects.length > 0 && projects.every(value => value === EXPECTED.projectId) &&
    Object.hasOwn(data, 'target') && [null, 'preview'].includes(data.target) &&
    !data.customEnvironment && data.meta?.attendanceValidation === expected.runId &&
    data.meta?.attendanceSourceCommit === expected.sourceCommit &&
    data.meta?.githubCommitSha === expected.sourceCommit, 'vercel_deployment_binding');
  assert(typeof data.url === 'string' && /^[a-z0-9-]+\.vercel\.app$/.test(data.url) &&
    expected.url === `https://${data.url}`, 'vercel_deployment_url');
  if (data.gitSource?.sha !== undefined) assert(data.gitSource.sha === expected.sourceCommit, 'vercel_git_source');
  if (requireReady) assert(data.readyState === 'READY', 'vercel_not_ready');
  return true;
}
export async function cleanupOwnedVercel({ manifest, request }) {
  const v = manifest?.vercel;
  assert(/^dpl_[A-Za-z0-9]+$/.test(v?.deploymentId ?? '') && manifest.runId && manifest.sourceCommit, 'cleanup_identity_missing');
  const identity = await request(`/v13/deployments/${encodeURIComponent(v.deploymentId)}`);
  // A malformed creation URL must not discard a valid returned ID. Recover its
  // URL only through the authenticated ownership/source gate before destruction.
  const expectedUrl = v.url ?? `https://${identity.body?.url}`;
  validateVercelDeployment(identity.body, { ...v, url: expectedUrl, sourceCommit: manifest.sourceCommit, runId: manifest.runId }, { requireReady: false });
  const result = { ownershipVerified: true, capabilityRevoked: !manifest.access?.token && !manifest.shareCapabilitySubmitted,
    deploymentDeleted: false };
  if (manifest.access?.token) {
    try {
      await request(`/aliases/${encodeURIComponent(v.deploymentId)}/protection-bypass`, {
        method: 'PATCH', body: { revoke: { secret: manifest.access.token, regenerate: false } },
      });
      result.capabilityRevoked = true;
    } catch { result.capabilityRevocationUncertain = true; }
  }
  await request(`/v13/deployments/${encodeURIComponent(v.deploymentId)}`, { method: 'DELETE', allowedStatuses: [200, 204] });
  const confirmed = await request(`/v13/deployments/${encodeURIComponent(v.deploymentId)}`, { allowedStatuses: [404] });
  result.deploymentDeleted = confirmed.status === 404;
  result.capabilityInvalidatedByDeletion = result.deploymentDeleted;
  return result;
}

export function deploymentBody(backendManifest, sourceCommit, runId) {
  const env = deploymentEnvironment(backendManifest);
  const buildEnv = Object.fromEntries(Object.entries(env).filter(([key]) =>
    key.startsWith('NEXT_PUBLIC_') || ['CONVEX_DEPLOY_KEY', 'BLOB_READ_WRITE_TOKEN'].includes(key)));
  // Vercel CLI 62.1.0 sends these env/build.env mappings to this same API.
  // Its preview selector omits target; the documented API default is Preview.
  // No projectSettings are sent: they can persist across later deployments.
  return { name: 'attendance-tracker', project: EXPECTED.projectId,
    gitSource: { type: 'github', repoId: 1409352117, ref: sourceCommit, sha: sourceCommit },
    env, build: { env: buildEnv },
    meta: { attendanceValidation: runId, attendanceSourceCommit: sourceCommit } };
}

export function validateEffectiveEnvironment(records, backendManifest) {
  const expected = deploymentEnvironment(backendManifest);
  const runtime = records?.env, build = records?.buildEnv;
  assert(runtime && build && typeof runtime === 'object' && typeof build === 'object' &&
    !Array.isArray(runtime) && !Array.isArray(build), 'effective_environment_unavailable');
  for (const key of ['NEXT_PUBLIC_ATTENDANCE_BACKEND', 'NEXT_PUBLIC_CONVEX_URL', 'NEXT_PUBLIC_CONVEX_SITE_URL'])
    assert(runtime[key] === expected[key] && build[key] === expected[key], 'effective_public_environment');
  for (const key of ['CONVEX_DEPLOY_KEY', 'BLOB_READ_WRITE_TOKEN'])
    assert(runtime[key] === '' && build[key] === '', 'effective_credential_override');
  for (const key of ['ATTENDANCE_GATEWAY_KEY', 'ATTENDANCE_GATEWAY_AUDIENCE']) {
    assert(runtime[key] === expected[key], 'effective_gateway_environment');
    assert(build[key] === undefined || build[key] === expected[key], 'effective_build_gateway_environment');
  }
  return { build: true, runtime: true, credentialOverrides: true };
}
export function productionAliasBindings(value) {
  assert(Array.isArray(value?.aliases) && value.aliases.length > 0 && value.aliases.length <= 100 &&
    !value.pagination?.next, 'production_aliases_unavailable');
  const names = new Set();
  return value.aliases.map(alias => {
    assert(typeof alias.alias === 'string' && /^[A-Za-z0-9.-]+$/.test(alias.alias) &&
      typeof alias.uid === 'string' && alias.uid.length > 0 && alias.uid.length <= 256 &&
      (alias.redirect === undefined || alias.redirect === null || typeof alias.redirect === 'string') &&
      !names.has(alias.alias), 'production_alias_shape');
    names.add(alias.alias);
    return { alias: alias.alias, uid: alias.uid, redirect: alias.redirect ?? null };
  }).sort((a, b) => a.alias.localeCompare(b.alias));
}

export async function prepareHostedNext(args, env = process.env, dependencies = {}) {
  const clock = dependencies.clock ?? Date.now;
  const sleep = dependencies.sleep ?? (ms => new Promise(done => setTimeout(done, ms)));
  const fetchImpl = dependencies.fetch ?? fetch;
  const privateText = dependencies.readPrivateText ?? readPrivateText;
  const publicJson = dependencies.readPublicJson ?? (path => JSON.parse(readFileSync(path, 'utf8')));
  const persist = dependencies.persist ?? ((path, value, { exclusive = false, privateFile = true } = {}) =>
    writeFileSync(path, value, { mode: privateFile ? 0o600 : 0o644, ...(exclusive ? { flag: 'wx' } : {}), flush: true }));
  const failProcess = dependencies.failProcess ?? (() => { process.exitCode = 1; });
  const output = dependencies.output ?? console.log;
  const started = clock(); let phase = 'arguments', manifest, cancelled = false, cleaning = false;
  let cleanupReserved = false, cleanupUsed = 0;
  const path = '.convex/hosted-validation/next-preview-manifest.json';
  const evidencePath = 'docs/measurements/hosted-next-preview-setup.json';
  const cancelledSignal = () => { cancelled = true; failProcess(); };
  const report = { version: 1, startedAt: new Date().toISOString(), passed: false, cancelled: false,
    counters: { controlRequests: 0, hostingRequests: 0, applicationCalls: 0 },
    creationRequests: 0, cleanup: {}, productionMutationRequested: false };
  const save = (tolerate = false) => {
    if (!manifest) return;
    try { persist(path, JSON.stringify(manifest, null, 2) + '\n'); }
    catch {
      report.persistenceFailed = true; report.passed = false; failProcess();
      if (!tolerate && !cleaning) throw Error('publisher_persistence_failed');
    }
  };
  const remaining = () => {
    const ms = (cleaning ? 600000 : 550000) - (clock() - started);
    assert(ms > 0 && (cleaning || !cancelled), 'publisher_cancelled_or_deadline');
    return ms;
  };
  let token;
  const reserveControl = () => {
    remaining();
    if (cleaning) {
      assert(cleanupReserved && cleanupUsed < 4 && report.counters.controlRequests < 20, 'cleanup_budget');
      cleanupUsed++;
    } else assert(report.counters.controlRequests < 16, 'control_budget');
    report.counters.controlRequests++;
    if (manifest) { manifest.counters = { ...report.counters }; save(cleaning); }
  };
  const vercel = async (endpoint, options = {}) => {
    assert(/^\/(?:v2\/(?:teams|deployments)\/|v3\/env\/pull\/|v9\/projects\/|v13\/deployments|aliases\/)/.test(endpoint), 'vercel_endpoint');
    reserveControl();
    const url = new URL(endpoint, 'https://api.vercel.com'); url.searchParams.set('teamId', EXPECTED.teamId);
    return providerJson(url.href, { ...options, headers: { Authorization: `Bearer ${token}` }, timeoutMs: Math.min(20000, remaining()), fetchImpl });
  };
  try {
    assert(args.length === 2 && args[0] === '--expected-preview', 'publisher_arguments');
    const backendManifest = JSON.parse(privateText('.convex/hosted-validation/preview-setup-manifest.json'));
    const backend = validateBackendManifest(backendManifest, args[1]);
    const sourceCommit = env.ATTENDANCE_VALIDATION_SOURCE_COMMIT;
    validateSource(sourceCommit, backendManifest.reviewedSourceCommit, dependencies.git);
    validateBuildHooks(publicJson('vercel.json'), publicJson('package.json'));
    phase = 'quota and credentials'; const quota = await (dependencies.readQuotaReview ?? readQuotaReview)();
    token = dependencies.vercelToken ?? readVercelToken(env.ATTENDANCE_VERCEL_AUTH_FILE);
    const previewKey = privateText(env.ATTENDANCE_PREVIEW_KEY_FILE).trim();
    assert(previewKey.startsWith('preview:nomokaro625-9385-s-projects:convex-cyan-garden|') &&
      previewKey.split('|').length === 2, 'preview_key_scope');
    const runId = `attendance-next-${randomBytes(16).toString('hex')}`;
    const candidate = { version: 1, runId, sourceCommit, publication: 'preflight', backend,
      vercel: { teamSlug: EXPECTED.teamSlug, teamId: EXPECTED.teamId, projectId: EXPECTED.projectId, target: 'preview', ready: false },
      cleanupReservation: { controlRequests: 4, automaticResume: false },
      counters: { ...report.counters }, createdAt: new Date().toISOString() };
    persist(path, JSON.stringify(candidate, null, 2) + '\n', { exclusive: true });
    manifest = candidate; cleanupReserved = true;
    Object.assign(report, { runId, sourceCommit, cleanupReservePersisted: true });
    process.on('SIGINT', cancelledSignal); process.on('SIGTERM', cancelledSignal);
    report.quotaReview = { observedAt: quota.observedAt, source: quota.source, sufficientReviewedHeadroom: true };
    phase = 'live identities';
    const convexControl = async (url, credential) => {
      reserveControl(); return (await providerJson(url, { headers: { Authorization: credential }, timeoutMs: Math.min(20000, remaining()), fetchImpl })).body;
    };
    const live = await convexControl(`https://api.convex.dev/v1/deployments/${encodeURIComponent(backend.name)}`, `Bearer ${previewKey}`);
    const canonical = await convexControl(backend.cloudUrl + '/api/v1/get_canonical_urls', `Convex ${backendManifest.adminKey}`);
    validateLiveIdentity(backendManifest, live, canonical);
    validateDailyLimit(await convexControl(backend.cloudUrl + '/api/v1/list_usage_limits', `Convex ${backendManifest.adminKey}`));
    let sent = false;
    const client = new ConvexHttpClient(backend.cloudUrl, { logger: false, fetch: async (input, init) => {
      assert(!sent && new URL(String(input)).origin === backend.cloudUrl, 'availability_retry'); sent = true;
      remaining(); report.counters.applicationCalls++; manifest.counters = { ...report.counters }; save();
      const response = await fetchImpl(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(Math.min(20000, remaining())) });
      // Bound the SDK response before giving it back to its parser.
      const bytes = []; let length = 0;
      if (response.body) for await (const part of response.body) {
        length += part.byteLength; assert(length <= 1024 * 1024, 'availability_response_size'); bytes.push(part);
      }
      return new Response(Buffer.concat(bytes), { status: response.status, headers: response.headers });
    } });
    client.setAdminAuth(backendManifest.adminKey); client.setDebug(false);
    validateClosedState(await client.query(makeFunctionReference('operations:availability'), { fingerprint: EXPECTED.fingerprint }));
    const team = (await vercel(`/v2/teams/${EXPECTED.teamId}`)).body;
    assert(team?.id === EXPECTED.teamId && team.slug === EXPECTED.teamSlug && team.billing?.plan === 'hobby', 'vercel_team_plan');
    const project = (await vercel(`/v9/projects/${EXPECTED.projectId}`)).body;
    assert(project?.id === EXPECTED.projectId && project.accountId === EXPECTED.teamId &&
      project.name === 'attendance-tracker' && project.framework === 'nextjs' &&
      project.nodeVersion === '24.x' && project.buildCommand === null && project.installCommand === null &&
      project.link?.type === 'github' && project.link.repoId === 1409352117 &&
      project.link.org === 'nosabecom' && project.link.repo === 'attendancetracker' &&
      project.targets?.production?.target === 'production' && /^dpl_/.test(project.targets.production.id) &&
      project.ssoProtection?.deploymentType === 'all_except_custom_domains' &&
      !project.integrations && !project.integrationActions, 'vercel_project');
    const productionId = project.targets.production.id;
    const aliasesBefore = productionAliasBindings((await vercel(`/v2/deployments/${productionId}/aliases`)).body);
    phase = 'single deployment creation'; manifest.publication = 'creation submitted or uncertain';
    manifest.creationState = 'submitted; outcome uncertain'; save();
    report.creationRequests++;
    const created = (await vercel('/v13/deployments', { method: 'POST',
      body: deploymentBody(backendManifest, sourceCommit, runId), allowedStatuses: [200, 201] })).body;
    if (/^dpl_[A-Za-z0-9]+$/.test(created?.id ?? '')) {
      manifest.vercel.deploymentId = created.id; report.deploymentId = created.id;
      manifest.creationState = 'returned ID; ownership unverified'; save();
    }
    assert(manifest.vercel.deploymentId && typeof created.url === 'string' &&
      /^[a-z0-9-]+\.vercel\.app$/.test(created.url), 'created_identity');
    manifest.vercel.url = `https://${created.url}`; save();
    phase = 'deployment readiness'; let deployment;
    for (let poll = 0; poll < 5; poll++) {
      deployment = (await vercel(`/v13/deployments/${created.id}`)).body;
      validateVercelDeployment(deployment, { ...manifest.vercel, sourceCommit, runId }, { requireReady: false });
      if (deployment.readyState === 'READY') break;
      assert(!['ERROR', 'CANCELED'].includes(deployment.readyState), 'deployment_failed');
      await sleep(Math.min(poll === 0 ? 15000 : 60000, remaining()));
    }
    validateVercelDeployment(deployment, { ...manifest.vercel, sourceCommit, runId });
    manifest.vercel.ready = true; manifest.creationState = 'ownership verified'; save();
    const projectAfter = (await vercel(`/v9/projects/${EXPECTED.projectId}`)).body;
    assert(projectAfter?.targets?.production?.id === project.targets.production.id &&
      projectAfter.buildCommand === project.buildCommand && projectAfter.installCommand === project.installCommand &&
      projectAfter.ssoProtection?.deploymentType === project.ssoProtection.deploymentType, 'project_state_changed');
    report.productionTargetUnchanged = true;
    const aliasesAfter = productionAliasBindings((await vercel(`/v2/deployments/${productionId}/aliases`)).body);
    assert(JSON.stringify(aliasesBefore) === JSON.stringify(aliasesAfter), 'production_alias_changed');
    report.productionAliasBindingsUnchanged = true;
    phase = 'effective environment';
    // Same deployment-specific endpoint as the installed CLI. No decrypt flag,
    // challenge recovery or protected-Secret bypass. Unknown/redacted maps fail.
    manifest.environmentVerified = validateEffectiveEnvironment(
      (await vercel(`/v3/env/pull/${created.id}`)).body, backendManifest);
    report.environmentVerified = { ...manifest.environmentVerified }; save();
    const probe = async headers => {
      remaining(); assert(report.counters.hostingRequests < 2, 'hosting_budget');
      report.counters.hostingRequests++; manifest.counters = { ...report.counters }; save();
      const response = await fetchImpl(manifest.vercel.url, { headers, redirect: 'manual', signal: AbortSignal.timeout(Math.min(20000, remaining())) });
      await response.body?.cancel(); return response.status;
    };
    phase = 'protected access';
    const challenged = await probe({});
    assert([302, 303, 307, 308, 401, 403].includes(challenged), 'preview_not_protected');
    const issuedAt = clock();
    manifest.shareCapabilitySubmitted = true; save();
    const capability = (await vercel(`/aliases/${created.id}/protection-bypass`, { method: 'PATCH', body: { ttl: 900 } })).body;
    assert(typeof capability === 'string' && capability.length > 0 && capability.length <= 16384 &&
      !/[\u0000-\u0020\u007f]/.test(capability), 'share_capability');
    manifest.access = { kind: 'deployment-shareable', token: capability,
      expiresAt: new Date(issuedAt + 900000).toISOString(), headerVerified: false }; save();
    assert(await probe({ 'x-vercel-protection-bypass': capability }) === 200, 'scoped_header_unsupported');
    assert(!cancelled, 'publisher_cancelled');
    manifest.access.headerVerified = true; manifest.publication = 'ready'; manifest.counters = { ...report.counters }; save();
    report.passed = true; report.uniqueUrl = manifest.vercel.url; report.deploymentId = created.id;
    report.finishedAt = new Date(clock()).toISOString(); report.elapsedMs = clock() - started;
    persist(evidencePath, JSON.stringify(report, null, 2) + '\n', { privateFile: false });
  } catch {
    report.failedPhase = phase; report.passed = false; failProcess();
    if (manifest) { manifest.publication = 'stopped'; manifest.failedPhase = phase; save(true); }
  } finally {
    cleaning = true;
    if (manifest && !report.passed && manifest.vercel.deploymentId) {
      try { report.cleanup = await cleanupOwnedVercel({ manifest, request: vercel }); }
      catch { report.cleanup.incomplete = true; }
      manifest.cleanup = report.cleanup; save(true);
    }
    if (manifest && report.creationRequests > 0 && !manifest.vercel.deploymentId)
      report.cleanup.unresolvedDeploymentIdentity = true;
    report.cancelled = cancelled;
    if (!report.passed) { report.finishedAt = new Date(clock()).toISOString(); report.elapsedMs = clock() - started; }
    if (cancelled) { report.passed = false; failProcess(); if (manifest) { manifest.publication = 'stopped'; save(true); } }
    // Success was persisted inside try: a storage error there enters catch and
    // performs cleanup. Do not introduce a second, post-cleanup success write.
    if (manifest && !report.passed) try { persist(evidencePath, JSON.stringify(report, null, 2) + '\n', { privateFile: false }); }
    catch { report.persistenceFailed = true; report.passed = false; failProcess(); }
    process.removeListener('SIGINT', cancelledSignal); process.removeListener('SIGTERM', cancelledSignal);
  }
  output(JSON.stringify({ passed: report.passed, failedPhase: report.failedPhase, counters: report.counters,
    deploymentId: report.deploymentId, persistenceFailed: report.persistenceFailed, cleanup: report.cleanup }));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await prepareHostedNext(process.argv.slice(2)); }
  catch { console.error('Hosted Next setup stopped; private details withheld.'); process.exitCode = 1; }
}
