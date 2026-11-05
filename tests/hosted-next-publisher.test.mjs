import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { EXPECTED, validateBackendManifest, validateClosedState, validateDailyLimit,
  validateLiveIdentity, validateSource, validateBuildHooks, deploymentEnvironment, deploymentFlags,
  validateVercelDeployment, deploymentBody, cleanupOwnedVercel, providerJson, prepareHostedNext,
  safePublisherDiagnostic, validateEffectiveEnvironment } from '../scripts/prepare-hosted-next.mjs';
import { CONTINUATION, ORIGINAL_PATHS, CONTINUATION_PATHS, continuationTotals } from '../scripts/hosted-next-continuation.mjs';
import { historyText, originalPublication } from './fixtures/hosted-next-history.mjs';

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

async function publicationScenario(options={}) {
  const backend=fixture(), writes=new Map(), calls=[], logs=[];
  const paths=options.continuation?CONTINUATION_PATHS:ORIGINAL_PATHS;
  const original=originalPublication(validateBackendManifest(backend,name));
  if(options.continuation){
    options.mutateHistory?.(original);
    writes.set(ORIGINAL_PATHS.manifest,structuredClone(original));
    writes.set(ORIGINAL_PATHS.publication,JSON.parse(historyText));
  }
  const historical=JSON.stringify([...writes]);
  const sha='a'.repeat(40); let createdBody, deleted=false, diskFailed=false, aliasReads=0, exitFailures=0;
  const project={id:EXPECTED.projectId,accountId:EXPECTED.teamId,name:'attendance-tracker',framework:'nextjs',
    nodeVersion:'24.x',buildCommand:null,installCommand:null,
    link:{type:'github',repoId:1409352117,org:'nosabecom',repo:'attendancetracker'},
    targets:{production:{id:'dpl_production',target:'production'}},ssoProtection:{deploymentType:'all_except_custom_domains'}};
  const deployment=()=>({...deploymentFixture(),meta:{...createdBody.meta,githubCommitSha:sha}});
  const json=(body,status=200)=>new Response(body===null?null:JSON.stringify(body),{status});
  const deps={
    vercelToken:'synthetic-api-token',
    git:args=>args[0]==='rev-parse'?sha:'',
    readQuotaReview:async()=>({observedAt:'2026-11-05T00:00:00Z',source:'synthetic-offline-fixture'}),
    readPrivateText:path=>path===ORIGINAL_PATHS.manifest&&options.continuation?JSON.stringify(original):
      path.endsWith('preview-setup-manifest.json')?JSON.stringify(backend):
        'preview:nomokaro625-9385-s-projects:convex-cyan-garden|synthetic',
    readPublicText:path=>{assert.equal(path,ORIGINAL_PATHS.publication);return historyText+(options.corruptHistory?'\n':'');},
    assertAbsent:path=>{
      assert([ORIGINAL_PATHS.attempt,...Object.values(CONTINUATION_PATHS)].includes(path));
      if(options.originalRuntimeExists&&path===ORIGINAL_PATHS.attempt)throw Error('original_runtime_exists');
      if(writes.has(path))throw Error('continuation_record_exists');
    },
    readPublicJson:path=>path==='vercel.json'?{framework:'nextjs',installCommand:'pnpm install --frozen-lockfile',buildCommand:'pnpm build'}:
      {scripts:{build:'node --version && next build'}},
    persist:(path,contents,settings={})=>{
      if(options.continuation)assert(!Object.values(ORIGINAL_PATHS).includes(path));
      if(diskFailed || options.failEvidence && path.startsWith('docs/'))throw Object.assign(Error('synthetic disk full'),{code:'ENOSPC'});
      if(settings.exclusive && (options.existingAttempt || writes.has(path)))throw Object.assign(Error('synthetic existing'),{code:'EEXIST'});
      writes.set(path,JSON.parse(contents));
    },
    failProcess:()=>{exitFailures++;},output:value=>logs.push(JSON.parse(value)),sleep:async()=>{},
    fetch:async(input,init={})=>{
      const url=new URL(String(input)), method=init.method??'GET';calls.push({host:url.host,path:url.pathname,method});
      if(url.host==='api.convex.dev')return json(backend.managementIdentity);
      if(url.pathname==='/api/v1/get_canonical_urls')return json({convexCloudUrl:backend.cloudUrl,convexSiteUrl:backend.siteUrl});
      if(url.pathname==='/api/v1/list_usage_limits')return json({usageLimits:[{metric:'functionCalls',window:'day',limitType:'disable',limit:1000,enabled:true}]});
      if(url.pathname==='/api/query')return json({status:'success',value:{readsEnabled:false,writesEnabled:false}});
      if(url.pathname.startsWith('/v2/teams/'))return json({id:EXPECTED.teamId,slug:'nomokaro625-9385s-projects',billing:{plan:'hobby'}});
      if(url.pathname.startsWith('/v9/projects/'))return json(project);
      if(url.pathname==='/v2/deployments/dpl_production/aliases'){
        aliasReads++;return json({aliases:[{alias:options.changeAliases&&aliasReads>1?'changed.example':'production.example',uid:'stable-alias'}]});
      }
      if(url.pathname==='/v13/deployments'&&method==='POST'){
        const record=writes.get(paths.manifest);
        assert.equal(record.creationState,'submitted; outcome uncertain');
        assert.equal(record.cleanupReservation.controlRequests,4);
        assert.equal(record.cleanupReservation.automaticResume,false);
        createdBody=JSON.parse(init.body);
        if(options.diskFailureAfterCreation)diskFailed=true;
        return json(options.missingCreationUrl?{id:'dpl_fixture'}:{id:'dpl_fixture',url:'fixture.vercel.app'});
      }
      if(url.pathname==='/v13/deployments/dpl_fixture'){
        if(method==='DELETE'){deleted=true;return json({});}
        return deleted?json({},404):json(deployment());
      }
      if(url.pathname==='/v3/env/pull/dpl_fixture'){
        if(options.environmentTransportFailure)throw Error(options.environmentTransportFailure);
        if(options.environmentStatus)return json({error:options.sentinel},options.environmentStatus);
        if(options.environmentRaw!==undefined)return new Response(options.environmentRaw,{status:200});
        const actual={env:{...createdBody.env},buildEnv:{...createdBody.build.env}};
        if(options.blobEnvironment)actual.buildEnv.NEXT_PUBLIC_ATTENDANCE_BACKEND='blob';
        if(options.inheritedCredential)actual.env.CONVEX_DEPLOY_KEY='synthetic-inherited';
        if(options.redactedGateway)actual.env.ATTENDANCE_GATEWAY_KEY='[REDACTED]';
        return json(options.environmentTransform?options.environmentTransform(actual):actual);
      }
      if(url.pathname==='/aliases/dpl_fixture/protection-bypass')return json('synthetic-scoped-token');
      if(url.host==='fixture.vercel.app')return new Response(null,{status:init.headers?.['x-vercel-protection-bypass']?200:401});
      throw Error('Unexpected offline request');
    },
  };
  const args=['--expected-preview',name,...(options.continuation?['--continue-after',CONTINUATION.predecessorDeploymentId]:[])];
  const run=()=>prepareHostedNext(args,{
    ATTENDANCE_VALIDATION_SOURCE_COMMIT:sha,ATTENDANCE_PREVIEW_KEY_FILE:'synthetic-key-file',
  },deps);
  const report=await run();
  return{report,calls,writes,logs,deleted,exitFailures,historical,run};
}
test('publication orchestration validates effective maps and leaves an owned protected ready control',async()=>{
  const r=await publicationScenario();
  assert.equal(r.report.passed,true);assert.equal(r.deleted,false);assert.equal(r.exitFailures,0);
  assert.deepEqual(r.report.environmentVerified,{build:true,runtime:true,credentialOverrides:true});
  assert.equal(r.report.productionAliasBindingsUnchanged,true);
  assert.equal(r.report.counters.applicationCalls,1);
  assert.equal(r.report.counters.hostingRequests,2);
  assert(r.report.counters.controlRequests<=16);
  assert.equal(r.calls.filter(call=>call.path==='/v13/deployments'&&call.method==='POST').length,1);
  assert.equal(r.writes.get('.convex/hosted-validation/next-preview-manifest.json').publication,'ready');
});
for(const option of ['blobEnvironment','inheritedCredential','redactedGateway'])test(`orchestration rejects ${option} and cleans up before any access probe`,async()=>{
  const r=await publicationScenario({[option]:true});
  assert.equal(r.report.passed,false);assert.equal(r.report.failedPhase,'effective environment');
  assert.equal(r.report.counters.hostingRequests,0);assert.equal(r.deleted,true);
  assert.equal(r.report.cleanup.deploymentDeleted,true);
});
test('persistent storage failure after creation still spends only its reserved cleanup and reports the retained ID',async()=>{
  const r=await publicationScenario({diskFailureAfterCreation:true});
  assert.equal(r.report.passed,false);assert.equal(r.report.persistenceFailed,true);
  assert.equal(r.report.cleanup.deploymentDeleted,true);assert.equal(r.deleted,true);
  assert.equal(r.report.deploymentId,'dpl_fixture');assert.equal(r.logs.at(-1).deploymentId,'dpl_fixture');
  assert.equal(r.calls.filter(call=>call.path==='/v13/deployments/dpl_fixture').length,3);
  assert(r.report.counters.controlRequests<=20);
});
test('production alias mutation is detected even with unchanged production deployment ID',async()=>{
  const r=await publicationScenario({changeAliases:true});
  assert.equal(r.report.passed,false);assert.equal(r.report.productionAliasBindingsUnchanged,undefined);
  assert.equal(r.report.productionTargetUnchanged,true);assert.equal(r.deleted,true);
});
test('missing creation URL retains the ID and verifies ownership through its management record before deletion',async()=>{
  const r=await publicationScenario({missingCreationUrl:true});
  assert.equal(r.report.passed,false);assert.equal(r.report.deploymentId,'dpl_fixture');
  assert.equal(r.report.cleanup.ownershipVerified,true);assert.equal(r.deleted,true);
});
test('evidence storage failure enters cleanup and existing exclusive attempts are never overwritten',async()=>{
  const failed=await publicationScenario({failEvidence:true});
  assert.equal(failed.report.passed,false);assert.equal(failed.deleted,true);assert.equal(failed.report.persistenceFailed,true);
  const exists=await publicationScenario({existingAttempt:true});
  assert.equal(exists.report.passed,false);assert.equal(exists.calls.length,0);assert.equal(exists.writes.size,0);
});

const sentinel = 'SYNTHETIC_PRIVATE_SENTINEL_DO_NOT_SERIALIZE';
for (const [category, expectedStatus, response] of [
  ['transport', undefined, () => { throw Object.assign(Error(sentinel), { cause: { secret: sentinel } }); }],
  ['http_status', 403, () => new Response(JSON.stringify({ error: sentinel }), { status: 403 })],
  ['invalid_json', 200, () => new Response('invalid:' + sentinel, { status: 200 })],
  ['oversized_response', 200, () => new Response(sentinel + 'x'.repeat(1024 * 1024), { status: 200 })],
]) test(`provider ${category} diagnostics retain only its fixed category and numeric status`, async () => {
  let attempts = 0, failure;
  try { await providerJson('https://api.vercel.com/fixture', { fetchImpl: async () => {
    attempts++; return response();
  } }); } catch (error) { failure = error; }
  assert(failure); assert.equal(attempts, 1);
  const diagnostic = safePublisherDiagnostic(failure);
  assert.deepEqual(diagnostic, { category, ...(expectedStatus ? { httpStatus: expectedStatus } : {}) });
  assert(!JSON.stringify({ diagnostic, error: String(failure) }).includes(sentinel));
});

test('unclassified errors cannot forge a diagnostic or expose arbitrary messages and properties', () => {
  const error = Object.assign(Error(sentinel), { category: sentinel, httpStatus: 403,
    diagnostic: { category: sentinel }, headers: { secret: sentinel } });
  assert.deepEqual(safePublisherDiagnostic(error), { category: 'unclassified' });
  assert.deepEqual(safePublisherDiagnostic(sentinel), { category: 'unclassified' });
});

function effectiveFixture() {
  const body = deploymentBody(fixture(), 'a'.repeat(40), 'synthetic-run');
  return { env: body.env, buildEnv: body.build.env };
}
test('environment diagnostics distinguish missing, null, array and other maps without serializing contents', () => {
  for (const [value, shape] of [[undefined, 'missing'], [null, 'null'], [[], 'array'], [sentinel, 'other']]) {
    const records = effectiveFixture(); records.buildEnv = value;
    let failure;
    try { validateEffectiveEnvironment(records, fixture(), { httpStatus: 200 }); } catch (error) { failure = error; }
    const diagnostic = safePublisherDiagnostic(failure);
    assert.equal(diagnostic.category, 'missing_or_malformed_maps'); assert.equal(diagnostic.httpStatus, 200);
    assert.deepEqual(diagnostic.environment.build, { shape });
    assert.equal(diagnostic.environment.runtime.fields.gatewayKey, 'string');
    assert(!JSON.stringify(diagnostic).includes(sentinel));
  }
});

test('exact empty overrides remain required in both resolved maps; absence, redaction and inherited values reject', () => {
  assert.deepEqual(validateEffectiveEnvironment(effectiveFixture(), fixture()),
    { build: true, runtime: true, credentialOverrides: true });
  for (const map of ['env', 'buildEnv']) for (const key of ['CONVEX_DEPLOY_KEY', 'BLOB_READ_WRITE_TOKEN'])
    for (const state of ['absent', 'nonempty', 'nonstring']) {
      const records = effectiveFixture(); records[map][sentinel] = sentinel;
      if (state === 'absent') delete records[map][key];
      else records[map][key] = state === 'nonempty' ? sentinel : null;
      let failure;
      try { validateEffectiveEnvironment(records, fixture()); } catch (error) { failure = error; }
      const diagnostic = safePublisherDiagnostic(failure);
      assert.equal(diagnostic.category, 'credential_override_mismatch');
      const alias = key === 'CONVEX_DEPLOY_KEY' ? 'deployCredential' : 'blobCredential';
      assert.equal(diagnostic.environment[map === 'env' ? 'runtime' : 'build'].fields[alias],
        state === 'absent' ? 'missing' : state === 'nonempty' ? 'string' : 'non_string');
      assert(!JSON.stringify(diagnostic).includes(sentinel));
    }
});

for (const [scenario, category, options] of [
  ['transport', 'transport', { environmentTransportFailure: sentinel }],
  ['status', 'http_status', { environmentStatus: 403, sentinel }],
  ['invalid JSON', 'invalid_json', { environmentRaw: 'not-json:' + sentinel }],
  ['missing map', 'missing_or_malformed_maps', { environmentTransform: x => ({ env: x.env, [sentinel]: sentinel }) }],
  ['public mismatch', 'public_value_mismatch', { environmentTransform: x => {
    x.buildEnv.NEXT_PUBLIC_ATTENDANCE_BACKEND = sentinel; return x;
  } }],
  ['absent credential', 'credential_override_mismatch', { environmentTransform: x => {
    delete x.env.CONVEX_DEPLOY_KEY; return x;
  } }],
  ['inherited credential', 'credential_override_mismatch', { environmentTransform: x => {
    x.env.CONVEX_DEPLOY_KEY = sentinel; return x;
  } }],
  ['redacted gateway', 'gateway_mismatch', { redactedGateway: true }],
  ['build gateway mismatch', 'gateway_mismatch', { environmentTransform: x => {
    x.buildEnv.ATTENDANCE_GATEWAY_KEY = sentinel; return x;
  } }],
]) test(`orchestration records safe ${scenario} diagnostics, preserves accounting and deletes its exact fixture`, async () => {
  const result = await publicationScenario(options), report = result.report;
  assert.equal(report.passed, false); assert.equal(report.failedPhase, 'effective environment');
  assert.equal(report.failure.category, category);
  assert.equal(report.failure.httpStatus, scenario === 'transport' ? undefined : scenario === 'status' ? 403 : 200);
  assert.deepEqual(report.counters, { controlRequests: 14, hostingRequests: 0, applicationCalls: 1 });
  assert.equal(report.creationRequests, 1); assert.equal(report.cleanup.deploymentDeleted, true);
  assert.equal(result.deleted, true);
  assert.equal(result.calls.filter(x => x.path === '/v3/env/pull/dpl_fixture').length, 1);
  assert.equal(result.calls.filter(x => x.method === 'DELETE').length, 1);
  assert(result.calls.filter(x => x.method === 'DELETE').every(x => x.path === '/v13/deployments/dpl_fixture'));
  assert(!JSON.stringify({ report, writes: [...result.writes], logs: result.logs }).includes(sentinel));
});

test('continuation publication preserves original records and durably carries prior costs before its single creation',async()=>{
  const result=await publicationScenario({continuation:true});
  assert.equal(result.report.passed,true);
  assert.deepEqual(result.report.continuation,CONTINUATION);
  assert.deepEqual(result.report.cumulative,continuationTotals(result.report.counters,1));
  const manifest=result.writes.get(CONTINUATION_PATHS.manifest);
  assert.equal(manifest.publication,'ready');assert.deepEqual(manifest.continuation,CONTINUATION);
  assert.deepEqual(manifest.cumulative,result.report.cumulative);
  assert.equal(result.report.cumulative.calls,63);assert.equal(result.report.cumulative.nextCalls,2);
  assert.equal(result.report.cumulative.controls,17+result.report.counters.controlRequests);
  assert.equal(result.report.cumulative.creations,2);
  assert(result.writes.has(CONTINUATION_PATHS.publication));
  assert.equal(JSON.stringify([...result.writes].filter(([path])=>Object.values(ORIGINAL_PATHS).includes(path))),result.historical);
  const sent=result.calls.length,oldManifest=structuredClone(manifest);
  const repeated=await result.run();
  assert.equal(repeated.passed,false);assert.equal(result.calls.length,sent);
  assert.deepEqual(result.writes.get(CONTINUATION_PATHS.manifest),oldManifest);
  assert.equal(result.calls.filter(x=>x.path==='/v13/deployments'&&x.method==='POST').length,1);
});

for(const options of [{corruptHistory:true},{mutateHistory:x=>{x.cleanup.deploymentDeleted=false;}},
  {mutateHistory:x=>{x.counters.controlRequests=0;}},{originalRuntimeExists:true}])
  test('continuation rejects changed/uncertain history before any provider operation',async()=>{
    const result=await publicationScenario({continuation:true,...options});
    assert.equal(result.report.passed,false);assert.equal(result.report.failedPhase,'continuation history');
    assert.equal(result.calls.length,0);assert(!result.writes.has(CONTINUATION_PATHS.manifest));
    assert.equal(JSON.stringify([...result.writes]),result.historical);
  });

test('continuation environment rejection retains both creations and all prior costs while cleaning its new fixture',async()=>{
  const result=await publicationScenario({continuation:true,redactedGateway:true});
  assert.equal(result.report.passed,false);assert.equal(result.report.failure.category,'gateway_mismatch');
  assert.deepEqual(result.report.cumulative,{calls:63,nextCalls:2,controls:31,hosting:0,writes:355,gateway:7,creations:2});
  assert.equal(result.report.cleanup.deploymentDeleted,true);
  assert.equal(JSON.stringify([...result.writes].filter(([path])=>Object.values(ORIGINAL_PATHS).includes(path))),result.historical);
});
