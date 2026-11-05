import { readFileSync } from 'node:fs';
import { CONTINUATION, continuationTotals } from '../../scripts/hosted-next-continuation.mjs';

// Committed safe evidence only. No private file or service is read by fixtures.
export const historyText = readFileSync(new URL('../../docs/measurements/hosted-next-preview-setup.json', import.meta.url), 'utf8');
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
