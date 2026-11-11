import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateStoppedPrebuiltPredecessor, validatePrebuiltDeployment } from '../scripts/publish-prebuilt-next.mjs';
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
test('ownership and final output digest must match before readiness or deletion',()=>{
  const m={runId:'synthetic-run',sourceCommit:'a'.repeat(40),vercel:{deploymentId:'dpl_synthetic',url:'https://synthetic.vercel.app',sourcePrebuilt:{outputSha256:'b'.repeat(64)}}};
  const d={id:'dpl_synthetic',ownerId:EXPECTED.teamId,projectId:EXPECTED.projectId,target:null,url:'synthetic.vercel.app',readyState:'READY',meta:{attendanceValidation:m.runId,attendanceSourceCommit:m.sourceCommit,attendanceOutputSha256:m.vercel.sourcePrebuilt.outputSha256}};
  assert.doesNotThrow(()=>validatePrebuiltDeployment(d,m));
  for(const [field,value] of [['ownerId','other'],['projectId','other'],['target','production'],['url','other.vercel.app']])
    assert.throws(()=>validatePrebuiltDeployment({...d,[field]:value},m));
  assert.throws(()=>validatePrebuiltDeployment({...d,meta:{...d.meta,attendanceOutputSha256:'c'.repeat(64)}},m));
});
