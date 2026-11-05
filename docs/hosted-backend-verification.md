# Hosted backend verification

The first bounded hosted backend rehearsal passed on 2026-11-05 UTC against the
owned disposable preview, using source b06caab. Setup and runner code had received
Astra approval, and Nosa's real team-usage screenshot satisfied the quota gate.
Actual hosted evidence was accepted by Astra at ce861715. Production remains on
Blob. This is backend evidence; the Next/Vercel gateway has not been tested here.

The run settled all 61 application calls: 51 SDK calls, 8 public HTTP requests and
2 subscription registrations. There were 59 physical application HTTP attempts,
7 student-gateway requests and 5 separate control reads. All 24 named assertions
passed in 15,059 ms, with no reconnect attempts. Conservative intentional-write
reservations were 355; that is not an observed write or billing count. Import
accounting used 25 calls and 24 reserved writes for the empty synthetic dataset.

Both sockets were closed, both synthetic actors logged out, and availability
closure was acknowledged and independently confirmed. Synthetic rows and possible
auth jobs remain in the closed preview until reviewed deletion or another
separately bounded validation step. Do not rerun this one-attempt runner.

The final deployment usage snapshot reported seedStatus complete, 97 function
calls and approximately 0.000246 GB database I/O. It is a short deployment-level
observation, not a team-total refresh, final invoice, storage bound or monthly
projection. The report's generic team-headroom limitation refers to the absence
of live/post-run team metering; its separate quota-review field records the actual
pre-run receipt. See the [unaltered run artifact](./measurements/hosted-backend-verification.json).

The completed script replaced the earlier non-executable scaffold. The reviewed
invocation used for this recorded attempt was:

    ATTENDANCE_PREVIEW_KEY_FILE=/private/key-file \
    node scripts/test-hosted-preview.mjs --expected-preview prestigious-jaguar-360

The key value must stay out of arguments, logs and chat. The script reads the
owned regular 0600 manifest in .convex/hosted-validation and private key file.
It requires a proven-new, non-default preview, exact team/project/reference,
stable management IDs, matching canonical cloud/site URLs, successful publication,
independent environment configuration and the daily 1,000-function disable limit.
It checks the current core against the reviewed publication commit and rejects
dirty or untracked core files. Live management identity, canonical URLs, the limit
and provisional deployment usage are revalidated before any fixture mutation.
A recent private team-quota review with sufficient planning allocation is also
required; a missing or insufficient receipt stops execution before control reads.

An exclusive private runtime-attempt.json prevents repeats. Existing attempts
are rejected before network work; the exclusive create remains authoritative
against races. A failed create never overwrites an old record in cleanup. Failed
or uncertain attempts require review and reconciliation; the runner never retries
or overwrites them.

## Synthetic import and functional scope

The exact empty RAW fixture goes through the existing canonical importer dry run,
stage, verify and activate phases. It has zero target records/chunks and a pinned
fingerprint. The importer's empty/closed checks and receipt verification remain
authoritative; no direct data reset or canonical bypass is implemented. Every
import loop request goes through an injected counted SDK wrapper, with a maximum
60 calls and 50 reserved logical writes.

After empty synthetic activation, the intended flow creates two managed fake
teachers and one five-student class. It exercises:

- Anonymous and pre-share denial, sharing, two real bucket subscriptions, and
  a short idle callback observation.
- Signed backend gateway metadata, check-in, fresh-proof duplicate, malformed
  input, bad proof, response privacy, excuses and a no-op.
- Closure with retained excuse subscriptions, closed check-in rejection,
  sharing revocation and an isolated owner update.
- A fresh export snapshot, the hosted public JWKS signature/issuer/audience,
  one maintained backend refresh with a fixed session deadline, confirmed
  logout, rejection of still-unexpired old JWTs and live subscription denial.

First connections use the actual Node WebSocket transport. Any reconnect is
refused without another network connection and fails the run; all clients and
sockets are closed in cleanup. Receive messages are capped at 1 MiB; compression
is disabled for this bounded text-protocol probe. Raw queries, tokens, passwords,
proofs and payloads stay in memory. The private attempt retains only fixture ownership identifiers
needed to reconcile an uncertain run, not passwords or tokens. Evidence reports
whitelisted statuses, counts, assertions and provisional usage fields.

This is backend-only. It does not exercise the Next gateway, browser provider,
cookies, trusted ingress IP, SSO, natural expiry, or wall-clock token rotation.
A callback-free idle/no-op interval does not prove zero backend executions.
Function retries, cache execution counts, actual provider writes, storage/index
growth and team headroom remain unknown. These limits are recorded explicitly.

## Bounds and shutdown

Reserve calls and conservative intentional-write allowances before requests:
at most 200 SDK/public HTTP/subscription calls, at most 20 student gateway
requests, and at most 500 reserved logical fixture writes. Ordinary work is
limited to 160 calls/400 write reservations, retaining cleanup headroom.
Control metadata reads have a separate maximum ten. Revocation observations
require a new matching error generation from a barrier set before the mutation;
any success in that controlled window or unexpected error fails the run through
shutdown. Successful results clear prior denial state. Cancellation is persistent
and always prevents a passing report or successful process exit, while bounded
cleanup can proceed. Final report persistence rechecks delivered cancellation
after the asynchronous writes. When cancellation was observed, both private and
public records are synchronously rewritten as failed before listeners are removed.
Each SDK RPC uses a one-use
HTTP transport, rejects automatic resubmission and redirects, and has a timeout
and streamed 1 MiB response cap. The whole attempt has a three-minute bound.
Deployment/setup/control calls are reported separately from application work.

Write reservations include conservative admission maintenance and bounded auth
history allowances; they are not observed billing or a physical-index I/O cap.
Provider retries, invalidations, cleanup jobs and other traffic can add work.
The preview's daily function limit is an interruption guard, with no exact
overshoot or monthly free-quota promise. Usage can have partial seed status and
is never presented as complete metering.

Ordinary work stops after 130 seconds, retaining 50 seconds for cleanup.
Cleanup closes clients (at most five seconds), then prioritizes the domain closure
mutation and confirmation read (ten seconds each) before optional remaining
logouts (four seconds each) and the usage read (two seconds). It closes reads and
writes only for the exact synthetic fingerprint. An uncertain closure mutation
still gets a confirmation attempt and prevents an overall pass. It also attempts this
after uncertain activation. Failure to confirm closure is reported as incomplete;
an aborted client request does not prove a server transaction was cancelled.
Whole-preview deletion is deliberately separate: synthetic accounts, domain rows
and possible auth jobs remain until root verifies and deletes the exact owned
preview. The script never deletes a deployment or invokes local-only fixtures.
Production and Blob are not targets of this runner.

Before execution, node --check passed; the empty fixture dry run and invalid
argument rejection completed offline with fetch disabled and no private input.
The actual run now supplies the scoped observations above. Hosted Next ingress,
cookies, trusted IP, SSO, natural expiry and browser refresh timing remain open.

## Adversarial review and final persistence correction

The first pre-execution review found stale-error acceptance, a cleanup scheduling
gap, and cancellation state that could be cleared. The corrected observer rejects
stale errors and successes even when they race ahead of the mutation acknowledgement.
Offline callback simulations passed; deadline allocation leaves fifteen seconds
of margin, and cleanup no longer clears the cancellation flag. Astra's recheck
accepted the publication, observer, quota and cleanup corrections at 146d769.

That recheck found cancellation during the final asynchronous file writes could
leave a passing saved snapshot even though memory and process exit showed failure.
The final persistence helper now rechecks cancellation and repairs both records
in a synchronous turn. Five regression checks deliver real SIGINT/SIGTERM during
each write and verify both files, process exit and private permissions, with an
uncancelled passing control. Astra accepted this correction at f141397 after
reproducing the original bug, running the five regressions and 32 additional
offline simulations, including independent repair failures. Filesystem failures
still propagate; storage that rejects writes cannot guarantee repaired records.
The runner code was accepted for bounded rehearsal subject to the existing gates.
The genuine receipt and setup gates were satisfied before the recorded run.
Astra's review accepted the actual backend milestone at ce861715 with no blocking
finding, including accounting, quota interpretation and shutdown evidence. This
is not production or cutover approval; the remaining hosted Next work is separate.
