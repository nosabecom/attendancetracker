import {
  account,
  hash,
  canAccess,
  HttpError,
  sameOrigin,
} from "../../../lib/auth";
import { read, write } from "../../../lib/storage";
import { readJson } from "../../../lib/http.mjs";
import {
  classContext,
  loadSession,
  saveClass,
  validateStudents,
} from "../../../lib/classes";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
function fail(e: unknown) {
  return json(
    {
      error:
        e instanceof HttpError
          ? e.message
          : "Unable to update this class. Please try again.",
    },
    e instanceof HttpError ? e.status : 500,
  );
}
export async function GET(req: Request) {
  try {
    const who = (await account(req)).owner;
    const { root, state, isOwner } = await classContext(
      await loadSession(new URL(req.url).searchParams.get("id") || ""),
      who,
    );
    return json({
      id: root.id,
      title: root.title,
      ...state,
      isOwner,
      teachers: state.teachers.map((t) => ({ username: t.username })),
    });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const who = (await account(req)).owner;
    const body = await readJson(req, 500000);
    const { root, state, isOwner } = await classContext(
      await loadSession(body.id),
      who,
    );
    if (body.action === "roster") {
      const students = validateStudents(body.students, state.students);
      const next = await saveClass(
        root.id,
        { ...state, students },
        body.revision,
      );
      return json({ ok: true, revision: next.revision });
    }
    if (!isOwner)
      throw new HttpError(
        "Only the class owner can manage teacher access.",
        403,
      );
    if (!["share", "unshare"].includes(body.action))
      throw new HttpError("Unknown action.");
    const username = String(body.username || "")
      .trim()
      .toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username))
      throw new HttpError("Enter a valid teacher username.");
    const user = await read(`auth/accounts/${hash(username)}.json`);
    if (!user)
      throw new HttpError(
        "No account with that username. Ask the teacher to create an account first.",
        404,
      );
    if (await canAccess(user.owner, root.owner))
      throw new HttpError("That account already owns this class.");
    const teachers = state.teachers.filter((t) => t.owner !== user.owner);
    if (body.action === "share") {
      if (teachers.length >= 50)
        throw new HttpError("This class already has 50 additional teachers.");
      // Index first: a partial failure cannot grant access; every read checks membership.
      const path = `shared/${user.owner}/${root.id}.json`;
      if (!(await read(path))) {
        try {
          await write(path, { id: root.id });
        } catch (e) {
          if (!(await read(path))) throw e;
        }
      }
      teachers.push({ owner: user.owner, username: user.username });
    }
    const next = await saveClass(
      root.id,
      { ...state, teachers },
      body.revision,
    );
    return json({ ok: true, revision: next.revision });
  } catch (e) {
    return fail(e);
  }
}
