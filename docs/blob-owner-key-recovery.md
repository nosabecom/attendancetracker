# Retrieve the current key through the store owner's UI

Status: proposed narrow recovery after the stopped HTTP 422 rotation and the
single old-key `403 / forbidden` diagnostic. No second rotation, connection edit,
current-key capture or writer-freeze declaration has occurred.

The authenticated target store's Quickstart `.env.local` snippet has ordinary
Show/Hide secret controls. This is a supported store-owner read, not protected
project Secret conversion, framework-state inspection, or a new API. The other
store's Preview/Development environment binding stays untouched.

## Private transfer preflight completed without a secret

A fixed nonsecret browser Blob download reached the T3 browser's download
directory. Root verified its exact expected bytes, file mode 0600, containing
directories 0700, owner UID, and absence of symlinks. No real credential was
revealed or downloaded. Browser-generated filenames are opaque local paths;
the credential must never appear in returned values, URLs, tool arguments,
stdout, error text, screenshots, clipboard contents, hashes or committed files.

## Proposed `OWNERCAPTURE1` operation

Require scoped Astra acceptance of this exact helper and procedure, reviewed
clean HEAD, the continuous deployment/environment-copy/operator hold, and fresh
owned Pro credit evidence. Durably reserve one Show-secret invocation and at
most one private browser download in a new exclusive owner-only record before
use. Retain every previous allocation, including the spent rotation and old-key
diagnostic. Browser/provider background requests are not claimed to be counted
by the one-gesture allocation.

1. Use the already-owned authenticated target-store tab, `.env.local` selected
   and snippet masked. Recheck the private download directory's ownership,
   modes and real path. No hidden framework data or response interception.
2. Invoke `captureBlobOwnerCredentialInPage` from
   [the helper](../scripts/blob-owner-ui-capture.mjs) once. It pins the exact
   origin/store page, rejects ambiguous snippets and repeated invocation,
   clicks Show secret once, waits at most five seconds, and validates the
   target store's static-token shape. It then clicks Hide secret and confirms
   masking within five seconds **before** requesting the private download.
   Returned records contain only fixed status/categories, never the snippet.
3. Resolve only that one completed download through T3's download record. Open
   it without following symlinks; require owner UID, 0600 mode, a private real
   directory, at most 512 bytes, the exact sole dotenv key and expected store.
   Compare privately against the retained baseline: require a different token.
   Write a new exclusive 0600 file in the reserved 0700 recovery directory,
   synchronize file and directory, verify bytes, then unlink only the verified
   downloaded inode. Never copy the key into project environments or argv.
4. Close the owned browser tab after capture or any failure. If remasking fails,
   close it immediately; do not snapshot its DOM. A failed, ambiguous, unchanged,
   incomplete or canceled capture spends this attempt and stops. Persistence
   failure does not authorize another filename or reveal.
5. On a verified capture, consume **only the original replacement-before-removal
   static check**: the unchanged default `probeBlobCredential` transport, one
   LIST(limit=1), exact target store, explicit captured token, original limits
   and new exclusive paths in ISOLATION1. Require returned result and both
   persisted records to agree on accepted/200. No GET, retry, fallback or extra
   allocation. The original old-after-rotation and post-removal checks remain
   unused. Stop on failure and preserve the private current key.

This can establish that a different current key succeeds while the retained old
key was forbidden. It does not alone establish that current project environment
variables lack the new key, that the connection can be removed safely, or that
all admitted writes have drained. Return the actual capture/comparison evidence
to Astra before connection removal, any configuration change or final export.
The unused CLI capture is not consumed or silently substituted as a retry.

Offline tests cover successful remasking-before-download, no replay, wrong page,
ambiguous snippets, wrong-store/malformed tokens, reveal/mask timeouts and static
failure reporting without arbitrary-error leakage. Filesystem stalls cannot be
forcibly bounded by the browser timer; download completion and private import
are independent success requirements.
