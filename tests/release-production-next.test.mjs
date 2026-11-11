import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { releaseProductionNext, validateOwnedRuntime } from '../scripts/release-production-next.mjs';
import { verifyReleaseReadiness } from '../lib/release-readiness.mjs';

const source='ff8a8553e8d4ee04dd48349a011350db2fab1083';
const cloud='https://tremendous-elk-298.convex.cloud', site='https://tremendous-elk-298.convex.site';
const key='g'.repeat(64), audience='production-audience', fingerprint='f'.repeat(64);
const names=['VercelProPlan','VercelProjectProtection','GitDisconnectPreserved','DailyHeadroom','SignedRuntimeReadiness','ClosedFingerprint','UnauthenticatedProtection','AuthorizedClosedResponse','AuthorizedApplicationIdentity','UnsignedConvexDenied','UnsignedConvexApplicationIdentity','AvailabilityOpened','NextSignup','ManagedSessionDeadline','ShortSignedJwtAccepted','ShortSignedJwtExpired401','ManagedJwtStillAccepted','FiveStudentRoster','PublicMetadataPrivacy','RefreshedSessionDeadline','HttpOnlyCookieAndStudentIsolation','BrowserCookieRefresh','ThreeFreshProofRequestsOneStableFact','OldJwtDenied401AfterNextLogout'];
const report=JSON.stringify({sourceCommit:source,automationOwnedRelease:true,providerExpires:false,hostedNext:true,passed:true,cancelled:false,functionalFlowCompleted:true,ipProvenance:{status:'verified'},assertions:Object.fromEntries(names.map(n=>[n,true])),cleanup:Object.fromEntries(['browserClosed','availabilityClosed','closureAcknowledged','logoutConfirmed','sessionRevocationVerified','capabilityRevoked','vercelDeleted'].map(n=>[n,true]))});
const digest=createHash('sha256').update(report).digest('hex');
const aliases={aliases:[{alias:'attendance.example.com',uid:'alias1'}]};
const head='a'.repeat(40), runCandidate='dpl_candidate', old='dpl_old';
const project=id=>({id:'prj_uOMK1a4PLAgsDr1A16InuImM1M3q',accountId:'team_fmwIPLne9w30y7G5JQrs3fzl',name:'attendance-tracker',framework:'nextjs',nodeVersion:'24.x',buildCommand:null,installCommand:null,targets:{production:{id,target:'production'}},ssoProtection:{deploymentType:'all_except_custom_domains'},link:null});

async function scenario(options={}) {
  const original=process.cwd(), dir=mkdtempSync(join(tmpdir(),'production-release-test-')); mkdirSync(join(dir,'.convex')); process.chdir(dir);
  const events=[]; let writes=false, promoted=false, limit=1000, metadata, polls=0;
  const now=Date.now();
  const credit={teamId:'team_fmwIPLne9w30y7G5JQrs3fzl',teamSlug:'nomokaro625-9385s-projects',plan:'pro',source:'vercel-dashboard-agent-observation',observedAt:new Date(now).toISOString(),periodStart:new Date(now-100000).toISOString(),periodEnd:new Date(now+100000).toISOString(),includedCreditUsd:100,usedCreditUsd:0,otherReservationsUsd:50,creditReservationUsd:1,allTeamUsage:true,reportingLagAcknowledged:true,noOverageAuthorized:true};
  // Use the actual reservation constants so the fixture follows the shared policy.
  const { THIRD }=await import('../scripts/hosted-next-third.mjs'); credit.otherReservationsUsd=THIRD.minimumOtherReservationsUsd; credit.creditReservationUsd=THIRD.creditReservationUsd;
  const opts={convexProjectId:3365270,reviewedHead:head,review:{astraApproved:true,evidenceSha256:'b'.repeat(64)},runtimeNormalExit:true,runtimeReportSha256:digest,fingerprint,keyFile:'private-key',productionConfigFile:'private-config',buildReceiptPath:'receipt',stableAlias:'attendance.example.com'};
  const deps={now:()=>now,git:a=>a[0]==='rev-parse'?head:'',readPublic:()=>options.noRuntime?'{}':report,readPrivateText:p=>p.includes('credit')?JSON.stringify(credit):p==='private-config'?JSON.stringify({ATTENDANCE_GATEWAY_KEY:key,ATTENDANCE_GATEWAY_AUDIENCE:audience,JWT_PRIVATE_KEY:'never-send'}):'private-production-key',readVercelToken:()=> 'secret',readQuotaReview:async()=>({plan:'CONVEX_BASE'}),readPrebuiltReceipt:()=>({commit:source,target:options.wrongTarget?'preview':'production',cloudUrl:cloud,siteUrl:site,outputSha256:'c'.repeat(64)}),archivePrebuiltOutput:()=>({sourceCommit:source,target:'production',outputSha256:'c'.repeat(64),archiveSha256:'d'.repeat(64),sha1:'e'.repeat(40),bodyBuffer:Buffer.from('x'),files:[{file:'.vercel/source.tgz.part1'}]}),wait:async()=>{},fetch:async()=>({status:200,body:null}),client:{query:async()=>({readsEnabled:true,writesEnabled:writes}),mutation:async(_ref,args)=>{events.push(args.writesEnabled?'open':'close'); writes=args.writesEnabled;return {readsEnabled:true,writesEnabled:writes};}},providerJson:async(url,init={})=>{
    const u=new URL(url), path=u.pathname; events.push(`${init.method??'GET'} ${path}`);
    if(path.endsWith('/get_canonical_urls'))return {body:{convexCloudUrl:cloud,convexSiteUrl:site}};
    if(path.endsWith('/list_usage_limits'))return {body:{usageLimits:[{id:'limit1',metric:'functionCalls',window:'day',limitType:'disable',enabled:true,limit}]}};
    if(path.includes('/update_usage_limit/')) {limit=25000;return {body:{}};}
    if(path.startsWith('/v2/teams/'))return {body:{id:'team_fmwIPLne9w30y7G5JQrs3fzl',slug:'nomokaro625-9385s-projects',billing:{plan:'pro'}}};
    if(path.startsWith('/v9/projects/'))return {body:project(promoted?runCandidate:old)};
    if(path===`/v2/deployments/${old}/aliases`)return {body:options.aliasChanged&&metadata?{aliases:[{alias:'other.example.com',uid:'other'}]}:aliases};
    if(path===`/v2/deployments/${runCandidate}/aliases`)return {body:promoted?aliases:{aliases:[]}};
    if(path==='/v2/files')return {body:{}};
    if(path==='/v13/deployments') { metadata=init.body.meta; assert.equal(init.body.target,'production'); assert.equal(init.body.autoAssignCustomDomains,false); assert.equal(init.body.env.JWT_PRIVATE_KEY,undefined); return {body:{id:runCandidate,url:'candidate.vercel.app'}}; }
    if(path===`/v13/deployments/${runCandidate}`) {if(init.method==='DELETE')return {status:204}; if(init.allowedStatuses?.includes(404))return {status:404}; return {body:{id:runCandidate,ownerId:'team_fmwIPLne9w30y7G5JQrs3fzl',projectId:'prj_uOMK1a4PLAgsDr1A16InuImM1M3q',target:'production',url:'candidate.vercel.app',readyState:++polls<(options.readyPolls??1)?'BUILDING':'READY',meta:metadata}};}
    if(path.endsWith('/protection-bypass')) {if(init.body.revoke && options.revokeFails)throw Error('mock'); return {body:{protectionBypass:init.body.generate ? {[init.body.generate.secret]:{scope:'automation-bypass'}} : {}}};}
    if(path==='/api/release-readiness')return {body:options.badProof?{}:verifyReleaseReadiness(init.body,{now,origin:'https://candidate.vercel.app',env:{VERCEL_URL:'candidate.vercel.app',ATTENDANCE_GATEWAY_KEY:key,ATTENDANCE_GATEWAY_AUDIENCE:audience,NEXT_PUBLIC_ATTENDANCE_BACKEND:'convex',NEXT_PUBLIC_CONVEX_URL:cloud,NEXT_PUBLIC_CONVEX_SITE_URL:site,NEXT_PUBLIC_ATTENDANCE_RELEASE:source,CONVEX_DEPLOY_KEY:'',BLOB_READ_WRITE_TOKEN:''},compiled:{backend:'convex',cloudUrl:cloud,siteUrl:site,release:source}})};
    if(path.includes('/promote/')) {promoted=true;if(options.failPersistence)writeFileSync('.convex/production-release/success.tmp','occupied');if(options.promotionFails)throw Error('uncertain');return {body:{}};}
    throw Error(`unexpected ${path}`);
  }};
  try {const result=await releaseProductionNext(opts,deps); const success=existsSync('.convex/production-release/success.json')?JSON.parse(readFileSync('.convex/production-release/success.json','utf8')):null; return {result,events,success};}
  finally {process.chdir(original);rmSync(dir,{recursive:true,force:true});}
}

test('requires all hosted runtime assertions and its exact digest',()=>{assert.equal(validateOwnedRuntime(report,digest),digest);assert.throws(()=>validateOwnedRuntime('{}',digest));const partial=JSON.parse(report); delete partial.assertions.NextSignup;const text=JSON.stringify(partial);assert.throws(()=>validateOwnedRuntime(text,createHash('sha256').update(text).digest('hex')));});
test('wrong target and missing runtime fail before cloud work',async()=>{for(const option of [{wrongTarget:true},{noRuntime:true}]){const {result,events}=await scenario(option);assert.equal(result.passed,false);assert.deepEqual(events,[]);}});
test('success persists only after promotion, public proof and revocation',async()=>{const {result,events,success}=await scenario();assert.equal(result.passed,true);assert.equal(success.report.functionCompleted,true);assert.equal(success.sha256,createHash('sha256').update(JSON.stringify(success.report)).digest('hex'));assert.ok(events.indexOf('open')<events.findIndex(e=>e.includes('/promote/')));assert.ok(events.at(-1).includes('/v9/projects/'));assert.ok(events.some(e=>e.includes('protection-bypass')));});
test('failed proof or changed aliases deletes only the owned candidate',async()=>{for(const option of [{badProof:true},{aliasChanged:true}]){const {result,events}=await scenario(option);assert.equal(result.passed,false);assert.equal(result.cleanup.deploymentDeleted,true);assert.ok(!events.includes('open'));assert.ok(!events.some(e=>e.includes('/promote/')));}});
test('uncertain promotion closes writes and preserves candidate despite revocation failure',async()=>{const {result,events}=await scenario({promotionFails:true,revokeFails:true});assert.equal(result.forwardRepairRequired,true);assert.equal(result.cleanup.writesClosed,true);assert.equal(result.cleanup.capabilityRevocationUncertain,true);assert.ok(events.includes('close'));assert.ok(!events.some(e=>e.startsWith('DELETE ')));});
test('failed capability revocation does not prevent candidate cleanup',async()=>{const {result}=await scenario({badProof:true,revokeFails:true});assert.equal(result.cleanup.capabilityRevocationUncertain,true);assert.equal(result.cleanup.deploymentDeleted,true);});
test('failed final persistence closes writes and preserves the promoted deployment',async()=>{const {result,events,success}=await scenario({failPersistence:true});assert.equal(result.passed,false);assert.equal(result.forwardRepairRequired,true);assert.equal(result.cleanup.writesClosed,true);assert.equal(success,null);assert.ok(!events.some(e=>e.startsWith('DELETE ')));});

test('third readiness poll leaves room for final revocation confirmation',async()=>{const {result,success}=await scenario({readyPolls:3});assert.equal(result.passed,true);assert.equal(success.report.cleanup.capabilityRevoked,true);assert.equal(result.counters.controls,21);});
