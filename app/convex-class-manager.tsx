"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
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
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { accessError, errorMessage, newId } from "./convex-home";
import { StudentAvatar } from "./ui-components";

type Student = { id: string; name: string; code: string };

export default function ConvexClassManager({
  classId,
  mode,
  onClose,
}: {
  classId: Id<"classes">;
  mode: "roster" | "teachers";
  onClose: () => void;
}) {
  const details = useQuery(api.attendance.classDetails, { classId });
  const save = useMutation(api.attendance.saveRoster),
    share = useMutation(api.attendance.share),
    unshare = useMutation(api.attendance.unshare);
  const [students, setStudents] = useState<Student[]>([]),
    [revision, setRevision] = useState<number | null>(null),
    [dirty, setDirty] = useState(false),
    [conflict, setConflict] = useState(false),
    [confirmReload, setConfirmReload] = useState(false),
    [confirmRemoveTeacher, setConfirmRemoveTeacher] = useState(""),
    [filter, setFilter] = useState(""),
    [username, setUsername] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [fatal, setFatal] = useState(false);

  const dialog = useRef<HTMLDialogElement>(null);
  const editorListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);

  useEffect(() => {
    if (!details) return;
    if (revision === null || (!dirty && !conflict)) {
      setStudents(details.students);
      setRevision(details.revision);
    } else if (details.revision !== revision) setConflict(true);
  }, [details, revision, dirty, conflict]);

  if (fatal) throw new Error("Access changed");

  function reloadLatest() {
    if (!details) return;
    setStudents(details.students);
    setRevision(details.revision);
    setDirty(false);
    setConflict(false);
    setConfirmReload(false);
    setError("");
    setNotice("Loaded the latest saved roster.");
  }

  async function run(action: "roster" | "share" | "unshare", name = "") {
    if (revision === null) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (action === "roster") {
        const result = await save({ classId, revision, students });
        setRevision(result.revision);
        setDirty(false);
      } else if (action === "share") await share({ classId, username: name });
      else await unshare({ classId, username: name });
      setUsername("");
      setConfirmRemoveTeacher("");
      setNotice(
        action === "roster"
          ? "Roster saved. Take attendance again to use it in a new session."
          : action === "share"
            ? "Teacher added to this class."
            : "Teacher access removed.",
      );
    } catch (e) {
      if (accessError(e)) {
        setFatal(true);
        return;
      }
      const data = (e as { data?: { status?: number } })?.data;
      if (data?.status === 409) setConflict(true);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function edit(id: string, field: "name" | "code", value: string) {
    setDirty(true);
    setStudents((x) =>
      x.map((s) => (s.id === id ? { ...s, [field]: value } : s)),
    );
  }

  function addStudentRow() {
    setDirty(true);
    setFilter("");
    const id = newId();
    setStudents((x) => [...x, { id, name: "", code: "" }]);
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
                <p>Reload to see the newest saved version before editing.</p>
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
                    onClick={reloadLatest}
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

          {!details ? (
            <div className="manager-loading">
              <Loader2 size={20} className="spin" />
              <span>Loading class details…</span>
            </div>
          ) : mode === "roster" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run("roster");
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
                {visibleStudents.map((s, i) => (
                  <div className="editor-row" key={s.id}>
                    <input
                      aria-label={`Student ${i + 1} name`}
                      required
                      maxLength={160}
                      value={s.name}
                      disabled={busy}
                      placeholder="Full name"
                      onChange={(e) => edit(s.id, "name", e.target.value)}
                    />
                    <input
                      aria-label={`Student ${i + 1} ID`}
                      maxLength={160}
                      value={s.code}
                      disabled={busy}
                      placeholder="Student ID"
                      onChange={(e) => edit(s.id, "code", e.target.value)}
                    />
                    <button
                      type="button"
                      className="row-delete"
                      aria-label={`Remove ${s.name || "student"}`}
                      disabled={busy}
                      onClick={() => {
                        setDirty(true);
                        setStudents((x) => x.filter((a) => a.id !== s.id));
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
                            disabled={busy}
                            onClick={() => void run("unshare", t.username)}
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="secondary compact"
                          disabled={busy}
                          onClick={() => setConfirmRemoveTeacher(t.username)}
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
                    No additional teachers have access to this class yet.
                  </p>
                )}
              </div>

              {details.isOwner && (
                <form
                  className="share-card"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run("share", username);
                  }}
                >
                  <label htmlFor="teacher-username">Teacher’s username</label>
                  <div className="share-form">
                    <input
                      id="teacher-username"
                      required
                      autoCapitalize="none"
                      autoComplete="off"
                      maxLength={40}
                      placeholder="e.g. alex.teacher"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      disabled={busy}
                    />
                    <button className="primary" disabled={busy}>
                      <UserPlus size={16} /> Add teacher
                    </button>
                  </div>
                  <p className="share-note">
                    They must create a Rollcall account first. Access applies to
                    this class only.
                  </p>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
