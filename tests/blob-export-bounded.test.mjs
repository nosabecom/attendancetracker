import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  BLOB_RECOVERY_LIMITS, BoundedBlobExportError, PRODUCTION_BLOB_STORE,
  exportBoundedBlobSnapshot, runBoundedBlobExportCli,
} from '../scripts/export-blob-bounded.mjs';

// Deliberately synthetic credentials and data; this suite never uses a network.
const token = `vercel_blob_rw_${PRODUCTION_BLOB_STORE.slice(6)}_SYNTHETICCREDENTIAL00000000`;
const origin = `https://${PRODUCTION_BLOB_STORE.slice(6).toLowerCase()}.private.blob.vercel-storage.com`;
const date = '2026-10-01T12:00:00.000Z';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function record(pathname, value = { ok: true }, extras = {}) {
  const bytes = JSON.stringify(value);
  return { pathname, value, bytes, url: `${origin}/${pathname.split('/').map(encodeURIComponent).join('/')}`, uploadedAt: date, size: Buffer.byteLength(bytes), etag: `etag-${pathname}`, ...extras };
}
function page(records) {
  return { hasMore: false, blobs: records.map(({ value: _value, bytes: _bytes, ...metadata }) => metadata) };
}
function response(value, { raw = false, status = 200 } = {}) {
  return { status, body: new Blob([raw ? value : JSON.stringify(value)]).stream() };
}
function fixture(records = [record('one.json')], { onList, onGet } = {}) {
  const state = { metadata: 0, objects: [], signals: [], requests: [] };
  const transport = async (url, options) => {
    state.requests.push(url.href);
    state.signals.push(options.signal);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, `Bearer ${token}`);
    assert.equal(options.signal.aborted, false);
    if (url.origin === 'https://vercel.com') {
      state.metadata++;
      assert.equal(url.href, 'https://vercel.com/api/blob?limit=400');
      assert.equal(options.headers['x-api-version'], '13');
      assert.equal(options.headers['x-vercel-blob-store-id'], PRODUCTION_BLOB_STORE.slice(6));
      assert.equal(options.headers['x-api-blob-request-attempt'], '0');
      assert.match(options.headers['x-api-blob-request-id'], new RegExp(`^${PRODUCTION_BLOB_STORE.slice(6)}:[0-9]+:[a-f0-9]{16}$`));
      return onList ? onList(state.metadata, options) : response(page(records));
    }
    assert.equal(url.origin, origin);
    assert.equal(url.search, '?cache=0');
    const pathname = decodeURIComponent(url.pathname.slice(1));
    state.objects.push(pathname);
    return onGet ? onGet(pathname, options) : response(records.find(item => item.pathname === pathname).bytes, { raw: true });
  };
  return { transport, state };
}
async function temp() { return mkdtemp(join(tmpdir(), 'bounded-blob-test-')); }
function options(dir, transport, extras = {}) {
  return { token, outputPath: join(dir, 'snapshot.json'), attemptPath: join(dir, 'attempt.json'), transport, now: () => new Date(date), ...extras };
}
async function attempt(dir) { return JSON.parse(await readFile(join(dir, 'attempt.json'), 'utf8')); }
async function fails(work, code) {
  await assert.rejects(work, error => error instanceof BoundedBlobExportError && error.code === code &&
    !error.message.includes(token) && !error.message.includes('ERROR_SENTINEL') && !error.message.includes('one.json'));
}
async function checkFailure(dir, code) {
  const saved = await attempt(dir);
  assert.equal(saved.status, 'failed');
  assert.equal(saved.code, code);
  assert.equal(saved.snapshotPublished, false);
  assert.deepEqual((await readdir(dir)).sort(), ['attempt.json']);
  assert.ok(!JSON.stringify(saved).includes(token));
  assert.ok(!JSON.stringify(saved).includes('one.json'));
  return saved;
}

test('publishes a compatible private snapshot with two metadata requests and one GET per pathname', async () => {
  const dir = await temp();
  try {
    const records = [record('z/legacy.json', ['raw']), record('a/account.json', { synthetic: true })];
    let active = 0, maxActive = 0;
    const { transport, state } = fixture(records, { onGet: async pathname => {
      active++; maxActive = Math.max(active, maxActive);
      return { status: 200, body: new ReadableStream({
        async start(controller) {
          await wait(10);
          controller.enqueue(Buffer.from(records.find(item => item.pathname === pathname).bytes));
          active--; controller.close();
        },
      }) };
    } });
    const result = await exportBoundedBlobSnapshot(options(dir, transport));
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'snapshot.json'), 'utf8')), {
      formatVersion: 1, exportedAt: date,
      blobs: [records[1], records[0]].map(({ pathname, value }) => ({ pathname, value, uploadedAt: date })),
    });
    assert.equal(result.count, 2);
    assert.equal(state.metadata, 2);
    assert.deepEqual(state.objects, ['a/account.json', 'z/legacy.json']);
    assert.equal(maxActive, 2);
    assert.equal(active, 0);
    const saved = await attempt(dir);
    assert.equal(saved.status, 'succeeded');
    assert.equal(saved.metadataAttempts, 2);
    assert.equal(saved.objectAttempts, 2);
    assert.equal(saved.bodyBytes, result.bodyBytes);
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
    for (const name of ['snapshot.json', 'attempt.json']) assert.equal((await stat(join(dir, name))).mode & 0o777, 0o600);
    assert.deepEqual((await readdir(dir)).sort(), ['attempt.json', 'snapshot.json']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('durably reserves the single-use budget before transport, including failures; never retries SDK-style errors', async () => {
  const dir = await temp();
  try {
    let calls = 0;
    const transport = async () => {
      calls++;
      const saved = await attempt(dir);
      assert.equal(saved.status, 'running');
      assert.equal(saved.metadataAttempts, 1);
      assert.equal(saved.objectAttempts, 0);
      throw new TypeError(`fetch failed ERROR_SENTINEL ${token}`);
    };
    await fails(exportBoundedBlobSnapshot(options(dir, transport)), 'transport_error');
    assert.equal(calls, 1);
    assert.equal((await checkFailure(dir, 'transport_error')).metadataAttempts, 1);
    await fails(exportBoundedBlobSnapshot(options(dir, transport)), 'attempt_exists');
    assert.equal(calls, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rejects pagination and oversized inventories before any object GET', async t => {
  for (const [label, listing, code] of [
    ['pagination', { ...page([record('one.json')]), hasMore: true, cursor: 'private-cursor' }, 'pagination'],
    ['401 objects', page(Array.from({ length: 401 }, (_, i) => record(`${i}.json`))), 'object_limit'],
    ['advertised object size', page([record('one.json', {}, { size: BLOB_RECOVERY_LIMITS.objectBytes + 1 })]), 'response_too_large'],
  ]) await t.test(label, async () => {
    const dir = await temp();
    try {
      const { transport, state } = fixture([], { onList: () => response(listing) });
      await fails(exportBoundedBlobSnapshot(options(dir, transport)), code);
      assert.equal(state.metadata, 1);
      assert.deepEqual(state.objects, []);
      await checkFailure(dir, code);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('allows exactly 400 objects without raising either physical-request budget', async () => {
  const dir = await temp();
  try {
    const records = Array.from({ length: 400 }, (_, i) => record(`${i}.json`, null));
    const { transport, state } = fixture(records);
    const result = await exportBoundedBlobSnapshot(options(dir, transport));
    assert.equal(result.count, 400);
    assert.equal(result.metadataAttempts, 2);
    assert.equal(result.objectAttempts, 400);
    assert.equal(state.requests.length, 402);
    assert.equal(new Set(state.objects).size, 400);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('preflights existing output, symlinks, private directory, and attempt replay without requests', async t => {
  for (const kind of ['file', 'symlink', 'public-directory', 'attempt']) await t.test(kind, async () => {
    const dir = await temp();
    try {
      const { transport, state } = fixture();
      if (kind === 'file') await writeFile(join(dir, 'snapshot.json'), 'keep');
      if (kind === 'symlink') { await writeFile(join(dir, 'target'), 'keep'); await symlink(join(dir, 'target'), join(dir, 'snapshot.json')); }
      if (kind === 'public-directory') await chmod(dir, 0o755);
      if (kind === 'attempt') await writeFile(join(dir, 'attempt.json'), 'prior failed attempt');
      await fails(exportBoundedBlobSnapshot(options(dir, transport)), kind === 'public-directory' ? 'destination_private' : kind === 'attempt' ? 'attempt_exists' : 'output_exists');
      assert.equal(state.requests.length, 0);
      if (kind === 'attempt') assert.equal(await readFile(join(dir, 'attempt.json'), 'utf8'), 'prior failed attempt');
      if (kind === 'file') assert.equal(await readFile(join(dir, 'snapshot.json'), 'utf8'), 'keep');
      if (kind === 'symlink') assert.equal(await readFile(join(dir, 'target'), 'utf8'), 'keep');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('verifies explicit token/store identity locally and rejects foreign listing URLs', async t => {
  for (const [label, extras, records, code, expectedRequests] of [
    ['wrong token', { token: 'ERROR_SENTINEL' }, [record('one.json')], 'invalid_token', 0],
    ['wrong store', { expectedStoreId: 'store_0123456789abcdef' }, [record('one.json')], 'store_mismatch', 0],
    ['store URL', { expectedStoreId: origin }, [record('one.json')], 'invalid_options', 0],
    ['foreign host', {}, [record('one.json', {}, { url: 'https://foreign.invalid/one.json' })], 'invalid_metadata', 1],
    ['URL userinfo', {}, [record('one.json', {}, { url: origin.replace('https://', 'https://user@') + '/one.json' })], 'invalid_metadata', 1],
    ['URL wrong pathname', {}, [record('one.json', {}, { url: `${origin}/other.json` })], 'invalid_metadata', 1],
  ]) await t.test(label, async () => {
    const dir = await temp();
    try {
      const { transport, state } = fixture(records);
      await fails(exportBoundedBlobSnapshot(options(dir, transport, extras)), code);
      assert.equal(state.requests.length, expectedRequests);
      assert.equal(state.objects.length, 0);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('header deadline aborts a stalled transport and retains the spent attempt', async () => {
  const dir = await temp();
  try {
    let calls = 0, aborted = false;
    const transport = (_url, { signal }) => new Promise((_resolve, reject) => {
      calls++;
      signal.addEventListener('abort', () => { aborted = true; reject(new Error(`ERROR_SENTINEL ${token}`)); }, { once: true });
    });
    await fails(exportBoundedBlobSnapshot(options(dir, transport, { headersMs: 20 })), 'headers_timeout');
    assert.equal(aborted, true);
    assert.equal(calls, 1);
    assert.equal((await checkFailure(dir, 'headers_timeout')).metadataAttempts, 1);
    await wait(30);
    assert.equal(calls, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('body deadline cancels a stalled body and does not send the second metadata request', async () => {
  const dir = await temp();
  try {
    let canceled = false;
    const { transport, state } = fixture(undefined, { onGet: () => ({ status: 200, body: new ReadableStream({ cancel() { canceled = true; } }) }) });
    await fails(exportBoundedBlobSnapshot(options(dir, transport, { bodyMs: 20 })), 'body_timeout');
    assert.equal(canceled, true);
    assert.equal(state.metadata, 1);
    assert.equal(state.objects.length, 1);
    await checkFailure(dir, 'body_timeout');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('first failure aborts and settles its peer worker, with no queued GET or late sends', async () => {
  const dir = await temp();
  try {
    let peerCanceled = false, releaseFailure;
    const peerStarted = new Promise(resolve => { releaseFailure = resolve; });
    const records = Array.from({ length: 20 }, (_, i) => record(`${String(i).padStart(2, '0')}.json`));
    const { transport, state } = fixture(records, { onGet: async pathname => {
      if (pathname === '00.json') { await peerStarted; throw new Error(`ERROR_SENTINEL ${token}`); }
      releaseFailure();
      return { status: 200, body: new ReadableStream({ cancel() { peerCanceled = true; } }) };
    } });
    await fails(exportBoundedBlobSnapshot(options(dir, transport)), 'transport_error');
    assert.equal(peerCanceled, true);
    assert.equal(state.objects.length, 2);
    assert.ok(state.signals.every(signal => signal.aborted));
    await checkFailure(dir, 'transport_error');
    await wait(30);
    assert.equal(state.objects.length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('cancellation and global deadline persist failure and prevent further requests', async t => {
  for (const kind of ['signal', 'global', 'already-aborted']) await t.test(kind, async () => {
    const dir = await temp();
    try {
      const controller = new AbortController();
      let canceled = false, timer;
      const { transport, state } = fixture(undefined, { onGet: () => {
        if (kind === 'signal') timer = setTimeout(() => controller.abort(new Error('ERROR_SENTINEL')), 10);
        return { status: 200, body: new ReadableStream({ cancel() { canceled = true; } }) };
      } });
      if (kind === 'already-aborted') controller.abort();
      const code = kind === 'global' ? 'global_timeout' : 'canceled';
      await fails(exportBoundedBlobSnapshot(options(dir, transport, { signal: controller.signal, ...(kind === 'global' ? { globalMs: 20 } : {}) })), code);
      clearTimeout(timer);
      const saved = await checkFailure(dir, code);
      assert.equal(saved.metadataAttempts, kind === 'already-aborted' ? 0 : 1);
      assert.equal(saved.objectAttempts, kind === 'already-aborted' ? 0 : 1);
      assert.equal(canceled, kind !== 'already-aborted');
      const sends = state.requests.length;
      await wait(30);
      assert.equal(state.requests.length, sends);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('enforces actual stream and aggregate body bounds, even when metadata understates size', async t => {
  for (const kind of ['object', 'aggregate']) await t.test(kind, async () => {
    const dir = await temp();
    try {
      const records = [record('one.json', null)];
      const listedBytes = Buffer.byteLength(JSON.stringify(page(records)));
      const { transport, state } = fixture(records, { onGet: () => response(' '.repeat(64) + '{}', { raw: true }) });
      const code = kind === 'object' ? 'response_too_large' : 'total_body_limit';
      const extras = kind === 'object' ? { maxBytes: 16 } : { maxTotalBytes: listedBytes + 32 };
      await fails(exportBoundedBlobSnapshot(options(dir, transport, extras)), code);
      assert.equal(state.metadata, 1);
      assert.equal(state.objects.length, 1);
      await checkFailure(dir, code);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('rejects HTTP errors without retries, malformed JSON, duplicates, and snapshot drift', async t => {
  for (const kind of ['503', 'redirect', 'json', 'duplicate', 'drift']) await t.test(kind, async () => {
    const dir = await temp();
    try {
      const records = [record('one.json')];
      const { transport, state } = fixture(records, {
        onList: call => response(kind === 'duplicate' ? page([records[0], records[0]]) :
          kind === 'drift' && call === 2 ? page([record('one.json', {}, { etag: 'changed' })]) : page(records)),
        onGet: () => response(kind === 'json' ? 'ERROR_SENTINEL' : '{}', { raw: true, status: kind === '503' ? 503 : kind === 'redirect' ? 302 : 200 }),
      });
      const code = ['503', 'redirect'].includes(kind) ? 'response_status' : kind === 'json' ? 'invalid_json' : kind === 'duplicate' ? 'duplicate_pathname' : 'snapshot_changed';
      await fails(exportBoundedBlobSnapshot(options(dir, transport)), code);
      assert.equal(state.metadata, kind === 'drift' ? 2 : 1);
      assert.equal(state.objects.length, kind === 'duplicate' ? 0 : 1);
      await checkFailure(dir, code);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('CLI is explicitly opt-in, takes only env credentials, and never prints paths or error details', async () => {
  let output = '', errors = '', calls = 0;
  const stdout = { write(value) { output += value; } }, stderr = { write(value) { errors += value; } };
  const env = { BLOB_READ_WRITE_TOKEN: token, VERCEL_OIDC_TOKEN: 'OIDC_SENTINEL', BLOB_STORE_ID: 'FOREIGN_STORE' };
  const args = ['--run', '--output', '/private/NAME_SENTINEL', '--attempt', '/private/ATTEMPT_SENTINEL'];
  const run = async options => {
    calls++;
    assert.equal(options.token, token);
    assert.equal(options.expectedStoreId, PRODUCTION_BLOB_STORE);
    assert.equal(options.oidcToken, undefined);
    return { count: 1, metadataAttempts: 2, objectAttempts: 1 };
  };
  assert.equal(await runBoundedBlobExportCli(args.slice(1), { env, stdout, stderr, run }), 1);
  assert.equal(calls, 0);
  assert.equal(await runBoundedBlobExportCli(args, { env, stdout, stderr, run }), 0);
  assert.equal(calls, 1);
  assert.equal(await runBoundedBlobExportCli(args, { env, stdout, stderr, run: async () => { throw new Error(`ERROR_SENTINEL ${token}`); } }), 1);
  const forged = new BoundedBlobExportError('canceled');
  forged.code = token;
  assert.equal(await runBoundedBlobExportCli(args, { env, stdout, stderr, run: async () => { throw forged; } }), 1);
  assert.equal(await runBoundedBlobExportCli([...args, '--token', token], { env, stdout, stderr, run }), 1);
  assert.ok(output.includes('1 objects, 2 metadata requests, 1 object requests'));
  for (const sentinel of [token, 'OIDC_SENTINEL', 'NAME_SENTINEL', 'ATTEMPT_SENTINEL', 'ERROR_SENTINEL']) assert.ok(!(output + errors).includes(sentinel));
});

test('module import has no CLI side effects and bounds cannot be raised', async () => {
  const imported = await import(`../scripts/export-blob-bounded.mjs?test-import=${Date.now()}`);
  assert.equal(typeof imported.exportBoundedBlobSnapshot, 'function');
  for (const extras of [{ maxBytes: BLOB_RECOVERY_LIMITS.objectBytes + 1 }, { maxTotalBytes: BLOB_RECOVERY_LIMITS.totalBodyBytes + 1 }, { globalMs: BLOB_RECOVERY_LIMITS.globalMs + 1 }]) {
    await fails(exportBoundedBlobSnapshot({ token, outputPath: '/unused/snapshot.json', attemptPath: '/unused/attempt.json', ...extras }), 'invalid_options');
  }
});

// Isolate fs module mocks so they cannot affect the suite's own private files.
// These barriers land cancellation in the microtask gaps around durable writes,
// rather than relying on wall-clock sleeps or filesystem watcher timing.
const execute = promisify(execFile);
const finalizationChild = `
import { mock } from 'node:test';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
const [directory, mode] = process.argv.slice(1);
const attemptPath = join(directory, 'attempt.json');
const controller = new AbortController();
let syncs = 0, sends = 0, shortWrites = 0, failedClose = false, directorySyncs = 0, publicationSynced = false;
mock.module('node:fs/promises', { namedExports: {
  lstat:fs.lstat, readFile:fs.readFile, realpath:fs.realpath, link:fs.link,
  async unlink(path) {
    if (mode === 'cleanup') controller.abort();
    if (mode === 'unlink-failure') throw new Error('ERROR_SENTINEL');
    return fs.unlink(path);
  },
  async open(path, ...args) {
    const handle = await fs.open(path, ...args);
    if (path === directory) return new Proxy(handle, { get(target, key) {
      if (key === 'sync') return async () => {
        directorySyncs++;
        if (directorySyncs === 2) {
          const saved = JSON.parse(await fs.readFile(attemptPath, 'utf8'));
          if (saved.status !== 'running' || saved.metadataAttempts !== 2 || saved.objectAttempts !== 1) throw new Error('Directory sync occurred after success');
          await fs.stat(join(directory, 'snapshot.json'));
          if (mode === 'publication-sync-failure') throw new Error('ERROR_SENTINEL');
          publicationSynced = true;
        }
        return target.sync();
      };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    if (path !== attemptPath) return handle;
    return new Proxy(handle, { get(target, key) {
      if (key === 'close' && mode === 'close-failure' && !failedClose) return async () => {
        failedClose = true;
        await target.close();
        throw new Error('ERROR_SENTINEL');
      };
      if (key === 'write' && mode === 'short-write') return async (buffer, offset, length, position) => {
        shortWrites++;
        return target.write(buffer, offset, Math.min(7, length), position);
      };
      if (key === 'sync') return () => {
        const pending = target.sync();
        syncs++;
        if (mode === 'after-reserve' && syncs === 2) {
          // Abort after reserve's final check but before request continuation.
          void pending.then(() => queueMicrotask(() => queueMicrotask(() => controller.abort())));
        }
        if (mode === 'final-persist' && syncs === 5) controller.abort();
        return pending;
      };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  },
} });
const { exportBoundedBlobSnapshot, PRODUCTION_BLOB_STORE } = await import(${JSON.stringify(new URL('../scripts/export-blob-bounded.mjs', import.meta.url).href)});
const origin = 'https://' + PRODUCTION_BLOB_STORE.slice(6).toLowerCase() + '.private.blob.vercel-storage.com';
const listing = { hasMore:false, blobs:[{ pathname:'synthetic.json', url:origin+'/synthetic.json', size:2, uploadedAt:'2026-10-01T12:00:00.000Z' }] };
let code = 'success';
try {
  await exportBoundedBlobSnapshot({
    token:'vercel_blob_rw_'+PRODUCTION_BLOB_STORE.slice(6)+'_SYNTHETICCREDENTIAL00000000',
    outputPath:join(directory,'snapshot.json'), attemptPath, signal:controller.signal,
    transport:async url => {
      sends++;
      return { status:200, body:new Blob([JSON.stringify(url.origin === 'https://vercel.com' ? listing : {})]).stream() };
    },
  });
} catch (error) { code = error.code; }
console.log(JSON.stringify({ code, sends, shortWrites, syncs, directorySyncs, publicationSynced }));
`;
for (const mode of ['after-reserve', 'final-persist', 'cleanup', 'short-write', 'close-failure', 'unlink-failure', 'publication-sync', 'publication-sync-failure']) {
  test(`${mode} preserves honest durable accounting and cancellation`, async () => {
    const dir = await temp();
    try {
      const { stdout } = await execute(process.execPath, ['--experimental-test-module-mocks', '--input-type=module', '-e', finalizationChild, dir, mode], { timeout: 10_000 });
      const result = JSON.parse(stdout);
      const saved = await attempt(dir);
      if (['short-write', 'publication-sync'].includes(mode)) {
        assert.equal(result.code, 'success');
        assert.equal(saved.status, 'succeeded');
        assert.equal(saved.metadataAttempts, 2);
        assert.equal(saved.objectAttempts, 1);
        if (mode === 'short-write') assert.ok(result.shortWrites > 100);
        assert.equal(result.directorySyncs, 2);
        assert.equal(result.publicationSynced, true);
      } else {
        const expectedCode = mode === 'close-failure' ? 'attempt_write' : ['unlink-failure', 'publication-sync-failure'].includes(mode) ? 'output_write' : 'canceled';
        assert.equal(result.code, expectedCode);
        assert.equal(saved.status, 'failed');
        assert.equal(saved.code, expectedCode);
        assert.equal(saved.snapshotPublished, mode !== 'after-reserve');
        assert.equal(saved.metadataAttempts, mode === 'after-reserve' ? 1 : 2);
        assert.equal(saved.objectAttempts, mode === 'after-reserve' ? 0 : 1);
        assert.equal(result.sends, mode === 'after-reserve' ? 0 : 3);
        const names = (await readdir(dir)).sort();
        if (mode === 'unlink-failure') {
          assert.equal(saved.temporaryCleaned, false);
          assert.equal(names.length, 3);
          const leftover = names.find(name => name.endsWith('.tmp'));
          assert.ok(leftover);
          assert.equal((await stat(join(dir, leftover))).mode & 0o777, 0o600);
        } else assert.deepEqual(names, mode === 'after-reserve' ? ['attempt.json'] : ['attempt.json', 'snapshot.json']);
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}
