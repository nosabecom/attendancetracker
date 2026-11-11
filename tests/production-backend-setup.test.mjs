import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { mkdtemp, mkdir, chmod, writeFile, readFile, readdir, rm, lstat, symlink, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProductionBackendSetup, setupBinding, SETUP_LIMITS, SETUP_HEADROOM, ProductionSetupError,
  publishOnce, parseArgs } from '../scripts/prepare-production-backend.mjs';
import { describeSource, sourceBinding, PRODUCTION_TARGET } from '../scripts/execute-production-import.mjs';
import { checkPublicationSelection } from '../scripts/check-convex-publication-selection.mjs';

// Fictional public data and locally generated private fixtures ONLY.
const sha = value => createHash('sha256').update(value).digest('hex');
const instant = '2026-11-10T23:00:00.000Z', now = () => Date.parse(instant);
const KEY = 'OPAQUE_PRODUCTION_SENTINEL#literal\\bytes';
const selector = () => ({ directTargetSelected: true, opaqueCapabilityPreserved: true, realNetworkRequests: 0, claimRequests: 0 });
const limit = { metric: 'functionCalls', window: 'day', limitType: 'disable', limit: 1000, enabled: true };
const canonical = { convexCloudUrl: PRODUCTION_TARGET.cloudUrl, convexSiteUrl: PRODUCTION_TARGET.siteUrl };
function fixture() {
  const blobs = [], add = (pathname, value) => blobs.push({ pathname, uploadedAt: instant, value });
  const roster = letter => Array.from({ length: 44 }, (_, i) => ({ id: `${letter}${i}`, name: `Fiction ${letter} ${i}`, code: `${letter}${i}` }));
  const a = roster('a'), b = roster('b'), c = roster('c');
  for (let i = 0; i < 3; i++) {
    const username = `fiction.owner${i}`;
    add(`auth/accounts/${sha(username)}.json`, { owner: `owner-${i}`, username, salt: '1'.repeat(32), passwordHash: '2'.repeat(128) });
  }
  const ids = Array.from({ length: 7 }, (_, i) => String(i + 1).repeat(32));
  for (let i = 0; i < 7; i++) add(`sessions/${ids[i]}.json`, { id: ids[i], classId: i < 4 ? ids[0] : ids[4],
    owner: `owner-${i < 4 ? 0 : 1}`, title: 'Fictional class', createdAt: instant, students: i < 2 ? a : i < 4 ? b : c });
  add(`classes/${ids[0]}/versions/0000000001.json`, { revision: 1, students: b, teachers: [{ owner: 'owner-2', username: 'fiction.owner2' }] });
  add(`closed/${ids[0]}.json`, { at: instant });
  for (let i = 0; i < 198; i++) {
    const session = Math.floor(i / 44), students = session < 2 ? a : session < 4 ? b : c;
    add(`checks/${ids[session]}/${students[i % 44].id}.json`, { at: instant });
  }
  while (blobs.length < 298) add(`auth/attempts/ip/${sha('fictional-ip')}/100/${blobs.length.toString(16).padStart(24, '0')}.json`, {});
  return { formatVersion: 1, exportedAt: instant, blobs };
}
function functions() {
  return ['migration:initialize', 'migration:begin', 'migration:stage', 'migration:freeze', 'migration:verifyNext',
    'migration:activate', 'migration:status', 'operations:setAvailability', 'operations:availability'].map(name => ({
    identifier: name.replace(':', '.js:'), visibility: { kind: 'internal' },
    functionType: ['migration:status', 'operations:availability'].includes(name) ? 'Query' : 'Mutation',
    args: { type: 'object', value: name === 'migration:activate' ? {
      runId: { fieldType: { type: 'id', tableName: 'migrationRuns' }, optional: false },
      readOnly: { fieldType: { type: 'boolean' }, optional: true },
    } : {} },
  }));
}
async function harness(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'offline-production-setup-'));
  await chmod(directory, 0o700); t.after(() => rm(directory, { recursive: true, force: true }));
  const ledger = join(directory, 'ledger'); await mkdir(ledger, { mode: 0o700 });
  const input = join(directory, 'frozen.json'), planPath = join(directory, 'setup-plan.json'), key = join(directory, 'raw-key');
  const raw = Buffer.from(JSON.stringify(fixture())), { source } = describeSource(raw), code = await sourceBinding();
  const reviewed = { reviewed: true, evidenceDigest: 'a'.repeat(64) };
  const plan = { formatVersion: 1, allocation: 'PRODUCTION_BACKEND_SETUP1', target: { ...PRODUCTION_TARGET }, source, code,
    setupDigest: await setupBinding(), ledgerDirectory: ledger, budgets: { ...SETUP_LIMITS }, gates: {
      source: { ...reviewed, continuousHold: true, reconciled: true },
      identity: { ...reviewed, target: { ...PRODUCTION_TARGET }, source: 'convex-dashboard-agent-observation', observedAt: instant, state: 'NeverDeployed' },
      capability: { ...reviewed, kind: 'PRODUCTION_DEPLOYMENT', target: { ...PRODUCTION_TARGET }, rawSha256: sha(KEY) },
      quota: { ...reviewed, team: PRODUCTION_TARGET.team, plan: 'CONVEX_BASE', source: 'convex-dashboard-user-report',
        observedAt: instant, allProjects: true, timezone: 'UTC',
        billingPeriod: { start: '2026-11-04T00:00:00.000Z', end: '2026-12-01T00:00:00.000Z' },
        resources: Object.fromEntries(Object.entries(SETUP_HEADROOM).map(([metric, amount]) => [metric, { used: 0, limit: amount * 2 }])) },
    } };
  await writeFile(input, raw, { mode: 0o600 }); await writeFile(key, KEY, { mode: 0o600 });
  await writeFile(planPath, JSON.stringify(plan), { mode: 0o600 });
  const requests = [], publications = [], reports = [], state = { env: options.env ?? [{ name: 'CONVEX_SITE_URL', value: canonical.convexSiteUrl }],
    limits: options.limits ?? [], spec: functions() };
  let intercept;
  const respond = value => new Response(value === null ? '' : JSON.stringify(value));
  const transport = async (url, init) => {
    assert.equal(url.startsWith(PRODUCTION_TARGET.cloudUrl + '/'), true);
    assert.equal(init.headers.Authorization, `Convex ${KEY}`); assert.equal(init.redirect, 'error');
    const reservations = (await readdir(ledger)).filter(name => name.endsWith('.reservation.json') && name.startsWith('request-')).sort();
    assert.equal(reservations.length, requests.length + 1);
    const reservationPath = join(ledger, reservations.at(-1));
    assert.equal((await lstat(reservationPath)).mode & 0o777, 0o400);
    assert.equal(JSON.parse(await readFile(reservationPath)).ordinal, requests.length + 1);
    const request = { url, path: new URL(url).pathname, method: init.method, body: init.body ? JSON.parse(init.body) : undefined };
    requests.push(request);
    const standard = () => {
      switch (request.path) {
        case '/api/v1/get_canonical_urls': return respond(canonical);
        case '/api/v1/get_current_usage': return respond({ metrics: {}, seedStatus: 'available' });
        case '/api/v1/list_usage_limits': return respond({ usageLimits: state.limits });
        case '/api/v1/create_usage_limit': assert.deepEqual(request.body, limit); state.limits.push(limit); return respond({ usageLimit: limit });
        case '/api/update_environment_variables':
          assert.deepEqual(request.body.changes.map(x => x.name), ['JWT_PRIVATE_KEY', 'JWKS', 'ATTENDANCE_GATEWAY_KEY', 'ATTENDANCE_GATEWAY_AUDIENCE']);
          state.env.push(...request.body.changes); return respond(null);
        case '/api/query':
          assert.deepEqual(request.body.args, [{}]); assert.equal(request.body.format, 'convex_encoded_json');
          assert.ok(['_system/cli/queryEnvironmentVariables', '_system/cli/modules:apiSpec'].includes(request.body.path));
          return respond({ status: 'success', value: request.body.path.endsWith('apiSpec') ? state.spec : state.env, logLines: [KEY] });
        default: assert.fail('Unexpected setup endpoint');
      }
    };
    return intercept ? intercept(request, standard) : standard();
  };
  const publish = async value => {
    assert.equal((await lstat(join(ledger, 'publication.reservation.json'))).mode & 0o777, 0o400);
    assert.equal((await readFile(value.envFile, 'utf8')).includes(KEY), true);
    assert.equal((await lstat(value.envFile)).mode & 0o777, 0o400);
    publications.push(value); return { status: 0, signal: null, uncertain: false };
  };
  const args = () => ['--input', input, '--plan', planPath, '--key-file', key, '--ledger', plan.ledgerDirectory, '--apply'];
  return { directory, ledger, input, plan, planPath, key, source, code, requests, publications, reports, state, args,
    save: () => writeFile(planPath, JSON.stringify(plan)), intercept: value => { intercept = value; },
    run: (dependencies = {}) => runProductionBackendSetup(args(), { now, transport, publish, selectorCheck: selector,
      cleanSource: async () => {}, report: result => reports.push(result), ...dependencies }),
    names: () => readdir(ledger),
    reservations: async () => Promise.all((await readdir(ledger)).filter(name => name.endsWith('.reservation.json') && name.startsWith('request-'))
      .sort().map(name => readFile(join(ledger, name)).then(JSON.parse))),
  };
}
async function rejectsCode(promise, code) {
  await assert.rejects(promise, error => error instanceof ProductionSetupError && error.code === code && !error.message.includes(KEY));
}

test('default setup is offline, needs no key/plan/ledger, and emits no private bindings', async t => {
  const h = await harness(t); await rm(h.key); await rm(h.planPath);
  const unexpected = () => assert.fail('Dry-run reached an apply dependency');
  const result = await runProductionBackendSetup(['--input', h.input, '--key-file', h.key], {
    transport: unexpected, publish: unexpected, selectorCheck: unexpected, cleanSource: unexpected,
  });
  assert.equal(result.dryRun, true); assert.equal(result.frozenObjects, 298);
  assert.equal(result.controlAttempts, 0); assert.equal(result.cliPublications, 0);
  assert.deepEqual(await h.names(), []);
  assert.equal(JSON.stringify(result).includes(h.source.rawSha256), false);
  assert.equal(JSON.stringify(result).includes(h.code.digest), false);
});

test('target, frozen source, reviewed source, capability scope, UI and fresh all-team quota fail before key/network', async t => {
  for (const [label, mutate, code] of [
    ['target', p => { p.target.deploymentType = 'preview'; }, 'target_mismatch'],
    ['frozen', p => { p.source.rawSha256 = 'b'.repeat(64); }, 'frozen_source_mismatch'],
    ['code', p => { p.code.commit = 'b'.repeat(40); }, 'source_code_mismatch'],
    ['helper', p => { p.setupDigest = 'b'.repeat(64); }, 'source_code_mismatch'],
    ['quota age', p => { p.gates.quota.observedAt = '2026-11-09T22:59:59.000Z'; }, 'quota_stale'],
    ['quota future', p => { p.gates.quota.observedAt = '2026-11-10T23:05:00.001Z'; }, 'quota_stale'],
    ['quota project filter', p => { p.gates.quota.allProjects = false; }, 'quota_period'],
    ['quota timezone', p => { p.gates.quota.timezone = 'America/Regina'; }, 'quota_period'],
    ['quota period', p => { p.gates.quota.billingPeriod.end = instant; }, 'quota_period'],
    ['headroom', p => { p.gates.quota.resources.functionCalls.limit = 999; }, 'quota_headroom'],
    ['plan', p => { p.gates.quota.plan = 'different'; }, 'quota_gate'],
    ['capability scope', p => { p.gates.capability.kind = 'PROJECT_PREVIEW'; }, 'capability_gate'],
    ['UI target', p => { p.gates.identity.target.project = 'other'; }, 'identity_gate'],
    ['UI age', p => { p.gates.identity.observedAt = '2026-11-09T20:00:00.000Z'; }, 'identity_stale'],
    ['hold', p => { p.gates.source.continuousHold = false; }, 'source_gate'],
    ['budget', p => { p.budgets.controlAttempts++; }, 'allocation_mismatch'],
  ]) await t.test(label, async t => {
    const h = await harness(t); mutate(h.plan); await h.save(); await rm(h.key);
    await rejectsCode(h.run(), code); assert.equal(h.requests.length, 0); assert.deepEqual(await h.names(), []);
  });
});

test('opaque genuine capability bytes must match review and remain private', async t => {
  const h = await harness(t); await writeFile(h.key, KEY + '-wrong');
  await rejectsCode(h.run(), 'capability_mismatch'); assert.equal(h.requests.length, 0);
  await writeFile(h.key, KEY); await chmod(h.key, 0o644);
  await rejectsCode(h.run(), 'setup_guard_failed'); assert.equal(h.requests.length, 0);
  await chmod(h.key, 0o600); await rm(h.key); await symlink(h.input, h.key);
  await rejectsCode(h.run(), 'setup_guard_failed'); assert.equal(h.requests.length, 0);
});

test('canonical identity mismatch spends one read and makes no mutation/publication', async t => {
  const h = await harness(t); h.intercept(() => new Response(JSON.stringify({ ...canonical, convexSiteUrl: 'https://other.convex.site' })));
  await rejectsCode(h.run(), 'canonical_identity_mismatch');
  assert.equal(h.requests.length, 1); assert.equal(h.publications.length, 0);
  assert.equal((await h.reservations()).length, 1); assert.ok((await h.names()).includes('stopped.json'));
  const count = h.requests.length; await rejectsCode(h.run(), 'allocation_already_used'); assert.equal(h.requests.length, count);
});

test('missing/unsupported environment or conflicting daily limits stop before any mutation', async t => {
  for (const [label, overrides, intercept, code] of [
    ['existing JWT', { env: [{ name: 'JWT_PRIVATE_KEY', value: 'previous-private-key' }] }, null, 'existing_environment_conflict'],
    ['existing audience', { env: [{ name: 'ATTENDANCE_GATEWAY_AUDIENCE', value: 'previous-audience' }] }, null, 'existing_environment_conflict'],
    ['unknown limit', { limits: [{ ...limit, limit: 1001 }] }, null, 'existing_limit_conflict'],
    ['disabled limit', { limits: [{ ...limit, enabled: false }] }, null, 'existing_limit_conflict'],
    ['duplicate limit', { limits: [limit, limit] }, null, 'existing_limit_conflict'],
    ['malformed limit', { limits: [{}] }, null, 'limits_unsupported'],
    ['missing environment', {}, (r, standard) => r.path === '/api/query' ? new Response(JSON.stringify({ status: 'success', value: null })) : standard(), 'environment_unsupported'],
  ]) await t.test(label, async t => {
    const h = await harness(t, overrides); h.intercept(intercept);
    await rejectsCode(h.run(), code);
    assert.equal(h.requests.some(r => ['/api/v1/create_usage_limit', '/api/update_environment_variables'].includes(r.path)), false);
    assert.equal(h.publications.length, 0);
  });
});

test('success matches actual responses, preserves existing values, and uses private independent matching RSA keys', async t => {
  const h = await harness(t), result = await h.run();
  assert.equal(result.setup, 'published'); assert.equal(result.controlAttempts, 10); assert.equal(result.cliPublications, 1);
  assert.equal(h.publications.length, 1); assert.equal(h.requests.length, 10);
  const saved = JSON.parse(await readFile(join(h.ledger, 'generated-configuration.json')));
  const publicJwk = JSON.parse(saved.JWKS).keys[0]; assert.equal(publicJwk.kty, 'RSA'); assert.equal(publicJwk.use, 'sig');
  const privateKey = createPrivateKey(saved.JWT_PRIVATE_KEY.replaceAll(' ', '\n').replace('-----BEGIN\nPRIVATE\nKEY-----', '-----BEGIN PRIVATE KEY-----').replace('-----END\nPRIVATE\nKEY-----', '-----END PRIVATE KEY-----'));
  assert.equal(privateKey.asymmetricKeyDetails.modulusLength, 2048);
  assert.equal(verify('sha256', Buffer.from('fixture'), createPublicKey({ key: publicJwk, format: 'jwk' }), sign('sha256', Buffer.from('fixture'), privateKey)), true);
  assert.match(saved.ATTENDANCE_GATEWAY_KEY, /^[a-f0-9]{64}$/);
  assert.match(saved.ATTENDANCE_GATEWAY_AUDIENCE, /^attendance-production-[a-f0-9]{32}$/);
  assert.equal(h.state.env.find(x => x.name === 'CONVEX_SITE_URL').value, canonical.convexSiteUrl);
  const receipt = JSON.parse(await readFile(join(h.ledger, 'publication-receipt.json')));
  assert.equal(receipt.controlAttempts, h.requests.length); assert.equal(receipt.publishedFunctionMetadataVerified, true);
  assert.equal(receipt.importInitialized, false); assert.equal(receipt.targetTableCounts, 'not inspected');
  assert.equal(receipt.readyManifestCreated, false); assert.equal(receipt.operatorReviewRequired, true);
  for (const name of await h.names()) assert.equal((await lstat(join(h.ledger, name))).mode & 0o777, 0o400);
  const publicText = JSON.stringify(h.reports);
  for (const value of [KEY, ...Object.values(saved), h.source.rawSha256, h.code.digest]) assert.equal(publicText.includes(value), false);
  assert.equal(h.requests.some(r => /claim|preview|delete/.test(r.path)), false);
  assert.equal(h.requests.filter(r => r.path === '/api/query').every(r => r.body.path.startsWith('_system/cli/')), true);
});

test('already exact enabled daily limit is retained, and allocation/path reuse cannot reset ceilings', async t => {
  const h = await harness(t, { limits: [limit] }); await h.run();
  assert.equal(h.requests.length, 9); assert.equal(h.requests.some(r => r.path.endsWith('create_usage_limit')), false);
  const attempts = h.requests.length; await rejectsCode(h.run(), 'allocation_already_used'); assert.equal(h.requests.length, attempts);
  const alternate = join(h.directory, 'alternate'); await mkdir(alternate, { mode: 0o700 });
  h.plan.ledgerDirectory = alternate;
  await rejectsCode(h.run(), 'allocation_mismatch'); assert.equal(h.requests.length, attempts);
  await h.save(); await rejectsCode(h.run(), 'setup_guard_failed');
  assert.equal(h.requests.length, attempts); assert.equal(h.publications.length, 1); assert.deepEqual(await readdir(alternate), []);
});

test('uncertain mutating response remains spent and stops without later requests or automatic retry', async t => {
  const h = await harness(t);
  h.intercept((request, standard) => {
    const result = standard();
    if (request.path.endsWith('create_usage_limit')) throw Error(KEY);
    return result;
  });
  await rejectsCode(h.run(), 'control_request_failed');
  assert.equal(h.requests.length, 5); assert.equal(h.state.limits.length, 1); assert.equal(h.publications.length, 0);
  assert.equal((await h.reservations()).length, 5);
  assert.ok((await h.names()).includes('request-000005.uncertain.json'));
  await rejectsCode(h.run(), 'allocation_already_used'); assert.equal(h.requests.length, 5);
});

test('readbacks must match actual limits and exact configuration before publication', async t => {
  for (const label of ['limit', 'config']) await t.test(label, async t => {
    const h = await harness(t); let lists = 0, environments = 0;
    h.intercept((request, standard) => {
      if (request.path.endsWith('list_usage_limits') && ++lists === 2 && label === 'limit') return new Response(JSON.stringify({ usageLimits: [] }));
      if (request.path === '/api/query' && ++environments === 2 && label === 'config') return new Response(JSON.stringify({ status: 'success', value: [] }));
      return standard();
    });
    await rejectsCode(h.run(), label === 'limit' ? 'existing_limit_conflict' : 'environment_readback_mismatch');
    assert.equal(h.publications.length, 0); assert.equal((await h.names()).includes('publication-receipt.json'), false);
  });
});

test('CLI failure, timeout/unknown outcome and signal never produce a passing receipt/report or retry', async t => {
  for (const result of [{ status: 1, signal: null, uncertain: false }, { status: null, signal: 'SIGTERM', uncertain: true },
    { status: 0, signal: null, uncertain: true }, null, 'throw', 'cancel']) await t.test(String(result), async t => {
    const h = await harness(t), controller = new AbortController(); let invoked = 0;
    const publish = async () => {
      invoked++; if (result === 'throw') throw Error(KEY);
      if (result === 'cancel') { controller.abort(); return { status: 0, signal: null, uncertain: false }; }
      return result;
    };
    await assert.rejects(h.run({ publish, signal: controller.signal }), error => error instanceof ProductionSetupError && !error.message.includes(KEY));
    assert.equal(invoked, 1); assert.equal(h.requests.length, 8);
    assert.equal((await h.names()).includes('publication.reservation.json'), true);
    assert.equal((await h.names()).includes('publication-receipt.json'), false); assert.deepEqual(h.reports, []);
    await rejectsCode(h.run(), 'allocation_already_used'); assert.equal(invoked, 1);
  });
});

test('wrong post-publication canonical identity or expected names/types retains publication but stops', async t => {
  for (const label of ['canonical', 'spec']) await t.test(label, async t => {
    const h = await harness(t); let canonicalCalls = 0;
    if (label === 'spec') h.state.spec.find(x => x.identifier === 'migration.js:activate').functionType = 'Query';
    h.intercept((request, standard) => request.path.endsWith('get_canonical_urls') && ++canonicalCalls === 2 && label === 'canonical' ?
      new Response(JSON.stringify({ ...canonical, convexCloudUrl: 'https://other.convex.cloud' })) : standard());
    await rejectsCode(h.run(), label === 'canonical' ? 'canonical_identity_mismatch' : 'published_spec_mismatch');
    assert.equal(h.publications.length, 1); assert.equal((await h.names()).includes('publication.outcome.json'), true);
    assert.equal((await h.names()).includes('publication-receipt.json'), false); assert.deepEqual(h.reports, []);
  });
});

test('unknown readOnly/visibility metadata is explicitly unverified and requires private review before READY', async t => {
  const h = await harness(t);
  delete h.state.spec.find(x => x.identifier === 'migration.js:activate').args.value.readOnly;
  h.state.spec.find(x => x.identifier === 'migration.js:begin').visibility = 'unfamiliar-provider-shape';
  await h.run();
  const receipt = JSON.parse(await readFile(join(h.ledger, 'publication-receipt.json')));
  assert.equal(receipt.identifierTypesVerified, true); assert.equal(receipt.publishedFunctionMetadataVerified, false);
  assert.equal(receipt.readOnlyMetadata, 'operator_review_required'); assert.equal(receipt.visibilityMetadata, 'operator_review_required');
  assert.equal(receipt.operatorReviewRequired, true); assert.equal(receipt.readyManifestCreated, false);
});

test('a signal interrupts a stalled response body and retains its spent reservation', async t => {
  const h = await harness(t), controller = new AbortController(); let cancelCalled = false;
  h.intercept(() => new Response(new ReadableStream({ start() { setTimeout(() => controller.abort(), 20); },
    cancel() { cancelCalled = true; } })));
  await rejectsCode(h.run({ signal: controller.signal }), 'cancelled');
  assert.equal(h.requests.length, 1); assert.equal(cancelCalled, true);
  assert.equal((await h.reservations()).length, 1); assert.deepEqual(h.reports, []);
  assert.ok((await h.names()).includes('request-000001.uncertain.json'));
});

test('system-query error/log lines and existing environment values are never retained', async t => {
  const h = await harness(t, { env: [{ name: 'PROVIDER_BUILTIN', value: KEY }] });
  h.intercept((request, standard) => request.path === '/api/query' ? new Response(JSON.stringify({
    status: 'error', errorMessage: KEY, errorData: { credential: KEY }, logLines: [KEY],
  })) : standard());
  await rejectsCode(h.run(), 'system_query_failed');
  for (const name of await h.names()) {
    const value = await readFile(join(h.ledger, name), 'utf8');
    assert.equal(value.includes(KEY), false);
  }
  assert.equal(h.publications.length, 0);
});

test('one local fake CLI receives exact selectors and a clean environment; output stays in private handles', async t => {
  const h = await harness(t), bin = join(h.directory, 'bin'); await mkdir(bin, { mode: 0o700 });
  const captured = join(h.directory, 'cli-captured.json');
  await writeFile(join(bin, 'pnpm'), `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(captured)},JSON.stringify({args:process.argv.slice(2),keys:Object.keys(process.env)}));process.stdout.write(${JSON.stringify(KEY)});`, { mode: 0o700 });
  const stdout = await open(join(h.directory, 'cli-stdout'), 'wx', 0o600), stderr = await open(join(h.directory, 'cli-stderr'), 'wx', 0o600);
  const previous = process.env.PATH, previousSelector = process.env.CONVEX_DEPLOY_KEY;
  process.env.PATH = `${bin}:${previous}`; process.env.CONVEX_DEPLOY_KEY = KEY;
  try {
    const envFile = join(h.directory, 'exact-target.env'); await writeFile(envFile, '', { mode: 0o600 });
    assert.deepEqual(await publishOnce({ envFile, stdout: stdout.fd, stderr: stderr.fd }), { status: 0, signal: null, uncertain: false });
    const actual = JSON.parse(await readFile(captured));
    assert.deepEqual(actual.args, ['exec', 'convex', 'deploy', '--typecheck', 'enable', '--codegen', 'disable', '--env-file', envFile]);
    assert.equal(actual.keys.some(name => name.startsWith('CONVEX_') && name !== 'CONVEX_DISABLE_TELEMETRY'), false);
    assert.equal(await readFile(join(h.directory, 'cli-stdout'), 'utf8'), KEY);
  } finally {
    process.env.PATH = previous;
    if (previousSelector === undefined) delete process.env.CONVEX_DEPLOY_KEY; else process.env.CONVEX_DEPLOY_KEY = previousSelector;
    await stdout.close(); await stderr.close();
  }
});

test('cancellation kills the entire local CLI process group including a TERM-resistant descendant', async t => {
  const h = await harness(t), bin = join(h.directory, 'bin'); await mkdir(bin, { mode: 0o700 });
  const descendantReady = join(h.directory, 'descendant-ready.json'), groupReady = join(h.directory, 'group-ready.json');
  const descendantCode = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(descendantReady)},JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);`;
  await writeFile(join(bin, 'pnpm'), `#!/usr/bin/env node\nconst child=require('node:child_process').spawn(process.execPath,['--eval',${JSON.stringify(descendantCode)}],{stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(groupReady)},JSON.stringify({pid:process.pid,child:child.pid}));setInterval(()=>{},1000);`, { mode: 0o700 });
  const stdout = await open(join(h.directory, 'group-stdout'), 'wx', 0o600), stderr = await open(join(h.directory, 'group-stderr'), 'wx', 0o600);
  const previous = process.env.PATH, controller = new AbortController(); let group;
  const waitFor = async (path, checkValue = () => true) => {
    for (let i = 0; i < 200; i++) {
      try { const value = await readFile(path, 'utf8'); if (checkValue(value)) return value; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await new Promise(resolveWait => setTimeout(resolveWait, 10));
    }
    assert.fail('Local process fixture did not settle');
  };
  process.env.PATH = `${bin}:${previous}`;
  try {
    const envFile = join(h.directory, 'group-target.env'); await writeFile(envFile, '', { mode: 0o600 });
    const running = publishOnce({ envFile, stdout: stdout.fd, stderr: stderr.fd, signal: controller.signal });
    group = JSON.parse(await waitFor(groupReady));
    const descendant = JSON.parse(await waitFor(descendantReady)); assert.equal(descendant.pid, group.child);
    controller.abort();
    const result = await running; assert.equal(result.uncertain, true); assert.notEqual(result.status, 0);
    let live = true;
    for (let i = 0; i < 100 && live; i++) {
      try { const stat = await readFile(`/proc/${descendant.pid}/stat`, 'utf8'); live = !stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z '); }
      catch (error) { if (error.code === 'ENOENT') live = false; else throw error; }
      if (live) await new Promise(resolveWait => setTimeout(resolveWait, 10));
    }
    assert.equal(live, false, 'Publication descendant survived cancellation');
  } finally {
    controller.abort(); if (group) { try { process.kill(-group.pid, 'SIGKILL'); } catch {} }
    process.env.PATH = previous; await stdout.close(); await stderr.close();
  }
});

test('actual installed selector fixture blocks network and ignores other deployment selectors', () => {
  const result = checkPublicationSelection();
  assert.equal(result.directTargetSelected, true); assert.equal(result.opaqueCapabilityPreserved, true);
  assert.equal(result.realNetworkRequests, 0); assert.equal(result.claimRequests, 0); assert.equal(result.processSelectorsIgnored, true);
});

test('unsupported arguments cannot select another target, preview, production flag, resume or reset', () => {
  for (const args of [['--prod'], ['--preview-name', 'other'], ['--resume'], ['--reset'], ['--apply', '--apply'],
    ['--target', canonical.convexCloudUrl], ['--input', 'fixture', '--input', 'again']]) {
    assert.throws(() => parseArgs(args), ProductionSetupError);
  }
});
