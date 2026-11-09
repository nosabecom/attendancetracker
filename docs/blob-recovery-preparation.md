# Recovering the suspended Blob snapshot

Status on 2026-11-09 UTC (November 8 Saskatchewan): production remains on Blob;
the private store is suspended. One bounded origin-read retry returned 403.
No bulk export, credential rotation, disconnection or unblock has been performed.

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
to use it. Rotation has not been invoked. A zero-grace setting and the actual
confirmation need inspection before execution.

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
3. After that procedure is reviewed, rotate while suspended. Capture the new
   credential through the existing authenticated production environment path
   into an ignored owner-only file; never expose it in arguments or logs.
4. Disconnect every store/project connection so new builds cannot acquire the
   replacement automatically. Verify saved old static credentials are rejected
   with bounded metadata requests and the retained exporter credential still
   resolves the exact store. No write probes against the store.
5. Establish whether disconnect revokes existing project OIDC access. The chat's
   assertion is insufficient. Use supported provider confirmation or an exact
   owned-capability test. If this or retained-credential access is uncertain,
   stop while suspended and resolve it through the open case. Do not compensate
   by assuming project pause covers historical/preview URLs.
6. Once all writer paths are disabled, allow admitted operations to drain.
   Request/activate the free courtesy unblock once only if eligibility and no
   payment/plan-change terms are confirmed. A paid offer or denial stops this
   route; do not retry automatically.
7. Use the reviewed exporter with an explicit fresh token supplied to each SDK
   call, avoiding OIDC precedence. Bound the run to two metadata pages/list
   passes, at most 400 objects and one logical origin get per object, concurrency
   two, 2 MiB per object. The prior inventory is 298 objects; a larger inventory
   requires reviewing the bound, not silently raising it. Account for any SDK
   internal retries separately; a logical-call bound is not a physical-request
   guarantee. Save only to a new private snapshot in a 0700 directory, file 0600.
8. Keep the raw snapshot and an independent private backup. Two matching listings
   detect drift but do not replace writer freeze. Run the canonical transformer
   and reconcile all accounts, owner links, historical student IDs, rosters,
   sessions, facts and timestamps. Unknown shapes or count/content drift stop
   import. Obtain Astra xhigh review of actual evidence before proceeding.

The bounds above are a proposal for the eventual run; the exporter currently has
no global object-count or physical-attempt cap. Add a reviewed wrapper before
execution. Do not claim these caps are already enforced.

## Separate cutover gates

Export recovery does not clear the remaining hosted Next configuration,
ingress/cookie/expiry checks, genuine current team-quota review, verified Convex
production import and final Astra approval. Preserve all prior hosted attempt
accounting. No third Vercel preview is allocated by this procedure. Keep the
unit suite until the full task and final approval are complete.
