#!/usr/bin/env node
// Offline comparison of one selected environment variable only. This neither
// verifies the CLI's target selection nor proves other secrets are absent.
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBlobProbeCredential } from './probe-blob-credential.mjs';

const tokenPattern = /^vercel_blob_rw_raW6bHbRonffwrRf_[A-Za-z0-9]{16,256}$/;
const record = (status, code) => ({ formatVersion: 1, scope: 'selected_blob_read_write_token_only', status, code });
const failure = code => Object.assign(new Error(`Credential comparison failed (${code}).`), { code });

async function persist(handle, value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  for (let offset = 0; offset < bytes.length;) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset);
    if (!bytesWritten) throw failure('output_write');
    offset += bytesWritten;
  }
  await handle.truncate(bytes.length);
  await handle.sync();
}

export async function verifyBlobProjectCredential({ env = process.env, baselinePath, currentPath, outputPath, signal } = {}) {
  if (![baselinePath, currentPath, outputPath].every(x => typeof x === 'string' && x.length > 0) ||
      (signal !== undefined && !(signal instanceof AbortSignal)) || !env || typeof env !== 'object') throw failure('invalid_options');
  const baseline = resolve(baselinePath), current = resolve(currentPath), output = resolve(outputPath), parent = dirname(output);
  if (new Set([baseline, current, output]).size !== 3) throw failure('invalid_options');
  let handle, identity;
  try {
    const stat = await lstat(parent);
    if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700 ||
      (typeof process.getuid === 'function' && stat.uid !== process.getuid()) || await realpath(parent) !== parent) throw failure('destination_private');
    handle = await open(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    identity = await handle.stat();
    await persist(handle, record('running', 'comparison_pending'));
    const dir = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY);
    try { await dir.sync(); } finally { await dir.close(); }
  } catch (error) {
    try { await handle?.close(); } catch {}
    throw failure(error?.code === 'EEXIST' ? 'output_exists' : error?.code === 'destination_private' ? 'destination_private' : 'output_write');
  }
  let result = record('failed', 'comparison_failed');
  try {
    if (signal?.aborted) throw failure('canceled');
    const [oldToken, currentToken] = await Promise.all([
      readBlobProbeCredential(baseline, 'rw'), readBlobProbeCredential(current, 'rw'),
    ]);
    const selected = env.BLOB_READ_WRITE_TOKEN;
    if (signal?.aborted) throw failure('canceled');
    if (tokenPattern.test(oldToken) && tokenPattern.test(currentToken) && typeof selected === 'string' &&
        tokenPattern.test(selected) && oldToken !== currentToken && selected === oldToken && selected !== currentToken)
      result = record('accepted', 'selected_matches_baseline');
  } catch (error) {
    if (signal?.aborted || error?.code === 'canceled') result = record('failed', 'canceled');
  }
  let persistenceFailed = false;
  try {
    if (signal?.aborted) result = record('failed', 'canceled');
    await persist(handle, result);
    if (signal?.aborted) { result = record('failed', 'canceled'); await persist(handle, result); }
    await handle.close(); handle = undefined;
  } catch { persistenceFailed = true; try { await handle?.close(); } catch {} handle = undefined; }
  // A signal or close error during the final write must never leave a success.
  if (persistenceFailed || (signal?.aborted && result.status === 'accepted')) {
    result = record('failed', persistenceFailed ? 'output_write' : 'canceled');
    try {
      const repair = await open(output, constants.O_WRONLY | constants.O_NOFOLLOW);
      try {
        const stat = await repair.stat();
        if (stat.dev !== identity.dev || stat.ino !== identity.ino) throw failure('output_write');
        await persist(repair, result);
      } finally { await repair.close(); }
    } catch { throw failure('output_write'); }
  }
  if (persistenceFailed) throw failure('output_write');
  return result;
}

export async function runBlobProjectCredentialCli(argv, { signal, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (argv.length !== 6) throw failure('cli_usage');
    const flags = new Map();
    for (let i = 0; i < argv.length; i += 2) {
      if (!['--baseline-env', '--current-env', '--output'].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--') || flags.has(argv[i])) throw failure('cli_usage');
      flags.set(argv[i], argv[i + 1]);
    }
    const result = await verifyBlobProjectCredential({ baselinePath: flags.get('--baseline-env'), currentPath: flags.get('--current-env'), outputPath: flags.get('--output'), signal });
    stdout.write(`Blob project credential comparison: ${result.code}.\n`);
    return result.status === 'accepted' ? 0 : 2;
  } catch (error) {
    const code = ['cli_usage', 'invalid_options', 'destination_private', 'output_exists', 'output_write'].includes(error?.code) ? error.code : 'comparison_failed';
    stderr.write(`Blob project credential comparison failed (${code}).\n`);
    return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const controller = new AbortController(), cancel = () => controller.abort();
  for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(name, cancel);
  process.exitCode = await runBlobProjectCredentialCli(process.argv.slice(2), { signal: controller.signal });
  for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.removeListener(name, cancel);
}
