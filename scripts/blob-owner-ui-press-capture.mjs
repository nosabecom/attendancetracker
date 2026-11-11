// Offline-prepared browser function. Call only after the separately authorized
// private-download preflight and one-attempt reservation. This function does
// not press either owner control; the operator supplies trusted browser clicks.
export function armBlobOwnerPressCapture(env = globalThis) {
  const key = '__attendanceOwnerPressCapture';
  const doc = env.document;
  const now = () => (env.Date ?? Date).now();
  const deadline = now() + 30000;
  let state = 'awaiting_reveal', code = 'ok', token, observer, timer, downloadAnchor;
  const waiters = new Set();
  const signal = () => { for (const wake of [...waiters]) wake(); };
  const page = () => env.location.origin === 'https://vercel.com' &&
    env.location.pathname === '/nomokaro625-9385s-projects/~/stores/blob/store_raW6bHbRonffwrRf/guides';
  const buttons = text => [...doc.querySelectorAll('button')].filter(b =>
    b.textContent.trim() === text && b.getClientRects().length && !b.disabled);
  const snippet = () => {
    const blocks = [...doc.querySelectorAll('pre')].filter(b => b.textContent.includes('BLOB_READ_WRITE_TOKEN='));
    if (blocks.length !== 1) throw 0;
    const text = blocks[0].textContent;
    if ((text.match(/BLOB_READ_WRITE_TOKEN\s*=/g) || []).length !== 1) throw 0;
    return text;
  };
  const masked = text => /BLOB_READ_WRITE_TOKEN\s*=\s*["']\*+["']/.test(text);
  const read = text => {
    const matches = [...text.matchAll(/BLOB_READ_WRITE_TOKEN\s*=\s*["'](vercel_blob_rw_raW6bHbRonffwrRf_[A-Za-z0-9]{16,256})["']/g)];
    if (matches.length !== 1 || (text.match(/vercel_blob_rw_/g) || []).length !== 1) throw 0;
    return matches[0][1];
  };
  const cleanup = () => { observer?.disconnect(); env.clearTimeout(timer); doc.removeEventListener('click', onClick, true); token = undefined; };
  const fail = reason => { if (state !== 'failed' && state !== 'download_requested') { state = 'failed'; code = reason; cleanup(); signal(); } };
  const record = () => ({ status: state, code });
  const download = () => {
    let url, anchor;
    try {
      const blob = new env.Blob([`BLOB_READ_WRITE_TOKEN='${token}'\n`], { type: 'text/plain' });
      url = env.URL.createObjectURL(blob);
      anchor = doc.createElement('a'); anchor.href = url;
      anchor.download = 'attendance-owner-store-current-20261110.env';
      anchor.style.display = 'none'; downloadAnchor = anchor; doc.body.append(anchor);
      if (now() >= deadline) { env.URL.revokeObjectURL(url); fail('timeout'); return; }
      anchor.click();
      // Dispatch can synchronously reach our capture listener. A terminal
      // failure there must remain terminal for pending and future callers.
      if (state === 'failed') { env.URL.revokeObjectURL(url); return; }
      if (now() >= deadline) { env.URL.revokeObjectURL(url); fail('timeout'); return; }
      state = 'download_requested'; cleanup(); signal();
      env.setTimeout(() => env.URL.revokeObjectURL(url), 5000);
    } catch { if (url) env.URL.revokeObjectURL(url); fail('download_failed'); }
    finally { downloadAnchor = undefined; anchor?.remove(); }
  };
  const inspect = () => {
    if (state === 'failed' || state === 'download_requested') return;
    if (now() >= deadline) return fail('timeout');
    if (!page()) return fail('wrong_page');
    let text;
    try { text = snippet(); } catch { return fail('unexpected_ui'); }
    const isMasked = masked(text);
    if (state === 'awaiting_reveal') {
      if (!isMasked || buttons('Show secret').length !== 1 || buttons('Hide secret').length) fail('unexpected_ui');
    } else if (state === 'revealing') {
      if (!isMasked) {
        try { token = read(text); } catch { return fail('invalid_credential'); }
        if (buttons('Hide secret').length === 1 && !buttons('Show secret').length) state = 'token_ready';
      }
    } else if (state === 'token_ready') {
      if (isMasked) return fail('unexpected_ui');
      try { if (read(text) !== token) fail('invalid_credential'); } catch { fail('invalid_credential'); }
    } else if (state === 'awaiting_mask') {
      if (isMasked) download();
      else { try { if (read(text) !== token) fail('invalid_credential'); } catch { fail('invalid_credential'); } }
    }
  };
  const check = () => { inspect(); signal(); };
  const wait = ready => new Promise(resolve => {
    const wake = () => {
      if (ready()) { waiters.delete(wake); resolve(state === 'download_requested' ? { ...record(), secretRemasked: true } : record()); }
    };
    waiters.add(wake); check(); wake();
  });
  function onClick(event) {
    if (event.target === downloadAnchor && downloadAnchor) {
      if (state !== 'awaiting_mask' || now() >= deadline || !page()) {
        event.preventDefault();
        fail(now() >= deadline ? 'timeout' : !page() ? 'wrong_page' : 'unexpected_press');
      }
      return;
    }
    if (state === 'failed' || state === 'download_requested') return;
    if (now() >= deadline) return fail('timeout');
    if (!page()) return fail('wrong_page');
    const target = event.target?.closest?.('button');
    const label = target?.textContent?.trim();
    if (label !== 'Show secret' && label !== 'Hide secret') return;
    if (!event.isTrusted) return fail('untrusted_press');
    if (label === 'Show secret') {
      if (state !== 'awaiting_reveal' || buttons('Show secret').length !== 1 || buttons('Show secret')[0] !== target) return fail('unexpected_press');
      check(); if (state === 'awaiting_reveal') state = 'revealing';
    } else {
      if (state !== 'token_ready' || buttons('Hide secret').length !== 1 || buttons('Hide secret')[0] !== target) return fail('unexpected_press');
      check(); if (state === 'token_ready') state = 'awaiting_mask';
    }
  }
  if (Object.prototype.hasOwnProperty.call(env, key)) return { status: 'failed', code: 'already_started' };
  const controller = Object.freeze({
    status() { check(); return record(); },
    waitForTokenReady() { return wait(() => ['token_ready', 'awaiting_mask', 'download_requested', 'failed'].includes(state)); },
    finish() { return wait(() => state === 'download_requested' || state === 'failed'); },
    abort() { fail('aborted'); return record(); },
  });
  Object.defineProperty(env, key, { value: controller, configurable: false, writable: false });
  if (!page()) { fail('wrong_page'); return record(); }
  try {
    observer = new env.MutationObserver(check);
    observer.observe(doc.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
    doc.addEventListener('click', onClick, true);
    timer = env.setTimeout(() => fail('timeout'), 30000);
    check();
  } catch { fail('unexpected_ui'); }
  return record();
}
