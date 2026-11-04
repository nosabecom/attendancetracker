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
  CheckCheck,
  ClipboardList,
  Download,
  Lock,
  Plus,
  QrCode,
  Upload,
  Users,
} from "lucide-react";
import QRCode from "qrcode";
import Papa from "papaparse";
import { parseRoster } from "../lib/roster.mjs";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import ConvexClassManager from "./convex-class-manager";
import { verifiedLogout } from "../lib/convex-logout.mjs";

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
const Brand = () => (
  <div className="brand">
    <span className="brandmark">
      <CheckCheck size={24} />
    </span>
    rollcall<span className="brand-dot">.</span>
  </div>
);
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="student-page">
        <Brand />
        <section className="student-card">
          <h1>Workspace unavailable</h1>
          <p>Your session or access may have changed. Please sign in again.</p>
          <button className="primary" onClick={() => location.reload()}>
            Continue
          </button>
        </section>
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
    return <div className="loading">Opening Rollcall…</div>;
  if (!isAuthenticated)
    return (
      <main className="student-page">
        <Brand />
        <section className="student-card auth-card">
          <span className="eyebrow">YOUR TEACHER WORKSPACE</span>
          <h1>
            {mode === "login" ? "Welcome back." : "Make room for your classes."}
          </h1>
          <p>
            {mode === "login"
              ? "Sign in to find your saved classes and attendance."
              : "Create an account to keep your classes in your own private workspace."}
          </p>
          <div className="auth-tabs">
            <button
              className={mode === "login" ? "selected" : ""}
              onClick={() => {
                setMode("login");
                setError("");
              }}
            >
              Sign in
            </button>
            <button
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
              pattern="[A-Za-z0-9._-]{3,40}"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              required
              minLength={10}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
            <button className="primary full" disabled={busy}>
              {busy
                ? "Please wait…"
                : mode === "signup"
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
  if (signingOut) return <div className="loading">Signing out…</div>;
  if (logoutError)
    return (
      <main className="student-page">
        <Brand />
        <section className="student-card">
          <h1>Sign-out did not finish</h1>
          <p role="alert">{logoutError}</p>
          <button className="primary" onClick={() => void leave()}>
            Try again
          </button>
        </section>
      </main>
    );
  if (expired)
    return (
      <main className="student-page">
        <Brand />
        <section className="student-card">
          <h1>Session expired</h1>
          <p>Please sign in again.</p>
          <button className="primary" onClick={() => void leave()}>
            Sign in
          </button>
        </section>
      </main>
    );
  if (!connected)
    return (
      <main className="student-page">
        <Brand />
        <section className="student-card">
          <h1>Reconnecting…</h1>
          <p>
            Attendance will reopen with fresh data when your connection returns.
          </p>
        </section>
      </main>
    );
  if (!viewer) return <div className="loading">Opening Rollcall…</div>;
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
    [modal, setModal] = useState(false),
    [title, setTitle] = useState(""),
    [csv, setCsv] = useState(""),
    [fileName, setFileName] = useState(""),
    [count, setCount] = useState(0),
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
  if (fatal) throw new Error("Access changed");
  async function readFile(f?: File) {
    if (!f) return;
    try {
      if (f.size > 500000) throw new Error("Choose a CSV smaller than 500 KB.");
      const text = await f.text();
      setCount(parseRoster(text).length);
      setCsv(text);
      setFileName(f.name);
      setError("");
    } catch (e) {
      setCsv("");
      setCount(0);
      setError(e instanceof Error ? e.message : "Invalid CSV.");
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
  return (
    <div className="app">
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
          {classes.results.map((c) => (
            <button
              key={c.classId}
              className={
                selectedClass === c.classId ? "session selected" : "session"
              }
              onClick={() => setSelectedClass(c.classId)}
            >
              <span>
                {c.title}
                <small>{c.count} students</small>
              </span>
            </button>
          ))}
          {classes.status === "CanLoadMore" && (
            <button className="secondary" onClick={() => classes.loadMore(25)}>
              Load more classes
            </button>
          )}
          {classes.status === "Exhausted" && !classes.results.length && (
            <p className="sidebar-empty">
              Your saved classes will appear here.
            </p>
          )}
        </div>
        <div className="teacher-access">
          <span className="avatar">T</span>
          <div>
            <strong>{username}</strong>
            <button onClick={() => void onSignOut()}>Sign out</button>
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
            <button className="primary" onClick={() => setModal(true)}>
              <Plus size={18} /> New class
            </button>
          </div>
          {error && !modal && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {legacyKey && (
            <div className="migration-banner">
              <div>
                <strong>Bring your previous classes with you</strong>
                <p>Import this browser’s old workspace into {username}.</p>
              </div>
              <button
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
            <div className="empty-roster">
              <Users size={36} />
              <h3>A fresh start for your next class</h3>
              <p>
                Import a CSV of student names to create your first attendance
                session.
              </p>
              <button className="primary" onClick={() => setModal(true)}>
                <Upload size={17} /> Import student CSV
              </button>
              <a href="/sample-roster.csv" download>
                Download 20 fake students
              </a>
            </div>
          )}
        </div>
      </main>
      {modal && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true">
            <button
              className="modal-close"
              aria-label="Close"
              onClick={() => setModal(false)}
            >
              ×
            </button>
            <h2>Let’s set up your class.</h2>
            <p>
              Name your class and import your roster once. It’s saved for next
              time.
            </p>
            <form onSubmit={createClass}>
              <label htmlFor="session-name">Class name</label>
              <input
                id="session-name"
                required
                maxLength={100}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <label htmlFor="roster-file">Student roster</label>
              <button
                type="button"
                className="dropzone"
                onClick={() => file.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void readFile(e.dataTransfer.files[0]);
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
                id="roster-file"
                hidden
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => void readFile(e.target.files?.[0])}
              />
              <p className="csv-help">
                Use a name column or first_name and last_name. Add student_id to
                distinguish students.
              </p>
              <a href="/sample-roster.csv" download className="sample-link">
                Download fake student CSV
              </a>
              {error && (
                <div className="error" role="alert">
                  {error}
                </div>
              )}
              <button
                className="primary full"
                disabled={busy || !csv || !title.trim()}
              >
                Create class &amp; start attendance
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
    [fatal, setFatal] = useState(false);
  const repeat = useMutation(api.attendance.repeat);
  useEffect(() => {
    if (!selected && history.results.length) setSelected(history.results[0].id);
  }, [history.results, selected]);
  if (fatal) throw new Error("Access changed");
  async function startAgain() {
    if (!selected) return;
    try {
      const r = await repeat({ legacyId: selected, newId: newId() });
      setSelected(r.id);
      setError("");
    } catch (e) {
      if (accessError(e)) setFatal(true);
      else setError(errorMessage(e));
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
        <div>
          <label htmlFor="session-history">Attendance history</label>
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
            <button className="secondary" onClick={() => history.loadMore(25)}>
              Load more history
            </button>
          )}
        </div>
        <div className="class-buttons">
          <button className="secondary" onClick={() => setManager("roster")}>
            Edit students
          </button>
          <button className="secondary" onClick={() => setManager("teachers")}>
            Teacher access
          </button>
          <button
            className="secondary"
            disabled={!selected}
            onClick={startAgain}
          >
            <Plus size={17} /> Take attendance again
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
        <p>Loading attendance history…</p>
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
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [fatal, setFatal] = useState(false);
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(`${location.origin}/?join=${id}`, {
      width: 600,
      margin: 2,
      color: { dark: "#102344", light: "#ffffff" },
      errorCorrectionLevel: "M",
    }).then((value) => {
      if (active) setQr(value);
    });
    return () => {
      active = false;
    };
  }, [id]);
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
    total = ready ? roster.length : 0;
  const filtered = ready
    ? roster.filter((s) =>
        `${s.name} ${s.code}`.toLowerCase().includes(search.toLowerCase()),
      )
    : [];
  async function run(
    action: "close" | "excuse",
    studentId = "",
    excused = false,
  ) {
    setBusy(true);
    setError("");
    try {
      if (action === "close") await close({ legacyId: id });
      else await excuse({ legacyId: id, studentId, excused });
    } catch (e) {
      if (accessError(e)) setFatal(true);
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
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
        fetch: (input, init) => globalThis.fetch(input, {
          ...init, signal: controller.signal, redirect: "error",
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
  if (!ready) return <p>Loading attendance…</p>;
  return (
    <>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      <div className="stats">
        {[
          ["Students on roster", total, "blue"],
          ["Present", present, "green"],
          [
            session.closed ? "Absent" : "Not yet checked in",
            total - present - excused,
            "orange",
          ],
          ["Excused", excused, "excused"],
        ].map(([label, value, color]) => (
          <div className="stat" key={label}>
            <span className={`stat-icon ${color}`}>
              <Users size={21} />
            </span>
            <div>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel roster-panel">
          <div className="panel-heading">
            <div>
              <h2>{session.title}</h2>
              <p>
                {new Date(session.createdAt).toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            </div>
            <button
              className="secondary compact"
              disabled={exporting}
              onClick={() => void exportCsv()}
            >
              <Download size={16} /> Export
            </button>
          </div>
          <div className="roster-tools">
            <div className="search">
              <input
                aria-label="Search students"
                placeholder="Search students…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <span className={"badge " + (session.closed ? "neutral" : "")}>
              <span /> {session.closed ? "Closed" : "Check-in open"}
            </span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>STUDENT</th>
                  <th>STATUS</th>
                  <th>CHECK-IN TIME</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const fact = facts.get(s.id);
                  return (
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
                            fact?.excusedAt
                              ? "status excused"
                              : fact?.checkedInAt
                                ? "status present"
                                : "status"
                          }
                        >
                          {fact?.excusedAt
                            ? "Excused"
                            : fact?.checkedInAt
                              ? "Present"
                              : session.closed
                                ? "Absent"
                                : "Waiting"}
                        </span>
                      </td>
                      <td>
                        {fact?.checkedInAt
                          ? new Date(fact.checkedInAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </td>
                      <td>
                        <button
                          className="secondary compact excuse-action"
                          disabled={busy}
                          onClick={() =>
                            void run("excuse", s.id, !fact?.excusedAt)
                          }
                        >
                          {fact?.excusedAt ? "Undo excused" : "Mark excused"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!filtered.length && (
              <p className="no-results">No students match your search.</p>
            )}
          </div>
          <div className="table-footer">
            {filtered.length} students{" "}
            <span>{session.closed ? "Session closed" : "Live updates"}</span>
          </div>
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
              {qr && (
                <img
                  src={qr}
                  width="220"
                  height="220"
                  alt="Scan this QR code to check in to the current attendance session"
                />
              )}
            </div>
            <p className="qr-description">
              {session.closed
                ? "This session is closed. Start a new session for your next class."
                : "Display this QR code so students can scan and sign themselves in."}
            </p>
            <div className="qr-actions">
              <button
                className="secondary full"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      `${location.origin}/?join=${id}`,
                    );
                    setNotice("Student check-in link copied.");
                  } catch {
                    setError("Clipboard unavailable.");
                  }
                }}
              >
                Copy check-in link
              </button>
              <a
                className="text-button"
                href={qr}
                download={`rollcall-${id.slice(0, 8)}.png`}
              >
                <Download size={15} /> Download QR code
              </a>
              {!session.closed && (
                <button
                  className="close-session"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        "Close check-in? Students will no longer be able to sign into this session.",
                      )
                    )
                      void run("close");
                  }}
                >
                  Close check-in
                </button>
              )}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
