# Hosted release access

The frozen Blob export, production import, and independent comparison are complete. Production remains read-only until the hosted Next checks and release review pass.

The existing owned development backend `amicable-koala-816` was published from `ff8a8553e8d4ee04dd48349a011350db2fab1083`, initialized with an empty dataset, and closed. Setup used nine explicit controls, one CLI publication (internal calls unknown), 27 application calls, and 26 logical write reservations.

The first prebuilt deployment reached READY but stopped because the publisher expected a string from the share-link endpoint. Its exact owned deployment was deleted and a confirming 404 received. No hosted functional flow ran. Cumulative usage then stood at 91 application calls, three Next calls, 60 Next controls, one hosting request, 381 write reservations, seven gateway requests, and three creations.

The first automation diagnostic used an incorrect 64-character value. It stopped during generation after four controls and one hosting request. Subsequent ordinary owner UI inspection showed no configured automation secret and specified a 32-character value. The corrected diagnostic generated a 32-character secret, but its legacy-page header check failed. It used five controls and two hosting requests, then confirmed revocation and preservation of unrelated configuration. The HTTP status/body rejection reason was not retained and remains unknown. Neither diagnostic created a deployment; both remain spent.

These observations establish the supported generation/revocation mechanism, not successful header access. There will be no further dummy-probe cycle. One new candidate must establish its own access and exact configuration through `local-prebuilt+signed-runtime-v1` before signup or other functional writes. Failure revokes the project-wide automation secret and deletes only the owned candidate. The secret has no provider expiry; the 15-minute local deadline does not replace explicit revocation.

The cumulative starting point is 91 application calls, three Next calls, 69 Next controls, four hosting requests, 381 write reservations, seven gateway requests, and three creations. Publication allows at most 20 additional controls, three hosting requests, one application query, and one creation. Runtime retains its 19-control allocation and existing application/write/hosting limits; all preceding costs remain included. The conservative cumulative Next control cap is 110. Backend setup and earlier backend control/publication traffic remain separately reported.

Production publication is a separate staged operation after actual hosted acceptance: build for the production Convex URLs, verify signed readiness before enabling writes, promote the owned candidate, verify production bindings, then revoke the temporary automation secret. Its 30-control ceiling reserves eight for cleanup and permits up to 22 ordinary controls, covering all three allowed readiness polls. Failed or uncertain promotion preserves the candidate for forward repair and closes writes.

Cancellation, refund submission, PR merge, final approval, and conditional unit removal have not happened yet. No further Blob access is needed.
