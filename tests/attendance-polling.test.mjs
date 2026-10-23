import test from 'node:test';
import assert from 'node:assert/strict';
import { startAttendancePolling } from '../lib/attendance-polling.mjs';

const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
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
  t.mock.timers.tick(120_000);
  visibility.change(true); visibility.change(false);
  assert.equal(requests, 1);
  stop(); assert.equal(signal.aborted, true);
  resolve({ closed: false }); await settle();
  t.mock.timers.tick(120_000); await settle();
  assert.equal(requests, 1); assert.deepEqual(data, []);
});

test('stops after a closed session or a terminal authorization/not-found response', async t => {
  for (const status of [undefined, 401, 403, 404]) {
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
