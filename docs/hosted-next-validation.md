# Bounded hosted Next validation — preparation only

The backend-only rehearsal passed and Astra accepted its evidence at ce861715. This next
phase has not deployed or executed. Production remains on Blob and the disposable
Convex preview remains closed. The existing local browser runner's loopback guards
must remain intact.

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
an offline proof. Only public backend selection/URLs enter build variables; the
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
and project settings. A lost response without a proven ID remains unresolved.

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

Root proposes a cumulative ceiling of **700 conservative intentional-write
reservations**, replacing the earlier engineering ceiling of 500, with ordinary
work stopping at 600 and 100 retained for cleanup. This is a test allocation
decision within the authorized migration, subject to Astra review. It changes no
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
request, no CLI-internal retries and a ten-minute deadline. Use a three-minute workload deadline with ordinary work stopping
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
