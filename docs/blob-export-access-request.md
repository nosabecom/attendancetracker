# Vercel export-access request

Status: the owner authorized contacting Vercel, and this request was sent through
the authenticated Vercel Support chat on 2026-11-09 UTC (November 8 Saskatchewan
time). The case form was submitted under Billing / Usage Enquiry and the dashboard
confirmed case `CSE_015biYiwnR3FpTkS`, Open, Severity 2. No human response or access
exception is confirmed. The summary below contains no credentials or attendance
records.

The dashboard now explicitly says access resumes December 4, 2026. The scheduled
November 8 origin-read retry still returned 403. The request asks for the fastest
free export-only access or provider-side backup and expressly declines an upgrade,
Pro trial, payment or paid overages. Support was told not to fully restore
writable access until all old writers have been frozen.

The support agent offered an **Unblock My Account** action and described it as a
free, one-time Hobby courtesy unblock. That is an AI response, not confirmation
of eligibility or a completed unblock. The action has not been activated. The
case asks whether it covers this private store, whether a read-only exception or
backup is available, and how to revoke old credentials while retaining exclusive
export access. Dedicated CDN / Blob support was plan-gated; the genuine usage
and suspension enquiry accepted the case without changing the Hobby plan.

A follow-up in that same case reports the inspected zero-hour rotation setting
and the displayed legacy static-token connection. It asks for confirmation of
free eligibility, replacement-token retrieval independently of deployment
environments, and all store-authorized OIDC access. The case remains awaiting a
support-team response; no duplicate case or automatic unblock was requested.

A later accepted, separately bounded development OIDC check received HTTP 200
from one Blob `LIST limit=1` request. It downloaded no object bodies and saved no
metadata fields. This finding and the established operational deployment hold
were added to the same case. Support was asked for all-environment OIDC
revocation semantics and whether a supported OIDC body-export path could work
during suspension. No such path is established by the successful listing.

The separately reviewed body check subsequently returned LIST 200 followed by
private origin GET 403. Its two-request allocation is spent; no object data was
accepted or saved. This final result was sent in the same case, and the access
investigation has stopped without another probe cycle. Across both OIDC checks,
there were two LISTs and one object GET, with no retry or token remint. Support
is now asked to identify the quickest supported free recovery path and complete
credential freeze. No rotation, store disconnect or unblock has occurred.

See the [recovery preparation](./blob-recovery-preparation.md) for the proposed
sequence and the provider facts that still need verification. The existing
December 4 banner remains the fallback date, not a guaranteed successful export.

## Request summary

Hello Vercel team,

Our Hobby team's private Blob store is suspended after exceeding its included
usage. We need a supported way to export our existing data for migration.
Please advise whether a temporary export-only access window or provider-side
export is available without upgrading the plan.

- Team: `nomokaro625-9385s-projects`
- Project: `attendance-tracker`
- Production store: `store_raW6bHbRonffwrRf`
- Observed state: `limits-exceeded-suspended`, `usageQuotaExceeded: true`
- Inventory: 298 objects, approximately 31.69 KB
- A metadata listing succeeds; an authenticated private object read returns 403.

We have implemented a replacement backend and removed attendance polling in the
new version. Before any temporary access is enabled, we will freeze every old
writer, including historical deployment URLs, so access does not restart the
polling/write traffic. We need to preserve the existing accounts and historical
attendance; an empty replacement is not sufficient.

Please confirm the available recovery/export path and any access-restoration
timing. We are not authorizing an upgrade or paid overages.
