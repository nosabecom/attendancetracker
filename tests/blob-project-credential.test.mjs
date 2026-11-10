import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyBlobProjectCredential, runBlobProjectCredentialCli } from '../scripts/verify-blob-project-credential.mjs';

const oldToken = `vercel_blob_rw_raW6bHbRonffwrRf_${'A'.repeat(32)}`;
const newToken = `vercel_blob_rw_raW6bHbRonffwrRf_${'B'.repeat(32)}`;
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'credential-check-'));
  await chmod(dir, 0o700);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const baselinePath = join(dir, 'old'), currentPath = join(dir, 'new'), outputPath = join(dir, 'result');
  await writeFile(baselinePath, `BLOB_READ_WRITE_TOKEN=${oldToken}\n`, { mode: 0o600 });
  await writeFile(currentPath, `BLOB_READ_WRITE_TOKEN=${newToken}\n`, { mode: 0o600 });
  return { dir, baselinePath, currentPath, outputPath };
}
async function persisted(path) { return JSON.parse(await readFile(path, 'utf8')); }

test('accepts only selected baseline and persists exactly the returned safe record', async t => {
  const f = await fixture(t);
  const result = await verifyBlobProjectCredential({ ...f, env: { BLOB_READ_WRITE_TOKEN: oldToken, OTHER: 'sentinel-secret' } });
  assert.equal(result.status, 'accepted');
  assert.deepEqual(await persisted(f.outputPath), result);
  assert.doesNotMatch(JSON.stringify(result), /sentinel-secret|vercel_blob_rw/);
  await assert.rejects(verifyBlobProjectCredential({ ...f, env: { BLOB_READ_WRITE_TOKEN: oldToken } }), { code: 'output_exists' });
});

test('rejects selected current, missing or wrong-store value, and identical baseline/current', async t => {
  for (const selected of [newToken, undefined, `vercel_blob_rw_${'x'.repeat(16)}_${'A'.repeat(32)}`]) {
    const f = await fixture(t);
    const result = await verifyBlobProjectCredential({ ...f, env: { BLOB_READ_WRITE_TOKEN: selected } });
    assert.equal(result.status, 'failed');
    assert.deepEqual(await persisted(f.outputPath), result);
  }
  const f = await fixture(t);
  await writeFile(f.currentPath, `BLOB_READ_WRITE_TOKEN=${oldToken}\n`);
  assert.equal((await verifyBlobProjectCredential({ ...f, env: { BLOB_READ_WRITE_TOKEN: oldToken } })).status, 'failed');
});

test('rejects repeated paths, unsafe credentials, symlinks and unsafe destination', async t => {
  const f = await fixture(t);
  await assert.rejects(verifyBlobProjectCredential({ ...f, currentPath: f.baselinePath }), { code: 'invalid_options' });
  await chmod(f.baselinePath, 0o644);
  assert.equal((await verifyBlobProjectCredential({ ...f, env: { BLOB_READ_WRITE_TOKEN: oldToken } })).status, 'failed');
  const g = await fixture(t);
  const link = join(g.dir, 'link'); await symlink(g.baselinePath, link);
  assert.equal((await verifyBlobProjectCredential({ ...g, baselinePath: link, env: { BLOB_READ_WRITE_TOKEN: oldToken } })).status, 'failed');
  const h = await fixture(t); await chmod(h.dir, 0o755);
  await assert.rejects(verifyBlobProjectCredential({ ...h, env: { BLOB_READ_WRITE_TOKEN: oldToken } }), { code: 'destination_private' });
});

test('cancellation is persisted as failure and errors do not disclose secrets', async t => {
  const f = await fixture(t), controller = new AbortController(); controller.abort();
  const result = await verifyBlobProjectCredential({ ...f, env: { BLOB_READ_WRITE_TOKEN: oldToken }, signal: controller.signal });
  assert.equal(result.code, 'canceled'); assert.deepEqual(await persisted(f.outputPath), result);
  const late = await fixture(t), lateController = new AbortController();
  const lateResult = await verifyBlobProjectCredential({ ...late, env: {
    get BLOB_READ_WRITE_TOKEN() { lateController.abort(); return oldToken; },
  }, signal: lateController.signal });
  assert.equal(lateResult.code, 'canceled'); assert.deepEqual(await persisted(late.outputPath), lateResult);
  const rejected = await fixture(t);
  const rejectedResult = await verifyBlobProjectCredential({ ...rejected, env: {
    get BLOB_READ_WRITE_TOKEN() { throw Error('sentinel-secret'); },
  } });
  assert.equal(rejectedResult.status, 'failed');
  assert.doesNotMatch(JSON.stringify(rejectedResult), /sentinel-secret|vercel_blob_rw/);
  let out = ''; const sink = { write(value) { out += value; } };
  assert.equal(await runBlobProjectCredentialCli(['sentinel-secret'], { stdout: sink, stderr: sink }), 1);
  assert.doesNotMatch(out, /sentinel-secret|vercel_blob_rw/);
});
