#!/usr/bin/env node
// Bounded native subscriptions against the explicitly selected loopback backend.
import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { randomBytes, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { signGatewayRequest } from "../lib/gateway-proof.mjs";

const require = createRequire(import.meta.url);
// Resolve the same installed ws implementation the Convex Node build bundles.
const NodeWebSocket = require(require.resolve("ws", { paths: [require.resolve("convex")] }));
const run = randomBytes(8).toString("hex"), started = performance.now();
const legacy = size => run + String(size).padStart(16, "0");
const fn = name => makeFunctionReference(name);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = value => createHash("sha256").update(value).digest("hex");
const report = {
  version: 1, localOnly: true, startedAt: new Date().toISOString(),
  bounds: { maxCalls: 300, maxFixtureWritesIncludingCleanup: 5000,
    maxCheckinsExcusesAndSharingChanges: 20, maxCleanupBatches: 70,
    requestTimeoutMs: 10000, totalTimeoutMs: 240000, logPageCap: 6, logEntryCap: 1000,
    maxLogResponseBytes: 4 * 1024 * 1024, burstConcurrency: 5, burstUpdates: 10, idleMs: 3000 },
  calls: { submitted: 0, settled: 0, subscriptions: 0, http: 0, logPages: 0 },
  setup: { managedTeachers: 0, rosterMembers: 1030, estimatedDomainAndManagedWrites: 1200,
    administrativeWrites: 0, measuredSeparately: true },
  domainOperations: 0, windows: [], assertions: {}, cleanup: { done: false, writes: 0, batches: 0, cancelledJobs: 0 },
  limitations: [
    "Local completion logs and usage fields are diagnostic evidence, not billing or metering proof.",
    "No argument-level bucket attribution exists in the sampled function log identifier.",
    "No whole-run attempt/retry total is inferred from partial metadata.",
    "Transport counts are UTF-8 application-message bytes and messages, excluding HTTP setup/admin/log traffic and TCP/TLS/compression overhead.",
    "Server cache reuse depends on identity, arguments, retained cache entries, and current backend behavior.",
    "Three-second idle windows do not cover SDK keepalive or one-hour auth rotation. Auth rotation is unmeasured here.",
    "Hosted capacity, other-team usage, monthly charges, and free-quota eligibility remain unknown.",
  ],
};
let backend, site, adminKey, secret, audience, phase = "validate-origins";
let sequence = 0, nonce = 0, cursor, cleaning = false, currentWindow, stopped = false;
const actors = [], clients = [], sockets = [], subscriptions = [];
const check = (key, value) => { report.assertions[key] = Boolean(value); };
function demand(key, value) {
  check(key, value);
  if (!value) throw new Error("Functional assertion failed.");
}
const stop = () => { stopped = true; };
process.on("SIGINT", stop); process.on("SIGTERM", stop);

function origin(value, port) {
  const url = new URL(value);
  if (url.origin !== `http://127.0.0.1:${port}` || url.href !== `${url.origin}/`)
    throw new Error("Explicit loopback origin required.");
  return url;
}
function reserveCall(kind) {
  if (report.calls.submitted >= (cleaning ? 300 : 220) ||
      performance.now() - started > (cleaning ? 240000 : 200000) || (!cleaning && stopped))
    throw new Error("Call or time budget exhausted.");
  report.calls.submitted++; report.calls[kind]++;
}
async function http(kind, name, args = {}, actor) {
  reserveCall("http");
  const client = new ConvexHttpClient(backend.origin, { logger: false });
  client.setDebug(false);
  if (actor?.token) client.setAuth(actor.token);
  else if (actor) { /* Anonymous managed signup. */ }
  else client.setAdminAuth(adminKey);
  client.setFetchOptions({ redirect: "error", signal: AbortSignal.timeout(10000) });
  try { return await client[kind](fn(name), args); }
  finally { report.calls.settled++; }
}
const fixture = (name, args = {}, kind = "mutation") => http(kind, `localSubscriptions:${name}`, { run, ...args });
async function publish() {
  const env = { ...process.env, CONVEX_DEPLOYMENT: "", CONVEX_DEPLOY_KEY: "",
    CONVEX_SELF_HOSTED_URL: backend.origin, CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey,
    CONVEX_DISABLE_TELEMETRY: "1", DO_NOT_TRACK: "1", CI: "1", VERCEL: "0",
    CONVEX_VERSION_API_ORIGIN: backend.origin };
  const code = await new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "convex", "dev", "--once", "--codegen", "disable",
      "--typecheck", "disable", "--tail-logs", "disable"], { env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.resume(); child.stderr.resume();
    const timer = setTimeout(() => child.kill("SIGTERM"), 60000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", value => { clearTimeout(timer); resolve(value); });
  });
  if (code !== 0) throw new Error("Local publish failed.");
  report.localFixturePublished = true;
}
async function boundedJson(response, maxBytes) {
  const reader = response.body.getReader(), chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("Response byte cap exceeded.");
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function logPage(from) {
  reserveCall("logPages");
  try {
    const response = await fetch(`${backend.origin}/api/stream_function_logs?cursor=${from}`, {
      headers: { Authorization: `Convex ${adminKey}` }, redirect: "error", signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error("Log transport unavailable.");
    const data = await boundedJson(response, report.bounds.maxLogResponseBytes);
    if (!Array.isArray(data.entries) || data.entries.length >= report.bounds.logEntryCap ||
        !Number.isFinite(data.newCursor) || data.newCursor <= from ||
        data.truncated || data.isTruncated || data.hasMore)
      throw new Error("Incomplete log page.");
    return data;
  } finally { report.calls.settled++; }
}
const identifier = entry => String(entry.identifier).replace(".js:", ":");
function marker(entry, expected) {
  return entry.kind === "Completion" && identifier(entry) === "localSubscriptions:checkpoint" &&
    entry.cachedResult === false && !entry.error && entry.logLines?.some(line =>
      (typeof line === "string" ? line : (line.messages ?? []).join(" ")).includes(`LS_CHECKPOINT_${expected}`));
}
async function drain(expected) {
  const entries = [];
  try {
    for (let page = 0; page < report.bounds.logPageCap; page++) {
      const data = await logPage(cursor);
      cursor = data.newCursor;
      entries.push(...data.entries);
      if (data.entries.some(entry => marker(entry, expected)))
        return { complete: true, pages: page + 1, entries };
    }
    return { complete: false, reason: "page-cap", entries: [] };
  } catch {
    return { complete: false, reason: "cursor-transport-truncation-or-delay", entries: [] };
  }
}
async function checkpoint() {
  const value = ++sequence;
  await fixture("checkpoint", { sequence: value }, "query");
  return value;
}
function aggregate(entries) {
  const handlers = {}, seen = new Set();
  for (const entry of entries) {
    const name = identifier(entry);
    if (entry.kind !== "Completion" || !name.startsWith("attendance:")) continue;
    const dedup = `${entry.requestId}/${entry.executionId}/${entry.timestamp}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);
    const row = handlers[name] ??= { udfType: entry.udfType, completions: 0, freshExecutions: 0,
      cachedInvocations: 0, cacheMetadataUnknown: 0, errors: 0, explicitWillRetry: 0,
      explicitOccEntries: 0, maximumReportedOccRetryCount: null,
      databaseReadDocuments: 0, databaseReadBytes: 0, databaseWriteDocuments: 0,
      usageMetadataUnknown: 0, returnBytes: 0 };
    row.completions++;
    if (entry.cachedResult === false) row.freshExecutions++;
    else if (entry.cachedResult === true) row.cachedInvocations++;
    else row.cacheMetadataUnknown++;
    row.errors += Boolean(entry.error);
    row.explicitWillRetry += entry.willRetry === true;
    if (Number.isSafeInteger(entry.occInfo?.retryCount)) {
      row.explicitOccEntries++;
      row.maximumReportedOccRetryCount = Math.max(row.maximumReportedOccRetryCount ?? 0, entry.occInfo.retryCount);
    }
    for (const key of ["databaseReadDocuments", "databaseReadBytes", "databaseWriteDocuments"]) {
      if (Number.isFinite(entry.usageStats?.[key])) row[key] += entry.usageStats[key];
      else row.usageMetadataUnknown++;
    }
    if (Number.isFinite(entry.returnBytes)) row.returnBytes += entry.returnBytes;
  }
  return handlers;
}
const freshQueries = window => window.logs.complete ? Object.values(window.logs.handlers)
  .filter(row => row.udfType === "Query").reduce((sum, row) => sum + row.freshExecutions, 0) : "UNKNOWN";
function bytes(value) {
  return typeof value === "string" ? Buffer.byteLength(value, "utf8") : value.byteLength;
}
function countTransport(direction, value) {
  if (!currentWindow) return;
  currentWindow.transport[`${direction}Bytes`] += bytes(value);
  currentWindow.transport[`${direction}Messages`]++;
}
class CountingWebSocket extends NodeWebSocket {
  constructor(...args) {
    super(...args);
    this.sentQuerySet = 0; this.ackQuerySet = 0;
    sockets.push(this);
    this.addEventListener("message", event => {
      countTransport("received", event.data);
      // Retain versions only. Authentication messages and query values are
      // neither retained by instrumentation nor printed.
      const message = JSON.parse(String(event.data));
      if (message.type === "Transition") this.ackQuerySet = Math.max(this.ackQuerySet, message.endVersion.querySet);
    });
  }
  send(value, ...args) {
    countTransport("sent", value);
    const message = JSON.parse(String(value));
    if (message.type === "ModifyQuerySet") this.sentQuerySet = message.newVersion;
    return super.send(value, ...args);
  }
}
async function until(predicate, timeoutMs = 10000) {
  const end = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= end || stopped) throw new Error("Settled barrier timed out.");
    await delay(20);
  }
}
async function acknowledged() {
  await until(() => sockets.every(socket => socket.readyState === NodeWebSocket.CLOSED ||
    (socket.readyState === NodeWebSocket.OPEN && socket.ackQuerySet >= socket.sentQuerySet)));
  await delay(200);
}
function connect(actor, label) {
  const client = new ConvexClient(backend.origin, { logger: false, webSocketConstructor: CountingWebSocket,
    initialAuthTokenReuse: true, unsavedChangesWarning: false });
  client.setAuth(async () => actor.token);
  const connection = { client, label, subscriptions: [] };
  clients.push(connection);
  return connection;
}
function subscribe(connection, name, args, label) {
  reserveCall("subscriptions");
  const state = { connection, label: `${connection.label}.${label}`, name, args, callbacks: 0, errors: 0,
    settled: false, active: true, denied: false, value: undefined };
  state.unsubscribe = connection.client.onUpdate(fn(name), args, value => {
    state.callbacks++; state.value = value; state.settled = true;
    if (currentWindow) currentWindow.callbacks[state.label] = (currentWindow.callbacks[state.label] ?? 0) + 1;
  }, error => {
    state.errors++; state.settled = true;
    state.denied = error?.data?.status === 403;
    if (currentWindow) currentWindow.errors[state.label] = (currentWindow.errors[state.label] ?? 0) + 1;
  });
  connection.subscriptions.push(state); subscriptions.push(state);
  // Subscription registration is synchronous. Initial deliveries have a separate
  // settled barrier and are counted as callbacks, not calls.
  report.calls.settled++;
  return state;
}
function attach(connection, classes, largeOnly = false) {
  for (const size of largeOnly ? [1000] : [30, 1000]) {
    const key = size === 30 ? "small" : "large", args = { legacyId: legacy(size) };
    subscribe(connection, "attendance:roster", args, `${key}.roster`);
    subscribe(connection, "attendance:session", args, `${key}.session`);
    subscribe(connection, "attendance:history", { classId: classes[size], paginationOpts: { numItems: 10, cursor: null } }, `${key}.history`);
    for (let bucket = 0; bucket < Math.ceil(size / 100); bucket++)
      subscribe(connection, "attendance:bucket", { ...args, bucket }, `${key}.bucket.${bucket}`);
  }
  if (!largeOnly) {
    subscribe(connection, "attendance:session", { legacyId: legacy(1001) }, "unrelated.session");
    subscribe(connection, "attendance:roster", { legacyId: legacy(1001) }, "unrelated.roster");
    subscribe(connection, "attendance:bucket", { legacyId: legacy(1001), bucket: 0 }, "unrelated.bucket.0");
  }
}
async function initial(connections) {
  await until(() => connections.every(c => c.subscriptions.every(s => s.settled)));
  demand(`initialData${report.windows.length}`, connections.every(c => c.subscriptions.every(s => s.errors === 0)));
  await acknowledged();
}
async function window(label, work) {
  phase = label;
  // Establish a known start completion, then drain it before starting counters.
  const startLogs = await drain(await checkpoint());
  const result = { label, transport: { sentBytes: 0, receivedBytes: 0, sentMessages: 0, receivedMessages: 0 },
    callbacks: {}, errors: {} };
  report.windows.push(result); currentWindow = result;
  const start = performance.now();
  try { await work(result); await delay(300); }
  finally {
    result.elapsedMs = Math.round(performance.now() - start);
    currentWindow = undefined;
    const endLogs = await drain(await checkpoint());
    const complete = startLogs.complete && endLogs.complete;
    result.logs = { complete, checkpointStartObserved: startLogs.complete, checkpointEndObserved: endLogs.complete,
      pages: endLogs.pages ?? null, completionCount: complete ? endLogs.entries.filter(e => e.kind === "Completion").length : "UNKNOWN",
      handlers: complete ? aggregate(endLogs.entries) : {},
      queryFreshExecutions: "UNKNOWN", totalRetryCount: "UNKNOWN" };
    if (!complete) result.logs.reason = endLogs.reason ?? startLogs.reason;
    result.logs.queryFreshExecutions = freshQueries(result);
  }
  return result;
}
function callbackCount(window) { return Object.values(window.callbacks).reduce((a, b) => a + b, 0); }
function isolated(window, bucket) {
  const expected = [`owner.large.bucket.${bucket}`, `teacher.large.bucket.${bucket}`];
  return window.logs.complete && window.logs.queryFreshExecutions === 2 &&
    window.logs.handlers["attendance:bucket"]?.freshExecutions === 2 && callbackCount(window) === 2 &&
    expected.every(key => window.callbacks[key] === 1) && Object.keys(window.errors).length === 0;
}
function operation() {
  if (++report.domainOperations > 20) throw new Error("Domain operation budget exhausted.");
}
async function mutate(actor, name, args) {
  if (["excuse", "share", "unshare"].includes(name)) operation();
  return http("mutation", `attendance:${name}`, args, actor);
}
async function checkin() {
  operation(); reserveCall("http");
  const payload = { legacyId: legacy(1000), identity: "LS0001" };
  const proof = await signGatewayRequest("checkin", payload, { secret, audience, ipHash: hash(run),
    nonce: run + (++nonce).toString(16).padStart(16, "0") });
  try {
    const response = await fetch(`${site.origin}/gateway/checkin`, { method: "POST", redirect: "error",
      signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload, proof }) });
    const data = await boundedJson(response, 4096);
    if (!response.ok || data.name !== "Subscription Student 0001") throw new Error("Checkin failed.");
    return data;
  } finally { report.calls.settled++; }
}
async function signup(role) {
  const actor = { role, username: `sub-${run}-${role}`, password: randomBytes(24).toString("hex") };
  actors.push(actor);
  const payload = { username: actor.username, password: actor.password };
  const proof = await signGatewayRequest("signup", payload, { secret, audience, ipHash: hash(run),
    nonce: run + (++nonce).toString(16).padStart(16, "0") });
  // An explicit empty actor selects anonymous auth instead of admin impersonation.
  const result = await http("action", "auth:signIn", { provider: "credentials", params: { operation: "signup", ...payload, proof } }, {});
  actor.token = result.tokens?.token;
  const claims = JSON.parse(Buffer.from(actor.token.split(".")[1], "base64url"));
  actor.sessionId = result.tokens.refreshToken.split("|")[1];
  demand(`managedOneHourJwt-${role}`, claims.exp - claims.iat === 3600 && claims.sub.split("|")[1] === actor.sessionId && claims.exp * 1000 > Date.now() + 300000);
  const registration = await fixture("register", { role, sessionId: actor.sessionId });
  report.setup.administrativeWrites += registration.writes;
  report.setup.managedTeachers++;
  return actor;
}
function find(connection, label) { return connection.subscriptions.find(s => s.label === `${connection.label}.${label}`); }
function hasFact(connection, ordinal, field, size = "large") {
  return Boolean(find(connection, `${size}.bucket.${Math.floor((ordinal - 1) / 100)}`)?.value?.find(row => row.studentId === String(ordinal))?.[field]);
}
const snapshot = () => fixture("snapshot", {}, "query");
function zeroQueryWindow(key, result) {
  check(key, result.logs.complete && result.logs.queryFreshExecutions === 0 &&
    Object.values(result.logs.handlers).filter(r => r.udfType === "Query").every(r => r.completions === 0) && callbackCount(result) === 0);
}

try {
  if (process.argv.slice(2).some(arg => arg !== "--push-local") || process.argv.length > 3)
    throw new Error("Unknown options.");
  // Origins are required explicitly BEFORE reading any local configuration or
  // key file. A config read then validates ports before credential access.
  backend = origin(process.env.NEXT_PUBLIC_CONVEX_URL, 3210);
  site = origin(process.env.CONVEX_SITE_URL, 3211);
  phase = "validate-matching-ports";
  const config = JSON.parse(await readFile(new URL("../.convex/local/default/config.json", import.meta.url), "utf8"));
  if (config.ports?.cloud !== 3210 || config.ports?.site !== 3211) throw new Error("Mismatched local ports.");
  adminKey = config.adminKey;
  const env = {};
  for (const path of ["../.convex/local-auth.env", "../.env.local"]) {
    try { Object.assign(env, parseEnv(await readFile(new URL(path, import.meta.url), "utf8"))); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  secret = process.env.ATTENDANCE_GATEWAY_KEY ?? env.ATTENDANCE_GATEWAY_KEY;
  audience = process.env.ATTENDANCE_GATEWAY_AUDIENCE ?? env.ATTENDANCE_GATEWAY_AUDIENCE;
  if (!adminKey || typeof secret !== "string" || Buffer.byteLength(secret) < 32 || !audience) throw new Error("Missing local keys.");
  if (process.argv.includes("--push-local")) { phase = "publish-loopback"; await publish(); }
  phase = "managed-signup";
  const owner = await signup("owner"), teacher = await signup("teacher"), classes = {};
  phase = "public-create-share-repeat";
  for (const size of [30, 1000]) {
    const csv = "name,id\n" + Array.from({ length: size }, (_, i) =>
      `Subscription Student ${String(i + 1).padStart(4, "0")},LS${String(i + 1).padStart(4, "0")}`).join("\n");
    const created = await mutate(owner, "create", { newId: legacy(size), title: `Local subscriptions ${size}`, csv });
    classes[size] = created.classId;
    await mutate(owner, "share", { classId: created.classId, username: teacher.username });
  }
  await mutate(owner, "repeat", { legacyId: legacy(1000), newId: legacy(1001) });
  // Bootstrap discards prior workload logs. Only sequential known checkpoint
  // windows below can establish an observed zero.
  phase = "bootstrap-cursor";
  cursor = Date.now() - 1000;
  demand("initialCheckpointCursorEstablished", (await drain(await checkpoint())).complete);
  let ownerConnection, teacherConnection;
  await window("initial-30-and-1000-two-teachers", async result => {
    ownerConnection = connect(owner, "owner"); teacherConnection = connect(teacher, "teacher");
    attach(ownerConnection, classes); attach(teacherConnection, classes);
    await initial([ownerConnection, teacherConnection]);
    for (const connection of [ownerConnection, teacherConnection]) {
      demand(`${connection.label}ExactRosterSizes`, find(connection, "small.roster").value.length === 30 && find(connection, "large.roster").value.length === 1000);
      demand(`${connection.label}ExactSessionPolicy`, find(connection, "large.session").value.bucketCount === 10 &&
        find(connection, "large.session").value.bucketSize === 100 && find(connection, "small.session").value.count === 30);
      demand(`${connection.label}TenInitiallyEmptyBuckets`, connection.subscriptions.filter(s => /large.bucket\./.test(s.label)).every(s => s.value.length === 0));
    }
    result.initialSubscriptions = 40;
  });
  const idleBefore = await snapshot();
  const idle = await window("active-idle-three-seconds", async () => { await delay(3000); });
  zeroQueryWindow("activeIdleNoAttendanceQueries", idle);
  demand("activeIdleNoDomainChanges", (await snapshot()).domainDigest === idleBefore.domainDigest);
  check("activeIdleNoApplicationPolling", idle.transport.sentMessages === 0);

  const hot = await window("one-hot-bucket-checkin", async () => {
    const response = await checkin(); demand("firstCheckinFresh", response.already === undefined);
    await until(() => [ownerConnection, teacherConnection].every(c => hasFact(c, 1, "checkedInAt")));
  });
  check("hotBucketTwoExecutionsTwoCallbacksIsolation", isolated(hot, 0));

  const beforeDuplicate = await snapshot();
  const duplicate = await window("fresh-proof-duplicate-checkin", async () => { demand("duplicateAlready", (await checkin()).already === true); });
  zeroQueryWindow("duplicateNoQueryInvalidations", duplicate);
  demand("duplicateDomainDigestUnchanged", (await snapshot()).domainDigest === beforeDuplicate.domainDigest);
  const duplicateMutation = duplicate.logs.handlers["attendance:publicCheckin"];
  check("duplicateZeroDomainWriteDocuments", duplicate.logs.complete && duplicateMutation?.usageMetadataUnknown === 0 && duplicateMutation.databaseWriteDocuments === 0);

  const cross = await window("different-bucket-excuse", async () => {
    await mutate(owner, "excuse", { legacyId: legacy(1000), studentId: "101", excused: true });
    await until(() => [ownerConnection, teacherConnection].every(c => hasFact(c, 101, "excusedAt")));
  });
  check("differentBucketTwoExecutionsTwoCallbacksIsolation", isolated(cross, 1));
  const beforeNoop = await snapshot();
  const noop = await window("no-op-excuse", async () => { await mutate(owner, "excuse", { legacyId: legacy(1000), studentId: "101", excused: true }); });
  zeroQueryWindow("noopNoQueryInvalidations", noop);
  demand("noopDomainDigestUnchanged", (await snapshot()).domainDigest === beforeNoop.domainDigest);
  const noopMutation = noop.logs.handlers["attendance:excuse"];
  check("noopZeroDomainWriteDocuments", noop.logs.complete && noopMutation?.usageMetadataUnknown === 0 && noopMutation.databaseWriteDocuments === 0);

  const burst = await window("ten-excuses-concurrency-five", async result => {
    // Two bounded rounds. All five requests settle before the next round starts.
    for (let offset = 0; offset < 10; offset += 5) {
      const settled = await Promise.allSettled(Array.from({ length: 5 }, (_, i) =>
        mutate(owner, "excuse", { legacyId: legacy(1000), studentId: String(201 + offset + i), excused: true })));
      if (settled.some(value => value.status !== "fulfilled")) throw new Error("Burst failure after settlement.");
    }
    await until(() => [ownerConnection, teacherConnection].every(c => Array.from({ length: 10 }, (_, i) => hasFact(c, 201 + i, "excusedAt")).every(Boolean)));
    result.updates = 10; result.concurrency = 5;
  });
  burst.observedBucketFreshExecutions = burst.logs.complete ? burst.logs.handlers["attendance:bucket"]?.freshExecutions ?? 0 : "UNKNOWN";
  burst.affectedCallbacks = ["owner.large.bucket.2", "teacher.large.bucket.2"].reduce((sum, key) => sum + (burst.callbacks[key] ?? 0), 0);
  check("burstBothTeachersReceivedAllTenFacts", [ownerConnection, teacherConnection].every(c => Array.from({ length: 10 }, (_, i) => hasFact(c, 201 + i, "excusedAt")).every(Boolean)));

  await window("same-identity-second-client-cache", async result => {
    const second = connect(owner, "sameIdentity"); attach(second, classes, true); await initial([second]);
    demand("sameIdentityCurrentFacts", hasFact(second, 1, "checkedInAt") && hasFact(second, 101, "excusedAt"));
    result.requestedQueries = second.subscriptions.length;
    for (const subscription of second.subscriptions) { subscription.unsubscribe(); subscription.active = false; }
    await acknowledged(); await second.client.close();
  });

  await window("unsubscribe-all-acknowledged", async result => {
    for (const subscription of subscriptions.filter(s => s.active)) { subscription.unsubscribe(); subscription.active = false; }
    await acknowledged();
    result.allQuerySetsAcknowledged = sockets.every(s => s.readyState === NodeWebSocket.CLOSED || s.ackQuerySet >= s.sentQuerySet);
    demand("allPrivateSubscriptionsRemovedAndAcknowledged", result.allQuerySetsAcknowledged && subscriptions.every(s => !s.active));
  });
  const inactive = await window("inactive-owned-mutation-and-three-second-quiet", async () => {
    await mutate(owner, "excuse", { legacyId: legacy(1000), studentId: "301", excused: true });
    await delay(3000);
  });
  zeroQueryWindow("inactiveZeroAttendanceQueryExecutionsAndCallbacks", inactive);
  check("inactiveNoApplicationPolling", inactive.transport.sentMessages === 0);
  const inactiveBefore = await snapshot();
  const inactiveIdle = await window("inactive-idle-no-domain-writes", async () => { await delay(3000); });
  zeroQueryWindow("inactiveQuietNoAttendanceQueries", inactiveIdle);
  demand("inactiveQuietDomainDigestUnchanged", (await snapshot()).domainDigest === inactiveBefore.domainDigest);
  await Promise.all(clients.filter(c => !c.client.closed).map(c => c.client.close()));

  await window("reload-new-clients-current-facts", async result => {
    ownerConnection = connect(owner, "owner"); teacherConnection = connect(teacher, "teacher");
    attach(ownerConnection, classes); attach(teacherConnection, classes); await initial([ownerConnection, teacherConnection]);
    demand("reloadBothTeachersCurrentInactiveFact", [ownerConnection, teacherConnection].every(c => hasFact(c, 301, "excusedAt")));
    result.newClients = 2; result.requestedQueries = 40;
  });
  await window("close-selected-session", async () => {
    await mutate(owner, "close", { legacyId: legacy(1000) });
    await until(() => [ownerConnection, teacherConnection].every(c => find(c, "large.session").value.closed === true));
  });
  const closed = await window("closed-session-excuse", async () => {
    await mutate(teacher, "excuse", { legacyId: legacy(1000), studentId: "401", excused: true });
    await until(() => [ownerConnection, teacherConnection].every(c => hasFact(c, 401, "excusedAt")));
  });
  check("closedSessionExcuseStillIsolated", isolated(closed, 4));

  const revoked = await window("sharing-revocation", async () => {
    await mutate(owner, "unshare", { classId: classes[1000], username: teacher.username });
    await until(() => teacherConnection.subscriptions.filter(s => /\.(large|unrelated)\./.test(s.label)).every(s => s.denied));
  });
  const privateTeacher = teacherConnection.subscriptions.filter(s => /\.(large|unrelated)\./.test(s.label));
  demand("revokedTeacherAllSixteenPrivateQueriesDenied", privateTeacher.length === 16 && privateTeacher.every(s => s.denied));
  check("revocationOwnerAndOtherClassIsolated", Object.keys(revoked.callbacks).length === 0 &&
    Object.keys(revoked.errors).length === 16 && Object.keys(revoked.errors).every(key => key.startsWith("teacher.large.") || key.startsWith("teacher.unrelated.")) &&
    revoked.logs.complete && revoked.logs.queryFreshExecutions === 16);
  const oldCounts = privateTeacher.map(s => s.callbacks);
  const afterRevocation = await window("post-revocation-owner-excuse", async () => {
    await mutate(owner, "excuse", { legacyId: legacy(1000), studentId: "501", excused: true });
    await until(() => hasFact(ownerConnection, 501, "excusedAt"));
  });
  demand("noOldPrivateUpdatesAfterRevocation", privateTeacher.every((s, i) => s.callbacks === oldCounts[i] && s.denied));
  check("postRevocationOnlyOwnerAffectedBucketExecuted", afterRevocation.logs.complete && afterRevocation.logs.queryFreshExecutions === 1 &&
    afterRevocation.logs.handlers["attendance:bucket"]?.freshExecutions === 1 && callbackCount(afterRevocation) === 1 && afterRevocation.callbacks["owner.large.bucket.5"] === 1);
  check("everyWindowHasCompleteCheckpointLogs", report.windows.every(w => w.logs.complete));
} catch (error) {
  report.failedPhase = phase;
  // Classify without exposing arbitrary errors, backend bodies, or arguments.
  report.failureKind = error?.name === "TimeoutError" ? "timeout" : "guard-functional-or-transport";
  process.exitCode = 1;
} finally {
  currentWindow = undefined;
  for (const subscription of subscriptions.filter(s => s.active)) { subscription.unsubscribe(); subscription.active = false; }
  const closed = await Promise.allSettled(clients.filter(c => !c.client.closed).map(c => c.client.close()));
  check("allConnectionsClosedBeforeCleanup", closed.every(r => r.status === "fulfilled") && clients.every(c => c.client.closed));
  cleaning = true;
  if (adminKey && actors.length) {
    try {
      for (let i = 0; i < report.bounds.maxCleanupBatches; i++) {
        // Count setup, diagnostic registration, and deletion writes together.
        if (report.setup.estimatedDomainAndManagedWrites + report.setup.administrativeWrites + report.cleanup.writes + 100 > 5000)
          throw new Error("Fixture write bound exceeded.");
        const value = await fixture("cleanupBatch");
        report.cleanup.batches++; report.cleanup.writes += value.writes;
        report.cleanup.cancelledJobs += value.cancelled ?? 0;
        if (value.done) { report.cleanup.done = true; break; }
      }
    } catch { report.cleanup.failed = true; }
  }
  report.fixtureWriteUpperEstimateIncludingCleanup = report.setup.estimatedDomainAndManagedWrites + report.setup.administrativeWrites + report.cleanup.writes;
  report.finishedAt = new Date().toISOString();
  report.elapsedMs = Math.round(performance.now() - started);
  check("allCountedCallsSettled", report.calls.submitted === report.calls.settled);
  check("boundedCallsAndDomainOperations", report.calls.submitted <= 300 && report.domainOperations <= 20);
  report.passed = !report.failedPhase && report.cleanup.done && Object.values(report.assertions).every(Boolean);
  if (!report.passed) process.exitCode = 1;
  process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
  // Only this sanitized report is persisted. Credentials, callback values, and
  // unfiltered log objects never leave process memory.
  if (backend && site) {
    const artifact = new URL("../.convex/local-subscription-metrics.json", import.meta.url);
    await writeFile(artifact, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  }
  console.log(JSON.stringify(report, null, 2));
}
