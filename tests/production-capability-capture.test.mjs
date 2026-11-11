import test from 'node:test';
import assert from 'node:assert/strict';
import { armProductionCapabilityCapture as arm } from '../scripts/capture-production-capability.mjs';

const secret = 'OpaqueSyntheticCapability|0123456789:sentinel';
const controllerKey = '__attendanceProductionCapabilityCapture';
const recoveryKey = '__attendanceProductionCapabilityRecovery';
function element(tag = 'pre', value = secret, options = {}) {
  let valueReads = 0;
  const node = {
    tagName: tag.toUpperCase(), textContent: value, parentElement: options.parent,
    hidden: options.hidden ?? false, readOnly: options.readOnly ?? true,
    type: options.type ?? 'text', style: options.style,
    getClientRects: () => options.rects === false ? [] : [1],
    getAttribute: name => name === 'aria-hidden' ? options.ariaHidden : null,
    contains(other) { for (let p = other; p; p = p.parentElement) if (p === this) return true; return false; },
    reads: () => valueReads,
  };
  Object.defineProperty(node, 'value', { get() { valueReads++; if (options.denyRead) throw Error(secret); return value; } });
  return node;
}
function dialog(nodes, options = {}) {
  const node = element('div', options.context ?? 'Create Deploy Key', options);
  node.querySelectorAll = () => nodes;
  for (const child of nodes) if (!child.parentElement) child.parentElement = node;
  return node;
}
function fixture(options = {}) {
  let time = 1000, next = 0, downloads = 0, payload, filename, originalCalls = 0, scans = 0, legacyCopies = 0;
  const timers = new Map(), listeners = new Set(), revoked = [];
  const originalMethod = () => { originalCalls++; return Promise.resolve(); };
  const clipboard = options.inherited ? Object.create({ writeText: originalMethod }) : {};
  if (!options.inherited && !options.unsupported) Object.defineProperty(clipboard, 'writeText',
    options.descriptor ?? { value: originalMethod, configurable: true, enumerable: true, writable: true });
  clipboard.readText = () => { throw Error('System clipboard reads are forbidden'); };
  const before = Object.getOwnPropertyDescriptor(clipboard, 'writeText');
  const env = {
    Date: { now: () => time }, navigator: { clipboard },
    location: { origin: 'https://dashboard.convex.dev', pathname: '/t/nomokaro625-9385-s-projects/convex-cyan-garden/tremendous-elk-298/settings' },
    document: {
      body: { append() {} },
      querySelectorAll(selector) { assert.equal(selector, '[role="dialog"]'); scans++; return options.dialogs ?? []; },
      addEventListener(type, fn) { assert.equal(type, 'click'); listeners.add(fn); },
      removeEventListener(type, fn) { assert.equal(type, 'click'); listeners.delete(fn); },
      execCommand() { legacyCopies++; return true; },
      createElement(tag) {
        assert.equal(tag, 'a');
        return { style: {}, remove() {}, click() {
          filename = this.download;
          time += options.dispatchAdvance ?? 0;
          if (options.abortOnDispatch) env[options.abortControllerKey ?? controllerKey].abort();
          let prevented = false;
          for (const fn of [...listeners]) fn({ target: this, preventDefault() { prevented = true; } });
          if (!prevented) downloads++;
          time += options.afterDispatchAdvance ?? 0;
          if (options.downloadError) throw Error(secret);
        } };
      },
    },
    getComputedStyle: node => node.style ?? {},
    Blob: class { constructor(parts) { if (options.blobError) throw Error(secret); payload = parts.join(''); } },
    URL: { createObjectURL: () => 'blob:synthetic-private-download', revokeObjectURL: url => revoked.push(url) },
    setTimeout(fn, ms) { const id = ++next; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  return {
    env, clipboard, before, originalMethod, controller: () => env[controllerKey],
    advance(ms) { time += ms; }, expire() { for (const t of [...timers.values()]) if (t.ms === 120000) t.fn(); },
    counts: () => ({ downloads, payload, filename, originalCalls, scans, legacyCopies, listeners: listeners.size }), revoked,
  };
}

test('ordinary copied opaque capability goes only to one raw private download', async () => {
  const f = fixture();
  assert.deepEqual(arm(f.env), { status: 'armed', code: 'ok' });
  const intercepted = f.clipboard.writeText;
  const result = await intercepted(secret);
  assert.deepEqual(result, { status: 'download_requested', code: 'ok' });
  assert.equal(f.counts().payload, secret);
  assert.equal(f.counts().filename, 'attendance-production-capability.txt');
  assert.equal(f.counts().downloads, 1);
  assert.equal(f.counts().originalCalls, 0);
  assert.equal(f.counts().listeners, 0);
  assert.deepEqual(Object.getOwnPropertyDescriptor(f.clipboard, 'writeText'), f.before);
  assert.deepEqual(await intercepted('AnotherOpaqueCapability|123456789'), result);
  assert.deepEqual(f.controller().captureVisibleKeyInDialog(), result);
  assert.equal(f.counts().scans, 0);
  assert.equal(f.counts().downloads, 1);
  assert.ok(!JSON.stringify([result, f.controller(), f.controller().status()]).includes(secret));
  assert.equal(Object.getOwnPropertyDescriptor(f.env, controllerKey).writable, false);
  assert.deepEqual(arm(f.env), { status: 'failed', code: 'already_started' });
});

test('validation accepts opaque formats and bounds without a product prefix', async () => {
  for (const raw of ['x'.repeat(20), 'x'.repeat(16384), secret, 'other-name:01234567890123456789|opaque']) {
    const f = fixture(); arm(f.env);
    assert.equal((await f.clipboard.writeText(raw)).status, 'download_requested');
    assert.equal(f.counts().payload, raw);
    assert.equal(f.counts().originalCalls, 0);
  }
});

test('unrelated, malformed, URL, environment and JSON copies fail closed', async () => {
  const invalid = [undefined, {}, 'x'.repeat(19), 'x'.repeat(16385), `${secret}\n`, `${secret}\t`, `${secret}\0`,
    `${secret}é`, `https://example.test/${secret}`, `HTTP:example.test/${secret}`,
    `CONVEX_DEPLOY_KEY=${secret}`, `OTHER_SECRET='${secret}'`, JSON.stringify(secret), JSON.stringify({ key: secret }),
    JSON.stringify([secret]), '123456789012345678901234567890'];
  for (const raw of invalid) {
    const f = fixture(); arm(f.env); const intercepted = f.clipboard.writeText;
    const result = await intercepted(raw);
    assert.deepEqual(result, { status: 'failed', code: 'invalid_capability' });
    assert.equal(f.counts().downloads, 0);
    assert.equal(f.counts().payload, undefined);
    assert.equal(f.counts().originalCalls, 0);
    assert.deepEqual(Object.getOwnPropertyDescriptor(f.clipboard, 'writeText'), f.before);
    assert.deepEqual(await intercepted(secret), result);
    assert.ok(!JSON.stringify(result).includes(secret));
  }
});

test('own, inherited, writable nonconfigurable and accessor descriptors are restored', async () => {
  const accessorMethod = () => { throw Error('Original clipboard method must not run'); };
  for (const options of [
    { inherited: true },
    { descriptor: { value: accessorMethod, configurable: false, writable: true, enumerable: false } },
    { descriptor: { get: () => accessorMethod, configurable: true, enumerable: false } },
  ]) {
    const f = fixture(options); arm(f.env);
    await f.clipboard.writeText(secret);
    assert.deepEqual(Object.getOwnPropertyDescriptor(f.clipboard, 'writeText'), f.before);
    if (options.inherited) assert.equal(f.clipboard.writeText, f.originalMethod);
    assert.equal(f.counts().originalCalls, 0);
  }
});

test('wrong page, synchronous deadline, timer and abort are terminal without copying', async () => {
  for (const modify of [
    f => { f.env.location.origin = 'https://convex.dev'; },
    f => { f.env.location.pathname += '/'; },
    f => f.advance(120000), f => f.expire(), f => f.controller().abort(),
  ]) {
    const f = fixture(); arm(f.env); const intercepted = f.clipboard.writeText;
    modify(f); const result = await intercepted(secret);
    assert.equal(result.status, 'failed');
    assert.equal(f.counts().downloads, 0);
    assert.equal(f.counts().originalCalls, 0);
    assert.deepEqual(Object.getOwnPropertyDescriptor(f.clipboard, 'writeText'), f.before);
    assert.deepEqual(f.controller().captureVisibleKeyInDialog(), result);
    assert.equal(f.counts().scans, 0);
  }
  const wrong = fixture(); wrong.env.location.pathname = '/wrong';
  assert.deepEqual(arm(wrong.env), { status: 'failed', code: 'wrong_page' });
  assert.equal(wrong.clipboard.writeText, wrong.originalMethod);
});

test('unsupported clipboard and ordinary legacy copy permit one explicit local fallback', () => {
  for (const options of [{ unsupported: true }, {}, { descriptor: { value() {}, configurable: false, writable: false } }]) {
    const node = element('input'); const f = fixture({ ...options, dialogs: [dialog([node])] });
    const armed = arm(f.env);
    assert.equal(armed.code, Object.keys(options).length ? 'clipboard_unavailable' : 'ok');
    assert.equal(f.counts().scans, 0);
    f.env.document.execCommand('copy');
    assert.deepEqual(f.controller().captureVisibleKeyInDialog(), { status: 'download_requested', code: 'ok' });
    assert.equal(f.counts().payload, secret);
    assert.equal(f.counts().downloads, 1);
    assert.equal(f.counts().legacyCopies, 1);
    assert.equal(f.counts().originalCalls, 0);
    const reads = node.reads(); const scans = f.counts().scans;
    f.controller().captureVisibleKeyInDialog();
    assert.equal(node.reads(), reads);
    assert.equal(f.counts().scans, scans);
    assert.equal(f.counts().downloads, 1);
    assert.deepEqual(Object.getOwnPropertyDescriptor(f.clipboard, 'writeText'), f.before);
  }
});

test('fallback allows visible readonly textarea and identical nested pre/code only once', () => {
  const parent = element('pre'), child = element('code', secret, { parent });
  for (const nodes of [[element('textarea')], [parent, child], [element('code')]]) {
    const f = fixture({ dialogs: [dialog(nodes)] }); arm(f.env);
    assert.equal(f.controller().captureVisibleKeyInDialog().status, 'download_requested');
    assert.equal(f.counts().downloads, 1);
    assert.equal(f.counts().payload, secret);
  }
});

test('fallback never reads password, hidden or editable fields or scans outside its dialog', () => {
  for (const options of [
    { type: 'password' }, { type: 'hidden' }, { hidden: true }, { rects: false },
    { ariaHidden: 'true' }, { readOnly: false }, { style: { visibility: 'hidden' } }, { style: { opacity: '0' } },
  ]) {
    const node = element('input', secret, { ...options, denyRead: true });
    const f = fixture({ dialogs: [dialog([node])] }); arm(f.env);
    assert.deepEqual(f.controller().captureVisibleKeyInDialog(), { status: 'failed', code: 'ambiguous_capability' });
    assert.equal(node.reads(), 0);
    assert.equal(f.counts().downloads, 0);
  }
  const hiddenParent = element('div', '', { hidden: true });
  const node = element('input', secret, { parent: hiddenParent, denyRead: true });
  const f = fixture({ dialogs: [dialog([node])] }); arm(f.env); f.controller().captureVisibleKeyInDialog();
  assert.equal(node.reads(), 0);
});

test('missing, hidden, foreign or ambiguous dialogs and candidate values fail closed', () => {
  const cases = [[], [dialog([element()], { hidden: true })], [dialog([element()], { context: 'Other setting' })],
    [dialog([element()]), dialog([element()])],
    [dialog([element('input'), element('input')])],
    [dialog([element(), element('code', 'AnotherOpaqueCapability|123456789')])],
    [dialog([element('pre', `CONVEX_DEPLOY_KEY=${secret}`)])],
    [dialog([element('input', `https://example.test/${secret}`)])]];
  for (const dialogs of cases) {
    const f = fixture({ dialogs }); arm(f.env);
    const result = f.controller().captureVisibleKeyInDialog();
    assert.equal(result.status, 'failed');
    assert.equal(f.counts().downloads, 0);
    const scans = f.counts().scans;
    assert.deepEqual(f.controller().captureVisibleKeyInDialog(), result);
    assert.equal(f.counts().scans, scans);
    assert.deepEqual(Object.getOwnPropertyDescriptor(f.clipboard, 'writeText'), f.before);
  }
});

test('anchor reentrant abort and late clock cannot overwrite a terminal failure', async () => {
  for (const [options, expectedCode, downloads] of [
    [{ abortOnDispatch: true }, 'aborted', 0],
    [{ dispatchAdvance: 120000 }, 'timeout', 0],
    [{ afterDispatchAdvance: 120000 }, 'timeout', 1],
  ]) {
    const f = fixture(options); arm(f.env); const intercepted = f.clipboard.writeText;
    const expected = { status: 'failed', code: expectedCode };
    assert.deepEqual(await intercepted(secret), expected);
    assert.deepEqual(f.controller().status(), expected);
    assert.deepEqual(f.controller().captureVisibleKeyInDialog(), expected);
    assert.deepEqual(await intercepted(secret), expected);
    assert.equal(f.counts().downloads, downloads);
    assert.equal(f.counts().originalCalls, 0);
    assert.equal(f.counts().scans, 0);
    assert.equal(f.counts().listeners, 0);
    assert.equal(f.revoked.length, 1);
  }
});

test('arbitrary host exceptions return fixed failure records and restore the hook', async () => {
  for (const options of [{ blobError: true }, { downloadError: true }]) {
    const f = fixture(options); arm(f.env);
    const result = await f.clipboard.writeText(secret);
    assert.deepEqual(result, { status: 'failed', code: 'download_failed' });
    assert.ok(!JSON.stringify(result).includes(secret));
    assert.equal(f.counts().originalCalls, 0);
    assert.deepEqual(Object.getOwnPropertyDescriptor(f.clipboard, 'writeText'), f.before);
  }
});

test('serialized browser function is self-contained and abort preserves its fixed record', () => {
  const copy = (0, eval)(`(${arm.toString()})`), f = fixture();
  assert.deepEqual(copy(f.env), { status: 'armed', code: 'ok' });
  assert.deepEqual(f.controller().abort(), { status: 'failed', code: 'aborted' });
  f.expire(); f.advance(120000);
  assert.deepEqual(f.controller().status(), { status: 'failed', code: 'aborted' });
  assert.equal(f.counts().downloads, 0);
});

test('separately allocated recovery preserves the timeout and captures the same visible key once', async () => {
  const f = fixture(); arm(f.env); f.advance(120001);
  const previous = f.controller(); assert.deepEqual(previous.status(), { status: 'failed', code: 'timeout' });
  assert.equal(f.counts().downloads, 0);
  assert.deepEqual(arm(f.env, 'existing-owner-ui-recovery'), { status: 'armed', code: 'ok' });
  const recovery = f.env[recoveryKey], intercepted = f.clipboard.writeText;
  assert.deepEqual(await intercepted(secret), { status: 'download_requested', code: 'ok' });
  assert.equal(f.counts().downloads, 1);
  assert.equal(f.counts().filename, 'attendance-production-capability-recovery.txt');
  assert.equal(f.counts().payload, secret); assert.equal(f.counts().originalCalls, 0);
  assert.strictEqual(f.controller(), previous);
  assert.deepEqual(previous.status(), { status: 'failed', code: 'timeout' });
  assert.deepEqual(arm(f.env, 'existing-owner-ui-recovery'), { status: 'failed', code: 'already_started' });
  assert.deepEqual(recovery.captureVisibleKeyInDialog(), { status: 'download_requested', code: 'ok' });
  assert.equal(f.counts().downloads, 1);
  assert.deepEqual(Object.getOwnPropertyDescriptor(f.clipboard, 'writeText'), f.before);
});

test('recovery rejects missing, active, aborted and successful predecessors or unknown modes', async () => {
  const missing = fixture();
  assert.deepEqual(arm(missing.env, 'existing-owner-ui-recovery'), { status: 'failed', code: 'recovery_not_eligible' });
  assert.deepEqual(arm(missing.env, 'other'), { status: 'failed', code: 'invalid_mode' });
  for (const outcome of ['active', 'aborted', 'success']) {
    const f = fixture(); arm(f.env);
    if (outcome === 'aborted') f.controller().abort();
    if (outcome === 'success') await f.clipboard.writeText(secret);
    assert.deepEqual(arm(f.env, 'existing-owner-ui-recovery'), { status: 'failed', code: 'recovery_not_eligible' });
    assert.equal(Object.hasOwn(f.env, recoveryKey), false);
  }
});

test('recovery remains self-contained, terminal on cancellation and deadline, with local-only fallback', async () => {
  const serialized = (0, eval)(`(${arm.toString()})`);
  for (const options of [{}, { unsupported: true }, { abortOnDispatch: true, abortControllerKey: recoveryKey }]) {
    const f = fixture({ ...options, dialogs: [dialog([element()])] }); serialized(f.env); f.advance(120001); f.controller().status();
    assert.deepEqual(serialized(f.env, 'existing-owner-ui-recovery'), { status: 'armed', code: options.unsupported ? 'clipboard_unavailable' : 'ok' });
    const controller = f.env[recoveryKey];
    if (options.unsupported) {
      assert.equal(controller.captureVisibleKeyInDialog().status, 'download_requested');
      assert.equal(f.counts().downloads, 1);
    } else if (options.abortOnDispatch) {
      assert.deepEqual(await f.clipboard.writeText(secret), { status: 'failed', code: 'aborted' });
      assert.equal(f.counts().downloads, 0);
    } else {
      f.advance(120001); assert.deepEqual(controller.status(), { status: 'failed', code: 'timeout' });
      assert.equal(controller.captureVisibleKeyInDialog().status, 'failed');
      assert.equal(f.counts().downloads, 0);
    }
    assert.deepEqual(f.controller().status(), { status: 'failed', code: 'timeout' });
    assert.equal(f.counts().legacyCopies, 0); assert.equal(f.counts().originalCalls, 0);
  }
});
