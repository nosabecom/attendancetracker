# Actual local SDK auth concurrency checks

Run from the repository root with the existing local backend on
`http://127.0.0.1:3210` and site on `http://127.0.0.1:3211`:

```sh
pnpm exec node scripts/test-local-auth-races.mjs --push-local
pnpm exec tsc -p convex/tsconfig.json --noEmit
pnpm exec tsc --noEmit --incremental false --strict
```

`--push-local` publishes the current workspace functions, including the installed
patched `@convex-dev/auth@0.0.96` bundle and administrative fixture. It disables
code generation and uses explicit self-hosted selection in the CLI child process.
It neither provisions a deployment nor starts, stops or resets the running backend.
Omit the flag when this fixture and the intended auth bundle are already deployed.
No environment setting is written. Publication output and SDK logging are suppressed.

Both explicit origins must match the exact IPv4 loopback addresses and ports above,
with no credentials, path, query, fragment or redirects. The harness extracts only
origin lines before accessing credentials, then checks the two ports against
`.convex/local/default/config.json`. Only afterward does it access the admin key
and parse HMAC configuration from ignored `.convex/local-auth.env`, `.env.local`,
or the process environment. There is no hosted fallback. The backend fixture also
requires the system `CONVEX_SITE_URL` to equal `http://127.0.0.1:3211/`.

The installed `convex/browser` HTTP SDK performs actual actions, queries and
mutations. Four random `authstress-` users sign up with HMAC proofs; the control
also signs in normally. Every run has a unique IP hash and nonce prefix. JWTs and
refresh capabilities come exclusively from the managed credential flow. Admin
access is confined to fixture registration, observation, seeding and cleanup.
Protected access is checked through the existing `attendance:viewer` query.

The runtime gates are:

1. Concurrent first refreshes of one capability settle through
   `Promise.allSettled`. Both return the managed child capability, both JWTs work,
   and the session keeps its original fixed deadline.
2. A further rotation produces a grandchild. After at least 11 seconds measured
   from completion of the first refresh pair, ancestor replay is denied. The
   established session disappears, every issued JWT fails protected access, and
   both control sessions remain usable.
3. Refresh and authenticated logout run concurrently and both settle. Logout
   removes the session; all original and returned JWTs must fail the protected
   viewer. A subsequent refresh capability cannot restore the revoked session.
   Null tokens and specific authentication errors are accepted denials;
   transport errors and generic service errors fail the gate.
4. After managed signup, six bounded admin batches insert 501 additional used
   refresh records, producing 502 records including the issued one. The issued
   JWT still accesses the protected viewer and performs real authenticated
   logout. Authority must be gone on return. Status queries observe the actual
   scheduled cleanup reaching zero, without manually invoking its worker.
5. Anonymous direct `auth:store` access is denied. Invalid and cross-session
   refresh capabilities are denied without changing either session's authority,
   token count or count of scheduled cleanup jobs.

The fixture registers an exact synthetic user/session binding in that synthetic
user's optional name field. Session operations require that binding even after
revocation. Seeding requires a live session and exact cumulative offset. Only
admin observation/seeding may take up to 502 refresh records; runtime auth is
unchanged. Scheduled-job observation takes at most 1000 records and refuses to
claim scheduling isolation if that scan saturates. Cleanup uses indexed bounded
lookups, preserves unrelated actors, and cancels only registered sessions' pending
cleanup jobs. It removes the run's credentials, owner links, users, sessions,
refresh leftovers, proof nonces and exact rate-counter keys.

Each invocation permits at most 100 SDK service calls and 1000 administrative
fixture writes, including cleanup deletes and scheduler cancellations. Write
allowance is reserved before each fixture mutation. Main gates reserve 20 calls
for cleanup. Seed batches contain at most 100 writes; cleanup transactions perform
at most 100 writes. Actual managed signup/rotation writes and scheduled worker
deletes are backend operations, not administrative fixture writes. The budget
counts SDK requests rather than nested function executions. No explicit client
retry is implemented; normal backend transaction conflict handling remains active.
Each SDK request has an eight-second timeout. Cleanup observation permits at most
12 status reads and ten seconds; the entire process budgets 180 seconds, including
up to 60 seconds for publication and a 25-second final cleanup reserve.

If a failure exhausts a bound, the harness reports a nonzero exit and the number
of synthetic actors whose cleanup did not finish. It never widens cleanup scope.
A signup that succeeds immediately before a failed registration may leave an
unregistered synthetic actor; cleanup deliberately refuses to guess its session
binding. Secret values, proof payloads, identifiers and raw SDK errors are absent
from the JSON report.

## Observed result — 2026-11-04

The actual local run with `--push-local` passed every gate:

| Measurement | Actual result |
| --- | --- |
| SDK requests submitted / settled | 66 / 66 |
| Actions / queries / mutations | 15 / 24 / 27 |
| Administrative fixture writes | 537 |
| Concurrent first-refresh promises settled | 2 |
| Refresh/logout promises settled | 2 |
| Ancestor replay delay after first-refresh completion | 11,004 ms |
| Seeded refresh history, including managed record | 502 records |
| Scheduled cleanup completion after logout started | 948 ms |
| Cleanup status observations / remaining token records | 2 / 0 |
| Final cleanup writes / cancelled pending jobs | 31 / 5 |
| Synthetic actors cleaned / bounded leftover actors | 4 / 0 |
| Expected auth denials / internal-visibility denials | 6 / 1 |
| Transport / unexpected service failures | 0 / 0 |
| Total elapsed time, including fixture publication | 16,899 ms |

The run verified the restored 30-day session and one-hour JWT policy. Both first
refresh JWTs worked and kept the original deadline. Delayed replay rejected all
four issued rotation JWTs, while both control-session JWTs remained usable.
The refresh/logout race returned an authentication denial for refresh; logout
succeeded and the original JWT and refresh capability could not restore access.
The branch checking a JWT returned by a winning refresh is implemented but was
not exercised in this particular race ordering. The large-history session had
refresh records remaining at the first post-logout observation, and zero at the
second, proving completion by the scheduled worker before administrative cleanup.
Strict Convex and whole-app typechecks passed. A final guard additionally reserves
fixture write capacity before sending mutations; this does not change the tested
auth workload or its measured counts.

These results cover one bounded local run. They do not establish both possible
race orderings, conflict retry counts, hosted capacity, quota or billing behavior.
They complement the separate actual expiry checks and 17,000-record indexed-lookup
unit regression; this script does not repeat those workloads. Existing gateway
nonce/rate-counter TTL maintenance may independently delete expired rows from
other runs. Invalid capability logout scheduling is not separately exercised here.
