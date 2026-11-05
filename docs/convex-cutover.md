# Convex cutover and recovery

Status: implementation and local synthetic rehearsals; production still uses
Blob. This document is an operating procedure, not a record of completed cutover.
Do not enable Convex against an empty target or discard the old data.

## External prerequisites

The production Blob store was inspected on 2026-11-04. Its state was
`limits-exceeded-suspended`, with `usageQuotaExceeded: true`; a bounded private
read returned 403. Inventory showed 298 objects, approximately 31.69 KB. Metadata
access is not proof that the object bodies can be exported. Obtain supported
export access before the final migration. A prepared, unsent access request is
in [blob-export-access-request.md](./blob-export-access-request.md).

A follow-up local diagnostic resolved the actual production environment through
the installed SDK: read-write authentication selected the expected store, with
no API URL override. The injected token was the normal read-write format, not an
encoded Config. The earlier private-read probe also used Blob's listed URL and
checked its hostname. This rules out the proposed address/config mismatch for
these checks; it does not identify the server-side reason for the 403. The
[safe diagnostic](./measurements/blob-auth-diagnostic.json) made no object requests
and retained no credential values.

Vercel's [Hobby usage policy](https://vercel.com/docs/vercel-blob/usage-and-pricing#hobby)
states that exceeding the allowance prevents Blob access and requires waiting
30 days before using it again. The precise restoration time for this store and
any earlier export-only assistance remain unconfirmed. No supported early export
guarantee was found; cached reads are not an established suspension recovery path.

On 2026-11-04, the installed marketplace resource `convex-cyan-garden` was
verified available on billing plan `CONVEX_BASE` (Free), connected to
`attendance-tracker` in the existing Vercel team. The normal Marketplace flow
completed after the CLI-generated terms page had returned
`Missing billingPlanId for installation-only plan integration`.

The integration created a protected production `CONVEX_DEPLOY_KEY` in Vercel.
Vercel refuses to pull that Secret into local commands. A preview deploy key was
supplied through the private credential card; its project scope and management
access were verified. One disposable preview was created and its identity and
canonical URL independently checked. After actual team quota review and Astra
approval of the tooling, its limit, independent signing/gateway configuration and
functions were published. The bounded hosted backend rehearsal passed; clients
were closed and domain reads/writes disabled afterward. Actual evidence awaits
Astra review, and hosted Next ingress, cookies/IP and remaining expiry/browser
gates are outstanding. The application still uses Blob. Free installation does
not authorize a paid upgrade.

## Evidence before freezing writers

Finish adversarial review, build/type/security checks, maximum-size import,
auth expiry/refresh/revocation, headless UI and public gateway burst checks.
Review the actual team's allowances and other deployment usage. Allocate a
finite hosted request/concurrency budget; measure real subscription execution
and transport, gateway/security overhead and authentication rotation. Local
transaction samples do not establish a monthly cost or quota guarantee.

Provision separate development and production targets. Keep the production
target empty and closed. Deploy the reviewed schema/functions and the pinned
auth patch. Generate independent RSA signing keys and gateway keys/audiences per
environment. Signing keys live only in Convex; gateway keys live only in Convex
and the Next server. Never use deploy/admin keys as gateway credentials. Validate
actual cookie flags, trusted Vercel IP headers, endpoint admission, JWT/JWKS and
expiry behavior on the hosted runtime before cutover.

## Freeze and final import

1. Inventory every writer and all old deployment URLs. The production store's
   inspected connection was dedicated to this project, across production,
   preview and development. Recheck immediately before acting.
2. Freeze writes on the current deployment with
   `ATTENDANCE_BLOB_WRITES_DISABLED=1`. This flag alone does not stop old immutable
   deployments or old running functions.
3. Revoke every old store credential and, if present, its OIDC project access.
   Securely retain a new administrative export credential outside deployments.
   Verify old writers are rejected; wait for in-flight operations to settle.
   If the supported provider freeze/credential procedure is unavailable, stop
   here rather than relying on two listings to establish consistency.
4. Export using `scripts/export-blob.mjs` into an exclusive private file under
   `.migration-backups`. Keep the raw snapshot and an independent private backup.
   Do not log names, codes, credentials or raw validation payloads.
5. Run `scripts/import-blob.mjs --input PRIVATE_RAW --url TARGET` for a dry run.
   Review counts, the canonical fingerprint and source anomalies. Unknown or
   conflicting records require explicit repair/reconciliation, not omission.
6. Use the same input/target with `--apply --stage`, then separately
   `--apply --verify`. Interrupted staging resumes the persisted checkpoint;
   a different dataset is rejected. Avoid direct administrative database writes
   during or after verification. Reconcile accounts, all historical rosters,
   student IDs, ownership/sharing, sessions, check-ins, excuses and timestamps.
7. Activate only the verified run using `--apply --activate`. Immediately set
   `operations:setAvailability` to reads enabled/writes disabled, using the
   reviewed fingerprint, while performing final privileged reconciliation reads. New sign-ins also
   require write admission and remain paused in this state.
   Keep this target undisclosed before the read-only check; activation itself
   enables writes, so no public gateway may point to it during that interval.
8. Deploy Next with `NEXT_PUBLIC_ATTENDANCE_BACKEND=convex`, the matching public
   deployment/site URLs and server gateway configuration. Legacy APIs return
   410 and cannot resume Blob writes. Users sign in once with their existing
   passwords; old Blob cookies are not converted.
9. Enable Convex writes using the internal maintenance control, run bounded
   teacher/student/permission checks, and record the time of the first accepted
   Convex write. This is the recovery boundary. Keep Blob writers revoked.

The import CLI validates explicit targets. Local keys are accepted only for
matching loopback ports. Cloud keys come from `CONVEX_DEPLOY_KEY` in the command's
environment; never put them in arguments, source control or chat.

## Recovery after the first Convex write

After Convex accepts writes, the old Blob snapshot is stale. Pointing the app
back to Blob would lose accepted attendance and is not a recovery procedure.

Use the authoritative Convex deployment for forward repair:

1. Invoke internal `operations:setAvailability` with the expected canonical
   fingerprint, first disabling writes and, when needed, reads. This control
   requires exactly one active matching run and cannot activate an unfinished
   import. Domain mutations read the same control record, so its committed
   change forms a transaction boundary. Logout/security cleanup remain separate.
2. Take a private Convex snapshot with the official export CLI. Preserve code,
   deployment configuration, keys separately and the last accepted write time.
   Keep the original Blob snapshot too. Do not restore an older snapshot over
   newer accepted data.
3. Reproduce and repair against an isolated copy. Reconcile every attendance
   change after the cutover boundary, deploy compatible corrected code, then
   verify fresh authorized reads before restoring writes on the same dataset.
4. If forward repair is impossible, design and test a separate reverse export
   covering all newly accepted data before any return to Blob. That reverse
   migration is not implemented by the Blob importer and is not an automatic
   fallback. Keep writes disabled until it can preserve the accepted records.

Warnings/disable thresholds must reflect the interruption tradeoff and actual
remaining resource allowance. Free caps can interrupt service. Gateway rejection
still consumes hosting/invocation resources. Existing hosting and other team
projects need separate accounting.

## Final cleanup

Only after final Astra approval and completed migration, remove the unit suite
as Nosa requested. Keep meaningful backend integration and real-runtime checks,
update CI/scripts, and verify both the final build and dependency patch install.
Retain private migration backups; do not commit them.
