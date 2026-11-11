#!/usr/bin/env node
import { AUTOMATION_PATH, automationRevokeBody, verifyAutomationRevoked } from './vercel-automation-access.mjs';
import { AUTOMATION_PATHS, OWNED_FAILED_SHA256, validateOwnedFailed, validateAutomationProbe, validateFailedAutomationProbe, validateFailedAutomationPublication, automationTotals } from './hosted-next-third.mjs';
// Opt-in, one-attempt verification. Importing this file performs no I/O.
import { readFile, open, constants, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes, createPrivateKey, sign, createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { BaseConvexClient, ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { signReadinessRequest, verifyReadinessResponse } from '../lib/release-readiness.mjs';
import { readQuotaReview } from './hosted-validation-policy.mjs';
import { persistHostedReports } from './test-hosted-preview.mjs';
import * as publisher from './prepare-hosted-next.mjs';
import { CONTINUATION, ORIGINAL_PATHS, CONTINUATION_PATHS, validateContinuationHistory,
  validateContinuationSnapshot, continuationTotals, validateContinuationPublication } from './hosted-next-continuation.mjs';
import { THIRD, THIRD_PATHS, vercelCreditReviewPath, validateThirdSnapshot, validateThirdHistory,
  validateThirdPublication, validateThirdPreflight, thirdTotals, validateVercelCreditReview, validateArchiveSourceBinding,
  OWNED_DEVELOPMENT_PATHS, OWNED_STOPPED_SHA256, validateOwnedStopped, validateOwnedBackend, validateOwnedCompatibility, validateOwnedCanonical, ownedTotals } from './hosted-next-third.mjs';

export const PREBUILT_PATHS = Object.freeze({ manifest: '.convex/hosted-validation/prebuilt-preview-manifest.json',
  publication: 'docs/measurements/hosted-next-prebuilt-setup.json', attempt: '.convex/hosted-validation/prebuilt-runtime-attempt.json',
  evidence: 'docs/measurements/hosted-next-prebuilt-verification.json' });
const STOPPED_PUBLICATION_SHA256 = '5529e1af2f30e5fdd7e79f6bee1fe05f62c027c6c4e2c2274ace6a76121fecdd';
const STOPPED_SOURCE = '61a88ecd0672d971d77100d59226400f5e27bb9e';

export const FINGERPRINT = 'a3ceb7886db76f635b60fcb05541abfc3d7f425cb0322d2211afd2299eb037ba';
const TEAM = 'nomokaro625-9385s-projects';
const TEAM_ID = 'team_fmwIPLne9w30y7G5JQrs3fzl';
const PROJECT = 'prj_uOMK1a4PLAgsDr1A16InuImM1M3q';
const directory = '.convex/hosted-validation';
const backendPath = `${directory}/preview-setup-manifest.json`;
const priorPath = 'docs/measurements/hosted-backend-verification.json';
const AUTH_NAMES = ['__Host-__convexAuthJWT', '__Host-__convexAuthRefreshToken', '__Host-__convexAuthOAuthVerifier'];
class GateError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new GateError(code); };
const check = (value, code) => { if (!value) fail(code); };
const count = value => Number.isSafeInteger(value) && value >= 0;
const identity = value => (typeof value === 'string' && value.length > 0 && value.length <= 128) ||
  (Number.isSafeInteger(value) && value > 0);
const record = value => value && typeof value === 'object' && !Array.isArray(value);

export function parseArgs(args) {
  const continued = args.length === 6 && args[4] === '--continue-after' && args[5] === CONTINUATION.predecessorDeploymentId;
  const third = args.length === 6 && args[4] === '--continue-after' && args[5] === THIRD.predecessorDeploymentId;
  const automation = args.length === 6 && args[4] === '--automation-owned-release' && /^[a-f0-9]{40}$/.test(args[5]);
  const owned = automation || args.length === 6 && args[4] === '--owned-development-release' && /^[a-f0-9]{40}$/.test(args[5]);
  const prebuilt = owned || (args.length === 6 && args[4] === '--prebuilt-release' && /^[a-f0-9]{40}$/.test(args[5]));
  check((args.length === 4 || continued || third || prebuilt) && args[0] === '--expected-vercel-deployment' &&
    /^dpl_[A-Za-z0-9]+$/.test(args[1]) && args[2] === '--expected-preview' &&
    /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(args[3]), 'invalid_arguments');
  check(!owned || args[3] === 'amicable-koala-816', 'owned_target');
  return { deploymentId: args[1], backendName: args[3], ...(owned ? { ownedDevelopment: true } : {}), ...(automation ? { automationOwnedRelease: true } : {}), ...(continued ? { continuation: true } : {}), ...(third || prebuilt ? { third: true } : {}), ...(prebuilt ? { prebuilt: true, sourceCommit: args[5] } : {}) };
}

export function validateManifest(m, expected, now = Date.now()) {
  const v = m?.vercel, b = m?.backend, a = m?.access, c = m?.counters;
  check(m?.version === 1 && m.publication === 'ready' && /^[a-f0-9]{40}$/.test(m.sourceCommit ?? '') &&
    /^attendance-next-[a-f0-9]{32}$/.test(m.runId ?? ''), 'manifest_state');
  if (expected.third) {
    validateThirdSnapshot(m.thirdContinuation);
    if (expected.prebuilt) {
      validatePrebuiltPreflight(m.preflight);
      check(m.sourceCommit === expected.sourceCommit && m.environmentVerification?.method === 'local-prebuilt+signed-runtime-v1' &&
        m.environmentVerification.sourceCommit === m.sourceCommit && /^[a-f0-9]{64}$/.test(m.environmentVerification.outputSha256 ?? '') &&
        m.environmentVerification.readinessVerified === true && v?.sourcePrebuilt?.sourceCommit === m.sourceCommit &&
        v.sourcePrebuilt.outputSha256 === m.environmentVerification.outputSha256 && v.sourcePrebuilt.target === 'preview' &&
        !m.environmentVerified, 'prebuilt_environment_binding');
    } else { validateThirdPreflight(m.preflight); validateArchiveSourceBinding(v?.sourceArchive, m.sourceCommit); }
    check(!m.continuation && !v?.requireGitSource &&
      ![CONTINUATION.predecessorDeploymentId, THIRD.predecessorDeploymentId].includes(v?.deploymentId) &&
      v?.deploymentId !== m.preflight.deploymentId &&
      ![CONTINUATION.predecessorRunId, THIRD.predecessorRunId].includes(m.runId), 'third_reuses_predecessor');
  } else if (expected.continuation) {
    validateContinuationSnapshot(m.continuation);
    check(v?.deploymentId !== CONTINUATION.predecessorDeploymentId && m.runId !== CONTINUATION.predecessorRunId,
      'continuation_reuses_predecessor');
  }
  else check(!m.continuation && !m.thirdContinuation, 'continuation_mode_required');
  if (!expected.prebuilt) check(m.environmentVerified?.build === true && m.environmentVerified.runtime === true &&
    m.environmentVerified.credentialOverrides === true, 'environment_not_verified');
  check(v?.teamSlug === TEAM && v.teamId === TEAM_ID && v.projectId === PROJECT &&
    v.deploymentId === expected.deploymentId && /^dpl_[A-Za-z0-9]+$/.test(v.deploymentId) &&
    v.target === 'preview' && v.ready === true, 'vercel_binding');
  let url;
  try { url = new URL(v.url); } catch { fail('vercel_url'); }
  check(url.protocol === 'https:' && !url.username && !url.password && !url.port &&
    url.pathname === '/' && !url.search && !url.hash &&
    /^[a-z0-9-]+\.vercel\.app$/.test(url.hostname), 'vercel_url');
  check(b?.name === expected.backendName && /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(b.name) &&
    identity(b.id) && identity(b.projectId) &&
    (expected.ownedDevelopment ? b.id === 6789777 && b.projectId === 3365270 && b.reference === 'dev/vercel' && m.ownedDevelopment === true : /^preview\/attendance-validation-[a-f0-9]{32}$/.test(b.reference ?? '')) &&
    b.cloudUrl === `https://${b.name}.convex.cloud` && b.siteUrl === `https://${b.name}.convex.site` &&
    b.fingerprint === FINGERPRINT, 'backend_binding');
  const expiry = Date.parse(a?.expiresAt);
  check((expected.automationOwnedRelease ? a?.kind === 'project-automation' && a.projectId === PROJECT && /^[a-f0-9]{32}$/.test(a.token ?? '') && a.providerExpires === false && m.automationOwnedRelease === true : a?.kind === 'deployment-shareable') && typeof a.token === 'string' && a.token.length > 0 &&
    a.token.length <= 16384 && !/[\u0000-\u0020\u007f]/.test(a.token) &&
    Number.isFinite(expiry) && expiry > now + 180000 && expiry <= now + 900000 &&
    a.headerVerified === true, 'access_binding');
  check(count(c?.controlRequests) && c.controlRequests <= 20 && count(c?.hostingRequests) &&
    c.hostingRequests <= (expected.prebuilt ? 3 : 2) && c.applicationCalls === 1, 'publisher_counters');
  return true;
}


export function validatePrebuiltPreflight(value) {
  check(value?.status === 'replaced-by-signed-runtime' && value.controlRequests === 2 &&
    /^dpl_[A-Za-z0-9]+$/.test(value.deploymentId ?? ''), 'prebuilt_preflight');
  return value;
}
export function validateStoppedThird(text, manifest) {
  check(typeof text === 'string' && manifest.previousStoppedPublicationSha256 === STOPPED_PUBLICATION_SHA256 &&
    createHash('sha256').update(text).digest('hex') === STOPPED_PUBLICATION_SHA256, 'prebuilt_stopped_hash');
  const r = JSON.parse(text);
  validateThirdSnapshot(r.thirdContinuation);
  check(r.version === 1 && r.passed === false && r.cancelled === false && r.sourceCommit === STOPPED_SOURCE &&
    r.failedPhase === 'existing deployment compatibility' && r.failure?.category === 'http_status' && r.failure.httpStatus === 400 &&
    r.creationRequests === 0 && r.productionMutationRequested === false && r.preflight?.status === 'pending' &&
    r.preflight.controlRequests === 2 && r.preflight.deploymentId === manifest.preflight.deploymentId &&
    JSON.stringify(r.counters) === JSON.stringify({ controlRequests: 0, hostingRequests: 0, applicationCalls: 0 }) &&
    JSON.stringify(r.cumulative) === JSON.stringify({ calls: 63, nextCalls: 2, controls: 35, hosting: 0, writes: 355, gateway: 7, creations: 2 }), 'prebuilt_stopped_evidence');
  return true;
}
export function validatePrebuiltPublication(report, manifest, ownedDevelopment = false, automation = false) {
  check(report?.version === 1 && report.passed === true && report.cancelled === false && !report.failedPhase &&
    report.runId === manifest.runId && report.sourceCommit === manifest.sourceCommit &&
    report.deploymentId === manifest.vercel.deploymentId && report.uniqueUrl === manifest.vercel.url &&
    report.creationRequests === 1 && report.productionMutationRequested === false &&
    report.productionTargetUnchanged === true && report.productionAliasBindingsUnchanged === true &&
    report.gitDisconnectPreserved === true && !report.cleanup?.deploymentDeleted &&
    report.previousStoppedPublicationSha256 === manifest.previousStoppedPublicationSha256 &&
    JSON.stringify(report.environmentVerification) === JSON.stringify(manifest.environmentVerification) &&
    JSON.stringify(report.sourcePrebuilt) === JSON.stringify(manifest.vercel.sourcePrebuilt) &&
    JSON.stringify(report.backendCompatibility) === JSON.stringify(manifest.backendCompatibility) &&
    JSON.stringify(report.preflight) === JSON.stringify(manifest.preflight) &&
    JSON.stringify(report.counters) === JSON.stringify(manifest.counters) &&
    JSON.stringify(report.cumulative) === JSON.stringify(manifest.cumulative), 'prebuilt_publication_evidence');
  const c = manifest.counters;
  check(JSON.stringify(manifest.cumulative) === JSON.stringify(automation ? automationTotals(c, manifest.automationProbe) : ownedDevelopment ? ownedTotals(c, manifest.setupUsage) : { calls: 63 + c.applicationCalls, nextCalls: 2 + c.applicationCalls,
    controls: 35 + c.controlRequests, hosting: c.hostingRequests, writes: 355, gateway: 7, creations: 3 }), 'prebuilt_cumulative');
  if (ownedDevelopment) check(report.ownedDevelopment === true && report.previousPrebuiltSha256 === OWNED_STOPPED_SHA256 && manifest.previousPrebuiltSha256 === OWNED_STOPPED_SHA256 && /^[a-f0-9]{64}$/.test(manifest.backendManifestSha256 ?? '') && report.backendManifestSha256 === manifest.backendManifestSha256 && JSON.stringify(report.setupUsage) === JSON.stringify(manifest.setupUsage), 'owned_publication_binding');
  if (automation) check(report.automationOwnedRelease === true && report.previousOwnedFailedSha256 === OWNED_FAILED_SHA256 && manifest.previousOwnedFailedSha256 === OWNED_FAILED_SHA256 && JSON.stringify(report.automationProbe) === JSON.stringify(manifest.automationProbe) && report.providerExpires === false, 'automation_publication_binding');
  validateThirdSnapshot(report.thirdContinuation);
  return true;
}

export function validatePrebuiltDeployment(d, manifest, { requireReady = true } = {}) {
      check(d?.id === manifest.vercel.deploymentId && [d.ownerId, d.teamId, d.team?.id].some(x => x === TEAM_ID) &&
        [d.ownerId, d.teamId, d.team?.id].filter(x => x !== undefined).every(x => x === TEAM_ID) &&
        [d.projectId, d.project?.id].some(x => x === PROJECT) && [d.projectId, d.project?.id].filter(x => x !== undefined).every(x => x === PROJECT) &&
        [null, 'preview'].includes(d.target) && !d.customEnvironment && (!requireReady || d.readyState === 'READY') &&
        `https://${d.url}` === manifest.vercel.url && d.meta?.attendanceValidation === manifest.runId &&
        d.meta?.attendanceSourceCommit === manifest.sourceCommit &&
        d.meta?.attendanceOutputSha256 === manifest.environmentVerification.outputSha256, 'prebuilt_deployment_binding');
  return true;
}

export function validatePriorEvidence(prior, backend, manifest) {
  check(prior?.version === 1 && prior.passed === true && prior.backendOnly === true &&
    prior.cancelled === false && !prior.failedPhase && prior.calls?.submitted === 61 &&
    prior.calls.settledLocally === 61 && prior.fixtureWriteUpperReservations === 355 &&
    prior.studentGatewayCalls === 7 && prior.cleanup?.availabilityClosed === true &&
    prior.cleanup.closureAcknowledged === true && prior.cleanup.clientsClosed === true &&
    prior.syntheticFingerprint === FINGERPRINT && prior.deploymentName === manifest.backend.name &&
    prior.sourceCommit === backend.reviewedSourceCommit &&
    Object.values(prior.assertions ?? {}).length > 0 && Object.values(prior.assertions).every(x => x === true),
  'prior_backend_evidence');
  const binding = publisher.validateBackendManifest(backend, manifest.backend.name);
  check(Object.keys(binding).every(key => binding[key] === manifest.backend[key]), 'backend_manifest_mismatch');
  return { calls: 61, writes: 355, gateway: 7, sourceCommit: prior.sourceCommit,
    closed: true, rootControlPreflight: 1 };
}

// Counters never reset between the backend rehearsal, publisher and runtime.
export function createBudget(publisherCounters, { now = () => performance.now(), continuation, thirdContinuation, preflight, prebuilt = false, ownedDevelopment = false, setupUsage, automation = false, probe } = {}) {
  check(count(publisherCounters?.controlRequests) && publisherCounters.controlRequests <= 20 &&
    count(publisherCounters?.hostingRequests) && publisherCounters.hostingRequests <= (prebuilt ? 3 : 2) &&
    publisherCounters.applicationCalls === 1, 'publisher_counters');
  const start = now();
  if (continuation) validateContinuationSnapshot(continuation);
  if (thirdContinuation) { check(!continuation, 'third_budget_mode'); validateThirdSnapshot(thirdContinuation); if (prebuilt) validatePrebuiltPreflight(preflight); else validateThirdPreflight(preflight); }
  const seed = automation ? automationTotals(publisherCounters, probe) : ownedDevelopment ? ownedTotals(publisherCounters, setupUsage) : thirdContinuation ? (prebuilt ? { calls: 63 + publisherCounters.applicationCalls, nextCalls: 2 + publisherCounters.applicationCalls, controls: 35 + publisherCounters.controlRequests, hosting: publisherCounters.hostingRequests, creations: 3 } : thirdTotals(publisherCounters, 1, preflight.controlRequests)) : continuation ? continuationTotals(publisherCounters, 1) : {
    calls: 62, nextCalls: 1, controls: 1 + publisherCounters.controlRequests, hosting: publisherCounters.hostingRequests };
  const totals = { calls: seed.calls, writes: ownedDevelopment ? seed.writes : 355, gateway: 7, control: seed.controls,
    hosting: seed.hosting, nextCalls: seed.nextCalls, nextGateway: 0, runnerControl: 0,
    ...(continuation || thirdContinuation ? { creations: seed.creations } : {}) };
  let ordinaryWrites = totals.writes, cleanupWrites = 0;
  const snapshot = () => ({ ...totals });
  function reserve({ kind, writes = 0, gateway = false, cleanup = false }) {
    const elapsed = now() - start;
    check(Number.isFinite(elapsed) && elapsed >= 0 && elapsed < (cleanup ? 180000 : 130000), 'deadline');
    check(count(writes) && typeof gateway === 'boolean' && typeof cleanup === 'boolean' &&
      ['application', 'control', 'hosting'].includes(kind), 'invalid_reservation');
    check(kind === 'application' || (writes === 0 && !gateway), 'invalid_reservation');
    const next = snapshot();
    const nextOrdinaryWrites = ordinaryWrites + (cleanup ? 0 : writes), nextCleanupWrites = cleanupWrites + (cleanup ? writes : 0);
    if (kind === 'application') { next.calls++; next.nextCalls++; next.writes += writes;
      if (gateway) { next.gateway++; next.nextGateway++; } }
    if (kind === 'control') { next.control++; next.runnerControl++; }
    if (kind === 'hosting') next.hosting++;
    check(next.calls <= 200 && next.nextCalls <= (automation ? 45 : 40) && next.writes <= (ownedDevelopment ? 750 : 700) && nextOrdinaryWrites <= (ownedDevelopment ? 650 : 600) && nextCleanupWrites <= 100 &&
      next.gateway <= 20 && next.nextGateway <= 13 && next.control <= (automation ? 130 : ownedDevelopment ? 100 : thirdContinuation ? 80 : continuation ? 60 : 40) && next.runnerControl <= 19 &&
      next.hosting <= (ownedDevelopment || thirdContinuation ? 50 : 100), 'budget_exceeded');
    Object.assign(totals, next);
    ordinaryWrites = nextOrdinaryWrites; cleanupWrites = nextCleanupWrites;
    return snapshot();
  }
  return { reserve, snapshot };
}

// No cookie values or token claims escape the caller's in-memory actor record.
export function inspectAuthCookies(lines, { deleted = false } = {}) {
  check(Array.isArray(lines) && lines.length === 3, 'auth_cookie_count');
  const values = new Map();
  for (const line of lines) {
    check(typeof line === 'string' && !/[\r\n]/.test(line), 'auth_cookie_format');
    const parts = line.split(';').map(x => x.trim()), separator = parts[0].indexOf('=');
    check(separator > 0, 'auth_cookie_format');
    const name = parts[0].slice(0, separator), value = parts[0].slice(separator + 1);
    const attrs = new Map(parts.slice(1).map(part => { const index = part.indexOf('=');
      return index < 0 ? [part.toLowerCase(), true] : [part.slice(0, index).toLowerCase(), part.slice(index + 1)]; }));
    check(AUTH_NAMES.includes(name) && !values.has(name) && attrs.get('httponly') === true &&
      attrs.get('secure') === true && attrs.get('samesite')?.toLowerCase() === 'lax' &&
      attrs.get('path') === '/' && !attrs.has('domain'), 'auth_cookie_attributes');
    const clears = value === '' && Date.parse(attrs.get('expires')) === 0;
    if (deleted || name === AUTH_NAMES[2]) check(clears, 'auth_cookie_not_deleted');
    else check(value.length > 0 && value.length <= 16384 && !/[\u0000-\u0020\u007f;,]/.test(value) &&
      /^\d+$/.test(attrs.get('max-age') ?? '') && Number(attrs.get('max-age')) <= 30 * 86400 &&
      Number(attrs.get('max-age')) > 0, 'auth_cookie_lifetime');
    values.set(name, value);
  }
  return { token: values.get(AUTH_NAMES[0]), refresh: values.get(AUTH_NAMES[1]),
    attributesVerified: true, deleted };
}

// Preview-only conformance fixture, after the managed token has passed viewer.
// Keep its issuer, audience, subject and fixed session deadline; shorten only JWT time.
export function createShortJwtFixture(token, backend, now) {
  try {
    const [head, payload, signature] = token.split('.');
    const header = JSON.parse(Buffer.from(head, 'base64url')), claims = JSON.parse(Buffer.from(payload, 'base64url'));
    check(signature && header.alg === 'RS256' && ((backend.isNewDeployment === true &&
      backend.managementIdentity?.deploymentType === 'preview') || (validateOwnedBackend(backend, backend.reviewedSourceCommit) && backend.ownedEmptyDevelopment === true)) && claims.iss === backend.siteUrl &&
      claims.aud === 'convex' && typeof claims.sub === 'string' && claims.sub.split('|').every(Boolean) &&
      claims.sub.split('|').length === 2 && Number.isSafeInteger(claims.sessionExpiresAt) &&
      claims.sessionExpiresAt > now && Number.isFinite(now), 'short_jwt_fixture');
    const pem = backend.config.JWT_PRIVATE_KEY.replace(/-----BEGIN PRIVATE KEY-----\s+([\s\S]+?)\s+-----END PRIVATE KEY-----/,
      (_, body) => `-----BEGIN PRIVATE KEY-----\n${body.replace(/\s/g, '')}\n-----END PRIVATE KEY-----`);
    const key = createPrivateKey(pem);
    check(key.asymmetricKeyType === 'rsa' && key.asymmetricKeyDetails.modulusLength === 2048, 'short_jwt_fixture');
    const exp = Math.floor(now / 1000) + 15;
    const input = `${head}.${Buffer.from(JSON.stringify({ ...claims, iat: Math.floor(now / 1000), exp })).toString('base64url')}`;
    return { token: `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`, expiresAt: exp * 1000 };
  } catch { fail('short_jwt_fixture'); }
}

export function assertPublicResponse(value, { kind, status }) {
  check(record(value), 'public_response_shape');
  const allowed = status !== 200 ? ['error'] : kind === 'checkin' ? ['name', 'already'] : ['title', 'closed'];
  check(Object.keys(value).every(key => allowed.includes(key)), 'public_response_privacy');
  if (status !== 200) check(Object.keys(value).length === 1 && typeof value.error === 'string' &&
    value.error.length > 0 && value.error.length <= 256, 'public_error_shape');
  else if (kind === 'checkin') check(typeof value.name === 'string' && value.name.length <= 160 &&
    (value.already === undefined || typeof value.already === 'boolean'), 'checkin_shape');
  else check(typeof value.title === 'string' && value.title.length <= 100 && typeof value.closed === 'boolean', 'public_metadata_shape');
}

// The installed CLI reads tableData with exactly this component/pagination shape.
// A partial page is insufficient evidence; do not scan further or retain raw rows.
export async function readAdminTable(queryPage, table) {
  check(['throttleCounters', 'authSessions'].includes(table), 'admin_table');
  const result = await queryPage('_system/cli/tableData', {
    table, order: 'asc', paginationOpts: { cursor: null, numItems: 100 },
  }, { componentPath: '' });
  check(record(result) && Array.isArray(result.page) && result.page.length <= 100 && result.isDone === true,
    'admin_observation_partial_or_unsupported');
  check(result.page.every(record), 'admin_observation_shape');
  return result.page;
}

export function counterSnapshot(rows, legacyId) {
  check(Array.isArray(rows) && rows.length <= 100 && /^[a-f0-9]{32}$/.test(legacyId), 'counter_observation');
  const counters = new Map();
  for (const row of rows) {
    check(typeof row.key === 'string' && Number.isSafeInteger(row.bucket) && count(row.count), 'counter_shape');
    // Exact identity counters avoid random quota partitions changing between proofs.
    const match = /^student:([a-f0-9]{64}):([a-f0-9]{64})$/.exec(row.key);
    if (match) {
      const key = `${row.key}:${row.bucket}`;
      check(!counters.has(key), 'counter_duplicate');
      counters.set(key, { ip: match[1], identity: match[2], bucket: row.bucket, count: row.count });
    }
  }
  return counters;
}

export function compareIpObservations(snapshots) {
  check(Array.isArray(snapshots) && snapshots.length === 4 && snapshots.every(x => x instanceof Map), 'ip_observations');
  let previous;
  for (let i = 1; i < snapshots.length; i++) {
    const before = snapshots[i - 1], after = snapshots[i], deltas = [];
    for (const [key, row] of after) {
      const delta = row.count - (before.get(key)?.count ?? 0);
      if (delta !== 0) deltas.push({ ...row, delta });
    }
    check(deltas.length === 1 && deltas[0].delta === 1, 'ip_observation_ambiguous');
    const current = deltas[0];
    check(!previous || (current.ip === previous.ip && current.identity === previous.identity &&
      current.bucket === previous.bucket), 'forwarded_ip_identity_changed');
    previous = current;
  }
  return { status: 'verified', controlledRequests: 3, unchangedCounterIdentity: true,
    retainedSensitiveObservations: false };
}

export async function boundedFetch(url, init, { fetchImpl = fetch, timeoutMs = 10000, signal } = {}) {
  const response = await fetchImpl(url, { ...init, redirect: init.redirect === 'manual' ? 'manual' : 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
  check(response.status >= 200 && response.status <= 599, 'http_status');
  const chunks = []; let size = 0;
  const reader = response.body?.getReader();
  if (reader) try {
    for (;;) { const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength; check(size <= 1024 * 1024, 'response_size'); chunks.push(Buffer.from(next.value)); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return { status: response.status, headers: response.headers, bytes: Buffer.concat(chunks) };
}
const jsonBody = response => {
  check(/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? ''), 'response_json_content_type');
  try { return JSON.parse(response.bytes.toString('utf8')); } catch { fail('response_json'); }
};

export function createOneShotRpc({ cloudUrl, adminKey, transport }) {
  return async ({ kind, name, args, token, admin }) => {
    let sent = false;
    const client = new ConvexHttpClient(cloudUrl, { logger: false, fetch: async (input, init) => {
      const url = new URL(String(input));
      check(!sent && url.origin === cloudUrl && url.pathname === `/api/${kind}` && !url.search, 'sdk_retry_or_target');
      sent = true;
      const response = await transport(url.href, init);
      if (response.status === 401) fail('convex_http_401');
      return new Response(response.bytes, { status: response.status, headers: response.headers });
    } });
    client.setDebug(false);
    if (admin) client.setAdminAuth(adminKey); else if (token) client.setAuth(token);
    return client[kind](makeFunctionReference(name), args);
  };
}

async function within(promise, timeoutMs) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new GateError('operation_timeout')), timeoutMs);
  })]); } finally { clearTimeout(timer); }
}

export async function browserOperation(operation, timeoutMs, signal) {
  check(Number.isFinite(timeoutMs) && timeoutMs > 0, 'browser_deadline');
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(new GateError('browser_cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
  try {
    return await within(Promise.race([Promise.resolve().then(() => {
      check(!signal?.aborted, 'browser_cancelled'); return operation();
    }), cancelled]), timeoutMs);
  } finally { signal?.removeEventListener('abort', abort); }
}

// Only the supported CLI system-query transport uses a socket. Each query owns
// one connection; a second connection is blocked, recorded and fatal. Callback
// count and outgoing query registrations are observed separately from connects.
export function createAdminReader({ cloudUrl, adminKey, timeout, reserve, observation, fatal,
  Client = BaseConvexClient, Socket } = {}) {
  return async (name, args, options) => {
    check(name === '_system/cli/tableData' && options?.componentPath === '', 'admin_query');
    reserve();
    const require = createRequire(import.meta.url);
    const NodeSocket = Socket ?? require(require.resolve('ws', { paths: [require.resolve('convex')] }));
    let connections = 0, registrations = 0, closing = false, client, unsubscribe, settle, rejectResult;
    const sockets = [];
    const result = new Promise((yes, no) => { settle = yes; rejectResult = no; });
    const bad = code => { fatal(code); rejectResult(new GateError(code)); };
    class RefusedSocket {
      readyState = 3; CLOSED = 3; OPEN = 1; CONNECTING = 0; CLOSING = 2;
      onopen = null; onclose = null; onmessage = null; onerror = null;
      constructor() { queueMicrotask(() => this.onclose?.({ code: 1000, reason: '', wasClean: true })); }
      close() {} send() {} addEventListener() {} removeEventListener() {}
    }
    class BoundedSocket extends NodeSocket {
      constructor(url, ...rest) {
        const parsed = new URL(String(url));
        check(parsed.protocol === 'wss:' && parsed.host === new URL(cloudUrl).host &&
          /^\/api\/[^/?]+\/sync$/.test(parsed.pathname) && !parsed.search, 'admin_socket_target');
        if (++connections > 1) { observation.blockedReconnects++; bad('admin_reconnect'); return new RefusedSocket(); }
        const protocols = typeof rest[0] === 'string' || Array.isArray(rest[0]) ? rest[0] : undefined;
        const configured = record(rest[0]) ? rest[0] : rest[1];
        super(url, protocols, { ...configured, maxPayload: 1024 * 1024,
          handshakeTimeout: timeout(), perMessageDeflate: false });
        sockets.push(this); observation.connections++;
        this.on('close', () => { if (!closing) bad('admin_socket_closed'); });
        this.on('error', () => { if (!closing) bad('admin_socket_error'); });
        this.on('message', value => {
          observation.receivedBytes = (observation.receivedBytes ?? 0) + Buffer.byteLength(value);
          if (observation.receivedBytes > 1024 * 1024) { bad('admin_socket_bytes'); this.terminate(); }
        });
      }
      send(value, ...rest) {
        let message; try { message = JSON.parse(String(value)); } catch { bad('admin_protocol'); return; }
        if (message.type === 'ModifyQuerySet') {
          for (const change of message.modifications ?? []) if (change.type === 'Add') {
            observation.registrations++; if (++registrations > 1) { bad('admin_query_replay'); return; }
          }
        }
        if (['Mutation', 'Action'].includes(message.type)) { bad('unexpected_admin_mutation'); return; }
        observation.sentBytes += Buffer.byteLength(String(value));
        if (observation.sentBytes > 1024 * 1024) { bad('admin_socket_bytes'); return; }
        return super.send(value, ...rest);
      }
    }
    try {
      client = new Client(cloudUrl, tokens => {
        for (const token of tokens) {
          observation.callbacks++;
          try { settle(client.localQueryResultByToken(token)); } catch { rejectResult(new GateError('admin_query_unsupported')); }
        }
      }, { webSocketConstructor: BoundedSocket, unsavedChangesWarning: false, logger: false, reportDebugInfoToConvex: false });
      client.setAdminAuth(adminKey);
      unsubscribe = client.subscribe(name, args, options).unsubscribe;
      return await within(result, timeout());
    } finally {
      closing = true; unsubscribe?.();
      try { if (client) await within(client.close(), Math.min(1000, timeout())); }
      finally { for (const socket of sockets) socket.terminate(); }
    }
  };
}

// Browser traffic is transported through the same bounded Node fetch. This
// prevents redirects and hidden browser retries and confines the bypass header
// to the unique deployment origin. Known telemetry scripts receive empty stubs.
export function createBrowserPolicy({ origin, legacyId, deploymentId }) {
  const seen = new Map();
  return request => {
    const url = new URL(request.url), method = request.method;
    check(url.origin === origin && !url.username && !url.password && !url.hash, 'browser_target');
    if (['/_vercel/insights/script.js', '/_vercel/speed-insights/script.js'].includes(url.pathname)) {
      check(method === 'GET' && !url.search, 'browser_telemetry_target'); return { stub: true };
    }
    let key, category, writes = 0, gateway = false, maximum = 1;
    if (url.pathname === '/' && url.search === `?join=${legacyId}` && method === 'GET') { key = 'document'; category = 'document'; }
    else if (url.pathname === '/api/convex-auth' && !url.search && method === 'GET') { key = 'cookieProbe'; category = 'api'; }
    else if (url.pathname === '/api/convex-auth' && !url.search && method === 'POST') {
      check(request.body === JSON.stringify({ action: 'auth:signIn', args: { refreshToken: 'dummy' } }), 'browser_refresh_body');
      key = 'refresh'; category = 'api'; writes = 16;
    }
    else if (url.pathname === '/api/convex/public' && method === 'GET' && url.search === `?id=${legacyId}`) {
      key = 'metadata'; category = 'api'; gateway = true;
    } else if (url.pathname === '/api/convex/public' && method === 'POST' && !url.search) {
      let body; try { body = JSON.parse(request.body); } catch { fail('browser_checkin_body'); }
      check(Object.keys(body).sort().join(',') === 'action,id,identity' && body.action === 'checkin' &&
        body.id === legacyId && body.identity === 'NXT01', 'browser_checkin_body');
      key = 'checkin'; category = 'api'; writes = 48; gateway = true; maximum = 3;
    } else if (method === 'GET' && /^\/_next\/static\/[A-Za-z0-9_./%-]+\.(?:js|css|woff2?)$/.test(url.pathname) &&
      (!url.search || url.search === `?dpl=${deploymentId}`)) { key = url.pathname; category = 'asset'; }
    else if (method === 'GET' && url.pathname === '/favicon.svg' && !url.search) {
      key = 'favicon'; category = 'asset'; maximum = 2; // one per isolated browser context
    }
    else fail('unexpected_browser_request');
    const n = (seen.get(key) ?? 0) + 1;
    check(n <= maximum, 'browser_retry_or_duplicate'); seen.set(key, n);
    check(seen.size <= 60, 'browser_asset_budget');
    return { category, writes, gateway, key, ordinal: n };
  };
}

export async function createBrowserHarness({ origin, legacyId, deploymentId, cookies, send, timeout, fatal,
  observation, launch, signal, onOwned, stopWork } = {}) {
  let browser, knownClosePromise, stopped = false;
  observation.initializationAttempted = true; observation.closeConfirmed = false;
  const closeKnownBrowser = value => {
    if (!knownClosePromise) {
      observation.closeAttempted = true;
      knownClosePromise = within(Promise.resolve().then(() => value.close()), 2500)
        .then(() => { observation.closeConfirmed = true; observation.closeUncertain = false; }, error => {
          observation.closeUncertain = true; throw error;
        });
    }
    return knownClosePromise;
  };
  const close = () => {
    stopped = true; stopWork?.();
    if (!browser) { observation.closeUncertain = true; return Promise.reject(new GateError('browser_handle_unavailable')); }
    return closeKnownBrowser(browser);
  };
  const step = async operation => {
    try { return await browserOperation(() => { check(!stopped, 'browser_stopped'); return operation(); }, timeout(), signal); }
    catch (error) {
      const expectedStop = stopped || signal?.aborted;
      stopped = true; stopWork?.();
      if (!expectedStop) fatal(error instanceof GateError ? error.code : 'browser_operation');
      throw error;
    }
  };
  const contexts = [];
  const policy = createBrowserPolicy({ origin, legacyId, deploymentId });
  const pending = new Set();
  async function context() {
    const value = await step(() => browser.newContext({ serviceWorkers: 'block', acceptDownloads: false })); contexts.push(value);
    await step(() => value.routeWebSocket('**/*', socket => {
      observation.blockedTeacherSockets++; fatal('student_teacher_websocket'); socket.close();
    }));
    await step(() => value.route('**/*', route => {
      const task = (async () => {
        if (stopped || signal?.aborted) return route.abort();
        const req = route.request();
        try {
          check(!req.redirectedFrom(), 'browser_redirect');
          const request = { url: req.url(), method: req.method(), body: req.postData(), headers: await step(() => req.allHeaders()) };
          const admitted = policy(request);
          // Reading headers yields. A queued route must not dispatch once
          // teardown or cancellation has begun, even if headers just settled.
          check(!stopped && !signal?.aborted, 'browser_stopped');
          if (admitted.stub) { observation.stubbedTelemetry++; return route.fulfill({ status: 200,
            contentType: 'application/javascript', body: '' }); }
          const result = await send(request, admitted);
          check(!stopped && !signal?.aborted, 'browser_stopped');
          check(result.status < 300 || result.status >= 400, 'browser_redirect');
          const headers = Object.fromEntries(result.headers);
          if (result.headers.getSetCookie().length) headers['set-cookie'] = result.headers.getSetCookie().join('\n');
          delete headers['content-length']; delete headers['content-encoding']; delete headers['transfer-encoding'];
          await route.fulfill({ status: result.status, headers, body: result.bytes });
        } catch (error) {
          if (!stopped && !signal?.aborted) fatal(error instanceof GateError ? error.code : 'browser_transport');
          await route.abort().catch(() => {});
        }
      })();
      pending.add(task); task.finally(() => pending.delete(task)).catch(() => {}); return task;
    }));
    return value;
  }
  try {
    const launchOptions = { headless: true, timeout: timeout(), handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false };
    observation.launchAttempted = true;
    const launching = Promise.resolve().then(async () => {
      const value = launch ? await launch(launchOptions) : await (await import('playwright')).chromium.launch(launchOptions);
      browser = value;
      // Retain teardown ownership before any initialization call can fail.
      onOwned?.({ close });
      if (stopped || signal?.aborted) {
        // A late launch completion must not become an unowned browser.
        closeKnownBrowser(value).catch(() => {});
      }
      return value;
    });
    await step(() => launching);
    // Teacher cookies only visit the JSON auth handler; no teacher UI is mounted.
    const teacher = await context();
    await step(() => teacher.addCookies(AUTH_NAMES.slice(0, 2).map((name, i) => ({ name, value: i ? cookies.refresh : cookies.token,
      url: origin, httpOnly: true, secure: true, sameSite: 'Lax' }))));
    const probe = await step(() => teacher.newPage());
    await step(() => probe.goto(`${origin}/api/convex-auth`, { waitUntil: 'domcontentloaded', timeout: timeout() }));
    const visibleNames = await step(() => probe.evaluate(() => document.cookie.split(';').map(x => x.trim().split('=')[0])));
    check(AUTH_NAMES.every(name => !visibleNames.includes(name)), 'http_only_javascript_visibility');
    const stored = await step(() => teacher.cookies(origin));
    check(AUTH_NAMES.slice(0, 2).every(name => stored.some(c => c.name === name && c.httpOnly && c.secure &&
      c.sameSite === 'Lax' && c.path === '/' && !c.domain.startsWith('.'))), 'browser_cookie_attributes');
    const refreshStatus = await step(() => probe.evaluate(async () => {
      const response = await fetch('/api/convex-auth', { method: 'POST', credentials: 'same-origin', redirect: 'error',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'auth:signIn', args: { refreshToken: 'dummy' } }) });
      return response.status;
    }, { refresh: true }));
    const refreshed = await step(() => teacher.cookies(origin));
    check(refreshStatus === 200 && AUTH_NAMES.slice(0, 2).every(name => refreshed.some(c => c.name === name &&
      c.value !== stored.find(old => old.name === name)?.value && c.httpOnly && c.secure && c.sameSite === 'Lax' &&
      c.path === '/' && !c.domain.startsWith('.'))), 'browser_refresh_cookies');
    const refreshedVisible = await step(() => probe.evaluate(() => document.cookie.split(';').map(x => x.trim().split('=')[0])));
    check(AUTH_NAMES.every(name => !refreshedVisible.includes(name)), 'refreshed_http_only_javascript_visibility');
    await step(() => teacher.close()); contexts.splice(contexts.indexOf(teacher), 1);
    const student = await context(), page = await step(() => student.newPage());
    check(!(await step(() => student.cookies(origin))).some(c => AUTH_NAMES.includes(c.name)), 'student_teacher_cookie_isolation');
    page.setDefaultTimeout(timeout());
    await step(() => page.goto(`${origin}/?join=${legacyId}`, { waitUntil: 'domcontentloaded', timeout: timeout() }));
    await step(() => page.getByLabel('Full name or student ID').waitFor({ state: 'visible', timeout: timeout() }));
    return {
      async firstCheckin() {
        await step(() => page.getByLabel('Full name or student ID').fill('NXT01', { timeout: timeout() }));
        await step(() => page.getByRole('button', { name: 'Check me in' }).click({ timeout: timeout() }));
        await step(() => page.getByRole('heading', { name: 'You’re all set.' }).waitFor({ state: 'visible', timeout: timeout() }));
      },
      async duplicate(headers) {
        return step(() => page.evaluate(async ({ id, headers }) => {
          const response = await fetch('/api/convex/public', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify({ action: 'checkin', id, identity: 'NXT01' }), redirect: 'error' });
          return { status: response.status, body: await response.json() };
        }, { id: legacyId, headers }));
      },
      close,
      cookiesVerified: true,
      refreshVerified: true,
    };
  } catch (error) { await close().catch(() => {}); throw error; }
}

async function exclusiveAttempt(recordValue, path) {
  check([ORIGINAL_PATHS.attempt, CONTINUATION_PATHS.attempt, THIRD_PATHS.attempt, PREBUILT_PATHS.attempt, OWNED_DEVELOPMENT_PATHS.attempt].includes(path), 'attempt_path');
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(JSON.stringify(recordValue, null, 2) + '\n'); await file.sync(); } finally { await file.close(); }
}

// All live capabilities are behind invocation and injectable seams. The runner
// never publishes backend code, retries a creation, or deletes Convex.
export async function runHostedNext(argv = process.argv.slice(2), env = process.env, injected = {}) {
  const deps = { readPrivateText: publisher.readPrivateText, readVercelToken: publisher.readVercelToken,
    readPublic: path => readFile(path, 'utf8'), quota: readQuotaReview,
    assertAbsent: async path => {
      try { await lstat(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      throw Error('original_runtime_exists');
    },
    git: args => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
    providerJson: publisher.providerJson, validateDeployment: publisher.validateVercelDeployment,
    cleanupVercel: publisher.cleanupOwnedVercel, exclusiveAttempt,
    persist: persistHostedReports, now: () => performance.now(), wallNow: () => Date.now(),
    transport: boundedFetch, createBrowser: createBrowserHarness, createAdmin: createAdminReader,
    shortJwt: createShortJwtFixture, wait: (ms, signal) => sleep(ms, undefined, { signal }),
    ...injected };
  const expected = parseArgs(argv);
  const paths = expected.automationOwnedRelease ? AUTOMATION_PATHS : expected.ownedDevelopment ? OWNED_DEVELOPMENT_PATHS : expected.prebuilt ? PREBUILT_PATHS : expected.third ? THIRD_PATHS : expected.continuation ? CONTINUATION_PATHS : ORIGINAL_PATHS;
  const manifest = JSON.parse(await deps.readPrivateText(paths.manifest));
  validateManifest(manifest, expected, deps.wallNow());
  const backendText = await deps.readPrivateText(expected.ownedDevelopment ? paths.backend : backendPath);
  const backend = JSON.parse(backendText);
  const historicalBackend = expected.ownedDevelopment ? JSON.parse(await deps.readPrivateText(backendPath)) : backend;
  const historicalBinding = expected.ownedDevelopment ? publisher.validateBackendManifest(historicalBackend, historicalBackend.deploymentName) : manifest.backend;
  if (expected.ownedDevelopment) {
    const binding = validateOwnedBackend(backend, manifest.sourceCommit);
    check(JSON.stringify(binding) === JSON.stringify(manifest.backend) && JSON.stringify(backend.setupUsage) === JSON.stringify(manifest.setupUsage) &&
      createHash('sha256').update(backendText).digest('hex') === manifest.backendManifestSha256, 'owned_backend_binding');
  }
  const prior = JSON.parse(await deps.readPublic(priorPath));
  const previous = validatePriorEvidence(prior, historicalBackend, expected.ownedDevelopment ? { backend: historicalBinding } : manifest);
  let continuation, thirdContinuation;
  if (expected.third) {
    thirdContinuation = validateThirdHistory(await deps.readPublic(ORIGINAL_PATHS.publication),
      JSON.parse(await deps.readPrivateText(ORIGINAL_PATHS.manifest)), await deps.readPublic(CONTINUATION_PATHS.publication),
      JSON.parse(await deps.readPrivateText(CONTINUATION_PATHS.manifest)), historicalBinding);
    for (const path of [ORIGINAL_PATHS.attempt, CONTINUATION_PATHS.attempt, paths.evidence]) await deps.assertAbsent(path);
    if (expected.prebuilt) {
      validateStoppedThird(await deps.readPublic(THIRD_PATHS.publication), manifest);
      await deps.assertAbsent(THIRD_PATHS.attempt);
      if (expected.ownedDevelopment) validateOwnedStopped(await deps.readPublic(PREBUILT_PATHS.publication));
      if (expected.automationOwnedRelease) { validateOwnedFailed(await deps.readPublic(OWNED_DEVELOPMENT_PATHS.publication));validateFailedAutomationPublication(await deps.readPublic('docs/measurements/hosted-automation-next-setup.json'));validateFailedAutomationProbe(await deps.readPublic('docs/measurements/vercel-automation-access-probe.json')); const probe = validateAutomationProbe(JSON.parse(await deps.readPublic('docs/measurements/vercel-automation-access-probe-32.json'))); check(JSON.stringify(probe) === JSON.stringify(manifest.automationProbe), 'automation_probe_binding'); }
      validatePrebuiltPublication(JSON.parse(await deps.readPublic(paths.publication)), manifest, expected.ownedDevelopment, expected.automationOwnedRelease);
    } else validateThirdPublication(JSON.parse(await deps.readPublic(paths.publication)), manifest);
  } else if (expected.continuation) {
    continuation = validateContinuationHistory(await deps.readPublic(ORIGINAL_PATHS.publication),
      JSON.parse(await deps.readPrivateText(ORIGINAL_PATHS.manifest)), manifest.backend);
    await deps.assertAbsent(ORIGINAL_PATHS.attempt);
    await deps.assertAbsent(paths.evidence);
    validateContinuationPublication(JSON.parse(await deps.readPublic(paths.publication)), manifest);
  }
  const core = ['app', 'convex', 'lib', 'patches', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'convex.json'];
  check(deps.git(['rev-parse', 'HEAD']).trim() === manifest.sourceCommit, 'head_mismatch');
  if (expected.third) {
    const compatibility = expected.ownedDevelopment ? validateOwnedCompatibility(manifest.sourceCommit, backend.reviewedSourceCommit, deps.git) : publisher.validateSource(manifest.sourceCommit, backend.reviewedSourceCommit, deps.git, { third: true });
    check(JSON.stringify(compatibility) === JSON.stringify(manifest.backendCompatibility), 'third_backend_compatibility');
  } else deps.git(['diff', '--exit-code', backend.reviewedSourceCommit, manifest.sourceCommit, '--', ...core]);
  deps.git(['diff', '--exit-code', manifest.sourceCommit, '--', ...core, 'proxy.ts', 'next.config.ts', 'vercel.json']);
  check(!deps.git(['ls-files', '--others', '--exclude-standard', '--', ...core, 'proxy.ts', 'next.config.ts', 'vercel.json']).trim(), 'unreviewed_core');
  const quota = await deps.quota(deps.wallNow());
  check(quota.plan === 'CONVEX_BASE', 'free_plan_review');
  const vercelCreditReview = expected.third ? validateVercelCreditReview(JSON.parse(await deps.readPrivateText(vercelCreditReviewPath)), deps.wallNow()) : undefined;
  const key = expected.ownedDevelopment ? backend.adminKey : (await deps.readPrivateText(env.ATTENDANCE_PREVIEW_KEY_FILE)).trim();
  if (!expected.ownedDevelopment) check(key.startsWith('preview:nomokaro625-9385-s-projects:convex-cyan-garden|') && key.split('|').length === 2 &&
    !/[\u0000-\u0020\u007f]/.test(key), 'preview_key_scope');
  const vercelToken = await deps.readVercelToken(env.ATTENDANCE_VERCEL_AUTH_FILE);
  const started = deps.now(), budget = createBudget(manifest.counters, { now: deps.now, continuation,
    thirdContinuation, preflight: manifest.preflight, prebuilt: expected.prebuilt, ownedDevelopment: expected.ownedDevelopment, setupUsage: manifest.setupUsage, automation: expected.automationOwnedRelease, probe: manifest.automationProbe });
  const attempt = { version: 1, runId: manifest.runId, sourceCommit: manifest.sourceCommit,
    vercelDeploymentId: expected.deploymentId, backendId: manifest.backend.id,
    backendReference: manifest.backend.reference, fingerprint: FINGERPRINT,
    ...(continuation ? { continuation } : {}),
    ...(thirdContinuation ? { thirdContinuation } : {}),
    startedAt: new Date(deps.wallNow()).toISOString() };
  // Existing backend runtime-attempt.json and publication records remain untouched.
  await deps.exclusiveAttempt(attempt, paths.attempt);
  const report = { version: 1, localOnly: false, backendOnly: false, hostedNext: true,
    startedAt: attempt.startedAt, sourceCommit: manifest.sourceCommit, deploymentId: expected.deploymentId,
    deploymentName: expected.backendName, priorBackend: previous,
    ...(continuation ? { continuation } : {}),
    ...(thirdContinuation ? { thirdContinuation, preflight: { ...manifest.preflight }, vercelCreditReview } : {}),
    ...(expected.automationOwnedRelease ? { automationOwnedRelease:true, providerExpires:false } : {}),
    bounds: { cumulativeCalls: 200, nextCallsIncludingPublisher: expected.automationOwnedRelease ? 45 : 40, writes: expected.ownedDevelopment ? 750 : 700, ordinaryWrites: expected.ownedDevelopment ? 650 : 600,
      cleanupWrites: 100, cumulativeGateway: 20, nextGateway: 13, hosting: thirdContinuation ? 50 : 100, control: expected.automationOwnedRelease ? 130 : expected.ownedDevelopment ? 100 : thirdContinuation ? 80 : continuation ? 60 : 40,
      ...(continuation || thirdContinuation ? { cumulativeCreations: expected.automationOwnedRelease ? 5 : thirdContinuation ? 3 : 2 } : {}),
      publisherControl: 20, runnerControl: 19, workloadMs: 180000, ordinaryMs: 130000,
      cleanupMs: 50000, responseBytes: 1048576, adminRowsPerRead: 100 },
    assertions: {}, negativeProbes: [], ipProvenance: { status: 'unverified' },
    physicalRequests: { hosting: 0, convexHttp: 0, control: 0 },
    admin: { connections: 0, blockedReconnects: 0, registrations: 0, callbacks: 0, sentBytes: 0, receivedBytes: 0 },
    browser: { blockedTeacherSockets: 0, stubbedTelemetry: 0, checkinRequests: 0 },
    cleanup: { availabilityClosed: false, closureAcknowledged: false, browserClosed: false,
      logoutConfirmed: false, sessionRevocationVerified: false, capabilityRevoked: false, vercelDeleted: false,
      convexDeleted: false },
    teamQuotaReview: { plan: quota.plan, source: quota.source, observedAt: quota.observedAt,
      sufficientReviewedHeadroom: true, plannedHeadroom: quota.plannedHeadroom },
    limitations: [
      'Client reservations do not cap provider billing, backend internal work, scheduled jobs or OCC retries.',
      'Managed one-hour JWT and 30-day session natural expiry remain unobserved; a signed 15-second test JWT checks hosted expiry enforcement.',
      'A failure that requires early availability closure can defer the normal-flow old-JWT 401 assertion.',
      'Only newly created Vercel resources are cleanup targets. Convex synthetic rows remain on the closed preview.',
      'Free plan and team allowance rely on the fresh private dashboard review; provider usage may be provisional.',
    ] };
  let phase = 'live preflight', cleaning = false, cleanupTimeout = 10000, cancelled = false, fatalObservation, actor, browser;
  const ordinaryAbort = new AbortController();
  let activationAttempted = false, identityVerified = false, adminSupported = true;
  const snapshots = [];
  const signal = () => { cancelled = true; report.cancelled = true; report.passed = false; ordinaryAbort.abort(); };
  const workSignals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const name of workSignals) process.on(name, signal);
  const fatal = code => { fatalObservation ??= code; ordinaryAbort.abort(); };
  const remaining = (ceiling = cleaning ? cleanupTimeout : 10000) => {
    const left = (cleaning ? 180000 : 130000) - (deps.now() - started);
    check(left > 0 && (cleaning || (!cancelled && !fatalObservation)), 'runtime_stopped_or_timeout');
    return Math.max(1, Math.min(ceiling, Math.floor(left)));
  };
  const reserve = (kind, options = {}) => { remaining(); return budget.reserve({ kind, cleanup: cleaning, ...options }); };
  const assertion = (name, value) => { report.assertions[name] = !!value; check(value, name); };
  const transport = (url, init = {}, onSend) => {
    const target = new URL(url);
    check([manifest.backend.cloudUrl, manifest.backend.siteUrl, new URL(manifest.vercel.url).origin].includes(target.origin), 'transport_target');
    const timeoutMs = remaining();
    onSend?.();
    if (target.origin === new URL(manifest.vercel.url).origin) report.physicalRequests.hosting++;
    else report.physicalRequests.convexHttp++;
    return deps.transport(url, init, { timeoutMs, ...(!cleaning ? { signal: ordinaryAbort.signal } : {}) });
  };
  const rpcImpl = deps.rpc ?? createOneShotRpc({ cloudUrl: manifest.backend.cloudUrl, adminKey: backend.adminKey, transport });
  const rpc = async (kind, name, args = {}, { token, admin = false, writes = 0 } = {}) => {
    reserve('application', { writes }); return rpcImpl({ kind, name, args, token, admin });
  };
  const adminPage = deps.adminPage ?? deps.createAdmin({ cloudUrl: manifest.backend.cloudUrl, adminKey: backend.adminKey,
    timeout: remaining, reserve: () => reserve('application'), observation: report.admin, fatal });
  // Injected admin pages still pass through the same application reservation.
  const queryPage = deps.adminPage ? (...args) => { reserve('application'); return deps.adminPage(...args); } : adminPage;
  const control = async (url, authorization) => {
    reserve('control'); report.physicalRequests.control++;
    const result = await deps.providerJson(url, { headers: { Authorization: authorization }, timeoutMs: remaining() });
    return result.body;
  };
  const vercelRequest = async (path, options = {}) => {
    check(path.startsWith('/') && !path.startsWith('//') && !/[\r\n]/.test(path), 'vercel_request_target');
    const target = new URL(path, 'https://api.vercel.com'); target.searchParams.set('teamId', TEAM_ID);
    check([`/v13/deployments/${expected.deploymentId}`, `/v2/teams/${TEAM_ID}`, `/v9/projects/${PROJECT}`,
      ...(expected.automationOwnedRelease ? [AUTOMATION_PATH] : [`/aliases/${expected.deploymentId}/protection-bypass`])].includes(target.pathname), 'vercel_request_target');
    reserve('control'); report.physicalRequests.control++;
    return deps.providerJson(target.href, { ...options,
      headers: { Authorization: `Bearer ${vercelToken}` }, timeoutMs: remaining() });
  };
  const origin = new URL(manifest.vercel.url).origin;
  async function hosting(path, { method = 'GET', body, headers = {}, application = false, gateway = false, writes = 0,
    protectedAccess = true, onSend, cleanupReservation = false } = {}) {
    check(path.startsWith('/') && !path.startsWith('//'), 'hosting_target');
    const url = new URL(path, origin); check(url.origin === origin && !url.hash, 'hosting_target');
    reserve('hosting'); if (application) reserve('application', { writes, gateway, cleanup: cleaning || cleanupReservation });
    return transport(url.href, { method, ...(protectedAccess ? {} : { redirect: 'manual' }), headers: { ...headers,
      ...(protectedAccess ? { 'x-vercel-protection-bypass': manifest.access.token } : {}) },
    ...(body == null ? {} : { body }) }, onSend);
  }
  async function observeCounters(legacyId) {
    if (!adminSupported) return;
    try { snapshots.push(counterSnapshot(await readAdminTable(queryPage, 'throttleCounters'), legacyId)); }
    catch (error) {
      if (fatalObservation || cancelled || ['budget_exceeded', 'deadline', 'runtime_stopped_or_timeout'].includes(error?.code)) throw error;
      adminSupported = false; snapshots.length = 0;
      report.ipProvenance = { status: 'unverified', reason: 'bounded_admin_observable_unavailable', retainedSensitiveObservations: false };
    }
  }
  async function negative(name, path, options, status, { framework = false } = {}) {
    const response = await hosting(path, { ...options, application: true, gateway: path.startsWith('/api/convex/public') });
    check(response.status === status, 'negative_probe_status');
    if (framework) check(response.bytes.length === 0, 'method_response_privacy');
    else {
      const value = jsonBody(response);
      assertPublicResponse(value, { status, kind: 'error' });
      const messages = { 'auth-method': 'Invalid method.', 'auth-malformed': 'A valid JSON object is required.',
        'auth-oversized': 'Request too large.', 'auth-origin': 'Invalid origin.',
        'public-malformed': 'A valid JSON object is required.', 'public-oversized': 'Request too large.',
        'public-origin': 'Invalid origin.' };
      check(value.error === messages[name], 'negative_probe_application_identity');
    }
    report.negativeProbes.push({ name, expectedStatus: status, observedStatus: response.status,
      layer: framework ? 'next-framework' : 'application', privacyVerified: true });
  }
  async function logoutActor() {
    if (!actor || actor.logoutAttempted) return;
    const logout = await hosting('/api/convex-auth', { method: 'POST', application: true, writes: 16, cleanupReservation: true,
      onSend: () => { actor.logoutAttempted = true; },
      headers: { 'Content-Type': 'application/json', Origin: origin,
        Cookie: `${AUTH_NAMES[0]}=${actor.cookies.token}` +
          (actor.cookies.refresh ? `; ${AUTH_NAMES[1]}=${actor.cookies.refresh}` : '') },
      body: JSON.stringify({ action: 'auth:signOut', args: {} }) });
    check(logout.status === 200 && jsonBody(logout) === null, 'logout_status');
    inspectAuthCookies(logout.headers.getSetCookie(), { deleted: true });
    report.cleanup.logoutConfirmed = true;
  }
  try {
    const liveVercel = await vercelRequest(`/v13/deployments/${expected.deploymentId}?teamId=${TEAM_ID}`);
    if (expected.prebuilt) validatePrebuiltDeployment(liveVercel.body, manifest); else deps.validateDeployment(liveVercel.body, { deploymentId: expected.deploymentId, url: manifest.vercel.url,
      sourceCommit: manifest.sourceCommit, runId: manifest.runId,
      ...(expected.third ? { sourceArchive: manifest.vercel.sourceArchive } : {}) });
    const team = (await vercelRequest(`/v2/teams/${TEAM_ID}`)).body;
    assertion('VercelProPlan', team?.id === TEAM_ID && team.slug === TEAM && team.billing?.plan === publisher.EXPECTED.vercelPlan);
    const project = (await vercelRequest(`/v9/projects/${PROJECT}`)).body;
    assertion('VercelProjectProtection', project?.id === PROJECT && project.accountId === TEAM_ID &&
      project.framework === 'nextjs' && project.ssoProtection?.deploymentType === 'all_except_custom_domains' &&
      project.targets?.production?.target === 'production' && project.targets.production.id !== expected.deploymentId);
    if (expected.third) assertion('GitDisconnectPreserved', project.link == null);
    const actual = expected.ownedDevelopment ? undefined : await control(`https://api.convex.dev/v1/deployments/${expected.backendName}`, `Bearer ${key}`);
    const canonical = await control(`${manifest.backend.cloudUrl}/api/v1/get_canonical_urls`, `Convex ${backend.adminKey}`);
    if (expected.ownedDevelopment) validateOwnedCanonical(canonical, backend); else publisher.validateLiveIdentity(backend, actual, canonical);
    publisher.validateDailyLimit(await control(`${manifest.backend.cloudUrl}/api/v1/list_usage_limits`, `Convex ${backend.adminKey}`));
    const usage = await control(`${manifest.backend.cloudUrl}/api/v1/get_current_usage`, `Convex ${backend.adminKey}`);
    const day = usage?.metrics?.functionCalls?.usage?.current_day;
    assertion('DailyHeadroom', Number.isFinite(day) && day >= 0 && day <= 800);
    identityVerified = true;
    if (expected.prebuilt) {
      const signed = signReadinessRequest({ version: 1, release: manifest.sourceCommit, origin,
        audience: backend.config.ATTENDANCE_GATEWAY_AUDIENCE, cloudUrl: backend.cloudUrl, siteUrl: backend.siteUrl,
        issuedAt: deps.wallNow(), nonce: randomBytes(32).toString('hex') }, backend.config.ATTENDANCE_GATEWAY_KEY);
      const response = await hosting('/api/release-readiness', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signed) });
      assertion('SignedRuntimeReadiness', response.status === 200 && verifyReadinessResponse(jsonBody(response), signed, backend.config.ATTENDANCE_GATEWAY_KEY));
    }
    const closed = await rpc('query', 'operations:availability', { fingerprint: FINGERPRINT }, { admin: true });
    publisher.validateClosedState(closed); assertion('ClosedFingerprint', true);
    phase = 'protected access';
    const challenged = await hosting('/api/convex/public?id=' + '0'.repeat(32), { protectedAccess: false });
    assertion('UnauthenticatedProtection', [302, 303, 307, 308, 401, 403].includes(challenged.status));
    const authorized = await hosting('/api/convex/public?id=' + '0'.repeat(32), { application: true, gateway: true });
    assertion('AuthorizedClosedResponse', authorized.status === 503);
    const unavailable = jsonBody(authorized);
    assertPublicResponse(unavailable, { status: 503, kind: 'metadata' });
    assertion('AuthorizedApplicationIdentity', unavailable.error === 'Attendance is temporarily unavailable.');
    phase = 'closed negative probes';
    await negative('auth-method', '/api/convex-auth', { method: 'GET' }, 405);
    await negative('auth-malformed', '/api/convex-auth', { method: 'POST', body: '{', headers: { 'Content-Type': 'application/json' } }, 400);
    await negative('auth-oversized', '/api/convex-auth', { method: 'POST', body: JSON.stringify({ value: 'x'.repeat(4096) }), headers: { 'Content-Type': 'application/json' } }, 413);
    await negative('auth-origin', '/api/convex-auth', { method: 'POST', body: '{}', headers: { Origin: 'https://invalid.example', 'Content-Type': 'application/json' } }, 403);
    await negative('public-method', '/api/convex/public', { method: 'PUT' }, 405, { framework: true });
    await negative('public-malformed', '/api/convex/public', { method: 'POST', body: '{', headers: { 'Content-Type': 'application/json' } }, 400);
    await negative('public-oversized', '/api/convex/public', { method: 'POST', body: JSON.stringify({ value: 'x'.repeat(4096) }), headers: { 'Content-Type': 'application/json' } }, 413);
    await negative('public-origin', '/api/convex/public?id=' + '0'.repeat(32), { headers: { Origin: 'https://invalid.example' } }, 403);
    reserve('application', { gateway: true });
    const unsigned = await transport(`${manifest.backend.siteUrl}/gateway/checkin`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload: { legacyId: '0'.repeat(32), identity: 'NXT01' } }) });
    assertion('UnsignedConvexDenied', unsigned.status === 403);
    const deniedUnsigned = jsonBody(unsigned);
    assertPublicResponse(deniedUnsigned, { status: 403, kind: 'checkin' });
    assertion('UnsignedConvexApplicationIdentity', deniedUnsigned.error === 'Unauthorized.');
    phase = 'availability and Next auth';
    activationAttempted = true;
    const opened = await rpc('mutation', 'operations:setAvailability', { fingerprint: FINGERPRINT,
      readsEnabled: true, writesEnabled: true }, { admin: true, writes: 1 });
    assertion('AvailabilityOpened', opened?.readsEnabled === true && opened.writesEnabled === true);
    const username = 'next-' + randomBytes(10).toString('hex'), password = randomBytes(24).toString('hex');
    const signup = await hosting('/api/convex-auth', { method: 'POST', application: true, writes: 64,
      onSend: () => { report.signupSubmitted = true; },
      headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ action: 'auth:signIn',
        args: { provider: 'credentials', params: { operation: 'signup', username, password } } }) });
    assertion('NextSignup', signup.status === 200);
    const signedIn = jsonBody(signup);
    // Keep a returned JWT for best-effort revocation even if a later cookie or
    // response-shape assertion fails. It never enters either persisted record.
    if (typeof signedIn?.tokens?.token === 'string' && signedIn.tokens.token.length <= 16384 &&
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(signedIn.tokens.token))
      actor = { token: signedIn.tokens.token, cookies: { token: signedIn.tokens.token } };
    const cookies = inspectAuthCookies(signup.headers.getSetCookie());
    actor = { cookies, token: cookies.token };
    check(Object.keys(signedIn).join(',') === 'tokens' && record(signedIn.tokens) &&
      Object.keys(signedIn.tokens).sort().join(',') === 'refreshToken,token' &&
      signedIn.tokens.refreshToken === 'dummy' && signedIn.tokens.token === actor.token, 'auth_response_privacy');
    const claims = JSON.parse(Buffer.from(actor.token.split('.')[1], 'base64url'));
    check(typeof claims.sub === 'string' && claims.sub.split('|').length === 2 && claims.exp - claims.iat === 3600 &&
      Number.isSafeInteger(claims.sessionExpiresAt), 'managed_token_claims');
    actor.sessionId = claims.sub.split('|')[1];
    const viewer = await rpc('query', 'attendance:viewer', {}, { token: actor.token });
    assertion('ManagedSessionDeadline', viewer.expiresAt === claims.sessionExpiresAt);
    phase = 'signed short JWT expiry';
    const short = deps.shortJwt(actor.token, backend, deps.wallNow());
    assertion('ShortSignedJwtAccepted', (await rpc('query', 'attendance:viewer', {}, { token: short.token })).expiresAt === viewer.expiresAt);
    const waitMs = short.expiresAt + 65000 - deps.wallNow();
    check(waitMs > 0 && waitMs + 10000 < remaining(130000), 'short_jwt_deadline');
    await browserOperation(() => deps.wait(waitMs, ordinaryAbort.signal), remaining(130000), ordinaryAbort.signal);
    let expired = false;
    try { await rpc('query', 'attendance:viewer', {}, { token: short.token }); }
    catch (error) { check(error?.data?.status === 401 || error?.code === 'convex_http_401', 'short_jwt_denial_status'); expired = true; }
    assertion('ShortSignedJwtExpired401', expired);
    assertion('ManagedJwtStillAccepted', (await rpc('query', 'attendance:viewer', {}, { token: actor.token })).expiresAt === viewer.expiresAt);
    phase = 'availability and Next auth';
    const legacyId = randomBytes(16).toString('hex');
    const created = await rpc('mutation', 'attendance:create', { newId: legacyId, title: 'Next hosted synthetic class',
      csv: 'name,student_id\nNext One,NXT01\nNext Two,NXT02\nNext Three,NXT03\nNext Four,NXT04\nNext Five,NXT05\n',
    }, { token: actor.token, writes: 12 });
    check(created?.id === legacyId && typeof created.classId === 'string', 'class_result');
    const roster = await rpc('query', 'attendance:roster', { legacyId }, { token: actor.token });
    assertion('FiveStudentRoster', Array.isArray(roster) && roster.length === 5 && new Set(roster.map(x => x.id)).size === 5);
    phase = 'isolated student browser';
    report.browser.initializationAttempted = true;
    browser = await browserOperation(() => deps.createBrowser({ origin, legacyId, deploymentId: expected.deploymentId, cookies,
      signal: ordinaryAbort.signal, stopWork: () => ordinaryAbort.abort(),
      onOwned: owner => {
        check(owner && typeof owner.close === 'function', 'browser_owner'); browser = owner;
        if (cleaning) owner.close().catch(() => { report.browser.closeUncertain = true; });
      },
      timeout: remaining, fatal, observation: report.browser, send: async (request, admission) => {
        // Browser traffic always belongs to ordinary work. The shared transport
        // entering cleanup must never grant a queued route a new deadline.
        check(!cleaning && !ordinaryAbort.signal.aborted, 'browser_stopped');
        const url = new URL(request.url);
        const response = await hosting(url.pathname + url.search, { method: request.method, body: request.body,
          headers: request.headers, application: admission.category === 'api',
          gateway: admission.gateway, writes: admission.writes });
        if (admission.key === 'metadata') {
          check(response.status === 200, 'browser_metadata_status');
          const data = jsonBody(response); assertPublicResponse(data, { status: 200, kind: 'metadata' });
          assertion('PublicMetadataPrivacy', data.title === 'Next hosted synthetic class' && data.closed === false);
        } else if (admission.key === 'checkin') {
          check(response.status === 200, 'browser_checkin_status'); const data = jsonBody(response);
          assertPublicResponse(data, { status: 200, kind: 'checkin' });
          check(data.name === 'Next One' && (admission.ordinal === 1 ? !data.already : data.already === true), 'browser_checkin_result');
          report.browser.checkinRequests++;
        } else if (admission.key === 'cookieProbe') {
          check(response.status === 405, 'cookie_probe_status'); assertPublicResponse(jsonBody(response), { status: 405 });
        } else if (admission.key === 'refresh') {
          check(response.status === 200, 'browser_refresh_status');
          const next = inspectAuthCookies(response.headers.getSetCookie()), body = jsonBody(response);
          const nextClaims = JSON.parse(Buffer.from(next.token.split('.')[1], 'base64url'));
          check(record(body) && Object.keys(body).join(',') === 'tokens' && record(body.tokens) &&
            Object.keys(body.tokens).sort().join(',') === 'refreshToken,token' && body.tokens.token === next.token && body.tokens.refreshToken === 'dummy' &&
            next.refresh !== actor.cookies.refresh && nextClaims.sub === claims.sub &&
            nextClaims.sessionExpiresAt === claims.sessionExpiresAt && nextClaims.exp - nextClaims.iat === 3600, 'browser_refresh_binding');
          actor.cookies = next; actor.token = next.token;
          assertion('RefreshedSessionDeadline', (await rpc('query', 'attendance:viewer', {}, { token: actor.token })).expiresAt === viewer.expiresAt);
        } else check(response.status === 200, 'browser_asset_status');
        return response;
      } }), remaining(30000), ordinaryAbort.signal);
    assertion('HttpOnlyCookieAndStudentIsolation', browser.cookiesVerified === true);
    assertion('BrowserCookieRefresh', browser.refreshVerified === true && report.assertions.RefreshedSessionDeadline === true);
    await observeCounters(legacyId);
    await browserOperation(() => browser.firstCheckin(), remaining(30000), ordinaryAbort.signal);
    await observeCounters(legacyId);
    const facts = await rpc('query', 'attendance:bucket', { legacyId, bucket: 0 }, { token: actor.token });
    check(facts?.length === 1 && facts[0].checkedInAt, 'first_fact');
    const originalAt = facts[0].checkedInAt;
    const duplicates = [{ 'x-forwarded-for': '198.51.100.71' }, { 'x-vercel-forwarded-for': '203.0.113.82' }];
    for (const headers of duplicates) {
      const result = await browserOperation(() => browser.duplicate(headers), remaining(), ordinaryAbort.signal);
      check(result.status === 200 && result.body.already === true, 'planned_duplicate');
      assertPublicResponse(result.body, { status: 200, kind: 'checkin' });
      await observeCounters(legacyId);
    }
    if (adminSupported) report.ipProvenance = compareIpObservations(snapshots);
    snapshots.length = 0;
    const after = await rpc('query', 'attendance:bucket', { legacyId, bucket: 0 }, { token: actor.token });
    assertion('ThreeFreshProofRequestsOneStableFact', report.browser.checkinRequests === 3 &&
      after?.length === 1 && after[0].checkedInAt === originalAt);
    phase = 'Next logout and old JWT revocation';
    await logoutActor();
    let revoked = false;
    try { await rpc('query', 'attendance:viewer', {}, { token: actor.token }); }
    catch (error) { check(error?.data?.status === 401, 'old_jwt_denial_status'); revoked = true; }
    assertion('OldJwtDenied401AfterNextLogout', revoked);
    report.cleanup.sessionRevocationVerified = revoked;
    check(!fatalObservation && !cancelled, 'runtime_stopped');
    report.functionalFlowCompleted = true;
  } catch (error) {
    report.failedPhase = phase;
    report.failureKind = error instanceof GateError ? error.code : 'transport_or_guard_failure';
  } finally {
    cleaning = true;
    ordinaryAbort.abort();
    // Stop browser activity before closure, but keep provider cleanup behind
    // confirmed closure. Each cleanup action is attempted once, never retried.
    if (browser) try { await within(browser.close(), 3000); report.cleanup.browserClosed = true; }
    catch { report.cleanup.browserClosed = false; }
    else report.cleanup.browserClosed = !report.browser.initializationAttempted || report.browser.closeConfirmed === true;
    if (!report.cleanup.browserClosed) report.cleanup.browserClosureUncertain = true;
    if (identityVerified) {
      if (activationAttempted) try {
        const closed = await rpc('mutation', 'operations:setAvailability', { fingerprint: FINGERPRINT,
          readsEnabled: false, writesEnabled: false }, { admin: true, writes: 1 });
        report.cleanup.closureAcknowledged = closed?.readsEnabled === false && closed.writesEnabled === false;
      } catch { report.cleanup.closureMutationUncertain = true; }
      else report.cleanup.closureAcknowledged = true;
      try {
        const closed = await rpc('query', 'operations:availability', { fingerprint: FINGERPRINT }, { admin: true });
        report.cleanup.availabilityClosed = closed?.readsEnabled === false && closed.writesEnabled === false;
      } catch { report.cleanup.availabilityClosed = false; }
    }
    cleanupTimeout = 4000;
    // On failure, closure always takes priority over a not-yet-attempted logout.
    // Do not repeat a normal-flow logout whose outcome was uncertain.
    if (actor && !actor.logoutAttempted && report.cleanup.availabilityClosed)
      try { await logoutActor(); } catch { report.cleanup.logoutUncertain = true; }
    if (report.cleanup.availabilityClosed) try {
      let result;
      if (expected.prebuilt && !injected.cleanupVercel) {
        const identity = await vercelRequest(`/v13/deployments/${expected.deploymentId}`);
        validatePrebuiltDeployment(identity.body, manifest, { requireReady: false });
        let capabilityRevoked = false;
        try { const revoked = await vercelRequest(expected.automationOwnedRelease ? AUTOMATION_PATH : `/aliases/${expected.deploymentId}/protection-bypass`, {
          method: 'PATCH', body: expected.automationOwnedRelease ? automationRevokeBody(manifest.access.token) : { revoke: { secret: manifest.access.token, regenerate: false } } });
          if (expected.automationOwnedRelease) verifyAutomationRevoked((await vercelRequest(`/v9/projects/${PROJECT}`)).body, manifest.access.token, manifest.access.baseline);
          capabilityRevoked = true; } catch {}
        await vercelRequest(`/v13/deployments/${expected.deploymentId}`, { method: 'DELETE', allowedStatuses: [200, 204] });
        const confirmed = await vercelRequest(`/v13/deployments/${expected.deploymentId}`, { allowedStatuses: [404] });
        result = { capabilityRevoked: capabilityRevoked || (!expected.automationOwnedRelease && confirmed.status === 404), deploymentDeleted: confirmed.status === 404 };
      } else result = await deps.cleanupVercel({ manifest, request: vercelRequest });
      report.cleanup.capabilityRevoked = result.capabilityRevoked === true;
      if (expected.automationOwnedRelease) report.cleanup.providerExpires = false;
      report.cleanup.vercelDeleted = result.deploymentDeleted === true;
    } catch { report.cleanup.vercelCleanupUncertain = true; }
    report.cancelled = cancelled;
    if (report.signupSubmitted && !report.cleanup.logoutConfirmed) report.cleanup.actorAuthorityUncertain = true;
    if (cancelled) report.failedPhase ??= 'cancelled';
    if (fatalObservation) { report.failedPhase ??= 'unexpected_observation'; report.failureKind ??= fatalObservation; }
    report.counters = budget.snapshot(); report.elapsedMs = Math.round(deps.now() - started);
    report.finishedAt = new Date(deps.wallNow()).toISOString();
    report.passed = !!report.functionalFlowCompleted && !report.failedPhase && !cancelled && !fatalObservation &&
      report.ipProvenance.status === 'verified' && report.cleanup.browserClosed &&
      report.cleanup.availabilityClosed && report.cleanup.closureAcknowledged && !report.cleanup.closureMutationUncertain &&
      report.cleanup.logoutConfirmed && report.cleanup.sessionRevocationVerified &&
      report.cleanup.capabilityRevoked && report.cleanup.vercelDeleted &&
      report.assertions.BrowserCookieRefresh && report.assertions.ShortSignedJwtAccepted &&
      report.assertions.ShortSignedJwtExpired401 && report.assertions.ManagedJwtStillAccepted &&
      Object.values(report.assertions).every(Boolean);
    try { await deps.persist({ attemptPath: paths.attempt, evidencePath: paths.evidence, attemptRecord: { ...attempt, phase }, report,
      isCancelled: () => cancelled }); }
    finally { for (const name of workSignals) process.removeListener(name, signal); }
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await runHostedNext();
    console.log(JSON.stringify({ passed: report.passed, failedPhase: report.failedPhase,
      counters: report.counters, cleanup: report.cleanup, ipProvenance: report.ipProvenance }));
    if (!report.passed) process.exitCode = 1;
  } catch { console.error('Hosted Next verification stopped; sensitive details withheld.'); process.exitCode = 1; }
}
