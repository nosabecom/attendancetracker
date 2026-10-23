import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, readJson } from '../lib/http.mjs';

test('JSON limits count streamed bytes even with a missing or false Content-Length', async () => {
  for (const length of [undefined, '1']) {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"value":"éééé"}')); },
      cancel() { cancelled = true; },
    });
    const request = new Request('https://example.test/api/auth', {
      method: 'POST', body, duplex: 'half',
      headers: length ? { 'Content-Length': length } : {},
    });
    await assert.rejects(readJson(request, 12), error => error instanceof HttpError && error.status === 413);
    assert.equal(cancelled, true);
  }
});

test('JSON parser accepts bounded objects and rejects malformed or non-object bodies', async () => {
  const request = value => new Request('https://example.test/api/auth', { method: 'POST', body: value });
  assert.deepEqual(await readJson(request('{"action":"login"}'), 100), { action: 'login' });
  for (const value of ['{', 'null', '[]', '"login"']) {
    await assert.rejects(readJson(request(value), 100), error => error instanceof HttpError && error.status === 400);
  }
});
