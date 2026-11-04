import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { normalize } from "../lib/roster.mjs";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { fail } from "./access";

export type Student = { id: string; name: string; code: string };

// Portable SHA-256: no Node APIs, randomness, or asynchronous external work in mutations.
export function rosterDigest(students: Student[]) {
  return sha256(JSON.stringify(students.map(({ id, name, code }) => ({ id, name, code }))));
}

export function sha256(value: string) {
  return bytesToHex(nobleSha256(utf8ToBytes(value)));
}

export function validateStudents(input: Student[], existingIds?: Set<string>): Student[] {
  if (input.length < 1 || input.length > 1000) fail(400, "Provide between 1 and 1,000 students.");
  const ids = new Set<string>(), codes = new Set<string>(), names = new Map<string, boolean>();
  return input.map((student) => {
    const { id } = student, name = student.name.trim(), code = student.code.trim();
    if ((!existingIds?.has(id) && !/^[a-f0-9]{32}$/.test(id)) || ids.has(id) ||
        !name || name.length > 160 || code.length > 160) fail(400, "Invalid student name, ID, or code.");
    const normalizedName = normalize(name), normalizedCode = normalize(code);
    if (names.has(normalizedName) && (!code || !names.get(normalizedName))) {
      fail(400, "Give every student with the same name a unique student ID.");
    }
    if (code && codes.has(normalizedCode)) fail(400, "Duplicate student ID.");
    names.set(normalizedName, Boolean(code));
    if (code) codes.add(normalizedCode);
    ids.add(id);
    return { id, name, code };
  });
}

export async function versionForSession(ctx: QueryCtx, session: Doc<"sessions">) {
  const version = await ctx.db.get(session.rosterVersionId);
  if (!version || version.classId !== session.classId || version.count !== session.count) {
    fail(503, "Invalid session roster.");
  }
  return version;
}

export async function currentVersion(ctx: QueryCtx, classId: Id<"classes">) {
  const state = await ctx.db.query("classState").withIndex("by_class", (q) => q.eq("classId", classId)).unique();
  if (!state || !Number.isSafeInteger(state.revision) || state.revision < 0) fail(503, "Class roster unavailable.");
  const version = await ctx.db.get(state.rosterVersionId);
  if (!version || version.classId !== classId || !Number.isInteger(version.count) ||
      version.count < 1 || version.count > 1000) fail(503, "Class roster unavailable.");
  return { state, version };
}

export async function readStudents(ctx: QueryCtx, version: Doc<"rosterVersions">): Promise<Student[]> {
  if (!Number.isInteger(version.count) || version.count < 1 || version.count > 1000) fail(503, "Invalid roster size.");
  const rows = await ctx.db.query("rosterMembers").withIndex("by_version_order", (q) => q.eq("versionId", version._id))
    .take(version.count + 1);
  if (rows.length !== version.count || rows.some((row, i) => row.ordinal !== i)) fail(503, "Invalid roster rows.");
  return rows.map(({ studentId, name, code }) => ({ id: studentId, name, code }));
}

export async function storeVersion(ctx: MutationCtx, classId: Id<"classes">, students: Student[]) {
  const digest = rosterDigest(students);
  const prior = await ctx.db.query("rosterVersions")
    .withIndex("by_class_digest", (q) => q.eq("classId", classId).eq("digest", digest)).unique();
  if (prior) {
    if (prior.count !== students.length) fail(503, "Invalid saved roster version.");
    return prior._id;
  }
  const versionId = await ctx.db.insert("rosterVersions", {
    classId, digest, sourceKey: `live:${classId}:${digest}`, count: students.length,
  });
  for (const [ordinal, { id: studentId, name, code }] of students.entries()) {
    await ctx.db.insert("rosterMembers", { versionId, studentId, name, code, ordinal,
      normalizedName: normalize(name), normalizedCode: normalize(code) });
  }
  return versionId;
}
