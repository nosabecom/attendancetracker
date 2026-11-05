import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { assertPublicResponse, boundedFetch, compareIpObservations, counterSnapshot, createAdminReader,
  createBrowserHarness, createBrowserPolicy, createBudget, createOneShotRpc, FINGERPRINT, inspectAuthCookies, parseArgs,
  readAdminTable, runHostedNext, validateManifest, validatePriorEvidence, browserOperation } from '../scripts/test-hosted-next.mjs';
import { persistHostedReports } from '../scripts/test-hosted-preview.mjs';
import { CONTINUATION, ORIGINAL_PATHS, CONTINUATION_PATHS, continuationTotals } from '../scripts/hosted-next-continuation.mjs';
import { historyText, originalPublication, readyContinuationPublication } from './fixtures/hosted-next-history.mjs';

const expected = { deploymentId: 'dpl_fixture', backendName: 'fixture-preview-123' };
const time = Date.parse('2030-01-01T00:00:00Z');
function fixture() {
  return { version: 1, runId: 'attendance-next-' + 'b'.repeat(32), sourceCommit: 'a'.repeat(40), publication: 'ready',
    environmentVerified: { build: true, runtime: true, credentialOverrides: true },
    vercel: { teamSlug: 'nomokaro625-9385s-projects', teamId: 'team_fmwIPLne9w30y7G5JQrs3fzl',
      projectId: 'prj_uOMK1a4PLAgsDr1A16InuImM1M3q', deploymentId: expected.deploymentId,
      url: 'https://fixture.vercel.app', target: 'preview', ready: true },
    backend: { name: expected.backendName, id: 1, projectId: 2,
      reference: 'preview/attendance-validation-' + 'a'.repeat(32),
      cloudUrl: 'https://fixture-preview-123.convex.cloud', siteUrl: 'https://fixture-preview-123.convex.site', fingerprint: FINGERPRINT },
    access: { kind: 'deployment-shareable', token: 'synthetic-bypass', expiresAt: new Date(time + 900000).toISOString(), headerVerified: true },
    counters: { controlRequests: 20, hostingRequests: 2, applicationCalls: 1 } };
}
function backendFixture() {
  const m = fixture();
  return { deploymentName: expected.backendName, team: 'nomokaro625-9385-s-projects', project: 'convex-cyan-garden',
    isNewDeployment: true, identifier: 'attendance-validation-' + 'a'.repeat(32),
    managementIdentity: { kind: 'cloud', name: expected.backendName, deploymentType: 'preview', isDefault: false,
      id: 1, projectId: 2, reference: m.backend.reference, deploymentUrl: m.backend.cloudUrl },
    reference: m.backend.reference, cloudUrl: m.backend.cloudUrl, siteUrl: m.backend.siteUrl,
    publication: 'succeeded', environmentConfigured: true, limitVerified: true, adminCapabilityVerified: true,
    reviewedSourceCommit: 'e'.repeat(40), adminKey: 'synthetic-admin-capability',
    config: { ATTENDANCE_GATEWAY_KEY: 'synthetic-gateway-secret-'.repeat(3), ATTENDANCE_GATEWAY_AUDIENCE: 'synthetic-audience' } };
}
function priorFixture() {
  return { version: 1, passed: true, backendOnly: true, cancelled: false,
    calls: { submitted: 61, settledLocally: 61 }, fixtureWriteUpperReservations: 355, studentGatewayCalls: 7,
    cleanup: { availabilityClosed: true, closureAcknowledged: true, clientsClosed: true },
    syntheticFingerprint: FINGERPRINT, deploymentName: expected.backendName,
    sourceCommit: backendFixture().reviewedSourceCommit, assertions: { synthetic: true } };
}
const args = ['--expected-vercel-deployment', expected.deploymentId, '--expected-preview', expected.backendName];
const authNames = ['__Host-__convexAuthJWT', '__Host-__convexAuthRefreshToken', '__Host-__convexAuthOAuthVerifier'];
const jwt = 'e30.' + Buffer.from(JSON.stringify({ sub: 'syntheticUser|syntheticSession', iat: time / 1000,
  exp: time / 1000 + 3600, sessionExpiresAt: time + 30 * 86400000 })).toString('base64url') + '.synthetic-signature';
function cookieLines(deleted = false) {
  return authNames.map((name, i) => `${name}=${deleted || i === 2 ? '' : i === 0 ? jwt : 'synthetic-refresh'}; Path=/; ` +
    (deleted || i === 2 ? 'Expires=Thu, 01 Jan 1970 00:00:00 GMT; ' : 'Max-Age=2592000; ') + 'HttpOnly; Secure; SameSite=Lax');
}
function response(body, status = 200, cookies = []) {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  for (const line of cookies) headers.append('Set-Cookie', line);
  return { status, headers, bytes: body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body)) };
}
function offlineRun(options = {}) {
  const manifest = fixture(), backend = backendFixture(), prior = priorFixture();
  const original = originalPublication(manifest.backend);
  if (options.continuation) {
    manifest.continuation = structuredClone(CONTINUATION);
    manifest.cumulative = continuationTotals(manifest.counters, 1);
    options.mutateContinuation?.(manifest);
    options.mutateHistory?.(original);
  }
  const paths = options.continuation ? CONTINUATION_PATHS : ORIGINAL_PATHS;
  const publication = options.continuation ? readyContinuationPublication(manifest) : undefined;
  options.mutatePublication?.(publication);
  const events = [], persisted = new Map();
  const state = { open: false, checkins: 0, loggedOut: false, exclusive: 0, deleted: false, mutationCalls: 0 };
  const deploy = { id: expected.deploymentId, ownerId: manifest.vercel.teamId, projectId: manifest.vercel.projectId,
    target: null, url: 'fixture.vercel.app', readyState: 'READY', meta: { attendanceValidation: manifest.runId,
      attendanceSourceCommit: manifest.sourceCommit, githubCommitSha: manifest.sourceCommit } };
  const dependencies = {
    now: () => options.elapsed?.() ?? 0, wallNow: () => time,
    readPrivateText: async path => {
      if (path === paths.manifest) return JSON.stringify(manifest);
      if (options.continuation && path === ORIGINAL_PATHS.manifest) return JSON.stringify(original);
      if (path?.endsWith('/preview-setup-manifest.json')) return JSON.stringify(backend);
      if (path === 'fixture-key-path') return 'preview:nomokaro625-9385-s-projects:convex-cyan-garden|synthetic-key';
      throw Error('unexpected private fixture path');
    },
    readVercelToken: async path => { assert.equal(path, 'fixture-auth-path'); return 'synthetic-vercel-auth'; },
    readPublic: async path => path === ORIGINAL_PATHS.publication ? historyText + (options.corruptHistory ? '\n' : '') :
      path === CONTINUATION_PATHS.publication ? JSON.stringify(publication) : JSON.stringify(prior),
    assertAbsent: async path => {
      assert([ORIGINAL_PATHS.attempt, CONTINUATION_PATHS.evidence].includes(path));
      if (options.originalRuntimeExists && path === ORIGINAL_PATHS.attempt) throw Error('original_runtime_exists');
      if (persisted.has(path)) throw Error('continuation_record_exists');
    },
    git: values => values[0] === 'rev-parse' ? manifest.sourceCommit : '',
    quota: async () => ({ plan: 'CONVEX_BASE', source: 'convex-dashboard-user-report', observedAt: new Date(time).toISOString(),
      plannedHeadroom: { functionCalls: 1000 } }),
    exclusiveAttempt: async (record, path) => {
      assert.equal(path, paths.attempt);
      assert.equal(!!record.continuation, !!options.continuation);
      state.exclusive++; events.push('exclusive');
      if (options.existing || state.exclusive > 1) throw Error('EEXIST');
    },
    providerJson: async (value, init) => {
      const url = new URL(value); assert.equal(state.exclusive, 1);
      events.push('control:' + (init.method ?? 'GET') + ':' + url.pathname);
      if (url.hostname === 'api.vercel.com') {
        assert.equal(url.searchParams.get('teamId'), manifest.vercel.teamId);
        assert.equal(init.headers.Authorization, 'Bearer synthetic-vercel-auth');
        if (url.pathname.startsWith('/v2/teams/')) return { status: 200, body: { id: manifest.vercel.teamId,
          slug: manifest.vercel.teamSlug, billing: { plan: 'hobby' } } };
        if (url.pathname.startsWith('/v9/projects/')) return { status: 200, body: { id: manifest.vercel.projectId,
          accountId: manifest.vercel.teamId, framework: 'nextjs', ssoProtection: { deploymentType: 'all_except_custom_domains' },
          targets: { production: { target: 'production', id: 'dpl_productionFixture' } } } };
        if (init.method === 'PATCH') { assert.equal(state.open, false); events.push('revoke'); return { status: 200, body: {} }; }
        if (init.method === 'DELETE') { assert.equal(state.open, false); state.deleted = true; events.push('delete'); return { status: 200, body: {} }; }
        return { status: state.deleted ? 404 : 200, body: state.deleted ? null : deploy };
      }
      if (url.hostname === 'api.convex.dev') return { status: 200, body: backend.managementIdentity };
      if (url.pathname.endsWith('get_canonical_urls')) return { status: 200, body: { convexCloudUrl: backend.cloudUrl, convexSiteUrl: backend.siteUrl } };
      if (url.pathname.endsWith('list_usage_limits')) return { status: 200, body: { usageLimits: [
        { metric: 'functionCalls', window: 'day', limitType: 'disable', limit: 1000, enabled: true }] } };
      if (url.pathname.endsWith('get_current_usage')) return { status: 200, body: { metrics: { functionCalls: { usage: { current_day: 97 } } } } };
      throw Error('unexpected control fixture');
    },
    rpc: async call => {
      events.push('rpc:' + call.name);
      if (call.kind === 'mutation') state.mutationCalls++;
      if (call.name === 'operations:availability') { events.push(state.open ? 'confirm-open' : 'confirm-closed');
        return { readsEnabled: state.open, writesEnabled: state.open }; }
      if (call.name === 'operations:setAvailability') {
        state.open = call.args.readsEnabled; events.push(state.open ? 'open' : 'close');
        if (!state.open && options.uncertainClose) throw Error('closure uncertain');
        return { readsEnabled: state.open, writesEnabled: state.open };
      }
      if (call.name === 'attendance:viewer') {
        if (!state.open) throw { data: { status: 503 } };
        if (state.loggedOut) throw { data: { status: 401 } };
        return { expiresAt: time + 30 * 86400000 };
      }
      if (call.name === 'attendance:create') {
        if (options.failCreate) throw Error('fixture class failure');
        options.onCreate?.();
        return { id: call.args.newId, classId: 'syntheticClass' };
      }
      if (call.name === 'attendance:roster') return Array.from({ length: 5 }, (_, i) => ({ id: String(i), name: 'Next One' }));
      if (call.name === 'attendance:bucket') return state.checkins ? [{ studentId: '0', checkedInAt: '2030-01-01T00:00:01Z' }] : [];
      throw Error('unexpected rpc fixture');
    },
    transport: async (value, init) => {
      const url = new URL(value); events.push('http:' + init.method + ':' + url.pathname);
      assert.equal(state.exclusive, 1);
      if (url.origin === backend.siteUrl) {
        assert.equal(init.headers['x-vercel-protection-bypass'], undefined);
        return response({ error: 'Unauthorized.' }, 403);
      }
      assert.equal(url.origin, 'https://fixture.vercel.app');
      if (!init.headers['x-vercel-protection-bypass']) {
        assert.equal(init.redirect, 'manual'); return response(undefined, 307);
      }
      assert.equal(init.headers['x-vercel-protection-bypass'], manifest.access.token);
      if (init.headers.Origin === 'https://invalid.example') return response({ error: options.ingressError ? 'Access forbidden.' : 'Invalid origin.' }, 403);
      if ((init.body?.length ?? 0) > 4096) return response({ error: 'Request too large.' }, 413);
      if (init.body === '{') return response({ error: 'A valid JSON object is required.' }, 400);
      if (url.pathname === '/api/convex-auth') {
        if (init.method === 'GET') return response({ error: 'Invalid method.' }, 405);
        const body = JSON.parse(init.body);
        if (body.action === 'auth:signOut') {
          events.push('logout'); state.loggedOut = true;
          if (options.logoutUncertain) throw Error('uncertain logout');
          return response(null, 200, cookieLines(true));
        }
        assert.equal(state.open, true); return response({ tokens: { token: jwt, refreshToken: 'dummy' } }, 200, cookieLines());
      }
      if (url.pathname === '/api/convex/public') {
        if (init.method === 'PUT') return response(undefined, 405);
        if (!state.open) return response({ error: 'Attendance is temporarily unavailable.' }, 503);
        if (init.method === 'GET') return response({ title: 'Next hosted synthetic class', closed: false });
        const body = JSON.parse(init.body); assert.equal(body.identity, 'NXT01');
        state.checkins++;
        if (options.cancelAfterFirstCheckin && state.checkins === 1) process.emit('SIGTERM');
        return response({ name: 'Next One', ...(state.checkins > 1 ? { already: true } : {}) });
      }
      return response({});
    },
    adminPage: async (name, query, optionsValue) => {
      assert.equal(name, '_system/cli/tableData'); assert.equal(query.table, 'throttleCounters');
      assert.deepEqual(query.paginationOpts, { cursor: null, numItems: 100 }); assert.deepEqual(optionsValue, { componentPath: '' });
      if (options.noAdmin) throw Error('unsupported');
      const ip = options.spoofChangesCounter && state.checkins > 1 ? 'f'.repeat(64) : 'd'.repeat(64);
      return { isDone: true, page: state.checkins ? [{ key: `student:${ip}:${'c'.repeat(64)}`,
        count: state.checkins, bucket: 123 }] : [] };
    },
    createBrowser: async config => {
      const policy = createBrowserPolicy(config);
      const send = (path, method = 'GET', headers = {}, body) => {
        const request = { url: config.origin + path, method, headers, body };
        return config.send(request, policy(request));
      };
      await send('/api/convex-auth'); await send('/api/convex/public?id=' + config.legacyId);
      if (options.browserFault) { config.fatal('student_teacher_websocket'); throw Error('fixture blocked socket'); }
      const checkin = async headers => {
        const result = await send('/api/convex/public', 'POST', headers,
          JSON.stringify({ action: 'checkin', id: config.legacyId, identity: 'NXT01' }));
        return { status: result.status, body: JSON.parse(result.bytes) };
      };
      return { cookiesVerified: true, firstCheckin: () => checkin({}), duplicate: checkin,
        close: async () => { events.push('browser-close'); } };
    },
    persist: values => persistHostedReports(values, {
      write: async (path, content) => {
        persisted.set(path, content);
        if (options.cancelDuringPersistence && path.endsWith('hosted-next-verification.json')) process.emit('SIGTERM');
      }, writeSync: (path, content) => persisted.set(path, content),
    }),
  };
  return { manifest, backend, prior, state, events, persisted, dependencies,
    run: () => runHostedNext([...args, ...(options.continuation ? ['--continue-after', CONTINUATION.predecessorDeploymentId] : [])],
      { ATTENDANCE_PREVIEW_KEY_FILE: 'fixture-key-path', ATTENDANCE_VERCEL_AUTH_FILE: 'fixture-auth-path' }, dependencies) };
}

test('manifest binds source, exact ready deployment, expiring scoped access and publisher usage', () => {
  assert.equal(validateManifest(fixture(), expected, time), true);
  for (const change of [x => { x.publication = 'pending'; }, x => { x.vercel.target = 'production'; },
    x => { x.vercel.url += '?token=secret'; }, x => { x.backend.reference = 'production'; },
    x => { x.access.headerVerified = false; }, x => { x.access.expiresAt = new Date(time + 180000).toISOString(); },
    x => { x.counters.controlRequests = 21; }, x => { x.counters.hostingRequests = 3; },
    x => { x.counters.applicationCalls = 0; }, x => { x.runId = ''; },
    x => { x.environmentVerified.runtime = false; }]) {
    const bad = fixture(); change(bad); assert.throws(() => validateManifest(bad, expected, time));
  }
  assert.deepEqual(parseArgs(args), expected);
  assert.throws(() => parseArgs(['--expected-preview', expected.backendName]));
});

test('prior passed evidence is immutable input and cannot reset historical reservations', () => {
  assert.equal(validatePriorEvidence(priorFixture(), backendFixture(), fixture()).writes, 355);
  for (const field of ['fixtureWriteUpperReservations', 'studentGatewayCalls', 'sourceCommit']) {
    const prior = priorFixture(); prior[field] = 0;
    assert.throws(() => validatePriorEvidence(prior, backendFixture(), fixture()), /prior_backend_evidence/);
  }
  const prior = priorFixture(); prior.cleanup.availabilityClosed = false;
  assert.throws(() => validatePriorEvidence(prior, backendFixture(), fixture()));
});

test('budgets retain publisher call, prior writes and cleanup headroom with 130/180s deadlines', () => {
  let elapsed = 0;
  const budget = createBudget(fixture().counters, { now: () => elapsed });
  assert.equal(budget.snapshot().calls, 62); assert.equal(budget.snapshot().nextCalls, 1);
  for (const writes of [1, 64, 12, 48, 48, 48]) budget.reserve({ kind: 'application', writes });
  assert.equal(budget.snapshot().writes, 576);
  assert.throws(() => budget.reserve({ kind: 'application', writes: 25 }), /budget_exceeded/);
  budget.reserve({ kind: 'application', writes: 16, cleanup: true });
  budget.reserve({ kind: 'application', writes: 1, cleanup: true });
  assert.equal(budget.snapshot().writes, 593);
  for (let i = 0; i < 19; i++) budget.reserve({ kind: 'control' });
  assert.throws(() => budget.reserve({ kind: 'control' }), /budget_exceeded/);
  elapsed = 130000; assert.throws(() => budget.reserve({ kind: 'application' }), /deadline/);
  budget.reserve({ kind: 'application', cleanup: true });
  elapsed = 180000; assert.throws(() => budget.reserve({ kind: 'application', cleanup: true }), /deadline/);
  const calls = createBudget(fixture().counters);
  for (let i = 0; i < 39; i++) calls.reserve({ kind: 'application' });
  assert.throws(() => calls.reserve({ kind: 'application' }), /budget_exceeded/);
});

test('cookie checks inspect host-only HttpOnly Secure Lax lifetime and deletion attributes', () => {
  assert.equal(inspectAuthCookies(cookieLines()).token, jwt);
  assert.equal(inspectAuthCookies(cookieLines(true), { deleted: true }).deleted, true);
  for (const transform of [x => x.replace('; HttpOnly', ''), x => x.replace('; Secure', ''),
    x => x + '; Domain=fixture.vercel.app', x => x.replace('SameSite=Lax', 'SameSite=None'),
    x => x.replace('Path=/', 'Path=/api'), x => x.replace('Max-Age=2592000', 'Max-Age=0')]) {
    const lines = cookieLines(); lines[0] = transform(lines[0]); assert.throws(() => inspectAuthCookies(lines));
  }
  assert.throws(() => inspectAuthCookies(cookieLines(), { deleted: true }));
  assert.throws(() => assertPublicResponse({ name: 'Next One', roster: [] }, { kind: 'checkin', status: 200 }), /privacy/);
});

test('bounded fetch makes one attempt, forbids redirects, caps body and cancels oversized streams', async () => {
  let sends = 0, cancelled = false;
  const result = await boundedFetch('https://fixture.vercel.app', {}, { fetchImpl: async (_, init) => {
    sends++; assert.equal(init.redirect, 'error'); return new Response('{}');
  } });
  assert.equal(result.bytes.toString(), '{}'); assert.equal(sends, 1);
  await assert.rejects(boundedFetch('https://fixture.vercel.app', {}, { fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); }, cancel() { cancelled = true; },
  })) }), /response_size/);
  assert.equal(cancelled, true);
});

test('one-shot Convex HTTP client exercises pinned SDK with exact origin and private auth', async () => {
  const sent = [];
  const rpc = createOneShotRpc({ cloudUrl: fixture().backend.cloudUrl, adminKey: 'synthetic-admin', transport: async (url, init) => {
    sent.push(url); assert.equal(init.headers.Authorization, 'Convex synthetic-admin');
    return response({ status: 'success', value: { readsEnabled: false, writesEnabled: false }, logLines: [] });
  } });
  assert.deepEqual(await rpc({ kind: 'query', name: 'operations:availability', args: { fingerprint: FINGERPRINT }, admin: true }),
    { readsEnabled: false, writesEnabled: false });
  assert.equal(sent.length, 1); assert.equal(new URL(sent[0]).pathname, '/api/query');
});

test('browser allowlist admits only exact student requests and planned duplicates; rejects retry and exfiltration', () => {
  const config = { origin: 'https://fixture.vercel.app', legacyId: 'a'.repeat(32), deploymentId: 'dpl_fixture' };
  const policy = createBrowserPolicy(config);
  const req = { url: config.origin + '/?join=' + config.legacyId, method: 'GET' };
  assert.equal(policy(req).category, 'document'); assert.throws(() => policy(req), /retry/);
  assert.throws(() => policy({ url: 'https://example.com/steal', method: 'GET' }), /browser_target/);
  assert.throws(() => policy({ url: config.origin + '/api/convex-auth', method: 'POST', body: '{}' }), /unexpected_browser_request/);
  const post = { url: config.origin + '/api/convex/public', method: 'POST',
    body: JSON.stringify({ action: 'checkin', id: config.legacyId, identity: 'NXT01' }) };
  for (let i = 1; i <= 3; i++) assert.equal(policy(post).ordinal, i);
  assert.throws(() => policy(post), /retry/);
  assert.equal(policy({ url: config.origin + '/_vercel/insights/script.js', method: 'GET' }).stub, true);
});

// An in-memory Playwright surface exercises the actual harness. It starts no
// browser/server and all route responses are synthetic bounded byte buffers.
function browserFixture({ leakHttpOnly = false, failContext = false, failClose = false, hangEvaluation = false,
  readHeaders } = {}) {
  const origin = 'https://fixture.vercel.app', legacyId = 'a'.repeat(32);
  const contexts = [], sends = [], fatals = [], fulfilled = [];
  const observation = { blockedTeacherSockets: 0, stubbedTelemetry: 0 };
  const lifecycle = { launchOptions: null, closeCalls: 0 };
  const browser = {
    closed: false,
    async close() {
      lifecycle.closeCalls++;
      if (failClose) throw Error('fixture close failure');
      this.closed = true; for (const context of contexts) context.closed = true;
    },
    async newContext(options) {
      if (failContext) throw Error('fixture context creation failure');
      assert.deepEqual(options, { serviceWorkers: 'block', acceptDownloads: false });
      const context = {
        jar: [], closed: false,
        async routeWebSocket(pattern, callback) { assert.equal(pattern, '**/*'); this.wsRoute = callback; },
        async route(pattern, callback) { assert.equal(pattern, '**/*'); this.httpRoute = callback; },
        async addCookies(cookies) { this.jar = cookies.map(c => ({ ...c, path: '/', domain: 'fixture.vercel.app' })); },
        async cookies() { return this.jar; },
        async close() { this.closed = true; },
        async issue(url, method = 'GET', headers = {}, body = null, redirected = false) {
          let result, aborted = false;
          await this.httpRoute({
            request: () => ({ url: () => url, method: () => method, postData: () => body,
              redirectedFrom: () => redirected ? {} : null,
              allHeaders: async () => readHeaders ? readHeaders({ method, headers }) : headers }),
            fulfill: async value => { result = value; fulfilled.push(value); },
            abort: async () => { aborted = true; },
          });
          if (aborted) throw Error('fixture browser request aborted');
          assert(result); return result;
        },
        async newPage() {
          const owner = this;
          return {
            setDefaultTimeout(value) { assert(value > 0); },
            async goto(url) {
              await owner.issue(url);
              if (new URL(url).pathname === '/') {
                await owner.issue(origin + '/_next/static/chunks/synthetic.js');
                await owner.issue(origin + '/_vercel/insights/script.js');
                await owner.issue(origin + '/api/convex/public?id=' + legacyId);
              }
            },
            async evaluate(_fn, value) {
              if (hangEvaluation) return new Promise(() => {});
              if (!value) return leakHttpOnly ? authNames : [];
              const result = await owner.issue(origin + '/api/convex/public', 'POST',
                { 'Content-Type': 'application/json', ...value.headers },
                JSON.stringify({ action: 'checkin', id: value.id, identity: 'NXT01' }));
              return { status: result.status, body: JSON.parse(result.body) };
            },
            getByLabel(label) {
              assert.equal(label, 'Full name or student ID');
              return { waitFor: async () => {}, fill: async value => assert.equal(value, 'NXT01') };
            },
            getByRole(role, options) {
              return role === 'button' ? { click: async () => {
                assert.equal(options.name, 'Check me in');
                await owner.issue(origin + '/api/convex/public', 'POST', { 'Content-Type': 'application/json' },
                  JSON.stringify({ action: 'checkin', id: legacyId, identity: 'NXT01' }));
              } } : { waitFor: async () => assert.equal(options.name, 'You’re all set.') };
            },
          };
        },
      };
      contexts.push(context); return context;
    },
  };
  let checkins = 0;
  const config = { origin, legacyId, deploymentId: 'dpl_fixture', cookies: { token: jwt, refresh: 'synthetic-refresh' },
    timeout: () => 1000, fatal: value => fatals.push(value), observation,
    launch: async options => { lifecycle.launchOptions = options; return browser; },
    send: async (request, admission) => {
      sends.push({ request, admission });
      const result = admission.key === 'cookieProbe' ? response({ error: 'Invalid method.' }, 405) :
        admission.key === 'metadata' ? response({ title: 'Next hosted synthetic class', closed: false }) :
        admission.key === 'checkin' ? response({ name: 'Next One', ...(++checkins > 1 ? { already: true } : {}) }) : response({});
      result.headers.set('Content-Encoding', 'gzip'); result.headers.set('Content-Length', '999'); return result;
    },
  };
  return { browser, contexts, sends, fatals, observation, fulfilled, config, lifecycle };
}

test('actual browser harness isolates teacher cookies, gates routes and completes exactly three planned check-ins offline', async () => {
  const fixture = browserFixture(); const browser = await createBrowserHarness(fixture.config);
  assert.equal(browser.cookiesVerified, true); assert.equal(fixture.contexts.length, 2);
  assert.equal(fixture.contexts[0].closed, true); assert.equal(fixture.contexts[1].jar.length, 0);
  await browser.firstCheckin();
  await browser.duplicate({ 'x-forwarded-for': '198.51.100.71' });
  await browser.duplicate({ 'x-vercel-forwarded-for': '203.0.113.82' });
  assert.equal(fixture.sends.filter(x => x.admission.key === 'checkin').length, 3);
  assert.equal(fixture.sends.filter(x => x.admission.key === 'cookieProbe').length, 1);
  assert.equal(fixture.observation.stubbedTelemetry, 1);
  assert(!fixture.sends.some(x => x.request.url.includes('/_vercel/')));
  assert(fixture.fulfilled.every(x => !x.headers?.['content-encoding'] && !x.headers?.['content-length']));
  assert.deepEqual(fixture.fatals, []);
  await browser.close(); assert.equal(fixture.browser.closed, true); assert.equal(fixture.contexts[1].closed, true);
});

test('actual browser route blocks foreign origins and every websocket without sending private access', async () => {
  const fixture = browserFixture(); const browser = await createBrowserHarness(fixture.config);
  const student = fixture.contexts[1], initialSends = fixture.sends.length;
  await assert.rejects(student.issue('https://outside.example/steal'), /aborted/);
  assert.equal(fixture.sends.length, initialSends); assert(fixture.fatals.includes('browser_target'));
  let socketClosed = false;
  student.wsRoute({ close() { socketClosed = true; } });
  assert.equal(socketClosed, true); assert.equal(fixture.observation.blockedTeacherSockets, 1);
  assert(fixture.fatals.includes('student_teacher_websocket'));
  await browser.close();
});

test('actual browser harness fails and closes the browser when Javascript can see an auth cookie', async () => {
  const fixture = browserFixture({ leakHttpOnly: true });
  await assert.rejects(createBrowserHarness(fixture.config), /http_only_javascript_visibility/);
  assert.equal(fixture.browser.closed, true); assert.equal(fixture.contexts.length, 1);
});

test('admin observation uses installed CLI shape, refuses partial pages and compares ephemeral identity deltas', async () => {
  let queries = 0;
  assert.deepEqual(await readAdminTable(async (name, argsValue, opts) => {
    queries++; assert.equal(name, '_system/cli/tableData'); assert.equal(argsValue.paginationOpts.numItems, 100);
    assert.equal(opts.componentPath, ''); return { isDone: true, page: [] };
  }, 'throttleCounters'), []);
  assert.equal(queries, 1);
  await assert.rejects(readAdminTable(async () => ({ isDone: false, page: [], continueCursor: 'private' }), 'throttleCounters'), /partial/);
  const snapshot = countValue => counterSnapshot(countValue ? [{ key: `student:${'d'.repeat(64)}:${'c'.repeat(64)}`, bucket: 1, count: countValue }] : [], 'a'.repeat(32));
  assert.equal(compareIpObservations([0, 1, 2, 3].map(snapshot)).status, 'verified');
  assert.throws(() => compareIpObservations([0, 1, 1, 3].map(snapshot)), /ambiguous/);
});

test('admin transport counts registration, blocks second connection and exposes replay rather than reconnecting', async () => {
  const observation = { connections: 0, blockedReconnects: 0, registrations: 0, callbacks: 0, sentBytes: 0 };
  const fatal = [], messages = []; let reserved = 0;
  class Socket extends EventEmitter {
    constructor() { super(); } send(value) { messages.push(value); } terminate() {} close() {}
  }
  class Client {
    constructor(url, callback, opts) {
      this.callback = callback; this.options = opts;
      this.socket = new opts.webSocketConstructor(url.replace('https:', 'wss:') + '/api/1.49.0/sync');
    }
    setAdminAuth() {}
    subscribe() {
      this.socket.send(JSON.stringify({ type: 'ModifyQuerySet', modifications: [{ type: 'Add' }] }));
      queueMicrotask(() => { new this.options.webSocketConstructor('wss://fixture-preview-123.convex.cloud/api/1.49.0/sync'); });
      return { unsubscribe() {} };
    }
    async close() {} localQueryResultByToken() { return {}; }
  }
  const read = createAdminReader({ cloudUrl: fixture().backend.cloudUrl, adminKey: 'synthetic-admin',
    timeout: () => 100, reserve: () => reserved++, observation, fatal: code => fatal.push(code), Client, Socket });
  await assert.rejects(read('_system/cli/tableData', {}, { componentPath: '' }), /admin_reconnect/);
  assert.equal(reserved, 1); assert.equal(observation.connections, 1); assert.equal(observation.blockedReconnects, 1);
  assert.equal(observation.registrations, 1); assert.equal(messages.length, 1); assert.deepEqual(fatal, ['admin_reconnect']);
});

test('complete offline fixture exercises real orchestration, bounded cleanup and safe artifact without services', async () => {
  const run = offlineRun(); const report = await run.run();
  assert.equal(report.passed, true); assert.equal(report.functionalFlowCompleted, true);
  assert.equal(report.counters.writes, 593); assert.equal(report.counters.calls, 61 + report.counters.nextCalls);
  assert.equal(report.counters.control, 1 + 20 + report.counters.runnerControl);
  assert.equal(report.browser.checkinRequests, 3); assert.equal(report.ipProvenance.status, 'verified');
  assert.equal(report.negativeProbes.length, 8); assert.equal(report.cleanup.sessionRevocationVerified, true);
  assert.equal(report.cleanup.convexDeleted, false); assert.equal(run.state.exclusive, 1);
  assert(run.events.indexOf('exclusive') < run.events.indexOf('open'));
  assert(run.events.indexOf('close') < run.events.lastIndexOf('confirm-closed'));
  assert(run.events.lastIndexOf('confirm-closed') < run.events.indexOf('revoke'));
  assert(run.events.indexOf('revoke') < run.events.indexOf('delete'));
  const artifact = run.persisted.get('docs/measurements/hosted-next-verification.json');
  for (const privateValue of [jwt, 'synthetic-bypass', 'synthetic-refresh', 'synthetic-admin-capability',
    '198.51.100.71', '203.0.113.82', 'd'.repeat(64), 'c'.repeat(64)]) assert(!artifact.includes(privateValue));
  assert.equal(JSON.parse(artifact).passed, true);
});

test('missing bounded admin observable produces honest unverified result while full flow and closure still execute', async () => {
  const run = offlineRun({ noAdmin: true }); const report = await run.run();
  assert.equal(report.passed, false); assert.equal(report.functionalFlowCompleted, true);
  assert.equal(report.ipProvenance.status, 'unverified'); assert.equal(report.cleanup.availabilityClosed, true);
  assert.equal(report.cleanup.vercelDeleted, true); assert.equal(report.counters.writes, 593);
});

test('failure after signup prioritizes closure and confirmation before optional logout and exact deployment deletion', async () => {
  const run = offlineRun({ failCreate: true }); const report = await run.run();
  assert.equal(report.passed, false); assert.equal(report.cleanup.logoutConfirmed, true);
  assert.equal(report.cleanup.sessionRevocationVerified, false);
  assert(run.events.indexOf('close') < run.events.indexOf('logout'));
  assert(run.events.lastIndexOf('confirm-closed') < run.events.indexOf('logout'));
  assert.equal(run.state.open, false); assert.equal(run.state.deleted, true);
});

test('uncertain logout is never repeated, uncertain closure stays failed after independent confirmation', async () => {
  const logout = offlineRun({ logoutUncertain: true }); const failed = await logout.run();
  assert.equal(failed.passed, false); assert.equal(logout.events.filter(x => x === 'logout').length, 1);
  assert.equal(failed.cleanup.availabilityClosed, true);
  const close = offlineRun({ uncertainClose: true }); const closed = await close.run();
  assert.equal(closed.passed, false); assert.equal(closed.cleanup.closureMutationUncertain, true);
  assert.equal(closed.cleanup.availabilityClosed, true); assert.equal(close.events.filter(x => x === 'close').length, 1);
});

test('exclusive attempt refusal prevents every provider request and mutation', async () => {
  const run = offlineRun({ existing: true }); await assert.rejects(run.run(), /EEXIST/);
  assert.deepEqual(run.events, ['exclusive']); assert.equal(run.state.mutationCalls, 0); assert.equal(run.persisted.size, 0);
});

test('counter changes under a forged header fail provenance and still leave backend closed', async () => {
  const run = offlineRun({ spoofChangesCounter: true }); const report = await run.run();
  assert.equal(report.passed, false); assert.equal(report.failedPhase, 'isolated student browser');
  assert.equal(report.cleanup.availabilityClosed, true); assert.equal(report.cleanup.logoutConfirmed, true);
});

test('cancellation during async artifact persistence repairs both snapshots using proven finalization', async () => {
  const run = offlineRun({ cancelDuringPersistence: true }); const report = await run.run();
  assert.equal(report.cancelled, true); assert.equal(report.passed, false);
  for (const [path, text] of run.persisted) {
    const artifact = JSON.parse(text), stored = path.endsWith('/next-runtime-attempt.json') ? artifact.report : artifact;
    assert.equal(stored.cancelled, true); assert.equal(stored.passed, false);
  }
});

test('ingress JSON with the same status cannot masquerade as an application origin denial', async () => {
  const run = offlineRun({ ingressError: true }); const report = await run.run();
  assert.equal(report.passed, false); assert.equal(report.failureKind, 'negative_probe_application_identity');
  assert.equal(run.state.mutationCalls, 0); assert.equal(report.cleanup.availabilityClosed, true);
});

test('ordinary deadline leaves cleanup time for closure, confirmation and best-effort logout', async () => {
  let elapsed = 0;
  const run = offlineRun({ elapsed: () => elapsed, onCreate: () => { elapsed = 130000; } });
  const report = await run.run();
  assert.equal(report.passed, false); assert.equal(report.cleanup.availabilityClosed, true);
  assert.equal(report.cleanup.logoutConfirmed, true); assert.equal(report.cleanup.vercelDeleted, true);
  assert(run.events.indexOf('close') < run.events.indexOf('logout'));
});

test('cancellation during workload stops ordinary sends but preserves closure-first cleanup', async () => {
  const run = offlineRun({ cancelAfterFirstCheckin: true }); const report = await run.run();
  assert.equal(report.cancelled, true); assert.equal(report.passed, false);
  assert.equal(run.state.checkins, 1); assert.equal(report.cleanup.availabilityClosed, true);
  assert.equal(report.cleanup.logoutConfirmed, true); assert.equal(report.cleanup.vercelDeleted, true);
  assert(run.events.indexOf('close') < run.events.indexOf('logout'));
});

test('real browser-harness launch receives a bounded timeout and no competing Playwright signal handlers', async () => {
  const f=browserFixture();let owner,contextsAtOwnership;
  f.config.onOwned=value=>{owner=value;contextsAtOwnership=f.contexts.length;};
  const handle=await createBrowserHarness(f.config);
  assert.deepEqual(f.lifecycle.launchOptions,{headless:true,timeout:1000,handleSIGINT:false,handleSIGTERM:false,handleSIGHUP:false});
  assert.equal(contextsAtOwnership,0);assert.equal(typeof owner.close,'function');
  await handle.close();await owner.close();
  assert.equal(f.lifecycle.closeCalls,1);assert.equal(f.observation.closeConfirmed,true);
});

test('browser operations time out and cancellation stops an active unbounded promise', async () => {
  await assert.rejects(browserOperation(()=>new Promise(()=>{}),10),/operation_timeout/);
  const abort=new AbortController();
  await assert.rejects(browserOperation(()=>{
    queueMicrotask(()=>abort.abort());return new Promise(()=>{});
  },1000,abort.signal),/browser_cancelled/);
  let sent=0;
  await assert.rejects(boundedFetch('https://fixture.vercel.app',{}, {signal:abort.signal,fetchImpl:async(_,init)=>{
    sent++;assert.equal(init.signal.aborted,true);throw init.signal.reason;
  }}));
  assert.equal(sent,1);
});

test('an unbounded page evaluation is interrupted and closes the owned browser once', async () => {
  const f=browserFixture({hangEvaluation:true});f.config.timeout=()=>10;
  let owner;f.config.onOwned=value=>{owner=value;};
  await assert.rejects(createBrowserHarness(f.config),/operation_timeout/);
  assert.equal(f.browser.closed,true);assert.equal(f.observation.closeConfirmed,true);
  await owner.close();assert.equal(f.lifecycle.closeCalls,1);
});

test('initialization failure plus browser-close failure remains uncertain while backend closure still runs', async () => {
  const run=offlineRun(), f=browserFixture({failContext:true,failClose:true});
  run.dependencies.createBrowser=config=>createBrowserHarness({...f.config,...config});
  const report=await run.run();
  assert.equal(report.passed,false);assert.equal(report.cleanup.browserClosed,false);
  assert.equal(report.cleanup.browserClosureUncertain,true);
  assert.equal(report.browser.closeUncertain,true);assert.equal(f.lifecycle.closeCalls,1);
  assert.equal(report.cleanup.availabilityClosed,true);assert.equal(report.cleanup.vercelDeleted,true);
  assert(run.events.indexOf('close')<run.events.indexOf('logout'));
});

test('stalled launch cannot spend the cleanup window and a late handle is still closed', async () => {
  let elapsed=0, release, options;
  const pending=new Promise(resolve=>{release=resolve;});
  const run=offlineRun({elapsed:()=>elapsed}), f=browserFixture();
  run.dependencies.createBrowser=config=>{
    elapsed=129980;
    return createBrowserHarness({...f.config,...config,launch:async value=>{options=value;return pending;}});
  };
  const report=await run.run();
  assert(options.timeout<=20);assert.equal(options.handleSIGINT,false);
  assert.equal(report.passed,false);assert.equal(report.cleanup.availabilityClosed,true);
  assert.equal(run.state.open,false);assert(run.events.includes('close'));
  assert.equal(report.cleanup.browserClosed,false);assert.equal(report.cleanup.browserClosureUncertain,true);
  release(f.browser);await new Promise(done=>setImmediate(done));await new Promise(done=>setImmediate(done));
  assert.equal(f.browser.closed,true);assert.equal(f.lifecycle.closeCalls,1);
});

test('unbounded duplicate evaluation is stopped before cleanup and availability closure', async () => {
  let elapsed=0;
  const run=offlineRun({elapsed:()=>elapsed});const original=run.dependencies.createBrowser;
  run.dependencies.createBrowser=async config=>{
    const handle=await original(config), first=handle.firstCheckin;
    handle.firstCheckin=async()=>{await first();elapsed=129980;};
    handle.duplicate=()=>new Promise(()=>{});return handle;
  };
  const report=await run.run();
  assert.equal(report.passed,false);assert.equal(run.state.checkins,1);
  assert.equal(report.cleanup.availabilityClosed,true);assert.equal(report.cleanup.browserClosed,true);
  assert.equal(report.cleanup.vercelDeleted,true);assert(run.events.indexOf('close')<run.events.indexOf('logout'));
});

test('signal cancellation during actual harness initialization preserves teardown and backend closure', async () => {
  const run=offlineRun(), f=browserFixture();
  run.dependencies.createBrowser=config=>createBrowserHarness({...f.config,...config,launch:async options=>{
    assert.equal(options.handleSIGINT,false);assert.equal(options.handleSIGTERM,false);
    queueMicrotask(()=>process.emit('SIGINT'));return f.browser;
  }});
  const report=await run.run();
  assert.equal(report.cancelled,true);assert.equal(report.passed,false);
  assert.equal(report.cleanup.availabilityClosed,true);assert.equal(report.cleanup.vercelDeleted,true);
  assert.equal(f.browser.closed,true);assert.equal(f.lifecycle.closeCalls,1);
});

test('runner owns SIGHUP too when Playwright signal handling is disabled', async () => {
  const before=process.listenerCount('SIGHUP'),run=offlineRun(),f=browserFixture();
  run.dependencies.createBrowser=config=>createBrowserHarness({...f.config,...config,launch:async options=>{
    assert.equal(options.handleSIGHUP,false);queueMicrotask(()=>process.emit('SIGHUP'));return f.browser;
  }});
  const report=await run.run();
  assert.equal(report.cancelled,true);assert.equal(report.cleanup.availabilityClosed,true);
  assert.equal(report.cleanup.vercelDeleted,true);assert.equal(report.passed,false);
  assert.equal(process.listenerCount('SIGHUP'),before);
});

for (const stop of ['signal', 'fatal']) {
  test(`browser send boundary rejects queued check-in during ${stop} cleanup`, async () => {
    const run = offlineRun();
    let queued = 0, rejected = 0;
    run.dependencies.createBrowser = async config => ({
      cookiesVerified: true,
      firstCheckin: () => new Promise(() => {
        queueMicrotask(() => {
          run.events.push('stop');
          if (stop === 'signal') process.emit('SIGTERM');
          else config.fatal('fixture_fatal');
        });
      }),
      close: async () => {
        // A route already waiting for headers resumes while cleanup owns the
        // shared transport. It must retain its ordinary-work restrictions.
        queued++;
        await assert.rejects(config.send({ url: config.origin + '/api/convex/public', method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'checkin', id: config.legacyId, identity: 'NXT01' }),
        }, { category: 'api', key: 'checkin', ordinal: 1, gateway: true, writes: 48 }), /browser_stopped/);
        rejected++;
        run.events.push('browser-close');
      },
    });
    const report = await run.run();
    assert.equal(queued, 1); assert.equal(rejected, 1);
    assert.equal(run.state.checkins, 0);
    assert.equal(report.browser.checkinRequests, 0);
    assert.equal(report.passed, false); assert.equal(report.cancelled, stop === 'signal');
    assert.equal(report.cleanup.browserClosed, true);
    assert.equal(report.cleanup.availabilityClosed, true);
    assert.equal(report.cleanup.logoutConfirmed, true);
    assert.equal(report.cleanup.vercelDeleted, true);
    assert(run.events.indexOf('stop') < run.events.indexOf('browser-close'));
    assert(run.events.indexOf('browser-close') < run.events.indexOf('close'));
  });
}

test('browser route rechecks cancellation after its header read settles', async () => {
  const abort = new AbortController();
  const fixture = browserFixture({ readHeaders: ({ method, headers }) => {
    if (method === 'POST') {
      // Let the header operation settle, then stop before its caller dispatches.
      const result = Promise.resolve(headers);
      result.then(() => queueMicrotask(() => queueMicrotask(() => abort.abort())));
      return result;
    }
    return headers;
  } });
  fixture.config.signal = abort.signal;
  const browser = await createBrowserHarness(fixture.config);
  await assert.rejects(browser.firstCheckin(), /browser_cancelled|browser_stopped/);
  await new Promise(done => setImmediate(done));
  assert.equal(fixture.sends.filter(x => x.admission.key === 'checkin').length, 0);
  await browser.close();
  assert.equal(fixture.observation.closeConfirmed, true);
});

test('browser route cannot send when teardown completes during its header read', async () => {
  let browser;
  const fixture = browserFixture({ readHeaders: async ({ method, headers }) => {
    if (method === 'POST') await browser.close();
    return headers;
  } });
  browser = await createBrowserHarness(fixture.config);
  await assert.rejects(browser.firstCheckin(), /browser_stopped|browser request aborted/);
  assert.equal(fixture.sends.filter(x => x.admission.key === 'checkin').length, 0);
  assert.equal(fixture.observation.closeConfirmed, true);
  assert.equal(fixture.lifecycle.closeCalls, 1);
});

test('continuation runtime budget starts at63 calls, two Next calls and all prior controls without spending the margin', () => {
  const counters = { controlRequests: 20, hostingRequests: 2, applicationCalls: 1 };
  const budget = createBudget(counters, { continuation: CONTINUATION });
  assert.deepEqual(budget.snapshot(), { calls: 63, writes: 355, gateway: 7, control: 37, hosting: 2,
    nextCalls: 2, nextGateway: 0, runnerControl: 0, creations: 2 });
  for (let i = 0; i < 19; i++) budget.reserve({ kind: 'control' });
  assert.equal(budget.snapshot().control, 56);
  assert.throws(() => budget.reserve({ kind: 'control' }), /budget_exceeded/);
  for (let i = 0; i < 38; i++) budget.reserve({ kind: 'application' });
  assert.equal(budget.snapshot().nextCalls, 40); assert.equal(budget.snapshot().calls, 101);
  assert.throws(() => budget.reserve({ kind: 'application' }), /budget_exceeded/);
  const altered = structuredClone(CONTINUATION); altered.spent.calls = 61;
  assert.throws(() => createBudget(counters, { continuation: altered }), /continuation_snapshot/);
});

test('continuation runner validates its new manifest and history, persists separate records and preserves cleanup', async () => {
  const run = offlineRun({ continuation: true });
  const report = await run.run();
  assert.equal(report.passed, true); assert.deepEqual(report.continuation, CONTINUATION);
  assert.equal(report.bounds.control, 60); assert.equal(report.bounds.cumulativeCreations, 2);
  assert.equal(report.counters.creations, 2);
  assert.equal(report.counters.calls, 61 + report.counters.nextCalls);
  assert.equal(report.counters.control, 17 + 20 + report.counters.runnerControl);
  assert.equal(report.counters.writes, 593); assert.equal(report.cleanup.availabilityClosed, true);
  assert.equal(report.cleanup.vercelDeleted, true);
  assert(run.persisted.has(CONTINUATION_PATHS.attempt)); assert(run.persisted.has(CONTINUATION_PATHS.evidence));
  assert([...run.persisted.keys()].every(path => !Object.values(ORIGINAL_PATHS).includes(path)));
  const sent = run.events.length;
  await assert.rejects(run.run(), /continuation_record_exists/);
  assert.deepEqual(run.events.slice(sent), []);
});

for (const options of [{ corruptHistory: true }, { originalRuntimeExists: true },
  { mutateHistory: x => { x.cleanup.deploymentDeleted = false; } },
  { mutateContinuation: x => { x.continuation.spent.controls = 1; } },
  { mutateContinuation: x => { x.cumulative.calls = 62; } },
  { mutatePublication: x => { x.passed = false; } },
  { mutatePublication: x => { x.cumulative.controls = 1; } },
  { mutatePublication: x => { x.counters.controlRequests = 0; } },
  { mutatePublication: x => { x.deploymentId = 'dpl_other'; } },
  { mutateContinuation: x => { delete x.continuation; } }])
  test('continuation runner rejects missing, changed or underreported history before workload or records', async () => {
    const run = offlineRun({ continuation: true, ...options });
    await assert.rejects(run.run());
    assert.deepEqual(run.events, []); assert.equal(run.state.exclusive, 0); assert.equal(run.persisted.size, 0);
  });

test('continuation mode cannot be downgraded or chained to a third deployment selector', () => {
  const current = fixture(); current.continuation = structuredClone(CONTINUATION);
  assert.throws(() => validateManifest(current, expected, time), /continuation_mode_required/);
  assert.throws(() => parseArgs([...args, '--continue-after', 'dpl_fixture']));
  assert.throws(() => parseArgs([...args, '--continue-after', CONTINUATION.predecessorDeploymentId,
    '--continue-after', CONTINUATION.predecessorDeploymentId]));
  assert.deepEqual(parseArgs([...args, '--continue-after', CONTINUATION.predecessorDeploymentId]),
    { ...expected, continuation: true });
});
