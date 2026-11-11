# Production import preparation

Status: implementation accepted conditionally. The production key was privately
captured through the separately reviewed recovery, and the bounded existing-target
backend publication completed. Astra accepted its actual evidence, and the real
ready manifest was bound to that publication and the frozen source. All three
production import phases then completed with writes disabled. Independent
semantic reconciliation, hosted validation and cutover are next; no traffic
switch was performed.
The [final frozen source](./blob-final-frozen-export.md)
is preserved; root recalculated and bound the same counts and bytes below before
the completed run.

The preserved frozen snapshot produces seven deterministic import chunks,
357 target documents and 723 expected retained documents including migration receipts,
chunk receipts and deployment/run state. Reusable roster versions contain 132
student rows; the 320 historical per-session rows reuse those versions.
Serialized operation payloads total 41,252 bytes; the largest is 16,290 bytes.
These JSON sizes do not establish Convex storage, index size or billing.

Planning estimated 21 minimum verification pages. The reviewed finite ceiling
of 40 pages allowed 55 application calls through confirmed read-only state and
774 logical document-write reservations, using the formulas
`K + V + 8` and `2D + 2K + V + 6`. This was a **separate production allocation**,
with no use of a preview ledger's unused margin. Actual completion required
21 verification calls, 36 application calls and 755 logical-write reservations.
The underlying importer's verification loop does not enforce that proposed ceiling;
the separately reviewed [execution wrapper](./production-import-execution.md)
now reserves and enforces it before every dispatch, including interruption/resume.
Publication, configuration, independent reconciliation, provider retries and
authentication/hosting traffic are excluded and need their own accounting.
Every count and byte size was recomputed from the final frozen snapshot before
execution; the private planning record binds this calculation to the preserved
frozen input without publishing identities, credentials or fingerprints.

The offline backend review found that initialization and begin enforce an empty,
closed application/auth/import target. Existing-target CLI selection can bind
the verified canonical production URL and opaque deployment capability through
a private env file. No preview claim or new deployment selector is necessary.
Private signing keys and gateway credentials must be independent of previews.

The production wrapper must publish with `migration:activate({ readOnly: true })`.
That option enables reads while leaving writes disabled in the same transaction;
an interruption cannot leave a write-enabled interval between two requests.
The ordinary import CLI retains its previous activation default for existing
callers and must not be used for production activation. Keep the public application
away from this target until the remaining validation finishes. The wrapper also
sets read-only availability idempotently and confirms through
`operations:availability`. Internal `migration:status` now accepts valid active
maintenance/read-only state, allowing the same ledger to resume safely.
After the first accepted new production write, recovery requires forward repair
or reverse export rather than returning to a stale Blob snapshot.

Hosted Next/cookie/IP/JWT/refresh/expiry provenance, production reconciliation and
final Astra approval remain required. The frozen source is reconciled; no
traffic cutover has been executed or authorized by this document. The
[existing-backend setup](./production-backend-setup.md) records actual publication
and its separate accounting. The [completed import](./production-import-execution.md)
records actual initialization, staging, server verification and read-only
activation; it does not establish hosted readiness or independent reconciliation.
