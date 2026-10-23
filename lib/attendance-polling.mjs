import { dashboardRestrictionActive } from './dashboard-policy.mjs';

const INTERVAL = 30_000;
const MAX_RETRY = 300_000;
const newToken = () => crypto.randomUUID().replaceAll('-', '');

// A token lives only in this activation, never in shared or cloned browser storage.
export function startAttendancePolling({ load, onData, onError, release = async (_token) => {}, onPause = () => {}, visibility = document, page = globalThis.window }) {
  let stopped = false, loading = false, finished = false, failures = 0, generation = 0;
  let timer, expiryTimer, controller, pageHidden = false, token = newToken();
  let releaseQueue = Promise.resolve();
  const pendingReleases = new Set();
  const hidden = () => visibility.hidden || pageHidden;
  const relinquish = value => {
    releaseQueue = releaseQueue.then(() => release(value)).catch(() => {});
    return releaseQueue;
  };
  function clearTimers() {
    clearTimeout(timer);
    clearTimeout(expiryTimer);
  }
  function expire() {
    if (stopped || !dashboardRestrictionActive()) return;
    finished = true;
    clearTimers();
    controller?.abort();
    onPause();
    onError(Object.assign(new Error('The live dashboard connection expired. Try opening it again.'), { status: 423 }));
    relinquish(token);
  }
  async function update() {
    if (stopped || loading || finished || hidden()) return;
    loading = true;
    const requestGeneration = generation, requestToken = token;
    controller = new AbortController();
    const startedAt = performance.now();
    try {
      await releaseQueue;
      if (stopped || hidden()) return;
      const session = await load(controller.signal, requestToken);
      if (stopped || requestGeneration !== generation || hidden()) {
        pendingReleases.add(requestToken);
        return;
      }
      clearTimeout(expiryTimer);
      if (session.dashboardLeaseMs !== undefined && !session.closed) {
        // Subtract the full round-trip time and a safety margin; client clock
        // differences cannot extend the server's lease.
        const remaining = session.dashboardLeaseMs - (performance.now() - startedAt) - 1000;
        if (remaining <= 0) { expire(); return; }
        expiryTimer = setTimeout(expire, remaining);
      }
      failures = 0;
      finished = session.closed;
      onData(session);
    } catch (error) {
      if (stopped || requestGeneration !== generation || controller.signal.aborted) return;
      failures++;
      finished = [401, 403, 404, 423].includes(error.status);
      if (finished) pendingReleases.add(requestToken);
      onError(error);
    } finally {
      for (const value of pendingReleases) relinquish(value);
      pendingReleases.clear();
      await releaseQueue;
      loading = false;
      if (!stopped && !finished && !hidden()) {
        if (requestGeneration !== generation) update();
        else timer = setTimeout(update, Math.min(INTERVAL * 2 ** Math.min(failures, 4), MAX_RETRY));
      }
    }
  }
  function pause() {
    generation++;
    clearTimers();
    onPause();
    const previous = token;
    token = newToken();
    if (loading) pendingReleases.add(previous);
    else relinquish(previous);
  }
  function visibilityChanged() {
    if (hidden()) pause();
    else { clearTimeout(timer); update(); }
  }
  const pageHide = () => { pageHidden = true; pause(); };
  const pageShow = () => { pageHidden = false; visibilityChanged(); };
  visibility.addEventListener('visibilitychange', visibilityChanged);
  page?.addEventListener('pagehide', pageHide);
  page?.addEventListener('pageshow', pageShow);
  update();
  return () => {
    stopped = true;
    generation++;
    clearTimers();
    controller?.abort();
    relinquish(token);
    visibility.removeEventListener('visibilitychange', visibilityChanged);
    page?.removeEventListener('pagehide', pageHide);
    page?.removeEventListener('pageshow', pageShow);
  };
}
