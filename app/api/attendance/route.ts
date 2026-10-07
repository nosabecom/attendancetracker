import { read, write, all } from "../../../lib/storage";
import { account, canAccess, sameOrigin, HttpError } from "../../../lib/auth";
import { randomBytes } from "node:crypto";
import { parseRoster, matchStudent } from "../../../lib/roster.mjs";
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
    throw new Error("Invalid attendance link.");
  return value;
}
async function load(id: string) {
  const session = (await read(`sessions/${id}.json`)) as Session | null;
  if (!session) throw new Error("This session could not be found.");
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
      return response({
        sessions: sessions
          .filter(Boolean)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      });
    }
    const session = await load(sessionId(id));
    if (!(await canAccess(who, session.owner)))
      return response({ error: "Access denied." }, 403);
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
      { error: e instanceof Error ? e.message : "Unable to load attendance." },
      e instanceof HttpError ? e.status : 400,
    );
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    if (Number(req.headers.get("content-length")) > 1_000_000)
      return response({ error: "File is too large." }, 413);
    const body = await req.json();
    if (body.action === "checkin") {
      const id = sessionId(body.id),
        session = await load(id);
      if (await closed(id))
        return response(
          { error: "Check-in has closed for this session." },
          409,
        );
      if (typeof body.identity !== "string" || body.identity.length > 160)
        throw new Error("Enter your full name or student ID.");
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
      if (source && !(await canAccess(who, source.owner)))
        return response({ error: "Access denied." }, 403);
      const title = String(source?.title || body.title || "").trim();
      if (!title || title.length > 100)
        throw new Error("Enter a session name (up to 100 characters).");
      if (
        !source &&
        (typeof body.csv !== "string" || body.csv.length > 500_000)
      )
        throw new Error("Choose a CSV smaller than 500 KB.");
      const students = source ? source.students : parseRoster(body.csv);
      const id = randomBytes(16).toString("hex");
      const session: Session = {
        id,
        classId: source ? source.classId || source.id : id,
        owner: who,
        title,
        createdAt: new Date().toISOString(),
        students,
      };
      await write(`sessions/${session.id}.json`, session);
      await write(`owners/${who}/${session.id}.json`, {
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
      if (!(await canAccess(who, session.owner)))
        return response({ error: "Access denied." }, 403);
      if (!(await closed(id)))
        await write(`closed/${id}.json`, { at: new Date().toISOString() });
      return response({ ok: true });
    }
    throw new Error("Unknown action.");
  } catch (e) {
    console.error(e);
    return response(
      { error: e instanceof Error ? e.message : "Unable to save attendance." },
      e instanceof HttpError ? e.status : 400,
    );
  }
}
