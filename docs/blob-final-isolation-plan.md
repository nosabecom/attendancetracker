# One final isolation and frozen capture

Status: preparation for Astra execution review. All 50 known deployment
source/configuration/authentication paths are reviewed. No Blob credential has
been rotated and the store remains connected. The full provisional data copy is
preserved independently in two private local files.

The first execution preflight stopped locally after one owned-project GET and
before mutation because its timeout predicate used the wrong project field.
The [narrow correction](./blob-isolation-preflight-correction.md) retains that
request and proposes one additional read; it does not reset this allocation.

## Completed prerequisites

- The [twelve-file continuation](./measurements/blob-cli-config-capture.json)
  succeeded once: 12 GETs, all hashes verified, and 38 source controls within
  the original retained ceiling of 66. Earlier partial evidence is unchanged.
- The [independent source review](./measurements/blob-known-writer-source-review.json)
  closes all 50 known application paths: 42 deployments use Blob 2.8.2, eight use
  2.8.1. Callers and complete environment-name inventories select static RW
  authentication. No detached server writer was found.
- The current supported rotation dialog was inspected without submitting it:
  setting zero hours explicitly states that old credentials expire immediately.
  Confirmation was left empty and the dialog canceled. The store still shows
  one legacy RW project connection across Production, Preview and Development.
- A source-proven nonwriting `/api/auth` control on the owned production domain
  returned its exact expected 401 JSON without cookies or authorization.
  The [complete pre-isolation day window](./measurements/blob-drain-baseline.json)
  contains that correlated invocation. Both returned function requests are
  source-proven read-only, with zero unclassified mutation candidates.

The owner identified only this project and our work as credential/deployment
users. Git disconnection and the manual deployment/environment-copy hold stay
active. This covers known operators; it is not a claim that an owner cannot
override the hold.

## Finite operating allocation

Prepare one private `ISOLATION1` record before mutation, with immutable action
reservations and outcomes. Keep all existing allocations and failures intact.

| New work | Maximum |
| --- | ---: |
| Owned project + complete deployment reads, before and after isolation | 4 |
| Project environment metadata before and after removal, `decrypt=false` | 2 |
| Post-window nonwriting application control | 1 |
| Post-window owner/project log pages, no filters or repeated page | 10 |
| Supported zero-grace rotation submission | 1 |
| Supported removal of the one owned store/project connection | 1 |
| Clean production credential-capture CLI invocation | 1 |

Thus new explicitly controlled read HTTP requests are at most 17. Browser
background traffic, UI mutation internals and capture-CLI internals are separate
and are not represented as one physical request per gesture/invocation.
The earlier log scout, control and baseline each used one separately recorded
request. Unused pagination/source margins authorize no unrelated work.

Use the **three original unused static authentication checks** separately:
replacement before disconnect, old after rotation, replacement after disconnect.
Each is one explicit credential-bound LIST with limit one and no retry,
redirect, fallback or object read. The original final frozen-export allocation
also remains unchanged: at most two LISTs and 400 GETs under the reviewed
bounded exporter. Existing $0.80 planning reservations include the final export;
recheck real Pro headroom and retain prior reservations. No overages, plan
changes, paid features, hosted creation or support action are part of this phase.

## Execute only after scoped acceptance and fresh root gates

1. Require the reviewed clean source, owner-only unused phase/output/attempt
   paths, retained old baseline and supported capture helper. Refresh exact
   project/team, disconnected Git, 300-second runtime configuration, no pending
   builds, stopped local/operator writers and the complete deployment set.
   Require the same 50 known IDs. Inventory the store-managed project variable
   metadata across targets without requesting decryption or retaining values. A new
   deployment or unaccounted operator stops before rotation.
2. Preserve the already-complete baseline pages, exact bounds and correlated
   control before retention expires. Keep the baseline's zero-candidate finding
   separate from final drain. Reserve the full phase and all static checks
   durably before changing authority. Stop all Git pushes during the
   rotation/capture/disconnection interval.
3. In the owned store's supported dialog, choose zero hours, verify the explicit
   immediate-expiration statement, type the exact store name and submit once.
   Preserve acknowledgement and timestamps. An uncertain submission is not
   retried. This starts legacy-app maintenance: its immutable deployments keep
   revoked credentials and cannot accept further Blob attendance.
4. Invoke the already-tested clean production `vercel env run` path once from
   the empty private cwd, with an allowlisted environment and explicit team and
   project ID. The child capture helper saves only `BLOB_READ_WRITE_TOKEN` to a
   new 0600 file outside deployments, requires the expected store, and rejects a
   value identical to the old clean baseline. Keep CLI output private; never
   pass a credential value in arguments or print it. Other protected Secrets
   must not be pulled, converted or recovered.
5. Using the reviewed `probeBlobCredential` API unchanged/default transport,
   require replacement LIST success, then old-token credential-specific denial
   (`forbidden`) under the zero-grace acknowledgement. Its conservative generic
   denial label is not alone a revocation claim; the controlled comparison and
   provider action supply the context. An accepted old key, suspension, generic
   denial, timeout or persistence failure stops before further action.
6. Remove the one verified owned project connection through the supported UI,
   including any confirmation. Do not enable OIDC, transfer or delete the store.
   Verify no project connection remains and require replacement success using
   the third reserved check. Refresh project/deployment inventory: the same 50
   deployments, Git still disconnected, no queued builds or replacement-bearing
   deployment. Verify the connection removal does not leave the replacement
   distributed through project environment configuration, using the second
   complete metadata read with no value decryption. Preserve only identifiers,
   names, targets, storage hints and completeness indicators; do not retain
   returned value fields. A truncated/hidden or ambiguous result is not absence.
   Unresolved retained
   credentials remain a hold/containment issue, not permission to restore Git.
7. Record the latest authority-isolation confirmation as the conservative
   observation boundary. Keep the replacement private and the hold active.
   After that boundary plus the verified 300-second runtime window, make the
   one fresh source-proven nonwriting control and obtain the post log pass.

Environment changes apply to new deployments, according to Vercel's
[environment-variable documentation](https://vercel.com/docs/environment-variables/managing-environment-variables).
The no-new-deployment check is therefore essential while rotation temporarily
updates connected project configuration. Disconnection alone does not revoke
old deployment credentials; the zero-grace rotation is a separate prerequisite.

## Operational drain and final source boundary

The post pass uses exact recorded bounds, starting at least ten minutes before
the preserved baseline end and ending after the fresh post-window control.
Retain every returned page, identifiers, invocation events, query parameters,
hashes and pagination evidence privately. Do not filter by environment, branch,
deployment, status or method. Reject truncation, exhausted page/byte/time budget,
unknown deployment, missing control, inconsistent IDs or a coverage anomaly.

Reconcile the overlap and classify every new function invocation against its
actual deployed source and route/query/control flow. For actual mutation
candidates, require no admitted write or terminal acknowledgement of all
admitted writes. Investigate mutating 5xx responses, timeout, crash, cancellation
or missing terminal evidence. A source-proven read-only failure is not an
uncertain mutation. No known unresolved older write may be silently discarded.

With zero unresolved candidates and no coverage anomaly, this combined evidence
supports the operational drain criterion accepted by Astra. It does not claim a
formal ingestion watermark or that elapsed time/page exhaustion/control alone
proves drain. More waiting is not a repair for an identified ambiguous write.

After the actual isolation/drain milestone is reviewed, use the original unused
frozen-export allocation with the unchanged exporter, explicit retained key and
exclusive private paths. Verify a second copy, transform/reconcile all historical
records, and explain any difference from the provisional backup. No production
Convex import, traffic switch, Git restoration or unit removal follows merely
from a passing source/credential check.
