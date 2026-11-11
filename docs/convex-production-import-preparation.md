# Production import preparation

Status: offline planning only. No production Convex key, publication, data import
or traffic switch was performed. The [final frozen source](./blob-final-frozen-export.md)
is now preserved; its recalculated plan confirms the same counts and bytes below.
Production execution is still pending its own reviewed, enforced allocation.

The preserved frozen snapshot produces seven deterministic import chunks,
357 target documents and 723 retained documents including migration receipts,
chunk receipts and deployment/run state. Reusable roster versions contain 132
student rows; the 320 historical per-session rows reuse those versions.
Serialized operation payloads total 41,252 bytes; the largest is 16,290 bytes.
These JSON sizes do not establish Convex storage, index size or billing.

The current plan has 21 minimum estimated verification pages. A proposed finite
ceiling of 40 pages would give 55 application calls through confirmed read-only
state and 774 logical document writes, using the reviewed formulas
`K + V + 8` and `2D + 2K + V + 6`. This is a **separate future production
allocation**, not permission to spend a preview ledger's unused margin.
The current importer's verification loop does not enforce that proposed ceiling;
the reviewed execution wrapper must reserve and enforce it before any dispatch.
Publication, configuration, independent reconciliation, provider retries and
authentication/hosting traffic are excluded and need their own accounting.
Recompute every count and byte size from the final frozen snapshot before
execution; the private planning record binds this calculation to the preserved
provisional input without publishing identities, credentials or fingerprints.

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
production publication or import has been executed or authorized by this document.
