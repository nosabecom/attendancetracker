# One bounded OIDC object-body check

Status: preparation under the owner's existing migration authorization. Execution
requires review of the concrete implementation and this separate allocation.
No request under this proposal has been made. OIDC1's single LIST is already
spent and cannot be replayed.

The [implementation](../scripts/probe-blob-oidc-body.mjs) and 51 focused synthetic
tests are complete; those tests passed. No real credentials or provider calls
were used during implementation. Code and execution bounds await Astra review.

## Purpose

The development bearer could LIST this store at the recorded time. The earlier
static-token origin and cache reads returned 403. A supported OIDC private GET
could test whether body access differs; successful metadata alone cannot answer
that question. This is an ordinary first-party API read, with no access-control
bypass, upgrade, trial, credential fallback or paid spending.

The only proposed success claim is: **this development bearer retrieved one
complete bounded object body from this store at this time**. It does not establish
general exportability, writes, revocation, snapshot consistency or cutover safety.

## Proposed allocation: OIDCBODY1

- At most two physical application requests: one `LIST limit=1`, followed only
  on valid selection by one private origin GET. No HEAD, pagination, alternate
  object, redirect, retry or additional token acquisition.
- Use only the already acquired development token, privately validated against
  the expected project/team/environment and unexpired by at least 30 seconds
  immediately before each dispatch. An expired token stops the run; no remint.
- Keep the expected production store pinned. Validate the listed object's exact
  private origin and pathname; reject userinfo, query or fragment. Use that
  validated provider URL with SDK-equivalent `cache=0` and the explicit bearer.
- Cap LIST bodies at 16 KiB and the selected object at 64 KiB. Reject an empty,
  invalid or oversized selection before GET. Headers and bodies each have a
  15-second deadline, with 60 seconds for the network run.
- Use an owned transport with no automatic retry/redirect/refresh. Request
  identity encoding and reject unexpected content encoding, so received bytes
  can be compared directly to the listed size. Require EOF and exact size;
  check Content-Length when present. Compare usable ETags when both are present.
  Undocumented validator differences must stop, not trigger normalization guesses
  or fallback reads.
- Reserve each request durably before dispatch in one exclusive private attempt
  file. Keep spent accounting on failure. Only aggregate counters/status and
  fixed diagnostic codes may persist; the selected name, URL, header values and
  body remain transient. No consistent snapshot or backup is produced here.

OIDC1's one request plus this proposal would total at most three OIDC requests:
two LISTs and one object GET. The original three static-key checks and export's
two LISTs plus up to 400 object GETs remain separate and unused. Provider control
requests from earlier CLI operations remain separately disclosed; this proposal
does not claim a whole-project billing total.

The implementation compares both-present ETags as identical strong quoted ASCII
validators. Weak tags, unquoted hashes or quote-format differences stop the check.
That can produce a conservative inconclusive result even if a provider returned
usable bytes; it does not authorize another read or relaxed validation.

Future CLI contract, not executed:

```sh
node scripts/probe-blob-oidc-body.mjs --run \
  --oidc-json PRIVATE_ACQUISITION_JSON \
  --output .convex/blob-recovery/body-probe-result.json \
  --attempt .convex/blob-recovery/body-probe-attempt.json
```

Run with the reviewed source and a clean process environment. Evidence files must
share an existing owner-only 0700 directory; each file is 0600 and exclusive.
Reservations can conservatively count a request that expiry/cancellation stops
before dispatch. Do not turn missing evidence into permission to reuse a slot.

## Stop and handback

Any invalid/empty/oversized listing, expiry, non-200, redirect, timeout,
cancellation, incomplete/mismatched body or evidence-finalization failure ends
the check. Preserve the attempt. No new path, second object, increased size cap,
fallback credential or probe cycle is allowed. Report the exact limited result
to the existing support case if it does not resolve access.

Even on success, do not follow it with an automatic export. First review the
actual evidence and a separate recovery plan. All legacy writer paths still
need a complete freeze and drain before a consistent private snapshot. OIDC
revocation across environments, free courtesy terms before any unblock, backup
and historical reconciliation, hosted Next checks, verified Convex import and
final Astra approval remain open. Production remains on Blob and the deployment
hold remains active. Do not remove the unit suite.
