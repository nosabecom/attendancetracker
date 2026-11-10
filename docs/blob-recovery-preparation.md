# Recovering the Blob snapshot

## Current update — 2026-11-10 UTC

**Latest:** one 56-student class roster, captured revision 2, is now preserved in
two independently verified private local files. A private CSV also round-trips
all captured names, student codes and internal IDs exactly. These are provisional
copies, not a complete frozen snapshot; no import or production switch occurred.

The owner reported upgrading Vercel and requested a new access check. The
dashboard now identifies the team as **Pro** and no longer displays the store's
suspension banner. A separately reserved, single production static-token origin
GET (`POSTUPGRADE1`) returned HTTP 200 and 2,694 bytes of complete JSON: the
selected class revision contains 56 students. Only aggregate evidence was saved;
the response body was transient. See the
[access evidence](./measurements/blob-post-upgrade-access.json).

This establishes access to that roster at that time, not a complete backup or
writer freeze. OIDC1 returned LIST 200; OIDCBODY1 returned LIST 200 / GET 403.
Both earlier allocations remain spent. Dashboard navigation/background traffic
is separate from this one explicit HTTPS request and was not independently
metered. No agent plan
change, rotation, store disconnect, bulk export or production switch occurred.

The owner's upgrade supersedes waiting for suspension expiry or a free courtesy
unblock. The previous suspended-store sequence below is historical preparation,
not an instruction to assume the store is still suspended. Before a consistent
export, recheck the deployment/environment-copy hold, establish how to freeze
all known live writers now that access has returned, and drain admitted work.
The project Git settings were rechecked after the successful read and still
explicitly say the project is not connected to a Git repository; no deploy hooks
can be configured in that state. This does not pause existing deployments.
The outstanding static/OIDC freeze questions and separate hosted/cutover gates
are not resolved by HTTP 200. Obtain Astra xhigh review of the changed recovery
sequence before executing credential changes or claiming a consistent snapshot.

Astra accepted a separate **private provisional preservation** attempt before
writer freeze, explicitly distinguishing it from a final consistent snapshot.
After reviewing current team credit and reserving `PROVISIONAL1` separately from
the unused frozen-export allowance, the unchanged bounded exporter ran once.
Its first LIST timed out before response headers: one metadata attempt, zero
object requests and zero consumed body bytes. No snapshot was published. The
[failed-attempt evidence](./measurements/blob-provisional-rescue.json) preserves
the accounting; the cause and provider-side processing remain unknown. Do not
retry this attempt, reset its files or claim any roster backup was saved.
After separate Astra xhigh execution acceptance at `cb76cc8`, `ROSTERRESCUE1`
ran once under a fresh one-GET / $0.05 engineering-credit allocation and current
team headroom review. The default transport returned HTTP 200 and a complete
2,694-byte roster with 56 students. Root verified the private attempt/provenance
agreement, two byte/hash-identical 0600 local files with distinct inodes, and
their owner-only directories. Neither file is an offsite backup. The
[safe outcome](./measurements/blob-known-roster-rescue.json) and
[one-roster record](./known-roster-rescue.md) preserve the separate accounting.
This allocation is spent; it must not be replayed. The frozen export remains
unstarted, and the captured revision is not proof of globally latest coverage.

The [project-firewall containment candidate](./blob-firewall-freeze-plan.md)
received a bounded read-only inventory, with
[seven explicit reads](./measurements/blob-firewall-readonly-inventory.json).
An initial CLI 403 was retained; owner-dashboard reads succeeded. The supported
CLI refreshed its expired stored access capability, and one further identity
read succeeded. CLI-internal refresh calls and browser background traffic are
separate and unmetered. No firewall rule or credential rotation was applied.

## Historical suspension and recovery investigation

Status on 2026-11-09 UTC (November 8 Saskatchewan): production remains on Blob;
the private store is suspended. One bounded origin-read retry returned 403.
No bulk export, credential rotation, store disconnection or unblock has been
performed. The Git repository connection has been temporarily removed as part
of the deployment hold; production's existing deployment remains in place.

The owner authorized contacting support. Usage case `CSE_015biYiwnR3FpTkS` is
Open, Severity 2. It requests a free recovery path and explicitly prohibits an
automatic unblock before writer freeze, an upgrade, a trial, payment or overages.

## Fastest candidate

The authenticated support agent offered a one-time free Hobby courtesy unblock.
This is a candidate, not established eligibility or human-confirmed policy.
If it works, freezing all legacy credentials and then exporting directly avoids
waiting for the displayed December 4 restoration date. A successful probe alone
does not permit a production switch.

The observed Store Settings page offers **Rotate Credentials**. Its text says
old-credential expiration may be delayed up to 30 days, connected-project
environment variables receive the replacement, and deployments require redeploy
to use it. Non-mutating dialog inspection confirmed the delay accepts zero hours
and then explicitly says **Old credentials expire immediately upon rotation**.
The dialog names the expected store and one connected project and requires typing
the store name to confirm. The confirmation field was left empty and the dialog
was canceled. No credentials were rotated.

The connected-project row identifies `attendance-tracker`, Production / Preview /
Development, `BLOB_READ_WRITE_TOKEN`, and an **Enable OIDC** action; its menu says
**Upgrade to OIDC**. This is evidence the displayed connection has not been
upgraded, not proof about every possible external OIDC principal. Do not enable
OIDC during recovery. The case page says it is awaiting a support-team response.

The project Git settings initially showed a connection to
`nosabecom/attendancetracker` and no deploy hooks. The
checked application source uses Blob only through `lib/storage.ts` and contains
no signed/client-token issuance. The checked repository workflows contain no
deployment command. These observations narrow the inventory; they do not rule
out externally configured workflows or retained credentials by themselves. The
owner subsequently confirmed **Only this project and our work here** use the
production token or deploy the app.

After that confirmation, the existing Git connection was removed through the
supported **Remove Git Connection** confirmation. The dashboard then stated the
project is not connected to a Git repository. The dialog said project settings
and configuration are preserved; branch-specific configuration tied to the repo
may no longer apply. The prior repo is recorded for later reconnection.

The project-wide Building, Queued, Initializing and Blocked status filters each
returned **No deployments match the current filters**. No cancellation was needed.
Latest pre-hold PR deployments, including `391bb65`, were already Ready. Our
manual deployment and environment-copy hold is active; no other deployer was
reported. This is an operational hold over the inventoried workflows, not a
provider guarantee that an owner could not override it. Recheck before rotation.

Further read-only inspection found **Don't build anything** under Ignored Build
Step, but skipped builds are not proof that deployment creation or environment
copying is prevented. No supported global creation hold was found in the
installed CLI/public schema. That skip-build setting was not applied. The Git
disconnect, empty pending-build checks and manual hold described above cover the
workflows identified by the owner; they do not freeze existing Blob credentials.

The cached first-party OpenAPI also describes a broader project deployment-source
policy: enabled with an empty source list denies selected production/preview
sources, but first-party Vercel Apps explicitly bypass that check. Its entitlement
and queued-build coverage have not been verified. This is a possible component,
not a demonstrated complete hold, and has not been applied. No independent
default-owner Blob-token retrieval endpoint was found in the installed CLI or
cached public API; the visible store **Show secret** control has not been used
as a replacement retrieval procedure.

The existing authenticated `vercel env run` production path successfully captured
the current static credential into an ignored 0600 file in a 0700 directory.
Local validation confirmed the exact expected store and file ownership without
displaying the credential or making any Blob metadata/object requests. This
establishes the current capture route and retains a pre-rotation comparison
credential; it does not prove a future replacement survives disconnect. One
explicit CLI capture invocation occurred; its internal control-request count
was not measured. No export budget was consumed by it.

Astra identified that this first capture could have inherited a local/process
override. A second baseline capture therefore ran from a newly created empty
0700 working directory, with an allowlisted process environment containing no
Blob/OIDC credentials, Vercel selectors, endpoint overrides or Node preload
options. The command explicitly selected `attendance-tracker`, the existing
team and `production`. It succeeded, and the captured token privately matched
the earlier baseline. This was one additional CLI invocation, with zero Blob
requests and unknown internal control-request count.

The private capture helper now optionally compares a replacement against an
owner-only baseline file and refuses to save an unchanged token. Use the same
clean-directory/environment procedure after rotation, with a new destination
and the clean old baseline as comparison input. Exact store format and file
permissions are still checked. A different string does not by itself establish
authorization; require the credential-bound request below before disconnecting.
Six no-network synthetic checks passed: private initial capture, rejection of
unchanged replacement, acceptance of a changed fixture, rejection of a public
baseline, no-overwrite preservation and rejection of a symlink destination.

A follow-up message was sent to the existing support case with the observed
zero-hour setting and legacy connection UI. It asks for free courtesy eligibility,
independent default-owner token retrieval, and store-wide OIDC authority/revocation.
The case still says it is awaiting a human response. No second case was opened.
Two explicit read-only requests to the dashboard-observed store metadata endpoint
confirmed one connected project and inspected its metadata shape, without
returning credentials or object names. The response did not expose an OIDC
authority/revocation flag. These were control reads, not Blob export requests.

The private journal reserves three single-attempt Blob metadata checks for the
planned static-key comparison (new before disconnect, old after rotation, new
after disconnect); none have been used. OIDC-specific probes need their own
reviewed bounds and cannot silently consume or increase that allocation. The
installed CLI's `vercel project token` can obtain a development token, but that
alone cannot establish production/preview revocation or store authority.

## Credential-bound development check

Astra accepted the operational hold and requested an explicit authentication
transport. `vercel blob get-store` and the dashboard store-metadata endpoint use
account authentication; their success cannot validate or revoke a Blob bearer.

The supported `vercel project token attendance-tracker --json` command has now
been invoked once with explicit team scope and the clean environment, capturing
stdout privately. Decoded claims match the expected project/team and development
environment, with approximately 12 hours remaining at capture. At capture, local
signature and Blob-authority verification had not occurred. The acquisition
itself made no Blob request; the separate check is recorded below. The command's
internal control-request count is unknown; it is separate from the three static
checks and exporter budget.

Vercel's [SDK authentication documentation](https://vercel.com/docs/vercel-blob/using-blob-sdk#authentication)
describes explicit OIDC credentials, static credentials and development-token
lifetime. It does not establish a store-wide disconnect/revocation guarantee.
Current SDK/source inspection found credential-bound listing and per-object
metadata reads; no independent credential-validation-only endpoint was found.

The [credential probe](../scripts/probe-blob-credential.mjs) therefore
uses the installed SDK's documented **list operation with limit 1**, through its
API-13 HTTP endpoint. It supplies only the chosen bearer and fixed store header,
with no account/OIDC/static fallback, retries or redirects. It may receive one
metadata row; it must never persist or display the row, name, URL or raw body.
No object-body download is part of this operation. Astra explicitly accepted
this alternative at `3516901`, replacing the earlier no-listing condition only
for the separately counted OIDC1 development check.

The development-only allocation was **one physical list request**,
separate from all prior checks, the three static checks and export. It has bounded
response/time limits and a non-reusable private attempt record. HTTP 200 with the
expected list response proves only that this bearer can list this store at that
time. Denial, expiry, suspension, timeout or generic error is not global OIDC
revocation evidence. Development cannot establish production/preview coverage.
The actual [OIDC1 evidence](./measurements/blob-development-oidc-probe.json)
records **HTTP 200**, one validated metadata row, 768 response bytes, exactly one
request and no object-body requests. Both private evidence files agree and
finalization succeeded. No row fields were saved or displayed. This establishes
development LIST capability despite the legacy connection's Upgrade button;
it does not establish write/body access, production/preview coverage or revocation.
**OIDC1 is spent. Do not retry or create another attempt path.**

Historical CLI contract for completed OIDC1; do not rerun:

```sh
node scripts/probe-blob-credential.mjs --run \
  --oidc-json PRIVATE_ACQUISITION_JSON \
  --output .convex/blob-recovery/development-probe-result.json \
  --attempt .convex/blob-recovery/development-probe-attempt.json
```

The probe caps response bodies at 16 KiB, headers and bodies at 15 seconds each,
and network time at 30 seconds. It takes credentials only from an owner-only
file and never refreshes the OIDC token. A later expired token or failed attempt
does not authorize minting another token, choosing a new attempt path or retrying.
The original 41 focused tests passed before the reviewed live run. The check
executed exactly that reviewed code; later offline diagnostic changes do not
alter the retained historical evidence or authorize another request.

Afterward, a message in the same support case reported development LIST acceptance,
the operational hold and the absence of object-body/write tests. It asks which
supported control revokes all existing/new OIDC authority across environments,
and whether a legitimate OIDC export path exists during suspension. If so,
recovery might avoid courtesy activation, but metadata acceptance is not proof
that such a body-read path works. The case still awaits a human response.

## Static-revocation diagnostics

The original probe discarded every 401/403 body. A subsequent offline change
retains only allowlisted provider error codes for static-token 401/403 responses,
under the same 16 KiB/time bounds. Installed SDK `getBlobError()` distinguishes
`store_suspended` from `forbidden`; arbitrary messages and unrecognized codes are
discarded. OIDC denial behavior remains unchanged. Ordinary completed 401/403
diagnostics remain inconclusive; oversized, stalled or missing denial bodies can
fail instead. Neither outcome declares credentials revoked or writers frozen.

The new 49-test focused suite passed locally. No static check has been run.
This change and OIDC1's actual evidence were accepted by Astra at `abc119d`.
In the eventual controlled
comparison, assess provider codes together with the confirmed immediate rotation,
explicit old/new credentials and successful fresh-key checks. A suspension,
generic error or ambiguous denial leaves the store suspended and stops recovery.

Astra recommended preparing a separately reviewed
[OIDC LIST + body check](./blob-oidc-body-probe-plan.md). That recommendation did
not itself allocate or run another request. Following code corrections and
explicit execution acceptance, OIDCBODY1 ran once at `d7a8a2d`: LIST 200, origin
GET 403, one request per stage. Both private outcome records agree. No object
data was accepted or saved, and no body capability was established. OIDC1 plus
OIDCBODY1 have now spent three requests (two LISTs, one object GET); all static
and export checks remain unused. The access investigation has stopped with no
retry, alternate object, fallback or remint. The limited result and request for
supported provider recovery were added to the existing case.

The installed Vercel CLI describes project pause as production traffic only.
Storage disconnect removes connections/environment configuration; it does not
prove static-token revocation. Neither mechanism alone freezes every old URL.
Store transfer explicitly says existing deployments retain access; do not use it
as a freeze.

## Proposed sequence for adversarial review

1. Keep suspension active. Recheck the exact production store, project
   connections and credential paths. Inventory any external/local writers.
2. Inspect the rotation confirmation without submitting it. Require explicit
   immediate expiration, with no grace. Establish how the replacement credential
   can be retained privately before invalidating the only known access path.
3. Hold automatic and manual deployment creation and environment-copy workflows
   before rotation. Settle or cancel queued builds and inventory any deployment
   created during the interval. Rotation copies the replacement into connected
   project environments, so disconnecting afterward cannot revoke a copy retained
   by a deployment created in between. A production traffic pause alone does not
   provide this hold. Do not push commits during this interval.
4. After that procedure is reviewed, rotate while suspended. Capture the new
   credential through the clean, explicitly selected production environment path
   into an ignored owner-only file; never expose it in arguments or logs.
   Require it to differ privately from the clean old baseline. Local/process
   overrides must be absent; store-ID matching alone does not prove freshness.
   Verify the captured key resolves the exact store before disconnecting. Failed
   capture or ambiguous verification leaves suspension intact.
5. Disconnect every store/project connection so new builds cannot acquire the
   replacement automatically. Verify saved old static credentials are rejected
   with bounded metadata requests and the retained exporter credential still
   resolves the exact store afterward. Require a credential-specific rejection;
   suspension-related 403, timeout, network error or generic SDK error does not
   demonstrate revocation. Pin each old/new static token explicitly. No write
   probes against the store.
6. Establish whether disconnect revokes existing project OIDC access. The chat's
   assertion is insufficient. Use supported provider confirmation or an exact
   owned-capability test without static-token fallback; an expired OIDC token is
   not a revocation test. Account for both issued and newly issued OIDC tokens,
   or establish that no such access was configured. If this or retained access is uncertain,
   stop while suspended and resolve it through the open case. Do not compensate
   by assuming project pause covers historical/preview URLs.
7. Once all writer paths are disabled, allow admitted operations to drain.
   Request/activate the free courtesy unblock once only if eligibility and no
   payment/plan-change terms are confirmed. A paid offer or denial stops this
   route; do not retry automatically.
8. Use a reviewed bounded wrapper that explicitly binds the retained credential
   and expected store, avoiding OIDC precedence. Enforce two total physical
   listing requests (one before and one after), at most 400 objects and one
   physical origin get per object, concurrency two, 2 MiB per object. Reject
   pagination/oversize inventory before downloading. Disable retries; cap headers,
   body and whole-run time; cancel and settle peers on failure. Preflight the
   exclusive private destination before network access, persist request
   reservations before dispatch, and retain failed attempts without resetting
   their budget. The prior inventory is 298 objects; a larger inventory requires
   reviewing the bound, not silently raising it. Save only to a new private
   snapshot in a 0700 directory, file 0600.
9. Keep the raw snapshot and an independent private backup. Two matching listings
   detect drift but do not replace writer freeze. Run the canonical transformer
   and reconcile all accounts, owner links, historical student IDs, rosters,
   sessions, facts and timestamps. Unknown shapes or count/content drift stop
   import. Obtain Astra xhigh review of actual evidence before proceeding.

The recovery-specific [bounded exporter](../scripts/export-blob-bounded.mjs) was
accepted by Astra xhigh at `9700eb5`, following 45 reported passing focused tests.
The review accepted code/preparation and withheld execution until the deployment,
capture/revocation, OIDC and free-eligibility gates are satisfied. It leaves the existing generic
exporter unchanged. It pins the installed Blob 2.8.2 protocol, binds the explicit
static token to the expected private-store hostname, and uses an owned HTTPS
transport with no redirects, SDK/OIDC fallback or retries. It stops if the
installed package version changes. This mirrors the installed client's request
format; no live compatibility test has been performed.

The wrapper limits are 400 objects, two total listing requests, two concurrent
object requests, 2 MiB per body, 64 MiB total received bodies, 15 seconds for
headers, 30 seconds per body and five minutes for the network run. File-system
operations can still fail or stall; deadlines are not an OS-level disk guarantee.
Each physical application request is reserved durably before dispatch. An
exclusive private attempt file prevents replay under that same attempt path;
choosing another path does not authorize another budget. Metadata pagination or
an oversized inventory fails before object downloads. Failed/canceled runs keep
their spent reservations, and a privately published candidate is not considered
successful if finalization fails.

The reviewed operator must create the 0700 backup directory and capture the
replacement token to a separate owner-only environment file before using the
following CLI contract. **Execution is still blocked by the provider/freeze
gates above; this is not a command already run.**

```sh
node --env-file=PRIVATE_EXPORT_ENV scripts/export-blob-bounded.mjs --run \
  --output .migration-backups/production-snapshot.json \
  --attempt .migration-backups/production-export-attempt.json
```

Do not pass token values in command arguments. The CLI prints only fixed error
codes and aggregate counts. It makes no network requests on import or failed
preflight. Preserve any failed attempt and review recovery before another run;
do not delete its evidence or choose a new path to reset the allowance.

## Historical suspended-store stop point

Do not rotate or remove the store connection yet: the clean capture and
credential-bound verification procedure still need their execution review.
Preparation does not require an independent token-read endpoint or a human reply
if supported capture/validation works. Free courtesy eligibility and full OIDC
coverage remain required before unblocking; a supported provider flow can supply
the former without a human. Keep suspension and the operational hold in place.
Git reconnection must not
permit a deployment to acquire a replacement exporter key; restore the repo
only after that key is isolated, or after a safely canceled recovery with no
credential rotation. Verify branch-specific configuration against the preserved
settings when reconnecting, and account for any deployment it could trigger;
reconnection cannot create an unallocated preview. Reconnecting here does not
authorize a production switch or restore an old deployment's revoked token.

## Separate cutover gates

Export recovery does not clear the remaining hosted Next configuration,
ingress/cookie/expiry checks, genuine current team-quota review, verified Convex
production import and final Astra approval. Preserve all prior hosted attempt
accounting. No third Vercel preview is allocated by this procedure. Keep the
unit suite until the full task and final approval are complete.
