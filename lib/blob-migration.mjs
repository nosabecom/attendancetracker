import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const patterns = [
  ['accounts', /^auth\/accounts\/([a-f0-9]{64})\.json$/],
  ['loginSessions', /^auth\/sessions\/([a-f0-9]{64})\.json$/],
  ['claims', /^auth\/claims\/([a-f0-9]{64})\.json$/],
  ['imports', /^auth\/imports\/([^/]+)\/([a-f0-9]{64})\.json$/],
  ['throttleAttempts', /^auth\/attempts\/(ip|user)\/([a-f0-9]{64})\/(0|[1-9][0-9]*)\/([a-f0-9]{24})\.json$/],
  ['sessions', /^sessions\/([a-f0-9]{32})\.json$/],
  ['ownerReferences', /^owners\/([^/]+)\/([a-f0-9]{32})\.json$/],
  ['classRevisions', /^classes\/([a-f0-9]{32})\/versions\/([0-9]{10})\.json$/],
  ['sharedReferences', /^shared\/([^/]+)\/([a-f0-9]{32})\.json$/],
  ['excuses', /^checks\/([a-f0-9]{32})\/excused\/([^/]+)\.json$/],
  ['checkins', /^checks\/([a-f0-9]{32})\/([^/]+)\.json$/],
  ['closures', /^closed\/([a-f0-9]{32})\.json$/],
];

/** Error codes are safe to report. Raw paths, values, and credentials are never attached. */
export class BlobMigrationValidationError extends Error {
  constructor(code) {
    super(`Blob snapshot validation failed (${code}).`);
    this.name = 'BlobMigrationValidationError';
    this.code = code;
  }
}

function requireValid(condition, code) {
  if (!condition) throw new BlobMigrationValidationError(code);
}

function shape(value, required, optional = []) {
  requireValid(
    value !== null && typeof value === 'object' && !Array.isArray(value) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(value)),
    'invalid_shape',
  );
  requireValid(required.every(key => Object.hasOwn(value, key)), 'invalid_shape');
  requireValid(Object.keys(value).every(key => required.includes(key) || optional.includes(key)), 'unknown_field');
}

function segment(value) {
  requireValid(
    typeof value === 'string' && value.length > 0 &&
      !/[\/\\\u0000-\u001f\u007f]/.test(value) && value !== '.' && value !== '..',
    'invalid_id',
  );
  return value;
}

function id(value) {
  requireValid(typeof value === 'string' && value.length === 32 && /^[a-f0-9]{32}$/.test(value), 'invalid_id');
  return value;
}

function username(value) {
  requireValid(typeof value === 'string' && value === value.trim() && /^[a-z0-9._-]{3,40}$/.test(value), 'invalid_username');
  return value;
}

function date(value) {
  const match = typeof value === 'string' && value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/,
  );
  requireValid(Boolean(match) && match[0] === value, 'invalid_date');
  const [, year, month, day, hour, minute, second, , offsetHour = '0', offsetMinute = '0'] = match;
  const leap = Number(year) % 4 === 0 && (Number(year) % 100 !== 0 || Number(year) % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  requireValid(
    Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 &&
      Number(day) <= days[Number(month) - 1] && Number(hour) <= 23 &&
      Number(minute) <= 59 && Number(second) <= 59 &&
      Number(offsetHour) <= 23 && Number(offsetMinute) <= 59 && Number.isFinite(Date.parse(value)),
    'invalid_date',
  );
  return new Date(value).toISOString();
}

function title(value) {
  requireValid(typeof value === 'string' && value.trim().length > 0 && value.length <= 100, 'invalid_title');
  return value;
}

function students(value) {
  requireValid(Array.isArray(value) && value.length > 0 && value.length <= 1000, 'invalid_roster');
  const ids = new Set();
  const result = [];
  for (const student of value) {
    shape(student, ['id', 'name', 'code']);
    segment(student.id);
    requireValid(!ids.has(student.id), 'duplicate_student_id');
    ids.add(student.id);
    requireValid(
      typeof student.name === 'string' && student.name.trim().length > 0 && student.name.length <= 160 &&
        typeof student.code === 'string' && student.code.length <= 160,
      'invalid_student',
    );
    // CSV imports and later editors accepted different name/code ambiguities.
    // Preserve both histories verbatim. Only stable member IDs must be unique.
    result.push({ id: student.id, name: student.name, code: student.code });
  }
  return result;
}

/**
 * Pure, offline v1 intermediate format. All IDs and owners are source strings.
 * Returns formatVersion/exportedAt, accounts, legacyClaims, legacyImports,
 * classes, rosterVersions, sessions, attendance, contentFingerprint, and summary.
 * Roster keys are classLegacyId + ':' + SHA-256 of ordered {id,name,code} JSON.
 * Throws BlobMigrationValidationError on unknown records or invalid references.
 * Accounts contain secrets. Only summary and validation errors are report-safe.
 * Every stored revision and session contributes an immutable, ordered roster.
 * Attendance uses uploadedAt. Closure uses payload at, or uploadedAt if absent.
 * Present but invalid timestamps fail validation, including ignored payload at.
 * Missing discovery indexes are counted since Blob writes can fail partway.
 * Claims are authoritative even when their corresponding import index is absent.
 * Login sessions and throttles are counted only. Keep the input as the archive.
 * The fingerprint covers importable data, including credentials, and excludes
 * exportedAt, archived auth records, and discovery indexes.
 */
export function transformBlobSnapshot(snapshot) {
  shape(snapshot, ['formatVersion', 'exportedAt', 'blobs']);
  requireValid(snapshot.formatVersion === 1, 'unsupported_format');
  const exportedAt = date(snapshot.exportedAt);
  requireValid(Array.isArray(snapshot.blobs), 'invalid_shape');
  for (const blob of snapshot.blobs) {
    shape(blob, ['pathname', 'uploadedAt', 'value']);
    requireValid(typeof blob.pathname === 'string' && !/[\\\u0000-\u001f\u007f]/.test(blob.pathname), 'invalid_pathname');
  }
  const records = Object.fromEntries(patterns.map(([kind]) => [kind, []]));
  const paths = new Set();
  for (const blob of [...snapshot.blobs].sort((a, b) => compare(a.pathname, b.pathname))) {
    requireValid(!paths.has(blob.pathname), 'duplicate_pathname');
    paths.add(blob.pathname);
    const uploadedAt = date(blob.uploadedAt);
    const pattern = patterns.find(([, expression]) => expression.test(blob.pathname));
    requireValid(Boolean(pattern), 'unknown_record');
    const [kind, expression] = pattern;
    records[kind].push({ ...blob, uploadedAt, parts: blob.pathname.match(expression).slice(1) });
  }

  const accounts = [];
  const accountsByOwner = new Map();
  for (const { value, parts } of records.accounts) {
    shape(value, ['owner', 'username', 'salt', 'passwordHash']);
    segment(value.owner);
    username(value.username);
    requireValid(digest(value.username) === parts[0], 'account_path_mismatch');
    requireValid(typeof value.salt === 'string' && value.salt.length === 32 && /^[a-f0-9]{32}$/.test(value.salt), 'invalid_credentials');
    requireValid(typeof value.passwordHash === 'string' && value.passwordHash.length === 128 && /^[a-f0-9]{128}$/.test(value.passwordHash), 'invalid_credentials');
    requireValid(!accountsByOwner.has(value.owner), 'ambiguous_account_owner');
    const account = { owner: value.owner, username: value.username, salt: value.salt, passwordHash: value.passwordHash };
    accounts.push(account);
    accountsByOwner.set(account.owner, account);
  }
  accounts.sort((a, b) => compare(a.username, b.username));

  const legacyClaims = [];
  const claimOwners = new Map();
  for (const { value, parts: [legacyOwner] } of records.claims) {
    shape(value, ['owner']);
    segment(value.owner);
    requireValid(accountsByOwner.has(value.owner), 'dangling_claim_account');
    requireValid(!accountsByOwner.has(legacyOwner), 'ambiguous_claim_owner');
    claimOwners.set(legacyOwner, value.owner);
    legacyClaims.push({ legacyOwner, owner: value.owner });
  }
  const legacyImports = [];
  const importedOwners = new Set();
  for (const { value, parts: [owner, legacyOwner] } of records.imports) {
    shape(value, ['old']);
    segment(owner);
    requireValid(value.old === legacyOwner, 'import_path_mismatch');
    requireValid(accountsByOwner.has(owner) && claimOwners.get(legacyOwner) === owner, 'conflicting_import_claim');
    legacyImports.push({ owner, legacyOwner });
    importedOwners.add(legacyOwner);
  }

  // Old provider authentication state has no authority in the canonical model.
  for (const { value } of records.loginSessions) {
    shape(value, ['owner', 'username', 'expiresAt']);
    segment(value.owner);
    username(value.username);
    requireValid(Number.isSafeInteger(value.expiresAt) && value.expiresAt >= 0, 'invalid_expiry');
  }
  for (const { value, parts } of records.throttleAttempts) {
    shape(value, []);
    requireValid(Number.isSafeInteger(Number(parts[2])), 'invalid_throttle_bucket');
  }

  const sessionSources = new Map();
  for (const { value, parts: [sessionId] } of records.sessions) {
    shape(value, ['id', 'owner', 'title', 'createdAt', 'students'], ['classId']);
    id(value.id);
    requireValid(value.id === sessionId, 'session_path_mismatch');
    segment(value.owner);
    const classLegacyId = Object.hasOwn(value, 'classId') ? id(value.classId) : value.id;
    sessionSources.set(value.id, {
      legacyId: value.id, classLegacyId, owner: value.owner, title: title(value.title),
      createdAt: date(value.createdAt), students: students(value.students),
    });
  }
  for (const session of sessionSources.values()) {
    const root = sessionSources.get(session.classLegacyId);
    requireValid(Boolean(root), 'dangling_class_root');
    requireValid(root.classLegacyId === root.legacyId, 'conflicting_class_root');
    requireValid(session.owner === root.owner, 'conflicting_session_owner');
  }

  const revisions = new Map();
  for (const { value, parts: [rootId, revisionText] } of records.classRevisions) {
    shape(value, ['revision', 'students', 'teachers']);
    const root = sessionSources.get(rootId);
    requireValid(root?.classLegacyId === rootId, 'dangling_revision_root');
    requireValid(Number.isSafeInteger(value.revision) && value.revision > 0 && value.revision === Number(revisionText), 'invalid_revision');
    const roster = students(value.students);
    requireValid(Array.isArray(value.teachers) && value.teachers.length <= 50, 'invalid_teachers');
    const teachers = [], seen = new Set();
    for (const teacher of value.teachers) {
      shape(teacher, ['owner', 'username']);
      segment(teacher.owner);
      username(teacher.username);
      requireValid(accountsByOwner.get(teacher.owner)?.username === teacher.username, 'dangling_teacher_account');
      requireValid(!seen.has(teacher.owner), 'duplicate_teacher');
      seen.add(teacher.owner);
      teachers.push({ owner: teacher.owner, username: teacher.username });
    }
    teachers.sort((a, b) => compare(a.owner, b.owner));
    const history = revisions.get(rootId) || [];
    history.push({ revision: value.revision, students: roster, teachers });
    revisions.set(rootId, history);
  }

  const rosterMap = new Map();
  function rosterKey(classLegacyId, roster) {
    const key = `${classLegacyId}:${digest(JSON.stringify(roster))}`;
    if (!rosterMap.has(key)) rosterMap.set(key, { key, classLegacyId, students: roster });
    return key;
  }
  const classes = [];
  for (const root of sessionSources.values()) {
    if (root.legacyId !== root.classLegacyId) continue;
    const history = revisions.get(root.legacyId) || [];
    for (const revision of history) rosterKey(root.legacyId, revision.students);
    const latest = history.at(-1) || { revision: 0, students: root.students, teachers: [] };
    requireValid(
      latest.teachers.every(teacher => teacher.owner !== root.owner && teacher.owner !== claimOwners.get(root.owner)),
      'ambiguous_owner_teacher',
    );
    classes.push({
      legacyId: root.legacyId, owner: root.owner, title: root.title, latestRevision: latest.revision,
      currentRosterVersionKey: rosterKey(root.legacyId, latest.students), teachers: latest.teachers,
    });
  }
  const sessions = [...sessionSources.values()].map(session => ({
    legacyId: session.legacyId, classLegacyId: session.classLegacyId, owner: session.owner,
    title: session.title, createdAt: session.createdAt,
    rosterVersionKey: rosterKey(session.classLegacyId, session.students),
  }));
  const sessionsById = new Map(sessions.map(session => [session.legacyId, session]));
  const classesById = new Map(classes.map(item => [item.legacyId, item]));

  const ownerReferences = new Set();
  for (const { value, parts: [owner, sessionId] } of records.ownerReferences) {
    shape(value, ['id', 'title', 'createdAt', 'count'], ['classId']);
    segment(owner);
    const session = sessionSources.get(sessionId);
    requireValid(Boolean(session), 'dangling_owner_reference');
    requireValid(
      value.id === sessionId && owner === session.owner && value.title === session.title &&
        date(value.createdAt) === session.createdAt && value.count === session.students.length &&
        (!Object.hasOwn(value, 'classId') || value.classId === session.classLegacyId),
      'conflicting_owner_reference',
    );
    ownerReferences.add(sessionId);
  }
  const sharedReferences = new Map();
  let staleSharedReferences = 0;
  for (const { value, parts: [teacher, rootId] } of records.sharedReferences) {
    shape(value, ['id']);
    segment(teacher);
    requireValid(value.id === rootId, 'shared_path_mismatch');
    requireValid(accountsByOwner.has(teacher), 'dangling_shared_teacher');
    const root = classesById.get(rootId);
    requireValid(Boolean(root), 'dangling_shared_root');
    if (!root.teachers.some(item => item.owner === teacher)) staleSharedReferences++;
    const owners = sharedReferences.get(rootId) || new Set();
    owners.add(teacher);
    sharedReferences.set(rootId, owners);
  }

  let closureTimestampFallbacks = 0;
  for (const { value, uploadedAt, parts: [sessionId] } of records.closures) {
    shape(value, [], ['at']);
    const session = sessionsById.get(sessionId);
    requireValid(Boolean(session), 'dangling_closure_session');
    if (!Object.hasOwn(value, 'at')) closureTimestampFallbacks++;
    session.closedAt = Object.hasOwn(value, 'at') ? date(value.at) : uploadedAt;
  }

  const attendanceBySession = new Map();
  for (const kind of ['checkins', 'excuses']) {
    for (const { value, uploadedAt, parts: [sessionId, studentId] } of records[kind]) {
      shape(value, [], kind === 'excuses' ? ['at', 'by'] : ['at']);
      if (Object.hasOwn(value, 'at')) date(value.at);
      segment(studentId);
      const session = sessionSources.get(sessionId);
      requireValid(Boolean(session), 'dangling_attendance_session');
      requireValid(session.students.some(student => student.id === studentId), 'dangling_attendance_student');
      const members = attendanceBySession.get(sessionId) || new Map();
      const row = members.get(studentId) || { sessionLegacyId: sessionId, studentId };
      if (kind === 'checkins') row.checkedInAt = uploadedAt;
      else {
        row.excusedAt = uploadedAt;
        if (Object.hasOwn(value, 'by')) {
          segment(value.by);
          requireValid(value.by === session.owner || accountsByOwner.has(value.by), 'dangling_excuse_actor');
          // Historical actors may have since lost class membership.
          row.excusedBy = value.by;
        }
      }
      members.set(studentId, row);
      attendanceBySession.set(sessionId, members);
    }
  }
  const attendance = [...attendanceBySession.values()].flatMap(members => [...members.values()]);
  attendance.sort((a, b) => compare(a.sessionLegacyId, b.sessionLegacyId) || compare(a.studentId, b.studentId));
  const rosterVersions = [...rosterMap.values()].sort((a, b) => compare(a.key, b.key));
  const data = { formatVersion: 1, accounts, legacyClaims, legacyImports, classes, rosterVersions, sessions, attendance };
  const sourceOwners = new Set(sessions.map(session => session.owner));
  return {
    formatVersion: 1, exportedAt,
    accounts, legacyClaims, legacyImports, classes, rosterVersions, sessions, attendance,
    contentFingerprint: digest(JSON.stringify(data)),
    summary: {
      valid: true,
      inventory: {
        blobs: snapshot.blobs.length,
        records: Object.fromEntries(Object.entries(records).map(([kind, values]) => [kind, values.length])),
        canonical: {
          accounts: accounts.length, legacyClaims: legacyClaims.length, legacyImports: legacyImports.length,
          classes: classes.length, rosterVersions: rosterVersions.length, sessions: sessions.length, attendance: attendance.length,
        },
        archived: { loginSessions: records.loginSessions.length, throttleAttempts: records.throttleAttempts.length },
      },
      reconciliation: {
        staleSharedReferences,
        sessionsWithoutOwnerReference: sessions.length - ownerReferences.size,
        teachersWithoutSharedReference: classes.reduce((count, root) => count + root.teachers.filter(
          teacher => !sharedReferences.get(root.legacyId)?.has(teacher.owner),
        ).length, 0),
        claimsWithoutImportReference: legacyClaims.length - importedOwners.size,
        unclaimedOwners: [...sourceOwners].filter(owner => !accountsByOwner.has(owner) && !claimOwners.has(owner)).length,
        closureTimestampFallbacks,
      },
    },
  };
}
