# Ordinary browser press for the store-owner control

Status: offline proposal after the accepted stopped `OWNERCAPTURE1` attempt.
That attempt remains spent: one programmatic reveal invocation, no returned
credential, download or Blob probe. No retry or allocation reset has occurred.

The subsequent Astra-authorized masked-only inspection found an enabled visible
Show-secret button with `data-react-aria-pressable="true"`. There was no visible
authentication challenge, dialog, alert or hover instruction. Root selected only
the masked snippet tab and hovered the control; no reveal or credential read.
The button is not inside a form. These are DOM observations, **not proof that
the press handler caused the timeout**. The owned inspection tab was closed.
The [masked inspection record](./measurements/blob-owner-masked-inspection.json)
contains only these nonsecret observations.

The smallest proposed compatibility change is to use T3's ordinary browser clicks
for both Show and Hide, while a separately armed page observer captures the
strictly validated snippet privately. No React internals, request interception,
credential API, clipboard, script-dispatched press or timer extension of the
spent attempt is proposed.

## Proposed `OWNERPRESS1` execution contract

Obtain Astra review of the completed helper/tests and this exact contract before
execution. Root must verify reviewed clean HEAD, fresh owned Pro credit, the
continuous deployment/environment-copy/operator hold, private download and
destination ownership/modes/real paths, and unchanged retained accounting.
Durably reserve a new exclusive attempt before arming:

- One ordinary browser Show-secret click and at most one ordinary Hide-secret
  click, only on the exact target store's supported Quickstart control.
- At most one private browser download, only **after confirmed remasking**.
- No newly allocated Blob request: only a verified, different-key private import
  permits the original replacement-before-removal LIST check. The other two
  original checks and original CLI capture remain unused.
- Retain the spent rotation, old-key diagnostic and first capture, and $0.81
  planning reservations. UI/browser background traffic remains unmeasured;
  these gesture counts are not physical-request or provider-billing totals.

Open a new owned authenticated store tab and select the masked `.env.local`
snippet. Arm the reviewed observer before clicking. It pins the exact page,
requires one masked snippet and one enabled visible Show control, and stores
the token only inside a closure. A one-use page controller returns only fixed
safe states; it never returns a token, snippet, hash or arbitrary error.
The helper is [prepared offline](../scripts/blob-owner-ui-press-capture.mjs).
Its tests cover trusted Show/Hide ordering, remasking before download, rejected
untrusted/duplicate/out-of-order presses, token/page/shape failures, cancellation,
serialization and synchronous deadline checks when timer delivery is delayed.

Use `preview_act` for one Show click, then await the controller's safe token-ready
state within its 30-second total deadline. If there is an actual challenge or
any failure, stop and close the owned tab without a DOM snapshot. Do not submit
a challenge or repeat the click as a fallback.

Only token-ready permits the one ordinary Hide click. The observer requires the
expected trusted events and a masked snippet before requesting the download.
On timeout, abort, duplicate/out-of-order event, wrong token/store/page or any
ambiguity, close and stop. A requested download is not successful capture.

Resolve only the completed download through the T3 download record. Use the
already-reviewed `importOwnerDownloadedCredential` checks: owner-only private
directories, regular 0600 source without symlink following, at most 512 bytes,
sole exact dotenv key, expected store, difference from retained baseline,
exclusive synchronized destination, byte verification, and removal of only the
verified downloaded inode. Close the owned tab on success or failure.

After verified import, durably consume just the original replacement-before-
removal check. Use the unchanged default `probeBlobCredential` transport, one
LIST(limit=1), explicit current credential, expected store and original byte/time
limits. Require accepted/200 and agreement between returned result, private
attempt/output and root accounting. Every other outcome spends the attempt and
stops. Do not repeat capture/probe, rotate, change/disconnect the connection,
export or switch production on this allocation.

Return the actual result to Astra. A successful different current key plus the
earlier old-key forbidden result addresses the controlled comparison; connection
containment and the final overlapping log/drain reconciliation remain separate
gates. The other store's Preview/Development binding remains untouched.
