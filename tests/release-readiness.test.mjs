import test from 'node:test';
import assert from 'node:assert/strict';
import { readReadinessBody, signReadinessRequest, verifyReleaseReadiness, verifyReadinessResponse } from '../lib/release-readiness.mjs';

const secret = 'synthetic-only-key-'.repeat(3);
const input = { version: 1, release: 'a'.repeat(40), origin: 'https://example-123.vercel.app',
  audience: 'synthetic-preview', cloudUrl: 'https://synthetic-test.convex.cloud',
  siteUrl: 'https://synthetic-test.convex.site', issuedAt: 100000, nonce: 'b'.repeat(64) };
const env = { ATTENDANCE_GATEWAY_KEY: secret, ATTENDANCE_GATEWAY_AUDIENCE: input.audience,
  VERCEL_URL: 'example-123.vercel.app', NEXT_PUBLIC_ATTENDANCE_BACKEND: 'convex',
  NEXT_PUBLIC_CONVEX_URL: input.cloudUrl, NEXT_PUBLIC_CONVEX_SITE_URL: input.siteUrl,
  NEXT_PUBLIC_ATTENDANCE_RELEASE: input.release, CONVEX_DEPLOY_KEY: '', BLOB_READ_WRITE_TOKEN: '' };
const compiled = { backend: 'convex', cloudUrl: input.cloudUrl, siteUrl: input.siteUrl, release: input.release };
const signed = signReadinessRequest(input, secret);
const options = { env, compiled, origin: input.origin, now: input.issuedAt };

test('signed acknowledgment binds both build/live configuration and full request context', () => {
  const result = verifyReleaseReadiness(signed, options);
  assert.deepEqual(Object.keys(result), ['version', 'ready', 'signature']);
  assert.equal(verifyReadinessResponse(result, signed, secret), true);
  for (const [field, value] of [['nonce','c'.repeat(64)], ['issuedAt',99999], ['origin','https://other.vercel.app'], ['release','d'.repeat(40)]])
    assert.equal(verifyReadinessResponse(result, signReadinessRequest({ ...input, [field]: value }, secret), secret), false);
  assert.equal(verifyReadinessResponse(result, signed, 'wrong-secret'.repeat(4)), false);
  assert.equal(verifyReadinessResponse({ ...result, extra: true }, signed, secret), false);
  assert.throws(() => verifyReleaseReadiness({ ...signed, signature: result.signature }, options));
});

test('wrong key/audience, altered schema, stale/future proof and destination reject', () => {
  for (const altered of [{ ...signed, audience: 'other' }, { ...signed, nonce: 'c'.repeat(64) },
    { ...signed, extra: true }, { ...signed, signature: '0'.repeat(64) },
    signReadinessRequest({ ...input, issuedAt: input.issuedAt - 30001 }, secret),
    signReadinessRequest({ ...input, issuedAt: input.issuedAt + 5001 }, secret)])
    assert.throws(() => verifyReleaseReadiness(altered, options));
  assert.throws(() => verifyReleaseReadiness(signed, { ...options, origin: 'https://other.vercel.app' }));
  assert.throws(() => verifyReleaseReadiness(signed, { ...options, env: { ...env, ATTENDANCE_GATEWAY_KEY: 'wrong'.repeat(12) } }));
});

test('compiled success cannot hide differing runtime values, missing or nonempty credentials', () => {
  for (const field of Object.keys(env)) {
    const bad = { ...env, [field]: 'sentinel-do-not-disclose' };
    assert.throws(() => verifyReleaseReadiness(signed, { ...options, env: bad }));
  }
  for (const field of ['CONVEX_DEPLOY_KEY', 'BLOB_READ_WRITE_TOKEN']) {
    const missing = { ...env }; delete missing[field];
    assert.throws(() => verifyReleaseReadiness(signed, { ...options, env: missing }));
  }
  for (const field of Object.keys(compiled))
    assert.throws(() => verifyReleaseReadiness(signed, { ...options, compiled: { ...compiled, [field]: 'wrong' } }));
});

test('body parser bounds streaming payloads and requires JSON', async () => {
  assert.deepEqual(await readReadinessBody(new Request(input.origin, { method: 'POST', body: JSON.stringify(signed), headers: { 'Content-Type': 'application/json' } })), signed);
  await assert.rejects(readReadinessBody(new Request(input.origin, { method: 'POST', body: 'x'.repeat(4097), headers: { 'Content-Type': 'application/json' } })));
  await assert.rejects(readReadinessBody(new Request(input.origin, { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } })));
});
