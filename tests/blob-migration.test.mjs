import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BlobMigrationValidationError, transformBlobSnapshot } from '../lib/blob-migration.mjs';
import { parseRoster, matchStudent } from '../lib/roster.mjs';

// Every identity, credential, and roster in this suite is fictional.
const hash = value => createHash('sha256').update(value).digest('hex');
const rootId = 'a'.repeat(32), repeatId = 'b'.repeat(32);
const freshId = 'c'.repeat(32), secondFreshId = 'd'.repeat(32);
const anonymousId = 'e'.repeat(32), claimedId = 'f'.repeat(32);
const owner = 'source-owner', teacher = 'source-teacher', revoked = 'source-revoked';
const anonymous = 'anonymous-original-owner', legacyOwner = hash('fictional-legacy-key');
const createdAt = '2026-10-20T09:00:00.000Z';
const uploadedAt = '2026-10-20T10:00:00.000Z';
const checkedInAt = '2026-10-21T12:00:00.000Z', excusedAt = '2026-10-21T13:00:00.000Z';
const closedAt = '2026-10-21T11:00:00.000Z';
const oldRoster = parseRoster('name,student_id\nSam Rowan,\nSam Rowan,ROWAN2\nJules Vale,VALE3');
// IDs are deliberately ordinal strings, padded strings, and newer random IDs.
oldRoster[1].id = '007';
oldRoster[2].id = '1'.repeat(32);
const currentRoster = [
  { id: '007', name: 'Sam Updated', code: 'ROWAN2' },
  { id: 'member-new', name: 'Taylor Fiction', code: 'NEW4' },
];
const revisionOnlyRoster = [{ id: 'historical-member', name: 'Earlier Fiction', code: 'EARLY' }];
const sessionPath = id => `sessions/${id}.json`;
const versionPath = revision => `classes/${rootId}/versions/${String(revision).padStart(10, '0')}.json`;
const checkPath = `checks/${repeatId}/1.json`;
const excusePath = `checks/${repeatId}/excused/1.json`;

function record(pathname, value, time = uploadedAt) {
  return { pathname, uploadedAt: time, value: structuredClone(value) };
}

function fixture() {
  const blobs = [];
  for (const [accountOwner, accountUsername] of [[owner, 'fiction.owner'], [teacher, 'fiction.teacher'], [revoked, 'fiction.revoked']]) {
    blobs.push(record(`auth/accounts/${hash(accountUsername)}.json`, {
      owner: accountOwner, username: accountUsername, salt: '1'.repeat(32), passwordHash: '2'.repeat(128),
    }));
  }
  for (const [id, classId, sourceOwner, roster] of [
    [rootId, rootId, owner, oldRoster], [repeatId, rootId, owner, oldRoster],
    [freshId, rootId, owner, currentRoster], [secondFreshId, rootId, owner, currentRoster],
    [anonymousId, undefined, anonymous, oldRoster], [claimedId, undefined, legacyOwner, oldRoster],
  ]) {
    const session = { id, owner: sourceOwner, title: 'Fictional class', createdAt, students: roster };
    if (classId) session.classId = classId;
    blobs.push(record(sessionPath(id), session));
    if (id !== anonymousId) {
      const ref = { id, title: session.title, createdAt, count: roster.length };
      if (classId) ref.classId = classId;
      blobs.push(record(`owners/${sourceOwner}/${id}.json`, ref));
    }
  }
  blobs.push(
    record(versionPath(1), { revision: 1, students: revisionOnlyRoster, teachers: [{ owner: revoked, username: 'fiction.revoked' }] }),
    record(versionPath(2), { revision: 2, students: currentRoster, teachers: [
      { owner: revoked, username: 'fiction.revoked' }, { owner: teacher, username: 'fiction.teacher' },
    ] }),
    record(versionPath(3), { revision: 3, students: currentRoster, teachers: [{ owner: teacher, username: 'fiction.teacher' }] }),
    record(`shared/${teacher}/${rootId}.json`, { id: rootId }),
    record(`shared/${revoked}/${rootId}.json`, { id: rootId }),
    record(`auth/claims/${legacyOwner}.json`, { owner }),
    record(`auth/imports/${owner}/${legacyOwner}.json`, { old: legacyOwner }),
    record(checkPath, { at: createdAt }, checkedInAt),
    record(excusePath, { at: createdAt, by: revoked }, excusedAt),
    record(`closed/${repeatId}.json`, { at: closedAt }, '2026-10-21T14:00:00.000Z'),
    record(`auth/sessions/${hash('fictional-cookie')}.json`, { owner: 'former-owner', username: 'fiction.expired', expiresAt: 1 }),
    record(`auth/attempts/ip/${hash('fictional-ip')}/100/${'e'.repeat(24)}.json`, {}),
    record(`auth/attempts/user/${hash('fiction.owner')}/100/${'f'.repeat(24)}.json`, {}),
  );
  return { formatVersion: 1, exportedAt: '2026-11-01T00:00:00.000Z', blobs };
}

function find(snapshot, pathname) {
  return snapshot.blobs.find(blob => blob.pathname === pathname);
}

function remove(snapshot, pathname) {
  snapshot.blobs = snapshot.blobs.filter(blob => blob.pathname !== pathname);
}

function rejects(snapshot, code) {
  assert.throws(() => transformBlobSnapshot(snapshot), error => {
    assert.ok(error instanceof BlobMigrationValidationError);
    assert.equal(error.code, code);
    assert.equal(error.message, `Blob snapshot validation failed (${code}).`);
    return true;
  });
}

test('canonical classes retain ownership and grant access only to the latest teacher state', () => {
  const output = transformBlobSnapshot(fixture());
  assert.equal(output.formatVersion, 1);
  assert.equal(output.exportedAt, '2026-11-01T00:00:00.000Z');
  assert.equal(output.classes.length, 3);
  const root = output.classes.find(item => item.legacyId === rootId);
  assert.deepEqual(root, {
    legacyId: rootId, owner, title: 'Fictional class', latestRevision: 3,
    currentRosterVersionKey: output.sessions.find(session => session.legacyId === freshId).rosterVersionKey,
    teachers: [{ owner: teacher, username: 'fiction.teacher' }],
  });
  assert.equal(output.summary.reconciliation.staleSharedReferences, 1);
  assert.equal(JSON.stringify(output.classes).includes(revoked), false);
});

test('every revision and historical session contributes a roster, with ordered per-class content deduplication', () => {
  const output = transformBlobSnapshot(fixture());
  const classRosters = output.rosterVersions.filter(roster => roster.classLegacyId === rootId);
  assert.equal(classRosters.length, 3);
  const sessions = new Map(output.sessions.map(session => [session.legacyId, session]));
  assert.equal(sessions.get(rootId).rosterVersionKey, sessions.get(repeatId).rosterVersionKey);
  assert.equal(sessions.get(freshId).rosterVersionKey, sessions.get(secondFreshId).rosterVersionKey);
  assert.notEqual(sessions.get(rootId).rosterVersionKey, sessions.get(freshId).rosterVersionKey);
  assert.notEqual(sessions.get(rootId).rosterVersionKey, sessions.get(anonymousId).rosterVersionKey);
  assert.deepEqual(classRosters.find(roster => roster.key === sessions.get(rootId).rosterVersionKey).students, oldRoster);
  assert.ok(classRosters.some(roster => JSON.stringify(roster.students) === JSON.stringify(revisionOnlyRoster)));
  assert.deepEqual(classRosters.find(roster => roster.key === sessions.get(freshId).rosterVersionKey).students, currentRoster);
  for (const roster of classRosters) {
    assert.equal(roster.key, `${rootId}:${hash(JSON.stringify(roster.students))}`);
    assert.deepEqual(Object.keys(roster), ['key', 'classLegacyId', 'students']);
  }
});

test('roster member strings and parser-supported name ambiguities survive unchanged', () => {
  const output = transformBlobSnapshot(fixture());
  const roster = output.rosterVersions.find(item => item.classLegacyId === rootId && item.students.length === 3);
  assert.deepEqual(roster.students.map(student => student.id), ['1', '007', '1'.repeat(32)]);
  assert.equal(matchStudent(roster.students, 'sam rowan'), null);
  assert.equal(matchStudent(roster.students, ' rowan2 ').id, '007');
  const snapshot = fixture();
  // The editor accepts a name matching another member's code. Preserve that too.
  find(snapshot, sessionPath(anonymousId)).value.students = [
    { id: 'member-a', name: 'Alex', code: '' }, { id: 'member-b', name: 'Blair', code: 'Alex' },
  ];
  assert.doesNotThrow(() => transformBlobSnapshot(snapshot));
});

test('roster ordering and member identity both affect the deterministic version key', () => {
  const snapshot = fixture();
  find(snapshot, sessionPath(secondFreshId)).value.students.reverse();
  let output = transformBlobSnapshot(snapshot);
  assert.notEqual(output.sessions.find(item => item.legacyId === secondFreshId).rosterVersionKey,
    output.sessions.find(item => item.legacyId === freshId).rosterVersionKey);
  find(snapshot, sessionPath(secondFreshId)).value.students = structuredClone(currentRoster);
  find(snapshot, sessionPath(secondFreshId)).value.students[0].id = 'different-stable-id';
  output = transformBlobSnapshot(snapshot);
  assert.notEqual(output.sessions.find(item => item.legacyId === secondFreshId).rosterVersionKey,
    output.sessions.find(item => item.legacyId === freshId).rosterVersionKey);
});

test('anonymous workspaces and authoritative legacy claims retain their original owners', () => {
  const output = transformBlobSnapshot(fixture());
  assert.equal(output.classes.find(item => item.legacyId === anonymousId).owner, anonymous);
  assert.equal(output.sessions.find(item => item.legacyId === anonymousId).owner, anonymous);
  assert.equal(output.classes.find(item => item.legacyId === claimedId).owner, legacyOwner);
  assert.deepEqual(output.legacyClaims, [{ legacyOwner, owner }]);
  assert.deepEqual(output.legacyImports, [{ owner, legacyOwner }]);
  assert.equal(output.summary.reconciliation.unclaimedOwners, 1);
  const snapshot = fixture();
  remove(snapshot, `auth/imports/${owner}/${legacyOwner}.json`);
  const partial = transformBlobSnapshot(snapshot);
  assert.deepEqual(partial.legacyClaims, output.legacyClaims);
  assert.equal(partial.summary.reconciliation.claimsWithoutImportReference, 1);
});

test('an entirely anonymous snapshot needs no accounts or discovery indexes', () => {
  const snapshot = fixture();
  snapshot.blobs = [find(snapshot, sessionPath(anonymousId))];
  const output = transformBlobSnapshot(snapshot);
  assert.deepEqual(output.accounts, []);
  assert.equal(output.classes[0].owner, anonymous);
  assert.equal(output.classes[0].latestRevision, 0);
  assert.deepEqual(output.classes[0].teachers, []);
  assert.equal(output.classes[0].currentRosterVersionKey, output.sessions[0].rosterVersionKey);
  assert.deepEqual(output.rosterVersions[0].students, oldRoster);
  assert.equal(output.summary.reconciliation.unclaimedOwners, 1);
});

test('check-ins and excuses retain Blob display timestamps together, even after session closure', () => {
  const output = transformBlobSnapshot(fixture());
  assert.deepEqual(output.attendance, [{
    sessionLegacyId: repeatId, studentId: '1', checkedInAt, excusedAt, excusedBy: revoked,
  }]);
  assert.equal(output.sessions.find(item => item.legacyId === repeatId).closedAt, closedAt);
  assert.equal(output.sessions.filter(item => item.closedAt).length, 1);
});

test('snapshot absence represents undo, absent members have no row, and excuse-only rows remain', () => {
  const snapshot = fixture();
  remove(snapshot, excusePath);
  assert.deepEqual(transformBlobSnapshot(snapshot).attendance, [{ sessionLegacyId: repeatId, studentId: '1', checkedInAt }]);
  remove(snapshot, checkPath);
  assert.deepEqual(transformBlobSnapshot(snapshot).attendance, []);
  snapshot.blobs.push(record(excusePath, { at: createdAt, by: teacher }, excusedAt));
  assert.deepEqual(transformBlobSnapshot(snapshot).attendance, [{ sessionLegacyId: repeatId, studentId: '1', excusedAt, excusedBy: teacher }]);
});

test('empty legacy markers use uploadedAt and a closure without at has an explicit fallback count', () => {
  const snapshot = fixture();
  find(snapshot, checkPath).value = {};
  find(snapshot, excusePath).value = {};
  find(snapshot, `closed/${repeatId}.json`).value = {};
  const output = transformBlobSnapshot(snapshot);
  assert.deepEqual(output.attendance, [{ sessionLegacyId: repeatId, studentId: '1', checkedInAt, excusedAt }]);
  assert.equal(output.sessions.find(item => item.legacyId === repeatId).closedAt, '2026-10-21T14:00:00.000Z');
  assert.equal(output.summary.reconciliation.closureTimestampFallbacks, 1);
});

test('accounts preserve credential bytes while summaries and archived auth inventory contain counts only', () => {
  const snapshot = fixture(), output = transformBlobSnapshot(snapshot);
  assert.equal(output.accounts.length, 3);
  for (const account of output.accounts) {
    assert.deepEqual(account, find(snapshot, `auth/accounts/${hash(account.username)}.json`).value);
  }
  assert.deepEqual(output.summary.inventory.archived, { loginSessions: 1, throttleAttempts: 2 });
  assert.equal(output.summary.inventory.blobs, snapshot.blobs.length);
  const report = JSON.stringify(output.summary);
  for (const secret of ['passwordHash', 'salt', 'fiction.owner', owner, 'fictional-cookie', '2'.repeat(128), '1'.repeat(32)]) {
    assert.equal(report.includes(secret), false);
  }
  assert.equal('loginSessions' in output, false);
  assert.equal('throttleAttempts' in output, false);
});

test('repeated transforms, path order, object key order, and teacher array order are deterministic and pure', () => {
  const snapshot = fixture();
  find(snapshot, versionPath(3)).value.teachers.push({ owner: revoked, username: 'fiction.revoked' });
  const original = structuredClone(snapshot);
  const output = transformBlobSnapshot(snapshot);
  assert.deepEqual(transformBlobSnapshot(snapshot), output);
  assert.deepEqual(snapshot, original);
  function reverseKeys(value) {
    if (Array.isArray(value)) return value.map(reverseKeys);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]));
    return value;
  }
  const reordered = reverseKeys(snapshot);
  reordered.blobs.reverse();
  find(reordered, versionPath(2)).value.teachers.reverse();
  find(reordered, versionPath(3)).value.teachers.reverse();
  assert.deepEqual(transformBlobSnapshot(reordered), output);
  output.accounts[0].username = 'mutated-output';
  output.rosterVersions[0].students[0].name = 'Mutated output';
  assert.deepEqual(snapshot, original);
});

test('content fingerprints cover canonical import data and exclude export time, auth archives, and discovery indexes', () => {
  const snapshot = fixture(), fingerprint = transformBlobSnapshot(snapshot).contentFingerprint;
  snapshot.exportedAt = '2026-11-02T00:00:00Z';
  remove(snapshot, `shared/${revoked}/${rootId}.json`);
  remove(snapshot, `auth/sessions/${hash('fictional-cookie')}.json`);
  assert.equal(transformBlobSnapshot(snapshot).contentFingerprint, fingerprint);
  find(snapshot, checkPath).uploadedAt = '2026-10-21T12:01:00Z';
  assert.notEqual(transformBlobSnapshot(snapshot).contentFingerprint, fingerprint);
  find(snapshot, checkPath).uploadedAt = checkedInAt;
  find(snapshot, `auth/accounts/${hash('fiction.owner')}.json`).value.passwordHash = '3'.repeat(128);
  assert.notEqual(transformBlobSnapshot(snapshot).contentFingerprint, fingerprint);
});

test('missing discovery indexes do not discard authoritative sessions or teacher memberships', () => {
  const snapshot = fixture();
  remove(snapshot, `shared/${teacher}/${rootId}.json`);
  const output = transformBlobSnapshot(snapshot);
  assert.deepEqual(output.classes.find(item => item.legacyId === rootId).teachers, [{ owner: teacher, username: 'fiction.teacher' }]);
  assert.equal(output.summary.reconciliation.teachersWithoutSharedReference, 1);
  assert.equal(output.summary.reconciliation.sessionsWithoutOwnerReference, 1);
});

test('an empty snapshot has a complete, valid deterministic inventory', () => {
  const output = transformBlobSnapshot({ formatVersion: 1, exportedAt: createdAt, blobs: [] });
  for (const key of ['accounts', 'legacyClaims', 'legacyImports', 'classes', 'rosterVersions', 'sessions', 'attendance']) {
    assert.deepEqual(output[key], []);
  }
  assert.equal(output.summary.valid, true);
  assert.equal(output.summary.inventory.blobs, 0);
  assert.match(output.contentFingerprint, /^[a-f0-9]{64}$/);
});

const invalidCases = [
  ['duplicate paths', 'duplicate_pathname', snapshot => snapshot.blobs.push(structuredClone(snapshot.blobs[0]))],
  ['unknown critical prefix', 'unknown_record', snapshot => snapshot.blobs.push(record('future-critical/record.json', {}))],
  ['unexpected nesting', 'unknown_record', snapshot => snapshot.blobs.push(record(`checks/${repeatId}/other/student.json`, {}))],
  ['invalid pathname ID', 'unknown_record', snapshot => snapshot.blobs.push(record('sessions/invalid.json', {}))],
  ['newline pathname', 'invalid_pathname', snapshot => { snapshot.blobs[0].pathname += '\n'; }],
  ['corrupt JSON object', 'invalid_shape', snapshot => { find(snapshot, sessionPath(rootId)).value = null; }],
  ['unknown payload fields', 'unknown_field', snapshot => { find(snapshot, sessionPath(rootId)).value.futureCriticalField = true; }],
  ['missing payload fields', 'invalid_shape', snapshot => { delete find(snapshot, sessionPath(rootId)).value.createdAt; }],
  ['bad member ID', 'invalid_id', snapshot => { find(snapshot, sessionPath(rootId)).value.students[0].id = '../member'; }],
  ['duplicate stable member ID', 'duplicate_student_id', snapshot => { const roster = find(snapshot, sessionPath(rootId)).value.students; roster[1].id = roster[0].id; }],
  ['empty roster', 'invalid_roster', snapshot => { find(snapshot, sessionPath(rootId)).value.students = []; }],
  ['bad member name', 'invalid_student', snapshot => { find(snapshot, sessionPath(rootId)).value.students[0].name = ' '; }],
  ['mismatched session path', 'session_path_mismatch', snapshot => { find(snapshot, sessionPath(rootId)).value.id = '9'.repeat(32); }],
  ['missing class root', 'dangling_class_root', snapshot => { find(snapshot, sessionPath(repeatId)).value.classId = '9'.repeat(32); }],
  ['root points to another class', 'conflicting_class_root', snapshot => { find(snapshot, sessionPath(repeatId)).value.classId = freshId; }],
  ['session owner disagrees with root', 'conflicting_session_owner', snapshot => { find(snapshot, sessionPath(repeatId)).value.owner = teacher; }],
  ['revision on child session', 'dangling_revision_root', snapshot => { find(snapshot, versionPath(1)).pathname = `classes/${repeatId}/versions/0000000001.json`; }],
  ['revision number disagrees with path', 'invalid_revision', snapshot => { find(snapshot, versionPath(1)).value.revision = 4; }],
  ['teacher account missing', 'dangling_teacher_account', snapshot => { find(snapshot, versionPath(1)).value.teachers[0].owner = 'missing-account'; }],
  ['teacher username conflicts', 'dangling_teacher_account', snapshot => { find(snapshot, versionPath(3)).value.teachers[0].username = 'wrong.name'; }],
  ['duplicate teacher', 'duplicate_teacher', snapshot => { const teachers = find(snapshot, versionPath(3)).value.teachers; teachers.push(structuredClone(teachers[0])); }],
  ['teacher is class owner', 'ambiguous_owner_teacher', snapshot => { find(snapshot, versionPath(3)).value.teachers = [{ owner, username: 'fiction.owner' }]; }],
  ['claim target account missing', 'dangling_claim_account', snapshot => { find(snapshot, `auth/claims/${legacyOwner}.json`).value.owner = 'missing-account'; }],
  ['import without authoritative claim', 'conflicting_import_claim', snapshot => remove(snapshot, `auth/claims/${legacyOwner}.json`)],
  ['import points to other claimant', 'conflicting_import_claim', snapshot => { find(snapshot, `auth/imports/${owner}/${legacyOwner}.json`).pathname = `auth/imports/${teacher}/${legacyOwner}.json`; }],
  ['import value conflicts with path', 'import_path_mismatch', snapshot => { find(snapshot, `auth/imports/${owner}/${legacyOwner}.json`).value.old = hash('other-fiction'); }],
  ['account username conflicts with path', 'account_path_mismatch', snapshot => { find(snapshot, `auth/accounts/${hash('fiction.owner')}.json`).value.username = 'fiction.other'; }],
  ['account owner ambiguous', 'ambiguous_account_owner', snapshot => { find(snapshot, `auth/accounts/${hash('fiction.teacher')}.json`).value.owner = owner; }],
  ['invalid credential bytes', 'invalid_credentials', snapshot => { find(snapshot, `auth/accounts/${hash('fiction.owner')}.json`).value.salt = 'secret-invalid-salt'; }],
  ['dangling owner reference', 'dangling_owner_reference', snapshot => snapshot.blobs.push(record(`owners/${owner}/${'9'.repeat(32)}.json`, { id: '9'.repeat(32), title: 'Fiction', createdAt, count: 1 }))],
  ['conflicting owner index', 'conflicting_owner_reference', snapshot => { find(snapshot, `owners/${owner}/${repeatId}.json`).value.count = 100; }],
  ['owner reference assigned to another workspace', 'conflicting_owner_reference', snapshot => { find(snapshot, `owners/${owner}/${repeatId}.json`).pathname = `owners/${teacher}/${repeatId}.json`; }],
  ['dangling shared root', 'dangling_shared_root', snapshot => snapshot.blobs.push(record(`shared/${teacher}/${'9'.repeat(32)}.json`, { id: '9'.repeat(32) }))],
  ['sharing reference targets a child', 'dangling_shared_root', snapshot => snapshot.blobs.push(record(`shared/${teacher}/${repeatId}.json`, { id: repeatId }))],
  ['dangling shared teacher', 'dangling_shared_teacher', snapshot => snapshot.blobs.push(record(`shared/missing-teacher/${rootId}.json`, { id: rootId }))],
  ['sharing value conflicts with path', 'shared_path_mismatch', snapshot => { find(snapshot, `shared/${teacher}/${rootId}.json`).value.id = anonymousId; }],
  ['attendance has no session', 'dangling_attendance_session', snapshot => snapshot.blobs.push(record(`checks/${'9'.repeat(32)}/1.json`, {}))],
  ['attendance member only in latest roster', 'dangling_attendance_student', snapshot => snapshot.blobs.push(record(`checks/${repeatId}/member-new.json`, {}))],
  ['excuse member only in latest roster', 'dangling_attendance_student', snapshot => snapshot.blobs.push(record(`checks/${repeatId}/excused/member-new.json`, {}))],
  ['unknown excuse actor', 'dangling_excuse_actor', snapshot => { find(snapshot, excusePath).value.by = 'missing-actor'; }],
  ['closure has no session', 'dangling_closure_session', snapshot => snapshot.blobs.push(record(`closed/${'9'.repeat(32)}.json`, {}))],
  ['invalid login expiry', 'invalid_expiry', snapshot => { find(snapshot, `auth/sessions/${hash('fictional-cookie')}.json`).value.expiresAt = 'tomorrow'; }],
  ['invalid throttle shape', 'unknown_field', snapshot => { snapshot.blobs.find(blob => blob.pathname.startsWith('auth/attempts/')).value = { unexpected: true }; }],
];

for (const [name, code, mutate] of invalidCases) {
  test(`rejects ${name} with a report-safe deterministic error`, () => {
    const snapshot = fixture();
    mutate(snapshot);
    rejects(snapshot, code);
    snapshot.blobs.reverse();
    rejects(snapshot, code);
  });
}

test('claims cannot override an existing account owner, including self-claims', () => {
  const snapshot = fixture();
  find(snapshot, `auth/accounts/${hash('fiction.teacher')}.json`).value.owner = legacyOwner;
  rejects(snapshot, 'ambiguous_claim_owner');
});

test('claimant cannot also be a current teacher of its claimed class', () => {
  const snapshot = fixture();
  snapshot.blobs.push(record(`classes/${claimedId}/versions/0000000001.json`, {
    revision: 1, students: oldRoster, teachers: [{ owner, username: 'fiction.owner' }],
  }));
  rejects(snapshot, 'ambiguous_owner_teacher');
});

test('invalid dates reject metadata and all payload timestamp locations, including ignored display at', () => {
  const mutators = [
    (snapshot, value) => { snapshot.exportedAt = value; },
    (snapshot, value) => { snapshot.blobs[0].uploadedAt = value; },
    (snapshot, value) => { find(snapshot, sessionPath(rootId)).value.createdAt = value; },
    (snapshot, value) => { find(snapshot, checkPath).value.at = value; },
    (snapshot, value) => { find(snapshot, excusePath).value.at = value; },
    (snapshot, value) => { find(snapshot, `closed/${repeatId}.json`).value.at = value; },
  ];
  for (const invalid of ['not-a-date', '2026-02-30T12:00:00Z', '2026-10-20', '2026-10-20T24:00:00Z', null]) {
    for (const mutate of mutators) {
      const snapshot = fixture();
      mutate(snapshot, invalid);
      rejects(snapshot, 'invalid_date');
    }
  }
});

test('valid ISO offsets normalize to UTC with the original instant preserved', () => {
  const snapshot = fixture();
  snapshot.exportedAt = '2026-11-01T01:00:00+01:00';
  find(snapshot, checkPath).uploadedAt = '2026-10-21T06:00:00-06:00';
  const output = transformBlobSnapshot(snapshot);
  assert.equal(output.exportedAt, '2026-11-01T00:00:00.000Z');
  assert.equal(output.attendance[0].checkedInAt, checkedInAt);
});

test('validation never includes supplied credentials, paths, or unrecognized field names', () => {
  const snapshot = fixture();
  const sensitive = 'NEVER-PRINT-FICTIONAL-CREDENTIAL';
  find(snapshot, `auth/accounts/${hash('fiction.owner')}.json`).value.passwordHash = sensitive;
  try {
    transformBlobSnapshot(snapshot);
    assert.fail('Expected invalid credentials');
  } catch (error) {
    assert.equal(error.code, 'invalid_credentials');
    assert.equal(JSON.stringify(error).includes(sensitive), false);
    assert.equal(error.stack.includes(sensitive), false);
    assert.equal(error.stack.includes('auth/accounts/'), false);
  }
  snapshot.blobs[0] = record(`unknown/${sensitive}.json`, { [sensitive]: sensitive });
  rejects(snapshot, 'unknown_record');
});

test('invalid snapshot envelopes fail closed', () => {
  rejects(null, 'invalid_shape');
  rejects({ ...fixture(), formatVersion: 2 }, 'unsupported_format');
  rejects({ ...fixture(), blobs: null }, 'invalid_shape');
  rejects({ ...fixture(), unexpected: true }, 'unknown_field');
  const snapshot = fixture();
  snapshot.blobs.push(undefined);
  rejects(snapshot, 'invalid_shape');
});
