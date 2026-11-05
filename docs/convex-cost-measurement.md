# Local Convex resource measurement

Run after the local backend has deployed current functions:

```sh
CONVEX_SITE_URL=http://127.0.0.1:3211 \
NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 \
node scripts/measure-local-usage.mjs
```

Both origins must be explicit loopback URLs matching the local configuration's
ports. The script validates them before reading the local administrative key.
It never accepts a cloud target. The local deployment must already be active;
the harness does not initialize, activate or reset it.

The fixture creates 30 and 1,000 students, reusable roster versions, two classes,
synthetic ownership/session records and at most 50 history sessions. Cleanup
removes only this run's fixture records in batches. Interrupted runs may leave
local fixtures; they do not affect production. Concurrency is one. No telemetry
records are created for sample requests.

## Measurement method

Internal diagnostic wrappers invoke the actual registered attendance and
security-admission handlers using the pinned SDK's `_handler` interface. An
administrative synthetic identity supplies authentication claims; the handlers
perform their normal live-session, deployment, ownership and membership checks.
JWT signature verification and application transport are excluded. These
wrappers are local diagnostics and are unavailable on hosted deployments.

The latest local sample is saved in
[`measurements/local-transactions.json`](./measurements/local-transactions.json).
It contains counters and serialized byte sizes only, with no fixture identities,
credentials or roster contents. Treat this synthetic local run as diagnostic
evidence subject to the limitations below.

`ctx.meta.getTransactionMetrics()` supplies database read/write bytes, documents
and other transaction counters. Unsupported runtimes report unavailable metrics
rather than synthetic estimates. Application JSON bytes measure serialization
of actual response values, excluding the diagnostic counters. They are not
WebSocket/HTTP wire bytes or billing totals.

Samples include viewer, class directory, selected session, roster, paginated
history, every attendance bucket, new/duplicate check-in, new/duplicate excuse,
and security admission/replay. Only the first bucket is populated initially;
empty buckets are sampled separately. Duplicate domain writes and replayed
admission must write zero documents or the script fails.

A cold and a warm admitted request are measured separately. Opportunistic
expired-record deletion is counted as `maintenanceDeletes` without adding
telemetry writes. A cold sample may include cleanup left by earlier local
activity. Warm admission still writes security state for valid retries even
when the subsequent attendance operation is a no-op. Future nonce/counter
cleanup is additional work.

## Scenario arithmetic

Options use `--name=integer`:

```sh
node scripts/measure-local-usage.mjs \
  --monthly-sessions-30=200 \
  --monthly-sessions-1000=4 \
  --monthly-student-operations=10000 \
  --monthly-exports-30=0 \
  --monthly-exports-1000=0 \
  --history-count=40
```

These defaults are illustrative, not Nosa's observed usage. The arithmetic uses
two teachers, an initial open and two resumes per teacher/session, two viewer
executions per open, fresh selected-session reads, one security admission per
student check-in and an uncoalesced bucket update per teacher/check-in. It assumes
every query executes, without claiming server-cache reuse. It uses a populated
100-student bucket for update costs and the 30-student sample for check-in costs.
Shared teachers may need additional membership reads; the fixture samples owner
access. Explicit export counts are configurable by roster size and default to
zero; exported reads must be added when modeling actual usage. Export samples
populate only the first attendance bucket and are not a maximum-facts cost bound.
The report labels these assumptions explicitly.

This is scenario arithmetic over measured operations, not a monthly cost forecast
or a verified upper bound. It excludes authentication/password work and rotation,
HTTP-action overhead, HMAC and Next hosting, protocol framing/compression, actual
subscription execution/coalescing, failed/duplicate admissions, some maintenance,
other team deployments, storage/index growth and retention. Actual row sizes may
be larger, particularly historical Unicode rosters. No dollar estimate, free
quota guarantee or spending authorization is implied.

Hosted validation must separately measure cache invalidation/executions, actual
transport, security work and total team usage before selecting production
warning or disable thresholds. User-visible idle attendance must not create
polling, heartbeat or same-value attendance writes.

Local native subscription execution and transport evidence is recorded separately in [local-subscription-verification.md](./local-subscription-verification.md). Its cache and coalescing observations do not replace the conservative arithmetic above or establish hosted quota headroom.
