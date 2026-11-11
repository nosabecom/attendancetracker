import test from 'node:test';import assert from 'node:assert/strict';
import{newAutomationSecret,automationGenerateBody,automationRevokeBody,verifyAutomationGenerated,verifyAutomationRevoked,AUTOMATION_PATH}from'../scripts/vercel-automation-access.mjs';
test('first-party project automation protocol binds the chosen private secret and preserves unrelated entries',()=>{
  const secret=newAutomationSecret(),before={unrelated:{scope:'other',createdAt:1}};
  assert.match(secret,/^[a-f0-9]{32}$/);assert.match(AUTOMATION_PATH,/^\/v1\/projects\/prj_\w+\/protection-bypass$/);
  assert.deepEqual(automationGenerateBody(secret),{generate:{secret}});assert.deepEqual(automationRevokeBody(secret),{revoke:{secret,regenerate:false}});
  assert.equal(verifyAutomationGenerated({protectionBypass:{...before,[secret]:{scope:'automation-bypass'}}},secret,before),true);
  assert.equal(verifyAutomationRevoked({protectionBypass:before},secret,before),true);
  for(const response of [secret,{}, {protectionBypass:{[secret]:{scope:'shareable-link'}}},{protectionBypass:{[secret]:{scope:'automation-bypass'}}}])assert.throws(()=>verifyAutomationGenerated(response,secret,before));
  assert.throws(()=>verifyAutomationRevoked({protectionBypass:{...before,[secret]:{scope:'automation-bypass'}}},secret,before));
});
