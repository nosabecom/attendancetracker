import { constants } from 'node:fs';
import { open, lstat, realpath, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { readBlobProbeCredential } from './probe-blob-credential.mjs';

// Run only in the authenticated, owned store tab after the private download
// destination and durable one-attempt reservation have been verified.
// This uses the ordinary Show/Hide secret UI, never framework internals.
export async function captureBlobOwnerCredentialInPage(env = globalThis) {
  const codes = new Set(['wrong_page', 'already_started', 'unexpected_ui',
    'reveal_timeout', 'invalid_credential', 'mask_failed', 'download_failed']);
  const failure = code => { throw Object.assign(new Error('capture_failed'), { code }); };
  let token, observer, timer, revealed = false;
  const doc = env.document;
  const visibleButtons = text => [...doc.querySelectorAll('button')]
    .filter(button => button.textContent.trim() === text && button.getClientRects().length);
  const snippet = () => {
    const blocks = [...doc.querySelectorAll('pre')]
      .filter(block => block.textContent.includes('BLOB_READ_WRITE_TOKEN='));
    if (blocks.length !== 1) failure('unexpected_ui');
    return blocks[0].textContent;
  };
  const masked = () => /BLOB_READ_WRITE_TOKEN\s*=\s*["']\*+["']/.test(snippet());
  const readToken = () => {
    const text = snippet();
    if (/BLOB_READ_WRITE_TOKEN\s*=\s*["']\*+["']/.test(text)) return null;
    const matches = [...text.matchAll(/BLOB_READ_WRITE_TOKEN\s*=\s*["'](vercel_blob_rw_raW6bHbRonffwrRf_[A-Za-z0-9]{16,256})["']/g)];
    if (matches.length !== 1 || (text.match(/vercel_blob_rw_/g) || []).length !== 1) failure('invalid_credential');
    return matches[0][1];
  };
  const waitFor = (read, code) => new Promise((resolve, reject) => {
    const check = () => {
      try { const value = read(); if (value) { observer?.disconnect(); env.clearTimeout(timer); resolve(value); } }
      catch (error) { observer?.disconnect(); env.clearTimeout(timer); reject(error); }
    };
    observer = new env.MutationObserver(check);
    observer.observe(doc.documentElement, { subtree: true, childList: true, characterData: true });
    timer = env.setTimeout(() => { observer.disconnect(); reject(Object.assign(new Error('capture_failed'), { code })); }, 5000);
    check();
  });
  try {
    if (env.location.origin !== 'https://vercel.com' ||
      env.location.pathname !== '/nomokaro625-9385s-projects/~/stores/blob/store_raW6bHbRonffwrRf/guides') failure('wrong_page');
    if (env.__attendanceOwnerCaptureStarted) failure('already_started');
    if (!masked() || visibleButtons('Show secret').length !== 1 || visibleButtons('Hide secret').length) failure('unexpected_ui');
    env.__attendanceOwnerCaptureStarted = true;
    visibleButtons('Show secret')[0].click();
    revealed = true;
    token = await waitFor(readToken, 'reveal_timeout');
    const hide = visibleButtons('Hide secret');
    if (hide.length !== 1) failure('mask_failed');
    hide[0].click();
    await waitFor(masked, 'mask_failed');
    revealed = false;
    let url, anchor;
    try {
      const blob = new env.Blob([`BLOB_READ_WRITE_TOKEN='${token}'\n`], { type: 'text/plain' });
      url = env.URL.createObjectURL(blob);
      anchor = doc.createElement('a');
      anchor.href = url;
      anchor.download = 'attendance-owner-store-current-20261110.env';
      anchor.style.display = 'none';
      doc.body.append(anchor);
      anchor.click();
      env.setTimeout(() => env.URL.revokeObjectURL(url), 5000);
    } catch { if (url) env.URL.revokeObjectURL(url); failure('download_failed'); }
    finally { anchor?.remove(); }
    return { status: 'download_requested', secretRemasked: true };
  } catch (error) {
    return { status: 'failed', code: codes.has(error?.code) ? error.code : 'unexpected_ui' };
  } finally {
    token = undefined;
    observer?.disconnect();
    env.clearTimeout(timer);
    if (revealed) {
      // Best effort only; the caller closes the owned tab on every failure.
      try { const hide = visibleButtons('Hide secret'); if (hide.length === 1) hide[0].click(); } catch {}
    }
  }
}

// No CLI: only root calls this after the browser reports the one download
// completed. Arguments contain private paths, never a credential value.
export async function importOwnerDownloadedCredential({ downloadPath, expectedDownloadDirectory, outputPath, oldCredentialPath }) {
  const fail = () => { throw new Error('owner_credential_import_failed'); };
  const privateDirectory = async path => {
    const stat = await lstat(path);
    if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700 ||
      stat.uid !== process.getuid() || await realpath(path) !== path) fail();
  };
  let source, destination;
  try {
    const input = resolve(downloadPath), directory = resolve(expectedDownloadDirectory);
    const output = resolve(outputPath), parent = dirname(output);
    if (dirname(input) !== directory || input === output) fail();
    await privateDirectory(directory);
    await privateDirectory(parent);
    source = await open(input, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await source.stat();
    if (!before.isFile() || (before.mode & 0o777) !== 0o600 || before.uid !== process.getuid() || before.size > 512) fail();
    const buffer = Buffer.alloc(513);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await source.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > 512) fail();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
    if (!/^BLOB_READ_WRITE_TOKEN='vercel_blob_rw_raW6bHbRonffwrRf_[A-Za-z0-9]{16,256}'\n$/.test(text)) fail();
    const token = text.slice("BLOB_READ_WRITE_TOKEN='".length, -2);
    const old = await readBlobProbeCredential(oldCredentialPath, 'rw');
    if (token === old) fail();
    destination = await open(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await destination.writeFile(text);
    await destination.sync();
    await destination.close(); destination = undefined;
    const dirHandle = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY);
    try { await dirHandle.sync(); } finally { await dirHandle.close(); }
    if (await readBlobProbeCredential(output, 'rw') !== token) fail();
    const current = await lstat(input);
    if (current.dev !== before.dev || current.ino !== before.ino) fail();
    await unlink(input);
    const sourceDir = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
    try { await sourceDir.sync(); } finally { await sourceDir.close(); }
    return { status: 'captured', storeMatched: true, differsFromBaseline: true, downloadedCopyRemoved: true };
  } catch { fail(); }
  finally { await source?.close(); await destination?.close(); }
}
