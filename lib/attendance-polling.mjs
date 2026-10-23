const INTERVAL = 30_000;
const MAX_RETRY = 300_000;

// One request at a time, and only while the teacher can see the page.
export function startAttendancePolling({ load, onData, onError, visibility = document }) {
  let stopped = false, loading = false, finished = false, failures = 0;
  let timer, controller;

  async function update() {
    if (stopped || loading || finished || visibility.hidden) return;
    loading = true;
    controller = new AbortController();
    try {
      const session = await load(controller.signal);
      if (stopped) return;
      failures = 0;
      finished = session.closed;
      onData(session);
    } catch (error) {
      if (stopped || controller.signal.aborted) return;
      failures++;
      finished = [401, 403, 404].includes(error.status);
      onError(error);
    } finally {
      loading = false;
      if (!stopped && !finished && !visibility.hidden) {
        timer = setTimeout(update, Math.min(INTERVAL * 2 ** Math.min(failures, 4), MAX_RETRY));
      }
    }
  }

  function visibilityChanged() {
    clearTimeout(timer);
    if (!visibility.hidden) update();
  }

  visibility.addEventListener("visibilitychange", visibilityChanged);
  update();
  return () => {
    stopped = true;
    clearTimeout(timer);
    controller?.abort();
    visibility.removeEventListener("visibilitychange", visibilityChanged);
  };
}
