import test from 'node:test';
import assert from 'node:assert/strict';
import { captureBlobOwnerCredentialInPage as capture } from '../scripts/blob-owner-ui-capture.mjs';
import { importOwnerDownloadedCredential as importCredential } from '../scripts/blob-owner-ui-capture.mjs';
import { mkdtemp, mkdir, writeFile, readFile, lstat, rm, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const secret = 'vercel_blob_rw_raW6bHbRonffwrRf_SyntheticSentinel123456789';
function fixture(options = {}) {
  let shown = false, showClicks = 0, hideClicks = 0, downloads = 0, payload;
  const callbacks = new Set();
  const changed = () => { for (const fn of [...callbacks]) fn(); };
  const block = { get textContent() { return `1\nBLOB_READ_WRITE_TOKEN="${shown ? options.token ?? secret : '************'}"`; } };
  const button = (text, click) => ({ textContent: text, getClientRects: () => [1], click });
  const show = button('Show secret', () => { showClicks++; if (!options.stall) { shown = true; changed(); } });
  const hide = button('Hide secret', () => { hideClicks++; if (!options.maskFailure) { shown = false; changed(); } });
  const timers = new Map(); let nextTimer = 0;
  const env = {
    location: { origin: 'https://vercel.com', pathname: '/nomokaro625-9385s-projects/~/stores/blob/store_raW6bHbRonffwrRf/guides' },
    document: {
      documentElement: {}, body: { append() {} },
      querySelectorAll: kind => kind === 'pre' ? (options.duplicate ? [block, block] : [block]) : shown ? [hide] : [show],
      createElement: () => ({ style: {}, remove() {}, click() { if (options.downloadFailure) throw new Error(secret); downloads++; } }),
    },
    MutationObserver: class { constructor(fn) { this.fn = fn; } observe() { callbacks.add(this.fn); } disconnect() { callbacks.delete(this.fn); } },
    Blob: class { constructor(parts) { payload = parts.join(''); } },
    URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL() {} },
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  return { env, counts: () => ({ shown, showClicks, hideClicks, downloads, payload }), expire: () => { for (const fn of [...timers.values()]) fn(); } };
}

test('supported capture masks before download and returns no credential', async () => {
  const f = fixture();
  const result = await capture(f.env);
  assert.deepEqual(result, { status: 'download_requested', secretRemasked: true });
  assert.deepEqual(f.counts(), { shown: false, showClicks: 1, hideClicks: 1, downloads: 1, payload: `BLOB_READ_WRITE_TOKEN='${secret}'\n` });
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.deepEqual(await capture(f.env), { status: 'failed', code: 'already_started' });
  assert.equal(f.counts().downloads, 1);
});
test('wrong page, ambiguous snippet and other-store token stop without export', async () => {
  const wrong = fixture(); wrong.env.location.pathname = '/another-store';
  assert.equal((await capture(wrong.env)).code, 'wrong_page');
  assert.equal(wrong.counts().showClicks, 0);
  const duplicate = fixture({ duplicate: true });
  assert.equal((await capture(duplicate.env)).code, 'unexpected_ui');
  assert.equal(duplicate.counts().showClicks, 0);
  for (const token of ['vercel_blob_rw_rsKpaaIeuzjorirJ_SyntheticSentinel123456789', `${secret}"\nBLOB_READ_WRITE_TOKEN="${secret}`, 'not-a-token']) {
    const f = fixture({ token });
    assert.equal((await capture(f.env)).code, 'invalid_credential');
    assert.equal(f.counts().downloads, 0); assert.equal(f.counts().shown, false);
  }
});
test('reveal timeout, mask failure and download errors do not leak arbitrary errors', async () => {
  const stalled = fixture({ stall: true });
  const work = capture(stalled.env); stalled.expire();
  assert.equal((await work).code, 'reveal_timeout');
  const mask = fixture({ maskFailure: true });
  const masking = capture(mask.env); await Promise.resolve(); mask.expire();
  assert.equal((await masking).code, 'mask_failed');
  assert.equal(mask.counts().downloads, 0);
  const failed = fixture({ downloadFailure: true });
  const result = await capture(failed.env);
  assert.equal(result.code, 'download_failed');
  assert.ok(!JSON.stringify(result).includes(secret));
});
test('private import rejects unsafe inputs and unchanged credentials, then captures once without leakage', async t => {
  const root = await mkdtemp(join(tmpdir(), 'blob-owner-capture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const downloads = join(root, 'downloads'), output = join(root, 'private');
  await mkdir(downloads, { mode: 0o700 }); await mkdir(output, { mode: 0o700 });
  const old = join(output, 'old.env'), input = join(downloads, 'opaque-download'), target = join(output, 'current.env');
  const oldText = `BLOB_READ_WRITE_TOKEN='${secret}Old'\n`, newText = `BLOB_READ_WRITE_TOKEN='${secret}'\n`;
  await writeFile(old, oldText, { mode: 0o600 });
  const options = { downloadPath: input, expectedDownloadDirectory: downloads, outputPath: target, oldCredentialPath: old };
  await writeFile(input, newText, { mode: 0o644 });
  await assert.rejects(importCredential(options), { message: 'owner_credential_import_failed' });
  await chmod(input, 0o600); await writeFile(input, oldText);
  await assert.rejects(importCredential(options), { message: 'owner_credential_import_failed' });
  await writeFile(input, `${newText}OTHER='bad'\n`);
  await assert.rejects(importCredential(options), { message: 'owner_credential_import_failed' });
  await rm(input); await symlink(old, input);
  await assert.rejects(importCredential(options), { message: 'owner_credential_import_failed' });
  await rm(input); await writeFile(input, newText, { mode: 0o600 });
  const result = await importCredential(options);
  assert.deepEqual(result, { status: 'captured', storeMatched: true, differsFromBaseline: true, downloadedCopyRemoved: true });
  assert.equal(await readFile(target, 'utf8'), newText);
  assert.equal((await lstat(target)).mode & 0o777, 0o600);
  await assert.rejects(lstat(input), { code: 'ENOENT' });
  assert.ok(!JSON.stringify(result).includes(secret));
  await writeFile(input, newText, { mode: 0o600 });
  await assert.rejects(importCredential(options), { message: 'owner_credential_import_failed' });
  assert.equal(await readFile(target, 'utf8'), newText);
});
