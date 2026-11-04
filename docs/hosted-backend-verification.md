# Hosted backend verification — not yet run

The runner is implemented, syntax/offline checks pass, and adversarial review is
still required. No hosted application workloads have run. The current preview
has not yet had its environment configured or functions published. Source setup
and publication remain separate reviewed gates.

The completed script replaces the earlier non-executable scaffold. Run only
after the exact preview setup succeeds and both setup and runner receive review:

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
sockets are closed in cleanup. Raw queries, tokens, passwords, proofs and payloads
stay in memory. The private attempt retains only fixture ownership identifiers
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
Control metadata reads have a separate maximum ten. Each SDK RPC uses a one-use
HTTP transport, rejects automatic resubmission and redirects, and has a timeout
and streamed 1 MiB response cap. The whole attempt has a three-minute bound.
Deployment/setup/control calls are reported separately from application work.

Write reservations include conservative admission maintenance and bounded auth
history allowances; they are not observed billing or a physical-index I/O cap.
Provider retries, invalidations, cleanup jobs and other traffic can add work.
The preview's daily function limit is an interruption guard, with no exact
overshoot or monthly free-quota promise. Usage can have partial seed status and
is never presented as complete metering.

Cleanup closes clients before best-effort remaining logouts and attempts to close
domain reads/writes for the exact synthetic fingerprint. It also attempts this
after uncertain activation. Failure to confirm closure is reported as incomplete;
an aborted client request does not prove a server transaction was cancelled.
Whole-preview deletion is deliberately separate: synthetic accounts, domain rows
and possible auth jobs remain until root verifies and deletes the exact owned
preview. The script never deletes a deployment or invokes local-only fixtures.
Production and Blob are not targets of this runner.

Validation so far: node --check passed; the empty fixture dry run and invalid
argument rejection completed offline with fetch disabled and no private input.
Hosted execution, observations, actual bounds and cleanup remain unverified.
