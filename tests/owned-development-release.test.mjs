import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateOwnedBackend, validateOwnedCompatibility, validateOwnedStopped, ownedTotals } from '../scripts/hosted-next-third.mjs';
import { createBudget, parseArgs } from '../scripts/test-hosted-next.mjs';

const sha = 'a'.repeat(40);
const backend = () => ({ deploymentName: 'amicable-koala-816', team: 'nomokaro625-9385-s-projects', project: 'convex-cyan-garden',
  isNewDeployment: false, ownedEmptyDevelopment: true, reference: 'dev/vercel',
  managementIdentity: { id: 6789777, projectId: 3365270, kind: 'cloud', name: 'amicable-koala-816', deploymentType: 'dev',
    isDefault: false, reference: 'dev/vercel', deploymentUrl: 'https://amicable-koala-816.convex.cloud' },
  cloudUrl: 'https://amicable-koala-816.convex.cloud', siteUrl: 'https://amicable-koala-816.convex.site',
  fingerprint: 'a3ceb7886db76f635b60fcb05541abfc3d7f425cb0322d2211afd2299eb037ba', reviewedSourceCommit: sha,
  publication: 'succeeded', environmentConfigured: true, limitVerified: true, adminCapabilityVerified: true, availabilityClosed: true,
  adminKey: 'private-test-key', config: { ATTENDANCE_GATEWAY_KEY: 'x'.repeat(32), ATTENDANCE_GATEWAY_AUDIENCE: 'test' },
  setupUsage: { controlRequests: 12, applicationCalls: 27, logicalWriteReservations: 26 } });

test('only the exact owned development identity and current backend source are admitted', () => {
  assert.equal(validateOwnedBackend(backend(), sha).id, 6789777);
  for (const mutate of [m => m.managementIdentity.id = 6789774, m => m.managementIdentity.deploymentType = 'prod',
    m => m.isNewDeployment = true, m => m.availabilityClosed = false, m => m.setupUsage.controlRequests = 21,
    m => m.setupUsage.applicationCalls = 41,
    m => m.reviewedSourceCommit = 'b'.repeat(40)]) {
    const m = backend(); mutate(m); assert.throws(() => validateOwnedBackend(m, sha));
  }
  const calls = []; const git = args => { calls.push(args); return args[0] === 'rev-parse' ? sha : ''; };
  assert.equal(validateOwnedCompatibility(sha, sha, git).ownedDevelopment, true);
  assert.ok(calls.some(x => x[0] === 'diff' && x.includes('pnpm-lock.yaml')));
  assert.throws(() => validateOwnedCompatibility(sha, 'b'.repeat(40), git));
});

test('owned selector is explicit and preserves the stopped attempt and actual setup usage', () => {
  const args = ['--expected-vercel-deployment', 'dpl_abc', '--expected-preview', 'amicable-koala-816', '--owned-development-release', sha];
  assert.equal(parseArgs(args).ownedDevelopment, true);
  assert.throws(() => parseArgs(args.map(x => x === 'amicable-koala-816' ? 'tremendous-elk-298' : x)));
  const stopped = readFileSync('docs/measurements/hosted-next-prebuilt-setup.json', 'utf8');
  assert.equal(validateOwnedStopped(stopped).creationRequests, 0);
  assert.throws(() => validateOwnedStopped(stopped + ' '));
  const c = { controlRequests: 4, hostingRequests: 2, applicationCalls: 1 }, u = backend().setupUsage;
  assert.deepEqual(ownedTotals(c, u), { calls: 91, nextCalls: 3, controls: 52, hosting: 2, writes: 381, gateway: 7, creations: 3 });
  const budget = createBudget(c, { ownedDevelopment: true, setupUsage: u, prebuilt: true });
  assert.equal(budget.snapshot().writes, 381);
  assert.equal(budget.snapshot().control, 52);
});
