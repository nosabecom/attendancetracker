"use client";
import { useEffect, useState, useRef } from "react";
import {
  Check,
  CheckCheck,
  Users,
  QrCode,
  Upload,
  Download,
  Plus,
  Search,
  Copy,
  X,
  ArrowUpRight,
  ClipboardList,
  Lock,
  Loader2,
  CalendarDays,
} from "lucide-react";
import QRCode from "qrcode";
import ClassManager from "./class-manager";
import Papa from "papaparse";
import { parseRoster } from "../lib/roster.mjs";
import { startAttendancePolling } from "../lib/attendance-polling.mjs";
type SessionRef = {
  id: string;
  title: string;
  createdAt: string;
  count: number;
  classId?: string;
};
type Session = SessionRef & {
  students: { id: string; name: string; code: string }[];
  attendance: Record<string, string>;
  closed: boolean;
};
export default function Home() {
  const [username, setUsername] = useState(""),
    [join, setJoin] = useState<string | null>(null),
    [ready, setReady] = useState(false);
  const [sessions, setSessions] = useState<SessionRef[]>([]),
    [active, setActive] = useState<Session | null>(null),
    [selected, setSelected] = useState("");
  const [modal, setModal] = useState(false),
    [title, setTitle] = useState(""),
    [csv, setCsv] = useState(""),
    [fileName, setFileName] = useState(""),
    [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [query, setQuery] = useState(""),
    [qr, setQr] = useState("");
  const [publicInfo, setPublicInfo] = useState<{
      title: string;
      closed: boolean;
    } | null>(null),
    [identity, setIdentity] = useState(""),
    [success, setSuccess] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [loginName, setLoginName] = useState(""),
    [password, setPassword] = useState("");
  const [legacyKey, setLegacyKey] = useState("");
  const [manager, setManager] = useState<"roster" | "teachers" | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const j = params.get("join");
    setJoin(j);
    if (j) {
      setReady(true);
      return;
    }
    const hash = new URLSearchParams(location.hash.slice(1)).get("teacher");
    const old =
      hash && /^[a-f0-9]{64}$/.test(hash)
        ? hash
        : localStorage.getItem("rollcall-key");
    if (old) {
      setLegacyKey(old);
      localStorage.setItem("rollcall-key", old);
    }
    if (hash) history.replaceState(null, "", location.pathname);
    fetch("/api/auth")
      .then(async (r) => {
        if (r.ok) {
          const a = await r.json();
          setUsername(a.username);
        } else if (r.status !== 401)
          throw new Error("Unable to load your account. Please try again.");
      })
      .catch((e) => setError(e.message))
      .finally(() => setReady(true));
  }, []);
  async function auth(body: unknown) {
    const r = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    return data;
  }
  async function authenticate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const a = await auth({ action: authMode, username: loginName, password });
      setPassword("");
      setSessions([]);
      setActive(null);
      setSelected("");
      setUsername(a.username);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    try {
      await auth({ action: "logout" });
      setUsername("");
      setSessions([]);
      setActive(null);
      setSelected("");
      setError("");
      setModal(false);
      setManager(null);
      setNotice("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function migrate() {
    setBusy(true);
    setError("");
    try {
      await auth({ action: "migrate", legacyKey });
      localStorage.removeItem("rollcall-key");
      setLegacyKey("");
      await loadList();
      setNotice("Your existing classes are now saved to this account.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function repeat() {
    if (!active) return;
    setBusy(true);
    setError("");
    try {
      const next = await api("", { action: "repeat", id: active.id });
      await loadList();
      setSelected(next.id);
      setActive(null);
      setNotice("New attendance session started with your saved roster.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function api(path = "", body?: unknown, signal?: AbortSignal) {
    const res = await fetch("/api/attendance" + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal,
    });
    const data = await res.json();
    if (res.status === 401) {
      setUsername("");
      setActive(null);
      setSessions([]);
      setSelected("");
    }
    if (!res.ok)
      throw Object.assign(
        new Error(data.error || "Something went wrong. Please try again."),
        { status: res.status },
      );
    return data;
  }
  async function loadList() {
    const data = await api();
    setSessions(data.sessions);
    if (!selected && data.sessions.length) setSelected(data.sessions[0].id);
  }
  useEffect(() => {
    if (username) loadList().catch((e) => setError(e.message));
  }, [username]);
  const selectedClosed = active?.id === selected && active.closed;
  useEffect(() => {
    if (!username || !selected || selectedClosed) return;
    return startAttendancePolling({
      load: (signal: AbortSignal) => api(`?id=${selected}`, undefined, signal),
      onData: (session: Session) => {
        setActive(session);
        setError("");
      },
      onError: (e: Error) => {
        setError(e.message);
        setActive(null);
        setManager(null);
      },
    });
  }, [username, selected, selectedClosed]);
  useEffect(() => {
    if (join)
      api(`?public=1&id=${encodeURIComponent(join)}`)
        .then(setPublicInfo)
        .catch((e) => setError(e.message));
  }, [join]);
  useEffect(() => {
    if (active)
      QRCode.toDataURL(`${location.origin}/?join=${active.id}`, {
        width: 600,
        margin: 2,
        color: { dark: "#102344", light: "#ffffff" },
        errorCorrectionLevel: "M",
      }).then(setQr);
  }, [active?.id]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 4000);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  async function readFile(f?: File) {
    if (!f) return;
    setError("");
    try {
      if (f.size > 500000) throw new Error("Choose a CSV smaller than 500 KB.");
      const text = await f.text();
      const roster = parseRoster(text);
      setCsv(text);
      setCount(roster.length);
      setFileName(f.name);
    } catch (e) {
      setError((e as Error).message);
      setCsv("");
      setCount(0);
    }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const s = await api("", { action: "create", title, csv });
      await loadList();
      setSelected(s.id);
      setModal(false);
      setTitle("");
      setCsv("");
      setCount(0);
      setFileName("");
      setNotice("Your session is ready. Share the QR code to start.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copy(text: string, message: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(message);
    } catch {
      setError(
        "Clipboard unavailable. Please copy the link from the address bar.",
      );
    }
  }
  function exportCsv() {
    if (!active) return;
    const output = Papa.unparse(
      active.students.map((s) => ({
        Name: s.name,
        "Student ID": s.code,
        Status: active.attendance[s.id] ? "Present" : "Absent",
        "Check-in time": active.attendance[s.id] || "",
        Session: active.title,
      })),
      { escapeFormulae: true },
    );
    const url = URL.createObjectURL(
      new Blob([output], { type: "text/csv;charset=utf-8;" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-${active.id.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  async function closeSession() {
    if (
      !active ||
      !confirm(
        "Close check-in? Students will no longer be able to sign into this session.",
      )
    )
      return;
    setBusy(true);
    try {
      await api("", { action: "close", id: active.id });
      setActive(await api(`?id=${active.id}`));
      setNotice("Check-in is now closed.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function checkin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api("", { action: "checkin", id: join, identity });
      setSuccess(
        result.already
          ? `You’re already checked in, ${result.name}.`
          : `You’re checked in, ${result.name}!`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const present = active ? Object.keys(active.attendance).length : 0,
    total = active?.students.length || 0;
  const filtered =
    active?.students.filter((s) =>
      `${s.name} ${s.code}`.toLowerCase().includes(query.toLowerCase()),
    ) || [];
  const Brand = () => (
    <div className="brand">
      <span className="brandmark">
        <CheckCheck size={24} />
      </span>
      rollcall<span className="brand-dot">.</span>
    </div>
  );
  if (!ready)
    return (
      <div className="loading">
        <Loader2 className="spin" /> Opening Rollcall…
      </div>
    );
  if (join)
    return (
      <main className="student-page">
        <Brand />
        <section className="student-card">
          <span className="eyebrow">STUDENT CHECK-IN</span>
          {success ? (
            <>
              <div className="success-icon">
                <Check size={34} />
              </div>
              <h1>You’re all set.</h1>
              <p>{success}</p>
              <p className="muted">
                Your teacher has your attendance. You can close this page.
              </p>
            </>
          ) : (
            <>
              <h1>{publicInfo?.title || "Class attendance"}</h1>
              {error && (
                <div role="alert" className="error">
                  {error}
                </div>
              )}
              {publicInfo?.closed ? (
                <p>Check-in has closed. Please speak to your teacher.</p>
              ) : publicInfo ? (
                <form onSubmit={checkin}>
                  <p>
                    Enter your name as it appears on the class roster, or use
                    your student ID.
                  </p>
                  <label htmlFor="identity">Full name or student ID</label>
                  <input
                    id="identity"
                    autoComplete="name"
                    value={identity}
                    onChange={(e) => setIdentity(e.target.value)}
                    required
                    maxLength={160}
                    placeholder="e.g. Alex Morgan"
                  />
                  <button className="primary full" disabled={busy}>
                    {busy ? "Checking in…" : "Check me in"}
                    <Check size={18} />
                  </button>
                  <p className="privacy-note">
                    <Lock size={14} /> Your details are only visible to your
                    teacher.
                  </p>
                </form>
              ) : !error ? (
                <p>Loading your session…</p>
              ) : null}
            </>
          )}
        </section>
        <span className="student-footer">
          A little less admin. A little more teaching.
        </span>
      </main>
    );
  if (!username)
    return (
      <main className="student-page">
        <Brand />
        <section className="student-card auth-card">
          <span className="eyebrow">YOUR TEACHER WORKSPACE</span>
          <h1>
            {authMode === "login"
              ? "Welcome back."
              : "Make room for your classes."}
          </h1>
          <p>
            {authMode === "login"
              ? "Sign in to find your saved classes and attendance."
              : "Create an account to keep your classes in your own private workspace."}
          </p>
          <div className="auth-tabs">
            <button
              className={authMode === "login" ? "selected" : ""}
              onClick={() => {
                setAuthMode("login");
                setError("");
              }}
            >
              Sign in
            </button>
            <button
              className={authMode === "signup" ? "selected" : ""}
              onClick={() => {
                setAuthMode("signup");
                setError("");
              }}
            >
              Create account
            </button>
          </div>
          <form onSubmit={authenticate}>
            <label htmlFor="username">Username</label>
            <input
              id="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              minLength={3}
              maxLength={40}
              value={loginName}
              onChange={(e) => setLoginName(e.target.value)}
              placeholder="Your username"
            />
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete={
                authMode === "signup" ? "new-password" : "current-password"
              }
              required
              minLength={10}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 10 characters"
            />
            {authMode === "signup" && (
              <p className="auth-help">
                Save your username and password. Password recovery isn’t
                available yet.
              </p>
            )}
            {error && (
              <div role="alert" className="error">
                {error}
              </div>
            )}
            <button className="primary full" disabled={busy}>
              {busy
                ? "Please wait…"
                : authMode === "signup"
                  ? "Create my workspace"
                  : "Sign in"}
            </button>
          </form>
          {legacyKey && (
            <p className="auth-help">
              Your previous workspace is on this browser. After signing in, you
              can import its classes.
            </p>
          )}
        </section>
      </main>
    );
  return (
    <div className="app">
      {manager && active && (
        <ClassManager
          key={`${active.id}-${manager}`}
          id={active.id}
          mode={manager}
          onClose={() => setManager(null)}
          onSaved={() => {
            loadList().catch((e) => setError(e.message));
          }}
        />
      )}
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">TEACHER WORKSPACE</div>
        <div className="nav-active">
          <ClipboardList size={19} /> Attendance
        </div>
        <div className="session-label">
          YOUR CLASSES{" "}
          <button aria-label="New class" onClick={() => setModal(true)}>
            <Plus size={17} />
          </button>
        </div>
        <div className="session-list">
          {sessions
            .filter(
              (s, i, all) =>
                all.findIndex(
                  (x) => (x.classId || x.id) === (s.classId || s.id),
                ) === i,
            )
            .map((s) => (
              <button
                key={s.id}
                className={
                  (active?.classId || active?.id) === (s.classId || s.id)
                    ? "session selected"
                    : "session"
                }
                onClick={() => {
                  setSelected(s.id);
                  setActive(null);
                  setQuery("");
                }}
              >
                <CalendarDays size={17} />
                <span>
                  {s.title}
                  <small>
                    {new Date(s.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    · {s.count} students
                  </small>
                </span>
              </button>
            ))}
          {!sessions.length && (
            <p className="sidebar-empty">
              Your saved classes will appear here.
            </p>
          )}
        </div>
        <div className="teacher-access">
          <span className="avatar">T</span>
          <div>
            <strong>{username}</strong>
            <button disabled={busy} onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <header>
          <span>
            Workspace <span className="breadcrumb">/</span> Attendance
          </span>
          <span className="header-note">
            <Lock size={14} /> Private workspace
          </span>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">LESS ADMIN, MORE TEACHING</div>
              <h1>Attendance</h1>
              <p>Everyone accounted for. All in one place.</p>
            </div>
            <button
              className="primary"
              onClick={() => {
                setError("");
                setModal(true);
              }}
            >
              <Plus size={18} /> New class
            </button>
          </div>
          {notice && (
            <div className="notice" role="status">
              <Check size={17} />
              {notice}
            </div>
          )}
          {error && !modal && (
            <div className="error" role="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {legacyKey && (
            <div className="migration-banner">
              <div>
                <strong>Bring your previous classes with you</strong>
                <p>Import this browser’s old workspace into {username}.</p>
              </div>
              <button className="secondary" disabled={busy} onClick={migrate}>
                Import existing classes
              </button>
            </div>
          )}
          {active && (
            <div className="class-toolbar">
              <div>
                <label htmlFor="session-history">Attendance history</label>
                <select
                  id="session-history"
                  value={selected}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setActive(null);
                  }}
                >
                  {sessions
                    .filter(
                      (s) =>
                        (s.classId || s.id) === (active.classId || active.id),
                    )
                    .map((s) => (
                      <option value={s.id} key={s.id}>
                        {new Date(s.createdAt).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </option>
                    ))}
                </select>
              </div>
              <div className="class-buttons">
                <button
                  className="secondary"
                  onClick={() => setManager("roster")}
                >
                  Edit students
                </button>
                <button
                  className="secondary"
                  onClick={() => setManager("teachers")}
                >
                  Teacher access
                </button>
                <button className="secondary" disabled={busy} onClick={repeat}>
                  <Plus size={17} /> Take attendance again
                </button>
              </div>
            </div>
          )}
          <div className="stats">
            <div className="stat">
              <span className="stat-icon blue">
                <Users size={21} />
              </span>
              <div>
                <span>Students on roster</span>
                <strong>
                  {total}
                  <small>in this session</small>
                </strong>
              </div>
            </div>
            <div className="stat">
              <span className="stat-icon green">
                <CheckCheck size={21} />
              </span>
              <div>
                <span>Checked in</span>
                <strong>
                  {present}
                  <small>
                    {total
                      ? `${Math.round((present / total) * 100)}% attendance`
                      : "Ready when you are"}
                  </small>
                </strong>
              </div>
            </div>
            <div className="stat">
              <span className="stat-icon orange">
                <ClipboardList size={21} />
              </span>
              <div>
                <span>Not yet checked in</span>
                <strong>
                  {total - present}
                  <small>
                    {active?.closed ? "Session ended" : "Awaiting arrival"}
                  </small>
                </strong>
              </div>
            </div>
          </div>
          <div className="dashboard-grid">
            <section className="panel roster-panel">
              <div className="panel-heading">
                <div>
                  <h2>{active?.title || "Your class roster"}</h2>
                  <p>
                    {active
                      ? `${new Date(active.createdAt).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}`
                      : "Start with your students. We’ll take it from there."}
                  </p>
                </div>
                {active && (
                  <button className="secondary compact" onClick={exportCsv}>
                    <Download size={16} /> Export
                  </button>
                )}
              </div>
              {active ? (
                <>
                  <div className="roster-tools">
                    <div className="search">
                      <Search size={17} />
                      <input
                        aria-label="Search students"
                        placeholder="Search students…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                    <span
                      className={"badge " + (active.closed ? "neutral" : "")}
                    >
                      <span /> {active.closed ? "Closed" : "Check-in open"}
                    </span>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>STUDENT</th>
                          <th>STATUS</th>
                          <th>CHECK-IN TIME</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((s) => (
                          <tr key={s.id}>
                            <td>
                              <div className="student-name">
                                <span className="initials">
                                  {s.name
                                    .split(" ")
                                    .map((x) => x[0])
                                    .slice(0, 2)
                                    .join("")
                                    .toUpperCase()}
                                </span>
                                <div>
                                  <strong>{s.name}</strong>
                                  {s.code && <small>{s.code}</small>}
                                </div>
                              </div>
                            </td>
                            <td>
                              <span
                                className={
                                  active.attendance[s.id]
                                    ? "status present"
                                    : "status"
                                }
                              >
                                {active.attendance[s.id] ? (
                                  <Check size={13} />
                                ) : null}
                                {active.attendance[s.id]
                                  ? "Present"
                                  : active.closed
                                    ? "Absent"
                                    : "Waiting"}
                              </span>
                            </td>
                            <td>
                              {active.attendance[s.id]
                                ? new Date(
                                    active.attendance[s.id],
                                  ).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!filtered.length && (
                      <p className="no-results">
                        No students match your search.
                      </p>
                    )}
                  </div>
                  <div className="table-footer">
                    {filtered.length} students{" "}
                    <span>
                      {active.closed ? "Session closed" : "Updates every 30 seconds"}
                    </span>
                  </div>
                </>
              ) : (
                <div className="empty-roster">
                  <div className="upload-art">
                    <Users size={36} />
                    <span>
                      <Plus size={15} />
                    </span>
                  </div>
                  <h3>A fresh start for your next class</h3>
                  <p>
                    Import a CSV of student names to create your first
                    attendance session.
                  </p>
                  <button className="primary" onClick={() => setModal(true)}>
                    <Upload size={17} /> Import student CSV
                  </button>
                  <a href="/sample-roster.csv" download>
                    <Download size={14} /> Download 20 fake students
                  </a>
                  <div className="csv-hint">
                    <span>name</span>
                    <span>
                      student_id <small>(optional)</small>
                    </span>
                  </div>
                </div>
              )}
            </section>
            <aside className="right-column">
              <section className="panel qr-panel">
                <div className="panel-heading">
                  <div>
                    <h2>
                      <QrCode size={19} /> Let students check in
                    </h2>
                    <p>One scan. And they’re on the list.</p>
                  </div>
                </div>
                <div className="qr-space">
                  {active && qr ? (
                    <img
                      src={qr}
                      width="220"
                      height="220"
                      alt="Scan this QR code to check in to the current attendance session"
                    />
                  ) : (
                    <div className="qr-placeholder">
                      <QrCode size={105} strokeWidth={1.2} />
                      <span>Your class QR goes here</span>
                    </div>
                  )}
                </div>
                <p className="qr-description">
                  {active
                    ? active.closed
                      ? "This session is closed. Start a new session for your next class."
                      : "Display this QR code so students can scan and sign themselves in."
                    : "Create a session to get a unique QR code for your class."}
                </p>
                {active ? (
                  <div className="qr-actions">
                    <button
                      className="secondary full"
                      onClick={() =>
                        copy(
                          `${location.origin}/?join=${active.id}`,
                          "Student check-in link copied.",
                        )
                      }
                    >
                      <Copy size={16} /> Copy check-in link
                    </button>
                    <a
                      className="text-button"
                      href={qr}
                      download={`rollcall-${active.id.slice(0, 8)}.png`}
                    >
                      <Download size={15} /> Download QR code
                    </a>
                    {!active.closed && (
                      <button
                        className="close-session"
                        disabled={busy}
                        onClick={closeSession}
                      >
                        Close check-in
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="qr-wait">
                    <Lock size={14} /> Available after CSV import
                  </div>
                )}
              </section>
              <div className="howto">
                <span className="eyebrow">YOUR NEXT CLASS, SIMPLIFIED</span>
                <div>
                  <span>1</span>
                  <p>
                    <strong>Import your roster</strong>Upload student names from
                    a CSV.
                  </p>
                </div>
                <div>
                  <span>2</span>
                  <p>
                    <strong>Share your QR code</strong>Put it on screen or share
                    the link.
                  </p>
                </div>
                <div>
                  <span>3</span>
                  <p>
                    <strong>Watch attendance arrive</strong>Check-ins appear
                    here automatically.
                  </p>
                </div>
              </div>
            </aside>
          </div>
          <footer>
            <CheckCheck size={15} /> More time for what matters.
            <span>Made for your classroom.</span>
          </footer>
        </div>
      </main>
      {modal && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setModal(false);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <button
              className="modal-close"
              aria-label="Close"
              disabled={busy}
              onClick={() => setModal(false)}
            >
              <X size={21} />
            </button>
            <span className="stat-icon blue">
              <ClipboardList size={24} />
            </span>
            <h2 id="modal-title">Let’s set up your class.</h2>
            <p>
              Name your class and import your roster once. It’s saved for next
              time.
            </p>
            <form onSubmit={create}>
              <label htmlFor="session-name">Class name</label>
              <input
                id="session-name"
                autoFocus
                placeholder="e.g. Biology 101"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={100}
              />
              <label>Student roster</label>
              <button
                type="button"
                className="dropzone"
                onClick={() => file.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  readFile(e.dataTransfer.files[0]);
                }}
              >
                <Upload size={27} />
                <strong>
                  {fileName || "Click to choose or drop your CSV"}
                </strong>
                <span>
                  {count
                    ? `${count} students ready to import`
                    : "CSV files up to 500 KB · Up to 1,000 students"}
                </span>
              </button>
              <input
                ref={file}
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(e) => readFile(e.target.files?.[0])}
              />
              <p className="csv-help">
                Use a <code>name</code> column, or <code>first_name</code> and{" "}
                <code>last_name</code>. Add <code>student_id</code> to
                distinguish students with the same name.
              </p>
              <a href="/sample-roster.csv" download className="sample-link">
                Download fake student CSV <ArrowUpRight size={14} />
              </a>
              {error && (
                <div className="error" role="alert">
                  {error}
                </div>
              )}
              <button
                className="primary full create-button"
                disabled={busy || !csv || !title.trim()}
              >
                {busy ? (
                  <>
                    <Loader2 size={17} className="spin" /> Creating session…
                  </>
                ) : (
                  <>
                    <Plus size={17} /> Create class & start attendance
                  </>
                )}
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
