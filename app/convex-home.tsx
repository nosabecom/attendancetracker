"use client";
import {
  Component,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useConvex,
  useConvexAuth,
  useConvexConnectionState,
  useMutation,
  usePaginatedQuery,
  useQueries,
  useQuery,
} from "convex/react";
import { useAuthActions, useAuthToken } from "@convex-dev/auth/react";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import {
  ArrowUpDown,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCheck,
  ClipboardList,
  Clock,
  Copy,
  Download,
  Loader2,
  Lock,
  LogOut,
  Plus,
  QrCode,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  UserCheck,
  UserCog,
  Users,
  UserX,
  WifiOff,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import Papa from "papaparse";
import { parseRoster } from "../lib/roster.mjs";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import ConvexClassManager from "./convex-class-manager";
import { verifiedLogout } from "../lib/convex-logout.mjs";
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

export function accessError(e: unknown) {
  const data = e instanceof ConvexError ? e.data : null;
  return (
    !!data && typeof data === "object" && [401, 403, 404].includes(data.status)
  );
}
export const newId = () => crypto.randomUUID().replaceAll("-", "");
export function errorMessage(e: unknown) {
  const data = e instanceof ConvexError ? e.data : null;
  return data && typeof data === "object" && typeof data.message === "string"
    ? data.message
    : "Something went wrong. Please try again.";
}

const SessionDeadline = createContext(0);
const claim = makeFunctionReference<
  "mutation",
  { legacyKey: string },
  { ownerKey: string }
>("legacy:claim");
const claimStatus = makeFunctionReference<
  "query",
  { ownerKey: string },
  { complete: boolean }
>("legacy:claimStatus");

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="student-page">
        <div className="student-shell">
          <div className="student-header">
            <Brand size="md" />
          </div>
          <section className="student-card">
            <span className="eyebrow">SESSION NOTICE</span>
            <h1>Workspace unavailable</h1>
            <p>
              Your session or access may have changed. Please sign in again.
            </p>
            <button
              className="primary full"
              onClick={() => location.reload()}
            >
              Continue
            </button>
          </section>
        </div>
      </main>
    ) : (
      this.props.children
    );
  }
}

export default function ConvexHome() {
  const { isLoading, isAuthenticated, isRefreshing } = useConvexAuth();
  const { signIn } = useAuthActions();
  const [mode, setMode] = useState<"login" | "signup">("login"),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [visible, setVisible] = useState(false),
    [legacyKey, setLegacyKey] = useState("");

  useEffect(() => {
    const hash = new URLSearchParams(location.hash.slice(1)).get("teacher");
    const old =
      hash && /^[a-f0-9]{64}$/.test(hash)
        ? hash
        : localStorage.getItem("rollcall-key");
    if (old && /^[a-f0-9]{64}$/.test(old)) {
      setLegacyKey(old);
      localStorage.setItem("rollcall-key", old);
    }
    if (hash)
      history.replaceState(null, "", location.pathname + location.search);
    setVisible(!document.hidden);
    const change = () => {
      if (document.hidden) setVisible(false);
      else location.reload();
    };
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);

  async function authenticate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signIn("credentials", { operation: mode, username, password });
      setPassword("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!visible || isLoading || isRefreshing)
    return (
      <div className="loading">
        <Loader2 size={18} className="spin" />
        <span>Opening Rollcall…</span>
      </div>
    );

  if (!isAuthenticated)
    return (
      <main className="auth-layout">
        <AuthShowcase />
        <section className="auth-panel">
          <div className="auth-mobile-brand">
            <Brand size="md" />
          </div>
          <div className="student-card auth-card">
            <span className="eyebrow">YOUR TEACHER WORKSPACE</span>
            <h1>
              {mode === "login"
                ? "Welcome back."
                : "Make room for your classes."}
            </h1>
            <p>
              {mode === "login"
                ? "Sign in to find your saved classes and live attendance."
                : "Create an account to keep your rosters in your own private workspace."}
            </p>
            <div className="auth-tabs" role="tablist">
              <button
                type="button"
                className={mode === "login" ? "selected" : ""}
                onClick={() => {
                  setMode("login");
                  setError("");
                }}
              >
                Sign in
              </button>
              <button
                type="button"
                className={mode === "signup" ? "selected" : ""}
                onClick={() => {
                  setMode("signup");
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
                pattern="[A-Za-z0-9._\-]{3,40}"
                placeholder="e.g. prof.morgan"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <label htmlFor="password">Password</label>
              <PasswordInput
                id="password"
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                required
                minLength={10}
                maxLength={128}
                placeholder="At least 10 characters"
                value={password}
                onChange={setPassword}
                showStrength={mode === "signup"}
              />
              {mode === "signup" && (
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
              <button className="primary full btn-lg" disabled={busy}>
                {busy ? (
                  <>
                    <Loader2 size={17} className="spin" /> Please wait…
                  </>
                ) : mode === "signup" ? (
                  "Create my workspace"
                ) : (
                  "Sign in"
                )}
              </button>
            </form>
            {legacyKey && (
              <p className="auth-help auth-legacy-note">
                Your previous workspace is on this browser. After signing in,
                you can import its classes.
              </p>
            )}
          </div>
          <span className="student-footer">
            A little less admin. A little more teaching.
          </span>
        </section>
      </main>
    );

  return (
    <Boundary>
      <Viewer legacyKey={legacyKey} clearLegacy={() => setLegacyKey("")} />
    </Boundary>
  );
}

function Viewer({
  legacyKey,
  clearLegacy,
}: {
  legacyKey: string;
  clearLegacy: () => void;
}) {
  const [expired, setExpired] = useState(false),
    [signingOut, setSigningOut] = useState(false),
    [logoutError, setLogoutError] = useState(""),
    [verifiedToken, setVerifiedToken] = useState<string | null>(null),
    [verificationFailed, setVerificationFailed] = useState(false);
  const token = useAuthToken();
  const connection = useConvexConnectionState();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const offline = () => setOnline(false);
    const reconnect = () => location.reload();
    window.addEventListener("offline", offline);
    window.addEventListener("online", reconnect);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", reconnect);
    };
  }, []);

  useEffect(() => {
    if (connection.isWebSocketConnected && connection.connectionCount > 1)
      location.reload();
  }, [connection.isWebSocketConnected, connection.connectionCount]);

  const connected =
    online &&
    connection.isWebSocketConnected &&
    connection.connectionCount === 1;

  async function leave() {
    setSigningOut(true);
    setLogoutError("");
    try {
      await verifiedLogout();
    } catch {
      setLogoutError("Unable to sign out. Please try again.");
      setSigningOut(false);
    }
  }

  useEffect(() => {
    if (!token || !connected) return;
    let active = true;
    const http = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    http.setAuth(token);
    http
      .query(api.attendance.viewer, {})
      .then(() => {
        if (active) setVerifiedToken(token);
      })
      .catch((error) => {
        if (!active) return;
        if (error?.data?.status === 401) {
          setExpired(true);
          void leave();
        } else setVerificationFailed(true);
      });
    return () => {
      active = false;
    };
  }, [token, connected]);

  const viewer = useQuery(
    api.attendance.viewer,
    expired || signingOut || !connected || !token || verifiedToken !== token
      ? "skip"
      : {},
  );

  useEffect(() => {
    if (!viewer) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const ms = viewer.expiresAt - Date.now();
      if (ms <= 0) setExpired(true);
      else timer = setTimeout(schedule, Math.min(ms, 2147483647));
    };
    schedule();
    return () => clearTimeout(timer);
  }, [viewer]);

  if (verificationFailed) throw new Error("Authentication check failed");
  if (signingOut)
    return (
      <div className="loading">
        <Loader2 size={18} className="spin" />
        <span>Signing out…</span>
      </div>
    );
  if (logoutError)
    return (
      <main className="student-page">
        <div className="student-shell">
          <div className="student-header">
            <Brand size="md" />
          </div>
          <section className="student-card">
            <span className="eyebrow">SIGN-OUT STATUS</span>
            <h1>Sign-out did not finish</h1>
            <p role="alert">{logoutError}</p>
            <button className="primary full" onClick={() => void leave()}>
              Try again
            </button>
          </section>
        </div>
      </main>
    );
  if (expired)
    return (
      <main className="student-page">
        <div className="student-shell">
          <div className="student-header">
            <Brand size="md" />
          </div>
          <section className="student-card">
            <span className="eyebrow">SESSION NOTICE</span>
            <h1>Session expired</h1>
            <p>Please sign in again.</p>
            <button className="primary full" onClick={() => void leave()}>
              Sign in
            </button>
          </section>
        </div>
      </main>
    );
  if (!connected)
    return (
      <main className="student-page">
        <div className="student-shell">
          <div className="student-header">
            <Brand size="md" />
          </div>
          <section className="student-card">
            <div className="reconnect-icon">
              <WifiOff size={26} />
            </div>
            <h1>Reconnecting…</h1>
            <p>
              Attendance will reopen with fresh data when your connection
              returns.
            </p>
          </section>
        </div>
      </main>
    );
  if (!viewer)
    return (
      <div className="loading">
        <Loader2 size={18} className="spin" />
        <span>Opening Rollcall…</span>
      </div>
    );

  return (
    <SessionDeadline.Provider value={viewer.expiresAt}>
      <Workspace
        username={viewer.username}
        legacyKey={legacyKey}
        clearLegacy={clearLegacy}
        onSignOut={leave}
      />
    </SessionDeadline.Provider>
  );
}

function Workspace({
  username,
  legacyKey,
  clearLegacy,
  onSignOut,
}: {
  username: string;
  legacyKey: string;
  clearLegacy: () => void;
  onSignOut: () => Promise<void>;
}) {
  const classes = usePaginatedQuery(
    api.attendance.classes,
    {},
    { initialNumItems: 25 },
  );
  const create = useMutation(api.attendance.create),
    legacyClaim = useMutation(claim);
  const [fatal, setFatal] = useState(false);
  const [selectedClass, setSelectedClass] = useState<Id<"classes"> | null>(
      null,
    ),
    [classFilter, setClassFilter] = useState(""),
    [modal, setModal] = useState(false),
    [title, setTitle] = useState(""),
    [csv, setCsv] = useState(""),
    [fileName, setFileName] = useState(""),
    [previewStudents, setPreviewStudents] = useState<
      { name: string; code: string }[]
    >([]),
    [count, setCount] = useState(0),
    [dragging, setDragging] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const status = useQuery(
    claimStatus,
    pending ? { ownerKey: pending } : "skip",
  );

  useEffect(() => {
    if (status?.complete) {
      localStorage.removeItem("rollcall-key");
      clearLegacy();
      setPending("");
    }
  }, [status, clearLegacy]);

  useEffect(() => {
    if (!selectedClass && classes.results.length)
      setSelectedClass(classes.results[0].classId);
  }, [classes.results, selectedClass]);

  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setModal(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal, busy]);

  if (fatal) throw new Error("Access changed");

  function loadParsedCsv(text: string, name: string) {
    const parsed = parseRoster(text);
    setCount(parsed.length);
    setPreviewStudents(
      parsed.slice(0, 5).map((s) => ({ name: s.name, code: s.code })),
    );
    setCsv(text);
    setFileName(name);
    setError("");
  }

  async function readFile(f?: File) {
    if (!f) return;
    try {
      if (f.size > 500000) throw new Error("Choose a CSV smaller than 500 KB.");
      const text = await f.text();
      loadParsedCsv(text, f.name);
    } catch (e) {
      setCsv("");
      setCount(0);
      setPreviewStudents([]);
      setFileName("");
      setError(e instanceof Error ? e.message : "Invalid CSV.");
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
      setError(e instanceof Error ? e.message : "Unable to load sample CSV.");
    }
  }

  async function createClass(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await create({ newId: newId(), title, csv });
      setSelectedClass(result.classId);
      setModal(false);
      setCsv("");
      setTitle("");
      setFileName("");
      setPreviewStudents([]);
      setCount(0);
    } catch (e) {
      if (accessError(e)) setFatal(true);
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function migrate() {
    setBusy(true);
    setError("");
    try {
      const result = await legacyClaim({ legacyKey });
      setPending(result.ownerKey);
    } catch (e) {
      if (accessError(e)) setFatal(true);
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const activeClass = classes.results.find((c) => c.classId === selectedClass);
  const visibleClasses = classFilter.trim()
    ? classes.results.filter((c) =>
        c.title.toLowerCase().includes(classFilter.trim().toLowerCase()),
      )
    : classes.results;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-brand-row">
          <Brand size="md" />
          <div className="mobile-profile">
            <StudentAvatar name={username} />
            <button
              type="button"
              className="mobile-signout"
              onClick={() => void onSignOut()}
            >
              Sign out
            </button>
          </div>
        </div>

        <div className="workspace-label">TEACHER WORKSPACE</div>
        <div className="nav-active">
          <ClipboardList size={18} /> Attendance
        </div>

        <div className="session-label">
          <span>
            YOUR CLASSES{" "}
            {classes.results.length > 0 && (
              <em className="class-count-pill">{classes.results.length}</em>
            )}
          </span>
          <button
            type="button"
            className="sidebar-add-btn"
            aria-label="New class"
            onClick={() => {
              setError("");
              setModal(true);
            }}
          >
            <Plus size={15} />
          </button>
        </div>

        {classes.results.length > 5 && (
          <div className="sidebar-search">
            <Search size={14} />
            <input
              aria-label="Filter classes"
              placeholder="Find a class…"
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
            />
          </div>
        )}

        <div className="session-list">
          {visibleClasses.map((c) => (
            <button
              key={c.classId}
              type="button"
              className={
                selectedClass === c.classId ? "session selected" : "session"
              }
              onClick={() => setSelectedClass(c.classId)}
            >
              <span className="session-dot" aria-hidden="true" />
              <span className="session-meta">
                <strong>{c.title}</strong>
                <small>{c.count} students</small>
              </span>
            </button>
          ))}
          {classes.status === "CanLoadMore" && (
            <button
              type="button"
              className="secondary compact full"
              onClick={() => classes.loadMore(25)}
            >
              Load more classes
            </button>
          )}
          {classes.status === "Exhausted" && !classes.results.length && (
            <p className="sidebar-empty">
              Your saved classes will appear here after your first CSV import.
            </p>
          )}
        </div>

        <div className="teacher-access">
          <StudentAvatar name={username} />
          <div className="teacher-access-info">
            <strong title={username}>{username}</strong>
            <button type="button" onClick={() => void onSignOut()}>
              <LogOut size={12} /> Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-crumbs">
            <span>Workspace</span>
            <span className="breadcrumb">/</span>
            <span>Attendance</span>
            {activeClass && (
              <>
                <span className="breadcrumb">/</span>
                <strong className="topbar-current">{activeClass.title}</strong>
              </>
            )}
          </div>
          <span className="header-note">
            <Lock size={13} /> Private workspace
          </span>
        </header>

        <div className="content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">LESS ADMIN, MORE TEACHING</span>
              <h1>{activeClass ? activeClass.title : "Attendance"}</h1>
              <p>
                {activeClass
                  ? `${activeClass.count} students on saved roster · Real-time check-in ready`
                  : "Everyone accounted for. All in one place."}
              </p>
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
                disabled={busy || !!pending}
                onClick={migrate}
              >
                {pending ? "Importing…" : "Import existing classes"}
              </button>
            </div>
          )}

          {selectedClass ? (
            <ClassView key={selectedClass} classId={selectedClass} />
          ) : (
            <EmptyWorkspaceStage
              onImport={() => {
                setError("");
                setModal(true);
              }}
            />
          )}

          <footer className="app-footer">
            <CheckCheck size={15} /> More time for what matters.
            <span>Made for calm classrooms.</span>
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
            aria-labelledby="new-class-title"
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
            <span className="stat-icon blue">
              <ClipboardList size={21} />
            </span>
            <h2 id="new-class-title">Let’s set up your class.</h2>
            <p>
              Name your class and import your roster once. It’s saved so every
              future session takes one click.
            </p>
            <form onSubmit={createClass}>
              <label htmlFor="session-name">Class name</label>
              <input
                id="session-name"
                autoFocus
                required
                maxLength={100}
                placeholder="e.g. Biology 101 · Section A"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <div className="roster-label-row">
                <label htmlFor="roster-file">Student roster</label>
                <button
                  type="button"
                  className="inline-link-btn"
                  onClick={() => void useSampleRoster()}
                >
                  <Sparkles size={13} /> Load 20 sample students
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
                <Upload size={25} />
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
                id="roster-file"
                hidden
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => void readFile(e.target.files?.[0])}
              />
              <RosterPreview students={previewStudents} total={count} />
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

function ClassView({ classId }: { classId: Id<"classes"> }) {
  const history = usePaginatedQuery(
    api.attendance.history,
    { classId },
    { initialNumItems: 25 },
  );
  const [selected, setSelected] = useState(""),
    [manager, setManager] = useState<"roster" | "teachers" | null>(null),
    [error, setError] = useState(""),
    [startingNew, setStartingNew] = useState(false),
    [fatal, setFatal] = useState(false);
  const repeat = useMutation(api.attendance.repeat);

  useEffect(() => {
    if (!selected && history.results.length) setSelected(history.results[0].id);
  }, [history.results, selected]);

  if (fatal) throw new Error("Access changed");

  async function startAgain() {
    if (!selected || startingNew) return;
    setStartingNew(true);
    try {
      const r = await repeat({ legacyId: selected, newId: newId() });
      setSelected(r.id);
      setError("");
    } catch (e) {
      if (accessError(e)) setFatal(true);
      else setError(errorMessage(e));
    } finally {
      setStartingNew(false);
    }
  }

  return (
    <>
      {manager && (
        <ConvexClassManager
          classId={classId}
          mode={manager}
          onClose={() => setManager(null)}
        />
      )}
      <div className="class-toolbar">
        <div className="history-picker">
          <label htmlFor="session-history">
            <CalendarDays size={13} /> Attendance history
          </label>
          <div className="history-controls">
            <select
              id="session-history"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {selected && !history.results.some((s) => s.id === selected) && (
                <option value={selected}>New session</option>
              )}
              {history.results.map((s) => (
                <option value={s.id} key={s.id}>
                  {new Date(s.createdAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </option>
              ))}
            </select>
            {history.status === "CanLoadMore" && (
              <button
                type="button"
                className="secondary compact"
                onClick={() => history.loadMore(25)}
              >
                Load more history
              </button>
            )}
          </div>
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
            disabled={!selected || startingNew}
            onClick={startAgain}
          >
            {startingNew ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <Plus size={16} />
            )}{" "}
            Take attendance again
          </button>
        </div>
      </div>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {selected ? (
        <SessionView key={selected} id={selected} />
      ) : (
        <div className="session-skeleton">
          <Loader2 size={18} className="spin" />
          <span>Loading attendance history…</span>
        </div>
      )}
    </>
  );
}

type Fact = { studentId: string; checkedInAt?: string; excusedAt?: string };

function SessionView({ id }: { id: string }) {
  const convex = useConvex();
  const expiresAt = useContext(SessionDeadline);
  const token = useAuthToken();
  const exportRequest = useRef<AbortController | null>(null);
  const exportState = useRef({ active: true, token, id });
  exportState.current.token = token;
  exportState.current.id = id;
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    exportState.current.active = true;
    return () => {
      exportState.current.active = false;
      exportRequest.current?.abort();
    };
  }, []);

  const session = useQuery(api.attendance.session, { legacyId: id }),
    roster = useQuery(api.attendance.roster, { legacyId: id });
  const bucketQueries = useMemo(
    () =>
      Object.fromEntries(
        Array.from({ length: session?.bucketCount ?? 0 }, (_, bucket) => [
          String(bucket),
          { query: api.attendance.bucket, args: { legacyId: id, bucket } },
        ]),
      ),
    [id, session?.bucketCount],
  );
  const buckets = useQueries(bucketQueries);
  const close = useMutation(api.attendance.close),
    excuse = useMutation(api.attendance.excuse);

  const [qr, setQr] = useState(""),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState<RosterFilter>("all"),
    [sort, setSort] = useState<RosterSort>("roster"),
    [projectorOpen, setProjectorOpen] = useState(false),
    [confirmCloseOpen, setConfirmCloseOpen] = useState(false),
    [copiedLink, setCopiedLink] = useState(false),
    [excusingId, setExcusingId] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [fatal, setFatal] = useState(false);

  const joinUrl =
    typeof window !== "undefined" ? `${location.origin}/?join=${id}` : "";

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(`${location.origin}/?join=${id}`, {
      width: 720,
      margin: 2,
      color: { dark: "#111827", light: "#ffffff" },
      errorCorrectionLevel: "M",
    }).then((value) => {
      if (active) setQr(value);
    });
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4200);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
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
  }, []);

  if (fatal) throw new Error("Access changed");
  for (const value of Object.values(buckets))
    if (value instanceof Error) throw value;

  const ready =
    !!session &&
    !!roster &&
    Object.keys(bucketQueries).every((k) => buckets[k] !== undefined);
  const facts = new Map<string, Fact>();
  if (ready)
    for (const values of Object.values(buckets) as Fact[][])
      for (const row of values) facts.set(row.studentId, row);

  const present = ready
      ? roster.filter(
          (s) => facts.get(s.id)?.checkedInAt && !facts.get(s.id)?.excusedAt,
        ).length
      : 0,
    excused = ready
      ? roster.filter((s) => facts.get(s.id)?.excusedAt).length
      : 0,
    total = ready ? roster.length : 0,
    waiting = Math.max(0, total - present - excused);

  const filtered = ready
    ? roster
        .filter((s) => {
          const matchesQuery = `${s.name} ${s.code}`
            .toLowerCase()
            .includes(search.toLowerCase());
          if (!matchesQuery) return false;
          const fact = facts.get(s.id);
          if (filter === "present")
            return Boolean(fact?.checkedInAt && !fact?.excusedAt);
          if (filter === "excused") return Boolean(fact?.excusedAt);
          if (filter === "waiting")
            return !fact?.excusedAt && !fact?.checkedInAt;
          return true;
        })
        .sort((a, b) => {
          if (sort === "name") return a.name.localeCompare(b.name);
          if (sort === "time") {
            const ta = facts.get(a.id)?.checkedInAt || "";
            const tb = facts.get(b.id)?.checkedInAt || "";
            return tb.localeCompare(ta);
          }
          if (sort === "status") {
            const rank = (sid: string) => {
              const f = facts.get(sid);
              if (f?.excusedAt) return 1;
              if (f?.checkedInAt) return 0;
              return 2;
            };
            return rank(a.id) - rank(b.id) || a.name.localeCompare(b.name);
          }
          return 0;
        })
    : [];

  async function run(
    action: "close" | "excuse",
    studentId = "",
    excusedFlag = false,
  ) {
    setBusy(true);
    if (action === "excuse") setExcusingId(studentId);
    setError("");
    try {
      if (action === "close") {
        await close({ legacyId: id });
        setConfirmCloseOpen(false);
        setNotice("Check-in is now closed for this session.");
      } else {
        await excuse({ legacyId: id, studentId, excused: excusedFlag });
      }
    } catch (e) {
      if (accessError(e)) setFatal(true);
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
      setExcusingId("");
    }
  }

  async function copyJoinLink() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/?join=${id}`);
      setCopiedLink(true);
      setNotice("Student check-in link copied.");
      setTimeout(() => setCopiedLink(false), 2200);
    } catch {
      setError("Clipboard unavailable.");
    }
  }

  function exportAllowed() {
    const current = convex.connectionState();
    return (
      exportState.current.active &&
      exportState.current.id === id &&
      !!token &&
      exportState.current.token === token &&
      ready &&
      !document.hidden &&
      navigator.onLine &&
      current.isWebSocketConnected &&
      current.connectionCount === 1 &&
      Number.isSafeInteger(expiresAt) &&
      expiresAt > Date.now()
    );
  }

  async function exportCsv() {
    if (!exportAllowed() || exportRequest.current) return;
    const controller = new AbortController();
    exportRequest.current = controller;
    setExporting(true);
    setError("");
    try {
      const http = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!, {
        logger: false,
        fetch: (input, init) =>
          globalThis.fetch(input, {
            ...init,
            signal: controller.signal,
            redirect: "error",
          }),
      });
      http.setAuth(token!);
      const snapshot = await http.query(api.attendance.exportSnapshot, {
        legacyId: id,
      });
      // The async boundary also lets the SDK finish a pending socket close.
      // Recheck mount, account/session, selection and connection after the read.
      if (
        controller.signal.aborted ||
        exportRequest.current !== controller ||
        !exportAllowed()
      )
        return;
      const output = Papa.unparse(
        snapshot.rows.map((row) => ({
          Name: row.name,
          "Student ID": row.code,
          Status: row.excused
            ? "Excused"
            : row.checkedInAt
              ? "Present"
              : "Absent",
          "Check-in time": row.checkedInAt || "",
          Session: snapshot.title,
        })),
        { escapeFormulae: true },
      );
      const url = URL.createObjectURL(
        new Blob([output], { type: "text/csv;charset=utf-8;" }),
      );
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = `attendance-${id.slice(0, 8)}.csv`;
        a.click();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      if (!controller.signal.aborted && exportState.current.active) {
        if (accessError(error)) setFatal(true);
        else setError("Export did not finish. Please try again.");
      }
    } finally {
      if (exportRequest.current === controller) {
        exportRequest.current = null;
        if (exportState.current.active) setExporting(false);
      }
    }
  }

  if (!ready)
    return (
      <div className="session-skeleton">
        <Loader2 size={18} className="spin" />
        <span>Loading attendance…</span>
      </div>
    );

  const dateLabel = new Date(session.createdAt).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const presentPct = total ? Math.round((present / total) * 100) : 0;

  return (
    <>
      {error && (
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
            <span>Students on roster</span>
            <strong>
              {total}
              <small>in this session</small>
            </strong>
          </div>
        </button>

        <button
          type="button"
          className={`stat stat-clickable ${filter === "present" ? "stat-active" : ""}`}
          onClick={() => setFilter(filter === "present" ? "all" : "present")}
        >
          <span className="stat-icon green">
            <UserCheck size={20} />
          </span>
          <div>
            <span>Present</span>
            <strong>
              {present}
              <small>{total ? `${presentPct}% attendance` : "Ready"}</small>
            </strong>
          </div>
        </button>

        <button
          type="button"
          className={`stat stat-clickable ${filter === "waiting" ? "stat-active" : ""}`}
          onClick={() => setFilter(filter === "waiting" ? "all" : "waiting")}
        >
          <span className="stat-icon orange">
            {session.closed ? <UserX size={20} /> : <Clock size={20} />}
          </span>
          <div>
            <span>{session.closed ? "Absent" : "Not yet checked in"}</span>
            <strong>
              {waiting}
              <small>
                {session.closed ? "session ended" : "awaiting arrival"}
              </small>
            </strong>
          </div>
        </button>

        <button
          type="button"
          className={`stat stat-clickable ${filter === "excused" ? "stat-active" : ""}`}
          onClick={() => setFilter(filter === "excused" ? "all" : "excused")}
        >
          <span className="stat-icon excused">
            <ShieldCheck size={20} />
          </span>
          <div>
            <span>Excused</span>
            <strong>
              {excused}
              <small>marked by teacher</small>
            </strong>
          </div>
        </button>
      </div>

      <AttendanceProgressBar
        present={present}
        excused={excused}
        total={total}
        closed={session.closed}
      />

      <div className="dashboard-grid">
        <section className="panel roster-panel">
          <div className="panel-heading">
            <div>
              <h2>{session.title}</h2>
              <p>{dateLabel}</p>
            </div>
            <div className="panel-heading-actions">
              <span className={"badge " + (session.closed ? "neutral" : "")}>
                <span /> {session.closed ? "Closed" : "Check-in open"}
              </span>
              <button
                type="button"
                className="secondary compact"
                disabled={exporting}
                onClick={() => void exportCsv()}
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
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search ? (
                <button
                  type="button"
                  className="search-clear"
                  aria-label="Clear search"
                  onClick={() => setSearch("")}
                >
                  <X size={13} />
                </button>
              ) : (
                <kbd className="search-kbd">/</kbd>
              )}
            </div>

            <div className="roster-controls-right">
              <div className="filter-pills" role="group" aria-label="Filter by status">
                {(
                  [
                    ["all", `All`, total],
                    ["present", "Present", present],
                    [
                      "waiting",
                      session.closed ? "Absent" : "Waiting",
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
                  onChange={(e) => setSort(e.target.value as RosterSort)}
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
                  const fact = facts.get(s.id);
                  const isExcused = Boolean(fact?.excusedAt);
                  const isPresent = Boolean(fact?.checkedInAt && !isExcused);
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
                                : session.closed
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
                              : session.closed
                                ? "Absent"
                                : "Waiting"}
                        </span>
                      </td>
                      <td className="time-cell">
                        {fact?.checkedInAt
                          ? new Date(fact.checkedInAt).toLocaleTimeString([], {
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
                          onClick={() => void run("excuse", s.id, !isExcused)}
                        >
                          {excusingId === s.id && (
                            <Loader2 size={13} className="spin" />
                          )}
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
                {(search || filter !== "all") && (
                  <button
                    type="button"
                    className="secondary compact"
                    onClick={() => {
                      setSearch("");
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
              {!session.closed && <i className="pulse-dot" />}
              {session.closed ? "Session closed" : "Live updates"}
            </span>
          </div>
        </section>

        <aside className="right-column">
          <section className="panel qr-panel">
            <div className="panel-heading">
              <div>
                <h2>
                  <QrCode size={18} /> Let students check in
                </h2>
                <p>One scan. And they’re on the list.</p>
              </div>
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
                    <span>Generating QR…</span>
                  </div>
                )}
              </button>
            </div>

            <p className="qr-description">
              {session.closed
                ? "This session is closed. Start a new session for your next class."
                : "Project this QR code for the room or share the direct check-in link."}
            </p>

            <div className="qr-actions">
              <ProjectQrButton onClick={() => setProjectorOpen(true)} />
              <button
                type="button"
                className="secondary full"
                onClick={() => void copyJoinLink()}
              >
                {copiedLink ? <Check size={15} /> : <Copy size={15} />}
                Copy check-in link
              </button>
              <a
                className="text-button"
                href={qr}
                download={`rollcall-${id.slice(0, 8)}.png`}
              >
                <Download size={14} /> Download QR code
              </a>
              {!session.closed && (
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

          <div className="shortcut-card">
            <span className="eyebrow">QUICK SHORTCUTS</span>
            <div className="shortcut-row">
              <span>Project QR full-screen</span>
              <kbd>P</kbd>
            </div>
            <div className="shortcut-row">
              <span>Jump to student search</span>
              <kbd>/</kbd>
            </div>
          </div>
        </aside>
      </div>

      <ProjectorModal
        open={projectorOpen}
        onClose={() => setProjectorOpen(false)}
        title={session.title}
        dateLabel={dateLabel}
        qr={qr}
        joinUrl={joinUrl}
        present={present}
        excused={excused}
        total={total}
        closed={session.closed}
        onCopy={() => void copyJoinLink()}
        downloadName={`rollcall-${id.slice(0, 8)}.png`}
      />

      <ConfirmModal
        open={confirmCloseOpen}
        title="Close check-in for this session?"
        description="Students will no longer be able to sign themselves in. Anyone who has not checked in will be shown as Absent. You can still excuse students or export CSV afterward."
        confirmLabel="Close check-in"
        tone="danger"
        busy={busy}
        onConfirm={() => void run("close")}
        onCancel={() => setConfirmCloseOpen(false)}
      />
    </>
  );
}
