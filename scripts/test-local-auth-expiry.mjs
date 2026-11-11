import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { ConvexClient, ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { signGatewayRequest } from '../lib/gateway-proof.mjs';

const url = new URL(process.env.NEXT_PUBLIC_CONVEX_URL || '');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Local backend required.');
const fn = name => makeFunctionReference(name), wait = ms => new Promise(r => setTimeout(r, ms));
const isAuthRejection = error => error?.data?.status === 401 || /(?:unauthenticated|invalid authentication|expired (?:auth|token)|token (?:is |has )?expired|authentication failed)/i.test(String(error?.message ?? ''));
const suffix = randomBytes(6).toString('hex'), password = 'synthetic expiry test password';
let live, control, unsubscribe, unsubscribeControl, sessionId, userId, admin;
let phase = 'initialization';
try {
  const config = JSON.parse(await readFile(new URL('../.convex/local/default/config.json', import.meta.url), 'utf8'));
  if (Number(url.port) !== config.ports.cloud) throw new Error('Local config mismatch.');
  admin = new ConvexHttpClient(url.origin, { logger: false }); admin.setAdminAuth(config.adminKey);
  const http = new ConvexHttpClient(url.origin, { logger: false });
  const signInHttp = new ConvexHttpClient(url.origin, { logger: false });
  async function sign(operation, username) {
    const payload = { username, password };
    const proof = await signGatewayRequest(operation, payload, { secret: process.env.ATTENDANCE_GATEWAY_KEY, audience: process.env.ATTENDANCE_GATEWAY_AUDIENCE, ipHash: 'b'.repeat(64) });
    return (await signInHttp.action(fn('auth:signIn'), { provider: 'credentials', params: { operation, ...payload, proof } })).tokens;
  }
  phase = 'sign-up';
  const tokens = await sign('signup', `expiry-${suffix}`);
  const teacherName = `control-${suffix}`;
  const teacherInitial = await sign('signup', teacherName);
  const logoutTokens = await sign('signup', `logout-${suffix}`);
  const claims = JSON.parse(Buffer.from(tokens.token.split('.')[1], 'base64url').toString());
  if (claims.sessionExpiresAt - Date.now() > 75000 || claims.sessionExpiresAt - Date.now() < 64000) throw new Error('Configure 72000ms local session.');
  [userId, sessionId] = claims.sub.split('|');
  const teacherSessionId = teacherInitial.refreshToken.split('|')[1];
  phase = 'cross-session-refresh';
  const mismatched = `${tokens.refreshToken.split('|')[0]}|${teacherSessionId}`;
  let mismatchRejected = false;
  try { const result = await admin.action(fn('auth:signIn'), { refreshToken: mismatched }); mismatchRejected = result?.tokens === null; }
  catch (error) { mismatchRejected = isAuthRejection(error); if (!mismatchRejected) console.error(`Mixed refresh returned unexpected error status ${Number.isInteger(error?.data?.status) ? error.data.status : 'unavailable'}.`); }
  const ownerExists = (await admin.query(fn('localTest:sessionState'), { sessionId })).exists;
  const teacherExists = (await admin.query(fn('localTest:sessionState'), { sessionId: teacherSessionId })).exists;
  if (!mismatchRejected || !ownerExists || !teacherExists) { console.error(`Mixed refresh rejected=${mismatchRejected}, owner session exists=${ownerExists}, teacher session exists=${teacherExists}.`); throw new Error('Cross-session refresh changed authority.'); }
  phase = 'valid-control-refresh';
  const validRefresh = await admin.action(fn('auth:signIn'), { refreshToken: teacherInitial.refreshToken });
  if (!validRefresh?.tokens?.token) throw new Error('Valid control refresh failed.');
  http.setAuth(tokens.token);
  const legacyId = randomBytes(16).toString('hex');
  const { classId } = await http.mutation(fn('attendance:create'), { newId: legacyId, title: 'Synthetic expiry fixture', csv: 'name,id\nExpiry Student,EXPIRY1' });
  await http.mutation(fn('attendance:share'), { classId, username: teacherName });
  phase = 'delay-cleanup';
  if ((await admin.mutation(fn('localTest:delayExpiryCleanup'), { sessionId })).cancelled !== 1) throw new Error('Cleanup not isolated.');
  let firstAuth = false, leaked = false, socket, serverAuthRejection = false;
  class FixedTokenSocket extends WebSocket {
    constructor(...args) {
      super(...args); socket = this;
      this.addEventListener('message', event => {
        const message = String(event.data);
        if (Date.now() >= claims.sessionExpiresAt && message.includes('checkedInAt')) leaked = true;
        if (/AuthError/.test(message) && /(?:expired|invalid|unauthenticated)/i.test(message)) serverAuthRejection = true;
      });
    }
    send(data) {
      const message = JSON.parse(data);
      // Suppress every subsequent authentication and voluntary deauthentication.
      if (message.type === 'Authenticate') {
        if (firstAuth || message.tokenType !== 'User') return;
        firstAuth = true;
      }
      super.send(data);
    }
  }
  live = new ConvexClient(url.origin, { webSocketConstructor: FixedTokenSocket, logger: false });
  live.setAuth(async () => tokens.token);
  phase = 'initial-subscription';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Subscription timeout')), 5000);
    unsubscribe = live.onUpdate(fn('attendance:bucket'), { legacyId, bucket: 0 }, data => { if (Array.isArray(data)) { clearTimeout(timer); resolve(); } }, reject);
  });
  console.log('Initial subscription established; cleanup delayed.');
  phase = 'near-deadline-refresh';
  await wait(Math.max(0, claims.sessionExpiresAt - Date.now() - 8000));
  let refreshRejected = false;
  try { const result = await admin.action(fn('auth:signIn'), { refreshToken: tokens.refreshToken }); console.error(`Refresh returned ${result?.tokens === null ? 'null tokens' : 'a non-null result'} instead of rejecting.`); } catch (error) { refreshRejected = isAuthRejection(error); if (!refreshRejected) console.error(`Refresh returned unrecognized rejection (status ${Number.isInteger(error?.data?.status) ? error.data.status : 'unavailable'}).`); }
  if (!refreshRejected) throw new Error('Expected specific refresh auth rejection.');
  phase = 'near-deadline-capability-logout';
  const logoutSessionId = logoutTokens.refreshToken.split('|')[1];
  const logoutProof = await signGatewayRequest('logout', { refreshToken: logoutTokens.refreshToken }, {
    secret: process.env.ATTENDANCE_GATEWAY_KEY, audience: process.env.ATTENDANCE_GATEWAY_AUDIENCE, ipHash: 'b'.repeat(64),
  });
  try { await admin.action(fn('auth:signOut'), { refreshToken: logoutTokens.refreshToken, proof: logoutProof }); }
  catch (error) { console.error(`Capability logout failed with status ${Number.isInteger(error?.data?.status) ? error.data.status : 'unavailable'}.`); throw error; }
  const logoutExists = (await admin.query(fn('localTest:sessionState'), { sessionId: logoutSessionId })).exists;
  const ownerStillExists = (await admin.query(fn('localTest:sessionState'), { sessionId })).exists;
  if (logoutExists || !ownerStillExists) { console.error(`Logout session exists=${logoutExists}, owner session exists=${ownerStillExists}.`); throw new Error('Capability logout did not isolate revocation.'); }
  // A new teacher login gives the control a fresh session and JWT after the owner expires.
  await wait(Math.max(0, claims.sessionExpiresAt - Date.now() - 2500));
  phase = 'control-login';
  const teacherTokens = await sign('login', teacherName);
  control = new ConvexClient(url.origin, { logger: false }); control.setAuth(async () => teacherTokens.token);
  let controlUpdate = false, controlError;
  phase = 'control-subscription';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Control subscription timeout')), 5000);
    unsubscribeControl = control.onUpdate(fn('attendance:bucket'), { legacyId, bucket: 0 }, data => {
      if (data.some(row => row.checkedInAt)) controlUpdate = true;
      if (Array.isArray(data)) { clearTimeout(timer); resolve(); }
    }, error => { controlError = error; reject(error); });
  });
  phase = 'post-expiry';
  await wait(Math.max(0, claims.sessionExpiresAt - Date.now() + 300));
  if (!(await admin.query(fn('localTest:sessionState'), { sessionId })).exists) throw new Error('Cleanup was not delayed.');
  let queryRejected = false;
  try { await http.query(fn('attendance:bucket'), { legacyId, bucket: 0 }); } catch (error) { queryRejected = isAuthRejection(error); }
  if (!queryRejected) throw new Error('Expected specific query auth rejection.');
  await admin.mutation(fn('attendance:publicCheckin'), { legacyId, identity: 'EXPIRY1' });
  for (let i = 0; i < 30 && !controlUpdate && !controlError; i++) await wait(200);
  await wait(3000);
  if (!controlUpdate) throw new Error('Control did not receive update.');
  if (leaked) throw new Error('Expired subscription received private update.');
  if (socket?.readyState !== WebSocket.OPEN && !serverAuthRejection) throw new Error('Expired socket disconnected without specific server auth rejection.');
  console.log(JSON.stringify({ crossSessionRefreshRejectedWithoutRevocation: true, validControlRefresh: true, refreshRejectedNearDeadline: true, nearDeadlineCapabilityLogout: true, expiredJwtQueryRejected: true, cleanupDelayed: true, controlReceivedUpdate: true, expiredSocketOpen: socket?.readyState === WebSocket.OPEN, serverAuthRejection, expiredSubscriptionReceivedPrivateUpdate: false, observationMs: 3000 }));
} catch {
  console.error(`Local expiry test failed (${phase}); details withheld.`); process.exitCode = 1;
} finally {
  unsubscribe?.(); unsubscribeControl?.(); await live?.close(); await control?.close();
  if (admin && sessionId && userId) { try { await admin.mutation(fn('authSupport:revokeSession'), { userId, sessionId }); } catch { console.error('Synthetic session cleanup failed.'); process.exitCode = 1; } }
}
