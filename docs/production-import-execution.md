# Bounded production import

Status: the production import completed all three phases under reviewed source
`f2c4ab6`. Server verification passed and activation confirmed reads enabled with
writes disabled. Astra accepted the actual import milestone at `003e349`;
independent semantic reconciliation subsequently passed. Its actual milestone
review, hosted validation and cutover remain pending.

The completed run used 36 application-call reservations, 21 verification calls
and 755 logical document-write reservations, within 55/40/774. All three attempts
completed without a failed/interrupted attempt; root verified the private
reservation chain, immutable ledger permissions and unchanged source binding.
See [the aggregate evidence](./measurements/production-import.json).

Seven chunks created the planned 357 target documents: three accounts, two
classes and their two current-state documents, three credential documents,
three owner links, three reusable roster versions with 132 ordered member rows, three
teacher memberships, seven attendance sessions, one closure and 198 sparse
attendance rows. The planned 723 retained documents also include migration
receipts/state; that total has not been measured independently. Server
verification compares actual tables to import receipts. The separate independent
comparison of business fields and relationships directly to the frozen source
also passed; see [the reconciliation result](./production-reconciliation.md).
Public traffic remains disconnected. Retain this completed allocation; unused
capacity is not permission for additional operations.

The [wrapper](../scripts/execute-production-import.mjs) accepts only the preserved
298-object frozen dataset and the intended `tremendous-elk-298` production target.
It binds exact source bytes, canonical fingerprint, deterministic plan, reviewed
commit, runtime/dependency source digest, fixed budget and absolute ledger path.
It rejects drift before reading a key or dispatching a request. A default dry run
reads the private input and reports counts without creating a client or ledger:

```sh
pnpm exec node scripts/execute-production-import.mjs --input /PRIVATE/frozen-source.snapshot.json
```

## Ready manifest and separate phases

The manifest contract is in the wrapper header. It must contain actual reviewed
source, target-identity, publication and all-team Free quota evidence. Setting a
JSON `reviewed` field is not proof of any provider fact. Publication must include
the atomic read-only activation code. The quota evidence binds the team, all
projects, UTC period window, observed usage/limits and conservative headroom;
it expires after 24 hours and may refresh without resetting the allocation.
Its period endpoints may be a conservative window inside displayed date labels,
not inferred provider reset instants.

The key file contains only the raw deployment capability, with no added newline;
its value never appears in arguments or output. Inputs are regular owned 0400 or
0600 files in real owned 0700 directories. Prepare the empty absolute ledger
directory privately before the first phase. After separate approval:

```sh
pnpm exec node scripts/execute-production-import.mjs --input /PRIVATE/frozen-source.snapshot.json --manifest /PRIVATE/ready.json --key-file /PRIVATE/production-key --ledger /PRIVATE/PRODUCTION_IMPORT1 --apply --phase stage
pnpm exec node scripts/execute-production-import.mjs --input /PRIVATE/frozen-source.snapshot.json --manifest /PRIVATE/ready.json --key-file /PRIVATE/production-key --ledger /PRIVATE/PRODUCTION_IMPORT1 --apply --resume --phase verify
pnpm exec node scripts/execute-production-import.mjs --input /PRIVATE/frozen-source.snapshot.json --manifest /PRIVATE/ready.json --key-file /PRIVATE/production-key --ledger /PRIVATE/PRODUCTION_IMPORT1 --apply --resume --phase activate-readonly
```

No phase automatically runs the next. Keep HEAD and bound source unchanged across
the run. Every later invocation explicitly resumes the same ledger; selecting a
new directory cannot reset the allocation because its absolute path is bound.

## Limits that survive interruption

The cumulative ceilings are **55 application calls, 40 verification dispatches
and 774 logical document-write reservations**. A request's immutable receipt is
synchronized before dispatch. Errors, cancellations and uncertain responses stay
spent. Publication, configuration, reconciliation, hosting, provider transaction
retries and other deployments are excluded and require separate accounting.
These are engineering reservations rather than provider billing guarantees.

The default transport sends one fixed-origin HTTPS POST per reservation, follows
no redirects, retries nothing and bounds response bytes, headers and time. It
strips SDK logs/errors and emits only fixed safe failure categories. The SDK
client has no arbitrary function-dispatch path exposed by the CLI.

Lost bootstrap responses resume through idempotent initialization/begin; begin's
server checkpoint determines remaining chunks. Verification resumes its persisted
cursor, with the forty-first dispatch refused before transport. Concurrent runs
fail against the exclusive owner-bound lock. Torn history fails closed.

After process loss, retain the lock and every receipt. The explicit offline
recovery command verifies the recorded Linux process/boot identity is dead,
validates the exact allocation/history, records only a missing final outcome as
failed with its actual spent totals, and removes only the verified lock inode:

```sh
pnpm exec node scripts/execute-production-import.mjs --input /PRIVATE/frozen-source.snapshot.json --manifest /PRIVATE/ready.json --ledger /PRIVATE/PRODUCTION_IMPORT1 --resume --recover-interrupted
```

Recovery reads no key and sends no RPC. Apply/resume remains a separate command.
An active/unknown owner, torn record or interrupted recovery requires operator
investigation; never remove locks merely because they are old.

## Publication stays read-only

`migration:activate({ readOnly: true })` publishes the verified dataset with reads
enabled and writes disabled in the same transaction. Internal checkpoint reads
continue to work during maintenance. The wrapper also idempotently sets and
confirms read-only availability, including after a lost activation response.
Check-ins, signup and session creation remain blocked. Public traffic still
requires hosted validation, production reconciliation and final Astra approval.
