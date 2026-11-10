# Proposed third hosted Next continuation

Status: offline preparation for Astra pre-execution review. No third Vercel
deployment, new private receipt, Vercel/Convex request or hosted workload was
created by this preparation. The owner's objective is full historical migration
by November 11; a roster-only replacement is not the selected launch scope.

## Retained accounting and one new phase

`scripts/hosted-next-third.mjs` pins both earlier failed publication artifacts,
their source/run/deployment identities, private-record agreement and verified
deletion. The original two-attempt policy and evidence bytes remain unchanged.
The new immutable policy and exclusive paths are separate from both old attempts.

| Phase | Next controls | Application calls | Creations |
| --- | ---: | ---: | ---: |
| Already spent | 33 | 63 | 2 |
| Existing-target compatibility | At most 2 | 0 | 0 |
| Third publisher including cleanup | At most 20 | At most 1 | At most 1 |
| Third runtime including cleanup | At most 19 | Existing application bounds | 0 |

The full planned sequence reaches at most **74 Next controls** under the overall
80-control ceiling. The six-control margin allocates no operation or retry.
The successful publisher seeds runtime with 64 application calls, three Next
publication queries and three cumulative creations. Runtime starts from
`33 + actual preflight controls + actual publisher controls`; it cannot reset
earlier work. Existing ceilings remain 200 application calls, 700 reserved
writes, 20 gateway requests and 50 hosting requests. The prior 355 reserved
writes and seven gateway requests remain included.

These are request/write reservations, not provider billing caps or a count of
backend internal work, retries, builds or scheduled jobs. Earlier Convex setup
control traffic and unknown CLI-internal publication work remain separate.

## Compatibility before creation

The third publisher selector requires the exact second predecessor deployment
ID and a separately supplied existing owned deployment ID. It durably creates
its own exclusive manifest before spending the compatibility allowance:

1. GET that existing deployment and require the exact owned team/project,
   deployment ID, Ready state and returned canonical GitHub source identity.
2. GET the first-party deployment-specific environment-pull route with the
   fixed `source=vercel-cli:env:pull` and exact team. Require HTTP 200 and both
   string-valued environment maps without a protected-Secret indicator.

HTTP 400, another denial, malformed maps, uncertain ownership/source,
cancellation or persistence failure stops before creation. The compatibility
deployment is never a cleanup target. No challenge recovery, decrypt selector,
retry, alternate target or protected-Secret bypass is present.

Map-shape compatibility is **not** effective-environment verification. After a
new deployment is Ready, the existing strict verification still requires exact
public backend/cloud/site values, independent private gateway values and exact
empty Blob/deploy credential overrides in both maps. It precedes hosting probes,
capability creation and application writes. No missing/redacted value is promoted
to an acceptable empty credential. Fixed diagnostic categories, numeric status
and fixed expected-field shape categories are the only failure diagnostics.

## Git source while the project remains disconnected

One authorized read-only GitHub metadata request confirmed
`nosabecom/attendancetracker` has numeric repository ID `1409352117`. The installed
Vercel OpenAPI `createDeployment` contract independently accepts an existing
project ID and a GitHub `gitSource` with repository ID, ref and SHA. The publisher
sends the exact reviewed commit as both ref and SHA, without project settings,
Git reconnection or a branch selector. The new mode requires the project to be
disconnected before and after creation, and requires returned `gitSource` type,
canonical repository ID and resolved SHA to agree with the provider's GitHub
commit metadata. Cleanup and runtime retain that stronger source requirement.

This shows that the detached request is expressible in the provider contract.
It does not independently prove that creating it cannot implicitly change a
project's Git link. The installed CLI does not exercise this detached Git-source
path. **A credible pre-creation no-reconnection basis remains an execution gate
for Astra/root; post-creation detection alone does not supply that guarantee.**
If the provider contract cannot establish the required boundary, stop before
creation. A separately reviewed alternative would upload an exact `git archive`
with file/content provenance, without using a Git-linked source; that changes
the proof contract and is not implemented or allocated here.

Any unexpected Git reconnection stops the publisher and attempts cleanup only
of the identity/source-verified newly created deployment. It never changes
project settings or reconnects/disconnects the repository to repair uncertainty.
The Git/manual deployment/environment-copy hold must remain throughout.

## Fresh live gates

The existing genuine Convex Free quota review remains mandatory. Root owns that
receipt and its actual team, period and resource verification; this preparation
does not fabricate or read it. Vercel Pro does not change Convex's plan.

The third mode additionally consumes a private
`.convex/hosted-validation/vercel-credit-review.json` with:

- Exact team ID/slug, Pro plan and source `vercel-dashboard-agent-observation`.
- Actual current-period UTC start/end, observation no older than one hour,
  included/used credit, all retained engineering reservations (at least the
  existing $0.80), and at least a further fixed $1 reservation after subtracting
  those earlier reservations. The guard rejects headroom that would reuse them.
- Explicit whole-team scope, acknowledgement of dashboard lag and no overage
  authorization. The returned proof says `billingCap: false`.

Root must supply genuine current observations; the $1 is planning headroom,
not a new paid-spending approval or provider disable limit. No such private file
was created by this work.

The reviewed HEAD, clean tracked/untracked source boundary, exact owned Convex
preview, canonical URLs, closed fingerprint, daily disable limit and source
publication provenance remain required. In particular, the existing source
comparison still rejects dependency/core drift against the recorded backend
publication. Reconcile that provenance or republish the same owned backend under
a separately reviewed allowance; do not silently exempt files or relabel old
publication evidence as a newer source.

## Validation and remaining scope

Offline fixtures exercise both immutable histories, compatibility ordering and
rejection, disconnected-project/source checks, independent third paths, replay
and fourth-selector rejection, retained costs, credit/Free-plan gates, normal
owned cleanup, cancellation and storage failure. No service workload is evidence
of success here.

The hosted runtime still needs successful effective configuration, browser
cookies, trusted IP/spoofing and public student/gateway checks. Existing deferred
browser refresh/natural-expiry limitations remain explicit. Full historical
snapshot, import, reconciliation, production configuration and final Astra
approval remain separate gates. No test removal or production switch is enabled.
