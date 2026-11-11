# One bounded OIDC object-body check

Status: **completed and stopped after private origin GET returned 403**. Astra
accepted one execution at `d7a8a2d`; that exact reviewed code ran once under the
owner's existing migration authorization. OIDCBODY1 and OIDC1 are now spent.
Neither may be retried or replaced with a new attempt path.

The [safe outcome](./measurements/blob-oidc-body-probe.json) records LIST 200,
then object GET 403, one request per stage, no accepted object data and agreeing
private evidence files. The rejected response body was canceled, not consumed;
zero consumed object bytes is not a claim of zero response/wire traffic. No
snapshot or backup was produced. The cause of the 403 is not established.

The [implementation](../scripts/probe-blob-oidc-body.mjs) is complete. The first
execution review accepted allocation scope but found that Node's normalized
headers could hide duplicate ETags. The transport now preserves raw header lines
and rejects duplicate validator fields before acceptance. A follow-up review
found Node could still truncate those lines by field count. The request now sets
`maxHeadersCount = 0` before dispatch while explicitly retaining Node's 16 KiB
`maxHeaderSize`. All 58 focused tests pass, including actual HTTPS/HTTP-parser
regressions over in-memory sockets for more than 2,100 fields, conflicting and
identical duplicate ETags, a valid control and an oversized-header rejection.
No real credentials or provider calls were used during implementation. Astra's
focused recheck independently passed all 58 tests and accepted the single live
attempt. The bounds below describe that completed allocation, not another run.

## Purpose

The development bearer could LIST this store at the recorded time. The earlier
static-token origin and cache reads returned 403. A supported OIDC private GET
could test whether body access differs; successful metadata alone cannot answer
that question. This is an ordinary first-party API read, with no access-control
bypass, upgrade, trial, credential fallback or paid spending.

The only proposed success claim is: **this development bearer retrieved one
complete bounded object body from this store at this time**. It does not establish
general exportability, writes, revocation, snapshot consistency or cutover safety.

## Completed allocation: OIDCBODY1

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

OIDC1 and OIDCBODY1 used three OIDC requests total: two LISTs and one object GET.
No retry, redirect, fallback, extra object or token acquisition occurred. The
original three static-key checks and export's
two LISTs plus up to 400 object GETs remain separate and unused. Provider control
requests from earlier CLI operations remain separately disclosed; this proposal
does not claim a whole-project billing total.

The implementation compares both-present ETags as identical strong quoted ASCII
validators. Weak tags, unquoted hashes or quote-format differences stop the check.
That can produce a conservative inconclusive result even if a provider returned
usable bytes; it does not authorize another read or relaxed validation.

Historical CLI contract for the completed attempt; do not run again:

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

The stop is now in effect. Git disconnection was freshly confirmed in the
dashboard before execution, the manual deployment/environment-copy hold remained
active, and no credential rotation, store disconnect or unblock was performed.
Reviewed HEAD and clean tree, matching unexpired captured claims, clean process
environment and exclusive unused paths were checked; the separate two-request
allocation was fsynced before invocation. CLI exit code was 2, final private
records agree, and the spent result was sent to the existing support case.
That case still awaited a human response when the message was submitted.

There will be no further access-probe cycle. Recovery now needs provider evidence
for the supported free export/recovery path and complete writer-credential
freeze, or restoration through the provider's normal access window. No upgrade,
trial, charge or automatic unblock is authorized. The displayed December 4 date
remains a reported provider banner, not a guaranteed successful read.

As required by the reviewed plan, any invalid/empty/oversized listing, expiry, non-200, redirect, timeout,
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
