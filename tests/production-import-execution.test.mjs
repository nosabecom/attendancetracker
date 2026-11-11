import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, chmod, writeFile, readFile, readdir, rm, lstat, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { runProductionImport, describeSource, sourceBinding, PRODUCTION_TARGET, LIMITS,
  QUOTA_HEADROOM, ProductionImportError } from '../scripts/execute-production-import.mjs';

// Fictional public fixtures only; no preserved export, provider, browser, or key.
const sha = value => createHash('sha256').update(value).digest('hex');
const instant = '2026-11-10T23:00:00.000Z';
const now = () => Date.parse(instant);
const SENTINEL = 'NEVER_PRINT_PRIVATE_PRODUCTION_SENTINEL';
const RUN = 'j'.repeat(32);

function fixture() {
  const blobs = [];
  const add = (pathname, value) => blobs.push({ pathname, uploadedAt: instant, value });
  const roster = letter => Array.from({ length: 44 }, (_, i) => ({ id: `${letter}${i}`, name: `Fictional ${letter} ${i}`, code: `${letter}${i}` }));
  const a = roster('a'), b = roster('b'), c = roster('c');
  for (let i = 0; i < 3; i++) {
    const username = `fiction.owner${i}`;
    add(`auth/accounts/${sha(username)}.json`, { owner: `owner-${i}`, username, salt: '1'.repeat(32), passwordHash: '2'.repeat(128) });
  }
  const ids = Array.from({ length: 7 }, (_, i) => String(i + 1).repeat(32));
  for (let i = 0; i < 7; i++) {
    add(`sessions/${ids[i]}.json`, { id: ids[i], classId: i < 4 ? ids[0] : ids[4],
      owner: `owner-${i < 4 ? 0 : 1}`, title: 'Fictional class', createdAt: instant,
      students: i < 2 ? a : i < 4 ? b : c });
  }
  add(`classes/${ids[0]}/versions/0000000001.json`, { revision: 1, students: b,
    teachers: [{ owner: 'owner-2', username: 'fiction.owner2' }] });
  add(`closed/${ids[0]}.json`, { at: instant });
  for (let i = 0; i < 198; i++) {
    const session = Math.floor(i / 44), students = session < 2 ? a : session < 4 ? b : c;
    add(`checks/${ids[session]}/${students[i % 44].id}.json`, { at: instant });
  }
  while (blobs.length < 298) add(`auth/attempts/ip/${sha('fictional-ip')}/100/${blobs.length.toString(16).padStart(24, '0')}.json`, {});
  return { formatVersion: 1, exportedAt: instant, blobs };
}

async function harness(t, { verifyPages = 21 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'offline-production-import-'));
  await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const ledger = join(directory, 'ledger'); await mkdir(ledger, { mode: 0o700 });
  const input = join(directory, 'frozen.json'), manifestPath = join(directory, 'ready.json'), key = join(directory, 'key');
  const raw = Buffer.from(JSON.stringify(fixture()));
  await writeFile(input, raw, { mode: 0o600 }); await writeFile(key, SENTINEL, { mode: 0o600 });
  const { source, plan } = describeSource(raw), code = await sourceBinding();
  const reviewed = { reviewed: true, evidenceDigest: 'a'.repeat(64) };
  const manifest = { formatVersion: 1, allocation: 'PRODUCTION_IMPORT1', target: { ...PRODUCTION_TARGET },
    source, code, ledgerDirectory: ledger, budgets: { ...LIMITS }, gates: {
      source: { ...reviewed, continuousHold: true, reconciled: true },
      identity: { ...reviewed, target: { ...PRODUCTION_TARGET } },
      publication: { ...reviewed, codeDigest: code.digest, atomicReadOnlyActivation: true },
      quota: { ...reviewed, team: PRODUCTION_TARGET.team, plan: 'CONVEX_BASE', source: 'convex-dashboard-user-report',
        observedAt: instant, allProjects: true, timezone: 'UTC',
        billingPeriod: { start: '2026-11-04T00:00:00.000Z', end: '2026-12-01T00:00:00.000Z' },
        resources: Object.fromEntries(Object.entries(QUOTA_HEADROOM).map(([metric, amount]) =>
          [metric, { used: 0, limit: metric === 'functionCalls' ? amount + 100 : amount * 2 }])) },
    } };
  await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
  const reports = [], requests = [], server = { begun: false, nextChunk: 0, phase: 'import', table: 0,
    verifyCalls: 0, readsEnabled: false, writesEnabled: false, activated: 0 };
  const state = table => ({ runId: RUN, phase: server.phase, nextChunk: server.nextChunk,
    ...(table ? { table: server.table } : {}) });
  const evaluate = (fn, args) => {
    switch (fn) {
      case 'migration:initialize': return null;
      case 'migration:begin':
        assert.equal(args.fingerprint, source.contentFingerprint); assert.equal(args.manifestDigest, source.manifestDigest);
        server.begun = true; return state(false);
      case 'migration:status':
        assert.equal(server.begun, true); assert.equal(args.fingerprint, source.contentFingerprint);
        assert.equal(args.manifestDigest, source.manifestDigest); return state(true);
      case 'migration:stage':
        assert.equal(args.runId, RUN); assert.equal(args.ordinal, server.nextChunk);
        assert.deepEqual(args.operations, plan.chunks[args.ordinal]); server.nextChunk++; return { nextChunk: server.nextChunk };
      case 'migration:freeze':
        assert.equal(args.runId, RUN); assert.equal(server.nextChunk, 7);
        if (server.phase === 'import') server.phase = 'verify'; return { phase: server.phase };
      case 'migration:verifyNext':
        assert.equal(args.runId, RUN); server.verifyCalls++;
        server.table = Math.floor(Math.min(server.verifyCalls / verifyPages, 1) * 19);
        if (server.verifyCalls >= verifyPages) server.phase = 'verified';
        return { phase: server.phase, table: server.table };
      case 'migration:activate':
        assert.deepEqual(args, { runId: RUN, readOnly: true }); assert.equal(server.phase, 'verified');
        server.phase = 'active'; server.readsEnabled = true; server.writesEnabled = false; server.activated++;
        return { phase: 'active' };
      case 'operations:setAvailability':
        assert.deepEqual(args, { fingerprint: source.contentFingerprint, readsEnabled: true, writesEnabled: false });
        assert.equal(server.phase, 'active'); server.readsEnabled = true; server.writesEnabled = false;
        return { readsEnabled: true, writesEnabled: false };
      case 'operations:availability': return { readsEnabled: server.readsEnabled, writesEnabled: server.writesEnabled };
      default: assert.fail('Unexpected function dispatch');
    }
  };
  let intercept;
  const transport = async (url, init) => {
    assert.equal(url, `${PRODUCTION_TARGET.cloudUrl}/api/${JSON.parse(init.body).path === 'migration:status' || JSON.parse(init.body).path === 'operations:availability' ? 'query' : 'mutation'}`);
    assert.equal(init.redirect, 'error'); assert.equal(init.headers.authorization, `Convex ${SENTINEL}`);
    const envelope = JSON.parse(init.body), args = envelope.args[0];
    const entry = { fn: envelope.path, args, init }; requests.push(entry);
    // Every actual SDK fetch already has its durable, private immutable ticket.
    const reservations = (await readdir(ledger)).filter(n => n.startsWith('reservation-')).sort();
    const latest = join(ledger, reservations.at(-1));
    assert.equal((await lstat(latest)).mode & 0o777, 0o400);
    assert.equal(JSON.parse(await readFile(latest)).ordinal, requests.length);
    const respond = () => new Response(JSON.stringify({ status: 'success', value: evaluate(entry.fn, args), logLines: [SENTINEL] }));
    return intercept ? intercept(entry, respond) : respond();
  };
  const args = (phase = 'stage', resume = false) => ['--input', input, '--manifest', manifestPath, '--key-file', key,
    '--ledger', ledger, '--apply', '--phase', phase, ...(resume ? ['--resume'] : [])];
  return { directory, ledger, input, key, manifest, manifestPath, raw, source, code, reports, requests, server, args,
    intercept: fn => { intercept = fn; },
    saveManifest: () => writeFile(manifestPath, JSON.stringify(manifest)),
    run: (phase = 'stage', resume = false, dependencies = {}) => runProductionImport(args(phase, resume),
      { now, transport, report: value => reports.push(value), ...dependencies }),
    reservations: async () => Promise.all((await readdir(ledger)).filter(n => n.startsWith('reservation-')).sort()
      .map(n => readFile(join(ledger, n), 'utf8').then(JSON.parse))),
  };
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, error => error instanceof ProductionImportError && error.code === code && !error.message.includes(SENTINEL));
}

test('module import and default dry-run do not create a client, access a key, or dispatch', async t => {
  const h = await harness(t);
  await rm(h.key);
  const result = await runProductionImport(['--input', h.input, '--key-file', h.key], {
    transport: () => assert.fail('Dry-run must be offline'), report: value => h.reports.push(value),
  });
  assert.equal(result.dryRun, true); assert.equal(result.chunks, 7); assert.equal(result.targetDocuments, 357);
  assert.deepEqual(await readdir(h.ledger), []); assert.equal(h.requests.length, 0);
  assert.equal(JSON.stringify(h.reports).includes(h.source.contentFingerprint), false);
  assert.equal(JSON.stringify(h.reports).includes(h.source.rawSha256), false);
});

test('frozen bytes, exact target, code, publication and quota gates reject before key access or RPC', async t => {
  for (const [label, mutate, code] of [
    ['raw digest', m => { m.source.rawSha256 = 'b'.repeat(64); }, 'frozen_manifest_mismatch'],
    ['fingerprint', m => { m.source.contentFingerprint = 'b'.repeat(64); }, 'frozen_manifest_mismatch'],
    ['chunk count', m => { m.source.chunkDocuments.pop(); }, 'frozen_manifest_mismatch'],
    ['target', m => { m.target.cloudUrl = 'https://other.convex.cloud'; }, 'target_mismatch'],
    ['site', m => { m.target.siteUrl = 'https://other.convex.site'; }, 'target_mismatch'],
    ['code', m => { m.code.digest = 'b'.repeat(64); }, 'source_code_mismatch'],
    ['publication', m => { m.gates.publication.atomicReadOnlyActivation = false; }, 'publication_gate'],
    ['stale quota', m => { m.gates.quota.observedAt = '2026-11-09T22:59:59.999Z'; }, 'quota_stale'],
    ['future quota', m => { m.gates.quota.observedAt = '2026-11-10T23:05:00.001Z'; }, 'quota_stale'],
    ['call headroom', m => { m.gates.quota.resources.functionCalls.limit = 54; }, 'quota_headroom'],
    ['project filter', m => { m.gates.quota.allProjects = false; }, 'quota_period'],
    ['old period', m => { m.gates.quota.billingPeriod.end = instant; }, 'quota_period'],
    ['timezone', m => { m.gates.quota.timezone = 'America/Regina'; }, 'quota_period'],
    ['write allocation', m => { m.budgets.logicalWrites++; }, 'allocation_mismatch'],
  ]) await t.test(label, async t => {
    const h = await harness(t); mutate(h.manifest); await h.saveManifest(); await rm(h.key);
    await rejectsCode(h.run(), code); assert.equal(h.requests.length, 0); assert.deepEqual(await readdir(h.ledger), []);
  });
});

test('stage, verify and activation are explicit, atomic read-only, and cumulatively reserved', async t => {
  const h = await harness(t);
  const staged = await h.run();
  assert.equal(staged.phase, 'staged'); assert.equal(h.server.nextChunk, 7); assert.equal(h.server.verifyCalls, 0);
  assert.deepEqual(staged.reserved, { applicationCalls: 9, verificationCalls: 0, logicalWrites: 730 });
  await rejectsCode(h.run('verify'), 'resume_required');
  const verified = await h.run('verify', true);
  assert.equal(verified.phase, 'verified'); assert.equal(h.server.activated, 0); assert.equal(h.server.writesEnabled, false);
  const start = h.requests.length;
  const active = await h.run('activate-readonly', true);
  assert.equal(active.phase, 'active-readonly');
  assert.deepEqual(h.requests.slice(start).map(r => r.fn), ['migration:status', 'migration:activate', 'operations:setAvailability', 'operations:availability']);
  assert.equal(h.server.readsEnabled, true); assert.equal(h.server.writesEnabled, false);
  assert.deepEqual(active.reserved, { applicationCalls: 36, verificationCalls: 21, logicalWrites: 755 });
  const resumed = await h.run('activate-readonly', true);
  assert.equal(h.server.activated, 1); assert.equal(resumed.reserved.applicationCalls, 39);
  assert.equal(h.requests.filter(r => r.args.writesEnabled === true).length, 0);
  assert.equal(JSON.stringify(h.reports).includes(SENTINEL), false);
  for (const value of [h.source.rawSha256, h.source.contentFingerprint, h.source.manifestDigest, h.code.digest])
    assert.equal(JSON.stringify(h.reports).includes(value), false);
});

test('lost staging response is spent; resume reads server checkpoint and skips the committed chunk', async t => {
  const h = await harness(t); let lost = false;
  h.intercept((entry, respond) => {
    const response = respond();
    if (entry.fn === 'migration:stage' && !lost) { lost = true; throw new Error(SENTINEL); }
    return response;
  });
  await rejectsCode(h.run(), 'backend_request_failed'); assert.equal(h.server.nextChunk, 1);
  assert.equal(h.reports.length, 0);
  h.intercept(undefined);
  const result = await h.run('stage', true);
  assert.equal(result.phase, 'staged'); assert.equal(result.reserved.applicationCalls, 11);
  assert.equal(result.reserved.logicalWrites, 732);
  assert.deepEqual(h.requests.filter(r => r.fn === 'migration:stage').map(r => r.args.ordinal), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(h.requests.slice(3, 5).map(r => r.fn), ['migration:initialize', 'migration:begin']);
  const failed = JSON.parse(await readFile(join(h.ledger, 'outcome-000001.json')));
  assert.equal(failed.status, 'failed'); assert.equal(failed.totals.applicationCalls, 3);
});

test('a lost initialize or begin response resumes using idempotent server bootstrap', async t => {
  for (const fn of ['migration:initialize', 'migration:begin']) await t.test(fn, async t => {
    const h = await harness(t); let lost = false;
    h.intercept((entry, respond) => {
      if (entry.fn === fn && !lost) { lost = true; throw new Error(SENTINEL); }
      return respond();
    });
    await rejectsCode(h.run(), 'backend_request_failed'); assert.equal(h.server.begun, false);
    h.intercept(undefined);
    const result = await h.run('stage', true); assert.equal(result.phase, 'staged');
    assert.equal(result.reserved.applicationCalls, fn === 'migration:initialize' ? 10 : 11);
    assert.equal(result.reserved.logicalWrites, fn === 'migration:initialize' ? 731 : 732);
    assert.equal(h.requests.filter(r => r.fn === 'migration:stage').length, 7);
  });
});

test('verification dispatch 41 is denied across resumes, including an uncertain committed response', async t => {
  const h = await harness(t, { verifyPages: 80 }); await h.run(); let lost = false;
  h.intercept((entry, respond) => {
    const response = respond();
    if (entry.fn === 'migration:verifyNext' && h.server.verifyCalls === 20 && !lost) { lost = true; throw new Error(SENTINEL); }
    return response;
  });
  await rejectsCode(h.run('verify', true), 'backend_request_failed'); assert.equal(h.server.verifyCalls, 20);
  h.intercept(undefined);
  await rejectsCode(h.run('verify', true), 'budget_exceeded');
  assert.equal(h.server.verifyCalls, 40);
  const reservations = await h.reservations();
  assert.equal(reservations.filter(r => r.function === 'migration:verifyNext').length, 40);
  assert.equal(reservations.at(-1).totals.applicationCalls, 53);
  assert.equal(reservations.at(-1).totals.logicalWrites, 772);
  assert.equal(h.requests[31].fn, 'migration:status');
  // Another resume consumes status/freeze margin without granting another page.
  await rejectsCode(h.run('verify', true), 'budget_exceeded');
  assert.equal(h.server.verifyCalls, 40); assert.equal(h.requests.length, 55);
});

test('application-call cap rejects the next RPC before transport', async t => {
  const h = await harness(t); await h.run(); await h.run('verify', true); await h.run('activate-readonly', true);
  for (let i = 0; i < 6; i++) await h.run('activate-readonly', true);
  assert.equal(h.requests.length, 54);
  await rejectsCode(h.run('activate-readonly', true), 'budget_exceeded');
  assert.equal(h.requests.length, 55);
  const r = await h.reservations(); assert.equal(r.at(-1).function, 'migration:status');
  assert.equal(r.at(-1).totals.verificationCalls, 21); assert.ok(r.at(-1).totals.logicalWrites < 774);
});

test('uncertain uncommitted chunk remains spent and the write cap stops before another RPC', async t => {
  const h = await harness(t); let failed = false;
  h.intercept((entry, respond) => {
    if (entry.fn === 'migration:stage' && entry.args.ordinal === 4 && !failed) { failed = true; throw new Error(SENTINEL); }
    return respond();
  });
  await rejectsCode(h.run(), 'backend_request_failed'); assert.equal(h.server.nextChunk, 4);
  h.intercept(undefined);
  await rejectsCode(h.run('stage', true), 'budget_exceeded');
  assert.equal(h.server.nextChunk, 5);
  const r = await h.reservations();
  assert.equal(r.at(-1).function, 'migration:stage'); assert.equal(r.at(-1).chunkOrdinal, 4);
  assert.equal(r.at(-1).totals.logicalWrites, 708); assert.equal(h.requests.length, 10);
});

test('a different dataset, code, or ledger path cannot rebind a spent allocation', async t => {
  const h = await harness(t); await h.run(); const count = h.requests.length;
  const changed = fixture(); changed.blobs[0].value.passwordHash = '3'.repeat(128);
  const bytes = Buffer.from(JSON.stringify(changed)); await writeFile(h.input, bytes);
  h.manifest.source = describeSource(bytes).source; await h.saveManifest(); await rm(h.key);
  await rejectsCode(h.run('verify', true), 'allocation_binding_mismatch'); assert.equal(h.requests.length, count);
  await writeFile(h.input, h.raw); h.manifest.source = h.source; h.manifest.code.commit = 'd'.repeat(40); await h.saveManifest();
  await rejectsCode(h.run('verify', true), 'source_code_mismatch');
  h.manifest.code = await sourceBinding(); await h.saveManifest();
  const alternate = join(h.directory, 'alternate'); await mkdir(alternate, { mode: 0o700 });
  const argv = h.args('verify', true); argv[argv.indexOf('--ledger') + 1] = alternate;
  await rejectsCode(runProductionImport(argv, { now, transport: () => assert.fail('No dispatch') }), 'allocation_mismatch');
  assert.deepEqual(await readdir(alternate), []);
});

test('fresh quota evidence can change on resume without resetting reservations', async t => {
  const h = await harness(t); await h.run();
  h.manifest.gates.quota.evidenceDigest = 'c'.repeat(64); h.manifest.gates.quota.observedAt = '2026-11-10T22:59:00.000Z';
  h.manifest.gates.quota.source = 'convex-dashboard-agent-observation';
  await h.saveManifest(); const result = await h.run('verify', true);
  assert.equal(result.reserved.applicationCalls, 32); assert.equal(result.reserved.logicalWrites, 752);
});

test('concurrent resume fails with the existing lock; cancellation settles as failed before unlocking', async t => {
  const h = await harness(t), controller = new AbortController();
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  h.intercept((entry, respond) => {
    entered();
    return new Promise((resolve, reject) => entry.init.signal.addEventListener('abort', () => reject(new Error(SENTINEL)), { once: true }));
  });
  const active = h.run('stage', false, { signal: controller.signal });
  await started;
  await rejectsCode(h.run('stage', true), 'ledger_locked');
  controller.abort(); await rejectsCode(active, 'cancelled');
  assert.equal(h.requests.length, 1); assert.equal((await readdir(h.ledger)).includes('LOCK'), false);
  const out = JSON.parse(await readFile(join(h.ledger, 'outcome-000001.json')));
  assert.equal(out.status, 'failed'); assert.equal(out.code, 'cancelled'); assert.equal(out.totals.applicationCalls, 1);
});

test('explicit offline recovery proves a crashed owner dead, retains its request, and resumes the same allocation', async t => {
  const h = await harness(t);
  const moduleUrl = new URL('../scripts/execute-production-import.mjs', import.meta.url).href;
  const code = `import { runProductionImport } from ${JSON.stringify(moduleUrl)};
    const keepAlive = setInterval(() => {}, 1000);
    await runProductionImport(process.argv.slice(1), { now: () => ${now()},
      transport: async () => { process.stdout.write('reserved\\n'); return new Promise(() => {}); }, report: () => {} });
    clearInterval(keepAlive);`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', code, '--', ...h.args()], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const output = await once(child.stdout, 'data'); assert.equal(output[0].toString(), 'reserved\n');
  const lock = JSON.parse(await readFile(join(h.ledger, 'LOCK'))); assert.equal(lock.owner.pid, child.pid);
  const recoverArgs = ['--input', h.input, '--manifest', h.manifestPath, '--ledger', h.ledger, '--recover-interrupted', '--resume'];
  await rejectsCode(runProductionImport(recoverArgs, { now, report: () => assert.fail('Owner still live') }), 'recovery_owner_live');
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  const original = await readFile(join(h.ledger, 'reservation-000001.json'));
  const reports = [];
  const result = await runProductionImport(recoverArgs, { now, report: value => reports.push(value),
    transport: () => assert.fail('Recovery is offline') });
  assert.equal(result.recovered, true); assert.equal(result.reserved.applicationCalls, 1);
  assert.deepEqual(await readFile(join(h.ledger, 'reservation-000001.json')), original);
  const failed = JSON.parse(await readFile(join(h.ledger, 'outcome-000001.json')));
  assert.equal(failed.status, 'failed'); assert.equal(failed.code, 'interrupted_process');
  assert.equal((await readdir(h.ledger)).includes('LOCK'), false);
  assert.equal((await readdir(h.ledger)).includes('recovery-000001.json'), true);
  // The first physical request occurred in the child; its spent ticket remains.
  h.requests.push({ fn: 'migration:initialize', args: {} });
  const resumed = await h.run('stage', true);
  assert.equal(resumed.reserved.applicationCalls, 10); assert.equal(resumed.reserved.logicalWrites, 731);
  assert.equal(JSON.stringify(reports).includes(SENTINEL), false);
});

test('torn and out-of-sequence reservation history fail closed before a resumed dispatch', async t => {
  for (const mode of ['torn', 'sequence']) await t.test(mode, async t => {
    const h = await harness(t); await h.run();
    if (mode === 'torn') {
      const path = join(h.ledger, 'reservation-000003.json'); await chmod(path, 0o600); await writeFile(path, '{"ordinal":');
    } else await rename(join(h.ledger, 'reservation-000003.json'), join(h.ledger, 'reservation-000099.json'));
    const previous = h.requests.length;
    await rejectsCode(h.run('verify', true), mode === 'torn' ? 'invalid_private_json' : 'ledger_sequence');
    assert.equal(h.requests.length, previous); assert.equal((await readdir(h.ledger)).includes('LOCK'), true);
  });
});

test('private-file modes, symlinks, and a preexisting lock are rejected offline', async t => {
  const h = await harness(t);
  await chmod(h.input, 0o644); await rejectsCode(h.run(), 'private_file'); await chmod(h.input, 0o600);
  const linked = join(h.directory, 'linked'); await symlink(h.input, linked);
  await rejectsCode(runProductionImport(['--input', linked], { report: () => assert.fail('No report') }), 'private_file');
  await writeFile(join(h.ledger, 'LOCK'), '{}', { mode: 0o400 });
  await rejectsCode(h.run(), 'ledger_locked'); assert.equal(h.requests.length, 0);
});

test('cancellation during finalization records failure and emits no success', async t => {
  const h = await harness(t), controller = new AbortController();
  await rejectsCode(h.run('stage', false, { signal: controller.signal, beforeFinalize: () => controller.abort() }), 'cancelled');
  assert.equal(h.server.nextChunk, 7); assert.equal(h.reports.length, 0);
  const out = JSON.parse(await readFile(join(h.ledger, 'outcome-000001.json')));
  assert.equal(out.status, 'failed'); assert.equal(out.code, 'cancelled');
  const resumed = await h.run('stage', true); assert.equal(resumed.reserved.applicationCalls, 11);
});

test('redirects, oversized responses, SDK errors, and transport exceptions are bounded and private', async t => {
  for (const [label, response, code] of [
    ['redirect', () => new Response(SENTINEL, { status: 307, headers: { location: 'https://elsewhere.invalid' } }), 'backend_request_failed'],
    ['body', () => new Response(SENTINEL.repeat(3000)), 'response_too_large'],
    ['headers', () => new Response('{}', { headers: { 'x-private': SENTINEL.repeat(300) } }), 'response_headers'],
    ['SDK error', () => new Response(JSON.stringify({ status: 'error', errorMessage: SENTINEL, errorData: SENTINEL, logLines: [SENTINEL] })), 'backend_request_failed'],
    ['exception', () => { throw new Error(SENTINEL); }, 'backend_request_failed'],
  ]) await t.test(label, async t => {
    const h = await harness(t); h.intercept(response);
    await rejectsCode(h.run(), code); assert.equal(h.requests.length, 1); assert.equal(h.reports.length, 0);
    assert.equal((await h.reservations()).length, 1);
  });
});

test('invalid checkpoint shapes and premature activation stop before the next mutation', async t => {
  const h = await harness(t); await h.run();
  h.intercept((entry, respond) => entry.fn === 'migration:status' ?
    new Response(JSON.stringify({ status: 'success', value: { runId: RUN, phase: 'verify', nextChunk: 999, table: 0 } })) : respond());
  const before = h.requests.length;
  await rejectsCode(h.run('verify', true), 'invalid_server_checkpoint'); assert.equal(h.requests.length, before + 1);
  h.intercept(undefined);
  await rejectsCode(h.run('activate-readonly', true), 'verification_required'); assert.equal(h.server.activated, 0);
});
