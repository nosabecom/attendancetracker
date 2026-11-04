# Disposable hosted preview setup

Latest state: the new preview's management identity and returned read capability
have been verified. Setup is paused before limit creation, environment changes,
function publication, import, activation, or hosted workloads. Production still
uses Blob. Safe evidence is in
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
streamed response sizes, timeouts, no redirects and no automatic retries. CLI
publication would have a separate time bound; its internal request/retry count
remains unknown. It uses a controlled empty environment file, minimal child
environment, disabled code generation and the exact owned preview name, never
--preview-create or a preview-run function. It will not resume an uncertain
publication automatically. The daily functionCalls disable threshold must be
created and read back before environment configuration/publication. That test
threshold is not a production budget or an exact overshoot guarantee.

The deployment usage response reported zero counters with seedStatus partial.
These are provisional deployment diagnostics, not complete billing or team
headroom. The team's remaining shared allowance is unknown. No daily limit is
yet installed, and no paid plan or guarantee is implied. Root/Astra review is
required before continuing beyond the verified setup state.

For cleanup, Convex documents
[POST /v1/deployments/{deployment_name}/delete](https://docs.convex.dev/management-api/delete-deployment)
and [preview-key scope](https://docs.convex.dev/management-api/convex-management-api).
Delete only the exact newly created preview after revalidating its saved
identity and preserving safe evidence. Deletion for this specific key has not
been tested. Its configured expiry is a fallback, not a prompt cleanup procedure.
