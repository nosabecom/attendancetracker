import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { watch } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProductionReconciliation, reconciliationBinding, retainReconciliationFailure, ReconciliationError,
  RECONCILIATION_LIMITS, RECONCILIATION_HEADROOM } from '../scripts/reconcile-production-import.mjs';
import { PRODUCTION_TARGET } from '../scripts/execute-production-import.mjs';
import { RECONCILIATION_TABLE_COUNTS as counts } from '../scripts/reconcile-production-records.mjs';

// Entirely fictional input, key, records, evidence, clock, and transport.
const SECRET = 'FICTIONAL_PRIVATE_SENTINEL';
const instant = '2026-11-10T23:00:00.000Z', now = () => Date.parse(instant);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const code = { commit: 'a'.repeat(40), digest: 'b'.repeat(64) };
const binding = { readerDigest: 'c'.repeat(64), comparatorDigest: 'd'.repeat(64) };
const source = { rawSha256: sha(SECRET), contentFingerprint: 'e'.repeat(64), manifestDigest: 'f'.repeat(64) };

async function harness(t) {
  const parent = await mkdtemp(join(tmpdir(), 'offline-production-reconciliation-'));
  await chmod(parent, 0o700); t.after(() => rm(parent, { recursive: true, force: true }));
  const ledger = join(parent, 'ledger'); await mkdir(ledger, { mode: 0o700 });
  const input = join(parent, 'frozen.json'), planPath = join(parent, 'plan.json'), key = join(parent, 'key');
  await writeFile(input, SECRET, { mode: 0o600 }); await writeFile(key, SECRET, { mode: 0o600 });
  const reviewed = { reviewed: true, evidenceDigest: '1'.repeat(64) };
  const plan = { formatVersion: 1, allocation: 'PRODUCTION_RECONCILIATION1', target: { ...PRODUCTION_TARGET },
    source: { ...source }, code: { ...code }, ...binding, ledgerDirectory: ledger, budgets: { ...RECONCILIATION_LIMITS }, gates: {
      source: { ...reviewed, continuousHold: true },
      import: { ...reviewed, applicationCalls: 36, verificationCalls: 21, logicalWrites: 755, phase: 'active-readonly' },
      capability: { ...reviewed, rawSha256: sha(SECRET) },
      quota: { ...reviewed, team: PRODUCTION_TARGET.team, plan: 'CONVEX_BASE', source: 'convex-dashboard-user-report',
        observedAt: instant, allProjects: true, timezone: 'UTC',
        billingPeriod: { start: '2026-11-04T00:00:00.000Z', end: '2026-12-01T00:00:00.000Z' },
        resources: Object.fromEntries(Object.entries(RECONCILIATION_HEADROOM).map(([metric, amount]) =>
          [metric, { used: 0, limit: metric === 'functionCalls' ? amount + 100 : amount * 2 }])) },
    } };
  const savePlan = () => writeFile(planPath, JSON.stringify(plan), { mode: 0o600 }); await savePlan();
  const canonical = { fictional: SECRET }, reports = [], requests = [], server = {
    checkpoint: { runId: 'opaque-provider-document-id', phase: 'active', nextChunk: 7, table: 19 },
    availability: { readsEnabled: true, writesEnabled: false },
  };
  const tables = Object.fromEntries(Object.entries(counts).map(([table, n]) => [table,
    Array.from({ length: n }, (_, i) => ({ _id: `${table}:${i}`, value: SECRET }))]));
  let intercept, compared = 0;
  const reservations = async () => Promise.all((await readdir(ledger)).filter(n => n.startsWith('reservation-')).sort()
    .map(n => readFile(join(ledger, n), 'utf8').then(JSON.parse)));
  const transport = async (url, init) => {
    const envelope = init.method === 'POST' ? JSON.parse(init.body) : undefined;
    const entry = { url, init, fn: envelope?.path ?? 'canonical', args: envelope?.args[0] };
    requests.push(entry);
    assert.equal(init.redirect, 'error'); assert.equal(init.headers.authorization, `Convex ${SECRET}`);
    assert.equal(url, `${PRODUCTION_TARGET.cloudUrl}${init.method === 'POST' ? '/api/query' : '/api/v1/get_canonical_urls'}`);
    assert.ok(['GET', 'POST'].includes(init.method));
    const retained = await reservations();
    assert.equal(retained.length, requests.length); assert.equal(retained.at(-1).ordinal, requests.length);
    assert.equal((await lstat(join(ledger, `reservation-${String(requests.length).padStart(6, '0')}.json`))).mode & 0o777, 0o400);
    const respond = () => {
      let value;
      if (entry.fn === 'canonical') return new Response(JSON.stringify({ convexCloudUrl: PRODUCTION_TARGET.cloudUrl, convexSiteUrl: PRODUCTION_TARGET.siteUrl }));
      assert.equal(envelope.format, 'convex_encoded_json');
      if (entry.fn === 'migration:status') {
        assert.deepEqual(entry.args, { fingerprint: source.contentFingerprint, manifestDigest: source.manifestDigest }); value = server.checkpoint;
      } else if (entry.fn === 'operations:availability') {
        assert.deepEqual(entry.args, { fingerprint: source.contentFingerprint }); value = server.availability;
      } else {
        assert.equal(entry.fn, '_system/cli/tableData');
        assert.deepEqual(entry.args, { table: entry.args.table, order: 'asc', paginationOpts: { numItems: counts[entry.args.table] + 1, cursor: null } });
        value = { page: tables[entry.args.table], isDone: true, continueCursor: '' };
      }
      return new Response(JSON.stringify({ status: 'success', value, logLines: [SECRET] }));
    };
    return intercept ? intercept(entry, respond) : respond();
  };
  const dependencies = { markerParent: parent, now, transport, report: value => reports.push(value),
    describeSource: raw => { assert.equal(raw.toString(), SECRET); return { source, canonical }; },
    sourceBinding: async () => code, reconciliationBinding: async () => binding,
    comparator: { RECONCILIATION_TABLE_COUNTS: counts, reconcileProductionRecords: (actualSource, actualTables) => {
      compared++; assert.equal(actualSource, canonical); assert.deepEqual(actualTables, tables); return { ok: true, counts };
    } },
  };
  const args = () => ['--input', input, '--plan', planPath, '--key-file', key, '--ledger', plan.ledgerDirectory, '--apply'];
  return { parent, ledger, input, planPath, key, plan, savePlan, reports, requests, server, tables, dependencies, args, reservations,
    compared: () => compared, intercept: fn => { intercept = fn; },
    run: overrides => runProductionReconciliation(args(), { ...dependencies, ...overrides }),
    stopped: async () => JSON.parse(await readFile(join(plan.ledgerDirectory, 'stopped.json'), 'utf8')),
  };
}
async function rejectsCode(promise, code) {
  await assert.rejects(promise, error => error instanceof ReconciliationError && error.code === code && !error.message.includes(SECRET));
}
async function modifyResponse(respond, modify) {
  const response = respond(), body = await response.json(); modify(body); return new Response(JSON.stringify(body));
}

test('default execution is offline and does not access key, plan, code bindings, client transport, or ledger state', async t => {
  const h = await harness(t); await rm(h.key); await rm(h.planPath);
  const result = await runProductionReconciliation(['--input', h.input, '--key-file', h.key, '--plan', h.planPath], {
    ...h.dependencies, sourceBinding: () => assert.fail('Offline code access'), reconciliationBinding: () => assert.fail('Offline code access'),
    transport: () => assert.fail('Offline network access'), markerParent: join(h.parent, 'absent'),
  });
  assert.deepEqual(result, { dryRun: true, requests: 0, queries: 0, writes: 0 });
  assert.deepEqual(await readdir(h.ledger), []); assert.equal(h.requests.length, 0); assert.equal(h.compared(), 0);
});

test('one allocation reserves exactly 17 requests and 15 queries in the fixed read-only sequence', async t => {
  const h = await harness(t), result = await h.run();
  assert.deepEqual(result, { reconciled: true, counts, requests: 17, queries: 15, writes: 0, atomicSnapshot: false });
  assert.equal(h.compared(), 1); assert.deepEqual(h.requests.map(r => r.fn), ['canonical', 'migration:status', 'operations:availability',
    ...Object.keys(counts).map(() => '_system/cli/tableData'), 'operations:availability', 'migration:status', 'canonical']);
  assert.deepEqual(h.requests.filter(r => r.fn === '_system/cli/tableData').map(r => r.args.table), Object.keys(counts));
  const retained = await h.reservations(); assert.deepEqual(retained.at(-1), { ordinal: 17, method: 'GET', kind: 'canonical', requests: 17, queries: 15, writes: 0 });
  assert.equal(JSON.stringify(h.reports).includes(SECRET), false);
  for (const value of Object.values(source)) assert.equal(JSON.stringify(h.reports).includes(value), false);
  for (const name of await readdir(h.ledger)) assert.equal((await lstat(join(h.ledger, name))).mode & 0o777, 0o400);
  for (const table of Object.keys(counts)) assert.deepEqual(JSON.parse(await readFile(join(h.ledger, `table-${table}.json`), 'utf8')).page, h.tables[table]);
  assert.equal(JSON.parse(await readFile(join(h.ledger, 'receipt.json'), 'utf8')).stoppedRecordInvalidatesReceipt, true);
  await rejectsCode(h.run(), 'allocation_already_used'); assert.equal(h.requests.length, 17);
});

test('wrong source, target, code, evidence gates, budgets and quota stop before key access or reservation', async t => {
  for (const [label, mutate, error] of [
    ['target', p => { p.target.cloudUrl = 'https://wrong.invalid'; }, 'target_mismatch'],
    ['source', p => { p.source.rawSha256 = '0'.repeat(64); }, 'source_mismatch'],
    ['code', p => { p.code.commit = '0'.repeat(40); }, 'code_mismatch'],
    ['reader', p => { p.readerDigest = '0'.repeat(64); }, 'code_mismatch'],
    ['comparator', p => { p.comparatorDigest = '0'.repeat(64); }, 'code_mismatch'],
    ['budget', p => { p.budgets.requests++; }, 'allocation_mismatch'],
    ['hold', p => { p.gates.source.continuousHold = false; }, 'source_gate'],
    ['import', p => { p.gates.import.logicalWrites++; }, 'import_gate'],
    ['review', p => { p.gates.capability.reviewed = false; }, 'plan_gates'],
    ['evidence', p => { p.gates.import.evidenceDigest = SECRET; }, 'plan_gates'],
    ['stale quota', p => { p.gates.quota.observedAt = '2026-11-09T22:59:59.999Z'; }, 'quota_stale'],
    ['future quota', p => { p.gates.quota.observedAt = '2026-11-10T23:05:00.001Z'; }, 'quota_stale'],
    ['all projects', p => { p.gates.quota.allProjects = false; }, 'quota_period'],
    ['period', p => { p.gates.quota.billingPeriod.end = instant; }, 'quota_period'],
    ['headroom', p => { p.gates.quota.resources.functionCalls.limit = 16; }, 'quota_headroom'],
  ]) await t.test(label, async t => {
    const h = await harness(t); mutate(h.plan); await h.savePlan(); await rm(h.key);
    await rejectsCode(h.run(), error); assert.equal(h.requests.length, 0); assert.deepEqual(await readdir(h.ledger), []);
  });
});

test('capability digest, raw key bytes and private file modes are checked before spending', async t => {
  for (const [label, mutate, error] of [
    ['digest', async h => { h.plan.gates.capability.rawSha256 = '0'.repeat(64); await h.savePlan(); }, 'capability_mismatch'],
    ['newline', h => writeFile(h.key, `${SECRET}\n`), 'capability_mismatch'],
    ['readonly key', h => chmod(h.key, 0o400), 'key_mode'],
    ['public ledger', h => chmod(h.ledger, 0o755), 'private_directory'],
    ['public parent', h => chmod(h.parent, 0o755), 'reconciliation_failed'],
    ['key alias', async h => { await rm(h.key); await symlink(h.input, h.key); }, 'key_mode'],
  ]) await t.test(label, async t => {
    const h = await harness(t); await mutate(h); await rejectsCode(h.run(), error); assert.equal(h.requests.length, 0);
  });
});

test('fixed parent and distinct source, plan, key and ledger paths are mandatory', async t => {
  const h = await harness(t);
  const values = h.args(); values[values.indexOf('--key-file') + 1] = h.input;
  await rejectsCode(runProductionReconciliation(values, h.dependencies), 'private_paths_conflict');
  await rejectsCode(h.run({ markerParent: join(h.parent, 'different') }), 'private_paths_conflict');
  assert.equal(h.requests.length, 0);
});

test('403, redirects, malformed replies and transport exceptions are spent once and never disclose provider errors', async t => {
  for (const [label, respond, error] of [
    ['403', () => new Response(SECRET, { status: 403 }), 'request_failed'],
    ['redirect', () => new Response(SECRET, { status: 302, headers: { location: 'https://wrong.invalid' } }), 'request_failed'],
    ['JSON', () => new Response(SECRET), 'invalid_json'],
    ['transport', () => { throw new Error(SECRET); }, 'request_failed'],
    ['headers', () => new Response('{}', { headers: { 'x-private': SECRET.repeat(400) } }), 'response_headers'],
    ['declared body', () => new Response('{}', { headers: { 'content-length': String(4 * 1024 * 1024 + 1) } }), 'response_limit'],
    ['streamed body', () => new Response('x'.repeat(4 * 1024 * 1024 + 1)), 'response_limit'],
  ]) await t.test(label, async t => {
    const h = await harness(t); h.intercept(respond); await rejectsCode(h.run(), error);
    assert.equal(h.requests.length, 1); assert.equal((await h.reservations()).length, 1);
    assert.equal((await h.stopped()).code, error); assert.deepEqual(h.reports, []);
    await assert.rejects(readFile(join(h.ledger, 'receipt.json')), { code: 'ENOENT' });
  });
});

test('canonical identity, active checkpoint and read-only availability must match before any table reads', async t => {
  for (const [label, fn, modify, error] of [
    ['identity', 'canonical', body => { body.convexCloudUrl = 'https://wrong.invalid'; }, 'canonical_mismatch'],
    ['phase', 'migration:status', body => { body.value.phase = 'verified'; }, 'checkpoint_invalid'],
    ['checkpoint', 'migration:status', body => { body.value.nextChunk = 6; }, 'checkpoint_invalid'],
    ['table', 'migration:status', body => { body.value.table = 18; }, 'checkpoint_invalid'],
    ['id', 'migration:status', body => { body.value.runId = ''; }, 'checkpoint_invalid'],
    ['reads', 'operations:availability', body => { body.value.readsEnabled = false; }, 'read_only_not_confirmed'],
    ['writes', 'operations:availability', body => { body.value.writesEnabled = true; }, 'read_only_not_confirmed'],
    ['provider error', 'migration:status', body => { body.status = 'error'; body.errorMessage = SECRET; }, 'request_failed'],
  ]) await t.test(label, async t => {
    const h = await harness(t); h.intercept((entry, respond) => entry.fn === fn ? modifyResponse(respond, modify) : respond());
    await rejectsCode(h.run(), error); assert.equal(h.requests.some(r => r.fn === '_system/cli/tableData'), false); assert.deepEqual(h.reports, []);
  });
});

test('exact complete single pages accept only documented optional pagination shapes', async t => {
  for (const optional of [{ splitCursor: null, pageStatus: null }, { splitCursor: 'opaque-cursor', pageStatus: 'SplitRecommended' }]) {
    const h = await harness(t); h.intercept((entry, respond) => entry.fn === '_system/cli/tableData'
      ? modifyResponse(respond, body => Object.assign(body.value, optional)) : respond());
    assert.equal((await h.run()).reconciled, true); assert.equal(h.requests.length, 17);
  }
});

test('partial, extra, duplicate or unsupported pages stop without fetching a second page', async t => {
  for (const [label, modify] of [
    ['not done', value => { value.isDone = false; }], ['short', value => { value.page.pop(); }],
    ['extra', value => { value.page.push({ _id: 'extra' }); }], ['duplicate', value => { value.page[1]._id = value.page[0]._id; }],
    ['split required', value => { value.pageStatus = 'SplitRequired'; value.splitCursor = 'opaque'; }],
    ['unknown status', value => { value.pageStatus = SECRET; }], ['unknown field', value => { value.secret = SECRET; }],
    ['invalid split', value => { value.splitCursor = 42; }], ['missing cursor', value => { delete value.continueCursor; }],
  ]) await t.test(label, async t => {
    const h = await harness(t); h.intercept((entry, respond) => entry.fn === '_system/cli/tableData'
      ? modifyResponse(respond, body => modify(body.value)) : respond());
    await rejectsCode(h.run(), 'page_invalid'); assert.equal(h.requests.length, 4); assert.equal(h.compared(), 0);
    assert.equal((await h.stopped()).requests, 4); assert.deepEqual(h.reports, []);
    assert.equal((await lstat(join(h.ledger, 'table-users.json'))).mode & 0o777, 0o400);
  });
});

test('final availability, checkpoint and canonical identity are rechecked before comparison', async t => {
  for (const [label, fn, modify, error] of [
    ['writes changed', 'operations:availability', b => { b.value.writesEnabled = true; }, 'read_only_not_confirmed'],
    ['run changed', 'migration:status', b => { b.value.runId = 'another-opaque-id'; }, 'checkpoint_invalid'],
    ['identity changed', 'canonical', b => { b.convexSiteUrl = 'https://wrong.invalid'; }, 'canonical_mismatch'],
  ]) await t.test(label, async t => {
    const h = await harness(t); h.intercept((entry, respond) => entry.fn === fn && h.requests.filter(r => r.fn === fn).length === 2
      ? modifyResponse(respond, modify) : respond());
    await rejectsCode(h.run(), error); assert.equal(h.compared(), 0); assert.deepEqual(h.reports, []);
  });
});

test('record mismatch and changed source or reader code invalidate the completed read set', async t => {
  const h = await harness(t);
  await rejectsCode(h.run({ comparator: { RECONCILIATION_TABLE_COUNTS: counts,
    reconcileProductionRecords: () => { throw new Error(SECRET); } } }), 'records_mismatch');
  assert.equal(h.requests.length, 17); assert.deepEqual(h.reports, []);
  for (const name of ['sourceBinding', 'reconciliationBinding']) await t.test(name, async t => {
    const h = await harness(t); let checks = 0;
    await rejectsCode(h.run({ [name]: async () => ++checks === 1 ? (name === 'sourceBinding' ? code : binding) : {} }), 'code_mismatch');
    assert.equal(h.requests.length, 17); assert.deepEqual(h.reports, []);
  });
});

test('request deadlines include both waiting for headers and reading the body', async t => {
  for (const phase of ['headers', 'body']) await t.test(phase, async t => {
    const h = await harness(t); h.intercept(() => phase === 'headers' ? new Promise(() => {})
      : new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); } })));
    await rejectsCode(h.run({ timeoutMs: 20 }), 'request_timeout');
    assert.equal(h.requests.length, 1); assert.equal((await h.stopped()).requests, 1); assert.deepEqual(h.reports, []);
  });
});

test('cancellation before dispatch, during transport, and before finalization never produces success', async t => {
  for (const phase of ['before', 'transport', 'finalization']) await t.test(phase, async t => {
    const h = await harness(t), controller = new AbortController();
    if (phase === 'before') controller.abort();
    if (phase === 'transport') h.intercept(() => { controller.abort(); return new Promise(() => {}); });
    await rejectsCode(h.run({ signal: controller.signal, ...(phase === 'finalization' ? { beforeFinalize: () => controller.abort() } : {}) }), 'cancelled');
    assert.equal(h.requests.length, phase === 'before' ? 0 : phase === 'transport' ? 1 : 17); assert.deepEqual(h.reports, []);
    if (phase !== 'before') assert.equal((await h.stopped()).code, 'cancelled');
    await assert.rejects(readFile(join(h.ledger, 'receipt.json')), { code: 'ENOENT' });
  });
});

test('permanent parent allocation marker prevents a fresh ledger from resetting failed or completed spending', async t => {
  for (const success of [false, true]) await t.test(String(success), async t => {
    const h = await harness(t); if (!success) h.intercept(() => new Response(SECRET, { status: 403 }));
    if (success) await h.run(); else await rejectsCode(h.run(), 'request_failed');
    const spent = h.requests.length, marker = (await readdir(h.parent)).find(n => n.startsWith('production-'));
    assert.equal((await lstat(join(h.parent, marker))).mode & 0o777, 0o400);
    await rename(h.ledger, join(h.parent, 'preserved-ledger')); await mkdir(h.ledger, { mode: 0o700 });
    await rejectsCode(h.run(), 'reconciliation_failed'); assert.equal(h.requests.length, spent); assert.deepEqual(await readdir(h.ledger), []);
    const other = join(h.parent, 'other-ledger'); await mkdir(other, { mode: 0o700 }); h.plan.ledgerDirectory = other; await h.savePlan();
    await rejectsCode(h.run(), 'reconciliation_failed'); assert.equal(h.requests.length, spent); assert.deepEqual(await readdir(other), []);
  });
});

test('cancellation during asynchronous receipt persistence invalidates its receipt with a private failed marker', async t => {
  const h = await harness(t), controller = new AbortController();
  const watcher = watch(h.ledger, (event, name) => { if (String(name) === 'receipt.json') controller.abort(); });
  t.after(() => watcher.close());
  await rejectsCode(h.run({ signal: controller.signal }), 'cancelled');
  assert.equal((await h.stopped()).code, 'cancelled'); assert.deepEqual(h.reports, []);
  assert.equal((await lstat(join(h.ledger, 'stopped.json'))).mode & 0o777, 0o400);
});

test('failed async marker has an independent synchronous exclusive fallback, and total storage failure stays failed', async t => {
  const h = await harness(t), record = { code: 'cancelled', requests: 17, queries: 15, writes: 0 };
  await retainReconciliationFailure(h.ledger, record, { asyncWrite: async (directory, name) => {
    await writeFile(join(directory, name), '{', { flag: 'wx', mode: 0o400 }); throw new Error(SECRET);
  } });
  assert.deepEqual(JSON.parse(await readFile(join(h.ledger, 'stopped-sync.json'), 'utf8')), record);
  assert.equal((await lstat(join(h.ledger, 'stopped-sync.json'))).mode & 0o777, 0o400);
  await rejectsCode(retainReconciliationFailure(h.ledger, record, { asyncWrite: async () => { throw new Error(SECRET); },
    syncWrite: () => { throw new Error(SECRET); } }), 'failure_record_unavailable');
});

test('reader and comparator bindings hash the actual public scripts', async () => {
  const actual = await reconciliationBinding();
  assert.equal(actual.readerDigest, sha(await readFile(new URL('../scripts/reconcile-production-import.mjs', import.meta.url))));
  assert.equal(actual.comparatorDigest, sha(await readFile(new URL('../scripts/reconcile-production-records.mjs', import.meta.url))));
});
