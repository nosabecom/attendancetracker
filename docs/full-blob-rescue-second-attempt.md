# Proposed second complete provisional preservation attempt

Status: the separately reviewed attempt succeeded on November 10. All 298 listed
objects are preserved in two verified private local files. Offline transformation
validated 3 accounts, 2 classes, 7 sessions, 180 check-ins and 18 excuses. All
reported relationship reconciliation counters are zero. This remains an unfrozen
provisional copy; no import or production switch occurred. See the
[outcome evidence](./measurements/blob-provisional2-rescue.json).

The snapshot preserves parsed JSON values, not byte-for-byte original Blob body
serialization. The second file independently matches the first by bytes and hash;
both files are owner-only, use distinct inodes, and are local rather than offsite.

The preparation below records the reviewed allocation and its limits.
Nosa now requires the full historical migration by Wednesday, November 11,
rather than a fresh-class launch. Only one captured 56-student revision has been
rescued. Keep current Pro access active until the full required backup is verified.

## Preserve the failure honestly

`PROVISIONAL1` failed its first LIST before headers, with one metadata attempt,
zero object requests and no published snapshot. Its cause remains unknown.
There has been no automatic retry. Its files, outcome and accounting remain
unchanged. Source inspection found no SDK URL/header compatibility defect; do
not describe this new attempt as a proven fix.

This proposal deliberately requests **one additional complete preservation
attempt**, `PROVISIONAL2`, under a separate reviewed allocation. It is a new
whole-run attempt after the failure, not an assertion that no retry has ever
occurred. Per-request automatic retries, fallback and polling remain prohibited.
No existing attempt or pathname may be reset or overwritten.

## Same reviewed code, finite scope

Use `scripts/export-blob-bounded.mjs` unchanged, with its default controlled
transport and the explicitly loaded existing production static credential.
Verify its bytes match the already-reviewed source before execution.

- At most two physical LISTs and 400 object GETs, concurrency two.
- At most 2 MiB per object and 64 MiB total accepted response bodies, with the
  existing 15-second headers, 30-second body and 300-second run deadlines.
- Exact production-store binding; no redirects, automatic retries, alternate
  credentials, SDK ambient OIDC, pagination or endpoint changes.
- Exclusive unused private output/attempt paths in an owner-only 0700 directory;
  files 0600. Reserve the new attempt durably before dispatch.
- Preserve the existing before/after inventory equality check. Drift or any
  failure stops this attempt without a replacement pathname or another attempt.

Recheck current Pro identity and included-credit headroom before dispatch.
Reserve $0.25 of engineering headroom separately, retaining earlier reservations
and the original unused frozen-export allowance. This is not a provider billing
cap or authority for overages, another plan change, or additional paid features.

Across `PROVISIONAL1` and this proposed attempt, the maximum is three LIST
attempts and 400 object GETs because the first attempt downloaded no objects.
`POSTUPGRADE1`, `ROSTERRESCUE1`, earlier OIDC checks, dashboard background work,
deployment-control audits and CLI-internal calls remain separately accounted.

## Interpretation and next work

Mark both snapshot and private provenance **UNFROZEN / PROVISIONAL /
NON-CANONICAL / NOT CUTOVER-READY**. Success would preserve all objects returned
by the matching inventories; it would not establish a globally consistent
historical snapshot while legacy writers remain possible. Do not import,
activate, switch production or advise an immediate downgrade based on this
provisional copy alone.

On success, preserve and verify a second independent private local file and
inspect/transform the capture offline. Preserve unknown record shapes in the raw
backup and stop canonical reconciliation rather than silently omitting them.
Historical code included dashboard-lease records; handle them explicitly if
present. A final frozen, reconciled capture remains required before cutover.

On failure, retain all accounting and stop further identical attempts. Review
the transport/provider access path before proposing another mechanism. The
already rescued roster remains protected independently.
