# Hosted validation plan (not yet run)

This is a proposed, bounded rehearsal using synthetic data on a **new disposable
Convex preview** and its matching Vercel Preview. It is not a production cutover
or a capacity benchmark. Production remains reserved for the real, verified
Blob import; Blob object reads returned 403, so cutover is blocked until a
complete source export is available. PR 13 is open and unmerged; the current
application defaults to Blob.

## Configuration observed and remaining gates

On 2026-11-04 a read of Vercel project `attendance-tracker`
(`prj_uOMK1a4PLAgsDr1A16InuImM1M3q`) in
`nomokaro625-9385s-projects` showed framework Next.js, GitHub repository
`attendancetracker`, production branch `main`, and null project-level build and
install overrides. This checkout's `vercel.json` specifies `pnpm build` and
`pnpm install --frozen-lockfile`; `pnpm build` runs Next build, with no Convex
deploy command. The marketplace documentation says its projects are configured
for automatic deployment, but this inspection does **not** prove an integration
hook or effective build deployed the backend. Inspect the actual preview build
and integration behavior before relying on it; avoid any build that could deploy
to production. A key entry alone does not deploy functions.

The connected `convex-cyan-garden` resource was previously verified available,
with Free subscription plan `CONVEX_BASE`. The project metadata lists sensitive
`CONVEX_DEPLOY_KEY` entries for production and preview, and Blob token entries
for production and preview/development. It exposes neither key type nor validity;
a preview key was subsequently supplied through the private card and its encoded scope matches this Convex team/project. Network usability remains unverified.
Do not pull or reveal protected secrets. Confirm privately that the preview key
is actually a **preview** key for the intended Convex project, and that the
importer's admin authentication can target the resulting preview. A preview key
entry is not proof of either. Configure missing preview-only application settings
through supported private controls; never reuse production signing or gateway
keys. Verify `NEXT_PUBLIC_ATTENDANCE_BACKEND=convex`, matching public Convex
cloud/site URLs, and independent matching gateway key/audience and auth signing
configuration. Determine effective values and precedence without exposing secrets.

Project metadata reports SSO protection `all_except_custom_domains` and Git fork
protection enabled. Custom-domain access, bypasses, firewall rules, direct Convex
ingress and effective protection on the new preview were not established by this
read. Check these explicitly, including direct backend access and old deployment
URLs. Do not assume a firewall feature or entitlement exists. Use an authorized
protected preview access method; record its effect on automated and student
requests without recording bypass credentials. Keep the backend unavailable to
untrusted clients until configured and verified. Stop if isolation or ingress
cannot be established.

The gateway uses `x-vercel-forwarded-for` on Vercel and rejects a missing or
non-single-IP value. Vercel documents this header as identical to its client
`x-forwarded-for`; its proxy/trusted-proxy behavior matters. Validate the
actual deployed path, including spoofed incoming forwarding headers and any
proxy in front of Vercel, against the [Vercel request-header contract](https://vercel.com/docs/headers/request-headers).
Never assume an arbitrary client-supplied header is trusted. No hosted header or
protection test has been performed.

## Before starting

1. Review the current commit, schema, pinned auth patch, migration code and
   outstanding security findings. The [Convex hosting guide](https://docs.convex.dev/production/hosting/vercel)
   describes preview keys and branch-associated backends; the Marketplace uses
   its own Convex team. Establish actual team/project/deployment identities and
   usage, available limits and any spend controls before creating anything.
   [Free hard caps](https://docs.convex.dev/production/state/limits) are shared
   by the team; [deployment warnings and disable controls](https://docs.convex.dev/production/usage-limits)
   are distinct from spending. Set thresholds only after reviewing real remaining
   allowance and interruption tradeoffs. No headroom or free-cost guarantee is
   implied.
2. Record an owner, unique fresh branch/preview name, timestamp, commit SHA,
   expected Vercel and Convex project/team, exact planned deployment type, and
   deletion method. Confirm no deployment with that name already exists; do not
   use a recreate flag against an existing target. Confirm the resulting backend
   is genuinely preview, newly created, empty and closed, and different from all
   production/development/live targets before any import or activation. If any
   identity or emptiness check is uncertain, stop. Never reset an existing DB.
3. Review the effective build pathway and preview-scoped credentials before
   deploying. The [Convex guide](https://docs.convex.dev/production/hosting/vercel)
   describes a deploy command that can create a branch-associated preview; this
   repository does not currently configure that command. Resolve the missing
   setup in a separately reviewed preview-only change. Verify that the resulting
   Next build uses the new backend URLs and the current code, without exposing
   credentials. Deployment, configuration and cleanup are separate from the
   test-call budget below and must be counted and reported separately.
4. Prepare a small, entirely synthetic private raw Blob-format input. The data
   shape in `scripts/test-local-import.mjs` is an example, but that runner and
   all `local*` fixtures intentionally reject cloud targets. Do not weaken
   their guards. Use the importer dry run to review fingerprint, counts, chunks
   and anomalies. The importer locks one fingerprint on a verified-empty closed
   target: activate synthetic data only on the disposable preview, never on the
   production import target. No real roster, account or source snapshot belongs
   in this rehearsal.
5. Before invoking the importer, calculate the calls and write upper bounds for
   this exact input, including staging chunks, verification iterations, retries,
   activation and cleanup. Its stage/verify loops are not intrinsically capped
   by this plan. Instrument or otherwise enforce the limits before execution;
   if they cannot be enforced, stop. Cloud `CONVEX_DEPLOY_KEY` is accepted only
   via the process environment, never an argument, log or chat. Verify that the
   scoped credential actually has the needed admin permissions without bypassing
   protected Vercel Secrets.

## Budget and execution

The proposed hard ceiling is **200 total submitted SDK, admin, public HTTP and
subscription-registration calls**, including failures and retries, of which at
most **20 are student gateway HTTP requests**. Reserve 60 calls for import and
verification, 80 for functional/auth/subscription checks, 20 for gateway
requests, and 40 for controlled shutdown/observation; unused allocation is not
permission to exceed 200. Count every subscription registration/reconnect as a
call; separately record server-side subscription executions and transport bytes.
Count attempts before sending, including automatic retries; disable unbounded
retries and stop before a limit is crossed. Cap intentional synthetic fixture
writes, including import, test mutations and cleanup deletes, at **500**; reserve
at least 100 of those for cleanup and account for actual document writes, not
just mutation calls. If a write bound cannot be established before a mutation,
do not issue it. Provider-side retries, auth/session jobs and security cleanup
can add work and must be measured separately; these limits do not cap billing.
Record deployment/setup/control-plane and deletion requests separately, as well
as logs, scheduled auth jobs, subscription executions/transport and Next hosting
requests and usage. No 1,000-arrival hosted test is authorized by this plan.

1. Stage, verify and activate only the reviewed synthetic fingerprint using the
   importer's separate phases described in [convex-cutover.md](./convex-cutover.md).
   Keep ingress closed during activation; it enables writes. Confirm availability
   and fingerprint before exposing the protected preview. Keep the private input
   and secrets out of logs and committed evidence.
2. With a tiny synthetic class and two controlled identities, check sign-in,
   teacher ownership/sharing denial, roster/session creation, one student
   check-in and duplicate, an excuse, and authorized live updates/export. Verify
   unauthorized access, legacy endpoint behavior and that students use the
   gateway rather than direct privileged operations. Count all requests and
   writes; stop on unexpected identities, URLs, results or retry behavior.
3. Exercise refresh/logout/revocation and expiry where the real hosted timing
   permits. Record cookie flags and JWT/JWKS behavior without retaining tokens.
   Do not shorten a shared environment's auth settings. Open a small number of
   subscriptions, record initial/idle/change/reconnect execution and bytes, and
   close them. Observe scheduled cleanup separately; do not claim completion
   without evidence. Check gateway origin, invalid input, spoofed forwarding
   headers and actual client IP behavior within the 20-request ceiling.
4. Record only sanitized counts, time window, deployment identities, commit,
   observed results, effective protection, limitations and usage deltas. Do not
   log request bodies, student data, credentials, raw logs or tokens. A small
   run cannot establish production burst capacity, free-tier safety, real-world
   sleep behavior, or complete security coverage. Stop for unexpected failures,
   usage, loss of isolation or uncertain accounting; do not retry automatically.

## Close and retain evidence

Stop traffic and subscriptions, record pending auth jobs and usage, and retain
sanitized evidence before deletion. Delete only the exact newly created Convex
**preview** and matching newly created Vercel preview deployment after checking
team/project, type, name, owner and identifiers against the creation record.
Use the provider's currently supported deletion controls; do not guess commands,
remove a shared project or integration, or delete unknown/live resources. If
identity or ownership cannot be proved, leave the target closed and report it
for manual resolution. Account for deletion/control-plane calls separately.
Production remains closed and empty until the actual Blob export, reconciliation
and the separately reviewed cutover procedure are ready.
