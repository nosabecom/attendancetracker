import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const calls = [];
mock.module('@vercel/blob', { exports: {
  get: async (path, options) => {
    calls.push({ path, options });
    return { statusCode: 200, stream: new Blob(['{"value":1}']).stream(), blob: { etag: 'current-etag' } };
  },
  put: async (path, body, options) => { calls.push({ path, body, options }); },
  list: async () => {}, del: async () => {},
} });
const { readVersioned, compareAndWrite } = await import('../lib/storage.ts');

test('conditional Blob reads bypass cache and preserve the ETag', async () => {
  calls.length = 0;
  assert.deepEqual(await readVersioned('lease.json'), { value: { value: 1 }, etag: 'current-etag' });
  assert.equal(calls[0].options.useCache, false);
});

test('Blob claims create only, while renewals require an ETag without contradictory overwrite options', async () => {
  calls.length = 0;
  await compareAndWrite('lease.json', {}, undefined);
  assert.equal(calls[0].options.allowOverwrite, false);
  assert.equal(calls[0].options.ifMatch, undefined);
  await compareAndWrite('lease.json', {}, 'current-etag');
  assert.equal(calls[1].options.ifMatch, 'current-etag');
  assert.notEqual(calls[1].options.allowOverwrite, false);
});
