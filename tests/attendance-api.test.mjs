import test, { mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import { createHash } from 'node:crypto';
import { BlobPreconditionFailedError } from '@vercel/blob';
import { DASHBOARD_HEADER, SINGLE_DASHBOARD_UNTIL } from '../lib/dashboard-policy.mjs';

let now;
beforeEach(t => {
  now = Date.parse('2026-10-23T12:00:00Z');
  t.mock.method(Date, 'now', () => now);
});

// Resolve the extensionless TypeScript imports used by Next.js in Node's test runner.
const sourceRoot = new URL('../', import.meta.url).href;
registerHooks({ resolve(specifier, context, nextResolve) {
  const appSource = ['app/', 'lib/'].some(path => context.parentURL?.startsWith(sourceRoot + path));
  if (appSource && specifier.startsWith('.') && !extname(specifier)) specifier += '.ts';
  return nextResolve(specifier, context);
} });
const records = new Map(), reads = [], lists = [];
let beforeDelete, failLeaseWrite;
mock.module('../lib/storage.ts', { exports: {
  read: async path => { reads.push(path); return records.get(path) ?? null; },
  all: async prefix => {
    lists.push(prefix);
    return [...records.keys()].filter(path => path.startsWith(prefix)).map(pathname => ({ pathname, uploadedAt: '2026-10-22T12:00:00Z' }));
  },
  write: async (path, value) => { records.set(path, value); },
  readVersioned: async path => {
    reads.push(path);
    const value = records.get(path);
    return value ? { value: structuredClone(value), etag: digest(JSON.stringify(value)) } : null;
  },
  compareAndWrite: async (path, value, etag) => {
    if (failLeaseWrite) throw new Error('Storage unavailable');
    const current = records.get(path);
    if (etag ? !current || digest(JSON.stringify(current)) !== etag : current) throw new BlobPreconditionFailedError();
    records.set(path, value);
  },
  del: async (path, options) => {
    beforeDelete?.();
    if (options?.ifMatch && digest(JSON.stringify(records.get(path))) !== options.ifMatch) throw new BlobPreconditionFailedError();
    records.delete(path);
  },
} });
const { GET, POST } = await import('../app/api/attendance/route.ts');
const digest = s => createHash('sha256').update(s).digest('hex');
const rootId = 'a'.repeat(32), repeatId = 'b'.repeat(32), token = 'c'.repeat(64);
const owner = 'owner', teacher = 'teacher';
const version = `classes/${rootId}/versions/0000000001.json`;
const leasePath = `dashboard-leases/${rootId}.json`;
function fixture(who = owner) {
  beforeDelete = undefined; failLeaseWrite = false;
  records.clear(); reads.length = 0; lists.length = 0;
  records.set(`auth/sessions/${digest(token)}.json`, { owner: who, expiresAt: Date.now() + 86400_000 });
  const root = { id: rootId, classId: rootId, owner, title: 'Class', students: [{ id: 'student', name: 'Avery', code: 'S1' }] };
  records.set(`sessions/${rootId}.json`, root);
  records.set(`sessions/${repeatId}.json`, { ...root, id: repeatId });
  records.set(version, { revision: 1, students: [], teachers: [{ owner: teacher, username: teacher }] });
  records.set(`checks/${repeatId}/student.json`, {});
}
function request(body, { id = repeatId, tab = '1'.repeat(32) } = {}) {
  return new Request(`https://example.test/api/attendance?id=${id}`, {
    method: body ? 'POST' : 'GET',
    headers: { cookie: `rollcall_session=${token}`, origin: 'https://example.test', ...(tab ? { [DASHBOARD_HEADER]: tab } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test('owner attendance reads only list check-ins and keep the original roster snapshot', async () => {
  fixture();
  const response = await GET(request()), data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(data.students[0].name, 'Avery'); assert.equal(data.owner, undefined);
  assert.deepEqual(Object.keys(data.attendance), ['student']);
  assert.deepEqual(lists, [`checks/${repeatId}/`]);
  assert.equal(reads.includes(version), false);
  assert.equal(reads.includes(`sessions/${rootId}.json`), false);
});

test('legacy owners use the same inexpensive attendance path', async () => {
  fixture('legacy-account'); records.set(`auth/claims/${owner}.json`, { owner: 'legacy-account' });
  assert.equal((await GET(request())).status, 200);
  assert.deepEqual(lists, [`checks/${repeatId}/`]);
});

test('shared teacher membership is rechecked and revocation blocks reads and closing', async () => {
  fixture(teacher);
  assert.equal((await GET(request())).status, 200);
  assert.ok(reads.includes(version));
  records.set(version, { revision: 1, students: [], teachers: [] });
  assert.equal((await GET(request())).status, 403);
  assert.equal((await POST(request({ action: 'close', id: repeatId }))).status, 403);
  assert.equal(records.has(`closed/${repeatId}.json`), false);
});

test('owners can close without listing roster versions; revoked logins still fail', async () => {
  fixture();
  assert.equal((await POST(request({ action: 'close', id: repeatId }))).status, 200);
  assert.deepEqual(lists, []);
  assert.equal((await GET(request())).status, 200);
  records.delete(`auth/sessions/${digest(token)}.json`);
  assert.equal((await GET(request())).status, 401);
});

test('taking attendance again still uses the latest edited class roster', async () => {
  fixture();
  records.set(version, { revision: 1, students: [{ id: 'new-student', name: 'Updated roster', code: 'S2' }], teachers: [] });
  const response = await POST(request({ action: 'repeat', id: repeatId }));
  assert.equal(response.status, 200);
  const { id } = await response.json();
  assert.ok(reads.includes(version));
  assert.equal(records.get(`sessions/${id}.json`).students[0].name, 'Updated roster');
  assert.equal(records.get(`sessions/${repeatId}.json`).students[0].name, 'Avery');
});

test('concurrent tabs get exactly one class-wide dashboard lease', async () => {
  fixture();
  const responses = await Promise.all(['1', '2'].map(n => GET(request(undefined, { tab: n.repeat(32) }))));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 423]);
  assert.deepEqual(lists, [`checks/${repeatId}/`]);
  const loser = await responses.find(r => r.status === 423).json();
  assert.equal(loser.students, undefined); assert.equal(loser.attendance, undefined);
  assert.equal((await GET(request(undefined, { id: rootId, tab: '3'.repeat(32) }))).status, 423);
});

test('sharing an account or copying a tab cannot open a second dashboard', async () => {
  fixture();
  assert.equal((await GET(request())).status, 200);
  assert.equal((await GET(request(undefined, { tab: '2'.repeat(32) }))).status, 423);
  assert.equal((await GET(request(undefined, { tab: null }))).status, 423);
  const lease = records.get(leasePath);
  assert.equal(lease.tokenHash, digest('1'.repeat(32)));
  assert.equal(JSON.stringify(lease).includes('1'.repeat(32)), false);
});

test('a shared teacher cannot use the owner tab token and can take over after release', async () => {
  fixture();
  assert.equal((await GET(request())).status, 200);
  const login = records.get(`auth/sessions/${digest(token)}.json`);
  login.owner = teacher;
  assert.equal((await GET(request())).status, 423);
  await POST(request({ action: 'release-dashboard', id: repeatId }));
  assert.equal(records.has(leasePath), true);
  login.owner = owner;
  assert.equal((await POST(request({ action: 'release-dashboard', id: repeatId }))).status, 200);
  login.owner = teacher;
  assert.equal((await GET(request(undefined, { tab: '2'.repeat(32) }))).status, 200);
});

test('renewals preserve ownership without writing on every poll and crashed tabs expire', async () => {
  fixture();
  await GET(request());
  const initial = JSON.stringify(records.get(leasePath));
  now += 30_000;
  await GET(request());
  assert.equal(JSON.stringify(records.get(leasePath)), initial);
  now += 91_000;
  await GET(request());
  const renewed = records.get(leasePath).expiresAt;
  assert.ok(renewed > JSON.parse(initial).expiresAt);
  assert.equal((await GET(request(undefined, { tab: '2'.repeat(32) }))).status, 423);
  now = renewed;
  const contenders = await Promise.all(['2', '3'].map(n => GET(request(undefined, { tab: n.repeat(32) }))));
  assert.deepEqual(contenders.map(r => r.status).sort(), [200, 423]);
  await POST(request({ action: 'release-dashboard', id: repeatId }));
  assert.equal(records.has(leasePath), true, 'an old tab must not release the successor');
});

test('closed history and public check-in do not acquire dashboard leases', async () => {
  fixture();
  await GET(request());
  records.set(`closed/${rootId}.json`, {});
  assert.equal((await GET(request(undefined, { id: rootId, tab: '2'.repeat(32) }))).status, 200);
  const publicResponse = await GET(new Request(`https://example.test/api/attendance?public=1&id=${repeatId}`));
  assert.equal(publicResponse.status, 200);
  assert.equal((await publicResponse.json()).students, undefined);
  const result = await POST(request({ action: 'checkin', id: repeatId, identity: 'S1' }, { tab: null }));
  assert.equal(result.status, 200);
});

test('revoked access cannot acquire a lease or read attendance, even with a valid token', async () => {
  fixture('stranger');
  assert.equal((await GET(request())).status, 403);
  assert.equal(records.has(leasePath), false);
  fixture(teacher);
  await GET(request());
  records.set(version, { revision: 2, students: [], teachers: [] });
  assert.equal((await GET(request())).status, 403);
  assert.equal((await POST(request({ action: 'release-dashboard', id: repeatId }))).status, 200);
  assert.equal(records.has(leasePath), false);
});

test('the temporary rule ends at midnight after Wednesday in Regina, with no lease reads', async () => {
  fixture();
  now = SINGLE_DASHBOARD_UNTIL - 30_000;
  records.get(`auth/sessions/${digest(token)}.json`).expiresAt = now + 86400_000;
  const response = await GET(request());
  assert.equal((await response.json()).dashboardLeaseMs, 30_000);
  assert.equal((await GET(request(undefined, { tab: '2'.repeat(32) }))).status, 423);
  now = SINGLE_DASHBOARD_UNTIL;
  reads.length = 0;
  for (const tab of [null, '2'.repeat(32)]) {
    const result = await GET(request(undefined, { tab }));
    assert.equal(result.status, 200);
    assert.equal((await result.json()).dashboardLeaseMs, undefined);
  }
  assert.equal(reads.includes(leasePath), false);
  records.get(`auth/sessions/${digest(token)}.json`).owner = teacher;
  assert.equal((await GET(request(undefined, { tab: null }))).status, 200);
});

test('an ETag race during release cannot delete a successor lease', async () => {
  fixture(); await GET(request());
  beforeDelete = () => { records.set(leasePath, { owner, tokenHash: digest('2'.repeat(32)), expiresAt: now + 180_000 }); };
  assert.equal((await POST(request({ action: 'release-dashboard', id: repeatId }))).status, 200);
  assert.equal(records.get(leasePath).tokenHash, digest('2'.repeat(32)));
});

test('a storage outage fails closed before attendance is listed or returned', async () => {
  fixture(); failLeaseWrite = true;
  const response = await GET(request());
  assert.equal(response.status, 500);
  assert.equal((await response.json()).students, undefined);
  assert.deepEqual(lists, []);
});

test('different classes can have independent live dashboards', async () => {
  fixture(); await GET(request());
  const id = '9'.repeat(32);
  records.set(`sessions/${id}.json`, { ...records.get(`sessions/${rootId}.json`), id, classId: id });
  assert.equal((await GET(request(undefined, { id, tab: '2'.repeat(32) }))).status, 200);
});
