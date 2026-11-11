import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { TARGET, FINGERPRINT, validateEvidence, validateCanonical, validateEmptyTables, validateEnvironment, validateLimits, generateConfiguration, prepareOwnedDevelopment, claimAllocation } from '../scripts/prepare-owned-development.mjs';

const code = { commit: 'a'.repeat(40) };
const now = Date.parse('2026-11-10T12:00:00Z');
const evidence = () => ({ target: { ...TARGET }, source: 'convex-dashboard-agent-observation', neverDeployed: true, observedAt: new Date(now).toISOString(), evidenceDigest: 'b'.repeat(64), capabilitySha256: 'c'.repeat(64), reviewedSourceCommit: code.commit });
test('owner evidence binds exact development target, project and reviewed source', () => {
  validateEvidence(evidence(), code, now);
  for (const target of [{ ...TARGET, name: 'tremendous-elk-298' }, { ...TARGET, deploymentType: 'prod' }, { ...TARGET, projectId: 1 }])
    assert.throws(() => validateEvidence({ ...evidence(), target }, code, now));
  assert.throws(() => validateEvidence({ ...evidence(), reviewedSourceCommit: 'b'.repeat(40) }, code, now));
  assert.throws(() => validateEvidence({ ...evidence(), observedAt: '2020-01-01' }, code, now));
});
test('canonical URLs and complete empty table page are mandatory', () => {
  validateCanonical({ convexCloudUrl: TARGET.cloudUrl, convexSiteUrl: TARGET.siteUrl });
  assert.throws(() => validateCanonical({ convexCloudUrl: 'https://tremendous-elk-298.convex.cloud', convexSiteUrl: TARGET.siteUrl }));
  validateEmptyTables({ page: [], isDone: true, continueCursor: '' });
  for (const page of [{ page: [{ name: 'users' }], isDone: true, continueCursor: '' }, { page: [], isDone: false, continueCursor: '' }, [], { page: [], isDone: true }]) assert.throws(() => validateEmptyTables(page));
  assert.equal(FINGERPRINT, 'a3ceb7886db76f635b60fcb05541abfc3d7f425cb0322d2211afd2299eb037ba');
});
test('configuration is independent and limit is exact', () => {
  const a = generateConfiguration(), b = generateConfiguration();
  assert.notEqual(a.ATTENDANCE_GATEWAY_KEY, b.ATTENDANCE_GATEWAY_KEY);
  assert.notEqual(a.JWT_PRIVATE_KEY, b.JWT_PRIVATE_KEY);
  assert.match(a.ATTENDANCE_GATEWAY_AUDIENCE, /^attendance-development-/);
  assert.equal(JSON.parse(a.JWKS).keys[0].kty, 'RSA');
  assert.throws(() => validateEnvironment([{ name: 'X', value: 'a' }, { name: 'X', value: 'b' }]));
  assert.equal(validateLimits({ usageLimits: [] }), false);
  assert.equal(validateLimits({ usageLimits: [{ metric: 'functionCalls', window: 'day', limitType: 'disable', limit: 1000, enabled: true }] }, true), true);
  assert.throws(() => validateLimits({ usageLimits: [{ metric: 'functionCalls', window: 'day', limitType: 'disable', limit: 1001, enabled: true }] }));
});
test('offline mode performs no network or publication', async () => {
  const result = await prepareOwnedDevelopment({}, { transport: () => { throw Error('network'); }, publish: () => { throw Error('publication'); } });
  assert.equal(result.dryRun, true); assert.equal(result.target.name, TARGET.name);
});

test('allocation marker is exclusive and preserves its first owner', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'owned-dev-test-'));
  try {
    const marker = join(dir, 'allocation.json');
    const results = await Promise.allSettled([claimAllocation(marker, { ledger: 'first' }), claimAllocation(marker, { ledger: 'second' })]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const owner = JSON.parse(await readFile(marker, 'utf8')).ledger;
    await assert.rejects(claimAllocation(marker, { ledger: 'replacement' }));
    assert.equal(JSON.parse(await readFile(marker, 'utf8')).ledger, owner);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('nonempty server tables stop before mutation and allocation cannot be reused', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'owned-dev-guard-'));
  try {
    const ledger = join(dir, 'ledger'); await mkdir(ledger, { mode: 0o700 });
    const key = 'opaque-development-capability', source = await prepareOwnedDevelopment({});
    const evidencePath = join(dir, 'evidence.json'), keyFile = join(dir, 'key');
    await writeFile(keyFile, key, { mode: 0o600 });
    await writeFile(evidencePath, JSON.stringify({ ...evidence(), reviewedSourceCommit: source.reviewedSourceCommit, capabilitySha256: createHash('sha256').update(key).digest('hex') }), { mode: 0o600 });
    const requests = [];
    const transport = async (url, init) => {
      requests.push([url, init.method]);
      const value = url.endsWith('/api/v1/get_canonical_urls') ? { convexCloudUrl: TARGET.cloudUrl, convexSiteUrl: TARGET.siteUrl } :
        { status: 'success', value: { page: [{ name: 'users' }], isDone: true, continueCursor: '' }, logLines: [] };
      return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
    };
    const options = { evidencePath, keyFile, ledger, apply: true };
    const allocationMarker=join(dir,'allocation-marker.json');
    await assert.rejects(prepareOwnedDevelopment(options, { allocationMarker, now: () => now, transport, publish: () => { throw Error('unexpected publication'); } }));
    assert.equal(requests.length, 2);
    assert.ok(requests[0][0].endsWith('/api/v1/get_canonical_urls'));
    assert.ok(requests[1][0].endsWith('/api/query'));
    await assert.rejects(prepareOwnedDevelopment(options, { allocationMarker, now: () => now, transport }));
    assert.equal(requests.length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('complete empty import covers nineteen verification pages and leaves both gates closed',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'owned-dev-complete-'));
  try{
    const ledger=join(dir,'ledger');await mkdir(ledger,{mode:0o700});
    const source=await prepareOwnedDevelopment({}),key='opaque-development-capability',evidencePath=join(dir,'evidence.json'),keyFile=join(dir,'key');
    await writeFile(keyFile,key,{mode:0o600});
    await writeFile(evidencePath,JSON.stringify({...evidence(),reviewedSourceCommit:source.reviewedSourceCommit,capabilitySha256:createHash('sha256').update(key).digest('hex')}),{mode:0o600});
    let environment=[],limits=[],verifications=0,published=0,active=false,closed=false;
    const transport=async(url,init)=>{
      let value;
      if(url.endsWith('/get_canonical_urls'))value={convexCloudUrl:TARGET.cloudUrl,convexSiteUrl:TARGET.siteUrl};
      else if(url.endsWith('/list_usage_limits'))value={usageLimits:limits};
      else if(url.endsWith('/create_usage_limit')){limits=[JSON.parse(init.body)];value={};}
      else if(url.endsWith('/api/update_environment_variables')){environment=JSON.parse(init.body).changes;value={};}
      else{
        const body=JSON.parse(init.body);let result;
        if(body.path==='_system/cli/tables')result={page:[],isDone:true,continueCursor:''};
        else if(body.path==='_system/cli/queryEnvironmentVariables')result=environment;
        else if(body.path==='migration:initialize')result={};
        else if(body.path==='migration:begin')result={runId:'synthetic-run',phase:'import'};
        else if(body.path==='migration:status')result={runId:'synthetic-run',phase:verifications===19?'verified':'import'};
        else if(body.path==='migration:freeze')result={phase:'verify'};
        else if(body.path==='migration:verifyNext')result={phase:++verifications===19?'verified':'verify'};
        else if(body.path==='migration:activate'){active=true;result={phase:'active'};}
        else if(body.path==='operations:setAvailability'){closed=true;result={readsEnabled:false,writesEnabled:false};}
        else if(body.path==='operations:availability')result={readsEnabled:!closed,writesEnabled:!closed};
        else assert.fail('Unexpected operation');
        value={status:'success',value:result,logLines:[]};
      }
      return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
    };
    const result=await prepareOwnedDevelopment({evidencePath,keyFile,ledger,apply:true},{allocationMarker:join(dir,'allocation-marker.json'),now:()=>now,transport,publish:()=>{published++;return{status:0,signal:null,uncertain:false};}});
    assert.equal(published,1);assert.equal(verifications,19);assert.equal(active,true);assert.equal(closed,true);
    assert.equal(result.applicationCalls,27);assert.equal(result.logicalWrites,26);assert.ok(result.controls<=20);
    const manifest=JSON.parse(await readFile(result.manifest,'utf8'));
    assert.equal(manifest.managementIdentity.id,6789777);assert.equal(manifest.ownedEmptyDevelopment,true);assert.equal(manifest.availabilityClosed,true);
    assert.equal(manifest.setupUsage.applicationCalls,27);
  }finally{await rm(dir,{recursive:true,force:true});}
});
