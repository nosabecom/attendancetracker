# Admission contention correction — proposed for adversarial review

The local real-gateway test admitted 962/1,000 students at concurrency 20.
Bounded logs showed `throttleCounters` OCC conflicts. Per-request attribution of
all failures is unavailable. Do not treat the current admission path as ready.

The current mutation writes a shared school-IP counter and a shared IP/session
counter for every check-in. It also reads/deletes the same global expired-record
ranges during opportunistic cleanup. Both paths can serialize independent users.

Proposed correction:

- Keep exact identity admission (12 per IP/identity/15-minute bucket), atomic
  nonce redemption and credential-entry limits. Do not change password work or
  attendance facts/idempotency.
- Partition only broad check-in IP and IP/session counters into 64 independent
  quotas. Select the partition using the last 32 bits of the proof nonce modulo
  64. Next generates and signs random nonces; browsers cannot choose them. The
  Convex receiver verifies the signature before admission. This does not depend
  on client-selected student names being well distributed.
- Preserve exact aggregate ceilings by distributing remainders: an IP partition
  receives 157 permits for the first 16 partitions, otherwise 156 (total 10,000).
  An IP/session partition receives 47 for the first 56, otherwise 46 (total
  3,000). Identity limits stay exact. These are application admission ceilings,
  not monetary spending limits.
- Never sum/read all partitions on each admission; doing so recreates global OCC
  dependencies. Each request touches only its selected broad counters, its own
  identity counter and its nonce. If the primary broad-counter partition is
  exhausted, allow one deterministic, distinct alternate drawn from other nonce
  bits. Read at most two partitions per broad limit, never all 64; commit only
  one chosen increment per limit. This preserves the total ceiling and improves
  fairness near exhaustion, while still permitting early rejection before all
  aggregate capacity is consumed.
- Add optional partition fields and partition/expiry indexes on security tables.
  Mark new nonce/counter records, preserving a counter's initial cleanup
  partition during updates. Cleanup reads/deletes only the request's partition
  with the existing bounded page limit. Expired records from old unpartitioned
  versions require a separate bounded administrator cleanup; they must not
  remain on every request's read/write path. New production import has no live
  old throttles/nonces, which were archived rather than migrated.
- Map unexpected server/OCC failures to a static 503, while malformed JSON/input
  remains 400. Do not hide server contention as a student validation error, and
  do not introduce automatic client retries.

Tradeoffs to test: a partition can exhaust before aggregate capacity, and nonce
probability affects local fairness. The one-arrival 1,000-student school envelope
has substantial headroom relative to 46–47 per partition; this must pass a new real
gateway run, including cleanup-heavy state and 15-minute boundary behavior.
Sustained same-identity abuse can still contend on that identity's exact counter;
its allowance is intentionally small. Multiple IPs/identities can still consume
resources. Cleanup still has total work proportional to retained security rows.

Reject simplistic alternatives: summing every shard keeps global dependencies;
only sharding one of the two broad counters leaves the other hot; moving limiter
state into attendance invalidates teacher queries; retrying failed requests
increases work without removing contention. Maintained limiter components or
bounded permit leasing deserve comparison if they give a materially stronger
supported contract at lower total complexity/cost.

Before cutover, review security bounds and rounding, nonce trust, cleanup range
isolation and legacy upgrade behavior. Then rerun unit/integration gates, the
bounded actual shared-IP burst, and the cost sampler. Update diagnostics/cleanup
fixtures for the new key layout; preserve original failed-run evidence.

A future upgrade from live unpartitioned counters requires a frozen admission
window or an explicit bucket-rollover policy; independent old/new counter
namespaces must not silently double an existing live allowance. The initial
Blob migration imports no live security state, so production starts empty.

## Adversarial review conditions accepted for implementation

Use alternate `(primary + 1 + parseInt(first8hex,16) % 63) % 64` and avoid signed
bitwise arithmetic. The identity limit is per IP/session/normalized submitted
text, not per actual student; name/code aliases can occupy different counters.
Validate its 64-character lowercase hex internal representation, and normalized
credential usernames, before reservation work. Validate every allowance before
any write; a rejected reservation must consume nothing and run no cleanup.

Use random production-shaped nonces in the real burst, with an exact bounded
inventory for cleanup. The old sequential suffixes would manufacture balanced
partition selection and cannot support the new design. Preserve the old failure.
The acceptance budget is at most 3,200 public requests: baseline30, fresh1000 at
concurrency20, cleanup-heavy1000, one planned fresh-proof duplicate per student
in the cleanup-heavy session, plus bounded controls. Keep the intended duplicate
fairness window in one fixed bucket; do not silently skip it at rollover.

Measure partition occupancy, primary/fallback behavior and maintenance separately.
If partitioned inline cleanup still fails the cleanup-heavy gate, move bounded
expiry maintenance outside admission before considering more partitions/retries.
Provide an internal bounded expiry drain for both legacy and partitioned rows;
opportunistic cleanup alone gives no idle retention deadline. Keep all still-usable
nonces through the inclusive proof window, including future clock allowance.
Reservation success and attendance success are separate: downstream failure
retains consumed permits and nonce, with no non-atomic refund.

For a future upgrade of live counters, freeze/drain and preserve consumed capacity
or stay frozen through the old bucket's end. A short freeze followed by new empty
counters in the same bucket would double that bucket's available allowance.
