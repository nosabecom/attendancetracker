import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,
  // Required by the pinned auth refresh patch: active-token lookup is indexed.
  authRefreshTokens: authTables.authRefreshTokens.index(
    "sessionIdAndFirstUsedTime",
    ["sessionId", "firstUsedTime"],
  ),
  users: defineTable({
    ...authTables.users.validator.fields,
    username: v.optional(v.string()),
    ownerKey: v.optional(v.string()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_username", ["username"])
    .index("by_owner", ["ownerKey"]),

  credentials: defineTable({
    username: v.string(),
    userId: v.id("users"),
    salt: v.string(),
    passwordHash: v.string(),
  }).index("by_username", ["username"]),

  // An owner key survives migration and legacy workspace claims. Ownership is
  // separate from mutable rosters, so a roster edit cannot invalidate attendance.
  ownerLinks: defineTable({
    ownerKey: v.string(),
    userId: v.id("users"),
    directoryComplete: v.optional(v.boolean()),
  })
    .index("by_owner", ["ownerKey"])
    .index("by_user_owner", ["userId", "ownerKey"]),

  classes: defineTable({
    legacyId: v.string(),
    ownerKey: v.string(),
    title: v.string(),
    createdAt: v.string(),
  })
    .index("by_legacy", ["legacyId"])
    .index("by_owner", ["ownerKey"]),

  classState: defineTable({
    classId: v.id("classes"),
    rosterVersionId: v.id("rosterVersions"),
    revision: v.number(),
  }).index("by_class", ["classId"]),

  memberships: defineTable({
    classId: v.id("classes"),
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("teacher")),
  })
    .index("by_class_user", ["classId", "userId"])
    .index("by_user_class", ["userId", "classId"]),

  rosterVersions: defineTable({
    classId: v.id("classes"),
    sourceKey: v.string(),
    digest: v.string(),
    count: v.number(),
  })
    .index("by_source", ["sourceKey"])
    .index("by_class_digest", ["classId", "digest"]),

  rosterMembers: defineTable({
    versionId: v.id("rosterVersions"),
    studentId: v.string(),
    name: v.string(),
    code: v.string(),
    normalizedName: v.string(),
    normalizedCode: v.string(),
    ordinal: v.number(),
  })
    .index("by_version_student", ["versionId", "studentId"])
    .index("by_version_code", ["versionId", "normalizedCode"])
    .index("by_version_name", ["versionId", "normalizedName"])
    .index("by_version_order", ["versionId", "ordinal"]),

  sessions: defineTable({
    legacyId: v.string(),
    classId: v.id("classes"),
    rosterVersionId: v.id("rosterVersions"),
    title: v.string(),
    createdAt: v.string(),
    count: v.number(),
    bucketSize: v.number(),
  })
    .index("by_legacy", ["legacyId"])
    .index("by_class_created", ["classId", "createdAt"]),

  closures: defineTable({
    sessionId: v.id("sessions"),
    closedAt: v.string(),
  }).index("by_session", ["sessionId"]),

  attendance: defineTable({
    sessionId: v.id("sessions"),
    bucket: v.number(),
    studentId: v.string(),
    checkedInAt: v.optional(v.string()),
    excusedAt: v.optional(v.string()),
    excusedBy: v.optional(v.string()),
  }).index("by_session_bucket_student", ["sessionId", "bucket", "studentId"]),

  throttleCounters: defineTable({
    key: v.string(),
    bucket: v.number(),
    count: v.number(),
    expiresAt: v.number(),
    partition: v.optional(v.number()),
  })
    .index("by_key_bucket", ["key", "bucket"])
    .index("by_partition_expiry", ["partition", "expiresAt"]),

  gatewayNonces: defineTable({
    nonce: v.string(),
    expiresAt: v.number(),
    partition: v.optional(v.number()),
    // Diagnostic IP quota * 64 + session quota; no admission authority.
    quotaPartitions: v.optional(v.number()),
  })
    .index("by_nonce", ["nonce"])
    .index("by_partition_expiry", ["partition", "expiresAt"]),

  migrationRuns: defineTable({
    fingerprint: v.string(),
    status: v.union(
      v.literal("staging"),
      v.literal("verified"),
      v.literal("active"),
    ),
    exportedAt: v.string(),
    expectedCounts: v.object({
      accounts: v.number(),
      legacyClaims: v.number(),
      classes: v.number(),
      rosterVersions: v.number(),
      rosterMembers: v.number(),
      memberships: v.number(),
      sessions: v.number(),
      closures: v.number(),
      attendance: v.number(),
    }),
    // Optional so pre-existing test fixtures remain usable. The importer rejects
    // runs without this protocol; no legacy run can pass its publication gate.
    protocol: v.optional(
      v.object({
        version: v.literal(1),
        manifestDigest: v.string(),
        chunkCount: v.number(),
        nextChunk: v.number(),
        chain: v.string(),
        tableCounts: v.array(v.number()),
        importedCounts: v.array(v.number()),
        phase: v.union(
          v.literal("import"),
          v.literal("verify"),
          v.literal("verified"),
          v.literal("active"),
        ),
        verifyTable: v.number(),
        verifyCursor: v.union(v.string(), v.null()),
        verifiedInTable: v.number(),
      }),
    ),
  }).index("by_fingerprint", ["fingerprint"]),

  migrationChunks: defineTable({
    runId: v.id("migrationRuns"),
    ordinal: v.number(),
    digest: v.string(),
  }).index("by_run_ordinal", ["runId", "ordinal"]),

  // No duplicated credentials or student data: receipts contain only IDs and
  // hashes of the exact expected target fields (including every foreign key).
  migrationDocuments: defineTable({
    runId: v.id("migrationRuns"),
    table: v.string(),
    documentId: v.string(),
    digest: v.string(),
  }).index("by_document", ["table", "documentId"]),

  deploymentState: defineTable({
    key: v.literal("migration"),
    activeRunId: v.optional(v.id("migrationRuns")),
    readsEnabled: v.boolean(),
    writesEnabled: v.boolean(),
  }).index("by_key", ["key"]),
});
