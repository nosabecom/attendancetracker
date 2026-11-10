// One separately reviewed third publication. Historical policies/records stay immutable.
import { createHash } from 'node:crypto';
import { CONTINUATION, validateContinuationHistory, validateContinuationSnapshot } from './hosted-next-continuation.mjs';

const check = (value, code) => { if (!value) throw Error(code); };
const freeze = value => { for (const item of Object.values(value)) if (item && typeof item === 'object') freeze(item); return Object.freeze(value); };
const count = (value, maximum) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
export const GITHUB_SOURCE = freeze({ type: 'github', repoId: 1409352117, org: 'nosabecom', repo: 'attendancetracker' });
export const THIRD = freeze({
  version: 1,
  predecessorRunId: 'attendance-next-c46801e578baa2c52e070b25c05cfa6a',
  predecessorSourceCommit: '53b7965cb594407cf1dea3d5d2a5e04b38f03a32',
  predecessorDeploymentId: 'dpl_4AAsug64RaRxhbVDToFQMhBUEVwQ',
  firstEvidenceSha256: CONTINUATION.evidenceSha256,
  secondEvidenceSha256: '96bc6bfd508fd0cebdf0023f6cf0195d9b76a6639d0e03c0f47559e1a680c3b0',
  spent: { calls: 63, nextCalls: 2, controls: 33, hosting: 0, writes: 355, gateway: 7, creations: 2 },
  limits: { controls: 80, creations: 3, preflightControls: 2, publisherControls: 20, runtimeControls: 19, hosting: 50 },
  creditReservationUsd: 1,
  minimumOtherReservationsUsd: 0.8,
});
export const THIRD_PATHS = freeze({
  manifest: '.convex/hosted-validation/next-third-preview-manifest.json',
  publication: 'docs/measurements/hosted-next-third-preview-setup.json',
  attempt: '.convex/hosted-validation/next-third-runtime-attempt.json',
  evidence: 'docs/measurements/hosted-next-third-verification.json',
});
export const vercelCreditReviewPath = '.convex/hosted-validation/vercel-credit-review.json';
export function validateThirdSnapshot(value) {
  check(JSON.stringify(value) === JSON.stringify(THIRD), 'third_snapshot');
  return THIRD;
}
export function validateThirdHistory(firstText, first, secondText, second, backend) {
  validateContinuationHistory(firstText, first, backend);
  check(typeof secondText === 'string' && createHash('sha256').update(secondText).digest('hex') === THIRD.secondEvidenceSha256, 'third_evidence_changed');
  const evidence = JSON.parse(secondText);
  validateContinuationSnapshot(second?.continuation);
  check(evidence.version === 1 && evidence.passed === false && evidence.cancelled === false &&
    evidence.runId === THIRD.predecessorRunId && evidence.sourceCommit === THIRD.predecessorSourceCommit &&
    evidence.deploymentId === THIRD.predecessorDeploymentId && evidence.creationRequests === 1 &&
    evidence.productionMutationRequested === false && evidence.failedPhase === 'effective environment' &&
    evidence.failure?.category === 'http_status' && evidence.failure.httpStatus === 400 &&
    second.version === 1 && second.runId === evidence.runId && second.sourceCommit === evidence.sourceCommit &&
    second.publication === 'stopped' && second.failedPhase === evidence.failedPhase &&
    second.creationState === 'ownership verified' && second.vercel?.ready === true &&
    second.vercel.deploymentId === evidence.deploymentId && second.vercel.target === 'preview' &&
    second.vercel.teamSlug === first.vercel.teamSlug && second.vercel.teamId === first.vercel.teamId &&
    second.vercel.projectId === first.vercel.projectId && typeof second.vercel.url === 'string' &&
    /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(second.vercel.url) &&
    !second.access && !second.shareCapabilitySubmitted && !second.environmentVerified && !second.thirdContinuation &&
    JSON.stringify(second.failure) === JSON.stringify(evidence.failure) &&
    JSON.stringify(second.cumulative) === JSON.stringify(THIRD.spent) &&
    JSON.stringify(evidence.cumulative) === JSON.stringify(THIRD.spent), 'third_predecessor');
  for (const key of ['name', 'id', 'projectId', 'reference', 'cloudUrl', 'siteUrl', 'fingerprint'])
    check(second.backend?.[key] === backend[key], 'third_backend');
  for (const [key, expected] of Object.entries(evidence.counters)) check(second.counters?.[key] === expected, 'third_prior_counters');
  check(Object.keys(second.counters).length === 3, 'third_prior_counters');
  for (const key of ['ownershipVerified', 'capabilityRevoked', 'deploymentDeleted', 'capabilityInvalidatedByDeletion'])
    check(second.cleanup?.[key] === true && evidence.cleanup[key] === true, 'third_prior_cleanup');
  check(Object.keys(second.cleanup).length === 4, 'third_prior_cleanup');
  return THIRD;
}
export function thirdTotals(counters, creations = 0, preflightControls = 0) {
  check(count(counters?.controlRequests, 20) && count(counters?.hostingRequests, 2) &&
    count(counters?.applicationCalls, 1) && count(creations, 1) && count(preflightControls, 2), 'third_publisher_counts');
  return { calls: 63 + counters.applicationCalls, nextCalls: 2 + counters.applicationCalls,
    controls: 33 + preflightControls + counters.controlRequests, hosting: counters.hostingRequests,
    writes: 355, gateway: 7, creations: 2 + creations };
}
export function validateExplicitGitSource(deployment, sourceCommit) {
  check(/^[a-f0-9]{40}$/.test(sourceCommit ?? ''), 'third_source_commit');
  const source = deployment?.gitSource;
  const repositoryMatches = source?.repoId === GITHUB_SOURCE.repoId ||
    (typeof source?.repoId === 'string' && source.repoId === String(GITHUB_SOURCE.repoId));
  check(source?.type === GITHUB_SOURCE.type && repositoryMatches &&
    source.sha === sourceCommit && deployment.meta?.githubCommitSha === sourceCommit,
  'third_git_source');
  if (source.org !== undefined) check(source.org === GITHUB_SOURCE.org, 'third_git_source');
  if (source.repo !== undefined) check(source.repo === GITHUB_SOURCE.repo, 'third_git_source');
  return true;
}
export function validateCompatibilityDeployment(deployment, deploymentId, owner) {
  const owners = [deployment?.ownerId, deployment?.teamId, deployment?.team?.id].filter(x => x !== undefined);
  const projects = [deployment?.projectId, deployment?.project?.id].filter(x => x !== undefined);
  check(typeof deploymentId === 'string' && /^dpl_[A-Za-z0-9]+$/.test(deploymentId) && deployment?.id === deploymentId &&
    owners.length > 0 && owners.every(x => x === owner.teamId) &&
    projects.length > 0 && projects.every(x => x === owner.projectId) && deployment.readyState === 'READY', 'third_compatibility_owner');
  validateExplicitGitSource(deployment, deployment.meta?.githubCommitSha);
  return true;
}
export function validateCompatibilityMaps(value) {
  const map = item => item && typeof item === 'object' && !Array.isArray(item) && Object.values(item).every(x => typeof x === 'string');
  check(map(value?.env) && map(value?.buildEnv) && !value.protectedSecrets, 'third_compatibility_maps');
  // Shape compatibility does NOT establish target values, completeness or credential absence.
  return true;
}
export function validateThirdPreflight(value) {
  check(value?.status === 'passed' && value.controlRequests === 2 &&
    typeof value.deploymentId === 'string' && /^dpl_[A-Za-z0-9]+$/.test(value.deploymentId) && value.ownershipVerified === true &&
    value.sourceVerified === true && value.environmentShapeCompatible === true, 'third_preflight');
  return value;
}
export function validateVercelCreditReview(review, now = Date.now()) {
  const observed = Date.parse(review?.observedAt), start = Date.parse(review?.periodStart), end = Date.parse(review?.periodEnd);
  check(review?.teamId === 'team_fmwIPLne9w30y7G5JQrs3fzl' && review.teamSlug === 'nomokaro625-9385s-projects' &&
    review.plan === 'pro' && review.source === 'vercel-dashboard-agent-observation' &&
    Number.isFinite(observed) && observed <= now + 300000 && now - observed <= 3600000 &&
    Number.isFinite(start) && Number.isFinite(end) && start <= now && now < end &&
    Number.isFinite(review.includedCreditUsd) && Number.isFinite(review.usedCreditUsd) &&
    review.includedCreditUsd > 0 && review.usedCreditUsd >= 0 &&
    Number.isFinite(review.otherReservationsUsd) && review.otherReservationsUsd >= THIRD.minimumOtherReservationsUsd &&
    review.includedCreditUsd - review.usedCreditUsd - review.otherReservationsUsd >= THIRD.creditReservationUsd &&
    review.creditReservationUsd === THIRD.creditReservationUsd && review.allTeamUsage === true &&
    review.reportingLagAcknowledged === true && review.noOverageAuthorized === true, 'third_vercel_credit');
  return { plan: 'pro', observedAt: review.observedAt, periodStart: review.periodStart, periodEnd: review.periodEnd,
    sufficientReviewedHeadroom: true, engineeringCreditReservationUsd: THIRD.creditReservationUsd,
    otherReservationsUsd: review.otherReservationsUsd,
    cumulativeEngineeringReservationsUsd: review.otherReservationsUsd + THIRD.creditReservationUsd, billingCap: false };
}
export function validateThirdPublication(report, manifest) {
  validateThirdSnapshot(report?.thirdContinuation);
  validateThirdSnapshot(manifest?.thirdContinuation);
  validateThirdPreflight(manifest.preflight);
  const totals = thirdTotals(manifest.counters, 1, manifest.preflight.controlRequests);
  check(report?.version === 1 && report.passed === true && report.cancelled === false && !report.failedPhase &&
    report.runId === manifest.runId && report.sourceCommit === manifest.sourceCommit &&
    report.deploymentId === manifest.vercel.deploymentId && report.uniqueUrl === manifest.vercel.url &&
    report.creationRequests === 1 && report.productionMutationRequested === false &&
    report.productionTargetUnchanged === true && report.productionAliasBindingsUnchanged === true &&
    report.gitDisconnectPreserved === true && manifest.vercel.requireGitSource === true &&
    report.environmentVerified?.build === true && report.environmentVerified.runtime === true &&
    report.environmentVerified.credentialOverrides === true && !report.cleanup?.deploymentDeleted &&
    JSON.stringify(report.preflight) === JSON.stringify(manifest.preflight) &&
    JSON.stringify(report.counters) === JSON.stringify(manifest.counters) &&
    JSON.stringify(report.cumulative) === JSON.stringify(totals) && JSON.stringify(manifest.cumulative) === JSON.stringify(totals),
  'third_publication_evidence');
  return totals;
}
