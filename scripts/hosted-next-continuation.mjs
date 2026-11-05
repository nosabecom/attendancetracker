// One explicitly bounded successor to the recorded failed publication. No I/O.
import { createHash } from 'node:crypto';

const check = (value, code) => { if (!value) throw Error(code); };
const freeze = value => { for (const item of Object.values(value))
  if (item && typeof item === 'object') freeze(item); return Object.freeze(value); };
export const CONTINUATION = freeze({
  version: 1,
  predecessorRunId: 'attendance-next-ce59bc1883c3ccbf84baec993870e04d',
  predecessorSourceCommit: 'aa2b25d76e1bec977b16d80f3fdfb53baa6161cd',
  predecessorDeploymentId: 'dpl_3uruS1NUit1V6YjpMNKLaW1T5Cs6',
  evidenceSha256: '7ff21650d0c963bccb7e71edf8b222af7756b434053a747c44fa569788c53ae4',
  spent: { calls: 62, nextCalls: 1, controls: 17, hosting: 0, writes: 355, gateway: 7, creations: 1 },
  limits: { controls: 60, creations: 2, publisherControls: 20, runtimeControls: 19 },
});
export const ORIGINAL_PATHS = freeze({
  manifest: '.convex/hosted-validation/next-preview-manifest.json',
  publication: 'docs/measurements/hosted-next-preview-setup.json',
  attempt: '.convex/hosted-validation/next-runtime-attempt.json',
  evidence: 'docs/measurements/hosted-next-verification.json',
});
export const CONTINUATION_PATHS = freeze({
  manifest: '.convex/hosted-validation/next-continuation-preview-manifest.json',
  publication: 'docs/measurements/hosted-next-continuation-preview-setup.json',
  attempt: '.convex/hosted-validation/next-continuation-runtime-attempt.json',
  evidence: 'docs/measurements/hosted-next-continuation-verification.json',
});
export function validateContinuationSnapshot(value) {
  check(JSON.stringify(value) === JSON.stringify(CONTINUATION), 'continuation_snapshot');
  return CONTINUATION;
}
export function validateContinuationHistory(evidenceText, original, backend) {
  check(typeof evidenceText === 'string' && createHash('sha256').update(evidenceText).digest('hex') ===
    CONTINUATION.evidenceSha256, 'continuation_evidence_changed');
  const evidence = JSON.parse(evidenceText);
  check(original?.version === 1 && original.runId === evidence.runId &&
    original.runId === CONTINUATION.predecessorRunId &&
    original.sourceCommit === evidence.sourceCommit && original.sourceCommit === CONTINUATION.predecessorSourceCommit &&
    original.publication === 'stopped' && original.failedPhase === 'effective environment' &&
    original.creationState === 'ownership verified' && original.vercel?.ready === true &&
    original.vercel.deploymentId === evidence.deploymentId && original.vercel.deploymentId === CONTINUATION.predecessorDeploymentId &&
    original.vercel.teamSlug === 'nomokaro625-9385s-projects' &&
    original.vercel.teamId === 'team_fmwIPLne9w30y7G5JQrs3fzl' &&
    original.vercel.projectId === 'prj_uOMK1a4PLAgsDr1A16InuImM1M3q' && original.vercel.target === 'preview' &&
    original.vercel.url === 'https://attendance-tracker-i4pe4p75r-nomokaro625-9385s-projects.vercel.app' &&
    !original.access && !original.shareCapabilitySubmitted && !original.environmentVerified && !original.continuation,
  'continuation_predecessor');
  for (const key of ['name', 'id', 'projectId', 'reference', 'cloudUrl', 'siteUrl', 'fingerprint'])
    check(original.backend?.[key] === backend[key], 'continuation_backend');
  for (const [key, expected] of Object.entries(evidence.counters))
    check(original.counters?.[key] === expected, 'continuation_prior_counters');
  check(Object.keys(original.counters).length === 3, 'continuation_prior_counters');
  for (const key of ['ownershipVerified', 'capabilityRevoked', 'deploymentDeleted', 'capabilityInvalidatedByDeletion'])
    check(original.cleanup?.[key] === true && evidence.cleanup[key] === true, 'continuation_prior_cleanup');
  check(Object.keys(original.cleanup).length === 4, 'continuation_prior_cleanup');
  return CONTINUATION;
}
export function continuationTotals(counters, creations = 0) {
  check(Number.isSafeInteger(counters.controlRequests) && counters.controlRequests >= 0 && counters.controlRequests <= 20 &&
    Number.isSafeInteger(counters.hostingRequests) && counters.hostingRequests >= 0 && counters.hostingRequests <= 2 &&
    Number.isSafeInteger(counters.applicationCalls) && counters.applicationCalls >= 0 && counters.applicationCalls <= 1 &&
    Number.isSafeInteger(creations) && creations >= 0 && creations <= 1, 'continuation_publisher_counts');
  return { calls: 62 + counters.applicationCalls, nextCalls: 1 + counters.applicationCalls,
    controls: 17 + counters.controlRequests, hosting: counters.hostingRequests,
    writes: 355, gateway: 7, creations: 1 + creations };
}
export function validateContinuationPublication(report, manifest) {
  validateContinuationSnapshot(report?.continuation);
  const totals = continuationTotals(manifest.counters, 1);
  check(report?.version === 1 && report.passed === true && report.cancelled === false && !report.failedPhase &&
    report.runId === manifest.runId && report.sourceCommit === manifest.sourceCommit &&
    report.deploymentId === manifest.vercel.deploymentId && report.uniqueUrl === manifest.vercel.url &&
    report.creationRequests === 1 && report.productionMutationRequested === false &&
    report.productionTargetUnchanged === true && report.productionAliasBindingsUnchanged === true &&
    report.environmentVerified?.build === true && report.environmentVerified.runtime === true &&
    report.environmentVerified.credentialOverrides === true && !report.cleanup?.deploymentDeleted &&
    JSON.stringify(report.counters) === JSON.stringify(manifest.counters) &&
    JSON.stringify(report.cumulative) === JSON.stringify(totals) &&
    JSON.stringify(manifest.cumulative) === JSON.stringify(totals), 'continuation_publication_evidence');
  return totals;
}
