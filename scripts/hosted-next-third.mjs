// One separately reviewed third publication. Historical policies/records stay immutable.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
  minimumOtherReservationsUsd: 0.81,
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
export const PREVIEW_BACKEND_COMMIT = 'b06caabfe3f713c40160e28843695bcc65ac2a19';
// A deliberately narrow comparison of the committed pnpm v9 text, not a YAML
// parser. Keep every other package, snapshot, importer, override and patch byte.
// Only the reviewed Next/Lucide closure and Next peers in Vercel's two frontend
// packages may differ. The old commit fixes the audited dependency graph; this
// comparison retains all backend package integrity, peer and dependency bytes.
const frontendVersions = Object.freeze({
  next: ['16.4.3', '16.4.4'], 'lucide-react': ['1.61.0', '1.66.0'],
  'baseline-browser-mapping': ['2.11.33', '2.11.35'], 'caniuse-lite': ['1.0.30001819', '1.0.30001820'],
  semver: ['7.8.5', '7.8.6'], tslib: ['2.8.1', '2.9.1'],
});
export function backendLockProjection(text, current) {
  check(typeof text === 'string' && text.startsWith("lockfileVersion: '9.0'\n") &&
    Buffer.byteLength(text) <= 1024 * 1024, 'third_lock_format');
  let section = '', block = '';
  const next = current ? '16.4.4' : '16.4.3';
  return text.split('\n').map(line => {
    if (/^\S/.test(line)) { section = line; block = ''; }
    const header = (section === 'importers:' ? /^      (\S.*?):(?: \{\})?$/ : /^  (\S.*?):(?: \{\})?$/).exec(line);
    if (header) block = header[1].replace(/^'(.*)'$/, '$1');
    const name = block.startsWith('@') ? block.slice(0, block.indexOf('@', 1)) : block.split('@')[0];
    const changedPackage = Object.hasOwn(frontendVersions, name) || /^@next\/(?:env|swc-[a-z0-9-]+)$/.test(name);
    const frontend = section === 'importers:' ? ['next', 'lucide-react'].includes(block) :
      changedPackage || (section === 'snapshots:' && ['@swc/helpers', '@emnapi/runtime', 'sharp'].includes(name));
    if (frontend) {
      if (changedPackage && section === 'packages:' && /^    resolution: \{integrity: sha512-[A-Za-z0-9+/=]+\}$/.test(line))
        return '    resolution: {integrity: REVIEWED_FRONTEND}';
      for (const [dependency, versions] of Object.entries(frontendVersions))
        line = line.replaceAll(versions[Number(current)], `REVIEWED_${dependency}`);
      return line;
    }
    if (/^@vercel\/(?:analytics|speed-insights)(?:@|$)/.test(block))
      return line.replaceAll(`next@${next}(`, 'next@REVIEWED_NEXT(').replaceAll(`next: ${next}(`, 'next: REVIEWED_NEXT(');
    return line;
  }).join('\n');
}
export function validatePreviewBackendCompatibility(sourceCommit, backendCommit, git = args =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
    timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] })) {
  check(backendCommit === PREVIEW_BACKEND_COMMIT && /^[a-f0-9]{40}$/.test(sourceCommit ?? ''), 'third_backend_commit');
  // Includes every auth/gateway/access/attendance/operations/lib/patch byte.
  // migration.ts is an administrative import API, outside the hosted scenarios.
  git(['diff', '--exit-code', backendCommit, sourceCommit, '--', 'app', 'convex', 'lib', 'patches',
    'pnpm-workspace.yaml', 'convex.json', 'proxy.ts', 'next.config.ts', 'next.config.js', 'next.config.mjs',
    'vercel.json', 'tsconfig.json', ':(exclude)convex/migration.ts',
    // These Node-only release checks have no import into the Convex runtime.
    ':(exclude)app/api/release-readiness/route.ts', ':(exclude)lib/release-readiness.mjs']);
  const read = (commit, path) => git(['show', `${commit}:${path}`]);
  const packages = [backendCommit, sourceCommit].map((commit, i) => {
    const pkg = JSON.parse(read(commit, 'package.json'));
    check(pkg.dependencies?.next === (i ? '^16.4.4' : '^16.4.3') &&
      pkg.dependencies?.['lucide-react'] === (i ? '^1.66.0' : '^1.61.0'), 'third_frontend_versions');
    delete pkg.dependencies.next; delete pkg.dependencies['lucide-react'];
    return JSON.stringify(pkg);
  });
  check(packages[0] === packages[1], 'third_backend_package_changed');
  const locks = [backendCommit, sourceCommit].map((commit, i) => backendLockProjection(read(commit, 'pnpm-lock.yaml'), Boolean(i)));
  check(locks[0] === locks[1], 'third_backend_dependency_changed');
  return { backendCommit, sourceCommit, runtimeBytesEqual: true, backendDependencyClosureEqual: true,
    lockProjectionSha256: createHash('sha256').update(locks[0]).digest('hex'),
    excludedAdministrativeFile: 'convex/migration.ts', frontendVersions: { next: '16.4.4', lucide: '1.66.0' } };
}
// The owned development target was observed separately and is never a production target.
export const OWNED_DEVELOPMENT_PATHS = freeze({
  backend: '.convex/owned-development-validation/backend-manifest.json',
  manifest: '.convex/owned-development-validation/next-manifest.json',
  publication: 'docs/measurements/hosted-owned-development-setup.json',
  attempt: '.convex/owned-development-validation/runtime-attempt.json',
  evidence: 'docs/measurements/hosted-owned-development-verification.json',
});
export const AUTOMATION_PATHS = freeze({
  backend: OWNED_DEVELOPMENT_PATHS.backend,
  manifest: '.convex/owned-development-validation/automation-next-manifest.json',
  publication: 'docs/measurements/hosted-automation-next-setup.json',
  attempt: '.convex/owned-development-validation/automation-runtime-attempt.json',
  evidence: 'docs/measurements/hosted-automation-next-verification.json',
});
export const OWNED_FAILED_SHA256 = 'fe88f962830b821fd9f4836a71951473a0cf4900f68927d01e27d94b95390201';
export function validateOwnedFailed(text) {
  check(createHash('sha256').update(text).digest('hex') === OWNED_FAILED_SHA256, 'owned_failed_hash');
  const p = JSON.parse(text);
  check(p.passed === false && p.cancelled === false && p.failedPhase === 'readiness' &&
    p.cleanup?.ownershipVerified === true && p.cleanup.deploymentDeleted === true &&
    p.cleanup.capabilityInvalidatedByDeletion === true && p.cleanup.capabilityRevoked === false &&
    JSON.stringify(p.cumulative) === JSON.stringify({calls:91,nextCalls:3,controls:60,hosting:1,writes:381,gateway:7,creations:3}), 'owned_failed_evidence');
  return p;
}
export function validateAutomationProbe(p) {
  // Generation and confirmed revocation establish the supported mechanism.
  // Only signed readiness on the new candidate can establish its header access.
  check(p?.version === 1 && p.cancelled === false &&
    p.projectId === 'prj_uOMK1a4PLAgsDr1A16InuImM1M3q' && p.teamId === 'team_fmwIPLne9w30y7G5JQrs3fzl' &&
    p.protocol === 'project-automation-v1' && Number.isSafeInteger(p.controls) && p.controls > 0 && p.controls <= 7 && p.hosting === 2 &&
    ['baselineProtected','revocationConfirmed','preservedUnrelated','noResourceCreation'].every(k => p[k] === true) &&
    ((p.passed === true && p.headerAccepted === true && !p.failedPhase) ||
     (p.passed === false && p.headerAccepted === false && p.failedPhase === 'header')), 'automation_probe');
  return p;
}
export function validateFailedAutomationProbe(text) {
  check(createHash('sha256').update(text).digest('hex')==='db2b976648734a665275a28d7d170b9dca8cd95907668ff0b89265d46ee0f105','failed_automation_probe_hash');
  const p=JSON.parse(text);check(p.passed===false&&p.cancelled===false&&p.controls===4&&p.hosting===1&&p.failedPhase==='generate'&&p.noResourceCreation===true,'failed_automation_probe');return p;
}
export function automationTotals(c, probe, creations = 1) {
  validateAutomationProbe(probe);
  check(count(c?.controlRequests,20) && count(c?.hostingRequests,3) && count(c?.applicationCalls,1) && count(creations,1), 'automation_counts');
  return {calls:91+c.applicationCalls,nextCalls:3+c.applicationCalls,controls:64+probe.controls+c.controlRequests,
    hosting:2+probe.hosting+c.hostingRequests,writes:381,gateway:7,creations:3+creations};
}
export const OWNED_STOPPED_SHA256 = 'd0e85f65b9e42bcbea3792539819edd295a90cff8c13e057cc02196dcda82ef7';
export function validateOwnedStopped(text) {
  check(createHash('sha256').update(text).digest('hex') === OWNED_STOPPED_SHA256, 'owned_stopped_hash');
  const p = JSON.parse(text);
  check(p.passed === false && p.cancelled === false && p.failedPhase === 'live identities' &&
    p.failure?.category === 'http_status' && p.failure.httpStatus === 404 && p.creationRequests === 0 &&
    JSON.stringify(p.counters) === JSON.stringify({ controlRequests: 1, hostingRequests: 0, applicationCalls: 0 }) &&
    JSON.stringify(p.cumulative) === JSON.stringify({ calls: 63, nextCalls: 2, controls: 36, hosting: 0, writes: 355, gateway: 7, creations: 2 }), 'owned_stopped_evidence');
  return p;
}
export function validateOwnedBackend(m, sourceCommit) {
  const i = m?.managementIdentity, u = m?.setupUsage;
  check(m?.deploymentName === 'amicable-koala-816' && m.team === 'nomokaro625-9385-s-projects' &&
    m.project === 'convex-cyan-garden' && m.isNewDeployment === false && m.ownedEmptyDevelopment === true &&
    i?.id === 6789777 && i.projectId === 3365270 && i.kind === 'cloud' && i.name === 'amicable-koala-816' &&
    i.deploymentType === 'dev' && i.isDefault === false && i.reference === 'dev/vercel' &&
    i.deploymentUrl === 'https://amicable-koala-816.convex.cloud' && m.reference === i.reference &&
    m.cloudUrl === i.deploymentUrl && m.siteUrl === 'https://amicable-koala-816.convex.site' &&
    m.fingerprint === 'a3ceb7886db76f635b60fcb05541abfc3d7f425cb0322d2211afd2299eb037ba' &&
    m.publication === 'succeeded' && m.environmentConfigured === true && m.limitVerified === true &&
    m.adminCapabilityVerified === true && m.availabilityClosed === true && /^[a-f0-9]{40}$/.test(m.reviewedSourceCommit ?? '') &&
    /^[a-f0-9]{40}$/.test(sourceCommit ?? '') && count(u?.controlRequests, 20) && count(u?.applicationCalls, 40) &&
    count(u?.logicalWriteReservations, 40) && u.controlRequests > 0 && u.applicationCalls > 0 && u.logicalWriteReservations > 0 && typeof m.adminKey === 'string' && m.adminKey.length > 0 && m.adminKey.length <= 16384 &&
    !/[\u0000-\u001f\u007f]/.test(m.adminKey) && typeof m.config?.ATTENDANCE_GATEWAY_KEY === 'string' &&
    m.config.ATTENDANCE_GATEWAY_KEY.length >= 32 && typeof m.config?.ATTENDANCE_GATEWAY_AUDIENCE === 'string' &&
    m.config.ATTENDANCE_GATEWAY_AUDIENCE.length > 0, 'owned_backend_manifest');
  return { name: i.name, id: i.id, projectId: i.projectId, reference: i.reference,
    cloudUrl: m.cloudUrl, siteUrl: m.siteUrl, fingerprint: m.fingerprint };
}
export function validateOwnedCompatibility(sourceCommit, backendCommit, git = args => execFileSync('git', args, { encoding: 'utf8' })) {
  check(/^[a-f0-9]{40}$/.test(sourceCommit ?? '') && /^[a-f0-9]{40}$/.test(backendCommit ?? '') &&
    git(['rev-parse', 'HEAD']).trim() === sourceCommit, 'owned_backend_commit');
  git(['diff', '--exit-code', backendCommit, sourceCommit, '--', 'app', 'convex', 'lib', 'patches', 'package.json',
    'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'convex.json', 'proxy.ts', 'next.config.ts', 'next.config.js', 'next.config.mjs', 'vercel.json', 'tsconfig.json']);
  git(['diff', '--exit-code', sourceCommit, '--', 'app', 'convex', 'lib', 'patches', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'convex.json', 'proxy.ts', 'next.config.ts', 'next.config.js', 'next.config.mjs', 'vercel.json', 'tsconfig.json']);
  check(!git(['ls-files', '--others', '--exclude-standard', '--', 'app', 'convex', 'lib', 'patches', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'convex.json', 'proxy.ts', 'next.config.ts', 'next.config.js', 'next.config.mjs', 'vercel.json', 'tsconfig.json']).trim(), 'owned_untracked_core');
  return { backendCommit, sourceCommit, runtimeBytesEqual: true, backendDependencyClosureEqual: true, ownedDevelopment: true };
}
export function validateOwnedCanonical(canonical, backend) {
  check(canonical?.convexCloudUrl === backend.cloudUrl && canonical?.convexSiteUrl === backend.siteUrl, 'owned_canonical');
}
export function ownedTotals(c, u, creations = 1) {
  check(count(c?.controlRequests, 20) && count(c?.applicationCalls, 1) && count(c?.hostingRequests, 3) &&
    count(u?.controlRequests, 20) && count(u?.applicationCalls, 40) && count(u?.logicalWriteReservations, 40) && count(creations, 1), 'owned_counts');
  return { calls: 63 + u.applicationCalls + c.applicationCalls, nextCalls: 2 + c.applicationCalls,
    controls: 36 + u.controlRequests + c.controlRequests, hosting: c.hostingRequests,
    writes: 355 + u.logicalWriteReservations, gateway: 7, creations: 2 + creations };
}
export function validateArchiveSourceBinding(value, sourceCommit) {
  check(value?.metadata?.sourceCommit === sourceCommit && /^[a-f0-9]{40}$/.test(sourceCommit ?? '') &&
    /^[a-f0-9]{40}$/.test(value.metadata.sourceTree ?? '') && /^[a-f0-9]{40}$/.test(value.sha1 ?? '') &&
    /^[a-f0-9]{64}$/.test(value.sha256 ?? '') && /^[a-f0-9]{64}$/.test(value.metadata.contentManifestSha256 ?? '') &&
    value.uploadSubmitted === true && value.uploadAcknowledged === true && value.creationSubmitted === true &&
    value.metadata.version === 1 && value.metadata.format === 'tar+gzip' &&
    Array.isArray(value.contentManifest) && value.contentManifest.length > 0 && value.contentManifest.length <= 512 &&
    value.contentManifest.length === value.metadata.fileCount &&
    createHash('sha256').update(JSON.stringify(value.contentManifest)).digest('hex') === value.metadata.contentManifestSha256 &&
    Number.isSafeInteger(value.metadata.archiveBytes) && value.metadata.archiveBytes > 0 && value.metadata.archiveBytes <= 4 * 1024 * 1024 &&
    JSON.stringify(value.files) === JSON.stringify([{ file: '.vercel/source.tgz.part1', size: value.metadata.archiveBytes, mode: 438, sha: value.sha1 }]) &&
    JSON.stringify(value.creationFiles) === JSON.stringify(value.files), 'third_archive_binding');
  return true;
}
export function validateArchiveDeployment(deployment, archive, sourceCommit) {
  validateArchiveSourceBinding(archive, sourceCommit);
  check(deployment.gitSource == null && deployment.gitMetadata == null && deployment.meta?.githubCommitSha === undefined &&
    deployment.meta?.attendanceArchiveSha256 === archive.sha256 &&
    deployment.meta?.attendanceArchiveSha1 === archive.sha1 &&
    deployment.meta?.attendanceSourceTree === archive.metadata.sourceTree, 'third_archive_source');
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
    report.gitDisconnectPreserved === true && !manifest.vercel.requireGitSource &&
    JSON.stringify(report.sourceArchive) === JSON.stringify(manifest.vercel.sourceArchive) &&
    JSON.stringify(report.backendCompatibility) === JSON.stringify(manifest.backendCompatibility) &&
    report.environmentVerified?.build === true && report.environmentVerified.runtime === true &&
    report.environmentVerified.credentialOverrides === true && !report.cleanup?.deploymentDeleted &&
    JSON.stringify(report.preflight) === JSON.stringify(manifest.preflight) &&
    JSON.stringify(report.counters) === JSON.stringify(manifest.counters) &&
    JSON.stringify(report.cumulative) === JSON.stringify(totals) && JSON.stringify(manifest.cumulative) === JSON.stringify(totals),
  'third_publication_evidence');
  validateArchiveSourceBinding(manifest.vercel.sourceArchive, manifest.sourceCommit);
  check(manifest.backendCompatibility?.backendCommit === PREVIEW_BACKEND_COMMIT &&
    manifest.backendCompatibility.sourceCommit === manifest.sourceCommit &&
    manifest.backendCompatibility.runtimeBytesEqual === true &&
    manifest.backendCompatibility.backendDependencyClosureEqual === true, 'third_backend_compatibility');
  return totals;
}
