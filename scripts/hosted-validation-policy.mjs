// Shared guardrails for the disposable-preview setup and rehearsal.
import { parseEnv } from 'node:util';
import { readPrivateJson } from './import-blob.mjs';

export const quotaReviewPath = '.convex/hosted-validation/team-quota-review.json';
export const plannedHeadroom = Object.freeze({
  functionCalls: 1000, databaseIoGb: 0.025, databaseStorageGb: 0.005,
});

export async function readQuotaReview(now = Date.now()) {
  const review = await readPrivateJson(quotaReviewPath);
  const observed = Date.parse(review.observedAt);
  if (review.team !== 'nomokaro625-9385-s-projects' || review.plan !== 'CONVEX_BASE' ||
      review.source !== 'convex-dashboard-user-report' || !Number.isFinite(observed) ||
      now - observed > 86400000 || observed - now > 300000)
    throw new Error('Current team quota review required.');
  for (const [metric, allocation] of Object.entries(plannedHeadroom)) {
    const value = review.resources?.[metric];
    if (!value || !Number.isFinite(value.used) || !Number.isFinite(value.limit) ||
        value.used < 0 || value.limit <= 0 || value.used > value.limit ||
        value.limit - value.used < allocation ||
        (metric === 'functionCalls' && (!Number.isSafeInteger(value.used) || !Number.isSafeInteger(value.limit))))
      throw new Error('Insufficient reviewed team allowance.');
  }
  return { ...review, plannedHeadroom };
}

export function publicationEnvironment(url, adminKey) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.username || target.password || target.port ||
      target.pathname !== '/' || target.search || target.hash || !target.hostname.endsWith('.convex.cloud') ||
      typeof adminKey !== 'string' || !adminKey.length || adminKey.length > 16384 || /['\u0000-\u001f\u007f]/.test(adminKey))
    throw new Error('Invalid private publication target.');
  // Single-quoted dotenv values preserve opaque credential bytes. Reject the
  // delimiter instead of interpreting or shell-escaping credential contents.
  const body = "CONVEX_SELF_HOSTED_URL='" + url + "'\nCONVEX_SELF_HOSTED_ADMIN_KEY='" + adminKey + "'\n";
  const decoded = parseEnv(body);
  if (Object.keys(decoded).length !== 2 || decoded.CONVEX_SELF_HOSTED_URL !== url ||
      decoded.CONVEX_SELF_HOSTED_ADMIN_KEY !== adminKey)
    throw new Error('Publication environment did not round-trip.');
  return body;
}
