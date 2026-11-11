# Local shared-school-IP gateway burst verification

Latest status: the partitioned implementation passed the bounded randomized
acceptance run described at the end of this document. The original failure below
is preserved as evidence; it describes the earlier unpartitioned implementation.

The actual local gateway **failed full-school admission at concurrency 20**: 962 of 1,000 distinct students succeeded; 38 received HTTP 400. Exactly 962 valid attendance facts existed afterward, agreeing with the successful responses. The sequential 30-student baseline passed. Limited execution logs confirm OCC conflicts in `authSupport:reserve` involving `throttleCounters`. No admission architecture was changed.

## Historical acceptance plan

This section records the plan prepared before the partitioned implementation was published and tested. That experiment is now complete; its results appear at the end of this document. The original unpartitioned failure remains preserved below.

The plan specified exactly 3,035 public requests, under the hard limit of 3,200: 30 baseline, 1,000 fresh, 1,000 cleanup-heavy, 1,000 fresh-proof duplicates for that same cleanup-heavy session, and five controls. The exhausted-identity control is interleaved with honest arrivals; the other controls cover replay, invalid HMAC, malformed JSON, and JSON null. Every legitimate response must be 200, duplicate responses must identify an existing fact, and fact IDs and timestamps must remain stable. The two 1,000-student sessions have independent immutable rosters and facts. Actual request nonces are random UUID-shaped 32-hex values; proofs and the exact nonce inventory remain in memory, never in reports. No client retry or repeat of a failed randomized workload is permitted.

A fixed 15-minute bucket governs the run. It aborts before arrivals unless at least five minutes remain, and checks again before the cleanup-heavy and duplicate windows; crossing the bucket or failing to send all duplicates fails the gate. Request concurrency is 20 for each 1,000-student window, with a four-minute arrival deadline. Every worker settles before cleanup. Timeout handling allows a bounded drain, though a client timeout cannot prove that a server-side transaction has finished.

Immediately before the cleanup-heavy window, the fixture writes 24 expired nonce rows and 24 expired counter rows in each of 64 partitions, plus one live and one expired unpartitioned legacy sentinel of each type per partition. It checks that live and legacy sentinels survive actual request cleanup. The fixture also adds one exhausted identity counter. These explicit writes total 3,329. The current create path adds 2,048 actor and roster writes, for a planned 5,377 fixture writes; public admission and attendance writes are separate. The report counts administrative calls (maximum 400), seed/control writes, public requests, and cleanup deletions separately. At most 240 fixture cleanup transactions delete at most 100 rows each; they address the run's owned prefixes, exact partitioned keys and in-memory nonce inventory. No global reset or administrator expiry drain is performed.

The report includes status counts, wall time and latency percentiles, submitted random-primary occupancy, retained nonce receipts and encoded chosen-partition/fallback counts, plus retained current-bucket IP/session counter aggregates. Receipts expire at `issuedAt + 60001` and inline cleanup can remove earlier windows after 60 seconds. Missing receipts may reflect expiry, rejection, or reservation failure; missing coverage and fallback decisions are explicitly unknown. HTTP 200 attendance and successful reservations are different measurements: a downstream failure can consume counters and nonce without creating a fact. Bounded redacted OCC/log summaries cannot establish whole-run retries or attribute every failure. Core forced-failure tests belong to the worker implementing admission.

The coordinator published the completed local backend before executing `pnpm exec node scripts/test-local-burst.mjs`; the script does not publish functions itself. It validated loopback origins and configured ports before accessing credentials and used no secret command-line arguments. The fixture used the implemented optional `partition`, `quotaPartitions`, and partition/expiry indexes; the boolean `reserve` response remained unchanged. Local-only guards and internal fixture endpoints remained in force. This experiment added no production telemetry.

## Historical scope and reproduction

The following describes the original run and its former runner, not commands for the revised harness.



Only these new files belong to this test:

- `convex/localBurst.ts`: internal, local-only administrative fixtures, snapshots, and bounded cleanup.
- `scripts/test-local-burst.mjs`: fixed workload, actual HTTP requests and safe JSON evidence on stdout.
- `docs/local-burst-verification.md`: retained evidence and interpretation.

The existing backend at `http://127.0.0.1:3210` and HTTP-action site at `http://127.0.0.1:3211` were used. The backend was not reset, stopped, provisioned, or reconfigured. No production/cloud requests, delegates, preview tools, purchases, package/schema/auth/UI edits, or commits were used.

Read-only checks of `AGENTS.md` and the installed Next testing guide preceded implementation. JavaScript syntax validation and `pnpm exec tsc --project convex/tsconfig.json --noEmit` passed.

The original runner offered a local publication option and a separate two-request probe. Those modes have been removed from the revised runner. The historical executions below are retained as evidence; they must not be repeated to hide a failure.

## Historical safety and fixture ownership

The original runner validated explicit HTTP loopback origins and exact ports **before** accessing an administrative capability. It compares local config ports before accessing `adminKey` or parsing gateway keys. Credentials stay in process memory; CLI arguments, evidence, and errors contain no keys, tokens, identity payloads, signatures, IP hashes, nonce values, or raw backend logs. Redirects are rejected.

Every server fixture endpoint also checks the system-provided `CONVEX_SITE_URL` equals `http://127.0.0.1:3211`. Its functions are internal, not public. A random 24-hex run identifier defines exact actor/owner/class/session ownership. `attendance:create` is invoked as the actual registered mutation with an administrative synthetic identity backed by a dedicated user, owner link, and one-day session row. There are no managed JWTs, refresh tokens, credential signups, or scheduled auth tasks. This makes the test independent of the other worker's temporary short-expiry environment.

The actual CSV/create path builds 30- and 1,000-student immutable class/roster/session fixtures. A single `ipHash = sha256(run)` is shared by both schools' test sessions, while each student's identity hash differs. A nonce is `run24hex + ordinal8hex`. Each request gets a just-in-time HMAC proof. Each public operation is sent once using `fetch`, without an application/client retry. Only Convex's own transaction retry mechanism can retry transaction execution.

Cleanup uses indexed nonce-prefix and student-counter-prefix ranges plus exact student-IP/session keys. Domain cleanup resolves exact class/session IDs and validates full owner equality and expected metadata. No broad fake-actor or expired-record deletion is performed by fixtures. Every cleanup transaction deletes at most 100 records; the runner permits at most 100 iterations and 125 total administrative function calls. Every worker promise is awaited with `Promise.allSettled`; request timeouts and a four-minute arrival deadline bound the workload. Cleanup starts after request promises settle, with an additional drain interval if a public request timed out.

The application's existing admission handler itself performs global expired-security-record maintenance. Consequently it may remove expired security records from other runs during normal request processing. This test did not alter that behavior; fixture cleanup is strictly scoped to its own run. Other workers' domain fixtures and actors were preserved.

## Recorded full run

UTC: **2026-11-04 21:29:46.743–21:30:55.412**, including local publication, fixture setup, verification, and cleanup (68.669 seconds total). Arrival times include proof signing and HTTP response-body completion. Percentiles use nearest rank. No transport failures or timeouts occurred.

| Window | Requests / concurrency | HTTP results | Wall time | p50 / p95 / p99 / max latency (ms) |
| --- | --- | --- | --- | --- |
| 30 distinct students | 30 / 1 | 30 × 200 | 2,146 ms | 67.17 / 94.68 / 102.54 / 102.54 |
| Fresh-proof duplicates, 30 roster | 15 / 1 | 15 × 200, all `already` | 856 ms | 54.92 / 76.16 / 76.16 / 76.16 |
| Exact signed-proof replay | 1 / 1 | 1 × 429 | 21 ms | 20.83 / 20.83 / 20.83 / 20.83 |
| Invalid HMAC | 1 / 1 | 1 × 403 | 12 ms | 12.41 / 12.41 / 12.41 / 12.41 |
| 1,000 distinct students | 1,000 / 20 | **962 × 200; 38 × 400** | **55,935 ms** | **1,026.51 / 1,707.24 / 2,047.38 / 2,327.74** |
| Fresh-proof duplicates, 1,000 roster | 15 / 1 | 15 × 200, all `already` | 787 ms | 52.31 / 57.68 / 57.68 / 57.68 |
| Public metadata reads | 2 / 2 | 2 × 200 | 21 ms | 20.37 / 20.53 / 20.53 / 20.53 |

Burst completion throughput was **17.88 requests/second**, including rejected requests. Success rate was **96.2%**. This is a controlled-concurrency arrival window, not 1,000 simultaneous requests or a production capacity estimate.

Safe evidence retained from runner output:

```json
{
  "fullRun": {
    "submitted": 1064,
    "completed": 1064,
    "initialStudentRequests": 1030,
    "freshDuplicateRequests": 30,
    "securityControlRequests": 2,
    "publicInfoRequests": 2,
    "adminCalls": 66,
    "fixtureQueries": 7,
    "baselineCorrectFacts": 30,
    "burstExpectedFacts": 1000,
    "burstObservedFacts": 962,
    "burstUniqueSuccessfulResponses": 962,
    "burstResponseFactAgreement": true,
    "burstHttp200": 962,
    "burstHttp400": 38,
    "metadataUnchangedBothFixtures": true,
    "baselineDuplicateIdsAndTimestampsUnchanged": true,
    "all30FreshDuplicatesReturnedAlready": true,
    "proofReplayRejected429": true,
    "invalidHmacRejected403": true,
    "responsePrivacyFailures": 0,
    "cleanup": { "done": true, "batches": 56, "deleted": 3950 },
    "passed": false
  }
}
```

Snapshots validate unique student IDs, bucket placement, finite check-in timestamps, no excuse fields, and immutable metadata/roster digests. Successful check-in bodies contained only the matched name and optional `already`; error bodies contained only a bounded error string. Public metadata returned only title and closed state. There was no roster or attendance leakage in public responses.

### Counter retention and reporting correction

The run crossed the **21:30 UTC 15-minute throttle bucket boundary**, and exceeded the oldest nonce's roughly one-minute lifetime. At the final snapshot, retained security state was:

```json
{
  "nonceCount": 1021,
  "identityCounterRows": 892,
  "identityAdmissionTotal": 892,
  "schoolIpAdmissionTotal": 892,
  "sessionAdmissionTotals": [
    { "size": 30, "count": 0 },
    { "size": 1000, "count": 892 }
  ]
}
```

These are **retained rows**, not whole-run admission totals. The first runner incorrectly asserted equality to whole-run accepted counts, and required 1,030 retained identity rows. Those assertions failed because expiry maintenance can delete the old bucket; they are not additional evidence of admission loss. The runner now records the boundary/retention caveat and skips those historical comparisons when a bucket rolls over. Attendance facts and HTTP outcomes establish the 38 actual failures independently.

The first runner's 1,000-roster duplicate comparison also required a total of 1,000 facts before comparing row IDs/timestamps. With only 962 admissions, it returned false before evaluating those comparisons. That result **does not establish timestamp changes**. The runner now compares pre/post fact counts independently of the all-students-admitted assertion. The full burst was not rerun. A narrowly scoped two-request follow-up below provides direct timestamp evidence without retrying any failed student.

### Bounded execution-log evidence

The script read the local administrative `/api/stream_function_logs` endpoint before the workload and after each main window. It consumed only bounded JSON responses in memory, and emitted numeric summaries. No raw execution logs, request identities, arguments, or error messages were retained.

The baseline page contained 140 entries: 46 `authSupport:reserve` completions (including the replay rejection), 45 `attendance:publicCheckin` completions, no reserve error entries, and no explicit OCC retry information.

The post-burst page was capped at **1,000 log entries**, so it cannot cover all attempts. Within that page:

```json
{
  "reserve": {
    "completionEntries": 517,
    "errorEntries": 12,
    "willRetryEntries": 273,
    "entriesWithExplicitOccRetryCount": 285,
    "maxReportedRetryCount": 4
  },
  "publicCheckin": { "completionEntries": 232, "errorEntries": 0 },
  "requestIdHeadersObserved": 0,
  "wholeRunRetryCount": "UNKNOWN"
}
```

A single additional bounded log read after cleanup found 1,000 retained entries, including **11 reserve errors, all with OCC information and conflict-related error text**, **268 reserve entries naming `throttleCounters` in OCC metadata**, and a maximum reported retry count of four. This establishes a real counter-contention failure mechanism; it does not prove per-request causes for every HTTP 400. Time-window log samples can include concurrent workers, and HTTP responses exposed no request-ID header for precise attribution. No exact total retry count can be inferred from these samples or from latency.

## Separate duplicate timestamp probe

UTC: **2026-11-04 21:32:32.450–21:32:34.399**. A new fixture used the actual create path for a 1,000-student roster, then sent one initial gateway check-in and one fresh-proof duplicate, both at concurrency one. No failed student from the original burst was retried.

```json
{
  "duplicateProbe": {
    "submitted": 2,
    "completed": 2,
    "initialHttpStatus": 200,
    "duplicateHttpStatus": 200,
    "duplicateAlready": true,
    "initialLatencyMs": 96.18,
    "duplicateLatencyMs": 83.29,
    "attendanceFactCount": 1,
    "factIdCreationTimeAndCheckinTimestampUnchanged": true,
    "immutable1000RosterMetadata": true,
    "responsePrivacyFailures": 0,
    "adminCalls": 27,
    "fixtureQueries": 3,
    "cleanup": { "done": true, "batches": 22, "deleted": 1014 },
    "passed": true
  },
  "combinedPublicRequests": 1066,
  "combinedInitialStudentRequests": 1031,
  "combinedFreshDuplicates": 31,
  "combinedSecurityControls": 2,
  "combinedPublicInfoReads": 2,
  "combinedFixtureQueries": 10,
  "combinedAdminFunctionCalls": 93,
  "combinedExecutionLogReads": 4,
  "combinedCleanupDeleted": 4964,
  "bothFixtureCleanupsCompleted": true
}
```

The baseline directly checked stable IDs/timestamps across its 15 duplicates. The separate probe directly checked the same property on a partially attended 1,000-student roster. All 30 original fresh duplicates returned `already: true`, but the original 1,000-roster timestamp comparison was inconclusive due to the reporting bug described above.

## What these measurements do and do not establish

The existing [registered-handler transaction measurements](measurements/local-transactions.json) independently report zero documents/bytes written for duplicate check-in and excuse operations at both roster sizes. They report **four steady security writes per successful admission** (one nonce and three counters), excluding additional expired-record maintenance. The burst uses the real gateway and therefore includes HMAC/action/HTTP work in observed latency, but does not remeasure transaction write cost or claim zero total writes for a fresh-proof duplicate. Its security admission still writes.

The tested gateway cannot currently guarantee all 1,000 legitimate arrivals succeed on a shared school IP at concurrency 20. The root task should decide whether to change counter/admission architecture and obtain the requested Astra review. No automatic sharding, limiter adjustment, or request retry was added here.

Real WebSocket query execution/cache/coalescing, actual scheduled/token work, Next ingress and IP extraction, managed JWT behavior, hosted capacity/cost, quotas, and monthly projections remain outside this test. No quota, monthly usage, or spending promise follows from these local results.


## Partitioned acceptance run — 2026-11-04

The coordinator published the integrated code after restarting the existing local
backend, then ran the revised randomized workload once. All 3,035 submitted
requests settled, within the predeclared 3,200-request budget. No application
retry was used. The 30-student baseline, fresh 1,000-student burst at concurrency
20, cleanup-heavy 1,000-student burst at concurrency 20, and 1,000 planned fresh
proof duplicates all succeeded. Every duplicate returned `already` and preserved
fact IDs and timestamps. All assertions passed, including the fixed-bucket
fairness window, control statuses, public privacy, metadata and live/legacy
sentinels. Cleanup completed in 139 batches, deleting 8,573 owned fixture records.

Full safe results are retained in
[measurements/local-burst-partitioned.json](./measurements/local-burst-partitioned.json).
The fresh and cleanup-heavy arrival windows took 36,978 ms and 36,895 ms;
their p95 latencies were 872.50 ms and 873.65 ms. The duplicate window took
23,421 ms, p95 552.10 ms. These are local synthetic measurements, not hosted
capacity or cost promises.

Fallback receipt coverage was complete for the fresh and duplicate windows.
The fresh window used no alternate partitions; the duplicate window used one
session alternate. Eight cleanup-heavy receipts had expired before their final
inspection: fallback decisions for those eight are unknown. All 1,000 attendance
responses and facts in that window still passed. No missing receipt is counted
as an absent reservation or as a zero fallback decision.

Partition quotas retain exact fixed-window totals, but can reject early when the
two candidate partitions are exhausted. A passing run does not guarantee all
future nonce draws, three attempts per student, adversarial traffic capacity,
zero transaction retries, or protection against hosted resource exhaustion.
