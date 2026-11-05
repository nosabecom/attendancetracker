import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getFunctionName } from 'convex/server';
import { transformBlobSnapshot } from '../lib/blob-migration.mjs';
import { buildMigrationPlan, migrationTables } from '../lib/convex-migration-plan.mjs';
import { parseArgs, validateTarget, readPrivateJson, runImport, ImportError } from '../scripts/import-blob.mjs';

const username = 'synthetic.owner', owner = 'synthetic-workspace', legacyId = 'a'.repeat(32);
const privateMarker = 'b'.repeat(128), timestamp = '2026-10-01T00:00:00.000Z';
function raw() {
  return { formatVersion: 1, exportedAt: timestamp, blobs: [
    { pathname: `auth/accounts/${createHash('sha256').update(username).digest('hex')}.json`, uploadedAt: timestamp,
      value: { username, owner, salt: 'c'.repeat(32), passwordHash: privateMarker } },
    { pathname: `sessions/${legacyId}.json`, uploadedAt: timestamp,
      value: { id: legacyId, owner, title: 'Synthetic', createdAt: timestamp, students: [{ id: 'legacy-student', name: '  Same  ', code: '' }] } },
  ] };
}
const inputArgs = ['--input', '/private/raw.json', '--url', 'https://synthetic-test.convex.cloud'];
function harness(extra = {}) {
  const calls = [], reads = [], reports = [], admin = [];
  const client = {
    setAdminAuth(key) { admin.push(key); },
    async mutation(ref, args) {
      const name = getFunctionName(ref).split(':')[1];
      calls.push({ name, args });
      if (name === 'begin') return { runId: 'run', phase: 'import', nextChunk: 0 };
      if (name === 'freeze') return { phase: 'verify' };
      if (name === 'verifyNext') return { phase: calls.filter(c => c.name === name).length === 1 ? 'verify' : 'verified' };
      if (name === 'activate') return { phase: 'active' };
      return {};
    },
    async query(ref, args) { calls.push({ name: getFunctionName(ref).split(':')[1], args }); return { runId: 'run', phase: 'import' }; },
  };
  const options = {
    env: { CONVEX_DEPLOY_KEY: 'synthetic-admin-key' },
    readJson: async path => { reads.push(path); return raw(); },
    createClient: () => client,
    report: r => reports.push(r),
    ...extra,
  };
  return { calls, reads, reports, admin, client, options };
}

test('dry-run transforms the raw exporter format, reports only counts/fingerprint, and never reads keys or connects', async () => {
  const h = harness({ env: new Proxy({}, { get() { throw Error('must not read key'); } }), createClient() { throw Error('must not connect'); } });
  await runImport(inputArgs, h.options);
  assert.equal(h.calls.length, 0); assert.equal(h.reads.length, 1);
  assert.equal(h.reports[0].dryRun, true);
  assert.equal(h.reports[0].counts.accounts, 1);
  const output = JSON.stringify(h.reports);
  for (const secret of [privateMarker, username, owner, legacyId, 'Same']) assert.equal(output.includes(secret), false);
});

test('argument and target validation reject implicit publication and credential-bearing URLs', () => {
  for (const args of [[], [...inputArgs, '--apply'], [...inputArgs, '--stage', '--verify'], [...inputArgs, '--key', 'secret'], [...inputArgs, '--apply', '--apply']]) assert.throws(() => parseArgs(args), ImportError);
  for (const url of ['http://synthetic-test.convex.cloud', 'https://evil.example', 'https://user:secret@synthetic-test.convex.cloud', 'https://synthetic-test.convex.cloud/path', 'https://synthetic-test.convex.cloud/?key=secret', 'https://synthetic-test.convex.cloud/#secret', 'http://127.0.0.1:3210']) assert.throws(() => validateTarget(url, false), ImportError);
  for (const url of ['https://synthetic-test.convex.cloud', 'http://127.0.0.2:3210', 'http://127.0.0.1.evil.example:3210', 'http://localhost', 'http://0.0.0.0:3210']) assert.throws(() => validateTarget(url, true), ImportError);
  assert.equal(validateTarget('http://127.0.0.1:3210', true).port, '3210');
  assert.equal(validateTarget('http://[::1]:3210', true).hostname, '[::1]');
});

test('local config is read only after explicit loopback validation and its port must match', async () => {
  const invalid = harness();
  await assert.rejects(runImport([...inputArgs, '--local', '--apply', '--stage'], invalid.options), { code: 'local_target_required' });
  assert.equal(invalid.reads.length, 0);
  const h = harness();
  h.options.readJson = async path => { h.reads.push(path); return path.endsWith('config.json') ? { adminKey: 'synthetic-local-key', ports: { cloud: 3210 } } : raw(); };
  await runImport(['--input', '/private/raw.json', '--url', 'http://127.0.0.1:3210', '--local', '--apply', '--stage'], h.options);
  assert.deepEqual(h.admin, ['synthetic-local-key']);
  assert.equal(h.reads[1].endsWith('/.convex/local/default/config.json'), true);
  await assert.rejects(runImport(['--input', '/private/raw.json', '--url', 'http://127.0.0.1:9999', '--local', '--apply', '--stage'], h.options), { code: 'local_config_mismatch' });
});

test('cloud apply requires its deployment key in the environment', async () => {
  const h = harness({ env: {} });
  await assert.rejects(runImport([...inputArgs, '--apply', '--stage'], h.options), { code: 'deploy_key_required' });
  assert.equal(h.calls.length, 0);
});

test('stage resumes its server checkpoint and does not verify or activate', async () => {
  const h = harness(), original = h.client.mutation;
  h.client.mutation = async (ref, args) => getFunctionName(ref).endsWith(':begin') ? (h.calls.push({ name: 'begin', args }), { runId: 'run', phase: 'import', nextChunk: 1 }) : original(ref, args);
  await runImport([...inputArgs, '--apply', '--stage'], h.options);
  assert.deepEqual(h.admin, ['synthetic-admin-key']);
  const plan = buildMigrationPlan(transformBlobSnapshot(raw()));
  assert.equal(h.calls.filter(c => c.name === 'stage').length, plan.chunks.length - 1);
  assert.equal(h.calls.find(c => c.name === 'stage').args.ordinal, 1);
  assert.equal(h.calls.some(c => ['freeze', 'verifyNext', 'activate'].includes(c.name)), false);
  assert.equal(h.reports[0].phase, 'staged');
});

test('verification freezes, resumes the persisted scan, and leaves activation as a separate gate', async () => {
  const h = harness();
  await runImport([...inputArgs, '--apply', '--verify'], h.options);
  assert.deepEqual(h.calls.map(c => c.name), ['status', 'freeze', 'verifyNext', 'verifyNext']);
  assert.equal(h.reports[0].phase, 'verified');
});

test('activation only requests the server publication gate for the exact committed input', async () => {
  const h = harness();
  await runImport([...inputArgs, '--apply', '--activate'], h.options);
  assert.deepEqual(h.calls.map(c => c.name), ['status', 'activate']);
  assert.equal(h.reports[0].phase, 'active');
});

test('raw SDK errors, including payload and credential echoes, never escape', async () => {
  const h = harness();
  h.client.mutation = async () => { throw new Error(`${privateMarker} ${JSON.stringify(raw())}`); };
  await assert.rejects(runImport([...inputArgs, '--apply', '--stage'], h.options), error => {
    assert.equal(error.code, 'backend_request_failed');
    assert.equal(error.stack.includes(privateMarker), false);
    return true;
  });
  assert.deepEqual(h.reports, []);
});

test('plan preserves canonical authority/history and commits credentials and provenance', () => {
  const canonical = transformBlobSnapshot(raw()), before = structuredClone(canonical);
  const plan = buildMigrationPlan(canonical);
  assert.deepEqual(canonical, before);
  assert.equal(plan.tableCounts[migrationTables.indexOf('rosterMembers')], 1);
  assert.equal(plan.chunks.filter(c => c[0].kind === 'version').every(c => c.length === 1), true);
  const changed = structuredClone(canonical);
  changed.accounts[0].passwordHash = 'd'.repeat(128);
  assert.notEqual(buildMigrationPlan(changed).manifestDigest, plan.manifestDigest);
  changed.legacyImports.push({ owner, legacyOwner: 'f'.repeat(64) });
  assert.notEqual(buildMigrationPlan(changed).manifestDigest, buildMigrationPlan({ ...changed, legacyImports: [] }).manifestDigest);
});

test('private input checks permissions/type/owner before reading, closes handles, and sanitizes JSON and filesystem errors', async () => {
  if (process.platform === 'win32') return;
  for (const override of [{ mode: 0o644 }, { mode: 0o640 }, { uid: process.getuid() + 1 }, { isFile: () => false }, { size: 513 * 1024 * 1024 }]) {
    let read = false, closed = false;
    const openFile = async () => ({ stat: async () => ({ mode: 0o600, uid: process.getuid(), size: 100, isFile: () => true, ...override }), readFile: async () => { read = true; return '{}'; }, close: async () => { closed = true; } });
    await assert.rejects(readPrivateJson('/private/raw.json', { openFile }), { code: 'input_not_private' });
    assert.equal(read, false); assert.equal(closed, true);
  }
  await assert.rejects(readPrivateJson('/private/raw.json', { openFile: async () => { throw Error(privateMarker); } }), { code: 'private_file_unavailable' });
  const openFile = async () => ({ stat: async () => ({ mode: 0o400, uid: process.getuid(), size: 100, isFile: () => true }), readFile: async () => privateMarker, close: async () => {} });
  await assert.rejects(readPrivateJson('/private/raw.json', { openFile }), error => error.code === 'invalid_json' && !error.stack.includes(privateMarker));
});

test('oversized legacy path segments fail preflight before creating an admin client', async () => {
  const snapshot = raw();
  snapshot.blobs.find(b => b.pathname.startsWith('sessions/')).value.students[0].id = '界'.repeat(172);
  const h = harness({ readJson: async () => snapshot, createClient() { throw Error('must not connect'); } });
  await assert.rejects(runImport([...inputArgs, '--apply', '--stage'], h.options), { code: 'source_segment_too_large' });
  assert.deepEqual(h.calls, []);
});
