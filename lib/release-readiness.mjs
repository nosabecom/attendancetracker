// Node-only, read-only release verification. Never import into a client or Convex.
import { createHmac, timingSafeEqual } from 'node:crypto';

const fields = ['version', 'release', 'origin', 'audience', 'cloudUrl', 'siteUrl', 'issuedAt', 'nonce'];
const hex = /^[a-f0-9]{64}$/;
const fail = () => { throw Error('Release verification failed.'); };
function context(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).length !== fields.length + 1 ||
      !fields.every(key => Object.hasOwn(value, key)) || !Object.hasOwn(value, 'signature') ||
      value.version !== 1 || !/^[a-f0-9]{40}$/.test(value.release ?? '') ||
      !/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(value.origin ?? '') ||
      typeof value.audience !== 'string' || !value.audience || value.audience.length > 256 ||
      !/^https:\/\/[a-z0-9-]+\.convex\.cloud$/.test(value.cloudUrl ?? '') ||
      value.siteUrl !== value.cloudUrl.replace('.convex.cloud', '.convex.site') ||
      !Number.isSafeInteger(value.issuedAt) || !/^[a-f0-9]{64}$/.test(value.nonce ?? '') ||
      !hex.test(value.signature ?? '')) fail();
  return fields.map(key => value[key]);
}
function mac(domain, values, secret) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32 || Buffer.byteLength(secret) > 16384) fail();
  return createHmac('sha256', secret).update(JSON.stringify([domain, ...values])).digest('hex');
}
function equal(actual, expected) {
  return typeof actual === 'string' && hex.test(actual) &&
    timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
export function signReadinessRequest(value, secret) {
  const unsigned = { ...value, signature: '0'.repeat(64) };
  return { ...value, signature: mac('attendance-release/request/v1', context(unsigned), secret) };
}
export function verifyReleaseReadiness(value, { env, compiled, origin, now = Date.now() }) {
  const values = context(value);
  if (value.issuedAt > now + 5000 || now - value.issuedAt > 30000 ||
      !equal(value.signature, mac('attendance-release/request/v1', values, env.ATTENDANCE_GATEWAY_KEY))) fail();
  if (value.origin !== origin || env.VERCEL_URL !== new URL(origin).hostname ||
      value.audience !== env.ATTENDANCE_GATEWAY_AUDIENCE ||
      compiled.backend !== 'convex' || compiled.cloudUrl !== value.cloudUrl ||
      compiled.siteUrl !== value.siteUrl || compiled.release !== value.release ||
      env.NEXT_PUBLIC_ATTENDANCE_BACKEND !== 'convex' ||
      env.NEXT_PUBLIC_CONVEX_URL !== value.cloudUrl || env.NEXT_PUBLIC_CONVEX_SITE_URL !== value.siteUrl ||
      env.NEXT_PUBLIC_ATTENDANCE_RELEASE !== value.release ||
      env.CONVEX_DEPLOY_KEY !== '' || env.BLOB_READ_WRITE_TOKEN !== '') fail();
  return { version: 1, ready: true,
    signature: mac('attendance-release/response/v1', [...values, 'ready'], env.ATTENDANCE_GATEWAY_KEY) };
}
export function verifyReadinessResponse(response, request, secret) {
  return !!response && Object.keys(response).length === 3 && response.version === 1 && response.ready === true &&
    equal(response.signature, mac('attendance-release/response/v1', [...context(request), 'ready'], secret));
}

export async function readReadinessBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) fail();
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 4096)) fail();
  const reader = request.body?.getReader();
  if (!reader) fail();
  let timer, chunks = [], bytes = 0;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Release verification failed.')), 3000); });
  try {
    while (true) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 4096) fail();
      chunks.push(Buffer.from(part.value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
