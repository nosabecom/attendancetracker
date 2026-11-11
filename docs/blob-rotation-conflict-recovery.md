# Stopped rotation and one diagnostic proposal

Status: ISOLATION1 stopped after its first rotation submission. The observed
`/reset` response was HTTP 422. The UI reports that secrets were applied to zero
of one project connections because of conflicting environment variables, and
that those connections keep old secrets. This does not establish whether the
store credential generation itself changed. No rotation retry, connection
removal, capture CLI invocation or static LIST check followed.

The complete preflight metadata exposes the conflict: the target store's
`BLOB_READ_WRITE_TOKEN` variable targets Production, while a second variable with
that name targets Preview and Development and references a different store.
The target store's connection UI nevertheless advertises all three environments.
Preserve that other store's variable; do not overwrite or remove it to make
rotation succeed. See the [stopped-attempt evidence](./measurements/blob-isolation-rotation-conflict.json).

## Non-mutating inspection completed

The connection's Configure dialog supports environment selection, prefix,
sensitivity and an optional RW token. It advertises RW, store-ID and webhook
variables. No settings were changed or saved. Do not assume that a scope change
cannot affect other managed variables or future OIDC selection.

The store's Quickstart `.env.local` tab exposes a supported **Show secret** and
**Copy Snippet** control. Neither was invoked; no secret was revealed or copied.
This is a possible supported owner-only retrieval path if the project retained
the old credential. It has not been used as a fallback or proven to retrieve the
new generation. Protected Vercel Secret readback/conversion remains prohibited.

## Completed diagnostic

`ROTATIONDIAG1` completed once: one LIST, HTTP 403, allowlisted provider code
`forbidden`, and 57 consumed response-body bytes. The helper conservatively
reports `auth_denied_inconclusive`. Root verified agreement between its returned
record, private attempt/result, and root outcome. No original static check was
consumed. The additional $0.01 engineering reservation brings retained planning
reservations to $0.81; this is not a billing cap. This diagnostic does not prove
the current credential, writer freeze or permission for a rotation retry.

See the [diagnostic evidence](./measurements/blob-rotation-old-key-diagnostic.json)
and the [owner-UI capture proposal](./blob-owner-key-recovery.md).

## Historical diagnostic proposal

The accepted proposal was **one separately reserved old-credential
LIST(limit=1)** using the unchanged `probeBlobCredential` API/default transport,
the retained clean production RW baseline, and exact target store. Use new
exclusive owner-only attempt/output paths and persist its entire one-request
reservation before dispatch. Preserve the original three ISOLATION1 checks,
which remain assigned but unused; this diagnostic does not borrow or reset them.

No object GET, HEAD, alternate object/token, redirect, retry, refresh or write
probe is included. Keep the existing 16 KiB response and 15/15/30-second limits.
Retain all prior accounting and reserve $0.01 of additional engineering headroom
after a genuine current credit check, alongside the existing $0.80. This is a
planning reservation, not a billing cap or authority for overages.

An accepted 200 establishes that the old credential still works for this list
operation. A 401/403 plus allowlisted provider diagnostics narrows the state but
remains inconclusive without a successful current-key comparison. Any timeout,
invalid response, cancellation or persistence failure ends this diagnostic.
No result alone declares writer freeze, final drain or permission to retry
rotation or edit the connection.

After observing that single result, choose the smallest supported recovery:
either resolve only the production connection's incorrect environment scope
while preserving the separate Preview/Development binding, or retrieve the
current store credential through its supported owner UI if rotation applied.
That exact mutation/capture contract needs review before execution. Keep the
operator/deployment/environment-copy hold active; the complete provisional
backup remains safe and no production cutover has occurred.
