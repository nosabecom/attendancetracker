import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

// Shared by the offline administrator and deterministic Convex mutations.
export const migrationTables = [
  'users', 'credentials', 'ownerLinks', 'classes', 'classState', 'memberships',
  'rosterVersions', 'rosterMembers', 'sessions', 'closures', 'attendance',
  'authSessions', 'authAccounts', 'authRefreshTokens', 'authVerificationCodes',
  'authVerifiers', 'authRateLimits', 'throttleCounters', 'gatewayNonces',
];
export const hash = value => bytesToHex(sha256(utf8ToBytes(value)));
export const initialChain = hash('attendance-blob-import-v1');
export const bytes = value => utf8ToBytes(JSON.stringify(value)).length;
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const operationDigest = operations => hash(stable(operations));
export const advanceChain = (chain, digest) => hash(`${chain}:${digest}`);
export const documentDigest = value => hash(stable(value));
export class MigrationPlanError extends Error {
  constructor(code) { super(`Migration plan failed (${code}).`); this.code = code; }
}

/** Input is ONLY transformBlobSnapshot's canonical output. Never log this plan. */
export function buildMigrationPlan(canonical) {
  // The legacy transformer accepts unbounded path segments. Bound those before
  // starting any transaction so pathological IDs cannot strand a staged run or
  // overflow an index/document. Names/codes keep the transformer's UTF-16 limits.
  const bounded = value => {
    if (utf8ToBytes(value).length > 512) throw new MigrationPlanError('source_segment_too_large');
  };
  for (const a of canonical.accounts) bounded(a.owner);
  for (const c of canonical.classes) bounded(c.owner);
  for (const r of canonical.rosterVersions) for (const s of r.students) bounded(s.id);
  for (const r of canonical.attendance) if (r.excusedBy !== undefined) bounded(r.excusedBy);
  const operations = [];
  const counts = Object.fromEntries(migrationTables.map(table => [table, 0]));
  const add = (kind, data, targetCounts = {}) => {
    operations.push({ kind, data });
    for (const [table, count] of Object.entries(targetCounts)) counts[table] += count;
  };
  const accounts = new Map(canonical.accounts.map(account => [account.owner, account]));
  const links = new Map(canonical.accounts.map(account => [account.owner, account.owner]));
  for (const a of canonical.accounts) add('account', a, { users: 1, credentials: 1, ownerLinks: 1 });
  for (const claim of canonical.legacyClaims) {
    links.set(claim.legacyOwner, claim.owner);
    add('claim', claim, { ownerLinks: 1 });
  }
  // Provenance affects the committed manifest but grants no authority.
  for (const item of canonical.legacyImports) add('provenance', item);
  const sessions = new Map(canonical.sessions.map(session => [session.legacyId, session]));
  for (const c of canonical.classes) add('class', {
    legacyId: c.legacyId, owner: c.owner, title: c.title, createdAt: sessions.get(c.legacyId).createdAt,
  }, { classes: 1 });
  for (const version of canonical.rosterVersions) add('version', version, {
    rosterVersions: 1, rosterMembers: version.students.length,
  });
  for (const c of canonical.classes) {
    add('state', { classLegacyId: c.legacyId, rosterVersionKey: c.currentRosterVersionKey, revision: c.latestRevision }, { classState: 1 });
    if (links.has(c.owner)) add('membership', { classLegacyId: c.legacyId, owner: c.owner, role: 'owner' }, { memberships: 1 });
    for (const teacher of c.teachers) {
      if (accounts.get(teacher.owner)?.username !== teacher.username) throw new Error('invalid_plan');
      add('membership', { classLegacyId: c.legacyId, owner: teacher.owner, role: 'teacher' }, { memberships: 1 });
    }
  }
  for (const session of canonical.sessions) {
    const { closedAt, ...data } = session;
    add('session', data, { sessions: 1 });
    if (closedAt !== undefined) add('closure', { sessionLegacyId: session.legacyId, closedAt }, { closures: 1 });
  }
  for (const row of canonical.attendance) add('attendance', row, { attendance: 1 });
  const chunks = [];
  let pending = [], weight = 0;
  const flush = () => { if (pending.length) chunks.push(pending); pending = []; weight = 0; };
  for (const operation of operations) {
    // Full versions are indivisible. Ordinary chunks create at most 100 target
    // documents (+ receipts); account operations create three target documents.
    if (operation.kind === 'version') { flush(); chunks.push([operation]); continue; }
    const size = operation.kind === 'account' ? 3 : 1;
    if (weight + size > 100 || bytes([...pending, operation]) > 256 * 1024) flush();
    pending.push(operation); weight += size;
  }
  flush();
  if (chunks.some(chunk => bytes(chunk) > 2 * 1024 * 1024)) throw new MigrationPlanError('source_chunk_too_large');
  const manifestDigest = chunks.reduce((chain, chunk) => advanceChain(chain, operationDigest(chunk)), initialChain);
  return {
    chunks, manifestDigest, tableCounts: migrationTables.map(table => counts[table]),
    expectedCounts: {
      accounts: canonical.accounts.length, legacyClaims: canonical.legacyClaims.length,
      classes: counts.classes, rosterVersions: counts.rosterVersions, rosterMembers: counts.rosterMembers,
      memberships: counts.memberships, sessions: counts.sessions, closures: counts.closures, attendance: counts.attendance,
    },
  };
}
