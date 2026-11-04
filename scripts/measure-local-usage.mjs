#!/usr/bin/env node
// Local-only sampling of the application's actual registered handlers.
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

function loopback(value) {
  const url = new URL(value);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !["http:", "https:"].includes(url.protocol) ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Explicit loopback origin required.");
  return url;
}
function options(argv) {
  const result = {
    sessions30: 200,
    sessions1000: 4,
    studentOperations: 10000,
    historyCount: 40,
  };
  const names = {
    "monthly-sessions-30": "sessions30",
    "monthly-sessions-1000": "sessions1000",
    "monthly-student-operations": "studentOperations",
    "history-count": "historyCount",
  };
  const seen = new Set();
  for (const arg of argv) {
    const match = /^--([a-z0-9-]+)=(\d+)$/.exec(arg);
    if (!match || !names[match[1]] || seen.has(match[1]))
      throw new Error("Invalid workload option.");
    const value = Number(match[2]);
    if (!Number.isSafeInteger(value) || value > 1000000)
      throw new Error("Invalid workload count.");
    result[names[match[1]]] = value;
    seen.add(match[1]);
  }
  if (result.historyCount < 1 || result.historyCount > 50)
    throw new Error("Invalid fixture history.");
  return result;
}
let client,
  ids,
  admission,
  phase = "input-validation";
const fn = (name) => makeFunctionReference(name);
async function cleanup() {
  if (!client || !ids) return;
  if (admission)
    await client.mutation(fn("localMetrics:cleanupAdmission"), admission);
  for (let i = 0; i < 100; i++) {
    if ((await client.mutation(fn("localMetrics:cleanupBatch"), { ids })).done)
      return;
  }
  throw new Error("Cleanup budget exhausted.");
}
try {
  // Validate both targets before accessing a local administrative capability.
  const site = loopback(process.env.CONVEX_SITE_URL),
    url = loopback(process.env.NEXT_PUBLIC_CONVEX_URL);
  const workload = options(process.argv.slice(2));
  phase = "local-config";
  const config = JSON.parse(
    await readFile(
      new URL("../.convex/local/default/config.json", import.meta.url),
      "utf8",
    ),
  );
  if (
    !config?.adminKey ||
    Number(url.port) !== config.ports?.cloud ||
    Number(site.port) !== config.ports?.site
  )
    throw new Error("Local configuration does not match target.");
  client = new ConvexHttpClient(url.origin, { logger: false });
  client.setAdminAuth(config.adminKey);
  client.setDebug(false);
  const runId = randomBytes(16).toString("hex");
  phase = "fixture-prepare";
  const prepared = await client.mutation(fn("localMetrics:prepare"), {
    runId,
    sizes: [30, 1000],
    historyCount: workload.historyCount,
  });
  ids = { classes: prepared.classes, sessions: prepared.sessions };
  client.setAdminAuth(config.adminKey, {
    subject: prepared.subject,
    issuer: site.origin,
  });
  const samples = [];
  const record = (operation, response) =>
    samples.push({
      operation,
      sampleExecutions: 1,
      database: response.db,
      ...(response.maintenanceDeletes === undefined
        ? {}
        : { maintenanceDeletes: response.maintenanceDeletes }),
      applicationJsonBytes: Buffer.byteLength(
        JSON.stringify(response.result ?? null),
      ),
    });
  for (const [size, legacyId, classId] of [
    [30, ids.sessions[0], prepared.nativeClasses[0]],
    [1000, ids.sessions.at(-1), prepared.nativeClasses[1]],
  ]) {
    for (const mode of [
      "viewer",
      "classes",
      "session",
      "roster",
      "history",
      "exportSnapshot",
    ]) {
      phase = `read-${mode}-${size}`;
      record(
        `${mode}-${size}`,
        await client.query(fn("localMetrics:readSample"), {
          legacyId,
          classId,
          mode,
        }),
      );
    }
    for (let bucket = 0; bucket < Math.ceil(size / 100); bucket++) {
      phase = `bucket-${size}-${bucket}`;
      record(
        `bucket-${size}-${bucket}`,
        await client.query(fn("localMetrics:readSample"), {
          legacyId,
          classId,
          mode: "bucket",
          bucket,
        }),
      );
    }
    for (const kind of [
      "checkinNew",
      "checkinDuplicate",
      "excuseNew",
      "excuseDuplicate",
    ]) {
      phase = `write-${kind}-${size}`;
      const ordinal = kind.startsWith("checkin") ? size - 1 : size - 2;
      record(
        `${kind}-${size}`,
        await client.mutation(fn("localMetrics:writeSample"), {
          legacyId,
          kind,
          studentId: `${runId.slice(0, 20)}-${size}-${String(ordinal).padStart(4, "0")}`,
          identity: `LM${size}${String(ordinal).padStart(4, "0")}`,
        }),
      );
    }
  }
  const coldNonce = randomBytes(16).toString("hex"),
    nonce = randomBytes(16).toString("hex");
  admission = { runId, legacyId: ids.sessions[0], nonces: [coldNonce, nonce] };
  phase = "admission";
  for (const operation of [
    "admissionCold",
    "admissionNew",
    "admissionReplay",
  ]) {
    const result = await client.mutation(fn("localMetrics:admissionSample"), {
      runId,
      legacyId: ids.sessions[0],
      nonce: operation === "admissionCold" ? coldNonce : nonce,
    });
    if (result.result !== (operation !== "admissionReplay"))
      throw new Error("Admission assertion failed.");
    record(operation, result);
  }
  for (const sample of samples.filter((s) =>
    /Duplicate|admissionReplay/.test(s.operation),
  )) {
    if (sample.database && sample.database.documentsWritten !== 0)
      throw new Error("No-op unexpectedly wrote.");
  }
  const allMetrics = samples.every((sample) => sample.database !== null);
  const byName = Object.fromEntries(
    samples.map((sample) => [sample.operation, sample]),
  );
  const metrics = [
    "bytesRead",
    "bytesWritten",
    "documentsRead",
    "documentsWritten",
  ];
  const add = (target, sample, multiplier) => {
    for (const key of metrics) target[key] += sample.database[key] * multiplier;
    target.applicationJsonBytes += sample.applicationJsonBytes * multiplier;
    target.handlerExecutions += multiplier;
  };
  const arithmetic = allMetrics
    ? Object.fromEntries(
        [...metrics, "applicationJsonBytes", "handlerExecutions"].map((key) => [
          key,
          0,
        ]),
      )
    : null;
  if (arithmetic) {
    // Explicit scenario arithmetic: two teachers, initial open + two resumes.
    // Two viewer executions model the fresh HTTP check and mounted subscription.
    for (const [size, sessions] of [
      [30, workload.sessions30],
      [1000, workload.sessions1000],
    ]) {
      for (const mode of [
        "viewer",
        "viewer",
        "classes",
        "history",
        "session",
        "roster",
      ])
        add(arithmetic, byName[`${mode}-${size}`], sessions * 6);
      for (let bucket = 0; bucket < Math.ceil(size / 100); bucket++)
        add(arithmetic, byName[`bucket-${size}-${bucket}`], sessions * 6);
    }
    add(arithmetic, byName["checkinNew-30"], workload.studentOperations);
    add(arithmetic, byName.admissionNew, workload.studentOperations);
    // Worst-case uncoalesced update assumption, using the measured dense bucket.
    add(arithmetic, byName["bucket-1000-0"], workload.studentOperations * 2);
  }
  phase = "cleanup";
  await cleanup();
  ids = null;
  console.log(
    JSON.stringify(
      {
        version: 2,
        localOnly: true,
        method:
          "Actual application registered handlers; administrative synthetic identity",
        transactionMetricsAvailable: allMetrics,
        samples,
        illustrativeScenario: {
          ...workload,
          teachers: 2,
          resumesPerTeacherPerSession: 2,
          arithmeticAssumingEveryQueryExecutes: arithmetic,
          assumptions: [
            "No server cache reuse or burst coalescing assumed.",
            "Each open/resume fetches all selected-session buckets and roster again.",
            "Student database check-in cost uses the 30-student sample; updates use the populated 100-student bucket sample.",
            "Owner authorization sampled; a shared teacher may need additional membership reads.",
            "One warm successful security admission per check-in; initial expired-record cleanup and later TTL maintenance are reported separately and are not fully projected.",
          ],
        },
        unmeasured: [
          "JWT verification/signing, password work and auth rotation",
          "HMAC/HTTP-action invocation, Next ingress and hosting",
          "Actual WebSocket framing/compression, cache reuse and coalescing",
          "Other team deployments, retained storage/index growth and cleanup",
          "Production row sizes and actual traffic; this is synthetic workload arithmetic",
        ],
        monthlyDollars: "NOT_COMPUTED",
        freeQuotaGuarantee: false,
      },
      null,
      2,
    ),
  );
} catch {
  try {
    await cleanup();
  } catch {}
  console.error(
    `Local resource measurement failed (${phase}); sensitive details withheld.`,
  );
  process.exitCode = 1;
}
