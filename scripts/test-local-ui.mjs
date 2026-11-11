// Opt-in integration test. Creates only bounded synthetic data in a local deployment.
import { readFile, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';

const root = new URL('..', import.meta.url).pathname;
const envText = await readFile(join(root, '.env.local'), 'utf8');
const envValue = key => envText.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim().replace(/^['"]|['"]$/g, '');
const config = JSON.parse(await readFile(join(root, '.convex/local/default/config.json'), 'utf8'));
for (const [key, port] of [['NEXT_PUBLIC_CONVEX_URL', config.ports.cloud], ['NEXT_PUBLIC_CONVEX_SITE_URL', config.ports.site]]) {
  const value = new URL(envValue(key));
  if (!['localhost', '127.0.0.1'].includes(value.hostname) || value.protocol !== 'http:' || Number(value.port) !== port || value.pathname !== '/' || value.search || value.hash) throw new Error('Local backend configuration required.');
}
const port = await new Promise((resolve, reject) => {
  const socket = createServer(); socket.on('error', reject);
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); });
});
const base = `http://localhost:${port}`;
const convexHost = new URL(envValue('NEXT_PUBLIC_CONVEX_URL')).host;
const isConvexSocket = value => { const url = new URL(value); return url.host === convexHost && /^\/api\/.*sync(?:\/|$)/.test(url.pathname); };
const suffix = randomBytes(6).toString('hex');
const username = `ui-${suffix}`, second = `ui-alt-${suffix}`, password = `synthetic-pass-${suffix}`;
let server, browser, phase = 'server startup', failures = 0;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function visible(locator) { await locator.waitFor({ state: 'visible', timeout: 30000 }); }
async function login(page, user, signup = false) {
  phase = 'auth form'; if (signup) await page.getByRole('button', { name: 'Create account', exact: true }).first().click();
  await page.getByLabel('Username').fill(user); await page.getByLabel('Password').fill(password);
  phase = 'auth submission'; await page.locator('form').getByRole('button', { name: signup ? 'Create my workspace' : 'Sign in' }).click();
  phase = 'auth result'; try { await visible(page.getByRole('button', { name: 'New class', exact: true }).first()); } catch (error) { const alerts = await page.getByRole('alert').allTextContents(); const known = ['Sign-in is temporarily unavailable.', 'Incorrect username or password.', 'That username is unavailable. Sign in or choose another.', 'Too many attempts. Please try again later.', 'Something went wrong. Please try again.']; const token = (await page.context().cookies()).find(c => c.name.endsWith('__convexAuthJWT'))?.value; console.error('Auth cookie present:', !!token); if (token) { const remaining = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sessionExpiresAt - Date.now(); console.error(remaining >= 29 * 86400000 ? 'Session lifetime: default range.' : 'LIMITATION: session lifetime is shorter than the default.'); const http = new ConvexHttpClient(envValue('NEXT_PUBLIC_CONVEX_URL'), { logger: false }); http.setAuth(token); try { await http.query(makeFunctionReference('attendance:viewer'), {}); console.error('Authenticated HTTP viewer: accepted'); } catch { console.error('Authenticated HTTP viewer: rejected'); } } console.error('Auth result:', known.find(message => alerts.some(a => a.includes(message))) || 'workspace did not appear', await page.evaluate(() => ({ opening: document.body.textContent.includes('Opening Rollcall'), reconnecting: document.body.textContent.includes('Reconnecting'), boundary: document.body.textContent.includes('Your session or access may have changed'), authForm: !!document.querySelector('#username'), socketCount: window.__test?.sockets.length, socketStates: window.__test?.sockets.map(s => s.readyState) })));  throw error; }
}
async function cookieClaims(context) {
  const cookie = (await context.cookies(base)).find(c => c.name.endsWith('__convexAuthJWT'));
  assert(cookie, 'Missing session cookie.');
  return JSON.parse(Buffer.from(cookie.value.split('.')[1], 'base64url').toString());
}
async function noDownload(page, action) {
  let count = 0; const handler = () => count++; page.on('download', handler);
  await action(); await wait(500); page.off('download', handler);
  return count;
}
async function blockedDelayedExport(page, change, { allowReload = false } = {}) {
  const attempt = randomBytes(8).toString('hex');
  let downloads = 0;
  let stage = 'start';
  const onDownload = () => downloads++;
  const before = await page.evaluate(() => window.__test.madeBlob);
  const documentEpoch = await page.evaluate(() => window.__test.documentEpoch);
  const responsesBefore = await page.evaluate(() => window.__test.exportResponseCount || 0);
  page.on('download', onDownload);
  try {
    await page.evaluate(id => {
      window.__test.delayedExport = undefined;
      window.__test.activeExportAttempt = id;
      window.__test.holdExport = id;
    }, attempt);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.waitForFunction(id => window.__test.activeExportAttempt === id &&
      window.__test.delayedExport?.attempt === id && window.__test.delayedExport.ready,
    attempt, { timeout: 15000 });
    stage = 'snapshot held';
    assert(await page.evaluate(({ id, before }) => window.__test.delayedExport?.attempt === id &&
      window.__test.delayedExport.networkSuccess && window.__test.exportResponseCount === before + 1,
    { id: attempt, before: responsesBefore }), 'Held export did not receive its own real successful snapshot.');
    await change();
    stage = 'lifecycle changed';
    if (await page.evaluate(epoch => window.__test.documentEpoch !== epoch, documentEpoch)) {
      // A forced SDK refresh can reconnect and trigger the product's deliberate
      // reload. The original fetch already completed before ready=true; document
      // destruction cancels its held JS continuation. It cannot be released in
      // the new document. Keep the cross-navigation download observer attached.
      assert(allowReload, 'Unexpected navigation during held response.');
      await wait(500);
      assert(downloads === 0 && await page.evaluate(() => window.__test.madeBlob === 0), 'Unexpected download after export document cancellation.');
      return 'document-cancelled';
    }
    await page.evaluate(id => {
      const job = window.__test.delayedExport;
      if (window.__test.activeExportAttempt !== id || job?.attempt !== id || !job.ready || job.settled || job.released)
        throw new Error('Export response attempt mismatch.');
      job.release();
    }, attempt);
    await page.waitForFunction(id => window.__test.activeExportAttempt === id &&
      window.__test.delayedExport?.attempt === id && window.__test.delayedExport.settled,
    attempt, { timeout: 15000 });
    stage = 'response consumed';
    // Observe through the SDK's response consumption and continuation, then the
    // browser download event. A fixed wait before releasing the response cannot
    // establish this lifecycle race.
    await wait(500);
    assert(downloads === 0 && await page.evaluate(value => window.__test.madeBlob === value, before), 'Unexpected download after delayed response.');
    return 'response-consumed';
  } catch (error) {
    console.error('Delayed export diagnostics:', { stage, downloads, ...(await page.evaluate(({ value, id }) => ({
      held: !!window.__test.delayedExport,
      attemptMatches: window.__test.delayedExport?.attempt === id,
      settled: !!window.__test.delayedExport?.settled,
      newBlobs: window.__test.madeBlob - value,
    }), { value: before, id: attempt }).catch(() => ({ pageUnavailable: true }))) });
    throw error;
  } finally {
    await page.evaluate(id => {
      if (window.__test.activeExportAttempt !== id) return;
      window.__test.holdExport = null;
      window.__test.activeExportAttempt = null;
      if (window.__test.delayedExport?.attempt === id) window.__test.delayedExport.release?.();
    }, attempt).catch(() => {});
    page.off('download', onDownload);
  }
}
try {
  server = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', 'localhost', '--port', String(port)], { cwd: root, env: { ...process.env, NEXT_PUBLIC_ATTENDANCE_BACKEND: 'convex', NEXT_PUBLIC_CONVEX_URL: envValue('NEXT_PUBLIC_CONVEX_URL'), NEXT_PUBLIC_CONVEX_SITE_URL: envValue('NEXT_PUBLIC_CONVEX_SITE_URL'), ATTENDANCE_GATEWAY_KEY: envValue('ATTENDANCE_GATEWAY_KEY'), ATTENDANCE_GATEWAY_AUDIENCE: envValue('ATTENDANCE_GATEWAY_AUDIENCE') }, stdio: 'ignore' });
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error('Next server exited.');
    try { if ((await fetch(base)).ok) break; } catch {}
    if (i === 119) throw new Error('Next server did not start.'); await wait(500);
  }
  let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (!executablePath) {
    const cache = join(homedir(), '.cache/ms-playwright');
    const versions = (await readdir(cache)).filter(x => /^chromium-\d+$/.test(x)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const version of versions) {
      const candidate = join(cache, version, 'chrome-linux64/chrome');
      try { await import('node:fs/promises').then(fs => fs.access(candidate)); executablePath = candidate; break; } catch {}
    }
  }
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext({ acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  // Wrap the real SDK close callback: click in the same task after it updates its
  // state, before React can commit. No product module or SDK state is replaced.
  await context.addInitScript(({ convexHost }) => {
    const Native = window.WebSocket;
    window.__test = { sockets: [], staleClicked: false, madeBlob: 0, now: 0, hidden: false, documentEpoch: crypto.randomUUID() };
    const realNow = Date.now; Date.now = () => window.__test.now || realNow();
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url || String(input), location.href);
      let path;
      try { path = JSON.parse(init?.body || '{}').path; } catch {}
      const attempt = window.__test.holdExport;
      if (typeof attempt !== 'string' || window.__test.activeExportAttempt !== attempt || url.host !== convexHost || url.pathname !== '/api/query' || path !== 'attendance:exportSnapshot')
        return nativeFetch(input, init);
      window.__test.holdExport = null;
      const response = await nativeFetch(input, init);
      const bytes = await response.arrayBuffer();
      if (window.__test.activeExportAttempt !== attempt) throw new DOMException('Stale test export attempt.', 'AbortError');
      const job = { attempt, ready: false, settled: false, released: false, networkSuccess: response.ok && JSON.parse(new TextDecoder().decode(bytes)).status === 'success' };
      window.__test.exportResponseCount = (window.__test.exportResponseCount || 0) + 1;
      window.__test.delayedExport = job;
      await new Promise(resolve => { job.release = () => { job.released = true; resolve(); }; job.ready = true; });
      // Deliver the real completed snapshot even if its signal was aborted while
      // held. This deliberately exercises post-response guards beyond transport
      // cancellation; no response value or application state is fabricated.
      const held = new Response(bytes, { status: response.status, headers: response.headers });
      const json = held.json.bind(held);
      held.json = async () => {
        try { return await json(); }
        finally { setTimeout(() => { job.settled = true; }, 0); }
      };
      return held;
    };
    const create = URL.createObjectURL.bind(URL); URL.createObjectURL = blob => { window.__test.madeBlob++; return create(blob); };
    const hidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, get() { return window.__test.hidden || hidden.get.call(document); } });
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(...args);
        const url = new URL(args[0], location.href);
        if (url.host !== convexHost || !/^\/api\/.*sync(?:\/|$)/.test(url.pathname)) return;
        window.__test.sockets.push(this);
        this.addEventListener('message', event => { try {
          const message = JSON.parse(String(event.data));
          if (message.type === 'Transition' && Number.isSafeInteger(message.endVersion?.identity))
            this.__testIdentityVersion = message.endVersion.identity;
        } catch {} });
        const descriptor = Object.getOwnPropertyDescriptor(Native.prototype, 'onclose');
        Object.defineProperty(this, 'onclose', { configurable: true, get() { return descriptor.get.call(this); }, set(handler) {
          descriptor.set.call(this, handler && function(event) {
            handler.call(this, event);
            if (window.__test.clickOnClose) {
              const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Export');
              window.__test.closeDiagnostics = { socketCount: window.__test.sockets.length, openSockets: window.__test.sockets.filter(s => s.readyState === Native.OPEN).length, online: navigator.onLine, hidden: document.hidden };
              window.__test.staleClicked = !!button; button?.click(); window.__test.clickOnClose = false;
            }
          });
        } });
      }
    };
  }, { convexHost });
  const page = await context.newPage(); let blockSockets = false; page.on('response', async response => { if (new URL(response.url()).pathname === '/api/convex-auth') { const body = await response.json().catch(() => ({})); console.log('Auth gateway HTTP status:', response.status(), ['Invalid origin.', 'Invalid client address.', 'Request not allowed.'].includes(body.error) ? body.error : ''); } });
  let refreshRequests = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/convex-auth') { try { const body = request.postDataJSON(); if (body.action === 'auth:signIn' && body.args?.refreshToken === 'dummy') refreshRequests++; } catch {} } });
  await page.routeWebSocket('**/*', ws => { if (blockSockets && isConvexSocket(ws.url())) ws.close(); else ws.connectToServer(); });
  await page.goto(base); phase = 'signup'; await login(page, username, true);
  const claims = await cookieClaims(context), remaining = claims.sessionExpiresAt - Date.now();
  assert(Number.isSafeInteger(claims.sessionExpiresAt) && remaining > 0, 'Invalid session deadline.');
  if (remaining < 29 * 86400000) console.log('LIMITATION: synthetic account has a shortened session deadline; this is not the default lifetime.');
  else console.log('PASS: synthetic account has the default session lifetime.');
  phase = 'class creation and CSV roster import';
  await page.getByRole('button', { name: 'New class', exact: true }).first().click();
  await page.getByLabel('Class name').fill(`Synthetic class ${suffix}`);
  await page.locator('#roster-file').setInputFiles({ name: 'synthetic.csv', mimeType: 'text/csv', buffer: Buffer.from('name,student_id\nSynthetic Alpha,UI001\nSynthetic Beta,UI002\n') });
  await page.getByRole('button', { name: 'Create class & start attendance' }).click();
  await visible(page.getByText('Synthetic Alpha')); await visible(page.getByRole('button', { name: 'Export' }));
  console.log('PASS: class creation and CSV roster import.');
  phase = 'public link'; await page.bringToFront();
  await page.getByRole('button', { name: 'Copy check-in link' }).click();
  const joinUrl = await page.evaluate(() => navigator.clipboard.readText());
  assert(new URL(joinUrl).origin === base && /^[a-f0-9]{32}$/.test(new URL(joinUrl).searchParams.get('join') || ''), 'Invalid public link.');
  const studentContext = await browser.newContext(); const student = await studentContext.newPage(); let studentSockets = 0;
  student.on('websocket', socket => { if (isConvexSocket(socket.url())) studentSockets++; });
  phase = 'public student check-in';
  await student.goto(joinUrl); await student.getByLabel('Full name or student ID').fill('UI001');
  await student.getByRole('button', { name: 'Check me in' }).click(); await visible(student.getByText('You’re all set.'));
  assert(studentSockets === 0, 'Public check-in opened a WebSocket.');
  console.log('PASS: public check-in without a Convex WebSocket.');
  phase = 'live attendance'; await page.bringToFront();
  await visible(page.getByRole('row').filter({ hasText: 'Synthetic Alpha' }).getByText('Present'));
  console.log('PASS: live attendance.');
  phase = 'CSV export';
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise; const csv = await readFile(await download.path(), 'utf8');
  assert(csv.includes('Synthetic Alpha') && csv.includes('Present') && csv.includes('Synthetic Beta') && csv.includes('Absent'), 'CSV contents incorrect.');
  console.log('PASS: CSV export.');
  phase = 'synchronous transport guard'; blockSockets = true;
  const blobsBeforeClose = await page.evaluate(() => window.__test.madeBlob);
  const closeDownloads = await noDownload(page, async () => { await page.evaluate(() => { window.__test.clickOnClose = true; window.__test.sockets.findLast(s => s.readyState === WebSocket.OPEN).close(); }); await page.waitForFunction(() => window.__test.staleClicked); });
  const closeResult = await page.evaluate(before => ({ ...window.__test.closeDiagnostics, clicked: window.__test.staleClicked, newBlobs: window.__test.madeBlob - before }), blobsBeforeClose);
  if (closeDownloads || closeResult.newBlobs) { failures++; console.error('FAIL: synchronous transport guard allowed export.', { downloads: closeDownloads, ...closeResult }); }
  assert(closeResult.online && !closeResult.hidden && closeResult.clicked && closeResult.openSockets === 0, 'Stale-handler transport guard did not run under expected conditions.');
  await visible(page.getByText('Reconnecting…')); assert(await page.getByText('Synthetic Alpha').count() === 0, 'Private roster remained visible while disconnected.');
  await student.bringToFront(); await student.reload(); await student.getByLabel('Full name or student ID').fill('UI002'); await student.getByRole('button', { name: 'Check me in' }).click(); await visible(student.getByText('You’re all set.'));
  await page.bringToFront(); blockSockets = false; await visible(page.getByRole('row').filter({ hasText: 'Synthetic Beta' }).getByText('Present'));
  console.log('PASS: disconnect hides private content and reconnect loads new attendance.');
  if (!closeDownloads && !closeResult.newBlobs) console.log('PASS: online transport disconnect blocks stale export.');
  phase = 'expiry guard';
  const blobCount = await page.evaluate(() => window.__test.madeBlob);
  const expiryDownloads = await noDownload(page, async () => { await page.evaluate(deadline => { window.__test.now = deadline + 1; const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Export'); window.__test.expiryClicked = !!button; button?.click(); window.__test.now = 0; }, claims.sessionExpiresAt); });
  assert(await page.evaluate(() => window.__test.expiryClicked), 'Expiry export control was not clicked.');
  assert(expiryDownloads === 0, 'Unexpected download.');
  assert(await page.evaluate(before => window.__test.madeBlob === before, blobCount), 'Expired export created a blob.');
  console.log('PASS: synthetic clock past deadline blocks export before expiry timer runs.');
  phase = 'expiry during export response';
  try {
    await blockedDelayedExport(page, () => page.evaluate(deadline => { window.__test.now = deadline + 1; }, claims.sessionExpiresAt));
  } finally { await page.evaluate(() => { window.__test.now = 0; }); }
  console.log('PASS: expiry after the snapshot response arrives blocks its delayed download.');
  assert(await page.evaluate(() => window.__test.delayedExport?.ready && window.__test.delayedExport.settled),
    'Missing previous settled-response regression control.');
  phase = 'visibility during export response';
  await blockedDelayedExport(page, async () => {
    await page.evaluate(() => { window.__test.hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
    await visible(page.getByText('Opening Rollcall…'));
    assert(await page.getByText('Synthetic Alpha').count() === 0, 'Private roster remained visible while hidden.');
  });
  console.log('PASS: hiding during a delayed snapshot response blocks download after unmount.');
  console.log('PASS: previous settled export cannot satisfy the next response attempt.');
  const nav = page.waitForEvent('framenavigated', { predicate: f => f === page.mainFrame() });
  const refreshBeforeResume = refreshRequests;
  await page.evaluate(() => { window.__test.hidden = false; document.dispatchEvent(new Event('visibilitychange')); }); await nav;
  await visible(page.getByText('Synthetic Alpha')); console.log('PASS: synthetic visibility release hides content and resume reloads.');
  console.log('Auth refresh requests during visibility resume:', refreshRequests - refreshBeforeResume);
  phase = 'managed browser token refresh';
  const refreshExportDisposition = await blockedDelayedExport(page, async () => {
  await wait(1100); // Ensure a newly issued managed JWT has a later issued-at second.
  const oldJwt = (await context.cookies(base)).find(c => c.name.endsWith('__convexAuthJWT'))?.value;
  const refreshBeforeControl = refreshRequests;
  const refreshResponse = page.waitForResponse(response => {
    if (new URL(response.url()).pathname !== '/api/convex-auth') return false;
    try { const body = response.request().postDataJSON(); return body.action === 'auth:signIn' && body.args?.refreshToken === 'dummy'; } catch { return false; }
  }, { timeout: 15000 });
  // Synthetic rejection triggers the REAL maintained browser provider's refresh
  // path, Next cookie gateway, backend rotation and socket reauthentication.
  // It does not claim to reproduce wall-clock scheduling or clock skew.
  await page.evaluate(() => {
    const socket = window.__test.sockets.findLast(s => s.readyState === WebSocket.OPEN);
    if (!socket || !Number.isSafeInteger(socket.__testIdentityVersion)) throw new Error('Missing authenticated socket.');
    socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'AuthError',
      baseVersion: Math.max(0, socket.__testIdentityVersion - 1), authUpdateAttempted: false,
      error: 'Synthetic browser refresh gate' }) }));
  });
  assert((await refreshResponse).status() === 200, 'Browser refresh failed.');
  await visible(page.getByText('Synthetic Alpha'));
  const newJwt = (await context.cookies(base)).find(c => c.name.endsWith('__convexAuthJWT'))?.value;
  const renewed = await cookieClaims(context);
  assert(newJwt && newJwt !== oldJwt && renewed.sub === claims.sub && renewed.sessionExpiresAt === claims.sessionExpiresAt,
    'Browser refresh did not preserve the fixed session.');
  assert(refreshRequests - refreshBeforeControl === 1, 'Browser refresh made unexpected repeated requests.');
  console.log('PASS: synthetic token rejection causes one real browser refresh, fixed deadline and authorized recovery.');
  }, { allowReload: true });
  console.log(refreshExportDisposition === 'document-cancelled'
    ? 'PASS: token refresh reload cancels the held export without a download.'
    : 'PASS: token replacement while an export response is held blocks its delayed download.');
  phase = 'offline revocation: ready socket';
  await page.bringToFront();
  await page.waitForFunction(() => window.__test.sockets.some(s => s.readyState === WebSocket.OPEN));
  blockSockets = true;
  const savedCookies = await context.cookies(base);
  phase = 'offline revocation: disconnect';
  await page.evaluate(() => window.__test.sockets.findLast(s => s.readyState === WebSocket.OPEN).close()); await visible(page.getByText('Reconnecting…'));
  phase = 'offline revocation: control page';
  const control = await browser.newContext(); await control.addCookies(savedCookies); const controlPage = await control.newPage(); await controlPage.goto(base);
  const reconnected = page.waitForEvent('framenavigated', { predicate: f => f === page.mainFrame(), timeout: 30000 });
  phase = 'offline revocation: server signout';
  const logoutStatus = await controlPage.evaluate(async () => (await fetch('/api/convex-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'auth:signOut' }) })).status);
  console.log('Offline control logout HTTP status:', logoutStatus);
  assert(logoutStatus === 200, 'Server revocation failed.');
  phase = 'offline revocation: reconnect';
  blockSockets = false; await page.bringToFront(); await reconnected;
  phase = 'offline revocation: no private content';
  await page.waitForFunction(() => !document.body.textContent.includes('Synthetic Alpha'), null, { timeout: 30000 });
  await wait(6000); assert(await page.getByText('Synthetic Alpha').count() === 0, 'Revoked content returned after reconnect.');
  phase = 'offline revocation: sign-in form';
  await page.reload(); await visible(page.getByLabel('Username')); console.log('PASS: offline revocation prevents old private content on reconnect and reload.');
  phase = 'account switch and logout'; await login(page, second, true); assert(await page.getByText('Synthetic Alpha').count() === 0, 'Previous account content appeared.');
  const beforeLogout = await context.cookies(base); const logoutResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/convex-auth' && response.request().postDataJSON()?.action === 'auth:signOut'); await page.getByRole('button', { name: 'Sign out' }).click(); assert((await logoutResponse).status() === 200, 'Logout HTTP was not confirmed.'); await visible(page.getByLabel('Username'));
  assert(!(await context.cookies(base)).some(c => c.name.endsWith('__convexAuthJWT') || c.name.endsWith('__convexAuthRefreshToken')), 'Logout cookies remain.');
  const replay = await browser.newContext(); await replay.addCookies(beforeLogout); const replayPage = await replay.newPage(); await replayPage.goto(base); await visible(replayPage.getByLabel('Username'));
  await login(page, username); await visible(page.getByText('Synthetic Alpha')); console.log('PASS: logout clears cookies, revokes replay and permits account switching.');
  phase = 'selection during export response';
  const previousSession = await page.getByLabel('Attendance history').inputValue();
  await page.getByRole('button', { name: 'Take attendance again' }).click();
  await page.waitForFunction(value => {
    const select = document.querySelector('#session-history');
    return select && /^[a-f0-9]{32}$/.test(select.value) && select.value !== value && select.options.length === 2;
  }, previousSession);
  const nextSession = await page.getByLabel('Attendance history').inputValue();
  assert(nextSession !== previousSession, 'Second attendance session was not created.');
  await page.getByLabel('Attendance history').selectOption(previousSession);
  await visible(page.getByRole('row').filter({ hasText: 'Synthetic Alpha' }).getByText('Present'));
  await blockedDelayedExport(page, async () => {
    await page.getByLabel('Attendance history').selectOption(nextSession);
    try {
      await visible(page.getByRole('row').filter({ hasText: 'Synthetic Alpha' }).getByText('Waiting', { exact: true }));
    } catch (error) {
      console.error('Selection control diagnostics:', {
        selectedExpectedSession: await page.getByLabel('Attendance history').inputValue().then(value => value === nextSession).catch(() => false),
        waitingRows: await page.getByRole('row').filter({ hasText: 'Synthetic Alpha' }).getByText('Waiting', { exact: true }).count(),
        presentRows: await page.getByRole('row').filter({ hasText: 'Synthetic Alpha' }).getByText('Present', { exact: true }).count(),
      });
      throw error;
    }
  });
  console.log('PASS: changing session while an export response is held blocks its delayed download.');
  if (failures) process.exitCode = 1;
  await studentContext.close(); await control.close(); await replay.close(); await context.close();
} catch (error) {
  // Do not print browser/SDK errors, URLs, cookies, requests, or response payloads.
  console.error(`FAIL: ${phase}. ${error.message?.startsWith('Unexpected download') ? 'Unexpected download.' : 'See the documented test phase; raw error details suppressed.'}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await Promise.race([new Promise(resolve => server.once('exit', resolve)), wait(5000)]); if (server.exitCode === null) server.kill('SIGKILL'); }
}
