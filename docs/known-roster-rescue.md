# One known roster: private provisional preservation

## Why this is separate

`POSTUPGRADE1` established a readable immutable class revision after the owner's
Vercel upgrade. It returned HTTP 200 and a complete 2,694-byte JSON object with
56 students, but the body was not saved. Its class association and revision were
observed through the authenticated dashboard before the read.

The separately allocated `PROVISIONAL1` whole-store preservation attempt failed
on its first LIST, before headers: one metadata attempt, zero object requests,
no snapshot. Its failure is retained in
[the evidence](./measurements/blob-provisional-rescue.json). The failure cause
is unknown. Do not retry that allocation or reset its files. The original
frozen-export allowance remains unused.

This proposed smaller operation preserves only the previously observed class
revision. It performs no directory listing, does not select another object and
does not establish the globally latest roster or a complete migration snapshot.
It needs separate Astra xhigh code/execution review and a distinct private
`ROSTERRESCUE1` allocation before execution.

## Proposed bounds

- Exactly one explicit static-token GET; no LIST, HEAD, redirect, retry, OIDC,
  credential fallback, alternate object or remint.
- Fixed production-store origin and class-version path shape. The already known
  class ID is supplied through private operator configuration, never committed
  to this public repository. The requested revision is 2 and `cache=0` is fixed.
- At most 16 KiB of headers and 64 KiB of response body; 15-second headers,
  30-second body and 60-second total deadlines.
- HTTP 200, complete transport EOF, duplicate-preserving header checks, identity
  encoding, Content-Length agreement when supplied, fatal UTF-8 decoding and
  complete roster JSON validation. Do not invent a LIST ETag comparison.
- Existing owner-only 0700 directory, exclusive 0600 attempt/output/provenance,
  durable request reservation before dispatch, no symlinks/overwrites and atomic
  private publication. Preserve exact bytes, student IDs and class association.
- Mark every output **UNFROZEN / PROVISIONAL / NON-CANONICAL / NOT CUTOVER-READY**.
  Require successful attempt and provenance before using the saved file as a
  rescued roster; a published file alone does not establish success.

The helper is `scripts/rescue-known-roster.mjs`; importing it performs no network
work. Root supplies the existing private production static credential directly
in memory, without environment fallback or a command-line secret. Public output
contains only fixed status/error categories and aggregate counts.

## Accounting and next action

The current team Usage page was reviewed for the November 10–December 10 Pro
period, including included credit, Blob operations and other infrastructure
usage. Exact private figures remain with the provisional allocation record;
the dashboard warns that usage can lag by one hour. This is a planning check,
not a provider billing guarantee. Recheck freshness before the new operation.
No overage, upgrade or additional paid feature is authorized.

Keep `ROSTERRESCUE1` independent of spent `POSTUPGRADE1`, `OIDC1`, `OIDCBODY1` and
failed `PROVISIONAL1`. Record its source, capture interval, outcome and one
request reservation in a new private single-use directory. On any failure,
preserve accounting and stop; do not choose a replacement pathname to rerun it.

On success, make and verify a second independent owner-only local file copy.
Report the **captured revision**, preserving identities. No import, activation,
teacher ownership inference or production switch follows automatically. Finish
writer freeze, a reconciled consistent snapshot, remaining hosted validation
and final Astra approval separately.
