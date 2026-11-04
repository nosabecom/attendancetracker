# Prepared Vercel access request — not sent

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
