import { readFileSync } from 'node:fs';
import { CONTINUATION, continuationTotals } from '../../scripts/hosted-next-continuation.mjs';
import { THIRD, thirdTotals } from '../../scripts/hosted-next-third.mjs';

// Committed safe evidence only. No private file or service is read by fixtures.
export const historyText = readFileSync(new URL('../../docs/measurements/hosted-next-preview-setup.json', import.meta.url), 'utf8');
export const secondHistoryText = readFileSync(new URL('../../docs/measurements/hosted-next-continuation-preview-setup.json', import.meta.url), 'utf8');
export function originalPublication(backend) {
  const evidence = JSON.parse(historyText);
  return { version: 1, runId: CONTINUATION.predecessorRunId, sourceCommit: CONTINUATION.predecessorSourceCommit,
    publication: 'stopped', failedPhase: 'effective environment', creationState: 'ownership verified',
    vercel: { teamSlug: 'nomokaro625-9385s-projects', teamId: 'team_fmwIPLne9w30y7G5JQrs3fzl',
      projectId: 'prj_uOMK1a4PLAgsDr1A16InuImM1M3q', target: 'preview', ready: true,
      deploymentId: CONTINUATION.predecessorDeploymentId,
      url: 'https://attendance-tracker-i4pe4p75r-nomokaro625-9385s-projects.vercel.app' },
    backend: structuredClone(backend), counters: structuredClone(evidence.counters), cleanup: structuredClone(evidence.cleanup) };
}
export function readyContinuationPublication(manifest) {
  return { version: 1, passed: true, cancelled: false, runId: manifest.runId, sourceCommit: manifest.sourceCommit,
    deploymentId: manifest.vercel.deploymentId, uniqueUrl: manifest.vercel.url,
    continuation: structuredClone(CONTINUATION), counters: structuredClone(manifest.counters),
    cumulative: continuationTotals(manifest.counters, 1), creationRequests: 1, productionMutationRequested: false,
    productionTargetUnchanged: true, productionAliasBindingsUnchanged: true,
    environmentVerified: { build: true, runtime: true, credentialOverrides: true }, cleanup: {} };
}
export function secondPublication(backend) {
  const evidence = JSON.parse(secondHistoryText), first = originalPublication(backend);
  return { ...first, runId: evidence.runId, sourceCommit: evidence.sourceCommit,
    continuation: structuredClone(CONTINUATION),
    vercel: { ...first.vercel, deploymentId: evidence.deploymentId, url: 'https://second-fixture.vercel.app' },
    counters: structuredClone(evidence.counters), cumulative: structuredClone(evidence.cumulative),
    cleanup: structuredClone(evidence.cleanup), failure: structuredClone(evidence.failure) };
}
export function readyThirdPublication(manifest) {
  return { ...readyContinuationPublication(manifest), continuation: undefined,
    thirdContinuation: structuredClone(THIRD), preflight: structuredClone(manifest.preflight),
    cumulative: thirdTotals(manifest.counters, 1, manifest.preflight.controlRequests), gitDisconnectPreserved: true };
}
export function vercelCreditFixture(now = Date.now()) {
  return { teamId: 'team_fmwIPLne9w30y7G5JQrs3fzl', teamSlug: 'nomokaro625-9385s-projects',
    plan: 'pro', source: 'vercel-dashboard-agent-observation', observedAt: new Date(now).toISOString(),
    periodStart: new Date(now - 86400000).toISOString(), periodEnd: new Date(now + 29 * 86400000).toISOString(),
    includedCreditUsd: 20, usedCreditUsd: 0.01, creditReservationUsd: 1, otherReservationsUsd: 0.8,
    allTeamUsage: true, reportingLagAcknowledged: true, noOverageAuthorized: true };
}
