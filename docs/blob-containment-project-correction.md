# Correct the project identity predicate without resetting usage

Status: proposed finite continuation after the partial containment run at
`d58b508`. The two original key checks and the clean Production CLI comparison
passed their reviewed conditions. Complete environment metadata confirmed the
other-store binding unchanged and no store-ID or preload injection. The project
metadata gate then stopped before the deployment read or drain timer.

Root's command incorrectly compared the project name to `attendancetracker`.
The retained, verified project identity is `attendance-tracker`. This is a local
predicate defect. The response was not preserved before that check, so the
actual response fields cannot now be independently revalidated. Keep request 6
spent; do not claim that its other predicates passed or reuse an absent response.
See the [partial evidence](./measurements/blob-connected-containment-partial.json).

Use the retained verified baseline name, project ID and account ID for the
corrected comparison rather than another hardcoded name. Preserve the minimally
normalized nonsecret project response privately **before** evaluating predicates,
so an unexpected result does not require another request merely for diagnosis.
Require Git disconnected, the effective timeout from
`resourceConfig.functionDefaultTimeout ?? defaultResourceConfig.functionDefaultTimeout`
equal to 300, and all current target deployment IDs within the audited set.

## Explicit reallocation for scoped Astra review

Keep the total management ceiling **18** and all six used requests. No key or CLI
check may repeat; slot 3 stays unused. Amend only the remaining read allocation:

| Remaining request | Ordinal / maximum |
| --- | ---: |
| One explicitly repeated owned-project GET with corrected predicate | 7 |
| Original complete-deployment GET | 8 |
| Original post-window nonwriting control | 9 |
| Unfiltered overlapping request-log pages | 10–18, at most 9 pages |

Thus six used plus twelve remaining remains eighteen. The log-page ceiling is
reduced from ten to nine; this is an explicit amendment, not borrowing a margin
or resetting a failed request. If pagination needs another page, stop.

Before dispatch, reserve this amendment durably and verify reviewed clean HEAD,
fresh owned credit/authentication, existing accepted private comparisons, the
continuous operator/deployment/environment-copy hold, and unused paths. One
request per reservation, no automatic retry. Persist sanitized response evidence
before each local predicate. A failure retains its request and stops.

Only accepted project and deployment evidence can create a new containment
confirmation. Start the 300-second interval from its latest success; then run
the reserved exact 401 control and complete unfiltered overlapping logs with all
the previously reviewed identity, source-classification and unresolved-write
checks. No previous timestamp is substituted for this confirmation.

Actual drain evidence still needs Astra review before the untouched final export
allocation. No connection mutation, Git restoration, hosted creation, production
import, paid spending or unit removal is included.
