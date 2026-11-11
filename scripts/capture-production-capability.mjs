// Offline browser helper: arm before the separately authorized ordinary UI action.
// It neither creates/reveals a key nor reads the system clipboard or makes requests.
export function armProductionCapabilityCapture(env = globalThis) {
  const key = '__attendanceProductionCapabilityCapture', doc = env.document;
  const now = () => (env.Date ?? Date).now(), deadline = now() + 120000;
  let state = 'armed', code = 'ok', capability, clipboard, original, hooked = false, timer, anchor;
  const terminal = () => state === 'failed' || state === 'download_requested';
  const record = () => ({ status: state, code });
  const page = () => env.location?.origin === 'https://dashboard.convex.dev' &&
    env.location.pathname === '/t/nomokaro625-9385-s-projects/convex-cyan-garden/tremendous-elk-298/settings';
  const removeListener = () => doc?.removeEventListener('click', onClick, true);
  const cleanup = () => {
    capability = undefined;
    env.clearTimeout(timer);
    if (hooked) {
      try { if (original) Object.defineProperty(clipboard, 'writeText', original); else delete clipboard.writeText; } catch {}
      hooked = false;
    }
    // Keep the anchor guard during synchronous dispatch, even if abort reenters.
    if (!anchor) removeListener();
  };
  const fail = reason => { if (!terminal()) { state = 'failed'; code = reason; cleanup(); } };
  const guard = () => {
    if (terminal()) return false;
    if (now() >= deadline) fail('timeout');
    else if (!page()) fail('wrong_page');
    return !terminal();
  };
  const valid = raw => {
    if (typeof raw !== 'string' || raw.length < 20 || raw.length > 16384 || !/^[\x21-\x7e]+$/.test(raw) ||
      /^https?:/i.test(raw) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(raw)) return false;
    try { JSON.parse(raw); return false; } catch { return true; }
  };
  const revoke = url => { try { env.URL.revokeObjectURL(url); } catch {} };
  function onClick(event) {
    if (event.target !== anchor || !anchor) return;
    if (!guard() || state !== 'capturing') event.preventDefault();
  }
  const capture = raw => {
    if (!guard() || state !== 'armed') return record();
    if (!valid(raw)) { fail('invalid_capability'); return record(); }
    state = 'capturing'; capability = raw;
    let url;
    try {
      const blob = new env.Blob([capability], { type: 'text/plain' });
      if (!guard()) return record();
      url = env.URL.createObjectURL(blob);
      if (!guard()) return record();
      anchor = doc.createElement('a'); anchor.href = url;
      anchor.download = 'attendance-production-capability.txt'; anchor.style.display = 'none';
      doc.body.append(anchor);
      if (!guard()) return record();
      anchor.click();
      // A failure during dispatch or a late clock must stay terminal.
      if (!guard()) return record();
      state = 'download_requested'; code = 'ok'; cleanup();
      try { env.setTimeout(() => revoke(url), 5000); } catch { revoke(url); }
    } catch { fail('download_failed'); }
    finally {
      if (url && state !== 'download_requested') revoke(url);
      try { anchor?.remove(); } catch {}
      anchor = undefined;
      if (terminal()) removeListener();
    }
    return record();
  };
  const visible = element => {
    if (!element.getClientRects?.().length) return false;
    for (let node = element; node; node = node.parentElement) {
      if (node.hidden || node.getAttribute?.('aria-hidden') === 'true') return false;
      const style = env.getComputedStyle?.(node);
      if (style && (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0')) return false;
    }
    return true;
  };
  const fallback = () => {
    if (!guard() || state !== 'armed') return record();
    try {
      const dialogs = [...doc.querySelectorAll('[role="dialog"]')].filter(node =>
        visible(node) && /\bdeploy(?:ment)?\s*key\b/i.test(node.textContent));
      if (dialogs.length !== 1) { fail('unexpected_dialog'); return record(); }
      const candidates = [];
      for (const node of dialogs[0].querySelectorAll('input, textarea, pre, code')) {
        if (!visible(node)) continue;
        const tag = node.tagName.toLowerCase(), field = tag === 'input' || tag === 'textarea';
        if (field && (!node.readOnly || (tag === 'input' && (node.type || 'text').toLowerCase() !== 'text'))) continue;
        const value = field ? node.value : node.textContent.trim();
        if (!valid(value)) continue;
        if (!field && candidates.some(item => !item.field && item.value === value &&
          (item.node.contains(node) || node.contains(item.node)))) continue;
        candidates.push({ node, value, field });
      }
      if (candidates.length !== 1) { fail('ambiguous_capability'); return record(); }
      return capture(candidates[0].value);
    } catch { fail('unexpected_dialog'); return record(); }
  };
  if (Object.prototype.hasOwnProperty.call(env, key)) return { status: 'failed', code: 'already_started' };
  const controller = Object.freeze({
    status() { guard(); return record(); },
    abort() { fail('aborted'); return record(); },
    captureVisibleKeyInDialog: fallback,
  });
  try { Object.defineProperty(env, key, { value: controller, configurable: false, writable: false }); }
  catch { return { status: 'failed', code: 'unavailable_controller' }; }
  if (!guard()) return record();
  try {
    doc.addEventListener('click', onClick, true);
    timer = env.setTimeout(() => fail('timeout'), 120000);
    clipboard = env.navigator?.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') code = 'clipboard_unavailable';
    else {
      original = Object.getOwnPropertyDescriptor(clipboard, 'writeText');
      const intercepted = raw => Promise.resolve(capture(raw));
      const replacement = original && !original.configurable ? { ...original, value: intercepted } :
        { value: intercepted, configurable: true, writable: true, enumerable: original?.enumerable ?? false };
      try { Object.defineProperty(clipboard, 'writeText', replacement); hooked = true; }
      catch { code = 'clipboard_unavailable'; }
    }
  } catch { fail('unexpected_ui'); }
  return record();
}
