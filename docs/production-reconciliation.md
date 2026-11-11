# Independent production reconciliation

Status: offline implementation and synthetic tests only. The production import
milestone has been accepted by Astra. No live reconciliation requests have run.

The reader compares the frozen canonical source directly to the eleven populated
application tables, independently of the server-created migration receipts. It
resolves imported database IDs and compares credentials, owners, membership,
current and historical rosters, student identity/order, sessions, sparse facts
and original timestamps. Roster digests are recomputed with Node SHA-256. Extra,
missing, duplicate, dangling and changed records fail, including equal-count
replacements. Only database `_id` and `_creationTime` are ignored as business
values; the IDs still supply relationship checks. Outputs contain counts only.

`PRODUCTION_RECONCILIATION1` is a separate one-shot allocation: at most **17 HTTP
requests, including 15 queries, and zero writes**. Before dispatch, bind genuine
import/source/capability/quota evidence, exact production target, reviewed source
and comparator bytes, and the continuing privileged-write/deployment hold. Keep
the existing import and setup allocations intact. The private plan and empty
owned 0700 ledger must share the fixed parent
`~/.local/state/attendance-production-reconciliation`. Its exclusive permanent
allocation marker prevents a different ledger from resetting this run.

The sequence checks canonical identity, the completed import checkpoint and
read-only availability; reads each of the eleven tables once; then repeats
availability, checkpoint and canonical identity. Each page requests the expected
count plus one, and must be complete with the exact count. Documented optional
pagination diagnostics are validated; incomplete or unsupported responses stop
without pagination, retries or another target. The 357 table rows are compared
offline. Eight expected-empty tables already passed server verification; this
separate check does not claim to reread them.

Every request is reserved durably before dispatch. The fixed HTTPS transport
follows no redirects and retries nothing; headers and response bodies have byte
and time limits. These bounds describe intentional requests and accepted data,
not provider billing or transaction work. Sensitive responses remain only in
owned immutable 0400 files. Abort, timeout, mismatch and uncertain persistence
stop the run with expenditure retained. There is no resume, recovery or reset.

Success requires the supervising process to observe a normal zero exit without
cancellation, an intact matching ledger and receipt, and no `stopped.json` or
`stopped-sync.json`. A receipt alone is insufficient. Cancellation during receipt
persistence invalidates it; a synchronous exclusive failure-marker fallback is
attempted if asynchronous persistence fails. Permanent filesystem failure can
defeat both marker paths, so process failure must never be ignored.

These ordinary queries are not one atomic snapshot against privileged changes.
The before/after checks supplement the continuous operator hold. The run does
not enable writes, change configuration, publish, connect public traffic, or
approve cutover. Astra pre-execution review is required before this allocation.
