# Pinned Convex Auth integration

`@convex-dev/auth@0.0.96` owns JWT signing, refresh-token issuance and rotation.
The application installs `patches/@convex-dev__auth@0.0.96.patch` through pnpm's
`patchedDependencies`. Do not remove that patch during an upgrade without
reviewing and rerunning the refresh and expiry integration checks.

The patch addresses these inspected library paths:

- The React provider's memory storage reads from a live ref. The original
  memoized storage object retained the first empty state map, so successful
  sign-in was followed by a failed token refresh and client deauthentication.
  Tokens remain confined to memory and HttpOnly cookies; this does not enable
  browser localStorage or alter managed token issuance.
- Refresh proves that the stored refresh token belongs to the supplied session
  inside the same transaction. Missing and mismatched capabilities return null
  without revocation, cleanup scheduling or other writes.
- Expiration and delayed replay revoke only a session established by that
  capability. They delete session authority first and schedule the application's
  `authSupport:cleanupSession`, which deletes at most 100 token records per
  transaction. Replay can force reauthentication for that session, including a
  sufficiently delayed legitimate retry.
- Active refresh-token lookup uses `sessionIdAndFirstUsedTime`, declared in the
  application's schema, instead of filtering the full session history.

The patch is intentionally specific to this application: it requires both that
index and the internal cleanup mutation. Source and shipped JavaScript are
patched together. It leaves the library's token generator and immediate-parent
retry behavior intact. Bounded cleanup does not cap total valid refresh traffic;
security writes and retained token history still need monitoring.

The application also uses the pinned registered-action `_handler` interface in
`convex/auth.ts` to restrict the public sign-in entrypoint. This is an SDK internal
interface. An auth upgrade therefore requires compatibility review rather than
an automatic dependency-only merge.

Session lifetime is fixed at 30 days. The managed JWT duration is one hour.
Issuance is refused when less than one hour plus a one-minute margin remains,
so reauthentication may be required during the final 61 minutes. Protected
operations additionally validate the live session record; scheduled cleanup and
browser timers are not the sole authorization checks.

Supported insecure development origins use `localhost:<port>` or
`127.0.0.1:<port>`. Other supported origins require HTTPS and secure `__Host-`
cookies. Portless HTTP localhost and HTTP IPv6 loopback are rejected because the
pinned provider interprets their cookie names differently.

Teacher views release their data subscriptions while hidden or disconnected.
Returning to a visible page or reconnecting reloads the page, verifies the
session, and loads current attendance. This intentionally clears unsaved drafts
and incurs fresh reads; include that work in the resource measurements.

The Convex client enables `initialAuthTokenReuse`. A server-confirmed valid
cookie JWT can be reused after reload instead of immediately rotating refresh
state on every mount. The SDK still refreshes expired/rejected tokens and
schedules normal refresh. Fresh application session checks and revocation
guards remain required; token reuse is not authorization caching.

CSV export performs a fresh authorized HTTP snapshot query for the selected
session, with roster and all attendance facts read in one transaction. It does
not serialize the screen's cached buckets. An abortable request and checks after
the response prevent downloads after disconnect, expiry, hiding, unmount or a
selection/account change. This adds bounded reads on explicit export clicks;
it creates no polling or background export work.

## Installation verification

A fresh temporary directory containing only the package manifests, lockfile, workspace configuration, and patch completed `pnpm install --frozen-lockfile --ignore-scripts`. All six patched source/shipped JavaScript files matched the installed integration byte for byte. The check fetched the missing upstream package rather than relying on the existing application node_modules tree. This proves patch installation for the pinned package; it does not replace hosted auth tests or an upgrade review.
