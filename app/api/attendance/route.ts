import { read, write, all } from "../../../lib/storage";
import { account, sameOrigin, HttpError } from "../../../lib/auth";
import { authorizeSession, classContext } from "../../../lib/classes";
import { randomBytes } from "node:crypto";
import { parseRoster, matchStudent } from "../../../lib/roster.mjs";
import { readJson } from "../../../lib/http.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Student = { id: string; name: string; code: string };
type Session = {
  id: string;
  owner: string;
  classId?: string;
  title: string;
  createdAt: string;
  students: Student[];
};
function sessionId(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value))
    throw new HttpError("Invalid attendance link.");
  return value;
}
async function load(id: string) {
  const session = (await read(`sessions/${id}.json`)) as Session | null;
  if (!session) throw new HttpError("This session could not be found.", 404);
  return session;
}
async function closed(id: string) {
  return Boolean(await read(`closed/${id}.json`));
}
function response(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export async function GET(req: Request) {
  try {
    const url = new URL(req.url),
      id = url.searchParams.get("id");
    if (url.searchParams.get("public") === "1" && id) {
      const s = await load(sessionId(id));
      return response({ title: s.title, closed: await closed(s.id) });
    }
    const who = (await account(req)).owner;
    if (!id) {
      const imports = await all(`auth/imports/${who}/`);
      const oldOwners = await Promise.all(imports.map((b) => read(b.pathname)));
      const refs = (
        await Promise.all(
          [who, ...oldOwners.filter(Boolean).map((x) => x.old)].map((id) =>
            all(`owners/${id}/`),
          ),
        )
      ).flat();
      const sessions = await Promise.all(refs.map((b) => read(b.pathname)));
      const shared = await all(`shared/${who}/`);
      for (const item of shared) {
        const ref = await read(item.pathname);
        if (!ref) continue;
        try {
          const root = await load(ref.id);
          await classContext(root, who);
          const classRefs = await all(`owners/${root.owner}/`);
          const candidates = await Promise.all(
            classRefs.map((b) => read(b.pathname)),
          );
          sessions.push(
            ...candidates.filter((s) => s && (s.classId || s.id) === root.id),
          );
        } catch (e) {
          if (!(e instanceof HttpError && [403, 404].includes(e.status)))
            throw e;
        }
      }
      return response({
        sessions: sessions
          .filter(
            (s, i, arr) => s && arr.findIndex((x) => x?.id === s.id) === i,
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      });
    }
    const session = await load(sessionId(id));
    await authorizeSession(session, who);
    const checks = await all(`checks/${id}/`);
    const attendance = Object.fromEntries(
      checks.map((b) => [
        b.pathname.split("/").pop()!.replace(".json", ""),
        b.uploadedAt,
      ]),
    );
    return response({
      ...session,
      owner: undefined,
      closed: await closed(id),
      attendance,
    });
  } catch (e) {
    return response(
      { error: e instanceof HttpError ? e.message : "Unable to load attendance." },
      e instanceof HttpError ? e.status : 500,
    );
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const body = await readJson(req, 1_000_000);
    if (body.action === "checkin") {
      const id = sessionId(body.id),
        session = await load(id);
      if (await closed(id))
        return response(
          { error: "Check-in has closed for this session." },
          409,
        );
      if (typeof body.identity !== "string" || body.identity.length > 160)
        throw new HttpError("Enter your full name or student ID.");
      const student = matchStudent(session.students, body.identity);
      if (!student)
        return response(
          {
            error:
              "No unique match found. Use your student ID or ask your teacher to check the roster.",
          },
          400,
        );
      const path = `checks/${id}/${student.id}.json`;
      const prior = await read(path);
      if (prior) return response({ name: student.name, already: true });
      try {
        await write(path, { at: new Date().toISOString() });
      } catch (e) {
        if (!(await read(path))) throw e;
      }
      return response({ name: student.name });
    }
    const who = (await account(req)).owner;
    if (body.action === "create" || body.action === "repeat") {
      const source =
        body.action === "repeat" ? await load(sessionId(body.id)) : null;
      const context = source ? await classContext(source, who) : null;
      const title = String(source?.title || body.title || "").trim();
      if (!title || title.length > 100)
        throw new HttpError("Enter a session name (up to 100 characters).");
      if (
        !source &&
        (typeof body.csv !== "string" || body.csv.length > 500_000)
      )
        throw new HttpError("Choose a CSV smaller than 500 KB.");
      let students: Student[];
      if (context) students = context.state.students;
      else {
        try { students = parseRoster(body.csv); }
        catch (error) { throw new HttpError(error instanceof Error ? error.message : "Invalid roster."); }
      }
      const id = randomBytes(16).toString("hex");
      const session: Session = {
        id,
        classId: source ? source.classId || source.id : id,
        owner: context ? context.root.owner : who,
        title,
        createdAt: new Date().toISOString(),
        students,
      };
      await write(`sessions/${session.id}.json`, session);
      await write(`owners/${session.owner}/${session.id}.json`, {
        id: session.id,
        classId: session.classId,
        title,
        createdAt: session.createdAt,
        count: students.length,
      });
      return response({ id: session.id });
    }
    if (body.action === "close") {
      const id = sessionId(body.id),
        session = await load(id);
      await authorizeSession(session, who);
      if (!(await closed(id)))
        await write(`closed/${id}.json`, { at: new Date().toISOString() });
      return response({ ok: true });
    }
    throw new HttpError("Unknown action.");
  } catch (e) {
    console.error(e instanceof HttpError ? e.message : "Attendance storage failure");
    return response(
      { error: e instanceof HttpError ? e.message : "Unable to save attendance." },
      e instanceof HttpError ? e.status : 500,
    );
  }
}
