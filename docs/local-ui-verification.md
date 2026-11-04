# Local browser integration

`pnpm test:local:ui` is an opt-in, headless Chromium integration test for a **disposable local** Convex deployment. It creates at most two synthetic teacher accounts and one synthetic two-student class per run; those records remain in the local backend. It does not reset or stop that backend. Never point it at production, real rosters, or a shared dataset.

Start the existing local Convex deployment with the current functions and synthetic gateway keys in ignored `.env.local`. Its `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL` must be HTTP localhost or 127.0.0.1 addresses with ports matching `.convex/local/default/config.json`. The script validates these before starting its own temporary localhost Next development server and stops only that server afterward. It does not change backend authentication duration settings. The test checks the synthetic account's session deadline and reports a shortened lifetime as a limitation.

Install project dependencies with `pnpm install`. Playwright is pinned; install its Chromium with `pnpm exec playwright install chromium` if no local browser is available. Alternatively set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to a compatible executable. On Linux the script can also use a cached Chromium under `~/.cache/ms-playwright`.

The test uses the real UI, Convex SDK, local backend and public gateway to exercise account creation, CSV roster import, public check-in without a student WebSocket, live attendance and CSV download. It checks disconnect hiding and reconnection, visibility changes, logout and revoked-session replay, offline revocation, and switching accounts. It wraps the SDK's actual WebSocket close callback to click the still-mounted Export control synchronously after the SDK processes a close and before React commits; it checks that no download or blob is produced while `navigator.onLine` remains true. The transport interruption is simulated by closing the real socket and refusing reconnections temporarily. The expiry check changes browser `Date.now` and clicks in the same task before the UI timer can run; the visibility check simulates the hidden property and event. These synthetic controls do not verify operating-system sleep or physical network failures.

The script suppresses browser console and raw SDK errors, credentials, tokens, request/response bodies, screenshots and roster data. It reports named phases and safe HTTP/auth diagnostics. A failing or incomplete run is not evidence of migration or production cutover readiness. Normal unit and backend tests remain necessary.

The socket checks match the configured local Convex host and sync path, excluding the Next development server's WebSocket. The student and teacher pages are brought to the foreground for their respective interactions; the synthetic visibility test is separate. The resume phase reports the number of auth refresh requests without logging their contents. A synchronous close-guard failure remains a failing result even when later independent phases pass.

## Historical close-guard failure

On the initial local headless run documented on 2026-11-04, signup, the default session deadline, CSV roster import, public check-in without a Convex WebSocket, live attendance, CSV export, reconnect freshness, the same-task deadline guard, synthetic visibility resume, offline revocation, account switching, and confirmed logout and cookie replay checks passed. Visibility resume made zero refresh requests. The synchronous socket-close guard failed: clicking the still-mounted Export button immediately after the SDK close callback created a blob and download while the page was visible and online, with no Convex socket open. This prompted the fresh-snapshot product fix and passing run recorded below. The synthetic actors created by the run remain in the local deployment.


## Latest integrated run — passed

After fixing the pinned provider's memory storage and moving CSV export to a
fresh authorized snapshot read, the coordinator reran the complete headless
suite successfully. The close-callback click produced no download; the expiry,
reconnect, hidden/resume, revoked-cookie and account-switch checks passed.
The prior failure above is retained. Safe output is in
[measurements/local-ui-latest.txt](./measurements/local-ui-latest.txt).

An additional synthetic `AuthError` message exercised the actual maintained
browser provider's refresh path. Exactly one real Next auth refresh request
succeeded, the cookie JWT changed, the session ID and fixed deadline stayed
unchanged, and authorized UI recovered. This verifies real refresh machinery
under a synthetic trigger, not wall-clock expiry scheduling or clock skew.
Normal visibility resume made zero refresh requests. The separate real-backend
short-lifetime experiment supplies the bounded natural-expiry evidence.

## Delayed-response lifecycle checks

The extended complete run passed after holding a real successful snapshot response in the browser. Expiry, hiding/unmount, and session selection changed while that response was held; the harness then delivered its original bytes even after cancellation, observed SDK consumption through its continuation, and verified zero new blobs or downloads. The new open session correctly displayed Waiting. These checks exercise the post-response guards beyond relying on network abort alone.

The forced managed refresh changed the JWT and recovered authorized UI, but also reloaded the document. The download observer remained attached across navigation and confirmed cancellation of the held export without any download. This covers the observed reload path, not an in-place token-replacement response race or natural refresh timing.

Intermediate harness failures remain in [measurements/local-ui-delayed-history.txt](./measurements/local-ui-delayed-history.txt). Two early attempts assumed the held JavaScript promise would survive refresh navigation. A subsequent offline phase failed before granular tracing was added; the revised harness waits for an open socket and resumes socket routing before foregrounding the page. The earlier failure was not attributed to a product defect. The selection assertions initially expected Absent although an open session displays Waiting; diagnostics confirmed the selected session changed and no blob/download occurred. These test corrections preceded the complete passing rerun. The latest full output remains in [measurements/local-ui-latest.txt](./measurements/local-ui-latest.txt).

## Response attempt isolation correction

Astra found the first extended runner could mistake a previous ready/settled response for the next check. Its earlier passing output is retained as superseded in the history artifact and is not accepted delayed-response evidence. The helper now clears the prior job, assigns a fresh attempt ID, binds interception/readiness/release/settlement to that ID, and requires exactly one newly received successful response. An old arrival cannot replace a later attempt. The expiry-to-hide sequence deliberately starts with the previous settled job still present and verifies that it cannot satisfy the new attempt.

The corrected complete browser run passed, including that regression control, expiry, hide/unmount, forced-refresh document cancellation, offline revocation, logout/account switching, and session selection after a new held snapshot. The latest output is the corrected run; adversarial recheck remains pending.
