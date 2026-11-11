# Convex cutover and recovery

Status: the final frozen Blob source and offline historical reconciliation are
complete and accepted by Astra. The legacy app remains held with revoked Blob
credentials. The bounded existing-production backend publication and three-phase
data import completed. Reads are enabled and writes disabled; actual import
evidence review, independent reconciliation, hosted validation and traffic
cutover remain pending.
This document is an operating procedure, not a record of completed cutover.
Do not enable Convex against an empty target or discard the old data.

## External prerequisites

**Latest result, November 10:** all 298 Blob objects are preserved in two verified
private local copies of the final frozen source. Every path, timestamp and parsed
value matches the independently reconciled provisional backup. See the
[frozen source evidence](./blob-final-frozen-export.md) and
[accepted operational drain](./blob-connected-drain-outcome.md). The original
final export allowance is spent. These are JSON-value captures, not original-body
archives or offsite backups. The deployment/environment-copy/operator hold remains
active; do not repeat Blob probes, rotation or export.

Hosted checks, production import/reconciliation and final cutover approval remain
incomplete. The following access observations are historical and do not override
the completed frozen-source milestone.


**2026-11-10 update:** the owner upgraded Vercel; the dashboard now shows Pro and
no suspension banner. One newly authorized production origin GET returned HTTP
200 and a complete 2,694-byte class revision containing 56 students. The
[safe evidence](./measurements/blob-post-upgrade-access.json) records the bounded
check; no roster body or complete backup was saved. Waiting for suspension expiry
or a courtesy unblock is superseded. Writer freeze/drain, consistent export,
private backup, reconciliation, remaining hosted checks and final Astra approval
are still required. The historical denied checks below retain their original
scope and accounting.

The subsequent separately allocated private provisional preservation attempt
timed out on its first LIST before headers, with zero object requests and no
published backup. Its [failure record](./measurements/blob-provisional-rescue.json)
is retained without retry. A smaller known-roster rescue is prepared for separate
review. That smaller rescue subsequently succeeded: one GET saved the captured
56-student revision and two private local files were verified independently;
see [the outcome](./measurements/blob-known-roster-rescue.json). This is
provisional roster preservation, not a complete historical snapshot. Read-only
firewall inventory completed, but no firewall containment has been activated.

The production Blob store was inspected on 2026-11-04. Its state was
`limits-exceeded-suspended`, with `usageQuotaExceeded: true`; a bounded private
read returned 403. Inventory showed 298 objects, approximately 31.69 KB. Metadata
access is not proof that the object bodies can be exported. Obtain supported
export access before the final migration. The owner authorized contacting Vercel
and the [access request](./blob-export-access-request.md) was sent through the
authenticated support chat on 2026-11-09 UTC. The dashboard confirmed usage case
`CSE_015biYiwnR3FpTkS` as Open, Severity 2. No human response or access exception is
confirmed. A chat-offered courtesy unblock has not been activated; see the
[recovery preparation](./blob-recovery-preparation.md).

Separately reviewed development OIDC checks also completed: metadata LIST was
accepted, but the bounded private origin GET returned 403. The
[body-check evidence](./measurements/blob-oidc-body-probe.json) records two
requests for that attempt; together with the earlier one-request OIDC check,
three OIDC requests were used. No object data or backup was saved. Investigation
has stopped without a further probe cycle; the same support case now contains
the final result. Git/manual deployment holds remain active. No credentials
were rotated and no store disconnect, unblock, export or cutover occurred.

A follow-up local diagnostic resolved the actual production environment through
the installed SDK: read-write authentication selected the expected store, with
no API URL override. The injected token was the normal read-write format, not an
encoded Config. The earlier private-read probe also used Blob's listed URL and
checked its hostname. This rules out the proposed address/config mismatch for
these checks; it does not identify the server-side reason for the 403. The
[safe diagnostic](./measurements/blob-auth-diagnostic.json) made no object requests
and retained no credential values.

A subsequent [cached-read probe](./measurements/blob-cached-read-probe.json)
used the supported private get with useCache enabled and the listed production
URL. It also returned 403. The script made one metadata lookup and one get call,
with no caller retry or saved body. This narrows the tested immediate options;
it does not establish that every provider-side route is unavailable. The exporter
can run under the owner's credentials once reads are restored. Contacting support
is an optional request for earlier access, not a prerequisite to running the
exporter. A support message has now been sent with the owner's permission; no plan
change has been made. It requests export-only access or a provider-side backup and
asks support not to restore writable access before the old writers are frozen.

Vercel's [Hobby usage policy](https://vercel.com/docs/vercel-blob/usage-and-pricing#hobby)
states that exceeding the allowance prevents Blob access and requires waiting
30 days before using it again. The owner's dashboard screenshots explicitly show
December 4, 2026 as the resumption date. The November 8 bounded retry still returned
403. Earlier export-only assistance remains unconfirmed. No supported early export
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
were closed and domain reads/writes disabled afterward. Astra accepted the actual
backend evidence; hosted Next ingress, cookies/IP and remaining expiry/browser
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

1. **Completed:** source/configuration review covers the same 50 known immutable
   deployments. Continue the no-deployment/no-environment-copy/operator hold.
2. **Completed:** the current export key succeeds and the old key is forbidden.
   A clean Production comparison confirmed the project's selected credential
   remains the old one. The connection was left intact to preserve the other
   store's separate Preview/Development binding. Containment covers known
   writers under the hold, not hypothetical global OIDC authority.
3. **Completed:** the 300-second interval, exact nonwriting control, complete
   overlapping logs and actual request classification left no unresolved
   admitted mutation. Keep its private evidence and failed-request accounting.
4. **Completed:** the original bounded export saved all 298 objects and an
   independently verified private backup. Its allocation is spent. Do not
   replace paths or reset allowances, and do not log source contents.
5. Prepare the production execution wrapper's dry run against the frozen source
   and a reviewed manifest binding the exact target, source and publication.
   Review private fingerprints and counts without printing credentials. Unknown
   or conflicting records require reconciliation rather than omission.
6. After separate execution approval, explicitly stage and verify through the
   production wrapper. Its immutable ledger must retain all previous requests
   and enforce cumulative call/write and 40-page verification ceilings before
   dispatch. Resume the persisted server checkpoint; reject a different source,
   target or ledger. Reconcile all accounts, rosters, IDs, ownership, sharing,
   sessions, check-ins, excuses and timestamps. Direct administrator writes
   during or after verification defeat that boundary and are prohibited.
7. Publish only the verified run through the wrapper's read-only phase with
   `migration:activate({ readOnly: true })`. Reads become available while writes
   remain disabled in the same transaction. Confirm maintenance availability
   before privileged reconciliation. Checkpoint queries remain usable during
   maintenance; login/session creation still requires write admission. Do not
   use the raw import CLI's older write-enabled activation default in production.
8. Deploy Next with `NEXT_PUBLIC_ATTENDANCE_BACKEND=convex`, the matching public
   deployment/site URLs and server gateway configuration. Legacy APIs return
   410 and cannot resume Blob writes. Users sign in once with their existing
   passwords; old Blob cookies are not converted.
9. Enable Convex writes using the internal maintenance control, run bounded
   teacher/student/permission checks, and record the time of the first accepted
   Convex write. This is the recovery boundary. Keep Blob writers revoked.

Production credentials stay in owner-only files selected by path; never put key
values in arguments, source control, logs or chat. The ordinary importer remains
available for isolated rehearsals, with loopback guards for local credentials.

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
