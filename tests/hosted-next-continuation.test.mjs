import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { CONTINUATION, ORIGINAL_PATHS, CONTINUATION_PATHS, validateContinuationHistory,
  validateContinuationSnapshot, continuationTotals } from '../scripts/hosted-next-continuation.mjs';
import { historyText, originalPublication } from './fixtures/hosted-next-history.mjs';

const backend = { name: 'synthetic-preview', id: 1, projectId: 2, reference: 'preview/synthetic',
  cloudUrl: 'https://synthetic.convex.cloud', siteUrl: 'https://synthetic.convex.site', fingerprint: 'synthetic' };
test('continuation pins the original safe bytes and binds private history, backend, deletion and prior accounting', () => {
  assert.deepEqual(validateContinuationHistory(historyText, originalPublication(backend), backend), CONTINUATION);
  assert.throws(() => validateContinuationHistory(historyText + '\n', originalPublication(backend), backend), /evidence_changed/);
  for (const mutate of [x => { x.runId += 'other'; }, x => { x.sourceCommit = 'b'.repeat(40); },
    x => { x.publication = 'ready'; }, x => { x.failedPhase = 'different'; },
    x => { x.vercel.ready = false; }, x => { x.vercel.deploymentId = 'dpl_other'; },
    x => { x.vercel.teamId = 'other'; }, x => { x.vercel.projectId = 'other'; },
    x => { x.vercel.target = 'production'; }, x => { x.vercel.url = 'https://other.vercel.app'; },
    x => { x.access = { token: 'synthetic' }; },
    x => { x.shareCapabilitySubmitted = true; }, x => { x.environmentVerified = {}; },
    x => { x.continuation = {}; }, x => { x.backend.id = 3; },
    x => { x.counters.controlRequests = 0; }, x => { x.counters.applicationCalls = 0; },
    x => { x.counters.hostingRequests = 1; }, x => { x.cleanup.deploymentDeleted = false; },
    x => { x.counters.unknown = 0; }, x => { x.cleanup.incomplete = true; },
    x => { x.cleanup.ownershipVerified = false; }, x => { x.cleanup.capabilityInvalidatedByDeletion = false; }]) {
    const original = originalPublication(backend); mutate(original);
    assert.throws(() => validateContinuationHistory(historyText, original, backend));
  }
});
test('immutable snapshot and fixed distinct paths prevent selecting another predecessor or a third attempt', () => {
  assert.equal(validateContinuationSnapshot(structuredClone(CONTINUATION)), CONTINUATION);
  const changed = structuredClone(CONTINUATION); changed.spent.controls = 1;
  assert.throws(() => validateContinuationSnapshot(changed), /snapshot/);
  assert.throws(() => { CONTINUATION.spent.calls = 0; }, TypeError);
  const paths = [...Object.values(ORIGINAL_PATHS), ...Object.values(CONTINUATION_PATHS)];
  assert.equal(new Set(paths).size, 8);
  assert.throws(() => { CONTINUATION_PATHS.manifest = ORIGINAL_PATHS.manifest; }, TypeError);
});
test('publication totals preserve the spent creation and cannot reserve a third or exceed local ceilings', () => {
  const counters = { controlRequests: 20, hostingRequests: 2, applicationCalls: 1 };
  assert.deepEqual(continuationTotals(counters, 1),
    { calls: 63, nextCalls: 2, controls: 37, hosting: 2, writes: 355, gateway: 7, creations: 2 });
  assert.equal(continuationTotals({ controlRequests: 0, hostingRequests: 0, applicationCalls: 0 }).creations, 1);
  for (const change of [{ controlRequests: 21 }, { hostingRequests: 3 }, { applicationCalls: 2 },
    { controlRequests: -1 }, { applicationCalls: 0.5 }])
    assert.throws(() => continuationTotals({ ...counters, ...change }, 1), /counts/);
  assert.throws(() => continuationTotals(counters, 2), /counts/);
});
