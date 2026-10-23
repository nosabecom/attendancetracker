import test from 'node:test';
import assert from 'node:assert/strict';
import { startAttendancePolling } from '../lib/attendance-polling.mjs';

const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
class Visibility extends EventTarget {
  hidden = false;
  change(hidden) {
    this.hidden = hidden;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}
function setup(t, load) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const visibility = new Visibility(), data = [], errors = [];
  const stop = startAttendancePolling({ load, visibility, onData: s => data.push(s), onError: e => errors.push(e) });
  t.after(stop);
  return { visibility, data, errors, stop };
}

test('polls visible open sessions every 30 seconds, pauses hidden tabs and refreshes on return', async t => {
  let requests = 0;
  const { visibility } = setup(t, async () => { requests++; return { closed: false }; });
  await settle();
  assert.equal(requests, 1);
  t.mock.timers.tick(29_999); await settle(); assert.equal(requests, 1);
  t.mock.timers.tick(1); await settle(); assert.equal(requests, 2);
  visibility.change(true);
  t.mock.timers.tick(3_600_000); await settle(); assert.equal(requests, 2);
  visibility.change(false); await settle(); assert.equal(requests, 3);
});

test('does not overlap slow requests and aborts on cleanup without applying stale data', async t => {
  let requests = 0, resolve, signal;
  const { visibility, data, stop } = setup(t, s => {
    requests++; signal = s;
    return new Promise(r => { resolve = r; });
  });
  await settle();
  t.mock.timers.tick(120_000);
  visibility.change(true); visibility.change(false);
  assert.equal(requests, 1);
  stop(); assert.equal(signal.aborted, true);
  resolve({ closed: false }); await settle();
  t.mock.timers.tick(120_000); await settle();
  assert.equal(requests, 1); assert.deepEqual(data, []);
});

test('stops after a closed session or a terminal authorization/not-found response', async t => {
  for (const status of [undefined, 401, 403, 404, 423]) {
    let requests = 0;
    const { visibility, stop } = setup(t, async () => {
      requests++;
      if (status) throw Object.assign(new Error('Unavailable'), { status });
      return { closed: true };
    });
    await settle();
    t.mock.timers.tick(3_600_000);
    visibility.change(true); visibility.change(false); await settle();
    assert.equal(requests, 1);
    stop(); t.mock.timers.reset();
  }
});

test('backs off transient errors up to five minutes and resets after success', async t => {
  let requests = 0, failing = true;
  setup(t, async () => {
    requests++;
    if (failing) throw new Error('Temporary failure');
    return { closed: false };
  });
  await settle();
  for (const delay of [60_000, 120_000, 240_000, 300_000]) {
    const before = requests;
    t.mock.timers.tick(delay - 1); await settle(); assert.equal(requests, before);
    t.mock.timers.tick(1); await settle(); assert.equal(requests, before + 1);
  }
  failing = false;
  t.mock.timers.tick(300_000); await settle();
  const before = requests;
  t.mock.timers.tick(30_000); await settle(); assert.equal(requests, before + 1);
});

test('a page opened in the background waits until it becomes visible', async t => {
  const visibility = new Visibility(); visibility.hidden = true;
  let requests = 0;
  const stop = startAttendancePolling({ visibility, load: async () => { requests++; return { closed: true }; }, onData() {}, onError() {} });
  t.after(stop);
  await settle(); assert.equal(requests, 0);
  visibility.change(false); await settle(); assert.equal(requests, 1);
});

test('hidden tabs clear their dashboard and release before resuming with a distinct token', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const visibility = new Visibility(), tokens = [], released = [];
  let pauses = 0, completeRelease;
  const stop = startAttendancePolling({
    visibility,
    load: async (_signal, token) => { tokens.push(token); return { closed: false }; },
    release: async token => { released.push(token); await new Promise(resolve => { completeRelease = resolve; }); },
    onData() {}, onError() {}, onPause() { pauses++; },
  });
  t.after(() => { completeRelease?.(); stop(); });
  await settle();
  visibility.change(true); await settle();
  assert.equal(pauses, 1); assert.deepEqual(released, [tokens[0]]);
  visibility.change(false); await settle();
  assert.equal(tokens.length, 1);
  completeRelease(); await settle();
  assert.equal(tokens.length, 2); assert.notEqual(tokens[0], tokens[1]);
});

test('a hidden in-flight response is discarded, released, and replaced on return', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const visibility = new Visibility(), tokens = [], released = [], data = [];
  let complete;
  const stop = startAttendancePolling({
    visibility,
    load: (_signal, token) => {
      tokens.push(token);
      return tokens.length === 1 ? new Promise(resolve => { complete = resolve; }) : Promise.resolve({ closed: false, fresh: true });
    },
    release: async token => { released.push(token); },
    onData: value => data.push(value), onError() {},
  });
  t.after(stop);
  await settle(); visibility.change(true); visibility.change(false);
  complete({ closed: false, stale: true }); await settle();
  assert.equal(data.length, 1); assert.equal(data[0].fresh, true);
  assert.deepEqual(released, [tokens[0]]); assert.notEqual(tokens[0], tokens[1]);
});

test('network failure cannot leave live data visible beyond the server lease', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-23T12:00:00Z') });
  let calls = 0, cleared = 0;
  const errors = [];
  const stop = startAttendancePolling({
    visibility: new Visibility(),
    load: async () => {
      calls++;
      if (calls > 1) throw new Error('Offline');
      return { closed: false, dashboardLeaseMs: 180_000 };
    },
    onData() {}, onPause() { cleared++; }, onError: error => errors.push(error),
  });
  t.after(stop);
  await settle();
  t.mock.timers.tick(30_000); await settle();
  t.mock.timers.tick(150_000); await settle();
  assert.equal(cleared, 1); assert.equal(errors.at(-1).status, 423);
  const before = calls;
  t.mock.timers.tick(600_000); await settle(); assert.equal(calls, before);
});

test('pagehide clears and releases, and pageshow can acquire a new lease', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = new EventTarget(), released = [];
  let calls = 0, pauses = 0;
  const stop = startAttendancePolling({
    page, visibility: new Visibility(),
    load: async () => { calls++; return { closed: false }; },
    release: async token => released.push(token), onData() {}, onError() {}, onPause() { pauses++; },
  });
  t.after(stop);
  await settle(); page.dispatchEvent(new Event('pagehide')); await settle();
  assert.equal(pauses, 1); assert.equal(released.length, 1);
  page.dispatchEvent(new Event('pageshow')); await settle(); assert.equal(calls, 2);
});
