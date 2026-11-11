# Missing configuration from retained deployment source trees

Status: the separately reviewed continuation succeeded once: twelve GETs,
twelve independently verified files, and 38 cumulative source controls within
the retained ceiling of 66. See the [capture evidence](./measurements/blob-cli-config-capture.json)
and [independent source review](./measurements/blob-known-writer-source-review.json).
The full Blob data copy remains preserved privately. This source-only work
changed no credential, store connection or production app.

The preparation below records the accepted scope; it is not an instruction to
replay the completed continuation.

## Preserve the first capture

`CLISOURCE1` used 26 explicit controls: three fresh ownership metadata reads,
three source-tree reads and 20 content reads. Its immutable independent record
reserves the entire 66-request ceiling, including uncertain finalization. Keep
that reservation and the original partial attempt unchanged.

The returned trees expose uploaded source under `src/` and generated outputs
under `out/`. The first selector captured all executable application/library
leaves (8/4/8); its independent audit verified hashes, literal static-auth SDK
options, awaited writes and no alternate writer paths in those captured files.
It missed package/build/type configuration under the wrapper. This is a partial
capture, not permission to rotate credentials or declare source closure.

## One continuation, no repeated discovery

The import-only `captureDeploymentConfigs` API in
[`capture-deployment-config.mjs`](../scripts/capture-deployment-config.mjs)
accepts exactly four retained files for each of the same three deployments:

- `src/package.json`
- `src/package-lock.json`
- `src/next-env.d.ts`
- `src/tsconfig.json`

Root must derive every deployment/file identifier from the retained trees and
compare selections against all 20 existing content receipts. Bind the original
manifest's SHA-256 fingerprint, the prior 26 calls, the ceiling of 66, and the
exact three owned Ready dirty CLI deployments. An identifier is not treated as a
content hash. No tree, metadata or previously captured content request repeats.

The separate immutable `CLISOURCECONFIG1` suballocation permits at most twelve
GETs. Successful completion reaches **38 of the existing 66 controls**, with 32
content reads in total. The remaining margin allocates no operation. This is a
deliberate bounded continuation for previously omitted files, not a replay or
reset of the original audit and not a new full 66-request allowance. LOGSCOUT1's
one preparatory log read remains separately accounted.

Use the default transport with the existing explicit account bearer, the fixed
owner-scoped V8 file endpoint, at most two concurrent requests, no redirects,
retries, fallback or discovery. Limits are 16 KiB headers, 1 MiB per response,
256 KiB decoded file, 4 MiB aggregate response data, 15-second headers,
20-second body and 120-second overall network deadline. Filesystem operations
can fail or stall; these are engineering safeguards, not billing guarantees.

Require an unused 0700 private destination. The allocation, each pre-dispatch
reservation, every captured file and the final result are exclusive 0600 files.
They are not overwritten. Failure, cancellation, denial or ambiguous response
stops work and retains reservations; no alternate file or attempt follows.
The helper executes no retrieved code and has no CLI or automatic invocation.

## After preservation

Root must verify the twelve private file hashes and reconcile every retained
tree entry with captured source/configuration. Independently inspect package
scripts, lockfile-resolved SDKs, build/type configuration and all executable
entrypoints. An automatic success flag is advisory. Unsupported configuration
or dependencies leave writer-source verification incomplete.

Review the actual evidence with Astra before credential rotation. The final
freeze still requires fresh writer/connection inventory and deployment hold,
zero-grace rotation, private replacement capture, new/old/new credential-bound
comparisons, no replacement distribution, and a defensible drain boundary.
No hosted preview, production import, traffic switch or test removal is enabled
by this source-only continuation.
