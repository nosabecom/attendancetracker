import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseArgs, validateManifest, validateStoppedThird, createBudget } from '../scripts/test-hosted-next.mjs';
import { THIRD } from '../scripts/hosted-next-third.mjs';

const source = 'a'.repeat(40), output = 'b'.repeat(64), now = Date.now();
const args = ['--expected-vercel-deployment', 'dpl_fixture', '--expected-preview', 'fixture-preview', '--prebuilt-release', source];
function manifest() { return { version: 1, publication: 'ready', sourceCommit: source, runId: 'attendance-next-' + 'c'.repeat(32),
  thirdContinuation: structuredClone(THIRD), preflight: { deploymentId: 'dpl_5BMDwDHU3mp1k1RCMBjExsAr5mdj', status: 'replaced-by-signed-runtime', controlRequests: 2 },
  environmentVerification: { method: 'local-prebuilt+signed-runtime-v1', sourceCommit: source, outputSha256: output, readinessVerified: true },
  vercel: { teamSlug: 'nomokaro625-9385s-projects', teamId: 'team_fmwIPLne9w30y7G5JQrs3fzl', projectId: 'prj_uOMK1a4PLAgsDr1A16InuImM1M3q',
    deploymentId: 'dpl_fixture', url: 'https://fixture.vercel.app', target: 'preview', ready: true,
    sourcePrebuilt: { sourceCommit: source, outputSha256: output, target: 'preview' } },
  backend: { name: 'fixture-preview', id: 1, projectId: 2, reference: 'preview/attendance-validation-' + 'd'.repeat(32),
    cloudUrl: 'https://fixture-preview.convex.cloud', siteUrl: 'https://fixture-preview.convex.site',
    fingerprint: 'a3ceb7886db76f635b60fcb05541abfc3d7f425cb0322d2211afd2299eb037ba' },
  access: { kind: 'deployment-shareable', token: 'fixture', expiresAt: new Date(now + 600000).toISOString(), headerVerified: true },
  counters: { controlRequests: 20, hostingRequests: 3, applicationCalls: 1 } }; }
test('prebuilt mode binds release, signed verification, output and budget without legacy environment claims', () => {
  const expected = parseArgs(args), m = manifest();
  assert.equal(expected.prebuilt, true); assert.equal(expected.third, true);
  assert.equal(validateManifest(m, expected, now), true);
  for (const mutate of [x => x.environmentVerification.readinessVerified = false,
    x => x.vercel.sourcePrebuilt.outputSha256 = 'c'.repeat(64), x => x.environmentVerified = { build: true },
    x => x.preflight.controlRequests = 1]) {
    const changed = structuredClone(m); mutate(changed); assert.throws(() => validateManifest(changed, expected, now));
  }
  assert.throws(() => parseArgs([...args.slice(0, 5), 'bad']));
  const budget = createBudget(m.counters, { thirdContinuation: THIRD, preflight: m.preflight, prebuilt: true, now: () => 0 });
  assert.deepEqual(budget.snapshot(), { calls: 64, writes: 355, gateway: 7, control: 55, hosting: 3, nextCalls: 3, nextGateway: 0, runnerControl: 0, creations: 3 });
});
test('stopped third publication is byte-bound and its failed preflight cannot hide spent requests', async () => {
  const raw = await readFile('docs/measurements/hosted-next-third-preview-setup.json', 'utf8');
  const m = manifest(); m.previousStoppedPublicationSha256 = createHash('sha256').update(raw).digest('hex');
  assert.equal(validateStoppedThird(raw, m), true);
  assert.throws(() => validateStoppedThird(raw + ' ', m));
  const changed = JSON.parse(raw); changed.creationRequests = 1;
  const altered = JSON.stringify(changed); m.previousStoppedPublicationSha256 = createHash('sha256').update(altered).digest('hex');
  assert.throws(() => validateStoppedThird(altered, m));
});
