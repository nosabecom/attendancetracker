import test from 'node:test';
import assert from 'node:assert/strict';
import { armBlobOwnerPressCapture as arm } from '../scripts/blob-owner-ui-press-capture.mjs';

const secret = 'vercel_blob_rw_raW6bHbRonffwrRf_SyntheticSentinel123456789';
function fixture(options = {}) {
  let shown = false, downloads = 0, payload, listener, next = 0, time = 1000;
  const timers = new Map(), observers = new Set();
  const changed = () => { for (const fn of [...observers]) fn(); };
  const block = { get textContent() { return `BLOB_READ_WRITE_TOKEN="${shown ? options.token ?? secret : '********'}"`; } };
  const button = textContent => ({ textContent, disabled: false, getClientRects: () => [1], click() {}, closest() { return this; } });
  const show = button('Show secret'), hide = button('Hide secret');
  const env = {
    Date: { now: () => time },
    location: { origin: 'https://vercel.com', pathname: '/nomokaro625-9385s-projects/~/stores/blob/store_raW6bHbRonffwrRf/guides' },
    document: {
      documentElement: {}, body: { append() {} },
      querySelectorAll(kind) { return kind === 'pre' ? options.duplicate ? [block, block] : [block] : shown ? [hide] : [show]; },
      addEventListener(_, fn) { listener = fn; }, removeEventListener() { listener = undefined; },
      createElement() { return { style: {}, remove() {}, click() { assert.equal(shown, false); downloads++; if (options.downloadFailure) throw Error(secret); } }; },
    },
    MutationObserver: class { constructor(fn) { this.fn = fn; } observe() { observers.add(this.fn); } disconnect() { observers.delete(this.fn); } },
    Blob: class { constructor(parts) { payload = parts.join(''); } },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    setTimeout(fn, ms) { const id = ++next; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
  };
  return { env, show, hide, press(target, trusted = true) { listener?.({ target, isTrusted: trusted }); },
    render(value) { shown = value; changed(); }, expire() { for (const t of [...timers.values()]) if (t.ms === 30000) t.fn(); },
    advance(ms) { time += ms; },
    counts: () => ({ downloads, payload }), controller: () => env.__attendanceOwnerPressCapture };
}

test('trusted Show then Hide, with remasking before the sole download', async () => {
  const f = fixture(); assert.deepEqual(arm(f.env), { status: 'awaiting_reveal', code: 'ok' });
  f.show.click(); assert.equal(f.controller().status().status, 'awaiting_reveal');
  const ready = f.controller().waitForTokenReady();
  f.press(f.show); assert.equal(f.controller().status().status, 'revealing');
  f.render(true); assert.equal((await ready).status, 'token_ready'); assert.equal(f.controller().status().status, 'token_ready');
  const finished = f.controller().finish();
  f.press(f.hide); assert.equal(f.controller().status().status, 'awaiting_mask');
  assert.equal(f.counts().downloads, 0); f.render(false);
  const result = await finished;
  assert.deepEqual(result, { status: 'download_requested', code: 'ok', secretRemasked: true });
  assert.deepEqual(f.counts(), { downloads: 1, payload: `BLOB_READ_WRITE_TOKEN='${secret}'\n` });
  assert.equal(arm(f.env).code, 'already_started');
  assert.ok(!JSON.stringify(result).includes(secret));
});

test('untrusted or out-of-order events and DOM changes cannot trigger export', () => {
  for (const run of [f => f.render(true), f => f.press(f.show, false), f => f.press(f.hide), f => { f.press(f.show); f.press(f.show); }, f => { f.press(f.show); f.render(true); f.render(false); }]) {
    const f = fixture(); arm(f.env); run(f);
    assert.equal(f.controller().status().status, 'failed'); assert.equal(f.counts().downloads, 0);
  }
});

test('wrong page, ambiguous snippet, and wrong token fail safely', () => {
  const wrong = fixture(); wrong.env.location.pathname = '/wrong'; assert.equal(arm(wrong.env).code, 'wrong_page');
  const duplicate = fixture({ duplicate: true }); assert.equal(arm(duplicate.env).code, 'unexpected_ui');
  const f = fixture({ token: 'vercel_blob_rw_otherstore_SyntheticSentinel123456789' }); arm(f.env); f.press(f.show); f.render(true);
  assert.equal(f.controller().status().code, 'invalid_credential'); assert.equal(f.counts().downloads, 0);
  const moved = fixture(); arm(moved.env); moved.env.location.pathname = '/wrong'; assert.equal(moved.controller().status().code, 'wrong_page');
});

test('timeout, abort, and arbitrary download errors expose only fixed records', async () => {
  const f = fixture(); arm(f.env); const pending = f.controller().waitForTokenReady(); f.press(f.show); f.expire(); assert.equal((await pending).code, 'timeout'); assert.equal(f.controller().status().code, 'timeout');
  const aborted = fixture(); arm(aborted.env); assert.equal(aborted.controller().abort().code, 'aborted'); aborted.render(true); assert.equal(aborted.counts().downloads, 0);
  const failed = fixture({ downloadFailure: true }); arm(failed.env); failed.press(failed.show); failed.render(true); failed.press(failed.hide); failed.render(false);
  const result = await failed.controller().finish(); assert.equal(result.code, 'download_failed'); assert.ok(!JSON.stringify(result).includes(secret));
});

test('exported function is self-contained when serialized', () => {
  const copy = (0, eval)(`(${arm.toString()})`); const f = fixture();
  assert.equal(copy(f.env).status, 'awaiting_reveal'); f.controller().abort();
});
test('late timer delivery cannot permit a press or download at the deadline', async () => {
  const show = fixture(); arm(show.env); show.advance(30000); show.press(show.show);
  assert.equal(show.controller().status().code, 'timeout');
  const hide = fixture(); arm(hide.env); hide.press(hide.show); hide.render(true);
  hide.advance(30000); hide.press(hide.hide); hide.render(false);
  assert.equal((await hide.controller().finish()).code, 'timeout');
  assert.equal(hide.counts().downloads, 0);
  const render = fixture(); arm(render.env); render.press(render.show); render.render(true);
  render.press(render.hide); render.advance(30000); render.render(false);
  assert.equal((await render.controller().finish()).code, 'timeout');
  assert.equal(render.counts().downloads, 0);
});
