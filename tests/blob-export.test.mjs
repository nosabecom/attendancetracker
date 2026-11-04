import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exportBlobSnapshot, BlobExportError } from '../scripts/export-blob.mjs';

const uploadedAt = new Date('2026-10-01T12:00:00.000Z');
function stream(value) { return new Blob([typeof value === 'string' ? value : JSON.stringify(value)]).stream(); }
function blob(pathname, value, metadata = {}) {
  const bytes = typeof value === 'string' ? value : JSON.stringify(value);
  return { pathname, uploadedAt, size: Buffer.byteLength(bytes), etag: `etag-${pathname}`, value, bytes, ...metadata };
}
function fakeSdk(records, { pageSize = 1000, getOverride, onList } = {}) {
  let lists = 0, active = 0, maxActive = 0;
  return {
    state: () => ({ lists, active, maxActive }),
    sdk: {
      async list(options = {}) {
        lists++;
        onList?.(lists);
        assert.equal(options.limit, 1000);
        const start = options.cursor ? Number(options.cursor) : 0;
        const items = records.slice(start, start + pageSize).map(({ value: _v, bytes: _b, ...entry }) => entry);
        const next = start + pageSize;
        return { blobs: items, hasMore: next < records.length, ...(next < records.length ? { cursor: String(next) } : {}) };
      },
      async get(pathname, options) {
        assert.deepEqual(options, { access: 'private', useCache: false });
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          await new Promise(resolve => setTimeout(resolve, 5));
          if (getOverride) return await getOverride(pathname);
          const item = records.find(record => record.pathname === pathname);
          if (!item) return null;
          return { statusCode: 200, stream: stream(item.bytes) };
        } finally { active--; }
      },
    },
  };
}
async function temp() { return mkdtemp(join(tmpdir(), 'blob-export-test-')); }
async function expectCode(work, code) {
  await assert.rejects(work, error => error instanceof BlobExportError && error.code === code && !/fiction|secret|token/i.test(error.message));
}

test('exports every page including unknown legacy paths, sorted with bounded private cache bypass reads', async () => {
  const dir = await temp();
  try {
    const records = [blob('z/old-auth-archive.json', { secret: 'fictional' }), blob('a/account.json', { owner: 'fictional' }), blob('m/unknown.json', ['raw', 'legacy'])];
    const { sdk, state } = fakeSdk(records, { pageSize: 1 });
    const result = await exportBlobSnapshot({ sdk, outputPath: join(dir, 'nested', 'snapshot.json'), concurrency: 2, now: () => uploadedAt });
    const snapshot = JSON.parse(await readFile(result.outputPath, 'utf8'));
    assert.deepEqual(snapshot, {
      formatVersion: 1, exportedAt: uploadedAt.toISOString(),
      blobs: [records[1], records[2], records[0]].map(({ pathname, value }) => ({ pathname, uploadedAt: uploadedAt.toISOString(), value })),
    });
    assert.equal(result.count, 3);
    assert.equal(state().lists, 6);
    assert.ok(state().maxActive <= 2 && state().maxActive > 1);
    assert.equal((await stat(result.outputPath)).mode & 0o777, 0o600);
    assert.equal((await stat(join(dir, 'nested'))).mode & 0o777, 0o700);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rejects existing destinations and symlinks without replacing their targets', async () => {
  const dir = await temp();
  try {
    const { sdk } = fakeSdk([blob('x.json', { ok: true })]);
    const target = join(dir, 'target');
    await writeFile(target, 'keep');
    await expectCode(exportBlobSnapshot({ sdk, outputPath: target }), 'output_exists');
    const link = join(dir, 'link');
    await symlink(target, link);
    await expectCode(exportBlobSnapshot({ sdk, outputPath: link }), 'output_exists');
    assert.equal(await readFile(target, 'utf8'), 'keep');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('stops scheduling reads after the first failure and waits for in-flight reads to finish', async () => {
  const dir = await temp();
  let reads = 0;
  try {
    const records = Array.from({ length: 100 }, (_, i) => blob(`${String(i).padStart(3, '0')}.json`, {}));
    const { sdk, state } = fakeSdk(records, { getOverride: async pathname => {
      reads++;
      if (pathname === '000.json') throw new Error('private SDK details');
      await new Promise(resolve => setTimeout(resolve, 15));
      return { statusCode: 200, stream: stream('{}') };
    } });
    await expectCode(exportBlobSnapshot({ sdk, outputPath: join(dir, 'snapshot.json'), concurrency: 3 }), 'sdk_error');
    assert.ok(reads <= 3);
    assert.equal(state().active, 0);
    assert.deepEqual(await readdir(dir), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('fails closed for SDK status, missing, invalid JSON, and oversized response bodies', async t => {
  for (const [label, records, response, code, maxBytes] of [
    ['403', [blob('x.json', '{}')], async () => ({ statusCode: 403, stream: stream('{}') }), 'response_status', 20],
    ['404', [blob('x.json', '{}')], async () => null, 'response_not_found', 20],
    ['invalid JSON', [blob('x.json', 'not json')], async () => ({ statusCode: 200, stream: stream('not json') }), 'invalid_json', 20],
    ['byte cap', [blob('x.json', '12345678')], async () => ({ statusCode: 200, stream: stream('12345678') }), 'response_too_large', 4],
  ]) {
    await t.test(label, async () => {
      const dir = await temp();
      try {
        const { sdk } = fakeSdk(records, { getOverride: response });
        await expectCode(exportBlobSnapshot({ sdk, outputPath: join(dir, 'snapshot.json'), maxBytes }), code);
        assert.deepEqual(await readdir(dir), []);
      } finally { await rm(dir, { recursive: true, force: true }); }
    });
  }
});

test('rejects pagination cursor loops and duplicate paths', async t => {
  await t.test('cursor loop', async () => {
    const sdk = { async list() { return { blobs: [], hasMore: true, cursor: 'repeat' }; }, async get() {} };
    await expectCode(exportBlobSnapshot({ sdk, outputPath: '/unused' }), 'cursor_loop');
  });
  await t.test('duplicate path', async () => {
    let calls = 0;
    const sdk = { async list() { calls++; return calls === 1
      ? { blobs: [{ pathname: 'same.json', uploadedAt }], hasMore: true, cursor: 'p2' }
      : { blobs: [{ pathname: 'same.json', uploadedAt }], hasMore: false }; }, async get() {} };
    await expectCode(exportBlobSnapshot({ sdk, outputPath: '/unused' }), 'duplicate_pathname');
  });
});

test('re-lists after reads and rejects metadata drift without publishing a file', async () => {
  const dir = await temp();
  try {
    let lists = 0;
    const records = [blob('x.json', { ok: true })];
    const { sdk } = fakeSdk(records, { onList(call) { lists = call; }, pageSize: 1000 });
    const originalList = sdk.list;
    sdk.list = async options => {
      const page = await originalList(options);
      if (lists >= 2) page.blobs[0].etag = 'changed-etag';
      return page;
    };
    await expectCode(exportBlobSnapshot({ sdk, outputPath: join(dir, 'snapshot.json') }), 'snapshot_changed');
    assert.deepEqual(await readdir(dir), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('cleans temporary files when writing cannot complete and sanitizes SDK exceptions', async t => {
  await t.test('SDK exception', async () => {
    const dir = await temp();
    try {
      const sdk = { async list() { throw new Error('secret token at private/path'); }, async get() {} };
      await expectCode(exportBlobSnapshot({ sdk, outputPath: join(dir, 'snapshot.json') }), 'sdk_error');
      assert.deepEqual(await readdir(dir), []);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  await t.test('publication failure', async () => {
    const dir = await temp();
    try {
      const { sdk } = fakeSdk([blob('x.json', {})]);
      await expectCode(exportBlobSnapshot({ sdk, outputPath: dir }), 'output_exists');
      assert.deepEqual(await readdir(dir), []);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('importing the module has no CLI output or network side effects', async () => {
  const moduleUrl = pathToFileURL(new URL('../scripts/export-blob.mjs', import.meta.url).pathname);
  moduleUrl.searchParams.set('import-check', String(Date.now()));
  const imported = await import(moduleUrl.href);
  assert.equal(typeof imported.exportBlobSnapshot, 'function');
});
