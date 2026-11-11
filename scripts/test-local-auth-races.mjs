#!/usr/bin/env node
// Actual installed SDK, HMAC credentials and managed tokens; no client retries.
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { signGatewayRequest } from "../lib/gateway-proof.mjs";

const started = performance.now(), run = randomBytes(8).toString("hex");
const ipHash = createHash("sha256").update(run).digest("hex");
const fn = name => makeFunctionReference(name);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { version: 1, localOnly: true, bounds: { maxSdkCalls: 100, maxFixtureWrites: 1000,
  maxSeedBatch: 100, seededRecords: 501, requestTimeoutMs: 8000, replayWaitMs: 11000,
  cleanupObservationTimeoutMs: 10000, maxCleanupObservations: 12, totalTimeoutMs: 180000 },
  assertions: {}, calls: { submitted: 0, settled: 0, action: 0, query: 0, mutation: 0 },
  failures: { authentication: 0, visibility: 0, transport: 0, unexpected: 0 }, fixtureWrites: 0,
  cleanup: { done: false, writes: 0, cancelledJobs: 0, completedActors: 0, boundedLeftoverActors: 0 } };
let phase = "validate-origins", backend, site, adminKey, secret, audience, nonce = 0, cleaning = false;
const actors = [];
function assert(key, value) {
  report.assertions[key] = Boolean(value);
  if (!value) throw new Error("Assertion failed.");
}
function classify(error) {
  const message = String(error?.message ?? "");
  if (error?.name === "AbortError" || error?.name === "TimeoutError" || /fetch failed|ECONN|network|socket|timed? ?out|aborted/i.test(message)) return "transport";
  if ([401, 403].includes(error?.data?.status) || /unauthenticated|invalid authentication|expired (?:auth|token)|token (?:is |has )?expired|authentication failed/i.test(message)) return "authentication";
  if (/could not find public function|not a public function|internal function/i.test(message)) return "visibility";
  return "unexpected";
}
function origin(value, port) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port !== String(port) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("Explicit matching loopback origin required.");
  return url;
}
async function optional(path) {
  try { return await readFile(new URL(path, import.meta.url), "utf8"); }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}
function envOrigin(text, key) {
  const match = text.match(new RegExp(`^${key}=([^\\r\\n]*)`, "m"));
  return match?.[1]?.trim().replace(/^(['"])(.*)\1$/, "$2");
}
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
    child.once("error", reject);
    child.once("close", value => { clearTimeout(timer); resolve(value); });
  });
  if (code !== 0) throw new Error("Local fixture deployment failed.");
  report.localFixturePublished = true;
}
async function call(kind, name, args = {}, { admin = false, token } = {}) {
  const remaining = report.bounds.totalTimeoutMs - (performance.now() - started) - (cleaning ? 0 : 25000);
  if (report.calls.submitted >= (cleaning ? 100 : 80) || remaining <= 0) throw new Error("Call or time budget exhausted.");
  const client = new ConvexHttpClient(backend.origin, { logger: false });
  client.setDebug(false);
  if (admin) client.setAdminAuth(adminKey);
  else if (token) client.setAuth(token);
  client.setFetchOptions({ redirect: "error", signal: AbortSignal.timeout(Math.max(1, Math.min(8000, Math.floor(remaining)))) });
  report.calls.submitted++; report.calls[kind]++;
  try { return await client[kind](fn(name), args); }
  catch (error) { report.failures[classify(error)]++; throw error; }
  finally { report.calls.settled++; }
}
async function fixture(name, args, kind = "mutation") {
  // Reserve the maximum administrative write count before sending a mutation.
  // Even a failed cleanup gate cannot spend the remaining seed budget twice.
  const maximumWrites = kind === "query" ? 0 : name === "seedBatch" ? args.count : name === "register" ? 1 : 100;
  if (report.fixtureWrites + maximumWrites > 1000) throw new Error("Fixture write budget exhausted.");
  const value = await call(kind, `localAuthStress:${name}`, args, { admin: true });
  if (value.writes) report.fixtureWrites += value.writes;
  if (report.fixtureWrites > 1000) throw new Error("Fixture write budget exhausted.");
  return value;
}
const scope = actor => ({ run, role: actor.role });
const sessionScope = actor => ({ ...scope(actor), sessionId: actor.sessionId });
const state = actor => fixture("status", sessionScope(actor), "query");
function claims(tokens) {
  if (typeof tokens?.token !== "string" || typeof tokens?.refreshToken !== "string") throw new Error("Managed tokens required.");
  return JSON.parse(Buffer.from(tokens.token.split(".")[1], "base64url").toString("utf8"));
}
async function sign(actor, operation) {
  const payload = { username: actor.username, password: actor.password };
  const proof = await signGatewayRequest(operation, payload, { secret, audience, ipHash,
    nonce: run + (++nonce).toString(16).padStart(16, "0") });
  const response = await call("action", "auth:signIn", { provider: "credentials", params: { operation, ...payload, proof } });
  const tokens = response?.tokens, c = claims(tokens);
  const sessionId = tokens.refreshToken.split("|")[1];
  if (c.sub?.split("|")[1] !== sessionId) throw new Error("Managed token binding mismatch.");
  actor.sessionId = sessionId; actor.issued.push(tokens);
  await fixture("register", sessionScope(actor));
  return tokens;
}
async function signup(role) {
  const actor = { role, username: `authstress-${run}-${role}`, password: randomBytes(24).toString("hex"), issued: [] };
  actors.push(actor);
  await sign(actor, "signup");
  return actor;
}
const refresh = capability => call("action", "auth:signIn", { refreshToken: capability });
async function viewer(actor, tokens, allowed) {
  try {
    const value = await call("query", "attendance:viewer", {}, { token: tokens.token });
    return allowed && value?.username === actor.username && value.expiresAt === claims(tokens).sessionExpiresAt;
  } catch (error) {
    if (!allowed && classify(error) === "authentication") return true;
    throw error;
  }
}
async function rejectedRefresh(capability) {
  try { return (await refresh(capability))?.tokens === null; }
  catch (error) { if (classify(error) === "authentication") return true; throw error; }
}
function acceptedRefresh(result, actor, deadline) {
  if (result.status !== "fulfilled") throw result.reason;
  const tokens = result.value?.tokens, c = claims(tokens);
  if (c.sessionExpiresAt !== deadline || tokens.refreshToken.split("|")[1] !== actor.sessionId)
    throw new Error("Refresh changed fixed session deadline.");
  actor.issued.push(tokens);
  return tokens;
}

try {
  if (process.argv.slice(2).some(value => value !== "--push-local") || process.argv.length > 3) throw new Error("Unknown option.");
  // Only origin lines are extracted initially; credential parsing/access follows
  // both exact origin validation and matching local configuration ports.
  const localText = await optional("../.env.local");
  backend = origin(process.env.NEXT_PUBLIC_CONVEX_URL ?? envOrigin(localText, "NEXT_PUBLIC_CONVEX_URL"), 3210);
  site = origin(process.env.CONVEX_SITE_URL ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? envOrigin(localText, "NEXT_PUBLIC_CONVEX_SITE_URL"), 3211);
  phase = "validate-local-ports";
  const config = JSON.parse(await readFile(new URL("../.convex/local/default/config.json", import.meta.url), "utf8"));
  if (config.ports?.cloud !== Number(backend.port) || config.ports?.site !== Number(site.port)) throw new Error("Local ports mismatch.");
  adminKey = config.adminKey;
  const env = { ...parseEnv(await optional("../.convex/local-auth.env")), ...parseEnv(localText) };
  secret = process.env.ATTENDANCE_GATEWAY_KEY ?? env.ATTENDANCE_GATEWAY_KEY;
  audience = process.env.ATTENDANCE_GATEWAY_AUDIENCE ?? env.ATTENDANCE_GATEWAY_AUDIENCE;
  if (!adminKey || typeof secret !== "string" || Buffer.byteLength(secret) < 32 || !audience) throw new Error("Local credentials unavailable.");
  if (process.argv.includes("--push-local")) { phase = "publish-local-fixture"; await publish(); }

  phase = "managed-signup-and-signin";
  const rotation = await signup("rotation"), control = await signup("control"), race = await signup("race"), cleanup = await signup("cleanup");
  await sign(control, "login");
  assert("managedSignupAndLogin", actors.every(actor => actor.issued.length > 0) && control.issued.length === 2);
  const initial = rotation.issued[0], initialClaims = claims(initial), deadline = initialClaims.sessionExpiresAt;
  assert("default30DaySessionAndOneHourJwt", Math.abs(deadline - initialClaims.iat * 1000 - 30 * 86400000) < 5000 && initialClaims.exp - initialClaims.iat === 3600);

  phase = "invalid-capability-isolation";
  const beforeRotation = await state(rotation), beforeControl = await state(control);
  assert("invalidCapabilityRejected", await rejectedRefresh("a|b"));
  assert("mixedCapabilityRejected", await rejectedRefresh(`${initial.refreshToken.split("|")[0]}|${control.sessionId}`));
  const afterRotation = await state(rotation), afterControl = await state(control);
  assert("invalidCapabilitiesDoNotRevokeOrSchedule", beforeRotation.scheduledScanComplete && beforeControl.scheduledScanComplete &&
    afterRotation.scheduledScanComplete && afterControl.scheduledScanComplete && afterRotation.exists && afterControl.exists &&
    beforeRotation.cleanupJobs === afterRotation.cleanupJobs && beforeControl.cleanupJobs === afterControl.cleanupJobs &&
    beforeRotation.tokenCount === afterRotation.tokenCount && beforeControl.tokenCount === afterControl.tokenCount);
  // Correct internal mutation name/argument shape, called WITHOUT admin or JWT.
  try {
    await call("mutation", "auth:store", { args: { type: "refreshSession", refreshToken: initial.refreshToken } });
    assert("anonymousInternalStoreRejected", false);
  } catch (error) { assert("anonymousInternalStoreRejected", classify(error) === "visibility" || classify(error) === "authentication"); }

  phase = "same-capability-concurrent-first-refresh";
  const firstRace = await Promise.allSettled([refresh(initial.refreshToken), refresh(initial.refreshToken)]);
  const firstRefreshAt = performance.now();
  report.sameCapabilitySettled = firstRace.length;
  const children = firstRace.map(result => acceptedRefresh(result, rotation, deadline));
  assert("sameCapabilityManagedRotationAndParentRetry", children.every(t => t.refreshToken !== initial.refreshToken) && children[0].refreshToken === children[1].refreshToken);
  assert("allConcurrentRefreshJwtsWork", (await Promise.all(children.map(t => viewer(rotation, t, true)))).every(Boolean));
  assert("fixedDeadlinePreservedAfterConcurrentRefresh", (await state(rotation)).expiresAt === deadline);

  phase = "grandchild-and-delayed-ancestor-replay";
  const grandchildResult = await Promise.allSettled([refresh(children[0].refreshToken)]);
  const grandchild = acceptedRefresh(grandchildResult[0], rotation, deadline);
  assert("grandchildWorksAndPreservesDeadline", grandchild.refreshToken !== children[0].refreshToken && await viewer(rotation, grandchild, true));
  await delay(Math.max(0, 11000 - (performance.now() - firstRefreshAt)));
  report.ancestorReplayDelayMs = Math.round(performance.now() - firstRefreshAt);
  assert("ancestorReplayRejected", await rejectedRefresh(initial.refreshToken));
  assert("ancestorReplayRevokesEstablishedSession", !(await state(rotation)).exists);
  assert("allIssuedRotationJwtsDenied", (await Promise.all(rotation.issued.map(t => viewer(rotation, t, false)))).every(Boolean));
  assert("otherManagedSessionsUnaffected", (await state(control)).exists && (await Promise.all(control.issued.map(t => viewer(control, t, true)))).every(Boolean));

  phase = "refresh-authenticated-logout-race";
  const raceInitial = race.issued[0];
  const logoutRace = await Promise.allSettled([refresh(raceInitial.refreshToken), call("action", "auth:signOut", {}, { token: raceInitial.token })]);
  report.refreshLogoutSettled = logoutRace.length;
  assert("authenticatedLogoutSettledSuccessfully", logoutRace[1].status === "fulfilled");
  if (logoutRace[0].status === "fulfilled" && logoutRace[0].value?.tokens) {
    const tokens = logoutRace[0].value.tokens;
    claims(tokens); race.issued.push(tokens);
    report.refreshLogoutOutcome = "refresh-issued-before-revocation";
  } else {
    assert("raceRefreshFailureIsAuthOrNull", logoutRace[0].status === "fulfilled" ? logoutRace[0].value?.tokens === null : classify(logoutRace[0].reason) === "authentication");
    report.refreshLogoutOutcome = "refresh-denied";
  }
  assert("logoutRaceSessionGone", !(await state(race)).exists);
  assert("allLogoutRaceJwtsDenied", (await Promise.all(race.issued.map(t => viewer(race, t, false)))).every(Boolean));
  assert("returnedRefreshCannotRestoreRevokedAccess", await rejectedRefresh(race.issued.at(-1).refreshToken));

  phase = "seed-501-after-managed-signup";
  for (let offset = 0; offset < 501; offset += 100)
    await fixture("seedBatch", { ...sessionScope(cleanup), offset, count: Math.min(100, 501 - offset) });
  const seeded = await state(cleanup);
  report.cleanup.seededRefreshRecords = seeded.tokenCount;
  assert("managedSessionPlus501FixtureRecords", seeded.exists && seeded.tokenCount === 502);
  assert("issuedJwtUsableWithOversizedRefreshHistory", await viewer(cleanup, cleanup.issued[0], true));
  phase = "real-logout-and-scheduled-cleanup";
  const logoutStart = performance.now();
  await call("action", "auth:signOut", {}, { token: cleanup.issued[0].token });
  let observed = await state(cleanup), observations = 1;
  assert("largeHistoryLogoutRemovesAuthority", !observed.exists);
  assert("largeHistoryLogoutJwtDenied", await viewer(cleanup, cleanup.issued[0], false));
  while (observed.tokenCount !== 0 && observations < 12 && performance.now() - logoutStart < 10000) {
    await delay(750);
    observed = await state(cleanup); observations++;
  }
  report.cleanup.observations = observations;
  report.cleanup.scheduledCompletionMs = Math.round(performance.now() - logoutStart);
  report.cleanup.remainingRefreshRecords = observed.tokenCount;
  assert("scheduledCleanupReachedZeroWithinTimeout", !observed.exists && observed.tokenCount === 0 && performance.now() - logoutStart < 10000);
  assert("controlStillWorksAfterAllRevocations", await viewer(control, control.issued.at(-1), true));
} catch (error) {
  report.failedPhase = phase;
  report.failureClass = classify(error);
  process.exitCode = 1;
} finally {
  cleaning = true;
  if (adminKey) for (const actor of actors) {
    let done = false;
    try {
      for (let batch = 0; batch < 10 && !done; batch++) {
        const result = await fixture("cleanupBatch", scope(actor));
        report.cleanup.writes += result.writes;
        report.cleanup.cancelledJobs += result.cancelled;
        done = result.done;
      }
    } catch { /* No raw SDK error or synthetic payload leaves this process. */ }
    report.cleanup.completedActors += Number(done);
    report.cleanup.boundedLeftoverActors += Number(!done);
  }
  report.cleanup.done = actors.length > 0 && report.cleanup.completedActors === actors.length;
  report.assertions.allSdkCallsSettled = report.calls.submitted === report.calls.settled;
  report.assertions.withinCallAndFixtureBudgets = report.calls.submitted <= 100 && report.fixtureWrites <= 1000;
  report.assertions.noTransportFailures = report.failures.transport === 0;
  report.elapsedMs = Math.round(performance.now() - started);
  report.passed = !process.exitCode && report.cleanup.done && Object.values(report.assertions).every(Boolean);
  if (!report.passed) process.exitCode = 1;
  console.log(JSON.stringify(report, null, 2));
}
