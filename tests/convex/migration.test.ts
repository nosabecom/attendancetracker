import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import { anyApi, type ApiFromModules } from 'convex/server';
import type * as migration from '../../convex/migration';
import type * as attendance from '../../convex/attendance';
import type * as authSupport from '../../convex/authSupport';
import type * as operations from '../../convex/operations';
import schema from '../../convex/schema';
import { transformBlobSnapshot } from '../../lib/blob-migration.mjs';
import { buildMigrationPlan, migrationTables } from '../../lib/convex-migration-plan.mjs';
import { rosterDigest } from '../../convex/rosters';

const api = anyApi as unknown as ApiFromModules<{ migration: typeof migration; attendance: typeof attendance; authSupport: typeof authSupport; operations: typeof operations }>;
const m = api.migration;
const modules = (import.meta as ImportMeta & { glob(pattern: string): Record<string, () => Promise<unknown>> }).glob('../../convex/**/*.ts');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const root = 'a'.repeat(32), child = 'b'.repeat(32), claimed = 'c'.repeat(32), anonymous = 'd'.repeat(32);
const oldOwner = '7'.repeat(64), unclaimed = '8'.repeat(64);
const createdAt = '2026-10-01T00:00:00.000Z', uploadedAt = '2026-10-02T01:02:03.004Z';
const roster = [{ id: 'member-old', name: '  Éva  ', code: 'SAME' }, { id: 'member-2', name: 'éVA', code: 'SAME' }];
const latest = [...roster, { id: 'member-new', name: 'New person', code: '' }];
function fixture(students = roster) {
  const blobs: any[] = [];
  const add = (pathname: string, value: any) => blobs.push({ pathname, value, uploadedAt });
  for (const username of ['owner', 'teacher', 'stale']) add(`auth/accounts/${hash(username)}.json`, {
    owner: `workspace-${username}`, username, salt: 'a'.repeat(32), passwordHash: 'b'.repeat(128),
  });
  add(`auth/claims/${oldOwner}.json`, { owner: 'workspace-owner' });
  add(`auth/imports/workspace-owner/${oldOwner}.json`, { old: oldOwner });
  for (const [id, owner] of [[root, 'workspace-owner'], [claimed, oldOwner], [anonymous, unclaimed]]) add(`sessions/${id}.json`, { id, owner, title: 'Original title', createdAt, students });
  add(`sessions/${child}.json`, { id: child, classId: root, owner: 'workspace-owner', title: 'Later lesson', createdAt: uploadedAt, students });
  add(`classes/${root}/versions/0000000001.json`, { revision: 1, students, teachers: [{ owner: 'workspace-stale', username: 'stale' }] });
  add(`classes/${root}/versions/0000000002.json`, { revision: 2, students: students === roster ? latest : students, teachers: [{ owner: 'workspace-teacher', username: 'teacher' }] });
  add(`shared/workspace-stale/${root}.json`, { id: root });
  add(`checks/${child}/${students[0].id}.json`, { at: createdAt });
  add(`checks/${child}/excused/${students[0].id}.json`, { at: createdAt, by: 'workspace-stale' });
  add(`closed/${child}.json`, { at: createdAt });
  add(`auth/sessions/${hash('archived-cookie')}.json`, { owner: 'workspace-owner', username: 'owner', expiresAt: 12345 });
  add(`auth/attempts/ip/${hash('archived-ip')}/1/${'f'.repeat(24)}.json`, {});
  return { formatVersion: 1, exportedAt: uploadedAt, blobs };
}
function setup(raw = fixture()) {
  const canonical = transformBlobSnapshot(raw), plan = buildMigrationPlan(canonical);
  const t = convexTest({ schema, modules, transactionLimits: true });
  const beginArgs = { fingerprint: canonical.contentFingerprint, exportedAt: canonical.exportedAt,
    manifestDigest: plan.manifestDigest, chunkCount: plan.chunks.length, tableCounts: plan.tableCounts, expectedCounts: plan.expectedCounts };
  return { t, canonical, plan, beginArgs };
}
type F = ReturnType<typeof setup>;
async function begin(f: F, args = f.beginArgs) {
  await f.t.mutation(m.initialize, {});
  return f.t.mutation(m.begin, args);
}
async function stage(f: F) {
  const state = await begin(f);
  for (let ordinal = state.nextChunk; ordinal < f.plan.chunks.length; ordinal++) await f.t.mutation(m.stage, { runId: state.runId, ordinal, operations: f.plan.chunks[ordinal] });
  return state.runId;
}
async function verify(f: F, runId: Awaited<ReturnType<typeof stage>>) {
  await f.t.mutation(m.freeze, { runId });
  let phase = 'verify';
  while (phase === 'verify') phase = (await f.t.mutation(m.verifyNext, { runId })).phase;
}
async function dump(f: F) {
  return f.t.run(async ctx => Object.fromEntries(await Promise.all(migrationTables.map(async table => [table, await (ctx.db as any).query(table).collect()]))));
}

it('is entirely internal and covers every app/auth schema table', async () => {
  const exported = await import('../../convex/migration');
  for (const fn of Object.values(exported)) expect((fn as any).isInternal).toBe(true);
  const names = Object.keys(schema.tables).filter(table => !['deploymentState', 'migrationRuns', 'migrationChunks', 'migrationDocuments'].includes(table));
  expect([...migrationTables].sort()).toEqual(names.sort());
});

it('only begins on an empty, closed deployment and refuses ambiguous/missing control state', async () => {
  for (const mode of ['user', 'credential', 'auth', 'nonce', 'open', 'duplicate-state', 'active']) {
    const f = setup();
    await f.t.run(async ctx => {
      if (['user', 'auth', 'credential', 'nonce'].includes(mode)) await ctx.db.insert('deploymentState', { key: 'migration', readsEnabled: false, writesEnabled: false });
      if (mode === 'user' || mode === 'auth' || mode === 'credential') {
        const userId = await ctx.db.insert('users', { username: 'existing' });
        if (mode === 'auth') await ctx.db.insert('authSessions', { userId, expirationTime: Date.now() + 1000 });
        if (mode === 'credential') await ctx.db.insert('credentials', { userId, username: 'existing', salt: 'x', passwordHash: 'x' });
      } else if (mode === 'nonce') await ctx.db.insert('gatewayNonces', { nonce: 'existing', expiresAt: 0 });
      else {
        const runId = mode === 'active' ? await ctx.db.insert('migrationRuns', { fingerprint: 'x', exportedAt: uploadedAt, status: 'active', expectedCounts: f.plan.expectedCounts }) : undefined;
        await ctx.db.insert('deploymentState', { key: 'migration', readsEnabled: mode === 'open', writesEnabled: false, ...(runId ? { activeRunId: runId } : {}) });
        if (mode === 'duplicate-state') await ctx.db.insert('deploymentState', { key: 'migration', readsEnabled: false, writesEnabled: false });
      }
    });
    await expect(f.t.mutation(m.begin, f.beginArgs)).rejects.toThrow('migration_');
  }
  const fresh = setup();
  await expect(fresh.t.mutation(m.begin, fresh.beginArgs)).rejects.toThrow('deployment_not_closed');
  const f = setup(), runId = await stage(f);
  await f.t.run(async ctx => { const state = await ctx.db.query('deploymentState').unique(); await ctx.db.delete(state!._id); });
  await expect(f.t.mutation(m.freeze, { runId })).rejects.toThrow('deployment_not_closed');
  await expect(f.t.mutation(m.begin, f.beginArgs)).rejects.toThrow('deployment_not_closed');
  await expect(f.t.mutation(m.initialize, {})).rejects.toThrow('target_not_empty');
});

it('resumes matching interrupted imports, serializes duplicate chunks, and refuses another dataset', async () => {
  const f = setup();
  const first = await begin(f);
  const chunk = { runId: first.runId, ordinal: 0, operations: f.plan.chunks[0] };
  await Promise.all([f.t.mutation(m.stage, chunk), f.t.mutation(m.stage, chunk)]);
  expect((await f.t.mutation(m.begin, f.beginArgs)).nextChunk).toBe(1);
  await expect(f.t.mutation(m.begin, { ...f.beginArgs, fingerprint: '1'.repeat(64) })).rejects.toThrow('dataset_mismatch');
  await expect(f.t.mutation(m.stage, { ...chunk, operations: [{ kind: 'provenance', data: { owner: 'other', legacyOwner: oldOwner } }] })).rejects.toThrow('chunk_mismatch');
  const runId = await stage(f), before = await dump(f);
  await stage(f);
  expect(await dump(f)).toEqual(before);
  await f.t.mutation(m.freeze, { runId });
  await expect(f.t.mutation(m.stage, chunk)).rejects.toThrow('import_frozen');
  await expect(f.t.mutation(m.activate, { runId })).rejects.toThrow('not_verified');
});

it('blocks runtime queries/auth while staging, preserves history/authority, then activates only after verification', async () => {
  const f = setup(), runId = await stage(f);
  await expect(f.t.query(api.attendance.session, { legacyId: child })).rejects.toThrow('unavailable');
  await expect(f.t.query(api.authSupport.credential, { username: 'owner' })).rejects.toThrow('unavailable');
  const rows = await dump(f);
  const owner = rows.users.find((u: any) => u.username === 'owner'), teacher = rows.users.find((u: any) => u.username === 'teacher'), stale = rows.users.find((u: any) => u.username === 'stale');
  expect(rows.users).toHaveLength(3);
  expect(rows.ownerLinks.find((l: any) => l.ownerKey === oldOwner).userId).toBe(owner._id);
  expect(rows.ownerLinks.some((l: any) => l.ownerKey === unclaimed)).toBe(false);
  const klass = rows.classes.find((c: any) => c.legacyId === root), claimedClass = rows.classes.find((c: any) => c.legacyId === claimed);
  expect(klass.createdAt).toBe(createdAt);
  expect(claimedClass.ownerKey).toBe(oldOwner);
  expect(rows.memberships.some((r: any) => r.userId === stale._id)).toBe(false);
  expect(rows.memberships.find((r: any) => r.classId === klass._id && r.userId === teacher._id).role).toBe('teacher');
  expect(rows.memberships.find((r: any) => r.classId === claimedClass._id).userId).toBe(owner._id);
  const state = rows.classState.find((s: any) => s.classId === klass._id);
  expect(state.revision).toBe(2);
  expect(rows.rosterVersions.find((r: any) => r._id === state.rosterVersionId).digest).toBe(rosterDigest(latest));
  const session = rows.sessions.find((s: any) => s.legacyId === child);
  expect(session.count).toBe(roster.length); expect(session.bucketSize).toBe(100); expect(session.createdAt).toBe(uploadedAt);
  expect(session.rosterVersionId).not.toBe(state.rosterVersionId);
  expect(rows.rosterMembers.filter((r: any) => r.versionId === session.rosterVersionId).sort((a: any, b: any) => a.ordinal - b.ordinal).map((r: any) => ({ id: r.studentId, name: r.name, code: r.code }))).toEqual(roster);
  expect(rows.attendance).toHaveLength(1);
  expect(rows.attendance[0]).toMatchObject({ sessionId: session._id, studentId: roster[0].id, bucket: 0, checkedInAt: uploadedAt, excusedAt: uploadedAt, excusedBy: 'workspace-stale' });
  expect(rows.closures[0]).toMatchObject({ sessionId: session._id, closedAt: createdAt });
  for (const table of migrationTables.slice(11)) expect(rows[table]).toHaveLength(0);
  expect(rows.credentials[0]).toMatchObject({ salt: 'a'.repeat(32), passwordHash: 'b'.repeat(128) });
  await verify(f, runId);
  await f.t.mutation(m.activate, { runId });
  const control = await f.t.run(async ctx => ctx.db.query('deploymentState').unique());
  expect(control).toMatchObject({ activeRunId: runId, readsEnabled: true, writesEnabled: true });
  await expect(f.t.mutation(m.begin, f.beginArgs)).rejects.toThrow('deployment_not_closed');
});

it('publishes production reconciliation read-only atomically and keeps checkpoint reads resumable during maintenance', async () => {
  const f = setup(), runId = await stage(f);
  await expect(f.t.mutation(m.activate, { runId, readOnly: true })).rejects.toThrow('not_verified');
  await verify(f, runId);
  await f.t.mutation(m.activate, { runId, readOnly: true });
  expect(await f.t.query(api.operations.availability, { fingerprint: f.canonical.contentFingerprint }))
    .toEqual({ readsEnabled: true, writesEnabled: false });
  expect((await f.t.query(m.status, { fingerprint: f.canonical.contentFingerprint, manifestDigest: f.plan.manifestDigest })).phase).toBe('active');
  await expect(f.t.query(api.attendance.publicInfo, { legacyId: root })).resolves.toMatchObject({ title: 'Original title' });
  const before = await dump(f);
  await expect(f.t.mutation(api.attendance.publicCheckin, { legacyId: root, identity: roster[0].name })).rejects.toThrow('unavailable');
  await expect(f.t.mutation(api.authSupport.createUser, { username: 'new-user', salt: 'a'.repeat(32), passwordHash: 'b'.repeat(128), ownerKey: '9'.repeat(64) })).rejects.toThrow('unavailable');
  expect(await dump(f)).toEqual(before);
  await expect(f.t.mutation(m.activate, { runId })).rejects.toThrow('deployment_not_closed');
  await f.t.mutation(api.operations.setAvailability, { fingerprint: f.canonical.contentFingerprint, readsEnabled: false, writesEnabled: false });
  expect((await f.t.query(m.status, { fingerprint: f.canonical.contentFingerprint, manifestDigest: f.plan.manifestDigest })).phase).toBe('active');
  await expect(f.t.query(api.attendance.publicInfo, { legacyId: root })).rejects.toThrow('unavailable');
  await f.t.run(async ctx => { const state = await ctx.db.query('deploymentState').unique(); await ctx.db.patch(state!._id, { writesEnabled: true }); });
  await expect(f.t.query(m.status, { fingerprint: f.canonical.contentFingerprint, manifestDigest: f.plan.manifestDigest })).rejects.toThrow('invalid_run');
});

describe('verification reads actual fields, relationships and every table', () => {
  const drifts: Array<[string, string, (ctx: any, row: any, all: any) => Promise<any>]> = [
    ['credentials', 'credential hash', (ctx, r) => ctx.db.patch(r._id, { passwordHash: 'c'.repeat(128) })],
    ['users', 'user owner string', (ctx, r) => ctx.db.patch(r._id, { ownerKey: 'substitute' })],
    ['ownerLinks', 'owner link', (ctx, r, all) => ctx.db.patch(r._id, { userId: all.users.find((u: any) => u._id !== r.userId)._id })],
    ['classes', 'class ownership', (ctx, r) => ctx.db.patch(r._id, { ownerKey: 'substitute' })],
    ['classState', 'current version', (ctx, r, all) => ctx.db.patch(r._id, { rosterVersionId: all.rosterVersions.find((v: any) => v._id !== r.rosterVersionId)._id })],
    ['memberships', 'membership role', (ctx, r) => ctx.db.patch(r._id, { role: r.role === 'owner' ? 'teacher' : 'owner' })],
    ['rosterVersions', 'stored digest', (ctx, r) => ctx.db.patch(r._id, { digest: '0'.repeat(64) })],
    ['rosterMembers', 'member content despite unchanged digest', (ctx, r) => ctx.db.patch(r._id, { name: 'Changed' })],
    ['rosterMembers', 'normalized lookup', (ctx, r) => ctx.db.patch(r._id, { normalizedCode: 'changed' })],
    ['rosterMembers', 'member ordinal', (ctx, r) => ctx.db.patch(r._id, { ordinal: 999 })],
    ['sessions', 'session timestamp', (ctx, r) => ctx.db.patch(r._id, { createdAt: uploadedAt })],
    ['closures', 'closure timestamp', (ctx, r) => ctx.db.patch(r._id, { closedAt: uploadedAt })],
    ['attendance', 'check-in timestamp', (ctx, r) => ctx.db.patch(r._id, { checkedInAt: createdAt })],
    ['attendance', 'excuse timestamp', (ctx, r) => ctx.db.patch(r._id, { excusedAt: createdAt })],
    ['attendance', 'historical excuse actor', (ctx, r) => ctx.db.patch(r._id, { excusedBy: 'workspace-owner' })],
    ['memberships', 'missing edge', (ctx, r) => ctx.db.delete(r._id)],
    ['rosterMembers', 'equal-count row replacement', async (ctx, r) => { const { _id, _creationTime, ...data } = r; await ctx.db.delete(_id); await ctx.db.insert('rosterMembers', data); }],
    ['memberships', 'extra edge', (ctx, r) => { const { _id, _creationTime, ...data } = r; return ctx.db.insert('memberships', data); }],
    ['attendance', 'dangling reference', async (ctx, r) => { const { _id, _creationTime, ...s } = await ctx.db.get(r.sessionId); const id = await ctx.db.insert('sessions', { ...s, legacyId: 'e'.repeat(32) }); await ctx.db.delete(id); await ctx.db.patch(r._id, { sessionId: id }); }],
  ];
  for (const [table, description, mutate] of drifts) it(`rejects ${description} before publication`, async () => {
    const f = setup(), runId = await stage(f), all = await dump(f);
    await f.t.run(ctx => mutate(ctx, all[table][0], all));
    await expect(verify(f, runId)).rejects.toThrow('migration_');
    await expect(f.t.mutation(m.activate, { runId })).rejects.toThrow('not_verified');
    const state = await f.t.run(ctx => ctx.db.query('deploymentState').unique());
    expect(state?.readsEnabled).toBe(false); expect(state?.writesEnabled).toBe(false);
  });
  it('rejects orphan auth and runtime rows that have no receipt', async () => {
    const f = setup(), runId = await stage(f);
    await f.t.run(ctx => ctx.db.insert('authVerifiers', { signature: 'orphan' }));
    await expect(verify(f, runId)).rejects.toThrow('migration_');
  });
});

it('does not publish a partial version when a later member is invalid', async () => {
  const f = setup(), state = await begin(f);
  const ordinal = f.plan.chunks.findIndex(chunk => chunk[0].kind === 'version');
  for (let i = 0; i < ordinal; i++) await f.t.mutation(m.stage, { runId: state.runId, ordinal: i, operations: f.plan.chunks[i] });
  const operations = structuredClone(f.plan.chunks[ordinal]);
  operations[0].data.students[1].name = '';
  await expect(f.t.mutation(m.stage, { runId: state.runId, ordinal, operations })).rejects.toThrow('migration_');
  const rows = await dump(f);
  expect(rows.rosterVersions).toHaveLength(0); expect(rows.rosterMembers).toHaveLength(0);
});

it('rolls the entire version back if a post-write manifest check fails', async () => {
  const f = setup();
  // Force a failure AFTER every member and receipt has been inserted in the
  // transaction. This verifies rollback, rather than just pre-write validation.
  f.beginArgs.tableCounts[migrationTables.indexOf('rosterMembers')] = 1;
  f.beginArgs.expectedCounts.rosterMembers = 1;
  const state = await begin(f);
  const ordinal = f.plan.chunks.findIndex(chunk => chunk[0].kind === 'version');
  for (let i = 0; i < ordinal; i++) await f.t.mutation(m.stage, { runId: state.runId, ordinal: i, operations: f.plan.chunks[i] });
  await expect(f.t.mutation(m.stage, { runId: state.runId, ordinal, operations: f.plan.chunks[ordinal] })).rejects.toThrow('count_mismatch');
  const rows = await dump(f);
  expect(rows.rosterVersions).toHaveLength(0); expect(rows.rosterMembers).toHaveLength(0);
});

it('refuses incomplete chunks, altered manifests, duplicate runs, and duplicate receipts', async () => {
  const f = setup(), state = await begin(f);
  await expect(f.t.mutation(m.freeze, { runId: state.runId })).rejects.toThrow('incomplete_import');
  await expect(f.t.mutation(m.stage, { runId: state.runId, ordinal: 1, operations: f.plan.chunks[1] })).rejects.toThrow('chunk_out_of_order');
  await expect(f.t.mutation(m.begin, { ...f.beginArgs, manifestDigest: 'f'.repeat(64) })).rejects.toThrow('dataset_mismatch');
  const runId = await stage(f);
  await f.t.run(async ctx => { const r = (await ctx.db.query('migrationRuns').unique())!; const { _id, _creationTime, ...data } = r; await ctx.db.insert('migrationRuns', data); });
  await expect(f.t.mutation(m.freeze, { runId })).rejects.toThrow('invalid_run');
  const g = setup(), other = await stage(g);
  await g.t.run(async ctx => { const r = (await ctx.db.query('migrationDocuments').first())!; const { _id, _creationTime, ...data } = r; await ctx.db.insert('migrationDocuments', data); });
  await expect(verify(g, other)).rejects.toThrow('duplicate_target');
});

it('imports and verifies 1,000 maximum-length Unicode students within real transaction limits', async () => {
  const students = Array.from({ length: 1000 }, (_, i) => ({ id: `学生-${i}`, name: '界'.repeat(160), code: '生'.repeat(160) }));
  const raw = fixture(students);
  raw.blobs.push({ pathname: `checks/${root}/${students[999].id}.json`, uploadedAt, value: {} });
  const f = setup(raw), runId = await stage(f);
  await verify(f, runId);
  const row = await f.t.run(ctx => ctx.db.query('migrationRuns').unique());
  expect(row?.status).toBe('verified');
  const fact = await f.t.run(async ctx => (await ctx.db.query('attendance').collect()).find(r => r.studentId === students[999].id));
  expect(fact?.bucket).toBe(9); expect(fact?.checkedInAt).toBe(uploadedAt);
  expect(Object.hasOwn(fact!, 'excusedAt')).toBe(false); expect(Object.hasOwn(fact!, 'excusedBy')).toBe(false);
}, 60_000);

it('supports anonymous-only and empty source datasets without inventing accounts or grants', async () => {
  for (const blobs of [[], [{ pathname: `sessions/${anonymous}.json`, uploadedAt, value: { id: anonymous, owner: unclaimed, title: 'Unclaimed', createdAt, students: roster } }]]) {
    const f = setup({ formatVersion: 1, exportedAt: uploadedAt, blobs }), runId = await stage(f);
    await verify(f, runId);
    await f.t.mutation(m.activate, { runId });
    const rows = await dump(f);
    expect(rows.users).toHaveLength(0); expect(rows.ownerLinks).toHaveLength(0); expect(rows.memberships).toHaveLength(0);
  }
});

it('keeps excuse-only sparse facts and absent actors absent', async () => {
  const raw = fixture();
  raw.blobs.push({ pathname: `checks/${root}/excused/${roster[1].id}.json`, uploadedAt, value: {} });
  const f = setup(raw), runId = await stage(f);
  await verify(f, runId);
  const rows = await dump(f), fact = rows.attendance.find((r: any) => r.studentId === roster[1].id);
  expect(fact.excusedAt).toBe(uploadedAt);
  expect(Object.hasOwn(fact, 'checkedInAt')).toBe(false); expect(Object.hasOwn(fact, 'excusedBy')).toBe(false);
});
