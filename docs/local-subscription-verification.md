# Local native subscription verification

The initial bounded run passed on November 4, 2026, from 22:29:59.839 to 22:30:22.132 UTC. All 16 measurement windows observed their start and end checkpoints. Every functional and execution-isolation assertion passed. The run completed 226 counted calls, used 20 check-in, excuse, and sharing operations, and completed exact-owned data cleanup in 31 batches with 1,080 deletions.

The sanitized machine-readable evidence is saved locally at [measurements/local-subscriptions-initial.json](./measurements/local-subscriptions-initial.json). This ignored artifact contains aggregate metadata, counters, and synthetic query labels. Credentials, JWTs, roster contents, student arguments, raw log objects, and admin messages stay in process memory.

## Reproduction and scope

Run against the existing loopback backend and HTTP-action site with explicit origins.

```sh
NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 \
CONVEX_SITE_URL=http://127.0.0.1:3211 \
pnpm exec node scripts/test-local-subscriptions.mjs --push-local
```

Omit `--push-local` when the fixture is already published. The publication option invokes the installed Convex CLI with child-only self-hosted credentials, disabled code generation, and disabled CLI typechecking. It publishes the current integrated workspace to port 3210. The runner validates both explicit origins before reading local configuration, checks matching configured ports before accessing keys, and rejects redirects. Secret-bearing CLI output is discarded.

The implementation owns three new files.

- `convex/localSubscriptions.ts` provides internal loopback-gated actor registration, checkpoints, domain snapshots, and bounded cleanup.
- `scripts/test-local-subscriptions.mjs` exercises actual managed authentication, public attendance queries and mutations, the check-in gateway, native subscriptions, and log collection.
- This document records the observed run and its limitations.

The backend and site continued running throughout. The implementation used the shared integrated code and edited only these assigned source/documentation files. Core changes under concurrent review belong to the root/Astra review scope. The local publication covered the current workspace functions.

## Actors and query set

Two real managed synthetic teachers signed up through `auth:signIn`, using credentials-provider signup with HMAC gateway proofs. The script verified each issued JWT's session binding and 3,600-second lifetime. Public `attendance:create`, `share`, and `repeat` created the fixtures. Both rosters used deterministic fake names and codes. The original 1,000-row session and its repeated session shared an immutable roster version.

Each teacher subscribed to the following public queries.

- The 30-row session had roster, session metadata, history, and bucket 0.
- The selected 1,000-row session had roster, session metadata, history, and all ten buckets.
- The repeated session had roster, session metadata, and bucket 0 as unrelated-session controls.

This yielded 20 queries per teacher and 40 initial queries. The 30-row case exercised initial reads, exact roster/session counts, idle, removal, reload, and authorization isolation. Mutation-isolation experiments targeted the selected 1,000-row session. Initial and reload transport totals combine both sizes and the repeated-session controls. Per-size transport costs were unmeasured.

## Execution-log method

The runner uses the installed SDK's `/api/stream_function_logs` transport and admin authorization header. A local-only internal checkpoint query accepts a monotonically increasing sequence argument, emits only that sequence, and performs zero database writes. Its unique arguments force a fresh execution. Each window drains a known start completion, performs its work and a settled delay, then drains through its known closing completion. This lets an idle window finish even when the attendance workload produces zero log entries.

Every observed window closed in one log page. The largest measurement page contained 44 completion records. The runner allows at most six pages per drain, fewer than 1,000 entries per page, a 4 MiB response, and a four-second log request. Nonadvancing cursors, missing markers, transport delay, recognized truncation flags, and exhausted caps produce `UNKNOWN`. Prior logs are excluded using the initial checkpoint cursor. Completeness is scoped to these controlled local cursor windows and the user's exclusive attendance workload.

Query identifiers are actual `attendance:*` functions. Aggregation retains function identifiers, counts, numeric usage fields, and retry metadata. The backend's `cachedResult` field distinguishes fresh query executions from cached invocations. The pinned SDK declares `cachedResult`, `executionId`, `requestId`, `willRetry`, `occInfo`, and `usageStats` in `node_modules/convex/src/cli/lib/generatedFunctionLogsApi.ts`. The official backend source documents cached execution semantics, retry flags, and cursor streaming. [Convex backend function-log implementation](https://github.com/get-convex/convex-backend/blob/main/crates/application/src/function_log.rs)

The function identifier aggregates every bucket's arguments. Exactly two fresh bucket executions, coupled with exactly two callbacks for the changed bucket, corroborate isolation in each single-update window. Exact bucket attribution from log arguments is unavailable. Callback labels provide that separate client observation.

## Observed windows

Fresh and cached columns count attendance queries. Callbacks count data deliveries. Denials count error callbacks. Byte columns count outgoing and incoming UTF-8 WebSocket application messages across the measured clients.

| Window | Fresh | Cached | Callbacks | Denials | Sent bytes | Received bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Initial 30/1,000 and repeated-session controls | 40 | 0 | 40 | 0 | 6,850 | 267,498 |
| Active idle, three seconds | 0 | 0 | 0 | 0 | 0 | 0 |
| One hot-bucket check-in | 2 | 0 | 2 | 0 | 0 | 702 |
| Fresh-proof duplicate check-in | 0 | 0 | 0 | 0 | 0 | 0 |
| Different-bucket excuse | 2 | 0 | 2 | 0 | 0 | 702 |
| No-op excuse | 0 | 0 | 0 | 0 | 0 | 0 |
| Ten excuses, concurrency at most five | 8 | 0 | 8 | 0 | 0 | 4,991 |
| Same-identity second client | 0 | 13 | 13 | 0 | 3,913 | 70,338 |
| Unsubscribe all and acknowledge | 0 | 0 | 0 | 0 | 4,226 | 9,969 |
| Owned inactive mutation and quiet window | 0 | 0 | 0 | 0 | 0 | 0 |
| Inactive idle, three seconds | 0 | 0 | 0 | 0 | 0 | 0 |
| Reload using two new clients | 2 | 38 | 40 | 0 | 6,850 | 269,024 |
| Close selected session | 2 | 0 | 2 | 0 | 0 | 1,138 |
| Excuse after closure | 2 | 0 | 2 | 0 | 0 | 704 |
| Revoke teacher sharing | 16 | 0 | 0 | 16 | 0 | 8,529 |
| Owner excuse after revocation | 1 | 0 | 1 | 0 | 0 | 352 |

### Single updates and duplicate behavior

The first actual gateway check-in inserted one attendance document. Each teacher received one changed bucket callback. The complete log window contained exactly two fresh `attendance:bucket` query executions. Roster, session metadata, history, other buckets, and the repeated session had zero query completions in that window.

The different-bucket excuse inserted one attendance document and produced the same two-execution/two-callback pattern in bucket 1. The duplicate check-in returned `already`. Both it and the no-op excuse reported `databaseWriteDocuments = 0` for their attendance mutations, with zero attendance query completions and callbacks. Administrative domain digests agreed before and after each operation. Gateway nonce and quota writes are separate security admission work.

### Burst coalescing and cache reuse

Ten distinct excuse updates ran in two rounds of five concurrent HTTP mutations. The log window contained ten successful excuse completions and ten document writes. It contained eight fresh bucket executions, with four changed bucket callbacks per teacher. Both teachers received all ten final facts. This is the observed coalescing behavior for this run.

A separate client with the owner's same JWT requested the selected session's 13 queries. All 13 completions had `cachedResult = true`, and their reported database reads were zero. The extra client still received 70,338 application-message bytes. That window also includes its unsubscribe acknowledgments and connection teardown. Retained server-cache reuse is conditional on identity, arguments, invalidation, and eviction.

### Inactivity and reload

The wrapper recorded outgoing query-set versions and incoming transition acknowledgments. All private subscriptions were removed, and every open connection acknowledged the final query-set version before the inactive mutation. The sockets stayed connected during the inactive windows.

An owned excuse mutation while inactive reported one intentional attendance write. Its closing checkpoint window had zero attendance query executions and zero callbacks. A separate three-second inactive idle window contained only the checkpoint completion, with zero application messages and matching domain digests. Active three-second idle likewise contained only the checkpoint completion, zero messages, and matching domain digests. These windows observed zero polling and heartbeat writes.

Both inactive clients were then closed. Two genuinely new SDK clients loaded all 40 queries and received the current inactive fact. The reload produced two fresh bucket executions, 38 cached query invocations, and 40 initial callbacks. Reported query read overhead was 19 documents and 5,641 bytes. The initial mixed-size load reported 4,408 documents and 1,462,776 bytes. These usage fields describe the local backend's diagnostic accounting.

### Closure and authorization

Closing the selected session reran only the two selected-session metadata queries. A subsequent shared-teacher excuse succeeded while the session was closed and reran only the two affected bucket queries.

Revoking that class's sharing produced 16 fresh denied queries for the shared teacher, covering the selected session and its repeated-session controls. Their SDK errors carried status 403. Owner queries and the shared teacher's separate 30-row class stayed isolated. A subsequent owner excuse produced exactly one fresh bucket execution and one owner callback. The previously authorized private subscriptions delivered zero further successful callbacks.

## Bounds, cleanup, and interpretation

The run lasted 22,293 ms. All 226 counted calls settled, comprising 93 subscription registrations, 100 HTTP SDK/admin/gateway calls, and 33 log requests. The local CLI publication's own deployment requests are outside this script-call counter. The workload used two check-ins, 15 excuse calls, two sharing additions, and one sharing removal. Creation, repetition, closure, registration, snapshots, and checkpoints are counted separately in the SDK/admin budget.

Setup created 1,030 roster members and registered two exact managed sessions using two administrative document patches. Setup/domain/managed writes have a conservative 1,200-write allowance. Adding registration and 1,080 cleanup deletions yields the report's 2,282-write upper estimate, within the 5,000-write limit. This allowance separates setup cost from subscription execution measurements and represents an estimate rather than observed billing.

Cleanup addressed only the run's indexed usernames, owner keys, deterministic class/session IDs, registered sessions, immutable rosters, memberships, class state, closures, attendance rows, credentials, refresh tokens, owner links, nonce prefix, and exact security counter keys. Each deletion transaction was bounded at 100 rows. All SDK connections closed before cleanup began. A final cleanup transaction found the scoped data exhausted.

Managed signup also schedules session-expiry cleanup through the existing core implementation. This runner's cleanup does not inventory or cancel those scheduled jobs. Two future expiry-job records may therefore remain after the named fixture tables are cleaned. Their session authority has been deleted. This is a cleanup-coverage limitation of this run.

The 16 log windows contained zero explicit `willRetry = true` entries and zero explicit OCC retry metadata entries for attendance functions. The report retains the whole-run retry total as `UNKNOWN`, since setup, cleanup, unpublished attempts, and absent retry fields have different coverage. Fresh mutation completion records describe observed attempts, and successful final results are counted separately from query executions.

Transport instrumentation wraps the installed Node `ws` WebSocket constructor used by the SDK. It counts application-message events and UTF-8 payload bytes without persisting their payloads. HTTP signup, mutations, gateway traffic, fixture administration, and log downloads are outside those WebSocket counters. TCP framing, TLS, compression, WebSocket control frames, and protocol fragmentation are outside this measurement.

One-hour auth rotation was unmeasured here. The root browser-refresh validation is separate evidence supplied by the coordinator. The three-second quiet windows cover their actual observed duration. Hosted capacity, other-team traffic, monthly dollars, free-quota headroom, and production approval are unknown.

Validation completed with `node --check scripts/test-local-subscriptions.mjs` and `pnpm exec tsc --project convex/tsconfig.json --pretty false`.

## Cleanup correction and confirming run

The coordinator added exact-session cancellation of pending expiry jobs before deleting each registered synthetic actor. It validates a bounded scheduled-job inventory and cancels only the named cleanup function with a session ID belonging to that actor. Cancellations count toward the 100-write cleanup transaction limit.

The confirming run passed all 16 checkpoint windows, settled all 226 counted calls, and completed 31 cleanup batches with 1082 counted writes, including cancellation of both newly created expiry jobs. Safe evidence is in [measurements/local-subscriptions.json](./measurements/local-subscriptions.json). This confirms cleanup for the new run; the two possible scheduled records from the initial run remain a historical limitation, since their exact ownership identifiers were deliberately not retained in the report.
