import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateStoppedPrebuiltPredecessor, validatePrebuiltDeployment, persistPrebuiltSuccess, cleanupPrebuiltOwned, readPrebuiltReceipt } from '../scripts/publish-prebuilt-next.mjs';
import { EXPECTED } from '../scripts/prepare-hosted-next.mjs';

test('preserves the real spent read-only predecessor and rejects hidden expenditure',()=>{
  const raw=readFileSync(new URL('../docs/measurements/hosted-next-third-preview-setup.json',import.meta.url),'utf8');
  assert.match(validateStoppedPrebuiltPredecessor(raw),/^[a-f0-9]{64}$/);
  const original=JSON.parse(raw);
  for(const field of ['creationRequests','applicationCalls','hostingRequests']) {
    const p=structuredClone(original);
    if(field==='creationRequests') p[field]=1; else p.counters[field]=1;
    assert.throws(()=>validateStoppedPrebuiltPredecessor(JSON.stringify(p)));
  }
});
test('last manifest or evidence failure cannot leave a successful return state',()=>{
  for(const failAt of ['manifest','evidence']){
    const report={passed:false};const calls=[];
    assert.throws(()=>persistPrebuiltSuccess(report,{save(){calls.push('manifest');if(failAt==='manifest')throw Error('disk');},persistEvidence(){calls.push('evidence');throw Error('disk');}}));
    assert.equal(report.passed,false);assert.equal(report.persistenceFailed,true);
    assert.deepEqual(calls,failAt==='manifest'?['manifest']:['manifest','evidence']);
  }
});
test('failed capability revocation still deletes the verified owned deployment and confirms 404',async()=>{
  const m={runId:'synthetic-run',sourceCommit:'a'.repeat(40),access:{token:'synthetic-capability'},vercel:{deploymentId:'dpl_synthetic',url:'https://synthetic.vercel.app',sourcePrebuilt:{outputSha256:'b'.repeat(64)}}};
  const calls=[];
  const r=await cleanupPrebuiltOwned(m,async(path,opts={})=>{
    calls.push(opts.method??'GET');
    if(calls.length===1)return {body:{id:'dpl_synthetic',ownerId:EXPECTED.teamId,projectId:EXPECTED.projectId,target:null,url:'synthetic.vercel.app',meta:{attendanceValidation:m.runId,attendanceSourceCommit:m.sourceCommit,attendanceOutputSha256:m.vercel.sourcePrebuilt.outputSha256}}};
    if(opts.method==='PATCH')throw Error('provider unavailable');
    return {status:opts.method==='DELETE'?204:404};
  });
  assert.deepEqual(calls,['GET','PATCH','DELETE','GET']);
  assert.equal(r.capabilityRevoked,false);assert.equal(r.capabilityRevocationUncertain,true);assert.equal(r.deploymentDeleted,true);assert.equal(r.capabilityInvalidatedByDeletion,true);
});
test('large private prebuilt inventories are accepted within the explicit 4 MiB receipt bound',()=>{
  const dir=mkdtempSync(join(tmpdir(),'prebuilt-receipt-test-'));const p=join(dir,'receipt.json');
  try{writeFileSync(p,JSON.stringify({inventory:'x'.repeat(2*1024*1024)}),{mode:0o600});assert.equal(readPrebuiltReceipt(p).inventory.length,2*1024*1024);
    writeFileSync(p,'x'.repeat(4*1024*1024+1));assert.throws(()=>readPrebuiltReceipt(p));}
  finally{rmSync(dir,{recursive:true,force:true});}
});
test('ownership and final output digest must match before readiness or deletion',()=>{
  const m={runId:'synthetic-run',sourceCommit:'a'.repeat(40),vercel:{deploymentId:'dpl_synthetic',url:'https://synthetic.vercel.app',sourcePrebuilt:{outputSha256:'b'.repeat(64)}}};
  const d={id:'dpl_synthetic',ownerId:EXPECTED.teamId,projectId:EXPECTED.projectId,target:null,url:'synthetic.vercel.app',readyState:'READY',meta:{attendanceValidation:m.runId,attendanceSourceCommit:m.sourceCommit,attendanceOutputSha256:m.vercel.sourcePrebuilt.outputSha256}};
  assert.doesNotThrow(()=>validatePrebuiltDeployment(d,m));
  for(const [field,value] of [['ownerId','other'],['projectId','other'],['target','production'],['url','other.vercel.app']])
    assert.throws(()=>validatePrebuiltDeployment({...d,[field]:value},m));
  assert.throws(()=>validatePrebuiltDeployment({...d,meta:{...d.meta,attendanceOutputSha256:'c'.repeat(64)}},m));
});
