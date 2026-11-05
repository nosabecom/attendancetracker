# Disposable hosted preview setup

Latest state: the owned preview was configured and functions published on
2026-11-05 UTC after quota review. The daily 1,000-function disable threshold was
created and read back before independent signing/gateway configuration and direct
publication. The bounded backend rehearsal then passed and closed domain reads
and writes. The preview remains for adversarial evidence review; it has not been
deleted. Production still uses Blob. Safe setup evidence is in
[measurements/hosted-preview-setup.json](./measurements/hosted-preview-setup.json).

The first attempt stopped because it assumed a deployment-name prefix in the
returned admin credential. Root subsequently verified the provider's preview
management record against the original new claim, project-scoped preview key,
exact reference, URL, non-default type, and stable deployment/project IDs. The
returned capability successfully read the target's canonical URLs, current usage
and configured limits. Credential strings are treated as opaque, rather than
using an unproven prefix as identity. The API returned a null legacy
previewIdentifier and the exact modern preview/reference binding.

The private creation record remains
`.convex/hosted-validation/preview-setup-manifest.json` (0600). It contains keys
and must stay ignored. Do not remove it or retry a claim. The setup script now
supports an explicit --resume path that reuses only this proven-new recorded
target; --resume --inspect performs read-only identity/capability/usage checks.
An explicit reviewed HEAD and clean tracked/untracked core source are
required. Resume also checks that backend/application core files have not changed
since the creation commit; the creation and reviewed publication commits remain
separate records. Initial setup requires ATTENDANCE_VALIDATION_SOURCE_COMMIT; the
credential file path is supplied through ATTENDANCE_PREVIEW_KEY_FILE. Never
put the credential itself in arguments or source.

All explicit setup HTTP attempts share a persisted 20-call ceiling, bounded
streamed response sizes, timeouts, no redirects and no automatic retries.
Publication uses a private 0600 env file containing only the verified canonical
URL and opaque capability under the CLI's explicit URL/capability selector.
Its SELF_HOSTED variable names select that managed preview endpoint; they do not
change its hosting. The child receives no project preview key and no preview
name/create flag, so it cannot reclaim or replace a missing deployment. The
uncertain-publication stop remains in force.

Before any continuation, an offline probe runs the installed CLI with synthetic
values and all network transports blocked. It verifies exact URL/capability
selection, ignores misleading process selectors, preserves opaque bytes, rejects
an empty file, and observes no claim attempt. Real selector-file round-trip and
private-file checks precede limit/environment mutations. CLI publication requests
remain separately unknown and time bounded.

A recent private team-quota review is now mandatory before any initial claim or
non-inspection continuation, and again before a workload. The preview-key scope
and Vercel integration balance do not expose usable team totals. Root requested
current used/limit figures from Nosa's team Usage page. Nosa supplied the All
Projects screenshot; its private receipt passed the guard before continuation.
The clipped storage unit was interpreted conservatively using the published Free
cap. The available integration was independently rechecked as CONVEX_BASE/Free.
No setup-only exception was needed. The receipt is a pre-run snapshot, not live
team metering. Actual figures and credentials remain private.

The initial deployment usage response reported zero counters with seedStatus
partial. Those provisional diagnostics did not establish team headroom; the
subsequent genuine quota receipt satisfied that gate. The continuation used
seven additional explicit setup requests, for sixteen cumulatively, without
another claim. CLI publication requests remain unknown and separately bounded
by its timeout. No paid plan or free-cost guarantee is implied. Astra accepted
the corrected setup/publication path at 146d769 and the rehearsal runner at
f141397; review of the actual hosted evidence remains pending. No production
approval was granted. See [hosted-backend-verification.md](./hosted-backend-verification.md).

For cleanup, Convex documents
[POST /v1/deployments/{deployment_name}/delete](https://docs.convex.dev/management-api/delete-deployment)
and [preview-key scope](https://docs.convex.dev/management-api/convex-management-api).
Delete only the exact newly created preview after revalidating its saved
identity and preserving safe evidence. Deletion for this specific key has not
been tested. Its configured expiry is a fallback, not a prompt cleanup procedure.
