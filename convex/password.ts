'use node';
import { internalAction } from './_generated/server';
import { makeFunctionReference } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { randomBytes } from 'node:crypto';
import { legacyPasswordHash, verifyLegacyPassword } from '../lib/legacy-password.mjs';
import { verifyGatewayRequest } from '../lib/gateway-proof.mjs';
const ref = (name: string) => makeFunctionReference<any>(`authSupport:${name}`) as any;
export const authenticateNode = internalAction({ args: { operation: v.string(), username: v.string(), password: v.string(), proof: v.any() }, handler: async (ctx, a): Promise<any> => {
  if (!['login', 'signup'].includes(a.operation) || !/^[a-z0-9._-]{3,40}$/.test(a.username) || a.password.length < 10 || a.password.length > 128) return null;
  const payload = { username: a.username, password: a.password };
  if (!await verifyGatewayRequest(a.operation, payload, a.proof, { secret: process.env.ATTENDANCE_GATEWAY_KEY, audience: process.env.ATTENDANCE_GATEWAY_AUDIENCE })) return null;
  if (!await ctx.runMutation(ref('reserve'), { nonce: a.proof.nonce, issuedAt: a.proof.issuedAt, ipHash: a.proof.ipHash, username: a.username, operation: a.operation })) throw new ConvexError({ status: 429, message: 'Too many attempts.' });
  const account = await ctx.runQuery(ref('credential'), { username: a.username });
  let userId;
  if (a.operation === 'login') {
    if (!await verifyLegacyPassword(a.password, account)) return null;
    userId = account.userId;
  } else {
    const salt = randomBytes(16).toString('hex');
    const passwordHash = await legacyPasswordHash(a.password, salt);
    if (account) throw new ConvexError({ status: 409, message: 'Username unavailable.' });
    userId = await ctx.runMutation(ref('createUser'), { username: a.username, salt, passwordHash, ownerKey: randomBytes(32).toString('hex') });
  }
  const sessionId = await ctx.runMutation(ref('createSession'), { userId });
  return { userId, sessionId };
} });
