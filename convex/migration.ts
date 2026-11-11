/**
 * Offline deployment-administrator API only. No public functions/HTTP routes.
 * Trust boundary: the administrator runs the reviewed raw-snapshot transformer
 * and commits its fingerprint + plan manifest at begin. The server commits each
 * submitted operation into that manifest and hashes every actual target field.
 * Freeze closes every importer write path; runtime/auth stay closed until activate.
 * Verification scans ALL application/auth tables, not just submitted IDs/counts.
 * Deployment admins must not bypass the freeze with dashboard/direct DB writes.
 * A privileged bypass during/after a paginated scan defeats any application lock.
 */
import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { normalize } from "../lib/roster.mjs";
import { rosterDigest } from "./rosters";
import {
  migrationTables,
  initialChain,
  stable,
  bytes,
  documentDigest,
  operationDigest,
  advanceChain,
} from "../lib/convex-migration-plan.mjs";

const deny = (code: string): never => {
  throw new ConvexError(`migration_${code}`);
};
function check(condition: unknown, code = "invalid_input"): asserts condition {
  if (!condition) deny(code);
}
const fields = (value: any, required: string[], optional: string[] = []) => {
  check(value && typeof value === "object" && !Array.isArray(value));
  check(
    required.every((k) => Object.hasOwn(value, k)) &&
      Object.keys(value).every(
        (k) => required.includes(k) || optional.includes(k),
      ),
  );
};
const text = (value: unknown, max = 512) =>
  check(
    typeof value === "string" &&
      value.length > 0 &&
      new TextEncoder().encode(value).length <= max &&
      !/[\/\\\u0000-\u001f\u007f]/.test(value) &&
      value !== "." &&
      value !== "..",
  );
const legacy = (value: unknown) =>
  check(typeof value === "string" && /^[a-f0-9]{32}$/.test(value));
const digest = (value: unknown) =>
  check(typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
const date = (value: unknown) =>
  check(
    typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
  );
const title = (value: unknown) =>
  check(
    typeof value === "string" && value.trim().length && value.length <= 100,
  );
const integer = (value: unknown) =>
  check(Number.isSafeInteger(value) && Number(value) >= 0);
const bare = (doc: any) =>
  Object.fromEntries(
    Object.entries(doc).filter(([k]) => k !== "_id" && k !== "_creationTime"),
  );
const dbAny = (ctx: QueryCtx) => ctx.db as any;

async function closed(ctx: QueryCtx) {
  const states = await ctx.db.query("deploymentState").take(2);
  check(
    states.length === 1 &&
      states[0].key === "migration" &&
      !states[0].activeRunId &&
      !states[0].readsEnabled &&
      !states[0].writesEnabled,
    "deployment_not_closed",
  );
  return states[0];
}
async function runFor(ctx: QueryCtx, runId: Id<"migrationRuns">) {
  await closed(ctx);
  const runs = await ctx.db.query("migrationRuns").take(2);
  check(
    runs.length === 1 &&
      runs[0]._id === runId &&
      runs[0].protocol?.version === 1 &&
      runs[0].status !== "active",
    "invalid_run",
  );
  return runs[0] as Doc<"migrationRuns"> & {
    protocol: NonNullable<Doc<"migrationRuns">["protocol"]>;
  };
}
async function find(
  ctx: QueryCtx,
  table: string,
  index: string,
  pairs: [string, any][],
) {
  const rows = await dbAny(ctx)
    .query(table)
    .withIndex(index, (q: any) =>
      pairs.reduce((builder, [k, value]) => builder.eq(k, value), q),
    )
    .take(2);
  check(rows.length <= 1, "duplicate_target");
  return rows[0] ?? null;
}
async function required(
  ctx: QueryCtx,
  table: string,
  index: string,
  pairs: [string, any][],
) {
  const row = await find(ctx, table, index, pairs);
  check(row, "missing_relationship");
  return row;
}

const countsValidator = v.object({
  accounts: v.number(),
  legacyClaims: v.number(),
  classes: v.number(),
  rosterVersions: v.number(),
  rosterMembers: v.number(),
  memberships: v.number(),
  sessions: v.number(),
  closures: v.number(),
  attendance: v.number(),
});
// Explicit one-time bootstrap. A missing control row can only be created when
// EVERY data/receipt/run table is empty; begin/resume never infer closed state.
export const initialize = internalMutation({
  args: {},
  handler: async (ctx) => {
    if ((await ctx.db.query("deploymentState").take(1)).length) {
      await closed(ctx);
      return null;
    }
    for (const table of [
      ...migrationTables,
      "migrationRuns",
      "migrationDocuments",
      "migrationChunks",
    ]) {
      check(
        (await dbAny(ctx).query(table).take(1)).length === 0,
        "target_not_empty",
      );
    }
    await ctx.db.insert("deploymentState", {
      key: "migration",
      readsEnabled: false,
      writesEnabled: false,
    });
    return null;
  },
});

export const begin = internalMutation({
  args: {
    fingerprint: v.string(),
    exportedAt: v.string(),
    manifestDigest: v.string(),
    chunkCount: v.number(),
    tableCounts: v.array(v.number()),
    expectedCounts: countsValidator,
  },
  handler: async (ctx, args) => {
    await closed(ctx);
    digest(args.fingerprint);
    digest(args.manifestDigest);
    date(args.exportedAt);
    integer(args.chunkCount);
    check(
      args.tableCounts.length === migrationTables.length &&
        args.chunkCount <= 1_000_000,
    );
    args.tableCounts.forEach(integer);
    Object.values(args.expectedCounts).forEach(integer);
    const n = (table: string) =>
      args.tableCounts[migrationTables.indexOf(table)];
    const c = args.expectedCounts;
    check(
      n("users") === c.accounts &&
        n("credentials") === c.accounts &&
        n("ownerLinks") === c.accounts + c.legacyClaims &&
        n("classes") === c.classes &&
        n("classState") === c.classes &&
        n("rosterVersions") === c.rosterVersions &&
        n("rosterMembers") === c.rosterMembers &&
        n("memberships") === c.memberships &&
        n("sessions") === c.sessions &&
        n("closures") === c.closures &&
        n("attendance") === c.attendance &&
        args.tableCounts.slice(11).every((n) => n === 0),
      "invalid_manifest",
    );
    const runs = await ctx.db.query("migrationRuns").take(2);
    if (runs.length) {
      check(runs.length === 1, "invalid_run");
      const run = await runFor(ctx, runs[0]._id);
      check(
        run.fingerprint === args.fingerprint &&
          run.protocol.manifestDigest === args.manifestDigest &&
          run.protocol.chunkCount === args.chunkCount &&
          stable(run.protocol.tableCounts) === stable(args.tableCounts) &&
          stable(run.expectedCounts) === stable(args.expectedCounts),
        "dataset_mismatch",
      );
      return {
        runId: run._id,
        phase: run.protocol.phase,
        nextChunk: run.protocol.nextChunk,
      };
    }
    for (const table of [
      ...migrationTables,
      "migrationDocuments",
      "migrationChunks",
    ]) {
      check(
        (await dbAny(ctx).query(table).take(1)).length === 0,
        "target_not_empty",
      );
    }
    const runId = await ctx.db.insert("migrationRuns", {
      fingerprint: args.fingerprint,
      status: "staging",
      exportedAt: args.exportedAt,
      expectedCounts: args.expectedCounts,
      protocol: {
        version: 1,
        manifestDigest: args.manifestDigest,
        chunkCount: args.chunkCount,
        nextChunk: 0,
        chain: initialChain,
        tableCounts: args.tableCounts,
        importedCounts: migrationTables.map(() => 0),
        phase: "import",
        verifyTable: 0,
        verifyCursor: null,
        verifiedInTable: 0,
      },
    });
    return { runId, phase: "import", nextChunk: 0 };
  },
});

// Store only deterministic exact matches. Neither retry nor upsert repairs drift.
async function put(
  ctx: MutationCtx,
  runId: Id<"migrationRuns">,
  counts: number[],
  table: string,
  index: string,
  key: [string, any][],
  value: any,
) {
  let prior = await find(ctx, table, index, key);
  if (prior) {
    check(stable(bare(prior)) === stable(value), "target_drift");
    const receipt = await required(ctx, "migrationDocuments", "by_document", [
      ["table", table],
      ["documentId", prior._id],
    ]);
    check(
      receipt.runId === runId && receipt.digest === documentDigest(value),
      "receipt_drift",
    );
  } else {
    const id = await (ctx.db as any).insert(table, value);
    await ctx.db.insert("migrationDocuments", {
      runId,
      table,
      documentId: id,
      digest: documentDigest(value),
    });
    counts[migrationTables.indexOf(table)]++;
    prior = { ...value, _id: id };
  }
  return prior;
}
async function importOperation(
  ctx: MutationCtx,
  runId: Id<"migrationRuns">,
  counts: number[],
  operation: any,
) {
  fields(operation, ["kind", "data"]);
  const d = operation.data;
  const save = (
    table: string,
    index: string,
    keys: [string, any][],
    value: any,
  ) => put(ctx, runId, counts, table, index, keys, value);
  const klass = (id: string) =>
    required(ctx, "classes", "by_legacy", [["legacyId", id]]);
  const link = (owner: string) =>
    required(ctx, "ownerLinks", "by_owner", [["ownerKey", owner]]);
  const version = (key: string) =>
    required(ctx, "rosterVersions", "by_source", [["sourceKey", key]]);
  const session = (id: string) =>
    required(ctx, "sessions", "by_legacy", [["legacyId", id]]);
  switch (operation.kind) {
    case "account": {
      fields(d, ["owner", "username", "salt", "passwordHash"]);
      text(d.owner);
      check(
        /^[a-z0-9._-]{3,40}$/.test(d.username) &&
          /^[a-f0-9]{32}$/.test(d.salt) &&
          /^[a-f0-9]{128}$/.test(d.passwordHash),
      );
      const user = await save(
        "users",
        "by_username",
        [["username", d.username]],
        { username: d.username, ownerKey: d.owner },
      );
      await save("credentials", "by_username", [["username", d.username]], {
        username: d.username,
        userId: user._id,
        salt: d.salt,
        passwordHash: d.passwordHash,
      });
      await save("ownerLinks", "by_owner", [["ownerKey", d.owner]], {
        ownerKey: d.owner,
        userId: user._id,
        directoryComplete: true,
      });
      break;
    }
    case "claim":
    case "provenance": {
      fields(d, ["owner", "legacyOwner"]);
      text(d.owner);
      digest(d.legacyOwner);
      const owner = await link(d.owner);
      const user = await ctx.db.get(owner.userId as Id<"users">);
      check(user !== null && user.ownerKey === d.owner, "invalid_claim");
      if (operation.kind === "claim")
        await save("ownerLinks", "by_owner", [["ownerKey", d.legacyOwner]], {
          ownerKey: d.legacyOwner,
          userId: user._id,
          directoryComplete: true,
        });
      else
        check((await link(d.legacyOwner)).userId === user._id, "invalid_claim");
      break;
    }
    case "class": {
      fields(d, ["legacyId", "owner", "title", "createdAt"]);
      legacy(d.legacyId);
      text(d.owner);
      title(d.title);
      date(d.createdAt);
      await save("classes", "by_legacy", [["legacyId", d.legacyId]], {
        legacyId: d.legacyId,
        ownerKey: d.owner,
        title: d.title,
        createdAt: d.createdAt,
      });
      break;
    }
    case "version": {
      fields(d, ["key", "classLegacyId", "students"]);
      legacy(d.classLegacyId);
      check(
        Array.isArray(d.students) &&
          d.students.length >= 1 &&
          d.students.length <= 1000,
      );
      const ids = new Set();
      for (const s of d.students) {
        fields(s, ["id", "name", "code"]);
        text(s.id);
        check(!ids.has(s.id));
        ids.add(s.id);
        check(
          typeof s.name === "string" &&
            s.name.trim().length &&
            s.name.length <= 160 &&
            typeof s.code === "string" &&
            s.code.length <= 160,
        );
      }
      const hash = rosterDigest(d.students);
      check(d.key === `${d.classLegacyId}:${hash}`);
      const c = await klass(d.classLegacyId);
      const row = await save(
        "rosterVersions",
        "by_source",
        [["sourceKey", d.key]],
        {
          classId: c._id,
          sourceKey: d.key,
          digest: hash,
          count: d.students.length,
        },
      );
      // Entire version + all members + their receipts share this transaction.
      for (const [ordinal, s] of d.students.entries())
        await save(
          "rosterMembers",
          "by_version_student",
          [
            ["versionId", row._id],
            ["studentId", s.id],
          ],
          {
            versionId: row._id,
            studentId: s.id,
            name: s.name,
            code: s.code,
            ordinal,
            normalizedName: normalize(s.name),
            normalizedCode: normalize(s.code),
          },
        );
      break;
    }
    case "state": {
      fields(d, ["classLegacyId", "rosterVersionKey", "revision"]);
      integer(d.revision);
      const c = await klass(d.classLegacyId),
        r = await version(d.rosterVersionKey);
      check(r.classId === c._id, "invalid_relationship");
      await save("classState", "by_class", [["classId", c._id]], {
        classId: c._id,
        rosterVersionId: r._id,
        revision: d.revision,
      });
      break;
    }
    case "membership": {
      fields(d, ["classLegacyId", "owner", "role"]);
      check(["owner", "teacher"].includes(d.role));
      const c = await klass(d.classLegacyId),
        owner = await link(d.owner);
      const actualOwner = await find(ctx, "ownerLinks", "by_owner", [
        ["ownerKey", c.ownerKey],
      ]);
      check(
        d.role === "owner"
          ? actualOwner?.userId === owner.userId
          : actualOwner?.userId !== owner.userId,
        "invalid_membership",
      );
      await save(
        "memberships",
        "by_class_user",
        [
          ["classId", c._id],
          ["userId", owner.userId],
        ],
        { classId: c._id, userId: owner.userId, role: d.role },
      );
      break;
    }
    case "session": {
      fields(d, [
        "legacyId",
        "classLegacyId",
        "owner",
        "title",
        "createdAt",
        "rosterVersionKey",
      ]);
      legacy(d.legacyId);
      title(d.title);
      date(d.createdAt);
      const c = await klass(d.classLegacyId),
        r = await version(d.rosterVersionKey);
      check(
        c.ownerKey === d.owner && r.classId === c._id,
        "invalid_relationship",
      );
      await save("sessions", "by_legacy", [["legacyId", d.legacyId]], {
        legacyId: d.legacyId,
        classId: c._id,
        rosterVersionId: r._id,
        title: d.title,
        createdAt: d.createdAt,
        count: r.count,
        bucketSize: 100,
      });
      break;
    }
    case "closure": {
      fields(d, ["sessionLegacyId", "closedAt"]);
      date(d.closedAt);
      const s = await session(d.sessionLegacyId);
      await save("closures", "by_session", [["sessionId", s._id]], {
        sessionId: s._id,
        closedAt: d.closedAt,
      });
      break;
    }
    case "attendance": {
      fields(
        d,
        ["sessionLegacyId", "studentId"],
        ["checkedInAt", "excusedAt", "excusedBy"],
      );
      check(Object.hasOwn(d, "checkedInAt") || Object.hasOwn(d, "excusedAt"));
      if (Object.hasOwn(d, "checkedInAt")) date(d.checkedInAt);
      if (Object.hasOwn(d, "excusedAt")) date(d.excusedAt);
      if (Object.hasOwn(d, "excusedBy")) {
        text(d.excusedBy);
        check(Object.hasOwn(d, "excusedAt"));
      }
      const s = await session(d.sessionLegacyId);
      const member = await required(
        ctx,
        "rosterMembers",
        "by_version_student",
        [
          ["versionId", s.rosterVersionId],
          ["studentId", d.studentId],
        ],
      );
      const bucket = Math.floor(member.ordinal / 100);
      const { sessionLegacyId: _, ...facts } = d;
      await save(
        "attendance",
        "by_session_bucket_student",
        [
          ["sessionId", s._id],
          ["bucket", bucket],
          ["studentId", d.studentId],
        ],
        { sessionId: s._id, bucket, ...facts },
      );
      break;
    }
    default:
      deny("unknown_operation");
  }
}

export const stage = internalMutation({
  args: {
    runId: v.id("migrationRuns"),
    ordinal: v.number(),
    operations: v.any(),
  },
  handler: async (ctx, { runId, ordinal, operations }) => {
    const run = await runFor(ctx, runId),
      p = run.protocol;
    check(p.phase === "import" && run.status === "staging", "import_frozen");
    integer(ordinal);
    check(
      Array.isArray(operations) &&
        operations.length > 0 &&
        operations.length <= 100 &&
        bytes(operations) <= 2 * 1024 * 1024,
      "chunk_too_large",
    );
    const hasVersion = operations.some((op) => op?.kind === "version");
    check(
      hasVersion
        ? operations.length === 1
        : operations.reduce(
            (n, op) => n + (op?.kind === "account" ? 3 : 1),
            0,
          ) <= 100,
      "chunk_too_large",
    );
    const hash = operationDigest(operations);
    if (ordinal < p.nextChunk) {
      const receipt = await required(ctx, "migrationChunks", "by_run_ordinal", [
        ["runId", runId],
        ["ordinal", ordinal],
      ]);
      check(receipt.digest === hash, "chunk_mismatch");
      return { nextChunk: p.nextChunk };
    }
    check(
      ordinal === p.nextChunk && ordinal < p.chunkCount,
      "chunk_out_of_order",
    );
    const counts = [...p.importedCounts];
    for (const op of operations) await importOperation(ctx, runId, counts, op);
    check(
      counts.every((n, i) => n <= p.tableCounts[i]),
      "count_mismatch",
    );
    await ctx.db.insert("migrationChunks", { runId, ordinal, digest: hash });
    await ctx.db.patch(runId, {
      protocol: {
        ...p,
        importedCounts: counts,
        nextChunk: ordinal + 1,
        chain: advanceChain(p.chain, hash),
      },
    });
    return { nextChunk: ordinal + 1 };
  },
});

export const freeze = internalMutation({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, { runId }) => {
    const run = await runFor(ctx, runId),
      p = run.protocol;
    if (p.phase !== "import") return { phase: p.phase };
    check(
      p.nextChunk === p.chunkCount &&
        p.chain === p.manifestDigest &&
        stable(p.importedCounts) === stable(p.tableCounts),
      "incomplete_import",
    );
    await ctx.db.patch(runId, { protocol: { ...p, phase: "verify" } });
    return { phase: "verify" };
  },
});

export const verifyNext = internalMutation({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, { runId }) => {
    const run = await runFor(ctx, runId),
      p = run.protocol;
    if (p.phase === "verified")
      return { phase: "verified", table: p.verifyTable };
    check(
      p.phase === "verify" && run.status === "staging",
      "verification_not_ready",
    );
    check(p.verifyTable < migrationTables.length, "invalid_run");
    const table = migrationTables[p.verifyTable];
    // At most 100 bounded target rows + 100 tiny indexed receipts per mutation.
    const page = await dbAny(ctx)
      .query(table)
      .paginate({
        cursor: p.verifyCursor,
        numItems: 100,
        maximumBytesRead: 2 * 1024 * 1024,
      });
    for (const row of page.page) {
      const receipt = await required(ctx, "migrationDocuments", "by_document", [
        ["table", table],
        ["documentId", row._id],
      ]);
      check(
        receipt.runId === runId && receipt.digest === documentDigest(bare(row)),
        "target_drift",
      );
    }
    const count = p.verifiedInTable + page.page.length;
    check(count <= p.tableCounts[p.verifyTable], "extra_target");
    if (page.isDone)
      check(count === p.tableCounts[p.verifyTable], "missing_target");
    const tableIndex = p.verifyTable + (page.isDone ? 1 : 0);
    const done = tableIndex === migrationTables.length;
    await ctx.db.patch(runId, {
      status: done ? "verified" : "staging",
      protocol: {
        ...p,
        phase: done ? "verified" : "verify",
        verifyTable: tableIndex,
        verifyCursor: page.isDone ? null : page.continueCursor,
        verifiedInTable: page.isDone ? 0 : count,
      },
    });
    return { phase: done ? "verified" : "verify", table: tableIndex };
  },
});

export const activate = internalMutation({
  args: { runId: v.id("migrationRuns"), readOnly: v.optional(v.boolean()) },
  handler: async (ctx, { runId, readOnly }) => {
    const run = await runFor(ctx, runId),
      p = run.protocol;
    check(
      run.status === "verified" &&
        p.phase === "verified" &&
        p.verifyTable === migrationTables.length &&
        p.nextChunk === p.chunkCount &&
        p.chain === p.manifestDigest &&
        stable(p.importedCounts) === stable(p.tableCounts),
      "not_verified",
    );
    const state = await closed(ctx);
    await ctx.db.patch(runId, {
      status: "active",
      protocol: { ...p, phase: "active" },
    });
    await ctx.db.patch(state._id, {
      activeRunId: runId,
      readsEnabled: true,
      // Production reconciliation must not depend on a second request closing
      // writes after publication. Legacy callers retain their existing default.
      writesEnabled: readOnly !== true,
    });
    return { phase: "active" };
  },
});

export const status = internalQuery({
  args: { fingerprint: v.string(), manifestDigest: v.string() },
  handler: async (ctx, args) => {
    digest(args.fingerprint);
    digest(args.manifestDigest);
    const runs = await ctx.db.query("migrationRuns").take(2);
    check(
      runs.length === 1 &&
        runs[0].fingerprint === args.fingerprint &&
        runs[0].protocol?.manifestDigest === args.manifestDigest,
      "invalid_run",
    );
    const run = runs[0],
      p = run.protocol!;
    if (p.phase === "active") {
      const states = await ctx.db.query("deploymentState").take(2);
      check(
        states.length === 1 &&
          states[0].key === "migration" &&
          states[0].activeRunId === run._id &&
          !(states[0].writesEnabled && !states[0].readsEnabled) &&
          run.status === "active",
        "invalid_run",
      );
    } else await runFor(ctx, run._id);
    return {
      runId: run._id,
      phase: p.phase,
      nextChunk: p.nextChunk,
      table: p.verifyTable,
    };
  },
});
