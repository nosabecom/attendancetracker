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
    return [...records.keys()].filter(path => path.startsWith(prefix)).map(pathname => ({ pathname, uploadedAt: new Date('2026-10-22T12:00:00Z') }));
  },
  write: async (path, value) => {
    if (records.has(path)) throw new Error('Blob already exists');
    records.set(path, value);
  },
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

const excuse = (excused = true, studentId = 'student', id = repeatId) => ({ action: 'excuse', id, studentId, excused });
const excusePath = `checks/${repeatId}/excused/student.json`;

test('owners can excuse a student, undo it, and excuse them again without losing check-in history', async () => {
  fixture();
  const checkin = records.get(`checks/${repeatId}/student.json`);
  assert.equal((await POST(request(excuse()))).status, 200);
  const saved = records.get(excusePath);
  assert.equal(saved.by, owner);
  assert.ok(saved.at);
  assert.equal((await POST(request(excuse()))).status, 200);
  assert.deepEqual(records.get(excusePath), saved);
  const data = await (await GET(request())).json();
  assert.deepEqual(Object.keys(data.excused), ['student']);
  assert.deepEqual(Object.keys(data.attendance), ['student']);
  assert.equal(data.excused.student, '2026-10-22T12:00:00.000Z');
  assert.equal((await POST(request(excuse(false)))).status, 200);
  assert.deepEqual((await (await GET(request())).json()).excused, {});
  assert.equal((await POST(request(excuse(false)))).status, 200);
  assert.equal((await POST(request(excuse()))).status, 200);
  assert.deepEqual(records.get(`checks/${repeatId}/student.json`), checkin);
  assert.equal(reads.includes(version), false);
  assert.ok(lists.every(prefix => prefix === `checks/${repeatId}/`));
});

test('excusing an absent student keeps them separate from present students', async () => {
  fixture();
  records.delete(`checks/${repeatId}/student.json`);
  assert.equal((await POST(request(excuse()))).status, 200);
  const data = await (await GET(request())).json();
  assert.deepEqual(data.attendance, {});
  assert.deepEqual(Object.keys(data.excused), ['student']);
});

test('shared teachers can excuse and undo in closed sessions using the original roster', async () => {
  fixture(teacher);
  records.set(`closed/${repeatId}.json`, { at: new Date().toISOString() });
  assert.equal((await POST(request(excuse()))).status, 200);
  assert.ok(reads.includes(version));
  const data = await (await GET(request())).json();
  assert.equal(data.closed, true);
  assert.deepEqual(Object.keys(data.excused), ['student']);
  assert.equal((await POST(request(excuse(false)))).status, 200);
  assert.equal(records.has(excusePath), false);
});

test('excusing requires a signed-in authorized teacher and rejects cross-origin requests', async () => {
  fixture('unrelated-account');
  assert.equal((await POST(request(excuse()))).status, 403);
  fixture(teacher);
  assert.equal((await POST(request(excuse()))).status, 200);
  records.set(version, { revision: 1, students: [], teachers: [] });
  assert.equal((await POST(request(excuse(false)))).status, 403);
  assert.equal((await POST(request(excuse()))).status, 403);
  assert.equal(records.has(excusePath), true);
  fixture();
  const crossOrigin = request(excuse());
  crossOrigin.headers.set('origin', 'https://other.test');
  assert.equal((await POST(crossOrigin)).status, 403);
  records.delete(`auth/sessions/${digest(token)}.json`);
  assert.equal((await POST(request(excuse()))).status, 401);
  assert.equal(records.has(excusePath), false);
});

test('excusing validates the session, roster member, and explicit boolean before writing', async () => {
  fixture();
  for (const body of [
    excuse(true, 'missing'), excuse(true, '../student'), excuse(true, null),
    excuse(true, 'student', 'invalid'), excuse('true'),
    { action: 'excuse', id: repeatId, studentId: 'student' },
  ]) {
    assert.equal((await POST(request(body))).status, 400);
  }
  assert.equal(records.has(excusePath), false);
});

test('student check-in preserves a teacher excuse and the public endpoint exposes no excuse data', async () => {
  fixture();
  records.delete(`checks/${repeatId}/student.json`);
  assert.equal((await POST(request(excuse()))).status, 200);
  const checkin = request({ action: 'checkin', id: repeatId, identity: 'S1' });
  checkin.headers.delete('cookie');
  assert.equal((await POST(checkin)).status, 200);
  const data = await (await GET(request())).json();
  assert.deepEqual(Object.keys(data.excused), ['student']);
  assert.deepEqual(Object.keys(data.attendance), ['student']);
  const publicData = await (await GET(new Request(`https://example.test/api/attendance?public=1&id=${repeatId}`))).json();
  assert.deepEqual(Object.keys(publicData).sort(), ['closed', 'title']);
});

test('excuses belong only to their session and are not copied when taking attendance again', async () => {
  fixture();
  assert.equal((await POST(request(excuse()))).status, 200);
  records.set(version, { revision: 1, students: records.get(`sessions/${repeatId}.json`).students, teachers: [] });
  const { id } = await (await POST(request({ action: 'repeat', id: repeatId }))).json();
  const fresh = await (await GET(new Request(`https://example.test/api/attendance?id=${id}`, { headers: { cookie: `rollcall_session=${token}` } }))).json();
  assert.deepEqual(fresh.excused, {});
  assert.deepEqual(fresh.attendance, {});
  assert.deepEqual(Object.keys((await (await GET(request())).json()).excused), ['student']);
});
