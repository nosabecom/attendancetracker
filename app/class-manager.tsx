"use client";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Shield,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { StudentAvatar } from "./ui-components";

type Student = { id: string; name: string; code: string };
type Details = {
  id: string;
  title: string;
  revision: number;
  students: Student[];
  teachers: { username: string }[];
  isOwner: boolean;
};

export default function ClassManager({
  id,
  mode,
  onClose,
  onSaved,
}: {
  id: string;
  mode: "roster" | "teachers";
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const editorListRef = useRef<HTMLDivElement>(null);
  const [details, setDetails] = useState<Details | null>(null),
    [students, setStudents] = useState<Student[]>([]),
    [username, setUsername] = useState(""),
    [filter, setFilter] = useState(""),
    [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [conflict, setConflict] = useState(false),
    [confirmReload, setConfirmReload] = useState(false),
    [confirmRemoveTeacher, setConfirmRemoveTeacher] = useState("");

  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);

  async function load() {
    setError("");
    try {
      const r = await fetch(`/api/classes?id=${id}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setDetails(data);
      setStudents(data.students);
      setDirty(false);
      setConflict(false);
      setConfirmReload(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  async function mutate(action: string, extra: object) {
    if (!details) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          id,
          revision: details.revision,
          ...extra,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (r.status === 409) setConflict(true);
        throw new Error(data.error);
      }
      await load();
      setNotice(
        action === "roster"
          ? "Roster saved. Take attendance again to use it in a new session."
          : action === "share"
            ? "Teacher added. This class is now in their workspace."
            : "Teacher access removed.",
      );
      setUsername("");
      setConfirmRemoveTeacher("");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function edit(studentId: string, field: "name" | "code", value: string) {
    setDirty(true);
    setStudents((previous) =>
      previous.map((s) => (s.id === studentId ? { ...s, [field]: value } : s)),
    );
  }

  function addStudentRow() {
    setDirty(true);
    setFilter("");
    setStudents((previous) => [
      ...previous,
      { id: crypto.randomUUID(), name: "", code: "" },
    ]);
    requestAnimationFrame(() => {
      const container = editorListRef.current;
      if (!container) return;
      container.scrollTop = container.scrollHeight;
      const inputs = container.querySelectorAll<HTMLInputElement>(
        ".editor-row:last-child input",
      );
      inputs[0]?.focus();
    });
  }

  const visibleStudents = filter.trim()
    ? students.filter((s) =>
        `${s.name} ${s.code}`
          .toLowerCase()
          .includes(filter.trim().toLowerCase()),
      )
    : students;

  return (
    <dialog
      ref={dialog}
      className="class-manager"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === dialog.current && !busy) onClose();
      }}
    >
      <div className="manager-shell">
        <div className="manager-header">
          <div className="manager-header-title">
            <span className="stat-icon blue">
              {mode === "roster" ? <Users size={20} /> : <Shield size={20} />}
            </span>
            <div>
              <h2>{mode === "roster" ? "Edit students" : "Teacher access"}</h2>
              <p className="manager-subtitle">
                {details?.title || "Loading class…"}
              </p>
            </div>
          </div>
          <div className="manager-header-right">
            {mode === "roster" && dirty && (
              <span className="unsaved-pill">Unsaved changes</span>
            )}
            <button
              type="button"
              className="modal-close"
              aria-label="Close class settings"
              disabled={busy}
              onClick={onClose}
            >
              <X size={19} />
            </button>
          </div>
        </div>

        <div className="manager-body">
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          {notice && (
            <div role="status" className="notice">
              <Check size={16} />
              <span>{notice}</span>
            </div>
          )}
          {conflict && (
            <div className="conflict-banner" role="alert">
              <div>
                <strong>This roster changed while you were editing.</strong>
                <p>Reload to see the newest saved version before saving.</p>
              </div>
              {confirmReload ? (
                <div className="inline-confirm">
                  <button
                    type="button"
                    className="secondary compact"
                    disabled={busy}
                    onClick={() => setConfirmReload(false)}
                  >
                    Keep mine
                  </button>
                  <button
                    type="button"
                    className="danger compact"
                    disabled={busy}
                    onClick={() => void load()}
                  >
                    Discard &amp; reload
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="secondary compact"
                  disabled={busy}
                  onClick={() => setConfirmReload(true)}
                >
                  <RefreshCw size={14} /> Reload latest version
                </button>
              )}
            </div>
          )}

          {!details && !error && (
            <div className="manager-loading">
              <Loader2 size={20} className="spin" />
              <span>Loading class details…</span>
            </div>
          )}

          {details && (
            <>
              {mode === "roster" ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void mutate("roster", { students });
                  }}
                >
                  <div className="manager-roster-bar">
                    <p className="manager-help">
                      Applies to new sessions. Past sessions stay unchanged.
                    </p>
                    {students.length > 6 && (
                      <div className="search compact-search">
                        <Search size={15} />
                        <input
                          aria-label="Filter roster editor"
                          placeholder="Filter students…"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        />
                        {filter && (
                          <button
                            type="button"
                            className="search-clear"
                            aria-label="Clear filter"
                            onClick={() => setFilter("")}
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="roster-editor" ref={editorListRef}>
                    <div className="editor-head">
                      <span>Student name</span>
                      <span>Student ID (optional)</span>
                      <span />
                    </div>
                    {visibleStudents.map((s, index) => (
                      <div className="editor-row" key={s.id}>
                        <input
                          aria-label={`Student ${index + 1} name`}
                          required
                          maxLength={160}
                          value={s.name}
                          disabled={busy}
                          onChange={(e) => edit(s.id, "name", e.target.value)}
                          placeholder="Full name"
                        />
                        <input
                          aria-label={`Student ${index + 1} ID`}
                          maxLength={160}
                          value={s.code}
                          disabled={busy}
                          onChange={(e) => edit(s.id, "code", e.target.value)}
                          placeholder="Student ID"
                        />
                        <button
                          type="button"
                          className="row-delete"
                          aria-label={`Remove ${s.name || "student " + (index + 1)}`}
                          disabled={busy}
                          onClick={() => {
                            setDirty(true);
                            setStudents((previous) =>
                              previous.filter((x) => x.id !== s.id),
                            );
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                    {!visibleStudents.length && (
                      <p className="no-results">
                        {filter
                          ? "No students match that filter."
                          : "No students on this roster yet."}
                      </p>
                    )}
                  </div>
                  <div className="manager-actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy || students.length >= 1000}
                      onClick={addStudentRow}
                    >
                      <Plus size={16} /> Add student
                    </button>
                    <span className="manager-count">
                      {students.length}{" "}
                      {students.length === 1 ? "student" : "students"}
                    </span>
                    <button
                      className="primary"
                      disabled={busy || conflict || !students.length}
                    >
                      {busy ? (
                        <Loader2 size={16} className="spin" />
                      ) : (
                        <Save size={16} />
                      )}
                      {busy ? "Saving…" : "Save roster"}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="teachers-panel">
                  <p className="manager-help">
                    Shared teachers can run sessions and edit the roster.
                  </p>
                  <div className="teacher-list">
                    <div className="teacher-owner">
                      <div className="teacher-identity">
                        <StudentAvatar name="Owner" />
                        <div>
                          <strong>Owner</strong>
                          <span>
                            {details.isOwner ? "You" : "Managed by owner"}
                          </span>
                        </div>
                      </div>
                      <span className="role-chip owner">Owner</span>
                    </div>
                    {details.teachers.map((t) => (
                      <div className="teacher-row" key={t.username}>
                        <div className="teacher-identity">
                          <StudentAvatar name={t.username} />
                          <div>
                            <strong>{t.username}</strong>
                            <span>Shared teacher</span>
                          </div>
                        </div>
                        {details.isOwner ? (
                          confirmRemoveTeacher === t.username ? (
                            <div className="inline-confirm">
                              <button
                                type="button"
                                className="secondary compact"
                                disabled={busy}
                                onClick={() => setConfirmRemoveTeacher("")}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="danger compact"
                                disabled={busy || conflict}
                                onClick={() =>
                                  void mutate("unshare", {
                                    username: t.username,
                                  })
                                }
                              >
                                Remove
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="secondary compact"
                              disabled={busy || conflict}
                              onClick={() =>
                                setConfirmRemoveTeacher(t.username)
                              }
                            >
                              Remove access
                            </button>
                          )
                        ) : (
                          <span className="role-chip">Teacher</span>
                        )}
                      </div>
                    ))}
                    {!details.teachers.length && (
                      <p className="teachers-empty">
                        No additional teachers yet.
                      </p>
                    )}
                  </div>
                  {details.isOwner && (
                    <form
                      className="share-card"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void mutate("share", { username });
                      }}
                    >
                      <label htmlFor="teacher-username">
                        Teacher’s username
                      </label>
                      <div className="share-form">
                        <input
                          id="teacher-username"
                          required
                          autoCapitalize="none"
                          autoComplete="off"
                          maxLength={40}
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          placeholder="e.g. alex.teacher"
                          disabled={busy}
                        />
                        <button className="primary" disabled={busy || conflict}>
                          <UserPlus size={16} />
                          {busy ? "Saving…" : "Add teacher"}
                        </button>
                      </div>
                      <p className="share-note">
                        They must create a Rollcall account first. Share access
                        to this class only.
                      </p>
                    </form>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
