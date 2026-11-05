#!/usr/bin/env node
// Explicit, one-attempt rehearsal on the already verified disposable preview.
import { open, lstat, writeFile, constants } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes, createHash, createPublicKey, verify } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { ConvexClient, ConvexHttpClient } from 'convex/browser';
import { getFunctionName, makeFunctionReference } from 'convex/server';
import { runImport } from './import-blob.mjs';
import { signGatewayRequest } from '../lib/gateway-proof.mjs';
import { readQuotaReview } from './hosted-validation-policy.mjs';

const directory = '.convex/hosted-validation';
const manifestPath = directory + '/preview-setup-manifest.json';
const attemptPath = directory + '/runtime-attempt.json';
const evidencePath = 'docs/measurements/hosted-backend-verification.json';
const emptyRaw = { formatVersion: 1, exportedAt: '2026-10-02T01:02:03.004Z', blobs: [] };
const emptyFingerprint = 'a3ceb7886db76f635b60fcb05541abfc3d7f425cb0322d2211afd2299eb037ba';
const ref = name => makeFunctionReference(name);
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
const hash = value => createHash('sha256').update(value).digest('hex');
class GateError extends Error { constructor(code) { super(code); this.code = code; } }
function ensure(value, code) { if (!value) throw new GateError(code); }

export async function inspectEmptySyntheticInput(url) {
  let result;
  await runImport(['--input', 'in-memory-synthetic', '--url', url], {
    readJson: async () => emptyRaw,
    createClient: () => { throw new GateError('dry_run_connected'); },
    report: value => { result = value; },
  });
  ensure(result?.dryRun && result.fingerprint === emptyFingerprint &&
    result.chunks === 0 && Object.values(result.counts).every(count => count === 0), 'synthetic_plan');
  return result;
}
async function privateText(path) {
  ensure(typeof path === 'string' && path.length > 0, 'private_input_missing');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    ensure(stat.isFile() && stat.size <= 65536 && (stat.mode & 0o077) === 0 &&
      stat.uid === process.getuid(), 'private_input_permissions');
    return await file.readFile('utf8');
  } finally { await file.close(); }
}
async function boundedResponse(response) {
  if (!response.body) return response;
  const reader = response.body.getReader(), chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      ensure(bytes <= 1024 * 1024, 'response_size');
      chunks.push(Buffer.from(next.value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
}
async function within(promise, ms) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new GateError('shutdown_timeout')), ms);
    })]);
  } finally { clearTimeout(timer); }
}
function safeUsage(value) {
  const metrics = {};
  for (const name of ['functionCalls', 'databaseIoGb', 'actionComputeConvexGbHours',
    'actionComputeNodeJsGbHours', 'actionComputeCpuGbHours', 'dataEgressGb']) {
    const metric = value?.metrics?.[name];
    if (!metric) continue;
    metrics[name] = {
      unit: ['calls', 'GB', 'GB-hours'].includes(metric.unit) ? metric.unit : 'UNKNOWN',
      currentDay: Number.isFinite(metric.usage?.current_day) && metric.usage.current_day >= 0 ? metric.usage.current_day : 'UNKNOWN',
      currentMonth: Number.isFinite(metric.usage?.current_month) && metric.usage.current_month >= 0 ? metric.usage.current_month : 'UNKNOWN',
    };
  }
  return { seedStatus: ['partial', 'complete'].includes(value?.seedStatus) ? value.seedStatus : 'UNKNOWN', metrics };
}
export function subscriptionObserver({ settled = () => {}, unexpected = () => {} } = {}) {
  const state = { value: undefined, denied: null, callbacks: 0, settled: false,
    errorGeneration: 0, expectedDenial: null, denialBaseline: 0,
    revocationCommitted: false, expectedDenialSeen: false, violation: null, active: true };
  const violation = code => { state.violation ??= code; unexpected(code); };
  state.settle = () => { if (!state.settled) { state.settled = true; settled(); } };
  state.onValue = value => {
    state.value = value; state.denied = null; state.callbacks++;
    // The controlled revocation window starts before submitting its mutation;
    // do not hide a leaked success that races ahead of the HTTP acknowledgement.
    if (state.expectedDenial !== null) violation('success_after_revocation');
    state.settle();
  };
  state.onError = error => {
    state.denied = error?.data?.status ?? 'unknown'; state.errorGeneration++;
    if (state.expectedDenial === null || state.denied !== state.expectedDenial)
      violation('unexpected_subscription_error');
    else if (state.errorGeneration > state.denialBaseline) state.expectedDenialSeen = true;
    state.settle();
  };
  state.beginRevocation = status => {
    ensure(!state.violation && state.expectedDenial === null && [401, 403].includes(status), 'invalid_revocation_barrier');
    state.denialBaseline = state.errorGeneration; state.denied = null; state.expectedDenial = status;
  };
  state.commitRevocation = () => { ensure(state.expectedDenial !== null, 'revocation_not_started'); state.revocationCommitted = true; };
  state.freshDenial = () => state.revocationCommitted && state.expectedDenialSeen && !state.violation &&
    state.errorGeneration > state.denialBaseline && state.denied === state.expectedDenial;
  state.stop = () => {
    if (!state.active) return;
    state.active = false;
    try { state.unsubscribe?.(); } finally { state.settle(); }
  };
  return state;
}

export async function runHostedPreview(argv, env = process.env) {
  const start = performance.now(), run = randomBytes(8).toString('hex');
  const report = {
    version: 1, localOnly: false, backendOnly: true, startedAt: new Date().toISOString(),
    bounds: { calls: 200, studentGatewayCalls: 20, fixtureWriteUpperReservations: 500,
      ordinaryCalls: 160, ordinaryWriteReservations: 400, importCalls: 60,
      controlPlaneReads: 10, timeoutMs: 180000, ordinaryDeadlineMs: 130000,
      closureRequestTimeoutMs: 10000, responseBytes: 1024 * 1024 },
    calls: { submitted: 0, settledLocally: 0, sdk: 0, subscriptions: 0, publicHttp: 0 },
    physicalHttpAttempts: 0, controlPlaneReads: 0, studentGatewayCalls: 0,
    fixtureWriteUpperReservations: 0, assertions: {}, initialWebSocketConnections: 0,
    blockedReconnectAttempts: 0, webSocketApplicationBytes: { sent: 0, received: 0 },
    cleanup: { clientsClosed: false, availabilityClosed: false, previewDeleted: false },
    limitations: [
      'Budgets are client reservations and conservative intentional-write allowances, not provider billing caps.',
      'Backend retries, invalidations, security maintenance and auth jobs can add work.',
      'Provider usage may be provisional; team headroom, storage/index growth and whole-run retries are unknown.',
      'Next/Vercel ingress, cookies, trusted IP, SSO, natural expiry and wall-clock refresh timing are untested.',
      'Synthetic rows and possible scheduled jobs remain until separately reviewed preview deletion.',
    ],
  };
  let manifest, key, attempt, phase = 'arguments', cleaning = false, active = false, activationAttempted = false, stopped = false;
  let cancellationReceived = false, fatalObservation = null, requestTimeoutMs = 15000;
  let importCalls = 0, importWrites = 0;
  const actors = [], clients = [], subscriptions = [], sockets = [];
  const check = (name, value) => { report.assertions[name] = !!value; ensure(value, name); };
  const remaining = () => {
    const ms = (cleaning ? 180000 : 130000) - (performance.now() - start);
    ensure(ms > 0 && (cleaning || (!stopped && !cancellationReceived && !fatalObservation)), 'runtime_stopped_or_timeout');
    return Math.min(requestTimeoutMs, Math.floor(ms));
  };
  const saveAttempt = async () => {
    if (attempt) await writeFile(attemptPath, JSON.stringify({ ...attempt, report, phase }, null, 2) + '\n', { mode: 0o600 });
  };
  const reserve = (kind, writes = 0) => {
    remaining();
    ensure(Number.isSafeInteger(writes) && writes >= 0 &&
      report.calls.submitted + 1 <= (cleaning ? 200 : 160) &&
      report.fixtureWriteUpperReservations + writes <= (cleaning ? 500 : 400), 'request_or_write_budget');
    report.calls.submitted++; report.calls[kind]++;
    report.fixtureWriteUpperReservations += writes;
  };
  async function transport(url, init = {}) {
    const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(remaining()) });
    return boundedResponse(response);
  }
  async function control(url, auth) {
    ensure(report.controlPlaneReads < 10, 'control_budget');
    report.controlPlaneReads++;
    const response = await transport(url, { headers: { Authorization: auth } });
    ensure(response.ok, 'control_read_failed');
    return response.json();
  }
  function sdkClient(url, capability) {
    let sent = false;
    const client = new ConvexHttpClient(url, { logger: false, fetch: async (input, init) => {
      ensure(!sent && new URL(String(input)).origin === manifest.cloudUrl, 'sdk_retry_or_target');
      sent = true; report.physicalHttpAttempts++;
      return transport(input, init);
    } });
    client.setDebug(false);
    if (capability === 'admin') client.setAdminAuth(manifest.adminKey);
    else if (capability) client.setAuth(capability);
    return client;
  }
  async function rpc(kind, name, args = {}, capability, writes = 0) {
    reserve('sdk', writes);
    try { return await sdkClient(manifest.cloudUrl, capability)[kind](ref(name), args); }
    finally { report.calls.settledLocally++; }
  }
  async function denied(name, capability, args, status) {
    try { await rpc('query', name, args, capability); }
    catch (error) { ensure(error?.data?.status === status, 'denial_was_not_expected_domain_status'); return; }
    throw new GateError('expected_domain_denial_missing');
  }
  const proof = (operation, payload) => signGatewayRequest(operation, payload, {
    secret: manifest.config.ATTENDANCE_GATEWAY_KEY,
    audience: manifest.config.ATTENDANCE_GATEWAY_AUDIENCE, ipHash: hash(run),
  });
  async function publicJson(path, { payload, invalid = false, malformed = false, expected = 200, writes = 0 } = {}) {
    reserve('publicHttp', writes);
    try {
      ensure(report.studentGatewayCalls < 20, 'gateway_budget');
      report.studentGatewayCalls++; report.physicalHttpAttempts++;
      const operation = path === 'checkin' ? 'checkin' : 'public-info';
      const signature = await proof(operation, payload);
      if (invalid) signature.signature = '0'.repeat(64);
      const response = await transport(manifest.siteUrl + '/gateway/' + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: malformed ? 'null' : JSON.stringify({ payload, proof: signature }),
      });
      ensure(response.status === expected, 'gateway_status');
      const value = await response.json();
      ensure(value && typeof value === 'object' && !Array.isArray(value), 'gateway_response_shape');
      const allowed = expected !== 200 ? ['error'] : path === 'checkin' ? ['name', 'already'] : ['title', 'closed'];
      ensure(Object.keys(value).every(field => allowed.includes(field)), 'public_response_privacy');
      if (expected !== 200) ensure(typeof value.error === 'string' && value.error.length <= 256, 'public_error_shape');
      else if (path === 'checkin') ensure(typeof value.name === 'string' && value.name.length <= 160 &&
        (value.already === undefined || typeof value.already === 'boolean'), 'public_checkin_shape');
      else ensure(typeof value.title === 'string' && value.title.length <= 100 && typeof value.closed === 'boolean', 'public_metadata_shape');
      return value;
    } finally { report.calls.settledLocally++; }
  }
  function claims(token) {
    ensure(typeof token === 'string' && token.length < 16384, 'managed_token_missing');
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  }
  async function signup(role) {
    const actor = { role, username: 'host-' + run + '-' + role, password: randomBytes(24).toString('hex') };
    actors.push(actor);
    const payload = { username: actor.username, password: actor.password };
    const result = await rpc('action', 'auth:signIn', {
      provider: 'credentials', params: { operation: 'signup', ...payload, proof: await proof('signup', payload) },
    }, undefined, 64);
    ensure(result?.tokens?.token && result.tokens.refreshToken, 'signup_tokens');
    actor.tokens = result.tokens;
    const jwt = claims(actor.tokens.token);
    check(role + 'FixedManagedLifetime', Number.isSafeInteger(jwt.exp) && Number.isSafeInteger(jwt.iat) &&
      Number.isSafeInteger(jwt.sessionExpiresAt) && typeof jwt.sub === 'string' && jwt.sub.split('|').length === 2 &&
      jwt.exp - jwt.iat === 3600 &&
      jwt.sessionExpiresAt > jwt.iat * 1000 + 30 * 86400000 - 60000 &&
      jwt.sessionExpiresAt <= jwt.iat * 1000 + 30 * 86400000 + 1000);
    actor.sessionId = jwt.sub.split('|')[1];
    attempt.actors.push({ username: actor.username, sessionId: actor.sessionId });
    await saveAttempt();
    return actor;
  }
  const stoppedSignal = () => {
    stopped = true; cancellationReceived = true;
    report.cancelled = true; report.passed = false; process.exitCode = 1;
  };
  async function until(predicate) {
    const deadline = performance.now() + 15000;
    while (!predicate()) { remaining(); ensure(performance.now() < deadline, 'subscription_timeout'); await delay(20); }
  }
  function connect(actor) {
    const require = createRequire(import.meta.url);
    const NodeSocket = require(require.resolve('ws', { paths: [require.resolve('convex')] }));
    let connections = 0;
    class RefusedSocket {
      readyState = 3; CLOSED = 3; OPEN = 1; CONNECTING = 0; CLOSING = 2;
      onopen = null; onclose = null; onmessage = null; onerror = null;
      constructor() { queueMicrotask(() => this.onclose?.({ code: 1000, reason: '', wasClean: true })); }
      close() {} send() {} addEventListener() {} removeEventListener() {}
    }
    class BoundedSocket extends NodeSocket {
      constructor(...values) {
        const url = new URL(values[0]);
        ensure(url.protocol === 'wss:' && url.host === new URL(manifest.cloudUrl).host, 'socket_target');
        if (++connections > 1) { report.blockedReconnectAttempts++; stopped = true; return new RefusedSocket(); }
        const protocols = typeof values[1] === 'string' || Array.isArray(values[1]) ? values[1] : undefined;
        const options = values[1] && typeof values[1] === 'object' && !Array.isArray(values[1]) ? values[1] : values[2];
        super(values[0], protocols, { ...options, maxPayload: 1024 * 1024,
          handshakeTimeout: remaining(), perMessageDeflate: false });
        sockets.push(this); report.initialWebSocketConnections++;
        this.addEventListener('message', event => { report.webSocketApplicationBytes.received += Buffer.byteLength(String(event.data)); });
      }
      send(value, ...other) {
        report.webSocketApplicationBytes.sent += Buffer.byteLength(String(value));
        return super.send(value, ...other);
      }
    }
    const client = new ConvexClient(manifest.cloudUrl, { logger: false, webSocketConstructor: BoundedSocket, unsavedChangesWarning: false });
    clients.push(client); client.setAuth(async () => actor.tokens.token);
    return client;
  }
  function subscribe(client, legacyId) {
    reserve('subscriptions');
    const state = subscriptionObserver({ settled: () => { report.calls.settledLocally++; },
      unexpected: code => { fatalObservation ??= code; report.passed = false; } });
    state.unsubscribe = client.onUpdate(ref('attendance:bucket'), { legacyId, bucket: 0 },
      state.onValue, state.onError);
    subscriptions.push(state);
    return state;
  }
  async function logout(actor) {
    if (!actor?.tokens || actor.loggedOut) return;
    await rpc('action', 'auth:signOut', {}, actor.tokens.token, 16);
    actor.loggedOut = true;
  }

  try {
    ensure(argv.length === 2 && argv[0] === '--expected-preview' && /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(argv[1]), 'explicit_preview_required');
    manifest = JSON.parse(await privateText(manifestPath));
    const identity = manifest.managementIdentity;
    check('PrivatePreviewManifest', manifest.deploymentName === argv[1] && manifest.isNewDeployment === true &&
      manifest.team === 'nomokaro625-9385-s-projects' && manifest.project === 'convex-cyan-garden' &&
      /^attendance-validation-[a-f0-9]{32}$/.test(manifest.identifier) &&
      identity?.kind === 'cloud' && identity.name === argv[1] && identity.deploymentType === 'preview' &&
      identity.reference === 'preview/' + manifest.identifier && identity.isDefault === false &&
      manifest.reference === identity.reference && Number.isSafeInteger(identity.id) && Number.isSafeInteger(identity.projectId) &&
      manifest.cloudUrl === 'https://' + argv[1] + '.convex.cloud' && identity.deploymentUrl === manifest.cloudUrl &&
      manifest.siteUrl === 'https://' + argv[1] + '.convex.site' && manifest.publication === 'succeeded' &&
      manifest.environmentConfigured === true && manifest.limitVerified === true && manifest.adminCapabilityVerified === true);
    ensure(/^[a-f0-9]{40}$/.test(manifest.reviewedSourceCommit ?? ''), 'source_commit');
    const core = ['app', 'convex', 'lib', 'patches', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'convex.json'];
    execFileSync('git', ['diff', '--exit-code', manifest.reviewedSourceCommit, '--', ...core], { stdio: 'ignore' });
    ensure(!execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', ...core], { encoding: 'utf8' }).trim(), 'unreviewed_core');
    phase = 'team quota review';
    const quota = await readQuotaReview();
    report.teamQuotaReview = { observedAt: quota.observedAt, source: quota.source,
      sufficientReviewedHeadroom: true, plannedHeadroom: quota.plannedHeadroom };
    key = (await privateText(env.ATTENDANCE_PREVIEW_KEY_FILE)).trim();
    ensure(key.startsWith('preview:' + manifest.team + ':' + manifest.project + '|') && key.split('|').length === 2, 'preview_key_scope');
    ensure(typeof manifest.adminKey === 'string' && manifest.adminKey.length && !/[\r\n]/.test(manifest.adminKey) &&
      typeof manifest.config?.ATTENDANCE_GATEWAY_KEY === 'string' && manifest.config.ATTENDANCE_GATEWAY_KEY.length >= 32 &&
      typeof manifest.config.ATTENDANCE_GATEWAY_AUDIENCE === 'string', 'capability_configuration');
    try { await lstat(attemptPath); throw new GateError('runtime_attempt_already_exists'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    phase = 'revalidate preview';
    const actual = await control('https://api.convex.dev/v1/deployments/' + encodeURIComponent(argv[1]), 'Bearer ' + key);
    check('LivePreviewIdentity', actual.id === identity.id && actual.projectId === identity.projectId &&
      actual.kind === 'cloud' && actual.name === identity.name && actual.deploymentType === 'preview' &&
      actual.reference === identity.reference && actual.isDefault === false && actual.deploymentUrl === manifest.cloudUrl);
    const canonical = await control(manifest.cloudUrl + '/api/v1/get_canonical_urls', 'Convex ' + manifest.adminKey);
    check('CanonicalPreviewBinding', canonical.convexCloudUrl === manifest.cloudUrl && canonical.convexSiteUrl === manifest.siteUrl);
    const limits = await control(manifest.cloudUrl + '/api/v1/list_usage_limits', 'Convex ' + manifest.adminKey);
    check('DailyLimitPresent', limits.usageLimits?.filter(limit => limit.metric === 'functionCalls' &&
      limit.window === 'day' && limit.limitType === 'disable' && limit.limit === 1000 && limit.enabled === true).length === 1);
    report.baselineDeploymentUsage = safeUsage(await control(manifest.cloudUrl + '/api/v1/get_current_usage', 'Convex ' + manifest.adminKey));
    const plan = await inspectEmptySyntheticInput(manifest.cloudUrl);
    report.syntheticFingerprint = plan.fingerprint;
    report.deploymentName = argv[1]; report.sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    phase = 'record exclusive attempt';
    const candidate = { run, targetId: identity.id, projectId: identity.projectId, reference: identity.reference,
      fingerprint: emptyFingerprint, createdAt: new Date().toISOString(), sourceCommit: report.sourceCommit, actors: [] };
    await writeFile(attemptPath, JSON.stringify(candidate) + '\n', { flag: 'wx', mode: 0o600 });
    attempt = candidate;
    process.on('SIGINT', stoppedSignal); process.on('SIGTERM', stoppedSignal);
    phase = 'import empty synthetic dataset';
    const writeBounds = { initialize: 1, begin: 1, freeze: 1, verifyNext: 1, activate: 2 };
    const importClient = {
      setAdminAuth(value) { ensure(value === manifest.adminKey, 'import_capability'); },
      async mutation(reference, args) {
        const name = getFunctionName(reference).split(':')[1];
        ensure(Object.hasOwn(writeBounds, name), 'unexpected_empty_import_mutation');
        ensure(++importCalls <= 60 && importWrites + writeBounds[name] <= 50, 'import_budget');
        importWrites += writeBounds[name];
        return rpc('mutation', 'migration:' + name, args, 'admin', writeBounds[name]);
      },
      async query(reference, args) {
        ensure(getFunctionName(reference) === 'migration:status' && ++importCalls <= 60, 'import_query_budget');
        return rpc('query', 'migration:status', args, 'admin');
      },
    };
    for (const step of ['stage', 'verify', 'activate']) {
      let result;
      if (step === 'activate') activationAttempted = true;
      await runImport(['--input', 'in-memory-synthetic', '--url', manifest.cloudUrl, '--apply', '--' + step], {
        env: { CONVEX_DEPLOY_KEY: manifest.adminKey }, readJson: async () => emptyRaw,
        createClient: url => { ensure(url === manifest.cloudUrl, 'import_target'); return importClient; },
        report: value => { result = value; },
      });
      check('import-' + step, result?.fingerprint === emptyFingerprint &&
        result.phase === ({ stage: 'staged', verify: 'verified', activate: 'active' })[step]);
      if (step === 'activate') active = true;
    }
    phase = 'managed auth and class';
    const owner = await signup('owner'), teacher = await signup('teacher');
    await denied('attendance:viewer', undefined, {}, 401);
    const view = await rpc('query', 'attendance:viewer', {}, owner.tokens.token);
    check('FixedSessionDeadline', view.expiresAt === claims(owner.tokens.token).sessionExpiresAt);
    const legacyId = randomBytes(16).toString('hex');
    const created = await rpc('mutation', 'attendance:create', { newId: legacyId, title: 'Hosted synthetic class',
      csv: 'name,student_id\nSynthetic One,HST01\nSynthetic Two,HST02\nSynthetic Three,HST03\nSynthetic Four,HST04\nSynthetic Five,HST05\n',
    }, owner.tokens.token, 12);
    ensure(created.id === legacyId && typeof created.classId === 'string', 'class_result');
    attempt.classId = created.classId; attempt.legacyId = legacyId; await saveAttempt();
    const roster = await rpc('query', 'attendance:roster', { legacyId }, owner.tokens.token);
    ensure(roster.length === 5 && new Set(roster.map(student => student.id)).size === 5, 'roster_count');
    await denied('attendance:roster', teacher.tokens.token, { legacyId }, 403);
    await rpc('mutation', 'attendance:share', { classId: created.classId, username: teacher.username }, owner.tokens.token, 1);
    phase = 'native subscriptions';
    const ownerState = subscribe(connect(owner), legacyId), teacherState = subscribe(connect(teacher), legacyId);
    await until(() => ownerState.settled && teacherState.settled);
    check('InitialBuckets', ownerState.value?.length === 0 && teacherState.value?.length === 0 &&
      ownerState.denied === null && teacherState.denied === null);
    const callbackBeforeIdle = ownerState.callbacks + teacherState.callbacks;
    await delay(1500);
    check('IdleNoCallbacksObserved', callbackBeforeIdle === ownerState.callbacks + teacherState.callbacks);
    phase = 'student gateway';
    const info = await publicJson('public-info', { payload: { legacyId } });
    check('PublicMetadataPrivacy', info.title === 'Hosted synthetic class' && info.closed === false);
    const first = await publicJson('checkin', { payload: { legacyId, identity: 'HST01' }, writes: 48 });
    check('FirstCheckin', first.name === roster[0].name && !first.already);
    await until(() => ownerState.value?.some(fact => fact.studentId === roster[0].id && fact.checkedInAt) &&
      teacherState.value?.some(fact => fact.studentId === roster[0].id && fact.checkedInAt));
    const at = ownerState.value.find(fact => fact.studentId === roster[0].id).checkedInAt;
    const duplicate = await publicJson('checkin', { payload: { legacyId, identity: 'HST01' }, writes: 48 });
    check('FreshProofDuplicate', duplicate.already === true);
    const facts = await rpc('query', 'attendance:bucket', { legacyId, bucket: 0 }, owner.tokens.token);
    check('DuplicateFactStable', facts.length === 1 && facts[0].checkedInAt === at);
    await publicJson('checkin', { payload: { legacyId, identity: 'HST02' }, invalid: true, expected: 403 });
    await publicJson('checkin', { payload: { legacyId, identity: 'HST02' }, malformed: true, expected: 400 });
    phase = 'excuse and closure';
    await rpc('mutation', 'attendance:excuse', { legacyId, studentId: roster[1].id, excused: true }, teacher.tokens.token, 1);
    await until(() => ownerState.value?.some(fact => fact.studentId === roster[1].id && fact.excusedAt) &&
      teacherState.value?.some(fact => fact.studentId === roster[1].id && fact.excusedAt));
    const callbacksBeforeNoop = ownerState.callbacks + teacherState.callbacks;
    await rpc('mutation', 'attendance:excuse', { legacyId, studentId: roster[1].id, excused: true }, teacher.tokens.token);
    await delay(300);
    check('NoopNoCallbacksObserved', callbacksBeforeNoop === ownerState.callbacks + teacherState.callbacks);
    await rpc('mutation', 'attendance:close', { legacyId }, owner.tokens.token, 1);
    await rpc('mutation', 'attendance:excuse', { legacyId, studentId: roster[2].id, excused: true }, teacher.tokens.token, 1);
    await until(() => ownerState.value?.some(fact => fact.studentId === roster[2].id && fact.excusedAt) &&
      teacherState.value?.some(fact => fact.studentId === roster[2].id && fact.excusedAt));
    await publicJson('checkin', { payload: { legacyId, identity: 'HST04' }, expected: 409, writes: 48 });
    check('ClosedMetadata', (await publicJson('public-info', { payload: { legacyId } })).closed === true);
    phase = 'sharing revocation';
    teacherState.beginRevocation(403);
    await rpc('mutation', 'attendance:unshare', { classId: created.classId, username: teacher.username }, owner.tokens.token, 1);
    teacherState.commitRevocation();
    await until(teacherState.freshDenial);
    check('LiveSharingDenial', teacherState.freshDenial());
    const oldCallbacks = teacherState.callbacks;
    await rpc('mutation', 'attendance:excuse', { legacyId, studentId: roster[3].id, excused: true }, owner.tokens.token, 1);
    await until(() => ownerState.value?.some(fact => fact.studentId === roster[3].id && fact.excusedAt));
    check('RevokedSubscriptionNoNewSuccess', teacherState.callbacks === oldCallbacks);
    await denied('attendance:bucket', teacher.tokens.token, { legacyId, bucket: 0 }, 403);
    const snapshot = await rpc('query', 'attendance:exportSnapshot', { legacyId }, owner.tokens.token);
    check('FreshExportSnapshot', snapshot.rows.length === 5 && snapshot.rows[0].checkedInAt === at &&
      snapshot.rows.filter(row => row.excused).length === 3);
    phase = 'issuer jwks and managed refresh';
    reserve('publicHttp');
    let jwks;
    try {
      report.physicalHttpAttempts++;
      const response = await transport(manifest.siteUrl + '/.well-known/jwks.json');
      ensure(response.ok, 'jwks_http'); jwks = await response.json();
    } finally { report.calls.settledLocally++; }
    const verifyManaged = token => {
      const pieces = token.split('.'), header = JSON.parse(Buffer.from(pieces[0], 'base64url'));
      const jwt = claims(token);
      const candidates = jwks.keys?.filter(jwk => jwk.kty === 'RSA' && (!header.kid || jwk.kid === header.kid));
      ensure(header.alg === 'RS256' && candidates?.length === 1 &&
        verify('RSA-SHA256', Buffer.from(pieces[0] + '.' + pieces[1]),
          createPublicKey({ key: candidates[0], format: 'jwk' }), Buffer.from(pieces[2], 'base64url')) &&
        jwt.iss === manifest.siteUrl && (jwt.aud === 'convex' || Array.isArray(jwt.aud) && jwt.aud.includes('convex')), 'managed_jwks_signature');
    };
    verifyManaged(owner.tokens.token);
    const oldToken = owner.tokens.token, oldClaims = claims(oldToken);
    await delay(1100);
    const refreshed = await rpc('action', 'auth:signIn', { refreshToken: owner.tokens.refreshToken }, undefined, 8);
    ensure(refreshed?.tokens?.token && refreshed.tokens.refreshToken, 'refresh_tokens');
    const renewed = claims(refreshed.tokens.token); verifyManaged(refreshed.tokens.token);
    check('ManagedRefreshFixedSession', refreshed.tokens.token !== oldToken &&
      renewed.sub === oldClaims.sub && renewed.sessionExpiresAt === oldClaims.sessionExpiresAt);
    owner.tokens = refreshed.tokens;
    await rpc('query', 'attendance:viewer', {}, owner.tokens.token);
    phase = 'logout and old token revocation';
    ownerState.beginRevocation(401);
    await logout(owner);
    ownerState.commitRevocation();
    await denied('attendance:viewer', oldToken, {}, 401);
    await until(ownerState.freshDenial);
    check('LogoutRevokesLiveSubscription', ownerState.freshDenial());
    await rpc('query', 'attendance:viewer', {}, teacher.tokens.token);
    teacherState.stop();
    await logout(teacher);
    await denied('attendance:viewer', teacher.tokens.token, {}, 401);
    check('ControlSessionIsolated', true);
    report.functionalFlowCompleted = true;
  } catch (error) {
    report.failedPhase = phase;
    report.failureKind = error instanceof GateError ? error.code :
      [400, 401, 403, 409, 429, 503].includes(error?.data?.status) ? 'unexpected_domain_status_' + error.data.status : 'transport_or_unexpected';
    process.exitCode = 1;
  } finally {
    cleaning = true;
    if (attempt) {
      for (const subscription of subscriptions) {
        try { subscription.stop(); } catch { report.cleanup.subscriptionStopIncomplete = true; }
      }
      try {
        await within(Promise.all(clients.map(client => client.close())), Math.max(1, Math.min(5000, 180000 - (performance.now() - start))));
        report.cleanup.clientsClosed = true;
      } catch { report.cleanup.clientsClosed = false; }
      for (const socket of sockets) socket.terminate();
      // Reserve two ten-second requests for closing domain access BEFORE optional
      // remaining logouts. Ordinary work stops at 130s, leaving 50s for shutdown.
      requestTimeoutMs = 10000;
      if (active || activationAttempted) {
        let closed;
        try {
          closed = await rpc('mutation', 'operations:setAvailability', {
            fingerprint: emptyFingerprint, readsEnabled: false, writesEnabled: false,
          }, 'admin', 1);
        } catch { report.cleanup.closureMutationUncertain = true; }
        try {
          const observed = await rpc('query', 'operations:availability', { fingerprint: emptyFingerprint }, 'admin');
          report.cleanup.availabilityClosed = observed?.readsEnabled === false && observed?.writesEnabled === false;
          report.cleanup.closureAcknowledged = closed?.readsEnabled === false && closed?.writesEnabled === false;
        } catch { report.cleanup.availabilityClosed = false; }
      }
      requestTimeoutMs = 4000;
      for (const actor of actors) {
        try { await logout(actor); } catch { report.cleanup.logoutIncomplete = true; }
      }
      requestTimeoutMs = 2000;
      try {
        report.afterDeploymentUsage = safeUsage(await control(manifest.cloudUrl + '/api/v1/get_current_usage', 'Convex ' + manifest.adminKey));
      } catch { report.afterDeploymentUsage = 'UNAVAILABLE'; }
    }
    report.importReservations = { calls: importCalls, writes: importWrites };
    report.elapsedMs = Math.round(performance.now() - start);
    report.finishedAt = new Date().toISOString();
    report.cancelled = cancellationReceived;
    if (cancellationReceived && !report.failedPhase) report.failedPhase = 'cancelled';
    if (fatalObservation && !report.failedPhase) report.failedPhase = fatalObservation;
    if (report.blockedReconnectAttempts && !report.failedPhase) report.failedPhase = 'unexpected_reconnect';
    report.passed = !!report.functionalFlowCompleted && report.cleanup.clientsClosed &&
      report.cleanup.availabilityClosed && !report.failedPhase && !report.cleanup.logoutIncomplete &&
      !report.cancelled && !fatalObservation && !report.cleanup.subscriptionStopIncomplete &&
      !report.cleanup.closureMutationUncertain && report.cleanup.closureAcknowledged === true &&
      report.calls.submitted === report.calls.settledLocally && Object.values(report.assertions).every(Boolean) &&
      report.calls.submitted <= 200 && report.fixtureWriteUpperReservations <= 500;
    if (!report.passed) process.exitCode = 1;
    if (attempt) {
      await saveAttempt();
      await writeFile(evidencePath, JSON.stringify(report, null, 2) + '\n');
    }
    process.removeListener('SIGINT', stoppedSignal); process.removeListener('SIGTERM', stoppedSignal);
  }
  console.log(JSON.stringify({ passed: report.passed, failedPhase: report.failedPhase,
    calls: report.calls, fixtureWriteUpperReservations: report.fixtureWriteUpperReservations,
    studentGatewayCalls: report.studentGatewayCalls, previewDeleted: false }));
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await runHostedPreview(process.argv.slice(2)); }
  catch { console.error('Hosted verification stopped; sensitive details withheld.'); process.exitCode = 1; }
}
