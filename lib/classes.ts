import { read, write, all } from "./storage";
import { canAccess, HttpError } from "./auth";
import { normalize } from "./roster.mjs";
import { randomBytes } from "node:crypto";
export type Student = { id: string; name: string; code: string };
export type AttendanceSession = {
  id: string;
  classId?: string;
  owner: string;
  title: string;
  createdAt: string;
  students: Student[];
};
export type ClassState = {
  revision: number;
  students: Student[];
  teachers: { owner: string; username: string }[];
};
export function validId(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value))
    throw new HttpError("Invalid class or session.");
  return value;
}
export async function loadSession(id: string) {
  const s = (await read(
    `sessions/${validId(id)}.json`,
  )) as AttendanceSession | null;
  if (!s) throw new HttpError("This session could not be found.", 404);
  return s;
}
export async function classContext(session: AttendanceSession, who: string) {
  const root =
    session.classId && session.classId !== session.id
      ? await loadSession(session.classId)
      : session;
  const versions = await all(`classes/${root.id}/versions/`);
  versions.sort((a, b) => b.pathname.localeCompare(a.pathname));
  const state: ClassState = versions.length
    ? await read(versions[0].pathname)
    : { revision: 0, students: root.students, teachers: [] };
  if (!state)
    throw new HttpError("Unable to load this class. Please retry.", 503);
  const isOwner = await canAccess(who, root.owner);
  if (!isOwner && !state.teachers.some((t) => t.owner === who))
    throw new HttpError("You no longer have access to this class.", 403);
  return { root, state, isOwner };
}
export async function authorizeSession(session: AttendanceSession, who: string) {
  // Session ownership and its roster snapshot are immutable. Owners don't need
  // the editable class state just to view attendance or close check-in.
  if (await canAccess(who, session.owner)) return;
  // Shared teachers still read the latest membership on every request.
  await classContext(session, who);
}
export async function saveClass(
  id: string,
  state: ClassState,
  expected: unknown,
) {
  if (expected !== state.revision)
    throw new HttpError(
      "Another teacher changed this class. Reopen the editor to load the latest version.",
      409,
    );
  const next = { ...state, revision: state.revision + 1 };
  const path = `classes/${id}/versions/${String(next.revision).padStart(10, "0")}.json`;
  try {
    await write(path, next);
  } catch (e) {
    if (await read(path))
      throw new HttpError(
        "Another teacher changed this class. Reopen the editor to load the latest version.",
        409,
      );
    throw e;
  }
  return next;
}
export function validateStudents(value: unknown, previous: Student[]) {
  if (!Array.isArray(value) || !value.length || value.length > 1000)
    throw new HttpError("Keep between 1 and 1,000 students on the roster.");
  const ids = new Set(),
    codes = new Set(),
    names = new Map<string, boolean>();
  return value.map((row) => {
    if (!row || typeof row.name !== "string" || typeof row.code !== "string")
      throw new HttpError(
        "Each student needs a name and an optional student ID.",
      );
    const name = row.name.trim(),
      code = row.code.trim();
    if (!name || name.length > 160 || code.length > 160)
      throw new HttpError(
        "Names and student IDs must be 160 characters or fewer.",
      );
    const normalized = normalize(name);
    if (names.has(normalized) && (!code || !names.get(normalized)))
      throw new HttpError(
        `Give every student named ${name} a unique student ID.`,
      );
    names.set(normalized, Boolean(code));
    if (code && codes.has(normalize(code)))
      throw new HttpError(`Duplicate student ID: ${code}.`);
    if (code) codes.add(normalize(code));
    const id =
      typeof row.id === "string" && previous.some((s) => s.id === row.id)
        ? row.id
        : randomBytes(16).toString("hex");
    if (ids.has(id))
      throw new HttpError("The same student appears more than once.");
    ids.add(id);
    return { id, name, code };
  });
}
