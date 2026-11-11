// Staged, one-shot production release. Import and call only after operator and
// independent review. This module has no CLI and never reads private inputs on import.
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync, renameSync, constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { archivePrebuiltOutput } from './build-hosted-prebuilt.mjs';
import { readPrebuiltReceipt, verifyReadinessWithPropagation } from './publish-prebuilt-next.mjs';
import { providerJson, readPrivateText, readVercelToken, EXPECTED, productionAliasBindings, validateProjectForPublication, safePublisherDiagnostic } from './prepare-hosted-next.mjs';
import { AUTOMATION_PATH, newAutomationSecret, automationGenerateBody, automationRevokeBody, verifyAutomationGenerated, verifyAutomationRevoked } from './vercel-automation-access.mjs';
import { readQuotaReview } from './hosted-validation-policy.mjs';
import { validateVercelCreditReview } from './hosted-next-third.mjs';
import { signReadinessRequest, verifyReadinessResponse } from '../lib/release-readiness.mjs';

const CLOUD = 'https://tremendous-elk-298.convex.cloud';
const SITE = 'https://tremendous-elk-298.convex.site';
const DIR = '.convex/production-release';
const MARKER = '.convex/production-release-allocation.json';
const core = ['app','convex','lib','patches','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','convex.json','proxy.ts','next.config.ts','next.config.js','next.config.mjs','vercel.json','tsconfig.json'];
const assertions = ['VercelProPlan','VercelProjectProtection','GitDisconnectPreserved','DailyHeadroom','SignedRuntimeReadiness','ClosedFingerprint','UnauthenticatedProtection','AuthorizedClosedResponse','AuthorizedApplicationIdentity','UnsignedConvexDenied','UnsignedConvexApplicationIdentity','AvailabilityOpened','NextSignup','ManagedSessionDeadline','ShortSignedJwtAccepted','ShortSignedJwtExpired401','ManagedJwtStillAccepted','FiveStudentRoster','PublicMetadataPrivacy','RefreshedSessionDeadline','HttpOnlyCookieAndStudentIsolation','BrowserCookieRefresh','ThreeFreshProofRequestsOneStableFact','OldJwtDenied401AfterNextLogout'];
const check = (v, code) => { if (!v) throw Error(code); };
const sha = data => createHash('sha256').update(data).digest('hex');
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);

export function validateOwnedRuntime(text, digest) {
  check(/^[a-f0-9]{64}$/.test(digest ?? '') && sha(text) === digest, 'runtime_hash');
  const r = JSON.parse(text);
  check(r.automationOwnedRelease === true && r.providerExpires === false && /^[a-f0-9]{40}$/.test(r.sourceCommit ?? '') && r.hostedNext === true && r.passed === true && r.cancelled === false && !r.failedPhase && r.functionalFlowCompleted === true && r.ipProvenance?.status === 'verified', 'runtime_report');
  check(assertions.every(k => r.assertions?.[k] === true) && Object.values(r.assertions).every(v => v === true), 'runtime_assertions');
  check(['browserClosed','availabilityClosed','closureAcknowledged','logoutConfirmed','sessionRevocationVerified','capabilityRevoked','vercelDeleted'].every(k => r.cleanup?.[k] === true) && !r.cleanup?.closureMutationUncertain, 'runtime_cleanup');
  return sha(text);
}
function limit(body, n) {
  check(Array.isArray(body?.usageLimits), 'limits_shape');
  const matches = body.usageLimits.filter(x => x.metric === 'functionCalls' && x.window === 'day' && x.limitType === 'disable');
  check(matches.length === 1 && matches[0].enabled === true && matches[0].limit === n && /^[A-Za-z0-9_-]+$/.test(String(matches[0].id ?? '')), 'daily_limit');
  return matches[0];
}
function deployment(d, m, ready = false) {
  check(d?.id === m.id && (d.ownerId ?? d.teamId ?? d.team?.id) === EXPECTED.teamId && (d.projectId ?? d.project?.id) === EXPECTED.projectId && d.target === 'production' && d.meta?.attendanceRelease === m.runId && d.meta?.attendanceSourceCommit === m.source && d.meta?.attendanceOutputSha256 === m.output && `https://${d.url}` === m.url && (!ready || d.readyState === 'READY'), 'candidate_identity');
}

export async function releaseProductionNext(opts, injected = {}) {
  const deps = { git: args => execFileSync('git', args, { encoding:'utf8', stdio:['ignore','pipe','ignore'] }),
    readPrivateText, readPrebuiltReceipt, archivePrebuiltOutput, readQuotaReview, providerJson,
    readVercelToken, readPublic: path => readFileSync(path,'utf8'), wait:sleep, now:Date.now, ...injected };
  const report = { version:1, passed:false, counters:{ controls:0, applicationCalls:0, availabilityWrites:0, hosting:0, creations:0 }, cleanup:{} };
  let m, key, config, token, client, capability, automationBaseline, ticket, allocated = false, phase = 'local preflight', cleaning = false, promotionSubmitted = false, stopped = false, writesMayBeOpen = false;
  const start = deps.now();
  const stop = () => { stopped = true; };
  const remaining = () => { const n = (cleaning ? 600000 : 540000) - (deps.now()-start); check(n > 0 && (cleaning || !stopped), 'deadline'); return Math.min(n, 20000); };
  const reserve = (kind, max, ordinaryMax = max) => {
    remaining(); const n = report.counters[kind] + 1; check(n <= (cleaning ? max : ordinaryMax), 'budget'); report.counters[kind] = n;
    writeFileSync(`${DIR}/${kind}-${String(n).padStart(2,'0')}.json`, JSON.stringify({ordinal:n,cleanup:cleaning})+'\n', {flag:'wx',mode:0o600,flush:true});
  };
  const control = async (url, init = {}) => { reserve('controls',30,24); return deps.providerJson(url,{...init,timeoutMs:remaining()}); };
  const vercel = (path, init = {}) => { check(path === AUTOMATION_PATH || (m?.id && path === `/v10/projects/${EXPECTED.projectId}/promote/${m.id}`) || /^\/(?:v2\/teams\/|v2\/deployments\/|v2\/files$|v9\/projects\/|v13\/deployments(?:\?|\/|$))/.test(path), 'vercel_endpoint'); const url = new URL(path,'https://api.vercel.com'); url.searchParams.set('teamId',EXPECTED.teamId); return control(url.href,{...init,headers:{...init.headers,Authorization:`Bearer ${token}`}}); };
  const convex = (path, init = {}) => control(CLOUD+path,{...init,headers:{...init.headers,Authorization:`Convex ${key}`}});
  const availability = async (write, enabled) => {
    reserve('applicationCalls',10,8);
    if (write) { reserve('availabilityWrites',5,3); }
    const args = { fingerprint:opts.fingerprint, ...(write ? {readsEnabled:true,writesEnabled:enabled} : {}) };
    ticket = { path:write ? 'mutation' : 'query', sent:false };
    try { return await (write ? client.mutation(makeFunctionReference('operations:setAvailability'),args) : client.query(makeFunctionReference('operations:availability'),args)); }
    finally { ticket = undefined; }
  };
  const state = (x, writes) => check(x?.readsEnabled === true && x.writesEnabled === writes, 'availability_state');
  const host = async (url, init = {}) => { reserve('hosting',5); return deps.providerJson(url,{...init,timeoutMs:remaining()}); };
  try {
    check(opts && /^[a-f0-9]{40}$/.test(opts.reviewedHead ?? '') && deps.git(['rev-parse','HEAD']).trim() === opts.reviewedHead, 'reviewed_head');
    check(opts.convexProjectId === 3365270, 'production_project');
    check(opts.review?.astraApproved === true && /^[a-f0-9]{64}$/.test(opts.review?.evidenceSha256 ?? '') && opts.runtimeNormalExit === true, 'review_required');
    const runtimeText = deps.readPublic('docs/measurements/hosted-propagated-automation-next-verification.json');
    report.runtimeSha256 = validateOwnedRuntime(runtimeText,opts.runtimeReportSha256);
    const runtimeSource = JSON.parse(runtimeText).sourceCommit;
    check(/^[a-f0-9]{64}$/.test(opts.fingerprint ?? ''), 'fingerprint');
    const receipt = deps.readPrebuiltReceipt(opts.buildReceiptPath);
    check(receipt.target === 'production' && receipt.cloudUrl === CLOUD && receipt.siteUrl === SITE && /^[a-f0-9]{40}$/.test(receipt.commit ?? '') && /^[a-f0-9]{64}$/.test(receipt.outputSha256 ?? ''), 'artifact_target');
    deps.git(['diff','--exit-code',runtimeSource,receipt.commit,'--',...core]);
    deps.git(['diff','--exit-code',receipt.commit,opts.reviewedHead,'--',...core]);
    deps.git(['diff','--exit-code',opts.reviewedHead,'--',...core]);
    check(!deps.git(['ls-files','--others','--exclude-standard','--',...core]).trim(), 'unreviewed_files');
    const archive = await deps.archivePrebuiltOutput(receipt);
    check(archive.outputSha256 === receipt.outputSha256 && archive.sourceCommit === receipt.commit && archive.target === 'production' && Buffer.isBuffer(archive.bodyBuffer) && archive.bodyBuffer.length > 0 && archive.bodyBuffer.length <= 4194304 && archive.files?.length === 1 && archive.files[0].file === '.vercel/source.tgz.part1', 'artifact_changed');
    const quota = await deps.readQuotaReview(); check(quota.plan === 'CONVEX_BASE', 'quota');
    validateVercelCreditReview(JSON.parse(deps.readPrivateText('.convex/hosted-validation/vercel-credit-review.json')),deps.now());
    key = deps.readPrivateText(opts.keyFile).trim(); config = JSON.parse(deps.readPrivateText(opts.productionConfigFile));
    check(key.length > 0 && key.length <= 16384 && !/[\u0000-\u0020\u007f]/.test(key) && typeof config.ATTENDANCE_GATEWAY_KEY === 'string' && Buffer.byteLength(config.ATTENDANCE_GATEWAY_KEY) >= 32 && typeof config.ATTENDANCE_GATEWAY_AUDIENCE === 'string' && config.ATTENDANCE_GATEWAY_AUDIENCE.length > 0, 'private_configuration');
    token = deps.readVercelToken('/home/nosa/.local/share/com.vercel.cli/auth.json');
    // The parent marker and directory are both exclusive and remain on any failure.
    const fd = openSync(MARKER,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600); closeSync(fd);
    mkdirSync(DIR,{mode:0o700}); allocated = true;
    m = {runId:`attendance-production-${randomBytes(16).toString('hex')}`,source:receipt.commit,output:receipt.outputSha256};
    Object.assign(report,{reviewedHead:opts.reviewedHead,artifactSourceCommit:receipt.commit,outputSha256:receipt.outputSha256,archiveSha256:archive.archiveSha256,runId:m.runId});
    writeFileSync(`${DIR}/allocation.json`,JSON.stringify(report)+'\n',{flag:'wx',mode:0o600,flush:true});
    process.on('SIGINT',stop); process.on('SIGTERM',stop);
    client = injected.client ?? new ConvexHttpClient(CLOUD,{logger:false,fetch:async (url, init) => {
      check(ticket && !ticket.sent && String(url) === `${CLOUD}/api/${ticket.path}` && init.method === 'POST','convex_scope'); ticket.sent=true;
      const response = await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(remaining())});
      const chunks=[]; let bytes=0;
      if (response.body) for await (const chunk of response.body) { bytes+=chunk.byteLength; check(bytes<=1048576,'convex_response_size'); chunks.push(chunk); }
      return new Response(Buffer.concat(chunks),{status:response.status,headers:response.headers});
    }});
    if (!injected.client) { client.setAdminAuth(key); client.setDebug(false); }
    phase = 'identity and availability';
    const canonical = (await convex('/api/v1/get_canonical_urls')).body;
    check(canonical?.convexCloudUrl === CLOUD && canonical?.convexSiteUrl === SITE,'canonical');
    state(await availability(false),false);
    const team = (await vercel(`/v2/teams/${EXPECTED.teamId}`)).body;
    check(team?.id === EXPECTED.teamId && team.slug === EXPECTED.teamSlug && team.billing?.plan === 'pro','team');
    const project = (await vercel(`/v9/projects/${EXPECTED.projectId}`)).body; validateProjectForPublication(project,{gitDisconnected:true});
    const previous = project.targets.production.id;
    const aliases = productionAliasBindings((await vercel(`/v2/deployments/${previous}/aliases`)).body);
    check(typeof opts.stableAlias === 'string' && aliases.some(x => x.alias === opts.stableAlias && !x.redirect), 'stable_alias');
    const before = limit((await convex('/api/v1/list_usage_limits')).body,1000);
    phase = 'upload';
    await vercel('/v2/files',{method:'POST',binaryBody:archive.bodyBuffer,headers:{'Content-Type':'application/octet-stream','Content-Length':String(archive.bodyBuffer.length),'x-now-digest':archive.sha1,'x-now-size':String(archive.bodyBuffer.length)},allowedStatuses:[200,201]});
    phase = 'creation'; reserve('creations',1); report.creationSubmitted=true;
    const env = {NEXT_PUBLIC_ATTENDANCE_BACKEND:'convex',NEXT_PUBLIC_CONVEX_URL:CLOUD,NEXT_PUBLIC_CONVEX_SITE_URL:SITE,NEXT_PUBLIC_ATTENDANCE_RELEASE:receipt.commit,CONVEX_DEPLOY_KEY:'',BLOB_READ_WRITE_TOKEN:'',ATTENDANCE_GATEWAY_KEY:config.ATTENDANCE_GATEWAY_KEY,ATTENDANCE_GATEWAY_AUDIENCE:config.ATTENDANCE_GATEWAY_AUDIENCE};
    const created = (await vercel('/v13/deployments?prebuilt=1',{method:'POST',allowedStatuses:[200,201],body:{name:'attendance-tracker',project:EXPECTED.projectId,target:'production',autoAssignCustomDomains:false,files:archive.files,env,meta:{attendanceRelease:m.runId,attendanceSourceCommit:m.source,attendanceOutputSha256:m.output}}})).body;
    check(/^dpl_[A-Za-z0-9]+$/.test(created?.id ?? '') && /^[a-z0-9-]+\.vercel\.app$/.test(created.url ?? ''),'created_identity'); m.id=created.id; m.url=`https://${created.url}`; report.deploymentId=m.id;
    phase = 'candidate readiness';
    let ready = false;
    for (let i=0;i<3;i++) { const d=(await vercel(`/v13/deployments/${m.id}`)).body; deployment(d,m); if (d.readyState === 'READY') {ready=true;break;} check(!['ERROR','CANCELED'].includes(d.readyState),'candidate_failed'); if(i<2) await deps.wait(Math.min(15000,remaining())); }
    check(ready,'candidate_not_ready');
    const current = (await vercel(`/v9/projects/${EXPECTED.projectId}`)).body; validateProjectForPublication(current,{gitDisconnected:true});
    check([previous,m.id].includes(current.targets.production.id) && same(productionAliasBindings((await vercel(`/v2/deployments/${previous}/aliases`)).body),aliases),'aliases_changed');
    automationBaseline = current.protectionBypass ?? {};
    capability = newAutomationSecret();
    writeFileSync(`${DIR}/automation-access.json`,JSON.stringify({projectId:EXPECTED.projectId,token:capability,baseline:automationBaseline,providerExpires:false})+'\n',{flag:'wx',mode:0o600,flush:true});
    const generated = (await vercel(AUTOMATION_PATH,{method:'PATCH',body:automationGenerateBody(capability)})).body;
    verifyAutomationGenerated(generated,capability,automationBaseline);
    await deps.wait(Math.min(1000,remaining()));
    const proof=await verifyReadinessWithPropagation({key:config.ATTENDANCE_GATEWAY_KEY,
      createRequest:()=>signReadinessRequest({version:1,release:m.source,origin:m.url,audience:config.ATTENDANCE_GATEWAY_AUDIENCE,cloudUrl:CLOUD,siteUrl:SITE,issuedAt:deps.now(),nonce:randomBytes(32).toString('hex')},config.ATTENDANCE_GATEWAY_KEY),
      send:signed=>host(`${m.url}/api/release-readiness`,{method:'POST',headers:{'x-vercel-protection-bypass':capability},body:signed}),
      wait:ms=>deps.wait(Math.min(ms,remaining()))});
    // HTML is intentionally fetched without parsing or retaining its contents.
    reserve('hosting',5); const page = await (injected.fetch ?? fetch)(m.url,{headers:{'x-vercel-protection-bypass':capability},redirect:'manual',signal:AbortSignal.timeout(remaining())}); await page.body?.cancel(); check(page.status === 200,'candidate_homepage');
    phase = 'quota limit';
    await convex(`/api/v1/update_usage_limit/${before.id}`,{method:'POST',body:{metric:'functionCalls',window:'day',limitType:'disable',limit:25000,enabled:true}});
    check(String(limit((await convex('/api/v1/list_usage_limits')).body,25000).id) === String(before.id),'limit_id');
    phase = 'enable writes'; check(same(productionAliasBindings((await vercel(`/v2/deployments/${previous}/aliases`)).body),aliases),'aliases_changed_before_enable');
    writesMayBeOpen=true; state(await availability(true,true),true); state(await availability(false),true);
    phase = 'promote'; promotionSubmitted=true;
    await vercel(`/v10/projects/${EXPECTED.projectId}/promote/${m.id}`,{method:'POST',body:{},allowedStatuses:[200,201,202]});
    phase = 'promotion confirmation';
    let promotionComplete=false;
    for(let i=0;i<3;i++) {
      const promoted=(await vercel(`/v9/projects/${EXPECTED.projectId}`)).body;
      validateProjectForPublication(promoted,{gitDisconnected:true});
      const job=promoted.lastAliasRequest;
      check(job?.toDeploymentId===m.id && job.type==='promote','promotion_job_identity');
      if(job.jobStatus==='succeeded') {check(promoted.targets.production.id===m.id,'production_pointer');promotionComplete=true;break;}
      check(['pending','in-progress'].includes(job.jobStatus),'promotion_failed');
      if(i<2)await deps.wait(Math.min(10000,remaining()));
    }
    check(promotionComplete,'promotion_not_complete');
    check(same(productionAliasBindings((await vercel(`/v2/deployments/${m.id}/aliases`)).body),aliases),'production_aliases');
    reserve('hosting',5); const publicPage=await (injected.fetch ?? fetch)(`https://${opts.stableAlias}/`,{redirect:'manual',signal:AbortSignal.timeout(remaining())}); await publicPage.body?.cancel(); check(publicPage.status === 200,'public_homepage');
    phase = 'capability revocation'; const revoked=(await vercel(AUTOMATION_PATH,{method:'PATCH',body:automationRevokeBody(capability)})).body; verifyAutomationRevoked((await vercel(`/v9/projects/${EXPECTED.projectId}`)).body,capability,automationBaseline); capability=undefined; report.cleanup.capabilityRevoked=true; report.cleanup.providerExpires=false;
    report.passed=true; report.functionCompleted=true; report.finishedAt=new Date(deps.now()).toISOString();
    // A single exclusive final record is the final write on success.
    const payload=JSON.stringify(report); writeFileSync(`${DIR}/success.tmp`,JSON.stringify({report,sha256:sha(payload)},null,2)+'\n',{flag:'wx',mode:0o600,flush:true});
    renameSync(`${DIR}/success.tmp`,`${DIR}/success.json`);
  } catch (error) {
    report.passed=false; report.failedPhase=phase; report.failure=safePublisherDiagnostic(error); report.forwardRepairRequired=promotionSubmitted;
    if (report.creationSubmitted && !m?.id) report.creationOutcomeUncertain=true;
    cleaning=true;
    if (client && allocated && writesMayBeOpen) { try { state(await availability(true,false),false); state(await availability(false),false); report.cleanup.writesClosed=true; } catch { report.cleanup.writesClosureUncertain=true; } }
    if (m?.id) {
      if (capability) try { const revoked=(await vercel(AUTOMATION_PATH,{method:'PATCH',body:automationRevokeBody(capability)})).body; verifyAutomationRevoked((await vercel(`/v9/projects/${EXPECTED.projectId}`)).body,capability,automationBaseline); report.cleanup.capabilityRevoked=true; report.cleanup.providerExpires=false; } catch { report.cleanup.capabilityRevocationUncertain=true; }
      if (!promotionSubmitted) try {
        const d=(await vercel(`/v13/deployments/${m.id}`)).body; deployment(d,m);
        const bound=(await vercel(`/v2/deployments/${m.id}/aliases`)).body; check(Array.isArray(bound?.aliases) && bound.aliases.length === 0 && !bound.pagination?.next,'candidate_aliased');
        await vercel(`/v13/deployments/${m.id}`,{method:'DELETE',allowedStatuses:[200,204]});
        report.cleanup.deploymentDeleted=(await vercel(`/v13/deployments/${m.id}`,{allowedStatuses:[404]})).status===404;
      } catch { report.cleanup.deletionUncertain=true; }
    }
    if (allocated) try { writeFileSync(`${DIR}/failed.json`,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600,flush:true}); } catch { report.persistenceFailed=true; }
  } finally { process.removeListener('SIGINT',stop); process.removeListener('SIGTERM',stop); }
  return report;
}
