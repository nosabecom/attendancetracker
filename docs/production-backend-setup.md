# Existing production backend setup

Status: offline preparation. The frozen Blob source is saved and reconciled.
The production import wrapper has received conditional Astra acceptance. One
production capability was created, but its private capture timed out. No key was
downloaded, no production functions have been published, and no records have
been imported in this step. The stopped attempt remains spent.

The target is the existing Production deployment `tremendous-elk-298`, in
`convex-cyan-garden`, under Convex team `nomokaro625-9385-s-projects`. The cloud
and site origins must match the separately observed owner dashboard and the
capability-authenticated canonical-URL response. The dashboard currently says
Never Deployed. Before the attempted capture it showed no deployment keys.
These are observations to refresh,
not proof that every table is empty.

## Separate finite allocation

`PRODUCTION_BACKEND_SETUP1` is separate from every spent preview, Blob and hosted
Next allocation, and from the import's 55 calls/40 verification pages/774 logical
write reservations. Its proposed ceiling is:

- One ordinary owner-UI creation of a Production deployment key for this target.
- One private capture of that same key: at most one ordinary Copy action and
  one download request. A local fallback may read the already-visible key in
  the same owner dialog; it cannot reveal another key or create a second one.
- At most 20 explicitly reserved backend HTTP requests, including system queries.
- One existing-target CLI publication, with a 180-second process deadline.

The UI, CLI, provider build and publication internals are not claimed to be
single physical requests or included in the 20 explicit requests. System queries
can consume function resources. These are finite engineering limits, not a
provider billing cap. No paid plan, new deployment, preview claim, resource
deletion, automatic retry or reset is included. Preserve every spent reservation
and uncertain outcome; do not obtain a new allowance by changing a path.

Before execution, refresh the actual all-project Free quota receipt, exact team,
project and target, clean reviewed source, frozen-input binding and continuous
operator/deployment/environment-copy hold. Reserve this allocation durably in
private storage. Setup requires conservative remaining room for 1,000 calls,
0.025 GB database I/O and 0.005 GB database storage, independently of provider
metering delays and other team work. Future workloads need their own retained
accounting.

## Private owner-UI capability capture

Use the already-authenticated ordinary dashboard for this exact Production
deployment. The [capture helper](../scripts/capture-production-capability.mjs)
does not create or reveal a key. Arm it before the separately reviewed normal UI
actions. First test the browser download destination with nonsecret bytes in the
same owned tab, then verify that the downloaded file can be moved into owned
0700 storage with 0600 permissions. Import the real download before closing the
tab, because preview downloads are ephemeral.

Inspect only nonsecret controls and scope labels. A Create action may open a
form or create immediately: inspect structural metadata after it, never repeat
creation on an assumption. If there is a confirmation form, submit once only
after verifying the Production target and ordinary deployment-key scope. Stop
on a different scope, missing target or unexpected challenge.

The helper intercepts only the normal page's `clipboard.writeText` while armed;
it never reads the system clipboard or writes the capability there. It accepts
an opaque printable capability, requests one raw private download without a
newline, restores the original method and returns fixed status categories only.
If the page uses a different Copy implementation, the explicit local fallback
may inspect a unique visible readonly text field or code block in the same
Deploy Key dialog. Missing, masked, ambiguous or late input stops capture. Do
not inspect hidden framework state or print a snapshot containing the key.

A requested download is not proof of a completed file or valid authority. Root
must privately verify file ownership, permissions, complete bytes and exact
target provenance, retain a private capture receipt, and bind its hash into the
setup plan. The capability must remain outside source, public configuration,
argv, screenshots and tool output. Its first authenticated canonical-URL check
must succeed before any configuration mutation.

## Configuration and publication

The [setup helper](../scripts/prepare-production-backend.mjs) defaults to an
offline dry run. Applying requires private input, reviewed plan, raw capability
and an empty fixed ledger directory. An immutable allocation marker and
per-request receipts precede dispatch. Failed, cancelled and uncertain operations
remain spent. There is no automatic retry, resume, replacement target or cleanup
mutation.

Before publication it verifies canonical origins, records deployment usage,
checks existing limits and refuses anything except no limits or the single exact
reviewed daily limit. It also refuses unknown existing auth/gateway configuration.
It installs or verifies an enabled daily disable threshold of 1,000 function
calls, generates independent RSA signing/JWKS and gateway key/audience, saves
them privately before configuration, and compares exact private readback. This
temporary threshold is for closed setup and import; it must be reviewed before
opening public traffic. It does not cap storage, hosting or every resource.

Publication selects the verified existing cloud URL and opaque capability via a
private env file. No project preview key, `--preview-name`, claim/reclaim or
Vercel build hook is used. The installed selector is checked offline before
mutations. The single CLI invocation binds the reviewed clean source, disables
code generation and retains private logs. Cancellation or uncertain publication
stops the run. Afterwards canonical origins and primary-supported function
identifiers/types must match. The actual function metadata is retained privately.
Recognized visibility and read-only validator shapes are recorded separately;
an unfamiliar shape remains `operator_review_required`, with
`publishedFunctionMetadataVerified: false`. It cannot satisfy the ready-manifest
gate. Root/Astra must resolve that actual evidence before import readiness; CLI
success alone cannot establish atomic read-only activation. Every terminal CLI
exit triggers verified process-group cleanup. Lingering descendants make the
publication uncertain even if the leader exited successfully.

Publishing does not initialize the importer or open domain reads/writes. Missing
deployment state denies application access. The import's initialization enforces
empty application, auth and migration tables transactionally. Publication success
does not independently prove those tables empty. Any preexisting state stops
import; it does not authorize deletion.

Root and Astra must review the actual setup/capture evidence before constructing
the real [import ready manifest](./production-import-execution.md). That manifest
must cite actual publication, identity, quota, source and capability evidence.
No ready manifest is fabricated by this setup tool. Import staging,
verification, atomic read-only activation, independent production reconciliation,
hosted Next/auth/IP/refresh/expiry checks and final cutover remain later gates.

## Stopped capture and proposed same-key recovery

At reviewed source `757586c`, root opened the ordinary creation form, selected
ten deployment-scoped permissions for deploy, environment read/write, data
read/write, internal queries/mutations, usage read and usage-limit read/write,
and a seven-day expiry. One Create submission completed and displayed its key
dialog. The helper's 120-second lifetime had started before configuring that
form. It expired before Copy. A subsequent automation click had no matching
target and timed out; it did not activate Copy. There were zero capability
downloads, zero backend requests, zero configuration mutations and zero CLI
publications. The initial controller remains failed/timeout, with its clipboard
hook removed. The one creation and failed capture remain recorded; none of the
20 backend requests or the CLI publication allowance has been spent.

`PRODUCTION_CAPABILITY_RECOVERY1` is proposed for separate review: zero key
creations, zero provider requests by the helper, at most one ordinary Copy of
the same already-created visible key and one private download. The current
owner dialog must still correspond to that exact key; missing or ambiguous
identity means stop, without another reveal or creation. Root must durably bind
the original allocation and stopped receipt, independently verify that the first
attempt dispatched no download, and retain both histories. The helper's status
alone cannot establish the latter provider/browser fact.

Explicit `existing-owner-ui-recovery` mode requires the original failed/timeout
controller. It installs one separately named recovery controller, preserves the
original failure, and uses a distinct download filename. The recovery is armed
only once the existing Copy control is ready, so its fresh 120-second lifetime
does not include creation or permission selection. It follows the same exact
page, opaque-byte, private-download, no-system-clipboard and visible-only fallback
rules. Success, abort or timeout is terminal, and the recovery controller cannot
be replaced. No third capture path or automatic retry is included.

After an actual private-file verification, separately review/bind the updated
source and original still-unused backend/publication allowance before continuing
setup. This proposal does not reset `PRODUCTION_BACKEND_SETUP1`, create another
key, or permit import or public traffic.
