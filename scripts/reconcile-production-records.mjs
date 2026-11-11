import { createHash } from 'node:crypto';

// These are an inventory bound for the production reader, not a substitute for
// comparing the contents of each table.
export const RECONCILIATION_TABLE_COUNTS = Object.freeze({
  users: 3, credentials: 3, ownerLinks: 3, classes: 2, classState: 2,
  rosterVersions: 3, rosterMembers: 132, memberships: 3, sessions: 7,
  closures: 1, attendance: 198,
});

const fail = () => { throw new Error('Production record reconciliation failed.'); };
const insist = condition => { if (!condition) fail(); };
const key = (...parts) => JSON.stringify(parts);
const normalize = value => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
const digest = students => createHash('sha256').update(JSON.stringify(students.map(
  ({ id, name, code }) => ({ id, name, code }),
))).digest('hex');
const stable = value => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};

/**
 * Compare canonical source records with actual, bounded table reads. This pure
 * function never returns source values, IDs, hashes, or credentials, even on
 * failure. The caller is responsible for the read-only gate and read bounds;
 * independent table reads do not constitute a globally atomic snapshot.
 */
export function reconcileProductionRecords(canonical, tables) {
  try {
    insist(canonical && tables && typeof canonical === 'object' && typeof tables === 'object');
    const names = Object.keys(RECONCILIATION_TABLE_COUNTS);
    insist(Object.keys(tables).length === names.length && names.every(n => Array.isArray(tables[n])));
    const expected = Object.fromEntries(names.map(n => [n, new Map()]));
    const actual = Object.fromEntries(names.map(n => [n, new Map()]));
    const add = (map, naturalKey, record) => {
      insist(!map.has(naturalKey));
      map.set(naturalKey, stable(record));
    };
    const unique = (items, getKey) => {
      insist(Array.isArray(items));
      const result = new Map();
      for (const item of items) {
        const k = getKey(item);
        insist(k !== undefined && k !== null && !result.has(k));
        result.set(k, item);
      }
      return result;
    };
    const rows = (name, required, optional = []) => {
      const seen = new Set();
      for (const row of tables[name]) {
        insist(row && typeof row === 'object' && !Array.isArray(row));
        insist(typeof row._id === 'string' && row._id.length > 0 && !seen.has(row._id));
        seen.add(row._id);
        insist(required.every(k => Object.hasOwn(row, k) && row[k] !== undefined));
        insist(Object.keys(row).every(k => k === '_id' || k === '_creationTime' || required.includes(k) || optional.includes(k)));
        insist(optional.every(k => !Object.hasOwn(row, k) || row[k] !== undefined));
      }
      return tables[name];
    };
    const idMap = (items, getValue) => new Map(items.map(row => [row._id, getValue(row)]));
    const resolve = (map, id) => { insist(map.has(id)); return map.get(id); };
    const accounts = unique(canonical.accounts, a => a.owner);
    unique(canonical.accounts, a => a.username);
    const links = new Map(canonical.accounts.map(a => [a.owner, a.owner]));
    for (const claim of canonical.legacyClaims) {
      insist(accounts.has(claim.owner) && !links.has(claim.legacyOwner));
      links.set(claim.legacyOwner, claim.owner);
    }
    const classes = unique(canonical.classes, c => c.legacyId);
    const versions = unique(canonical.rosterVersions, v => v.key);
    const sessions = unique(canonical.sessions, s => s.legacyId);
    for (const a of canonical.accounts) {
      add(expected.users, key(a.owner), { owner: a.owner, username: a.username });
      add(expected.credentials, key(a.username), { owner: a.owner, username: a.username, salt: a.salt, passwordHash: a.passwordHash });
    }
    for (const [ownerKey, owner] of links) add(expected.ownerLinks, key(ownerKey), { ownerKey, owner, directoryComplete: true });
    for (const c of canonical.classes) {
      const root = sessions.get(c.legacyId);
      insist(root && root.classLegacyId === c.legacyId && root.owner === c.owner);
      add(expected.classes, key(c.legacyId), { legacyId: c.legacyId, ownerKey: c.owner, title: c.title, createdAt: root.createdAt });
      const version = versions.get(c.currentRosterVersionKey);
      insist(version && version.classLegacyId === c.legacyId);
      add(expected.classState, key(c.legacyId), { class: c.legacyId, version: version.key, revision: c.latestRevision });
      if (links.has(c.owner)) add(expected.memberships, key(c.legacyId, links.get(c.owner)), { class: c.legacyId, owner: links.get(c.owner), role: 'owner' });
      for (const teacher of c.teachers) {
        insist(accounts.get(teacher.owner)?.username === teacher.username);
        add(expected.memberships, key(c.legacyId, teacher.owner), { class: c.legacyId, owner: teacher.owner, role: 'teacher' });
      }
    }
    for (const v of canonical.rosterVersions) {
      insist(classes.has(v.classLegacyId) && Array.isArray(v.students));
      const hash = digest(v.students);
      insist(v.key === `${v.classLegacyId}:${hash}`);
      add(expected.rosterVersions, key(v.key), { class: v.classLegacyId, sourceKey: v.key, digest: hash, count: v.students.length });
      v.students.forEach((s, ordinal) => {
        insist(typeof s.id === 'string' && typeof s.name === 'string' && typeof s.code === 'string');
        add(expected.rosterMembers, key(v.key, s.id), { version: v.key, studentId: s.id, name: s.name, code: s.code, normalizedName: normalize(s.name), normalizedCode: normalize(s.code), ordinal });
      });
    }
    for (const s of canonical.sessions) {
      const c = classes.get(s.classLegacyId), v = versions.get(s.rosterVersionKey);
      insist(c && v && c.owner === s.owner && v.classLegacyId === s.classLegacyId);
      add(expected.sessions, key(s.legacyId), { legacyId: s.legacyId, class: s.classLegacyId, version: s.rosterVersionKey, title: s.title, createdAt: s.createdAt, count: v.students.length, bucketSize: 100 });
      if (Object.hasOwn(s, 'closedAt')) add(expected.closures, key(s.legacyId), { session: s.legacyId, closedAt: s.closedAt });
    }
    const optionalFacts = ['checkedInAt', 'excusedAt', 'excusedBy'];
    for (const a of canonical.attendance) {
      const session = sessions.get(a.sessionLegacyId);
      insist(session);
      const version = versions.get(session.rosterVersionKey);
      const ordinal = version.students.findIndex(s => s.id === a.studentId);
      insist(ordinal >= 0 && (Object.hasOwn(a, 'checkedInAt') || Object.hasOwn(a, 'excusedAt')));
      const facts = Object.fromEntries(optionalFacts.filter(k => Object.hasOwn(a, k)).map(k => [k, a[k]]));
      add(expected.attendance, key(a.sessionLegacyId, a.studentId), { session: a.sessionLegacyId, bucket: Math.floor(ordinal / 100), studentId: a.studentId, ...facts });
    }

    const users = rows('users', ['username', 'ownerKey']);
    const userIds = idMap(users, u => u.ownerKey);
    for (const u of users) add(actual.users, key(u.ownerKey), { owner: u.ownerKey, username: u.username });
    for (const r of rows('credentials', ['username', 'userId', 'salt', 'passwordHash'])) add(actual.credentials, key(r.username), { owner: resolve(userIds, r.userId), username: r.username, salt: r.salt, passwordHash: r.passwordHash });
    for (const r of rows('ownerLinks', ['ownerKey', 'userId'], ['directoryComplete'])) {
      const value = { ownerKey: r.ownerKey, owner: resolve(userIds, r.userId) };
      if (Object.hasOwn(r, 'directoryComplete')) value.directoryComplete = r.directoryComplete;
      add(actual.ownerLinks, key(r.ownerKey), value);
    }
    const classRows = rows('classes', ['legacyId', 'ownerKey', 'title', 'createdAt']);
    const classIds = idMap(classRows, c => c.legacyId);
    for (const c of classRows) add(actual.classes, key(c.legacyId), { legacyId: c.legacyId, ownerKey: c.ownerKey, title: c.title, createdAt: c.createdAt });
    const versionRows = rows('rosterVersions', ['classId', 'sourceKey', 'digest', 'count']);
    const versionIds = idMap(versionRows, v => v.sourceKey);
    for (const v of versionRows) add(actual.rosterVersions, key(v.sourceKey), { class: resolve(classIds, v.classId), sourceKey: v.sourceKey, digest: v.digest, count: v.count });
    for (const r of rows('rosterMembers', ['versionId', 'studentId', 'name', 'code', 'normalizedName', 'normalizedCode', 'ordinal'])) {
      const version = resolve(versionIds, r.versionId);
      add(actual.rosterMembers, key(version, r.studentId), { version, studentId: r.studentId, name: r.name, code: r.code, normalizedName: r.normalizedName, normalizedCode: r.normalizedCode, ordinal: r.ordinal });
    }
    for (const r of rows('classState', ['classId', 'rosterVersionId', 'revision'])) {
      const klass = resolve(classIds, r.classId);
      add(actual.classState, key(klass), { class: klass, version: resolve(versionIds, r.rosterVersionId), revision: r.revision });
    }
    for (const r of rows('memberships', ['classId', 'userId', 'role'])) {
      const klass = resolve(classIds, r.classId), owner = resolve(userIds, r.userId);
      add(actual.memberships, key(klass, owner), { class: klass, owner, role: r.role });
    }
    const sessionRows = rows('sessions', ['legacyId', 'classId', 'rosterVersionId', 'title', 'createdAt', 'count', 'bucketSize']);
    const sessionIds = idMap(sessionRows, s => s.legacyId);
    for (const s of sessionRows) add(actual.sessions, key(s.legacyId), { legacyId: s.legacyId, class: resolve(classIds, s.classId), version: resolve(versionIds, s.rosterVersionId), title: s.title, createdAt: s.createdAt, count: s.count, bucketSize: s.bucketSize });
    for (const r of rows('closures', ['sessionId', 'closedAt'])) {
      const session = resolve(sessionIds, r.sessionId);
      add(actual.closures, key(session), { session, closedAt: r.closedAt });
    }
    for (const r of rows('attendance', ['sessionId', 'bucket', 'studentId'], optionalFacts)) {
      const session = resolve(sessionIds, r.sessionId);
      const facts = Object.fromEntries(optionalFacts.filter(k => Object.hasOwn(r, k)).map(k => [k, r[k]]));
      add(actual.attendance, key(session, r.studentId), { session, bucket: r.bucket, studentId: r.studentId, ...facts });
    }
    for (const name of names) {
      insist(expected[name].size === actual[name].size);
      for (const [k, value] of expected[name]) insist(actual[name].get(k) === value);
    }
    return { ok: true, counts: Object.fromEntries(names.map(n => [n, actual[n].size])) };
  } catch {
    fail();
  }
}
