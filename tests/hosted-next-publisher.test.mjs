import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { EXPECTED, validateBackendManifest, validateClosedState, validateDailyLimit,
  validateLiveIdentity, validateSource, validateBuildHooks, deploymentEnvironment, deploymentFlags,
  validateVercelDeployment, deploymentBody, cleanupOwnedVercel, providerJson } from '../scripts/prepare-hosted-next.mjs';

const name = 'fixture-preview-123';
function fixture() {
  const reference = 'preview/attendance-validation-' + 'a'.repeat(32);
  return { deploymentName: name, team: 'nomokaro625-9385-s-projects', project: 'convex-cyan-garden',
    isNewDeployment: true, identifier: reference.slice(8), reference,
    cloudUrl: `https://${name}.convex.cloud`, siteUrl: `https://${name}.convex.site`,
    managementIdentity: { kind: 'cloud', name, deploymentType: 'preview', isDefault: false,
      id: 1, projectId: 2, reference, deploymentUrl: `https://${name}.convex.cloud` },
    publication: 'succeeded', environmentConfigured: true, limitVerified: true, adminCapabilityVerified: true,
    reviewedSourceCommit: 'a'.repeat(40), adminKey: 'synthetic',
    config: { ATTENDANCE_GATEWAY_KEY: 'a'.repeat(32), ATTENDANCE_GATEWAY_AUDIENCE: 'synthetic' } };
}
test('backend identity, closed state and limit fail closed', () => {
  const m = fixture();
  assert.equal(validateBackendManifest(m, name).fingerprint, EXPECTED.fingerprint);
  validateLiveIdentity(m, m.managementIdentity, { convexCloudUrl: m.cloudUrl, convexSiteUrl: m.siteUrl });
  assert.throws(() => validateLiveIdentity(m, { ...m.managementIdentity, projectId: 3 }, { convexCloudUrl: m.cloudUrl, convexSiteUrl: m.siteUrl }));
  assert.throws(() => validateBackendManifest({ ...m, reference: 'production' }, name));
  validateClosedState({ readsEnabled: false, writesEnabled: false });
  assert.throws(() => validateClosedState({ readsEnabled: false, writesEnabled: true }));
  const limit = { metric: 'functionCalls', window: 'day', limitType: 'disable', limit: 1000, enabled: true };
  validateDailyLimit({ usageLimits: [limit] });
  assert.throws(() => validateDailyLimit({ usageLimits: [limit, limit] }));
  assert.throws(() => validateDailyLimit({ usageLimits: [{ ...limit, limit: 1001 }] }));
});
test('flags never contain values and server capability stays out of build flags', () => {
  const flags = deploymentFlags(), env = deploymentEnvironment(fixture());
  assert.equal(env.CONVEX_DEPLOY_KEY, ''); assert.equal(env.BLOB_READ_WRITE_TOKEN, '');
  assert(!flags.includes(env.ATTENDANCE_GATEWAY_KEY));
  assert(!flags.some((value, index) => value === '--build-env' && flags[index + 1] === 'ATTENDANCE_GATEWAY_KEY'));
});
test('source checks reject a changed head or untracked relevant files', () => {
  const sha = 'a'.repeat(40);
  const git = args => args[0] === 'rev-parse' ? sha : args[0] === 'ls-files' ? 'app/untracked.ts' : '';
  assert.throws(() => validateSource(sha, sha, git), /untracked_source/);
  assert.throws(() => validateSource('b'.repeat(40), sha, git), /head_mismatch/);
});
test('build hooks are restricted to the reviewed commands', () => {
  const config = { framework: 'nextjs', installCommand: 'pnpm install --frozen-lockfile', buildCommand: 'pnpm build' };
  const pkg = { scripts: { build: 'node --version && next build' } };
  validateBuildHooks(config, pkg);
  assert.throws(() => validateBuildHooks({ ...config, buildCommand: 'convex deploy' }, pkg));
});

const deploymentExpected = { deploymentId: 'dpl_fixture', url: 'https://fixture.vercel.app',
  runId: 'synthetic-run', sourceCommit: 'a'.repeat(40) };
function deploymentFixture() {
  return { id: deploymentExpected.deploymentId, url: 'fixture.vercel.app',
    ownerId: EXPECTED.teamId, projectId: EXPECTED.projectId, target: null, readyState: 'READY',
    meta: { attendanceValidation: deploymentExpected.runId, attendanceSourceCommit: deploymentExpected.sourceCommit,
      githubCommitSha: deploymentExpected.sourceCommit }, gitSource: { sha: deploymentExpected.sourceCommit } };
}
test('deployment creation binds Git SHA and keeps private env outside build and project settings', () => {
  const backend = fixture(), body = deploymentBody(backend, deploymentExpected.sourceCommit, deploymentExpected.runId);
  assert.equal(body.gitSource.sha, deploymentExpected.sourceCommit);
  assert.equal(body.gitSource.ref, body.gitSource.sha);
  assert.equal(body.project, EXPECTED.projectId);
  assert(!Object.hasOwn(body, 'projectSettings'));
  assert(!Object.hasOwn(body, 'target')); // API's documented Preview default.
  assert.equal(body.env.ATTENDANCE_GATEWAY_KEY, backend.config.ATTENDANCE_GATEWAY_KEY);
  assert(!Object.hasOwn(body.build.env, 'ATTENDANCE_GATEWAY_KEY'));
  assert.equal(body.build.env.CONVEX_DEPLOY_KEY, '');
  assert.equal(body.env.BLOB_READ_WRITE_TOKEN, '');
});
test('destructive ownership gate rejects production, wrong owner, changed source and changed URL', () => {
  validateVercelDeployment(deploymentFixture(), deploymentExpected);
  for (const change of [d => { d.target = 'production'; }, d => { d.ownerId = 'other'; },
    d => { d.teamId = 'contradictory'; }, d => { d.projectId = 'other'; },
    d => { d.url = 'other.vercel.app'; }, d => { d.meta.githubCommitSha = 'b'.repeat(40); },
    d => { d.meta.attendanceValidation = 'old-run'; }, d => { d.readyState = 'BUILDING'; }]) {
    const candidate = deploymentFixture(); change(candidate);
    assert.throws(() => validateVercelDeployment(candidate, deploymentExpected));
  }
});
test('failed capability revocation still attempts exact owned deployment deletion and confirms404', async () => {
  const calls=[];
  const manifest={runId:deploymentExpected.runId,sourceCommit:deploymentExpected.sourceCommit,
    vercel:deploymentExpected,access:{token:'synthetic'}};
  const request=async(path,options={})=>{
    calls.push({path,...options});
    if(calls.length===1)return{status:200,body:deploymentFixture()};
    if(options.method==='PATCH')throw Error('synthetic uncertain revoke');
    if(options.method==='DELETE')return{status:200,body:{}};
    return{status:404,body:{}};
  };
  const result=await cleanupOwnedVercel({manifest,request});
  assert.equal(result.capabilityRevocationUncertain,true);
  assert.equal(result.capabilityRevoked,false);
  assert.equal(result.deploymentDeleted,true);
  assert.equal(result.capabilityInvalidatedByDeletion,true);
  assert.equal(calls.length,4);
  assert(calls.every(call=>call.path.includes(deploymentExpected.deploymentId)));
  let attempted=0;
  await assert.rejects(cleanupOwnedVercel({manifest,request:async()=>{
    attempted++;return{status:200,body:{...deploymentFixture(),ownerId:'other'}};
  }}));
  assert.equal(attempted,1);
});
test('provider transport disables redirects/retries and bounds streamed bytes', async () => {
  let attempts=0;
  const response=await providerJson('https://api.vercel.com/fixture',{body:{synthetic:true},method:'POST',fetchImpl:async(url,init)=>{
    attempts++;assert.equal(init.redirect,'error');assert.equal(init.method,'POST');
    return new Response(JSON.stringify({ok:true}),{status:200});
  }});
  assert.equal(response.body.ok,true);assert.equal(attempts,1);
  await assert.rejects(providerJson('https://api.vercel.com/fixture',{fetchImpl:async()=>new Response('x'.repeat(1024*1024+1))}),/response_size/);
  await assert.rejects(providerJson('https://api.vercel.com/fixture',{fetchImpl:async()=>new Response('{}',{status:503})}),/provider_status/);
});
