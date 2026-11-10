# Final Blob freeze after provisional preservation

Status: preparation for execution review. The complete provisional capture is
safe in two private local files; no credential has been rotated, no connection
removed, and no final frozen snapshot taken. The owner wants the full migration,
including historical attendance. The provisional capture must not become the
cutover source merely because it validates offline.

## Establish the known writers

The owner identified only this project and our work as token/deployment users.
Keep the Git disconnection and manual deployment/environment-copy hold until
credential isolation is complete. Recheck queued/building work and the complete
deployment inventory immediately before rotation. Stop on an unexpected writer.

## Current source and log observations

The separately reserved source-only capture used three fresh ownership reads,
three tree reads and 20 content reads: 26 explicit controls under a retained
66-request ceiling. All captured source hashes verified. Independent inspection
found every executable application/library leaf present (8/4/8 across the three
uploads), with literal SDK options, awaited mutations and no alternate auth,
environment injection or detached writer. The actual API tree wraps uploaded
source in `src/` and generated output in `out/`; package/lock/type configuration
under that wrapper was omitted. The partial result is preserved unchanged. A
separately reviewed continuation subsequently captured only the twelve missing
files, using retained identifiers without repeating discovery or prior content.
All 32 application/configuration files were independently reviewed; the three
SDKs resolve to the already-verified official 2.8.1 release, closing the known
source/authentication gap. See the [original partial evidence](./measurements/blob-cli-source-capture.json)
and [continuation evidence](./measurements/blob-cli-config-capture.json).

One separate preparatory log read (`LOGSCOUT1`) returned seven records in its
one-day lookback: six static GETs and one function GET. The function returned
500, but its recorded public-metadata query and exact deployed source establish
a read-only branch. It is not an observed failed mutation. No mutation request
appears in the returned page, and pagination was exhausted. The actual function
event also reports a 300-second limit. Exact query timestamps were not separately
persisted; this observation is not the final drain boundary. See the
[log evidence](./measurements/blob-pre-freeze-log-scout.json).

Vercel documents runtime logs for function invocations in production and preview,
including request IDs, invocation details and response status. Ordinary Pro
retains one day; upgrading does not supply older days beyond that retention.
Its [runtime-log reference](https://vercel.com/docs/logs/runtime) and
[first-party tutorial](https://vercel.com/academy/vercel-foundations/logs)
describe request coverage and real-time streaming, but do not specify an
ingestion watermark or maximum delay. Do not equate page exhaustion with that
unprovided guarantee. There is no identified unresolved mutation in the observed
page; do not misclassify its read-only500 as a pending write.

The owner-scoped metadata inventory covers 50 Ready deployments: every returned
runtime/build environment name list contains the static Blob token and none
contains `BLOB_STORE_ID`. That is evidence about effective variable names, not
their values. Public-source inspection covers 47 deployments across 46 commits
and the two resolved Blob SDK versions. It found no explicit OIDC/store-ID
selection, signing/client-token issuer, server background writer or build-time
environment injection. Three dirty CLI uploads were initially unresolved: their base
commit is not proof of the uploaded code. Their actual application and
configuration capture has now closed that source gap; see the
[independent review](./measurements/blob-known-writer-source-review.json).

The three actual source closures were retrieved through the documented owner
APIs under separately reviewed finite source-only allowances.
Keep unpublished code private, do not execute it, and do not fetch environment
or credential files. A partial closure, unknown SDK/auth path, denied request or
unresolved executable dependency leaves this gate open. Global revocation of
hypothetical OIDC principals is unnecessary only after all known writers and
operator-held capabilities are contained.

## Isolate the exporter credential

After source evidence and this procedure receive Astra review:

1. Record the exact owned store, project, active connections, deployment list,
   no pending builds and hold. Reserve the three unused static authentication
   checks and the separate final export allowance without resetting old work.
2. In the supported store rotation dialog, require zero grace and the explicit
   immediate-expiration statement. Retain the old static credential privately;
   never print a credential, paste it into command arguments or copy it into a
   deployment. Record the acknowledgement and time of the one rotation.
3. Capture the replacement using the already-tested clean `vercel env run`
   production path: empty private cwd, allowlisted environment, explicit owned
   project/team/production, no inherited Blob/OIDC override. Save exclusively to
   a new private file. Require the expected store and a value different from
   the retained baseline. Capture failure stops further changes.
4. Use the reviewed credential-bound one-row LIST probe for the replacement,
   then the old token: one request each, no retry, redirect or fallback. Require
   replacement success and old-token credential-specific rejection. Evaluate
   allowlisted provider diagnostics with the observed zero-grace rotation;
   suspension, generic failure or an expired OIDC bearer is insufficient.
5. Remove the existing store/project connections through the supported flow.
   Keep the deployment/environment-copy hold throughout the rotation interval;
   inventory any intervening deployment rather than assuming disconnect revokes
   its copied key. Use the third reserved static check to require the retained
   replacement still works after disconnect. Do not distribute it back to the app.

Failure after rotation no longer leaves a suspended store as a safety boundary.
Preserve the actual changed state and private replacement, keep the hold, and
stop further export/cutover if writer authority or retained access is uncertain.

## Drain and reconcile

All inventoried runtime configurations report a 300-second function timeout.
For the publicly audited source, every Blob mutation is awaited; no detached
server work was found. These facts do not alone prove that an already-admitted
Blob write has completed after a function times out or is terminated.

The exact drain verification still needs execution review. Its evidence must
distinguish completed requests whose awaited operations were acknowledged from
timeouts, cancellation, failed requests or unknown downstream work. Complete
returned log pages and a successful visibility control can support observation;
neither an empty page nor elapsed time supplies a provider ingestion watermark.
Any unresolved admitted write remains a blocker. Do not replace this gate with
an arbitrary sleep or silently call the provisional copy frozen.

Once the reviewed drain criterion is satisfied, run the unchanged bounded
exporter under the original unused final allocation: two LISTs, at most 400
GETs, explicit retained key, existing response/deadline/concurrency caps, and
exclusive owner-only attempt/output paths. Matching inventories detect drift;
the independent writer freeze is the consistency basis.

Verify a second private local copy, transform offline, compare all historical
identities/credentials/rosters/ownership/sharing/facts/timestamps directly, and
explain any difference from the provisional capture. Obtain Astra's milestone
review before importing or activating production.

After isolation and the final snapshot, resolve Git restoration and hosted
publication as a separate stage. Do not create the third hosted preview during
the unresolved freeze interval. Keep Blob credentials revoked through cutover;
any accepted new Blob attendance would require a new reconciliation boundary.
