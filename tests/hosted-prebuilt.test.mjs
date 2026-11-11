import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { archivePrebuiltOutput } from '../scripts/build-hosted-prebuilt.mjs';

const hash = b => createHash('sha256').update(b).digest('hex');
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'prebuilt-test-')); t.after(() => rmSync(dir,{recursive:true,force:true}));
  const output = join(dir,'.vercel/output'); mkdirSync(output,{recursive:true});
  const config = Buffer.from('{"version":3}'); writeFileSync(join(output,'config.json'),config);
  const files = [{path:'config.json',size:config.length,sha256:hash(config),executable:false}];
  return {dir,output,receipt:{dir,commit:'a'.repeat(40),target:'production',files,outputSha256:hash(JSON.stringify(files))}};
}
test('archive is bound to audited output and production target', t => {
  const {receipt}=fixture(t); const out=archivePrebuiltOutput(receipt);
  assert.equal(out.files[0].file,'.vercel/source.tgz.part1'); assert.equal(out.outputSha256,receipt.outputSha256);
  assert.equal(out.sourceCommit,receipt.commit); assert.equal(out.target,'production');
});
test('archive rejects changed files, function environment and outside links', t => {
  const {receipt,output}=fixture(t); writeFileSync(join(output,'config.json'),'changed');
  assert.throws(()=>archivePrebuiltOutput(receipt),/output_changed/);
  writeFileSync(join(output,'secret.vc-config.json'),'{"environment":{"SECRET":"value"}}');
  assert.throws(()=>archivePrebuiltOutput(receipt),/function_environment/);
  rmSync(join(output,'secret.vc-config.json')); symlinkSync('/etc/passwd',join(output,'outside'));
  assert.throws(()=>archivePrebuiltOutput(receipt),/link_outside/);
});
