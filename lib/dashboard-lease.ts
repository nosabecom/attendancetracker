import { readVersioned, compareAndWrite, del } from "./storage";
import { hash, HttpError } from "./auth";
import { validId } from "./classes";
import { dashboardRestrictionActive, SINGLE_DASHBOARD_UNTIL } from "./dashboard-policy.mjs";
import { BlobPreconditionFailedError } from "@vercel/blob";

const LEASE_MS = 180_000;
const RENEW_BEFORE_MS = 60_000;
const pathFor = (classId: string) => `dashboard-leases/${validId(classId)}.json`;
const matches = (lease: any, owner: string, token: string) =>
  lease?.owner === owner && lease?.tokenHash === hash(token);

function busy() {
  return new HttpError(
    "This class’s live dashboard is open in another tab. Close or hide that tab, then try again. If it disconnected, access recovers within three minutes.",
    423,
  );
}

export async function claimDashboard(classId: string, owner: string, token: string | null) {
  if (!dashboardRestrictionActive()) return undefined;
  if (!token || !/^[a-f0-9]{32}$/.test(token)) {
    throw new HttpError("Reload this page to open the live dashboard in one tab.", 423);
  }
  const path = pathFor(classId);
  const current = await readVersioned(path);
  const now = Date.now();
  if (current && current.value.expiresAt > now) {
    if (!matches(current.value, owner, token)) throw busy();
    if (current.value.expiresAt - now > RENEW_BEFORE_MS) return current.value.expiresAt;
  }
  const next = { owner, tokenHash: hash(token), expiresAt: Math.min(now + LEASE_MS, SINGLE_DASHBOARD_UNTIL) };
  try {
    // Create-only for the first claim; ETag comparison for renewal or takeover.
    await compareAndWrite(path, next, current?.etag);
  } catch (error) {
    const latest = await readVersioned(path);
    if (latest && latest.value.expiresAt > Date.now()) {
      if (matches(latest.value, owner, token)) return latest.value.expiresAt;
      throw busy();
    }
    throw error;
  }
  return next.expiresAt;
}

export async function releaseDashboard(classId: string, owner: string, token: string | null) {
  if (!token || !/^[a-f0-9]{32}$/.test(token)) return;
  const path = pathFor(classId);
  const current = await readVersioned(path);
  if (!current || !matches(current.value, owner, token)) return;
  try {
    // A late release must never delete a renewed or newly claimed lease.
    await del(path, { ifMatch: current.etag });
  } catch (error) {
    if (!(error instanceof BlobPreconditionFailedError)) throw error;
  }
}
