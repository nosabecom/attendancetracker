# Recovering the suspended Blob snapshot

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
   credential through the existing authenticated production environment path
   into an ignored owner-only file; never expose it in arguments or logs.
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

## Current stop point

Do not rotate or remove the store connection yet. Free courtesy eligibility and
the store-wide OIDC/replacement-credential procedure remain unconfirmed. Keep
the suspension and recorded operational hold in place until these gates can be
resolved and the actual freeze sequence reviewed. Git reconnection must not
permit a deployment to acquire a replacement exporter key; restore the repo
only after that key is isolated, or after a safely canceled recovery with no
credential rotation. Reconnecting here does not authorize a production switch.

## Separate cutover gates

Export recovery does not clear the remaining hosted Next configuration,
ingress/cookie/expiry checks, genuine current team-quota review, verified Convex
production import and final Astra approval. Preserve all prior hosted attempt
accounting. No third Vercel preview is allocated by this procedure. Keep the
unit suite until the full task and final approval are complete.
