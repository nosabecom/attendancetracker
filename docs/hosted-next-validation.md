# Bounded hosted Next validation — publication stopped at configuration gate

The backend-only rehearsal passed and Astra accepted its evidence at ce861715.
Astra accepted the corrected Next rehearsal code at aa2b25d. One hosted publication
attempt then built a disposable Vercel preview but stopped at the effective
environment gate. Ownership-checked cleanup deleted that deployment and confirmed
404. No Next browser workload ran; the Convex preview was never opened. Production
remains on Blob. The existing local browser runner's loopback guards remain intact.

## Recorded publication attempt

The [safe evidence](./measurements/hosted-next-preview-setup.json) records the
November 5 attempt against aa2b25d: one creation request, sixteen explicit control
requests including cleanup, one closed-availability query, and zero hosting
probes. The preview reached READY. The production target, alias bindings and
checked project settings matched their pre-creation values.

The effective-environment phase did not pass. The artifact records the phase,
but not the failing status or validation category; it cannot distinguish a
provider error from missing maps or a value mismatch. Do not claim the provider
ignores the requested environment, or that its API is unsupported. No protected
Secret bypass, protection capability, signup or student request followed this
failure. Cleanup's `capabilityRevoked: true` means no capability had been issued.

The private exclusive manifest remains preserved. Do not rerun or overwrite it.
The Next phase has consumed seventeen control requests including the earlier
root preflight. Cumulative application accounting is now sixty-two calls, with
the backend rehearsal's 355 write reservations and seven gateway requests
unchanged. Any separately reviewed continuation must retain those costs and
explicitly revise the single-publication/control allocation before creating
another preview; it must not silently reset the original attempt.

The remaining sections retain the reviewed design and its historical review
sequence. Successful Next ingress, cookies, trusted IP, browser refresh and
natural expiry remain unverified. Blob access is scheduled for a separate retry
on November 8; no support request or paid plan change has been made.

## Private deployment inputs

Installed Vercel CLI 62.1.0 parses `--env NAME` without a value, then resolves
that name from its process environment. `--build-env NAME` uses the same resolver.
The [offline check](./measurements/vercel-private-env-check.json) executed the
installed parser/resolver expressions with synthetic values: values stay out of
flags and resolver logs, explicit empty overrides stay empty, and missing values
fail. This is narrower than a full CLI or server-side precedence test.

The implemented publisher uses a single direct, non-retrying Vercel creation API
request. Private deployment-only env/build.env mappings remain in memory; no key
is placed in arguments, logs, source or upload files. Those mappings match the
installed Vercel CLI 62.1.0 request implementation. The public OpenAPI schema does
not enumerate them; server acceptance/precedence remains an execution gate, not
an offline proof. The publisher now enforces that gate through the installed
CLI's deployment-specific GET /v3/env/pull/{id} endpoint: exact build/runtime
public values, private gateway values and empty credential overrides must match
in memory before publication can be marked ready. No decrypt flag, challenge
recovery or protected-Secret bypass is used. Missing, redacted or unsupported
maps reject publication and trigger cleanup; raw values are never retained.
Only public backend selection/URLs enter the requested build variables; the
gateway key/audience enter runtime variables. Empty overrides for CONVEX_DEPLOY_KEY
and Blob credentials remove the known inherited build credential paths. No
protected Secret is pulled, and no projectSettings are sent: those can persist
for later deployments. Unknown provider-side actions remain outside this evidence.

The request selects the existing linked GitHub repo and exact reviewed SHA,
avoiding local uploads of private directories, env files or backups. As the
installed CLI does, omit target to select the documented Preview default, after
proving this project already has its production deployment. Persist an exclusive
creation record before submission; uncertain creation is never retried. Record
the returned deployment ID and unique URL before any readiness wait. Require live
owner/project/target/generated Git SHA/tag binding and unchanged production alias
bindings and project settings. Production alias bindings are read before/after
from GET /v2/deployments/{productionId}/aliases, bounded to one complete response;
comparing only the production deployment ID is insufficient. A returned ID is
saved immediately as unverified even when its URL is malformed. Cleanup can
recover a URL from the authenticated metadata only after full ownership checks.
A lost response without a returned ID remains unresolved.

The exclusive creation record durably reserves four cleanup requests before any
remote creation. Ordinary operations require successful persistence. A later
storage failure stops ordinary work while permitting those bounded cleanup
requests using the in-memory identity and counters. Both private and safe report
writes are best-effort after failure; storage uncertainty and cleanup uncertainty
are separate, and the structured console result retains the unverified ID.

The read-only project preflight confirmed the expected team/project, Next.js,
unchanged SSO protection, and no project-level build/install override or returned
integration-action field. Absence of that field does not independently prove
all provider hook behavior. The tracked vercel.json specifies pnpm build.

## Protected preview access

Keep project protection unchanged. Prefer an authorized account session or a
deployment-specific, short-lived shareable capability created only for the new
deployment ID. The documented [URL protection endpoint](https://vercel.com/docs/rest-api/aliases/update-the-protection-bypass-for-a-url)
supports a deployment ID and a TTL. Request at most 900 seconds, retain the
capability privately, and revoke it or delete its exact deployment during cleanup.
Hobby's shareable-link allowance must not be evaded by revoking another link.

Whether that capability is accepted as a private request header/cookie remains
unverified. Test that on the closed backend first and stop if unsupported. Never
place it in a URL or logs. Do not silently fall back to a project-wide automation
token: that would cover every deployment and bypass additional checks. This
phase grants no protection exception and does not make the preview public.

## Explicit test-allocation revision

Root proposed a cumulative ceiling of **700 conservative intentional-write
reservations**, replacing the earlier engineering ceiling of 500, with ordinary
work stopping at 600 and 100 retained for cleanup. This is a test allocation
decision within the authorized migration. Astra accepted this allocation's
arithmetic at af3abf8; runner enforcement still needs review. It changes no
provider plan, spending limit, quota or daily 1,000-function disable threshold.
No paid upgrade or paid overage is authorized.

Keep the original backend run's accounting: 61 application calls, 355 write
reservations, and 7 student requests. The next ordinary path reserves 221 writes:
availability open 1, one signup 64, one five-student class 12, and three fresh-proof
check-ins at 48 each. Two check-ins are planned duplicates used to test forged
forwarding headers, not retries. Thus ordinary cumulative reservations reach 576.
Logout 16 and availability closure 1 bring the planned total to 593, retaining
107. Any additional write-bearing operation needs its own prior reservation.
Do not shrink prior bounds or reset counters. Actual provider work can differ.

The overall application ceiling stays 200 calls and 20 student-gateway requests.
The next phase adds at most 40 application calls, 13 student requests, 100 hosting
requests and one Vercel Preview deployment. Allow at most 40 explicit Next-phase
control requests, including the one project preflight already performed: at most
20 for publication and 19 for runtime/cleanup. The publisher's closed availability
query adds one application call (and seeds cumulative calls at 62); it is not
silently included only as metadata. Direct publication has one counted creation
request, no CLI-internal retries and a ten-minute deadline. To keep environment
and alias checks inside the unchanged control limit, readiness polling is capped
at five reads. Use a three-minute workload deadline with ordinary work stopping
at 130 seconds and 50 seconds reserved for closure and cleanup.

## Minimal scenario and failure behavior

Before opening availability, revalidate identities, source, Free plan, recent
team allowance, daily disable limit and closed fingerprint. Verify unauthenticated
preview access is challenged, then establish the scoped authorized test access.
Reject malformed, oversized, wrong-origin and unsupported-method requests while
closed; distinguish ingress rejection from application rejection.

Use one synthetic teacher through the real Next auth endpoint, inspect cookie
attributes without retaining values, create a class with its JWT, and use a
separate student context with teacher WebSockets blocked. Check public response
privacy, one check-in and two fresh-proof duplicates, then confirmed Next logout,
cookie deletion and old-JWT denial. Avoid mounting the full teacher UI merely to
exercise these transport checks. Browser refresh and natural expiry remain deferred.

For forwarding-header provenance, a successful response is insufficient. Use only
an existing supported admin read to compare bounded security-counter identity
hashes across otherwise identical controlled requests; never retain IPs/hashes,
nonces or raw documents. Prove the read path offline first, cap its rows, and
count it as an application/admin call. If no valid observable exists, report
spoof resistance unverified instead of adding a public diagnostic endpoint.

Stop on unexpected requests, retry/reconnect, identity, URL, accounting or status.
Close availability and independently confirm it before optional logout/deletion
work; persist cancellation/failure honestly. Close contexts/sockets and revoke
the new actor if established. Revoke only the newly created shareable capability
and delete only the newly created Vercel deployment after matching its ownership.
Retain the already-existing Convex preview closed until separately reviewed
deletion. Any uncertain closure, revocation or deletion remains an explicit gap.

## Implementation and offline evidence

Both tools are executable. Publication has the stopped attempt recorded above;
the Next runtime runner remains unexecuted against hosted services.
The publisher has sixteen offline checks, including full orchestration fixtures
for wrong effective environments, inherited credentials, redaction, persistent
ENOSPC after creation, alias drift and a returned ID with a malformed URL. The
runner has thirty-four offline checks covering cumulative accounting, cookie
attributes, browser isolation, request policy, ephemeral counter comparison,
cancellation, deadlines and prioritized cleanup. These fixtures do not establish
real provider acceptance, browser cookies or trusted-header behavior.

The first publisher review blocked on four issues now corrected in source:
environment acceptance, storage-independent reserved cleanup, alias binding
evidence and immediate returned-ID retention. A combined pre-execution review
of these corrections and the complete runner was required. At that point no
Vercel deployment, shareable capability or new Next workload had been created.

The combined recheck accepted those publisher corrections but found browser
lifecycle defects in the runner: an unbounded launch/evaluation, Playwright's
competing SIGINT exit handler and falsely successful teardown after initialization
failure. Launch now receives workload-bounded timeout and all three Playwright
signal handlers disabled; the runner owns SIGINT, SIGTERM and SIGHUP. Every initialization, locator and evaluation operation
has a cancellation-aware bound; caller watchdogs also bound initialization,
check-in and duplicate operations. Ordinary transports share that cancellation
signal, while cleanup requests use independent deadlines.

Teardown ownership is handed to the caller as soon as launch returns, before
initialization. Late launch handles are closed too. A close promise is shared
between failure and final cleanup, bounded independently to 2.5 seconds, and
failed/unconfirmed closure remains uncertain. Caller cleanup allows at most three
seconds before proceeding to the priority backend closure. Eight new regressions
cover these paths without starting a real browser or service.

The focused recheck accepted those lifecycle corrections and identified a queued
route that could resume after cancellation while the shared transport had entered
cleanup. Routes now recheck cancellation/teardown after reading headers and after
the response. The caller independently rejects browser sends once ordinary work
is aborted or cleanup has begun; no asynchronous operation separates that guard
from dispatch. Four additional offline checks cover cancellation after headers,
teardown during a header read, and queued sends during both signal-triggered and
fatal-observation cleanup. The teardown and both caller-boundary regressions
failed against the previous implementation. The next scoped review accepted the
correction: fifty targeted tests and 118 additional offline timing cases passed.
It granted code readiness subject to live/quota gates; it did not establish
provider behavior. The subsequent publication outcome is recorded above.
