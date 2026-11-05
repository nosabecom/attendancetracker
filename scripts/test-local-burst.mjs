#!/usr/bin/env node
// Fixed, bounded, real HTTP-action test. No client retry and no cloud fallback.
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { signGatewayRequest } from "../lib/gateway-proof.mjs";

const fn = name => makeFunctionReference(name);
const run = randomBytes(12).toString("hex");
const ipHash = createHash("sha256").update(run).digest("hex");
const legacy = size => run + String(size).padStart(8, "0");
const identity = ordinal => `LB${String(ordinal + 1).padStart(4, "0")}`;
const studentName = ordinal => `Burst Student ${String(ordinal + 1).padStart(4, "0")}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const inventory = [];
const report = {
  version: 2, localOnly: true, startedAt: new Date().toISOString(),
  method: "Actual local gateway; random production-shaped proofs; no client retries",
  bounds: { initialCheckins: 2030, freshDuplicates: 1000, controls: 5,
    maxPublicRequests: 3200, plannedPublicRequests: 3035, concurrencyBaseline: 1, concurrencyBurst: 20,
    requestTimeoutMs: 30000, arrivalDeadlineMs: 240000, minimumBucketRemainingMs: 300000,
    maxCleanupBatches: 240, maxDeletesPerCleanupBatch: 100, maxAdminCalls: 400,
    seedFixtureWrites: 3328, controlFixtureWrites: 1, plannedActorAndRosterWrites: 2048,
    plannedTotalFixtureWrites: 5377 },
  windows: [], assertions: {}, submitted: 0, completed: 0, adminCalls: 0,
  seedAndControlFixtureWrites: 0, cleanup: { done: false, batches: 0, deleted: 0 },
  limitations: ["Local synthetic concurrency 20; not a production capacity measurement.",
    "Reservation success and HTTP attendance success are distinct; a downstream failure can consume permits without a fact.",
    "Retained nonce coverage can be incomplete after expiry; missing receipts and fallback behavior are unknown, not zero.",
    "Bounded logs are a partial sample and cannot establish a whole-run retry count."],
};
let phase = "validate-origins", admin, backend, site, adminKey, secret, audience;
let fixtureAttempted = false, stop = false, deadline, timedOut = false, fixedBucket;
const checks = (key, value) => { report.assertions[key] = Boolean(value); };
const requestIds = new Set();
const stopOnSignal = () => { stop = true; };
process.on("SIGINT", stopOnSignal);
process.on("SIGTERM", stopOnSignal);

function origin(value, expectedPort) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port !== String(expectedPort) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("Explicit matching loopback origin required.");
  return url;
}
async function optionalFile(path) {
  try { return await readFile(new URL(path, import.meta.url), "utf8"); }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}
function envValue(text, key) {
  // First pass extracts origins alone; it does not parse or access secret values.
  const match = text.match(new RegExp(`^${key}=([^\\r\\n]*)`, "m"));
  return match?.[1]?.trim().replace(/^(['"])(.*)\1$/, "$2");
}
async function boundedJson(response, maxBytes) {
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("Response budget exceeded.");
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function call(kind, name, args) {
  report.adminCalls++;
  if (report.adminCalls > report.bounds.maxAdminCalls) throw new Error("Administrative call budget exceeded.");
  admin.setFetchOptions({ redirect: "error", signal: AbortSignal.timeout(30000) });
  return admin[kind](fn(name), args);
}
async function logPage(cursor) {
  try {
    const response = await fetch(`${backend.origin}/api/stream_function_logs?cursor=${cursor}`, {
      headers: { Authorization: `Convex ${adminKey}` }, redirect: "error", signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return null;
    const data = await boundedJson(response, 4 * 1024 * 1024);
    if (!Array.isArray(data.entries) || data.entries.length > 10000 || !Number.isFinite(data.newCursor)) return null;
    return data;
  } catch { return null; }
}
function summarizeLogs(data) {
  if (!data) return { available: false, retryCount: "UNKNOWN" };
  const handlers = {};
  for (const entry of data.entries) {
    const name = String(entry.identifier).replace(".js:", ":");
    if (entry.kind !== "Completion" || !["authSupport:reserve", "attendance:publicCheckin", "/gateway/checkin"].includes(name)) continue;
    const row = handlers[name] ??= { completionEntries: 0, errorEntries: 0, willRetryEntries: 0, explicitOccRetryEntries: 0,
      occThrottleCounterEntries: 0, errorsMentioningConflict: 0, maxReportedRetryCount: null };
    row.completionEntries++;
    row.errorEntries += Boolean(entry.error);
    row.willRetryEntries += entry.willRetry === true;
    row.occThrottleCounterEntries += entry.occInfo?.tableName === "throttleCounters";
    row.errorsMentioningConflict += Boolean(entry.error && /concurrent|conflict|OCC|optimistic|changed while|changed by/i.test(entry.error));
    if (Number.isSafeInteger(entry.occInfo?.retryCount)) {
      row.explicitOccRetryEntries++;
      row.maxReportedRetryCount = Math.max(row.maxReportedRetryCount ?? 0, entry.occInfo.retryCount);
    }
  }
  return { available: true, sampledEntries: data.entries.length, handlers,
    scope: "Bounded post-cursor local log sample, concurrent workers may contribute; not complete request attribution",
    retryCount: "UNKNOWN (no complete per-request attempt accounting)" };
}
async function submit(size, studentOrdinal, { operation = "checkin", replay, invalid = false, control = false, raw } = {}) {
  const start = performance.now();
  const payload = operation === "public-info" ? { legacyId: legacy(size) } : { legacyId: legacy(size), identity: control ? "exhausted-control" : identity(studentOrdinal) };
  const nonce = randomUUID().replaceAll("-", "");
  const proof = replay ?? await signGatewayRequest(operation, payload, { secret, audience, ipHash, nonce });
  if (!replay && operation === "checkin" && !invalid && raw === undefined) inventory.push(proof.nonce);
  const signedProof = invalid ? { ...proof, signature: (proof.signature[0] === "0" ? "1" : "0") + proof.signature.slice(1) } : proof;
  report.submitted++;
  if (report.submitted > report.bounds.maxPublicRequests) throw new Error("Public request budget exceeded.");
  try {
    const response = await fetch(`${site.origin}/gateway/${operation}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: raw ?? JSON.stringify({ payload, proof: signedProof }), redirect: "error", signal: AbortSignal.timeout(30000),
    });
    const requestId = response.headers.get("x-convex-request-id");
    if (requestId) requestIds.add(requestId);
    const body = await boundedJson(response, 4096);
    const keys = Object.keys(body).sort().join(",");
    const accepted = response.status === 200;
    const privateShape = operation === "public-info"
      ? keys === "closed,title" && body.closed === false && body.title === `Local shared-IP burst ${size}`
      : accepted ? (keys === "name" || keys === "already,name") && body.name === studentName(studentOrdinal) &&
        (body.already === undefined || body.already === true)
        : keys === "error" && typeof body.error === "string" && body.error.length < 200;
    return { ordinal: studentOrdinal, status: response.status, accepted, already: body.already === true,
      privacy: Boolean(privateShape), ms: performance.now() - start, proof };
  } catch (error) {
    timedOut ||= error.name === "TimeoutError";
    return { ordinal: studentOrdinal, status: "transport-error", accepted: false, already: false, privacy: true,
      ms: performance.now() - start, proof };
  } finally { report.completed++; }
}
function summary(label, rows, concurrency, elapsed, planned) {
  const times = rows.map(r => r.ms).sort((a, b) => a - b);
  const percentile = p => times.length ? Math.round(times[Math.ceil(times.length * p) - 1] * 100) / 100 : null;
  const statuses = {};
  for (const row of rows) statuses[row.status] = (statuses[row.status] ?? 0) + 1;
  const result = { label, planned, requests: rows.length, concurrency, wallMs: Math.round(elapsed),
    requestsPerSecond: Math.round(rows.length / (elapsed / 1000) * 100) / 100,
    statuses, accepted: rows.filter(r => r.accepted).length, rejected: rows.filter(r => !r.accepted).length,
    already: rows.filter(r => r.already).length, privacyFailures: rows.filter(r => !r.privacy).length,
    latencyMs: { p50: percentile(.5), p95: percentile(.95), p99: percentile(.99), max: percentile(1) } };
  report.windows.push(result);
  return result;
}
async function window(label, size, count, concurrency, options = {}) {
  const start = performance.now(), rows = [];
  let next = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (!stop && performance.now() < deadline) {
      const i = next++;
      if (i >= count) return;
      if (options.interleaveControl && i === 500) {
        const control = await submit(size, 0, { control: true });
        report.exhaustedControl = { status: control.status, privacy: control.privacy };
      }
      rows.push(await submit(size, i, options));
    }
  });
  const settled = await Promise.allSettled(workers);
  if (settled.some(r => r.status === "rejected")) throw new Error("Worker failed after all completions settled.");
  summary(label, rows, concurrency, performance.now() - start, count);
  return rows;
}
const unchanged = (before, after) => before.metadataDigest === after.metadataDigest && after.count === before.count &&
  before.facts.every(a => after.facts.some(b => a.ordinal === b.ordinal && a.id === b.id &&
    a.creationTime === b.creationTime && a.checkedInAt === b.checkedInAt));

async function collectSecurity(label, nonces) {
  const totals = { requested: 0, found: 0, encoded: 0, occupancy: Array(64).fill(0),
    ipChosen: Array(64).fill(0), sessionChosen: Array(64).fill(0), ipFallback: 0, sessionFallback: 0 };
  for (let i = 0; i < nonces.length; i += 100) {
    const part = await call("query", "localBurst:security", { run, nonces: nonces.slice(i, i + 100) });
    for (const key of ["requested", "found", "encoded", "ipFallback", "sessionFallback"]) totals[key] += part[key];
    for (const key of ["occupancy", "ipChosen", "sessionChosen"]) for (let j = 0; j < 64; j++) totals[key][j] += part[key][j];
  }
  totals.submittedPrimaryOccupancy = Array(64).fill(0);
  for (const nonce of nonces) totals.submittedPrimaryOccupancy[parseInt(nonce.slice(-8), 16) % 64]++;
  totals.missing = totals.requested - totals.found;
  totals.missingReason = totals.missing ? "UNKNOWN: expiry, rejection, or failed reservation" : "none";
  totals.fallbackCoverage = totals.encoded === totals.requested ? "complete" : "partial; missing fallback decisions UNKNOWN";
  report.security ??= {}; report.security[label] = totals;
}
try {
  if (process.argv.length !== 2) throw new Error("No options accepted; coordinator publishes separately.");
  const localText = await optionalFile("../.env.local");
  backend = origin(process.env.NEXT_PUBLIC_CONVEX_URL ?? envValue(localText, "NEXT_PUBLIC_CONVEX_URL"), 3210);
  site = origin(process.env.CONVEX_SITE_URL ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? envValue(localText, "NEXT_PUBLIC_CONVEX_SITE_URL"), 3211);
  phase = "validate-local-config";
  const config = JSON.parse(await readFile(new URL("../.convex/local/default/config.json", import.meta.url), "utf8"));
  if (config.ports?.cloud !== Number(backend.port) || config.ports?.site !== Number(site.port)) throw new Error("Local port mismatch.");
  adminKey = config.adminKey;
  const env = { ...parseEnv(await optionalFile("../.convex/local-auth.env")), ...parseEnv(localText) };
  secret = process.env.ATTENDANCE_GATEWAY_KEY ?? env.ATTENDANCE_GATEWAY_KEY;
  audience = process.env.ATTENDANCE_GATEWAY_AUDIENCE ?? env.ATTENDANCE_GATEWAY_AUDIENCE;
  if (!adminKey || typeof secret !== "string" || Buffer.byteLength(secret) < 32 || !audience) throw new Error("Missing local keys.");
  admin = new ConvexHttpClient(backend.origin, { logger: false });
  admin.setAdminAuth(adminKey); admin.setDebug(false);
  phase = "prepare-actor"; fixtureAttempted = true;
  const actor = await call("mutation", "localBurst:prepare", { run });
  admin.setAdminAuth(adminKey, { subject: actor.subject, issuer: site.origin });
  const before = {};
  for (const size of [30, 1000, 1001]) {
    phase = `create-${size}`;
    const count = size === 1001 ? 1000 : size;
    const csv = "name,id\n" + Array.from({ length: count }, (_, i) => `${studentName(i)},${identity(i)}`).join("\n");
    await call("mutation", "attendance:create", { newId: legacy(size), title: `Local shared-IP burst ${size}`, csv });
    before[size] = await call("query", "localBurst:snapshot", { run, size });
    if (before[size].count !== 0) throw new Error("Fixture attendance was not empty.");
  }
  // The complete fairness workload must fit the same bucket. Never begin arrivals
  // near rollover or silently omit duplicates after a boundary.
  if (900000 - Date.now() % 900000 < report.bounds.minimumBucketRemainingMs) throw new Error("Insufficient fixed bucket time.");
  fixedBucket = Math.floor(Date.now() / 900000);
  deadline = performance.now() + report.bounds.arrivalDeadlineMs;
  phase = "baseline-30"; const head = await logPage(0);
  const baseline = await window("baseline-30", 30, 30, 1);
  const b1 = await call("query", "localBurst:snapshot", { run, size: 30 });
  checks("baselineAll200", baseline.length === 30 && baseline.every(r => r.accepted && !r.already));
  checks("baselineFactsAndMetadata", b1.count === 30 && before[30].metadataDigest === b1.metadataDigest);
  const replay = await submit(30, 0, { replay: baseline.find(r => r.ordinal === 0)?.proof });
  const invalid = await submit(30, 0, { invalid: true });
  const malformed = await submit(30, 0, { raw: "{" });
  const nullBody = await submit(30, 0, { raw: "null" });
  report.controls = { replay: replay.status, invalidHmac: invalid.status, malformed: malformed.status, nullBody: nullBody.status };
  checks("controlStatusesAndPrivacy", replay.status === 429 && invalid.status === 403 && malformed.status === 400 && nullBody.status === 400 && [replay, invalid, malformed, nullBody].every(r => r.privacy));
  phase = "fresh-1000";
  const fresh = await window("fresh-1000", 1000, 1000, 20);
  const s1 = await call("query", "localBurst:snapshot", { run, size: 1000 });
  checks("freshAll200", fresh.length === 1000 && fresh.every(r => r.accepted && !r.already));
  checks("freshFactsAndMetadata", s1.count === 1000 && before[1000].metadataDigest === s1.metadataDigest);
  await collectSecurity("fresh", fresh.map(r => r.proof.nonce));
  phase = "seed-cleanup";
  for (let partition = 0; partition < 64; partition++) {
    const seed = await call("mutation", "localBurst:seed", { run, partition }); report.seedAndControlFixtureWrites += seed.writes;
  }
  const initialSentinels = await call("query", "localBurst:sentinels", { run });
  report.seedInventory = await call("query", "localBurst:seedInventory", { run });
  if (report.seedInventory.minNonces <= 20 || report.seedInventory.minCounters <= 20) throw new Error("Insufficient expired seed inventory.");
  checks("seedSentinelsPresent", initialSentinels.live === 128 && initialSentinels.legacy === 128);
  phase = "cleanup-heavy";
  if (Math.floor(Date.now() / 900000) !== fixedBucket || performance.now() >= deadline) throw new Error("Fixed bucket expired before arrivals.");
  const exhausted = await call("mutation", "localBurst:exhaust", { run }); report.seedAndControlFixtureWrites += exhausted.writes;
  if (exhausted.bucket !== fixedBucket) throw new Error("Control bucket changed.");
  const heavy = await window("cleanup-heavy-1000", 1001, 1000, 20, { interleaveControl: true });
  const h1 = await call("query", "localBurst:snapshot", { run, size: 1001 });
  checks("heavyAll200", heavy.length === 1000 && heavy.every(r => r.accepted && !r.already));
  checks("heavyFactsAndMetadata", h1.count === 1000 && before[1001].metadataDigest === h1.metadataDigest);
  checks("exhaustedControl429", report.exhaustedControl?.status === 429 && report.exhaustedControl.privacy);
  phase = "fresh-proof-duplicates";
  if (Math.floor(Date.now() / 900000) !== fixedBucket || performance.now() >= deadline) throw new Error("Fixed bucket expired before duplicates.");
  const duplicates = await window("heavy-duplicates-1000", 1001, 1000, 20);
  const h2 = await call("query", "localBurst:snapshot", { run, size: 1001 });
  checks("allDuplicates200Already", duplicates.length === 1000 && duplicates.every(r => r.accepted && r.already));
  checks("duplicateFactsStable", unchanged(h1, h2));
  checks("sameFixedBucket", Math.floor(Date.now() / 900000) === fixedBucket);
  await collectSecurity("cleanupHeavy", heavy.map(r => r.proof.nonce));
  await collectSecurity("duplicates", duplicates.map(r => r.proof.nonce));
  report.counterAggregates = await call("query", "localBurst:counterTotals", { run, bucket: fixedBucket, size: 1001 });
  report.counterAggregateScope = "Retained current-bucket counters; includes all reservations, including any downstream failures; missing/expired history is unknown.";
  report.sentinels = await call("query", "localBurst:sentinels", { run });
  checks("liveAndLegacySentinelsSurvived", report.sentinels.live === 128 && report.sentinels.legacy === 128);
  checks("responsePrivacy", report.windows.every(w => w.privacyFailures === 0));
  checks("allPromiseCompletionsCaptured", report.completed === report.submitted);
  checks("entireBoundedWorkloadSent", report.submitted === report.bounds.plannedPublicRequests && !stop);
  report.executionLogs = summarizeLogs(await logPage(head?.newCursor ?? Date.now()));
} catch {
  report.failedPhase = phase; // Do not print exceptions, backend logs, or bodies.
  process.exitCode = 1;
} finally {
  // Every worker/HTTP promise has settled before reaching cleanup. If a request
  // timed out, allow bounded extra drain time for backend internal retries.
  if (timedOut) await delay(15000);
  if (admin && fixtureAttempted) {
    try {
      admin.setAdminAuth(adminKey);
      for (let i = 0; i < report.bounds.maxCleanupBatches; i++) {
        const nonces = inventory.slice(0, 100);
        const batch = await call("mutation", "localBurst:cleanupBatch", { run, nonces });
        if (batch.inventoryDone) inventory.splice(0, nonces.length);
        report.cleanup.batches++; report.cleanup.deleted += batch.deleted;
        if (batch.done) { report.cleanup.done = true; break; }
      }
    } catch { report.cleanup.failed = true; }
  }
  report.finishedAt = new Date().toISOString();
  report.passed = !report.failedPhase && report.cleanup.done && Object.values(report.assertions).every(Boolean);
  if (!report.passed) process.exitCode = 1;
  process.removeListener("SIGINT", stopOnSignal); process.removeListener("SIGTERM", stopOnSignal);
  console.log(JSON.stringify(report, null, 2));
}
