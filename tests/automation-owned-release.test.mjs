import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AUTOMATION_PATHS, validateOwnedFailed, validateFailedAutomationPublication, validateAutomationProbe, automationTotals, validateOwnedCompatibility } from '../scripts/hosted-next-third.mjs';
import { parseArgs, createBudget } from '../scripts/test-hosted-next.mjs';
import { cleanupPrebuiltOwned } from '../scripts/publish-prebuilt-next.mjs';
import { AUTOMATION_PATH } from '../scripts/vercel-automation-access.mjs';

const probe={version:1,passed:true,cancelled:false,projectId:'prj_uOMK1a4PLAgsDr1A16InuImM1M3q',teamId:'team_fmwIPLne9w30y7G5JQrs3fzl',protocol:'project-automation-v1',controls:7,hosting:2,baselineProtected:true,headerAccepted:true,revocationConfirmed:true,preservedUnrelated:true,noResourceCreation:true};
const source='a'.repeat(40), backend='b'.repeat(40);
test('automation history and budget retain prior costs exactly once',()=>{
  validateOwnedFailed(readFileSync('docs/measurements/hosted-owned-development-setup.json','utf8'));
  assert.throws(()=>validateOwnedFailed('{}'));
  assert.throws(()=>validateAutomationProbe({...probe,revocationConfirmed:false}));
  assert.deepEqual(automationTotals({controlRequests:20,applicationCalls:1,hostingRequests:2},probe),{calls:117,nextCalls:29,controls:148,hosting:25,writes:475,gateway:13,creations:7});
  const b=createBudget({controlRequests:20,applicationCalls:1,hostingRequests:2},{prebuilt:true,ownedDevelopment:true,automation:true,probe});
  assert.equal(b.snapshot().control,148); assert.equal(b.snapshot().writes,475);
  assert.notEqual(AUTOMATION_PATHS.publication,'docs/measurements/hosted-owned-development-setup.json');
});
test('stopped header probe establishes only generation and revocation, with its costs retained',()=>{
  const actual=JSON.parse(readFileSync('docs/measurements/vercel-automation-access-probe-32.json','utf8'));
  assert.equal(validateAutomationProbe(actual).headerAccepted,false);
  assert.deepEqual(automationTotals({controlRequests:0,applicationCalls:0,hostingRequests:0},actual,0),{calls:116,nextCalls:28,controls:126,hosting:23,writes:475,gateway:13,creations:6});
  assert.throws(()=>validateAutomationProbe({...actual,failedPhase:'generate'}));
  assert.throws(()=>validateAutomationProbe({...actual,cleanupUncertain:true,revocationConfirmed:false}));
});
test('explicit selector and compatibility permit a different published backend only with full clean byte checks',()=>{
  const args=['--expected-vercel-deployment','dpl_123','--expected-preview','amicable-koala-816','--automation-owned-release',source];
  assert.equal(parseArgs(args).automationOwnedRelease,true); assert.throws(()=>parseArgs([...args.slice(0,3),'wrong-target',...args.slice(4)]));
  const calls=[]; const git=a=>{calls.push(a);return a[0]==='rev-parse'?source:'';};
  assert.equal(validateOwnedCompatibility(source,backend,git).backendCommit,backend);
  assert.ok(calls.some(a=>a[0]==='diff'&&a.includes(backend)&&a.includes(source)&&a.includes('app')&&a.includes('pnpm-lock.yaml')));
  assert.throws(()=>validateOwnedCompatibility(source,backend,a=>a[0]==='rev-parse'?source:a[0]==='ls-files'?'app/new.ts':''));
});
test('uncertain project secret revocation does not prevent exact owned deployment deletion',async()=>{
  const token='a'.repeat(32), calls=[];
  const m={runId:'run',sourceCommit:source,vercel:{deploymentId:'dpl_123',url:'https://test.vercel.app',sourcePrebuilt:{outputSha256:'f'.repeat(64)}},access:{kind:'project-automation',token,baseline:{}}};
  const request=async(path,opts={})=>{calls.push([path,opts.method]);if(path===AUTOMATION_PATH)throw Error('uncertain');if(opts.method==='DELETE')return {status:204};if(opts.allowedStatuses?.includes(404))return {status:404};return {body:{id:'dpl_123',ownerId:'team_fmwIPLne9w30y7G5JQrs3fzl',projectId:'prj_uOMK1a4PLAgsDr1A16InuImM1M3q',target:'preview',url:'test.vercel.app',meta:{attendanceValidation:'run',attendanceSourceCommit:source,attendanceOutputSha256:'f'.repeat(64)}}};};
  const result=await cleanupPrebuiltOwned(m,request); assert.equal(result.capabilityRevoked,false);assert.equal(result.capabilityRevocationUncertain,true);assert.equal(result.providerExpires,false);assert.equal(result.capabilityInvalidatedByDeletion,false);assert.equal(result.deploymentDeleted,true);assert.ok(calls.some(([p,m])=>p==='/v13/deployments/dpl_123'&&m==='DELETE'));
});

test('failed runtime artifact is immutable and never grants a successful release',()=>{const text=readFileSync('docs/measurements/hosted-automation-next-setup.json','utf8');assert.equal(validateFailedAutomationPublication(text).passed,false);assert.throws(()=>validateFailedAutomationPublication(text+' '));});

test('new runtime seed retains every spent gateway allowance',()=>{const b=createBudget({controlRequests:1,applicationCalls:1,hostingRequests:1},{prebuilt:true,ownedDevelopment:true,automation:true,probe});assert.equal(b.snapshot().gateway,13);assert.equal(b.snapshot().nextCalls,29);assert.equal(b.snapshot().writes,475);});
