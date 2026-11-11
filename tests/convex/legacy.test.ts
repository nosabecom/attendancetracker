/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { createHash } from 'node:crypto';
import schema from '../../convex/schema';

const modules = import.meta.glob('../../convex/**/*.ts');
const ref = (name: string) => makeFunctionReference<any>(name) as any;
const raw = 'a'.repeat(64), ownerKey = createHash('sha256').update(raw).digest('hex');
const now = 1800000000000;
const counts = { accounts: 0, legacyClaims: 0, classes: 0, rosterVersions: 0, rosterMembers: 0, memberships: 0, sessions: 0, closures: 0, attendance: 0 };
beforeEach(() => vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now }));
afterEach(() => vi.useRealTimers());
async function setup(n = 51) {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const ids = await t.run(async ctx => {
    const run = await ctx.db.insert('migrationRuns', { fingerprint: 'f'.repeat(64), status: 'active', exportedAt: new Date(now).toISOString(), expectedCounts: counts });
    const state = await ctx.db.insert('deploymentState', { key: 'migration', activeRunId: run, readsEnabled: true, writesEnabled: true });
    const user = await ctx.db.insert('users', { username: 'owner', ownerKey });
    const other = await ctx.db.insert('users', { username: 'other' });
    const session = await ctx.db.insert('authSessions', { userId: user, expirationTime: now + 30 * 86400000 });
    const otherSession = await ctx.db.insert('authSessions', { userId: other, expirationTime: now + 30 * 86400000 });
    const classes = [];
    for (let i = 0; i < n; i++) classes.push(await ctx.db.insert('classes', { legacyId: i.toString(16).padStart(32, '0'), ownerKey, title: `Class ${i}`, createdAt: new Date(now).toISOString() }));
    return { state, user, other, session, otherSession, classes };
  });
  return { t, ...ids, owner: t.withIdentity({ subject: `${ids.user}|${ids.session}` }), outsider: t.withIdentity({ subject: `${ids.other}|${ids.otherSession}` }) };
}
it('requires a valid raw key, known ownership, live identity and an open deployment', async () => {
  const f = await setup(1);
  await expect(f.t.mutation(ref('legacy:claim'), { legacyKey: raw })).rejects.toThrow('Sign in');
  await expect(f.owner.mutation(ref('legacy:claim'), { legacyKey: 'A'.repeat(64) })).rejects.toThrow('Invalid');
  await expect(f.owner.mutation(ref('legacy:claim'), { legacyKey: 'b'.repeat(64) })).rejects.toThrow('could not be found');
  await f.t.run(ctx => ctx.db.patch(f.state, { writesEnabled: false }));
  await expect(f.owner.mutation(ref('legacy:claim'), { legacyKey: raw })).rejects.toThrow('unavailable');
  await f.t.run(ctx => ctx.db.patch(f.state, { readsEnabled: false, writesEnabled: true }));
  await expect(f.owner.query(ref('legacy:claimStatus'), { ownerKey })).rejects.toThrow('unavailable');
  expect(await f.t.run(ctx => ctx.db.query('ownerLinks').collect())).toEqual([]);
});
it('claims the SHA-256 key, resumes directory indexing across pages, and prevents conflicts', async () => {
  const f = await setup();
  const history = { classId: f.classes[0], paginationOpts: { numItems: 50, cursor: null } };
  await expect(f.owner.query(ref('attendance:history'), history)).rejects.toMatchObject({ data: { status: 403 } });
  expect(await f.owner.mutation(ref('legacy:claim'), { legacyKey: raw })).toEqual({ ownerKey });
  expect((await f.owner.query(ref('attendance:history'), history)).page).toEqual([]);
  await f.t.run(ctx => ctx.db.insert('memberships', { classId: f.classes[0], userId: f.user, role: 'teacher' }));
  await expect(f.outsider.query(ref('attendance:history'), history)).rejects.toMatchObject({ data: { status: 403 } });
  expect(await f.owner.query(ref('legacy:claimStatus'), { ownerKey })).toEqual({ complete: false });
  await expect(f.outsider.mutation(ref('legacy:claim'), { legacyKey: raw })).rejects.toThrow('already belongs');
  await expect(f.outsider.query(ref('legacy:claimStatus'), { ownerKey })).rejects.toThrow('unavailable');
  // Simulate an interrupted worker and a duplicate retry before scheduled jobs run.
  await f.t.mutation(ref('legacy:indexClaim'), { ownerKey, userId: f.user, cursor: null });
  expect(await f.owner.query(ref('legacy:claimStatus'), { ownerKey })).toEqual({ complete: false });
  await f.owner.mutation(ref('legacy:claim'), { legacyKey: raw });
  await f.t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await f.owner.query(ref('legacy:claimStatus'), { ownerKey })).toEqual({ complete: true });
  const rows = await f.t.run(ctx => ctx.db.query('memberships').collect());
  expect(rows).toHaveLength(51);
  expect(rows.every(row => row.userId === f.user && row.role === 'owner')).toBe(true);
  expect(new Set(rows.map(row => row.classId)).size).toBe(51);
  await f.owner.mutation(ref('legacy:claim'), { legacyKey: raw });
  await f.t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await f.t.run(ctx => ctx.db.query('memberships').collect())).toEqual(rows);
  // The owner link is authoritative even if a stale owner edge remains.
  await f.t.run(async ctx => { const link = await ctx.db.query('ownerLinks').withIndex('by_owner', q => q.eq('ownerKey', ownerKey)).unique(); await ctx.db.patch(link!._id, { userId: f.other }); });
  await expect(f.owner.query(ref('attendance:history'), history)).rejects.toMatchObject({ data: { status: 403 } });
  expect((await f.outsider.query(ref('attendance:history'), history)).page).toEqual([]);
  await f.t.mutation(ref('legacy:indexClaim'), { ownerKey, userId: f.user, cursor: null });
  expect(await f.t.run(ctx => ctx.db.query('memberships').collect())).toEqual(rows);
});
