// One isolated, prebuilt Preview. No environment pull, backend publication or Git reconnection.
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, openSync, fstatSync, closeSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import * as old from './prepare-hosted-next.mjs';
import { validateVercelCreditReview, validatePreviewBackendCompatibility, OWNED_DEVELOPMENT_PATHS, OWNED_STOPPED_SHA256, validateOwnedStopped, validateOwnedBackend, validateOwnedCompatibility, validateOwnedCanonical, ownedTotals } from './hosted-next-third.mjs';
import { AUTOMATION_PATH, newAutomationSecret, automationGenerateBody, automationRevokeBody, verifyAutomationGenerated, verifyAutomationRevoked } from './vercel-automation-access.mjs';
import { AUTOMATION_PATHS, OWNED_FAILED_SHA256, validateOwnedFailed, validateAutomationProbe, validateFailedAutomationProbe, validateFailedAutomationPublication, automationTotals } from './hosted-next-third.mjs';
import { readQuotaReview } from './hosted-validation-policy.mjs';
import { signReadinessRequest, verifyReadinessResponse } from '../lib/release-readiness.mjs';

const DIR = '.convex/hosted-validation';
export const PREBUILT_PATHS = Object.freeze({ manifest: `${DIR}/prebuilt-preview-manifest.json`,
  publication: 'docs/measurements/hosted-next-prebuilt-setup.json',
  attempt: `${DIR}/prebuilt-runtime-attempt.json`, evidence: 'docs/measurements/hosted-next-prebuilt-verification.json' });
const check = (value, code) => { if (!value) throw Error(code); };
const hash = value => createHash('sha256').update(value).digest('hex');
export function validateStoppedPrebuiltPredecessor(text) {
  const p = JSON.parse(text);
  check(p.passed === false && p.cancelled === false && p.sourceCommit === '61a88ecd0672d971d77100d59226400f5e27bb9e' &&
    p.failedPhase === 'existing deployment compatibility' && p.failure?.category === 'http_status' && p.failure.httpStatus === 400 &&
    p.creationRequests === 0 && p.preflight?.controlRequests === 2 &&
    Object.values(p.counters).every(x => x === 0) &&
    JSON.stringify(p.cumulative) === JSON.stringify({ calls: 63, nextCalls: 2, controls: 35, hosting: 0, writes: 355, gateway: 7, creations: 2 }),
  'prebuilt_predecessor');
  return hash(text);
}
export function validatePrebuiltDeployment(d, m, ready = true) {
  check(d?.id === m.vercel.deploymentId && (d.ownerId ?? d.teamId ?? d.team?.id) === old.EXPECTED.teamId &&
    (d.projectId ?? d.project?.id) === old.EXPECTED.projectId && [null, 'preview'].includes(d.target) &&
    d.meta?.attendanceValidation === m.runId && d.meta?.attendanceSourceCommit === m.sourceCommit &&
    d.meta?.attendanceOutputSha256 === m.vercel.sourcePrebuilt.outputSha256 &&
    /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(m.vercel.url) && `https://${d.url}` === m.vercel.url &&
    (!ready || d.readyState === 'READY'), 'prebuilt_deployment');
}
export function readPrebuiltReceipt(path) {
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const s=fstatSync(fd); check(s.isFile()&&s.uid===process.getuid()&&!(s.mode&0o077)&&s.size<=4*1024*1024,'prebuilt_receipt_permissions');
    const text=readFileSync(fd,'utf8');check(Buffer.byteLength(text)<=4*1024*1024,'prebuilt_receipt_size');return JSON.parse(text);
  } finally {closeSync(fd);}
}
export function persistPrebuiltSuccess(report,{save,persistEvidence}) {
  report.passed=true;report.persistenceFailed=false;
  try { save();persistEvidence(); }
  catch(error) {report.passed=false;report.persistenceFailed=true;throw error;}
}
const automationRevokeBodyFor = access => access.kind === 'project-automation' ? automationRevokeBody(access.token) : {revoke:{secret:access.token,regenerate:false}};
export async function cleanupPrebuiltOwned(m,request) {
  const result={};
  const d=(await request(`/v13/deployments/${m.vercel.deploymentId}`)).body;
  if(!m.vercel.url&&/^[a-z0-9-]+\.vercel\.app$/.test(d.url))m.vercel.url=`https://${d.url}`;
  validatePrebuiltDeployment(d,m,false);result.ownershipVerified=true;
  result.capabilityRevoked=!m.access?.token&&!m.shareCapabilitySubmitted;
  if(m.access?.token) {
    try {const response=await request(m.access.kind === 'project-automation' ? AUTOMATION_PATH : `/aliases/${m.vercel.deploymentId}/protection-bypass`,{method:'PATCH',body:automationRevokeBodyFor(m.access)}); if(m.access.kind === 'project-automation') verifyAutomationRevoked((await request(`/v9/projects/${old.EXPECTED.projectId}`)).body,m.access.token,m.access.baseline); result.capabilityRevoked=true;}
    catch {result.capabilityRevocationUncertain=true;}
  }
  // Failed capability revocation must never skip the independently owned deletion.
  await request(`/v13/deployments/${m.vercel.deploymentId}`,{method:'DELETE',allowedStatuses:[200,204]});
  result.deploymentDeleted=(await request(`/v13/deployments/${m.vercel.deploymentId}`,{allowedStatuses:[404]})).status===404;
  result.capabilityInvalidatedByDeletion=m.access?.kind === 'project-automation' ? false : result.deploymentDeleted;
  if(m.access?.kind === 'project-automation') result.providerExpires=false;
  return result;
}

export async function publishPrebuiltNext({ sourceCommit, buildReceiptPath, ownedDevelopment = false, automation = false }, injected = {}) {
  const paths = automation ? AUTOMATION_PATHS : ownedDevelopment ? OWNED_DEVELOPMENT_PATHS : PREBUILT_PATHS;
  let setupUsage, probe;
  const transport = injected.providerJson ?? old.providerJson;
  const privateText = injected.privateText ?? old.readPrivateText;
  const output = injected.output ?? console.log;
  const started = Date.now();
  let stopped = false, cleaning = false, failedPersistence = false, evidenceOwned=false, token, m;
  const report = { version: 1, sourceCommit, startedAt: new Date(started).toISOString(), passed: false, cancelled: false,
    counters: { controlRequests: 0, hostingRequests: 0, applicationCalls: 0 }, creationRequests: 0, cleanup: {}, productionMutationRequested: false };
  const stop = () => { stopped = true; report.cancelled = true; };
  function decorateReport() {
    report.cancelled=stopped; report.persistenceFailed=failedPersistence;
    report.cumulative=automation && probe ? automationTotals(report.counters, probe, report.creationRequests) : ownedDevelopment && setupUsage ? ownedTotals(report.counters, setupUsage, report.creationRequests) : {calls:63+report.counters.applicationCalls,nextCalls:2+report.counters.applicationCalls,
      controls:35+report.counters.controlRequests,hosting:report.counters.hostingRequests,writes:355,gateway:7,creations:2+report.creationRequests};
    report.finishedAt=new Date().toISOString();
    if(m){m.cumulative=report.cumulative;Object.assign(report,{runId:m.runId,previousStoppedPublicationSha256:m.previousStoppedPublicationSha256,
      sourcePrebuilt:m.vercel.sourcePrebuilt,backendCompatibility:m.backendCompatibility,preflight:m.preflight,thirdContinuation:m.thirdContinuation,
      ...(ownedDevelopment ? { ownedDevelopment: true, setupUsage, previousPrebuiltSha256: m.previousPrebuiltSha256, backendManifestSha256: m.backendManifestSha256 } : {}),
      ...(automation ? { automationOwnedRelease: true, previousOwnedFailedSha256: OWNED_FAILED_SHA256, automationProbe: probe, providerExpires: false } : {}),
      uniqueUrl:m.vercel.url,productionTargetUnchanged:report.passed,productionAliasBindingsUnchanged:report.passed,gitDisconnectPreserved:report.passed});}
  }
  function persistEvidence() {
    if(!evidenceOwned){const fd=openSync(paths.publication,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o644);closeSync(fd);evidenceOwned=true;}
    writeFileSync(paths.publication,JSON.stringify(report,null,2)+'\n',{mode:0o644,flush:true});
  }
  const duration = () => {
    const left = (cleaning ? 600000 : 550000) - (Date.now() - started);
    check(left > 0 && (cleaning || !stopped), 'prebuilt_stopped'); return Math.min(left, 20000);
  };
  const ledger = automation ? '.convex/owned-development-validation/repaired-automation-publication-ledger' : ownedDevelopment ? '.convex/owned-development-validation/publication-ledger' : `${DIR}/prebuilt-publication-ledger`;
  function save() {
    if (!m) return;
    m.counters = { ...report.counters };
    try {
      writeFileSync(`${paths.manifest}.tmp`, JSON.stringify(m, null, 2) + '\n', { mode: 0o600, flush: true });
      renameSync(`${paths.manifest}.tmp`, paths.manifest);
    } catch { failedPersistence = true; if (!cleaning) throw Error('prebuilt_persistence'); }
  }
  async function control(url, options = {}) {
    duration();
    const n = report.counters.controlRequests + 1;
    check(n <= (cleaning ? 20 : automation ? 15 : 16), 'prebuilt_control_budget');
    report.counters.controlRequests = n;
    try { writeFileSync(`${ledger}/request-${String(n).padStart(2,'0')}.json`, JSON.stringify({ ordinal: n, cleaning, reservedAt: new Date().toISOString() }), { mode: 0o400, flag: 'wx', flush: true }); }
    catch { failedPersistence = true; if (!cleaning) throw Error('prebuilt_reservation'); }
    save();
    return transport(url, { ...options, timeoutMs: duration() });
  }
  const vercel = (path, options = {}) => {
    check((automation && path === AUTOMATION_PATH) || /^\/(?:v2\/(?:teams|deployments)\/|v9\/projects\/|v13\/deployments(?:\?|\/|$)|v2\/files$|aliases\/)/.test(path), 'prebuilt_endpoint');
    const url = new URL(path, 'https://api.vercel.com'); url.searchParams.set('teamId', old.EXPECTED.teamId);
    return control(url.href, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } });
  };
  let phase = 'local gates';
  try {
    check(!automation || ownedDevelopment, 'automation_requires_owned');
    check(/^[a-f0-9]{40}$/.test(sourceCommit) && execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim() === sourceCommit, 'prebuilt_source');
    for (const p of Object.values(paths).filter(p => p !== paths.backend)) check(!existsSync(p), 'prebuilt_existing_attempt');
    const predecessor = readFileSync('docs/measurements/hosted-next-third-preview-setup.json','utf8');
    const predecessorHash = validateStoppedPrebuiltPredecessor(predecessor);
    if (ownedDevelopment) validateOwnedStopped(readFileSync(PREBUILT_PATHS.publication, 'utf8'));
    if (automation) { validateOwnedFailed(readFileSync(OWNED_DEVELOPMENT_PATHS.publication, 'utf8'));validateFailedAutomationPublication(readFileSync('docs/measurements/hosted-automation-next-setup.json','utf8'));validateFailedAutomationProbe(readFileSync('docs/measurements/vercel-automation-access-probe.json','utf8')); probe = validateAutomationProbe(JSON.parse(readFileSync('docs/measurements/vercel-automation-access-probe-32.json','utf8'))); }
    const backendText = privateText(ownedDevelopment ? paths.backend : `${DIR}/preview-setup-manifest.json`);
    const backend = JSON.parse(backendText);
    const binding = ownedDevelopment ? validateOwnedBackend(backend, sourceCommit) : old.validateBackendManifest(backend, 'prestigious-jaguar-360');
    setupUsage = ownedDevelopment ? backend.setupUsage : undefined;
    const compatibility = ownedDevelopment ? validateOwnedCompatibility(sourceCommit, backend.reviewedSourceCommit) : validatePreviewBackendCompatibility(sourceCommit, backend.reviewedSourceCommit);
    const receipt = readPrebuiltReceipt(buildReceiptPath);
    check(receipt.commit === sourceCommit && receipt.target === 'preview' && receipt.cloudUrl === binding.cloudUrl &&
      receipt.siteUrl === binding.siteUrl && /^[a-f0-9]{64}$/.test(receipt.outputSha256), 'prebuilt_artifact');
    const { archivePrebuiltOutput } = await import('./build-hosted-prebuilt.mjs');
    const archive = await archivePrebuiltOutput(receipt);
    check(archive.outputSha256 === receipt.outputSha256 && archive.bodyBuffer.length<=4*1024*1024,'prebuilt_changed_or_oversized_output');
    const quota = await readQuotaReview();
    const credit = validateVercelCreditReview(JSON.parse(privateText(`${DIR}/vercel-credit-review.json`)));
    token = old.readVercelToken('/home/nosa/.local/share/com.vercel.cli/auth.json');
    const key = ownedDevelopment ? backend.adminKey : privateText(`${DIR}/retained-project-preview-key.raw`).trim();
    if (!ownedDevelopment) check(key.startsWith('preview:nomokaro625-9385-s-projects:convex-cyan-garden|'), 'prebuilt_preview_key');
    mkdirSync(ledger, { mode: 0o700 });
    writeFileSync(`${ledger}/ALLOCATION.json`, JSON.stringify({ version: 1, sourceCommit, predecessorHash,
      prior: automation ? automationTotals({controlRequests:0,applicationCalls:0,hostingRequests:0},probe,0) : ownedDevelopment ? ownedTotals({controlRequests: 0, applicationCalls: 0, hostingRequests: 0}, setupUsage, 0) : { calls: 63, controls: 35, writes: 355, gateway: 7, creations: 2 }, maximumControls: 20,
      cleanupControls: automation ? 5 : 4, maximumCreations: 1, maximumHosting: 3, maximumApplicationCalls: 1,
      quotaObservedAt: quota.observedAt, creditObservedAt: credit.observedAt }), { mode: 0o400, flag: 'wx', flush: true });
    const runId = `attendance-next-${randomBytes(16).toString('hex')}`;
    m = { version: 1, runId, sourceCommit, publication: 'preflight', backend: binding,
      ...(ownedDevelopment ? { ownedDevelopment: true, setupUsage, previousPrebuiltSha256: OWNED_STOPPED_SHA256, backendManifestSha256: hash(backendText) } : {}),
      ...(automation ? { automationOwnedRelease:true, previousOwnedFailedSha256:OWNED_FAILED_SHA256, automationProbe:probe } : {}),
      previousStoppedPublicationSha256: predecessorHash,
      backendCompatibility: compatibility,
      preflight: { deploymentId: JSON.parse(predecessor).preflight.deploymentId, status: 'replaced-by-signed-runtime', controlRequests: 2 },
      vercel: { teamSlug: old.EXPECTED.teamSlug, teamId: old.EXPECTED.teamId, projectId: old.EXPECTED.projectId,
        target: 'preview', ready: false, sourcePrebuilt: { sourceCommit, outputSha256: receipt.outputSha256, target: 'preview' } } };
    // Consumers retain the exact historical snapshot for budget calculation.
    m.thirdContinuation = JSON.parse(predecessor).thirdContinuation;
    save(); process.on('SIGINT', stop); process.on('SIGTERM', stop);
    phase = 'live identities';
    const live = ownedDevelopment ? undefined : (await control(`https://api.convex.dev/v1/deployments/${binding.name}`, { headers: { Authorization: `Bearer ${key}` } })).body;
    const canonical = (await control(`${binding.cloudUrl}/api/v1/get_canonical_urls`, { headers: { Authorization: `Convex ${backend.adminKey}` } })).body;
    if (ownedDevelopment) validateOwnedCanonical(canonical, backend); else old.validateLiveIdentity(backend, live, canonical);
    old.validateDailyLimit((await control(`${binding.cloudUrl}/api/v1/list_usage_limits`, { headers: { Authorization: `Convex ${backend.adminKey}` } })).body);
    let submitted = false;
    const c = new ConvexHttpClient(binding.cloudUrl, { logger: false, fetch: async (input, init) => {
      check(!submitted && new URL(String(input)).origin === binding.cloudUrl, 'prebuilt_availability_retry'); submitted = true;
      duration(); report.counters.applicationCalls++; save();
      const response = await fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(duration()) });
      const parts=[]; let bytes=0;
      if(response.body) for await(const part of response.body) {
        bytes+=part.byteLength; check(bytes<=1048576,'prebuilt_availability_body'); parts.push(part);
      }
      return new Response(Buffer.concat(parts),{status:response.status,headers:response.headers});
    } }); c.setAdminAuth(backend.adminKey); c.setDebug(false);
    old.validateClosedState(await c.query(makeFunctionReference('operations:availability'), { fingerprint: old.EXPECTED.fingerprint }));
    const team = (await vercel(`/v2/teams/${old.EXPECTED.teamId}`)).body;
    check(team.id === old.EXPECTED.teamId && team.slug === old.EXPECTED.teamSlug && team.billing?.plan === 'pro', 'prebuilt_team');
    const project = (await vercel(`/v9/projects/${old.EXPECTED.projectId}`)).body;
    old.validateProjectForPublication(project, { gitDisconnected: true });
    const productionId = project.targets.production.id;
    const aliases = old.productionAliasBindings((await vercel(`/v2/deployments/${productionId}/aliases`)).body);
    phase = 'prebuilt upload';
    await vercel('/v2/files', { method: 'POST', binaryBody: archive.bodyBuffer,
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(archive.bodyBuffer.length), 'x-now-digest': archive.sha1, 'x-now-size': String(archive.bodyBuffer.length) }, allowedStatuses: [200,201] });
    phase = 'single creation'; report.creationRequests++; m.publication = 'creation submitted or uncertain'; save();
    const env = { NEXT_PUBLIC_ATTENDANCE_BACKEND: 'convex', NEXT_PUBLIC_CONVEX_URL: binding.cloudUrl,
      NEXT_PUBLIC_CONVEX_SITE_URL: binding.siteUrl, NEXT_PUBLIC_ATTENDANCE_RELEASE: sourceCommit,
      CONVEX_DEPLOY_KEY: '', BLOB_READ_WRITE_TOKEN: '', ATTENDANCE_GATEWAY_KEY: backend.config.ATTENDANCE_GATEWAY_KEY,
      ATTENDANCE_GATEWAY_AUDIENCE: backend.config.ATTENDANCE_GATEWAY_AUDIENCE };
    const created = (await vercel('/v13/deployments?prebuilt=1', { method: 'POST', allowedStatuses: [200,201],
      body: { name: 'attendance-tracker', project: old.EXPECTED.projectId, files: archive.files, env,
        meta: { attendanceValidation: runId, attendanceSourceCommit: sourceCommit, attendanceOutputSha256: receipt.outputSha256 } } })).body;
    if (/^dpl_[A-Za-z0-9]+$/.test(created?.id ?? '')) { m.vercel.deploymentId = created.id; report.deploymentId = created.id; save(); }
    check(m.vercel.deploymentId && /^[a-z0-9-]+\.vercel\.app$/.test(created.url), 'prebuilt_creation_identity');
    m.vercel.url = `https://${created.url}`; save(); phase = 'readiness';
    for (let i=0;i<4;i++) {
      const d = (await vercel(`/v13/deployments/${created.id}`)).body; validatePrebuiltDeployment(d,m,false);
      if (d.readyState === 'READY') { m.vercel.ready = true; break; }
      check(!['ERROR','CANCELED'].includes(d.readyState), 'prebuilt_build_failed');
      await sleep(Math.min(i === 0 ? 15000 : 20000, duration()));
    }
    check(m.vercel.ready, 'prebuilt_not_ready');
    const after = (await vercel(`/v9/projects/${old.EXPECTED.projectId}`)).body;
    old.validateProjectForPublication(after,{gitDisconnected:true});
    check(after.targets.production.id === productionId && after.buildCommand === project.buildCommand && after.installCommand === project.installCommand &&
      after.ssoProtection?.deploymentType === project.ssoProtection?.deploymentType, 'prebuilt_project_changed');
    check(JSON.stringify(old.productionAliasBindings((await vercel(`/v2/deployments/${productionId}/aliases`)).body)) === JSON.stringify(aliases), 'prebuilt_alias_changed');
    async function hosting(path, init = {}) {
      duration(); check(++report.counters.hostingRequests <= 3, 'prebuilt_hosting_budget'); save();
      return transport(m.vercel.url + path, { ...init, timeoutMs: duration() });
    }
    duration(); report.counters.hostingRequests++; save();
    const challenged = await fetch(m.vercel.url, { redirect: 'manual', signal: AbortSignal.timeout(duration()) });
    await challenged.body?.cancel();
    check([302,303,307,308,401,403].includes(challenged.status), 'prebuilt_unprotected');
    let capability;
    if (automation) {
      capability = newAutomationSecret();
      const baseline = after.protectionBypass ?? {};
      m.access = { kind:'project-automation', projectId:old.EXPECTED.projectId, token:capability,
        expiresAt:new Date(Date.now()+900000).toISOString(), providerExpires:false, headerVerified:false, baseline }; save();
      const generated = (await vercel(AUTOMATION_PATH,{method:'PATCH',body:automationGenerateBody(capability)})).body;
      verifyAutomationGenerated(generated,capability,baseline);
      await sleep(Math.min(1000, duration()));
    } else {
      m.shareCapabilitySubmitted=true;save();
      capability = (await vercel(`/aliases/${created.id}/protection-bypass`, { method: 'PATCH', body: { ttl: 900 } })).body;
      check(typeof capability === 'string' && capability.length > 0 && capability.length <= 16384 && !/[\u0000-\u0020\u007f]/.test(capability), 'prebuilt_scoped_capability');
      m.access = { kind: 'deployment-shareable', token: capability, expiresAt: new Date(Date.now()+900000).toISOString(), headerVerified: false }; save();
    }
    const request = signReadinessRequest({ version: 1, release: sourceCommit, origin: m.vercel.url,
      audience: backend.config.ATTENDANCE_GATEWAY_AUDIENCE, cloudUrl: binding.cloudUrl, siteUrl: binding.siteUrl,
      issuedAt: Date.now(), nonce: randomBytes(32).toString('hex') }, backend.config.ATTENDANCE_GATEWAY_KEY);
    const ready = await hosting('/api/release-readiness', { method: 'POST', headers: { 'x-vercel-protection-bypass': capability }, body: request });
    check(verifyReadinessResponse(ready.body,request,backend.config.ATTENDANCE_GATEWAY_KEY), 'prebuilt_runtime_verification');
    m.access.headerVerified = true;
    m.environmentVerification = { method: 'local-prebuilt+signed-runtime-v1', sourceCommit, outputSha256: receipt.outputSha256, readinessVerified: true };
    m.readinessProof = { request, response: ready.body }; m.publication = 'ready'; save();
    check(!stopped && !failedPersistence, 'prebuilt_not_successful'); report.passed = true;
    report.environmentVerification = m.environmentVerification;
    decorateReport();
    // Both final writes run while failures still enter catch and owned cleanup.
    persistPrebuiltSuccess(report,{save,persistEvidence});
  } catch (e) { report.passed=false; report.failedPhase = phase; report.failure = old.safePublisherDiagnostic(e); failedPersistence ||= report.persistenceFailed===true; }
  finally {
    cleaning = true;
    if (!report.passed && m?.vercel.deploymentId) {
      try {
        report.cleanup=await cleanupPrebuiltOwned(m,vercel);
      } catch { report.cleanup.incomplete=true; }
    }
    // Success has no additional fallible write after its committed evidence.
    if(!report.passed&&m){m.publication='stopped';m.cleanup=report.cleanup;decorateReport();save();
      report.persistenceFailed=failedPersistence;try{persistEvidence();}catch{report.persistenceFailed=true;}}
    process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
  }
  output(JSON.stringify({passed:report.passed,phase:report.failedPhase,counters:report.counters,cleanup:report.cleanup}));
  return report;
}
