import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { reconcileProductionRecords, RECONCILIATION_TABLE_COUNTS } from '../scripts/reconcile-production-records.mjs';

function fixture() {
  const first = [{ id: 'student-1', name: '  Ada   Lovelace ', code: ' A-1 ' }, { id: 'student-2', name: 'Grace', code: '' }];
  const second = [{ id: 'student-2', name: 'Grace', code: '' }, { id: 'student-1', name: '  Ada   Lovelace ', code: ' A-1 ' }];
  const version = students => `class:${createHash('sha256').update(JSON.stringify(students)).digest('hex')}`;
  const v1 = version(first), v2 = version(second);
  const canonical = {
    accounts: [
      { owner: 'owner', username: 'ownername', salt: 'secret-salt', passwordHash: 'secret-hash' },
      { owner: 'teacher', username: 'teachername', salt: 'teacher-salt', passwordHash: 'teacher-hash' },
    ],
    legacyClaims: [{ legacyOwner: 'legacy', owner: 'owner' }], legacyImports: [],
    classes: [{ legacyId: 'class', owner: 'legacy', title: 'Class', latestRevision: 4, currentRosterVersionKey: v2, teachers: [{ owner: 'teacher', username: 'teachername' }] }],
    rosterVersions: [{ key: v1, classLegacyId: 'class', students: first }, { key: v2, classLegacyId: 'class', students: second }],
    sessions: [
      { legacyId: 'class', classLegacyId: 'class', owner: 'legacy', title: 'Class', createdAt: '2023-01-01T00:00:00.000Z', rosterVersionKey: v1, closedAt: '2023-01-01T01:00:00.000Z' },
      { legacyId: 'later', classLegacyId: 'class', owner: 'legacy', title: 'Later', createdAt: '2023-02-01T00:00:00.000Z', rosterVersionKey: v2 },
    ],
    attendance: [
      { sessionLegacyId: 'class', studentId: 'student-1', checkedInAt: '2023-01-01T00:30:00.000Z' },
      { sessionLegacyId: 'later', studentId: 'student-2', excusedAt: '2023-02-01T00:30:00.000Z', excusedBy: 'teacher' },
    ],
  };
  const row = (id, values) => ({ _id: id, _creationTime: 123, ...values });
  const members = (versionId, students) => students.map((s, ordinal) => row(`${versionId}-${ordinal}`, {
    versionId, studentId: s.id, name: s.name, code: s.code,
    normalizedName: s.name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US'),
    normalizedCode: s.code.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US'), ordinal,
  }));
  const tables = {
    users: [row('u1', { ownerKey: 'owner', username: 'ownername' }), row('u2', { ownerKey: 'teacher', username: 'teachername' })],
    credentials: [row('p1', { username: 'ownername', userId: 'u1', salt: 'secret-salt', passwordHash: 'secret-hash' }), row('p2', { username: 'teachername', userId: 'u2', salt: 'teacher-salt', passwordHash: 'teacher-hash' })],
    ownerLinks: [row('o1', { ownerKey: 'owner', userId: 'u1', directoryComplete: true }), row('o2', { ownerKey: 'teacher', userId: 'u2', directoryComplete: true }), row('o3', { ownerKey: 'legacy', userId: 'u1', directoryComplete: true })],
    classes: [row('c1', { legacyId: 'class', ownerKey: 'legacy', title: 'Class', createdAt: '2023-01-01T00:00:00.000Z' })],
    classState: [row('st1', { classId: 'c1', rosterVersionId: 'v2', revision: 4 })],
    rosterVersions: [row('v1', { classId: 'c1', sourceKey: v1, digest: v1.slice(6), count: 2 }), row('v2', { classId: 'c1', sourceKey: v2, digest: v2.slice(6), count: 2 })],
    rosterMembers: [...members('v1', first), ...members('v2', second)],
    memberships: [row('m1', { classId: 'c1', userId: 'u1', role: 'owner' }), row('m2', { classId: 'c1', userId: 'u2', role: 'teacher' })],
    sessions: [row('s1', { legacyId: 'class', classId: 'c1', rosterVersionId: 'v1', title: 'Class', createdAt: '2023-01-01T00:00:00.000Z', count: 2, bucketSize: 100 }), row('s2', { legacyId: 'later', classId: 'c1', rosterVersionId: 'v2', title: 'Later', createdAt: '2023-02-01T00:00:00.000Z', count: 2, bucketSize: 100 })],
    closures: [row('cl1', { sessionId: 's1', closedAt: '2023-01-01T01:00:00.000Z' })],
    attendance: [row('a1', { sessionId: 's1', bucket: 0, studentId: 'student-1', checkedInAt: '2023-01-01T00:30:00.000Z' }), row('a2', { sessionId: 's2', bucket: 0, studentId: 'student-2', excusedAt: '2023-02-01T00:30:00.000Z', excusedBy: 'teacher' })],
  };
  return { canonical, tables };
}

const safeFailure = (canonical, tables) => assert.throws(
  () => reconcileProductionRecords(canonical, tables),
  error => error.constructor === Error && error.message === 'Production record reconciliation failed.' && !error.message.includes('secret'),
);

test('compares independently resolved records and returns only aggregate counts', () => {
  const { canonical, tables } = fixture();
  const result = reconcileProductionRecords(canonical, tables);
  assert.deepEqual(result, { ok: true, counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])) });
  assert.equal(Object.values(RECONCILIATION_TABLE_COUNTS).reduce((a, b) => a + b, 0), 357);
  for (const rows of Object.values(tables)) rows.reverse();
  assert.deepEqual(reconcileProductionRecords(canonical, tables), result);
});

const mutations = {
  'wrong account owner': t => { t.credentials[0].userId = 'u2'; },
  'wrong claim owner': t => { t.ownerLinks[2].userId = 'u2'; },
  'missing directory completeness': t => { delete t.ownerLinks[0].directoryComplete; },
  'wrong credential hash': t => { t.credentials[0].passwordHash = 'other-secret'; },
  'wrong current version': t => { t.classState[0].rosterVersionId = 'v1'; },
  'wrong historical version': t => { t.sessions[0].rosterVersionId = 'v2'; },
  'wrong teacher role': t => { t.memberships[1].role = 'owner'; },
  'wrong student': t => { t.rosterMembers[0].studentId = 'other'; },
  'wrong roster order': t => { t.rosterMembers[0].ordinal = 1; },
  'wrong normalized name': t => { t.rosterMembers[0].normalizedName = 'ada'; },
  'wrong roster digest': t => { t.rosterVersions[0].digest = 'bad'; },
  'wrong timestamp': t => { t.attendance[0].checkedInAt = 'wrong'; },
  'wrong closure timestamp': t => { t.closures[0].closedAt = 'wrong'; },
  'wrong bucket': t => { t.attendance[0].bucket = 1; },
  'missing optional field': t => { delete t.attendance[1].excusedBy; },
  'unexpected optional field': t => { t.attendance[0].excusedBy = 'teacher'; },
  'dangling reference': t => { t.sessions[0].classId = 'missing'; },
  'duplicate id': t => { t.attendance[1]._id = t.attendance[0]._id; },
  'duplicate natural key': t => { t.attendance[1].sessionId = 's1'; t.attendance[1].studentId = 'student-1'; },
  'extra relationship': t => { t.memberships.push({ ...t.memberships[0], _id: 'extra', userId: 'u2' }); },
  'missing row': t => { t.closures.pop(); },
  'unknown field': t => { t.users[0].password = 'secret-plaintext'; },
};
for (const [label, mutate] of Object.entries(mutations)) {
  test(`rejects ${label} without exposing source data`, () => {
    const { canonical, tables } = fixture();
    mutate(tables);
    safeFailure(canonical, tables);
  });
}

test('independently checks canonical roster digest against ordered values', () => {
  const { canonical, tables } = fixture();
  canonical.rosterVersions[0].students[0].name = 'changed';
  safeFailure(canonical, tables);
});

test('reports a static error for malformed input', () => {
  safeFailure({ accounts: 'secret-hash' }, {});
});

test('checks attendance bucket against the historical roster ordinal across a bucket boundary', () => {
  const { canonical, tables } = fixture();
  const source = canonical.rosterVersions[0];
  for (let i = 0; i < 100; i++) source.students.push({ id: `extra-${i}`, name: `Student ${i}`, code: '' });
  const versionKey = `class:${createHash('sha256').update(JSON.stringify(source.students)).digest('hex')}`;
  source.key = versionKey;
  canonical.sessions[0].rosterVersionKey = versionKey;
  canonical.attendance[0].studentId = 'extra-99';
  tables.rosterVersions[0].sourceKey = versionKey;
  tables.rosterVersions[0].digest = versionKey.slice(6);
  tables.rosterVersions[0].count = source.students.length;
  tables.sessions[0].count = source.students.length;
  for (let i = 0; i < 100; i++) tables.rosterMembers.push({
    _id: `extra-member-${i}`, versionId: 'v1', studentId: `extra-${i}`,
    name: `Student ${i}`, code: '', normalizedName: `student ${i}`, normalizedCode: '', ordinal: i + 2,
  });
  tables.attendance[0].studentId = 'extra-99';
  tables.attendance[0].bucket = 1;
  assert.equal(reconcileProductionRecords(canonical, tables).ok, true);
  tables.attendance[0].bucket = 0;
  safeFailure(canonical, tables);
});
