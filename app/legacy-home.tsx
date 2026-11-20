"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpDown,
  ArrowUpRight,
  CalendarDays,
  Check,
  Clock,
  Copy,
  Download,
  Loader2,
  LogOut,
  Plus,
  QrCode,
  Search,
  ShieldAlert,
  ShieldCheck,
  Upload,
  UserCheck,
  UserCog,
  Users,
  UserX,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import ClassManager from "./class-manager";
import Papa from "papaparse";
import { parseRoster } from "../lib/roster.mjs";
import { startAttendancePolling } from "../lib/attendance-polling.mjs";
import {
  AttendanceProgressBar,
  AuthShowcase,
  Brand,
  ConfirmModal,
  EmptyWorkspaceStage,
  PasswordInput,
  ProjectorModal,
  ProjectQrButton,
  RosterPreview,
  StudentAvatar,
  type RosterFilter,
  type RosterSort,
} from "./ui-components";

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
  excused: Record<string, string>;
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
    [previewStudents, setPreviewStudents] = useState<
      { name: string; code: string }[]
    >([]),
    [count, setCount] = useState(0),
    [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState<RosterFilter>("all"),
    [sort, setSort] = useState<RosterSort>("roster"),
    [projectorOpen, setProjectorOpen] = useState(false),
    [confirmCloseOpen, setConfirmCloseOpen] = useState(false),
    [copiedLink, setCopiedLink] = useState(false),
    [qr, setQr] = useState("");
  const [publicInfo, setPublicInfo] = useState<{
      title: string;
      closed: boolean;
    } | null>(null),
    [identity, setIdentity] = useState(""),
    [success, setSuccess] = useState(""),
    [checkedAt, setCheckedAt] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [loginName, setLoginName] = useState(""),
    [password, setPassword] = useState("");
  const [legacyKey, setLegacyKey] = useState("");
  const [manager, setManager] = useState<"roster" | "teachers" | null>(null);
  const [excusing, setExcusing] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
    if (!username || !selected || selectedClosed || excusing) return;
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
  }, [username, selected, selectedClosed, excusing]);

  useEffect(() => {
    if (join)
      api(`?public=1&id=${encodeURIComponent(join)}`)
        .then(setPublicInfo)
        .catch((e) => setError(e.message));
  }, [join]);

  useEffect(() => {
    if (active)
      QRCode.toDataURL(`${location.origin}/?join=${active.id}`, {
        width: 720,
        margin: 2,
        color: { dark: "#111827", light: "#ffffff" },
        errorCorrectionLevel: "M",
      }).then(setQr);
  }, [active?.id]);

  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 4200);
      return () => clearTimeout(timer);
    }
  }, [notice]);

  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setModal(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal, busy]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (typing) return;
      if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (
        (e.key === "p" || e.key === "P") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        setProjectorOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  function loadParsedCsv(text: string, name: string) {
    const roster = parseRoster(text);
    setCsv(text);
    setCount(roster.length);
    setPreviewStudents(
      roster.slice(0, 5).map((s) => ({ name: s.name, code: s.code })),
    );
    setFileName(name);
    setError("");
  }

  async function readFile(f?: File) {
    if (!f) return;
    setError("");
    try {
      if (f.size > 500000) throw new Error("Choose a CSV smaller than 500 KB.");
      const text = await f.text();
      loadParsedCsv(text, f.name);
    } catch (e) {
      setError((e as Error).message);
      setCsv("");
      setCount(0);
      setPreviewStudents([]);
      setFileName("");
    }
  }

  async function useSampleRoster() {
    try {
      const r = await fetch("/sample-roster.csv");
      if (!r.ok) throw new Error("Unable to load sample roster.");
      const text = await r.text();
      loadParsedCsv(text, "sample-roster.csv");
      if (!title.trim()) setTitle("Demo Seminar 101");
    } catch (e) {
      setError((e as Error).message);
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
      setPreviewStudents([]);
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
      setCopiedLink(true);
      setNotice(message);
      setTimeout(() => setCopiedLink(false), 2200);
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
        Status: active.excused[s.id]
          ? "Excused"
          : active.attendance[s.id]
            ? "Present"
            : "Absent",
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
    if (!active) return;
    setBusy(true);
    try {
      await api("", { action: "close", id: active.id });
      setActive(await api(`?id=${active.id}`));
      setConfirmCloseOpen(false);
      setNotice("Check-in is now closed.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setExcused(student: Session["students"][number]) {
    if (!active || busy) return;
    const id = active.id,
      excused = !active.excused[student.id];
    setBusy(true);
    setExcusing(student.id);
    setError("");
    try {
      await api("", { action: "excuse", id, studentId: student.id, excused });
      const updated = await api(`?id=${id}`);
      setActive((current) => (current?.id === id ? updated : current));
      setNotice(
        excused
          ? `${student.name} is marked as excused.`
          : `Excused status removed for ${student.name}.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExcusing("");
      setBusy(false);
    }
  }

  async function checkin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api("", { action: "checkin", id: join, identity });
      setCheckedAt(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
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

  const present = active
      ? active.students.filter(
          (s) => active.attendance[s.id] && !active.excused[s.id],
        ).length
      : 0,
    excused = active
      ? active.students.filter((s) => active.excused[s.id]).length
      : 0,
    total = active?.students.length || 0,
    waiting = Math.max(0, total - present - excused);

  const filtered =
    active?.students
      .filter((s) => {
        const matchesQuery = `${s.name} ${s.code}`
          .toLowerCase()
          .includes(query.toLowerCase());
        if (!matchesQuery) return false;
        if (filter === "present")
          return Boolean(active.attendance[s.id] && !active.excused[s.id]);
        if (filter === "excused") return Boolean(active.excused[s.id]);
        if (filter === "waiting")
          return !active.excused[s.id] && !active.attendance[s.id];
        return true;
      })
      .sort((a, b) => {
        if (sort === "name") return a.name.localeCompare(b.name);
        if (sort === "time") {
          return (active.attendance[b.id] || "").localeCompare(
            active.attendance[a.id] || "",
          );
        }
        if (sort === "status") {
          const rank = (sid: string) =>
            active.excused[sid] ? 1 : active.attendance[sid] ? 0 : 2;
          return rank(a.id) - rank(b.id) || a.name.localeCompare(b.name);
        }
        return 0;
      }) || [];

  if (!ready)
    return (
      <div className="loading">
        <Loader2 size={18} className="spin" />
        <span>Opening Rollcall…</span>
      </div>
    );

  if (join)
    return (
      <main className="student-page">
        <div className="student-shell">
          <div className="student-header">
            <Brand size="md" />
            {publicInfo && (
              <span className={`badge ${publicInfo.closed ? "neutral" : ""}`}>
                <span />{" "}
                {publicInfo.closed ? "Check-in closed" : "Check-in open"}
              </span>
            )}
          </div>
          <section className="student-card">
            {success ? (
              <div className="checkin-receipt">
                <div className="success-icon">
                  <Check size={32} strokeWidth={2.5} />
                </div>
                <h1>You’re all set.</h1>
                <p className="receipt-greeting">{success}</p>
                <div className="receipt-details">
                  <div>
                    <span>Class</span>
                    <strong>{publicInfo?.title || "Class attendance"}</strong>
                  </div>
                  <div>
                    <span>Time</span>
                    <strong>
                      <Clock size={13} /> {checkedAt || "Now"}
                    </strong>
                  </div>
                </div>
                <p className="muted receipt-note">You can close this page.</p>
              </div>
            ) : (
              <>
                <h1>{publicInfo?.title || "Attendance"}</h1>
                {error && (
                  <div role="alert" className="error">
                    <ShieldAlert size={16} />
                    <span>{error}</span>
                  </div>
                )}
                {publicInfo?.closed ? (
                  <div className="closed-notice">
                    <p>Check-in is closed. Speak to your teacher if needed.</p>
                  </div>
                ) : publicInfo ? (
                  <form onSubmit={checkin} className="student-form">
                    <label htmlFor="identity">Full name or student ID</label>
                    <input
                      id="identity"
                      autoFocus
                      autoComplete="name"
                      value={identity}
                      onChange={(e) => setIdentity(e.target.value)}
                      required
                      maxLength={160}
                      placeholder="Alex Morgan or ID"
                    />
                    <button className="primary full btn-lg" disabled={busy}>
                      {busy ? (
                        <>
                          <Loader2 size={18} className="spin" /> Checking in…
                        </>
                      ) : (
                        <>
                          Check me in <Check size={18} />
                        </>
                      )}
                    </button>
                  </form>
                ) : !error ? (
                  <div className="student-loading">
                    <Loader2 size={18} className="spin" />
                    <span>Loading…</span>
                  </div>
                ) : null}
              </>
            )}
          </section>
        </div>
      </main>
    );

  if (!username)
    return (
      <main className="auth-layout">
        <AuthShowcase />
        <section className="auth-panel">
          <div className="auth-mobile-brand">
            <Brand size="md" />
          </div>
          <div className="student-card auth-card">
            <h1>{authMode === "login" ? "Sign in" : "Create account"}</h1>
            <div className="auth-tabs" role="tablist">
              <button
                type="button"
                className={authMode === "login" ? "selected" : ""}
                onClick={() => {
                  setAuthMode("login");
                  setError("");
                }}
              >
                Sign in
              </button>
              <button
                type="button"
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
                placeholder="Username"
              />
              <label htmlFor="password">Password</label>
              <PasswordInput
                id="password"
                autoComplete={
                  authMode === "signup" ? "new-password" : "current-password"
                }
                required
                minLength={10}
                maxLength={128}
                value={password}
                onChange={setPassword}
                placeholder="At least 10 characters"
                showStrength={authMode === "signup"}
              />
              {authMode === "signup" && (
                <p className="auth-help">
                  Password recovery isn’t available yet — save your login.
                </p>
              )}
              {error && (
                <div role="alert" className="error">
                  {error}
                </div>
              )}
              <button className="primary full btn-lg" disabled={busy}>
                {busy
                  ? "Please wait…"
                  : authMode === "signup"
                    ? "Create my workspace"
                    : "Sign in"}
              </button>
            </form>
            {legacyKey && (
              <p className="auth-help auth-legacy-note">
                Previous classes found on this browser. Sign in to import them.
              </p>
            )}
          </div>
        </section>
      </main>
    );

  const uniqueClasses = sessions.filter(
    (s, i, all) =>
      all.findIndex((x) => (x.classId || x.id) === (s.classId || s.id)) === i,
  );
  const dateLabel = active
    ? new Date(active.createdAt).toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : "";
  const joinUrl =
    active && typeof window !== "undefined"
      ? `${location.origin}/?join=${active.id}`
      : "";

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
        <div className="sidebar-brand-row">
          <Brand size="md" />
          <div className="mobile-profile">
            <StudentAvatar name={username} />
            <button
              type="button"
              className="mobile-signout"
              disabled={busy}
              onClick={signOut}
            >
              Sign out
            </button>
          </div>
        </div>
        <div className="session-label">
          <span>
            CLASSES{" "}
            {uniqueClasses.length > 0 && (
              <em className="class-count-pill">{uniqueClasses.length}</em>
            )}
          </span>
          <button
            type="button"
            className="sidebar-add-btn"
            aria-label="New class"
            onClick={() => setModal(true)}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="session-list">
          {uniqueClasses.map((s) => (
            <button
              key={s.id}
              type="button"
              className={
                (active?.classId || active?.id) === (s.classId || s.id)
                  ? "session selected"
                  : "session"
              }
              onClick={() => {
                setSelected(s.id);
                setActive(null);
                setQuery("");
                setFilter("all");
              }}
            >
              <span className="session-dot" aria-hidden="true" />
              <span className="session-meta">
                <strong>{s.title}</strong>
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
            <p className="sidebar-empty">No classes yet.</p>
          )}
        </div>
        <div className="teacher-access">
          <StudentAvatar name={username} />
          <div className="teacher-access-info">
            <strong title={username}>{username}</strong>
            <button type="button" disabled={busy} onClick={signOut}>
              <LogOut size={12} /> Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-crumbs">
            <span>Classes</span>
            {active && (
              <>
                <span className="breadcrumb">/</span>
                <strong className="topbar-current">{active.title}</strong>
              </>
            )}
          </div>
        </header>

        <div className="content">
          <div className="page-heading">
            <div>
              <h1>{active ? active.title : "Classes"}</h1>
              {active && <p>{total} students</p>}
            </div>
            <button
              type="button"
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
              <Check size={16} />
              <span>{notice}</span>
              <button
                type="button"
                aria-label="Dismiss notice"
                onClick={() => setNotice("")}
              >
                <X size={15} />
              </button>
            </div>
          )}

          {error && !modal && (
            <div className="error" role="alert">
              <span>{error}</span>
              <button
                type="button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
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
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={migrate}
              >
                Import existing classes
              </button>
            </div>
          )}

          {active ? (
            <>
              <div className="class-toolbar">
                <div className="history-picker">
                  <label htmlFor="session-history">
                    <CalendarDays size={13} /> Attendance history
                  </label>
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
                    type="button"
                    className="secondary"
                    onClick={() => setManager("roster")}
                  >
                    <Users size={15} /> Edit students
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setManager("teachers")}
                  >
                    <UserCog size={15} /> Teacher access
                  </button>
                  <button
                    type="button"
                    className="secondary accent-outline"
                    disabled={busy}
                    onClick={repeat}
                  >
                    <Plus size={16} /> Take attendance again
                  </button>
                </div>
              </div>

              <div className="stats">
                <button
                  type="button"
                  className={`stat stat-clickable ${filter === "all" ? "stat-active" : ""}`}
                  onClick={() => setFilter("all")}
                >
                  <span className="stat-icon blue">
                    <Users size={20} />
                  </span>
                  <div>
                    <span>Roster</span>
                    <strong>{total}</strong>
                  </div>
                </button>
                <button
                  type="button"
                  className={`stat stat-clickable ${filter === "present" ? "stat-active" : ""}`}
                  onClick={() =>
                    setFilter(filter === "present" ? "all" : "present")
                  }
                >
                  <span className="stat-icon green">
                    <UserCheck size={20} />
                  </span>
                  <div>
                    <span>Present</span>
                    <strong>
                      {present}
                      {total > 0 && (
                        <small>{Math.round((present / total) * 100)}%</small>
                      )}
                    </strong>
                  </div>
                </button>
                <button
                  type="button"
                  className={`stat stat-clickable ${filter === "waiting" ? "stat-active" : ""}`}
                  onClick={() =>
                    setFilter(filter === "waiting" ? "all" : "waiting")
                  }
                >
                  <span className="stat-icon orange">
                    {active.closed ? <UserX size={20} /> : <Clock size={20} />}
                  </span>
                  <div>
                    <span>{active.closed ? "Absent" : "Waiting"}</span>
                    <strong>{waiting}</strong>
                  </div>
                </button>
                <button
                  type="button"
                  className={`stat stat-clickable ${filter === "excused" ? "stat-active" : ""}`}
                  onClick={() =>
                    setFilter(filter === "excused" ? "all" : "excused")
                  }
                >
                  <span className="stat-icon excused">
                    <ShieldCheck size={20} />
                  </span>
                  <div>
                    <span>Excused</span>
                    <strong>{excused}</strong>
                  </div>
                </button>
              </div>

              <AttendanceProgressBar
                present={present}
                excused={excused}
                total={total}
                closed={active.closed}
              />

              <div className="dashboard-grid">
                <section className="panel roster-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>{active.title}</h2>
                      <p>{dateLabel}</p>
                    </div>
                    <div className="panel-heading-actions">
                      <span
                        className={"badge " + (active.closed ? "neutral" : "")}
                      >
                        <span /> {active.closed ? "Closed" : "Check-in open"}
                      </span>
                      <button
                        type="button"
                        className="secondary compact"
                        onClick={exportCsv}
                      >
                        <Download size={15} /> Export
                      </button>
                    </div>
                  </div>
                  <div className="roster-tools">
                    <div className="search">
                      <Search size={15} />
                      <input
                        ref={searchInputRef}
                        aria-label="Search students"
                        placeholder="Search students or ID…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      {query ? (
                        <button
                          type="button"
                          className="search-clear"
                          aria-label="Clear search"
                          onClick={() => setQuery("")}
                        >
                          <X size={13} />
                        </button>
                      ) : (
                        <kbd className="search-kbd">/</kbd>
                      )}
                    </div>
                    <div className="roster-controls-right">
                      <div
                        className="filter-pills"
                        role="group"
                        aria-label="Filter by status"
                      >
                        {(
                          [
                            ["all", "All", total],
                            ["present", "Present", present],
                            [
                              "waiting",
                              active.closed ? "Absent" : "Waiting",
                              waiting,
                            ],
                            ["excused", "Excused", excused],
                          ] as const
                        ).map(([key, label, num]) => (
                          <button
                            key={key}
                            type="button"
                            className={`filter-pill ${filter === key ? "active" : ""}`}
                            onClick={() => setFilter(key)}
                          >
                            {label} <span>{num}</span>
                          </button>
                        ))}
                      </div>
                      <label className="sort-control" aria-label="Sort students">
                        <ArrowUpDown size={13} />
                        <select
                          aria-label="Sort students"
                          value={sort}
                          onChange={(e) =>
                            setSort(e.target.value as RosterSort)
                          }
                        >
                          <option value="roster">Roster order</option>
                          <option value="name">Name A–Z</option>
                          <option value="time">Latest check-in</option>
                          <option value="status">By status</option>
                        </select>
                      </label>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>STUDENT</th>
                          <th>STATUS</th>
                          <th>CHECK-IN TIME</th>
                          <th className="th-right">ACTIONS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((s) => {
                          const isExcused = Boolean(active.excused[s.id]);
                          const isPresent = Boolean(
                            active.attendance[s.id] && !isExcused,
                          );
                          return (
                            <tr key={s.id}>
                              <td>
                                <div className="student-name">
                                  <StudentAvatar name={s.name} />
                                  <div>
                                    <strong>{s.name}</strong>
                                    {s.code && <small>{s.code}</small>}
                                  </div>
                                </div>
                              </td>
                              <td>
                                <span
                                  className={
                                    isExcused
                                      ? "status excused"
                                      : isPresent
                                        ? "status present"
                                        : active.closed
                                          ? "status absent"
                                          : "status"
                                  }
                                >
                                  {isExcused ? (
                                    <ShieldCheck size={12} />
                                  ) : isPresent ? (
                                    <Check size={12} />
                                  ) : null}
                                  {isExcused
                                    ? "Excused"
                                    : isPresent
                                      ? "Present"
                                      : active.closed
                                        ? "Absent"
                                        : "Waiting"}
                                </span>
                              </td>
                              <td className="time-cell">
                                {active.attendance[s.id]
                                  ? new Date(
                                      active.attendance[s.id],
                                    ).toLocaleTimeString([], {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })
                                  : "—"}
                              </td>
                              <td className="action-cell">
                                <button
                                  type="button"
                                  className={`secondary compact excuse-action ${isExcused ? "is-excused" : ""}`}
                                  disabled={busy}
                                  onClick={() => setExcused(s)}
                                  aria-label={
                                    isExcused
                                      ? `Undo excused status for ${s.name}`
                                      : `Mark ${s.name} as excused`
                                  }
                                >
                                  {excusing === s.id ? (
                                    <Loader2 size={13} className="spin" />
                                  ) : null}
                                  {isExcused ? "Undo excused" : "Mark excused"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {!filtered.length && (
                      <div className="no-results">
                        <p>No students match your current search or filter.</p>
                        {(query || filter !== "all") && (
                          <button
                            type="button"
                            className="secondary compact"
                            onClick={() => {
                              setQuery("");
                              setFilter("all");
                            }}
                          >
                            Reset filters
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="table-footer">
                    <span>
                      Showing {filtered.length} of {total} students
                    </span>
                    <span className="footer-live">
                      {!active.closed && <i className="pulse-dot" />}
                      {active.closed
                        ? "Session closed"
                        : "Updates every 30 seconds"}
                    </span>
                  </div>
                </section>

                <aside className="right-column">
                  <section className="panel qr-panel">
                    <div className="panel-heading">
                      <h2>
                        <QrCode size={17} /> Check-in QR
                      </h2>
                    </div>
                    <div className="qr-stage-box">
                      <button
                        type="button"
                        className="qr-space qr-space-interactive"
                        aria-label="Open full-screen QR projection mode"
                        onClick={() => setProjectorOpen(true)}
                      >
                        {qr ? (
                          <img
                            src={qr}
                            width="220"
                            height="220"
                            alt="Scan this QR code to check in to the current attendance session"
                          />
                        ) : (
                          <div className="qr-placeholder">
                            <QrCode size={96} strokeWidth={1.2} />
                          </div>
                        )}
                      </button>
                    </div>
                    {active.closed && (
                      <p className="qr-description">
                        Check-in closed for this session.
                      </p>
                    )}
                    <div className="qr-actions">
                      <ProjectQrButton
                        onClick={() => setProjectorOpen(true)}
                      />
                      <button
                        type="button"
                        className="secondary full"
                        onClick={() =>
                          copy(
                            `${location.origin}/?join=${active.id}`,
                            "Student check-in link copied.",
                          )
                        }
                      >
                        {copiedLink ? <Check size={15} /> : <Copy size={15} />}
                        Copy check-in link
                      </button>
                      <a
                        className="text-button"
                        href={qr}
                        download={`rollcall-${active.id.slice(0, 8)}.png`}
                      >
                        <Download size={14} /> Download QR code
                      </a>
                      {!active.closed && (
                        <button
                          type="button"
                          className="close-session"
                          disabled={busy}
                          onClick={() => setConfirmCloseOpen(true)}
                        >
                          Close check-in
                        </button>
                      )}
                    </div>
                  </section>
                </aside>
              </div>

              <ProjectorModal
                open={projectorOpen}
                onClose={() => setProjectorOpen(false)}
                title={active.title}
                dateLabel={dateLabel}
                qr={qr}
                joinUrl={joinUrl}
                present={present}
                excused={excused}
                total={total}
                closed={active.closed}
                onCopy={() =>
                  void copy(
                    `${location.origin}/?join=${active.id}`,
                    "Student check-in link copied.",
                  )
                }
                downloadName={`rollcall-${active.id.slice(0, 8)}.png`}
              />

              <ConfirmModal
                open={confirmCloseOpen}
                title="Close check-in?"
                description="Students won’t be able to check in anymore. You can still mark excuses or export CSV."
                confirmLabel="Close check-in"
                tone="danger"
                busy={busy}
                onConfirm={() => void closeSession()}
                onCancel={() => setConfirmCloseOpen(false)}
              />
            </>
          ) : (
            <EmptyWorkspaceStage
              onImport={() => {
                setError("");
                setModal(true);
              }}
            />
          )}
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
              type="button"
              className="modal-close"
              aria-label="Close"
              disabled={busy}
              onClick={() => setModal(false)}
            >
              <X size={19} />
            </button>
            <h2 id="modal-title">New class</h2>
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
              <div className="roster-label-row">
                <label htmlFor="roster-file">Student roster</label>
                <button
                  type="button"
                  className="inline-link-btn"
                  onClick={() => void useSampleRoster()}
                >
                  Load sample CSV
                </button>
              </div>
              <button
                type="button"
                className={`dropzone ${dragging ? "dragging" : ""} ${count ? "loaded" : ""}`}
                onClick={() => file.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  void readFile(e.dataTransfer.files[0]);
                }}
              >
                <Upload size={22} />
                <strong>{fileName || "Choose or drop CSV"}</strong>
                <span>
                  {count
                    ? `${count} students ready`
                    : "Up to 500 KB · 1,000 students"}
                </span>
              </button>
              <input
                ref={file}
                id="roster-file"
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(e) => void readFile(e.target.files?.[0])}
              />
              <RosterPreview students={previewStudents} total={count} />
              <p className="csv-help">
                Columns: <code>name</code> (or <code>first_name</code>,{" "}
                <code>last_name</code>) and optional <code>student_id</code>.
              </p>
              <a href="/sample-roster.csv" download className="sample-link">
                Download sample CSV <ArrowUpRight size={14} />
              </a>
              {error && (
                <div className="error" role="alert">
                  {error}
                </div>
              )}
              <button
                className="primary full create-button btn-lg"
                disabled={busy || !csv || !title.trim()}
              >
                {busy ? (
                  <>
                    <Loader2 size={17} className="spin" /> Creating session…
                  </>
                ) : (
                  <>
                    <Plus size={17} /> Create class &amp; start attendance
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
