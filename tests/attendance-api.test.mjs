import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import { createHash } from 'node:crypto';

// Resolve the extensionless TypeScript imports used by Next.js in Node's test runner.
const sourceRoot = new URL('../', import.meta.url).href;
registerHooks({ resolve(specifier, context, nextResolve) {
  const appSource = ['app/', 'lib/'].some(path => context.parentURL?.startsWith(sourceRoot + path));
  if (appSource && specifier.startsWith('.') && !extname(specifier)) specifier += '.ts';
  return nextResolve(specifier, context);
} });
const records = new Map(), reads = [], lists = [];
mock.module('../lib/storage.ts', { exports: {
  read: async path => { reads.push(path); return records.get(path) ?? null; },
  all: async prefix => {
    lists.push(prefix);
    return [...records.keys()].filter(path => path.startsWith(prefix)).map(pathname => ({ pathname, uploadedAt: '2026-10-22T12:00:00Z' }));
  },
  write: async (path, value) => { records.set(path, value); },
  del: async path => { records.delete(path); },
} });
const { GET, POST } = await import('../app/api/attendance/route.ts');
const digest = s => createHash('sha256').update(s).digest('hex');
const rootId = 'a'.repeat(32), repeatId = 'b'.repeat(32), token = 'c'.repeat(64);
const owner = 'owner', teacher = 'teacher';
const version = `classes/${rootId}/versions/0000000001.json`;
function fixture(who = owner) {
  records.clear(); reads.length = 0; lists.length = 0;
  records.set(`auth/sessions/${digest(token)}.json`, { owner: who, expiresAt: Date.now() + 60_000 });
  const root = { id: rootId, classId: rootId, owner, title: 'Class', students: [{ id: 'student', name: 'Avery', code: 'S1' }] };
  records.set(`sessions/${rootId}.json`, root);
  records.set(`sessions/${repeatId}.json`, { ...root, id: repeatId });
  records.set(version, { revision: 1, students: [], teachers: [{ owner: teacher, username: teacher }] });
  records.set(`checks/${repeatId}/student.json`, {});
}
function request(body) {
  return new Request(`https://example.test/api/attendance?id=${repeatId}`, {
    method: body ? 'POST' : 'GET',
    headers: { cookie: `rollcall_session=${token}`, origin: 'https://example.test' },
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
