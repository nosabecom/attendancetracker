import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { CONTINUATION, ORIGINAL_PATHS, CONTINUATION_PATHS } from '../scripts/hosted-next-continuation.mjs';
import { THIRD, THIRD_PATHS, GITHUB_SOURCE, validateThirdHistory, validateThirdSnapshot, thirdTotals,
  validateExplicitGitSource, validateCompatibilityDeployment, validateCompatibilityMaps,
  validateThirdPreflight, validateVercelCreditReview } from '../scripts/hosted-next-third.mjs';
import { historyText, secondHistoryText, originalPublication, secondPublication, vercelCreditFixture } from './fixtures/hosted-next-history.mjs';
const backend = { name: 'synthetic-preview', id: 1, projectId: 2, reference: 'preview/synthetic',
  cloudUrl: 'https://synthetic.convex.cloud', siteUrl: 'https://synthetic.convex.site', fingerprint: 'synthetic' };
test('third history pins BOTH spent failed artifacts, matching private records and confirmed deletion', () => {
  assert.equal(validateThirdHistory(historyText, originalPublication(backend), secondHistoryText, secondPublication(backend), backend), THIRD);
  assert.throws(() => validateThirdHistory(historyText + '\n', originalPublication(backend), secondHistoryText, secondPublication(backend), backend));
  assert.throws(() => validateThirdHistory(historyText, originalPublication(backend), secondHistoryText + '\n', secondPublication(backend), backend));
  for (const mutate of [x => { x.sourceCommit = 'a'.repeat(40); }, x => { x.runId += 'other'; },
    x => { x.publication = 'ready'; }, x => { x.vercel.target = 'production'; }, x => { x.vercel.teamId = 'other'; },
    x => { x.vercel.projectId = 'other'; }, x => { x.vercel.deploymentId = CONTINUATION.predecessorDeploymentId; },
    x => { x.vercel.url = 'https://outside.example'; }, x => { x.counters.controlRequests = 0; },
    x => { x.cumulative.controls = 17; }, x => { x.cleanup.deploymentDeleted = false; },
    x => { x.cleanup.capabilityRevoked = false; }, x => { x.backend.id = 9; },
    x => { x.continuation.spent.calls = 0; }, x => { x.access = { token: 'synthetic' }; }]) {
    const second = secondPublication(backend); mutate(second);
    assert.throws(() => validateThirdHistory(historyText, originalPublication(backend), secondHistoryText, second, backend));
  }
});
test('third snapshot has distinct exclusive paths and does not alter the earlier two-attempt policy', () => {
  assert.equal(validateThirdSnapshot(structuredClone(THIRD)), THIRD);
  const changed = structuredClone(THIRD); changed.spent.creations = 1;
  assert.throws(() => validateThirdSnapshot(changed)); assert.throws(() => { THIRD.spent.calls = 0; }, TypeError);
  assert.equal(CONTINUATION.limits.creations, 2);
  assert.equal(new Set([...Object.values(ORIGINAL_PATHS), ...Object.values(CONTINUATION_PATHS), ...Object.values(THIRD_PATHS)]).size, 12);
});
test('third totals retain63 calls and33 controls and add only the two preflight and one publisher', () => {
  assert.deepEqual(thirdTotals({controlRequests:20,hostingRequests:2,applicationCalls:1},1,2),
    {calls:64,nextCalls:3,controls:55,hosting:2,writes:355,gateway:7,creations:3});
  for (const args of [[{controlRequests:21,hostingRequests:0,applicationCalls:0},0,0],
    [{controlRequests:0,hostingRequests:3,applicationCalls:0},0,0],
    [{controlRequests:0,hostingRequests:0,applicationCalls:2},0,0],
    [{controlRequests:0,hostingRequests:0,applicationCalls:0},2,0],
    [{controlRequests:0,hostingRequests:0,applicationCalls:0},0,3]]) assert.throws(() => thirdTotals(...args));
});
test('explicit source proof requires canonical repository identity and returned SHA before it is trusted', () => {
  const sha='a'.repeat(40), owner={teamId:'owned-team',projectId:'owned-project'};
  const fixture=()=>({id:'dpl_fixture',ownerId:owner.teamId,projectId:owner.projectId,readyState:'READY',
    gitSource:{type:'github',repoId:GITHUB_SOURCE.repoId,sha},meta:{githubCommitSha:sha}});
  validateExplicitGitSource(fixture(),sha);validateCompatibilityDeployment(fixture(),'dpl_fixture',owner);
  for(const mutate of [x=>{delete x.gitSource;},x=>{x.gitSource.repoId=1;},x=>{x.gitSource.type='gitlab';},
    x=>{x.gitSource.repoId=[GITHUB_SOURCE.repoId];},x=>{x.gitSource.org='other';},x=>{x.gitSource.repo='other';},
    x=>{delete x.gitSource.sha;},x=>{x.gitSource.sha='b'.repeat(40);},x=>{x.meta.githubCommitSha='b'.repeat(40);},
    x=>{x.ownerId='other';},x=>{x.projectId='other';},x=>{x.id='dpl_other';}]){
    const d=fixture();mutate(d);assert.throws(()=>validateCompatibilityDeployment(d,'dpl_fixture',owner));
  }
});
test('compatibility maps require both plain string maps without treating them as effective environment proof', () => {
  assert.equal(validateCompatibilityMaps({env:{synthetic:'value'},buildEnv:{}}),true);
  for(const value of [{},{env:{},buildEnv:null},{env:[],buildEnv:{}},{env:{},buildEnv:{key:9}},
    {env:{},buildEnv:{},protectedSecrets:true}])assert.throws(()=>validateCompatibilityMaps(value));
});
test('preflight proof requires two completed owned-source/environment observations', () => {
  const value={status:'passed',controlRequests:2,deploymentId:'dpl_fixture',ownershipVerified:true,sourceVerified:true,environmentShapeCompatible:true};
  validateThirdPreflight(value);
  for(const patch of [{status:'pending'},{controlRequests:1},{ownershipVerified:false},{sourceVerified:false},{environmentShapeCompatible:false}])assert.throws(()=>validateThirdPreflight({...value,...patch}));
});
test('fresh exact-team Pro credit review cannot authorize overage or replace the missing receipt', () => {
  const now=Date.now(),good=vercelCreditFixture(now);
  assert.equal(validateVercelCreditReview(good,now).billingCap,false);
  for(const patch of [{plan:'hobby'},{plan:'enterprise'},{teamId:'other'},{teamSlug:'other'},
    {observedAt:new Date(now-3600001).toISOString()},{observedAt:new Date(now+300001).toISOString()},
    {periodEnd:new Date(now).toISOString()},{usedCreditUsd:20},{usedCreditUsd:21},{usedCreditUsd:-1},
    {creditReservationUsd:0.01},{allTeamUsage:false},{reportingLagAcknowledged:false},{noOverageAuthorized:false}])assert.throws(()=>validateVercelCreditReview({...good,...patch},now));
});
test('credit review retains prior reservations before allocating another hosted attempt', () => {
  const now=Date.now(),good=vercelCreditFixture(now);
  for(const patch of [{otherReservationsUsd:undefined},{otherReservationsUsd:0},{otherReservationsUsd:-1},
    {otherReservationsUsd:NaN},{otherReservationsUsd:Infinity},{otherReservationsUsd:19.5},
    {usedCreditUsd:18.5},{usedCreditUsd:19}])
    assert.throws(()=>validateVercelCreditReview({...good,...patch},now));
  const proof=validateVercelCreditReview({...good,otherReservationsUsd:2},now);
  assert.equal(proof.cumulativeEngineeringReservationsUsd,3);
  assert.equal(proof.otherReservationsUsd,2);
});
