"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Plus, Trash2, X, Loader2, Users, UserPlus, Save } from "lucide-react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { accessError, errorMessage, newId } from "./convex-home";
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
    [username, setUsername] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [fatal, setFatal] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
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
  function reload() {
    if (
      details &&
      confirm("Reload the latest class and discard your unsaved edits?")
    ) {
      setStudents(details.students);
      setRevision(details.revision);
      setDirty(false);
      setConflict(false);
      setError("");
    }
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
      setNotice(
        action === "roster"
          ? "Roster saved. Take attendance again to use it in a new session."
          : action === "share"
            ? "Teacher added."
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
  return (
    <dialog
      ref={dialog}
      className="class-manager"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <button
        className="modal-close"
        aria-label="Close class settings"
        disabled={busy}
        onClick={onClose}
      >
        <X size={21} />
      </button>
      <span className="stat-icon blue">
        <Users size={23} />
      </span>
      <h2>{mode === "roster" ? "Edit students" : "Teacher access"}</h2>
      <p className="manager-subtitle">{details?.title || "Loading class…"}</p>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="notice">
          {notice}
        </div>
      )}
      {conflict && (
        <>
          <p className="error">This roster changed while you were editing.</p>
          <button className="secondary" disabled={busy} onClick={reload}>
            Reload latest version
          </button>
        </>
      )}
      {!details ? (
        <Loader2 className="spin" />
      ) : mode === "roster" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run("roster");
          }}
        >
          <p className="manager-help">
            Changes apply to new attendance sessions; existing sessions stay
            unchanged.
          </p>
          <div className="roster-editor">
            <div className="editor-head">
              <span>Student name</span>
              <span>Student ID (optional)</span>
              <span />
            </div>
            {students.map((s, i) => (
              <div className="editor-row" key={s.id}>
                <input
                  aria-label={`Student ${i + 1} name`}
                  required
                  maxLength={160}
                  value={s.name}
                  disabled={busy}
                  onChange={(e) => edit(s.id, "name", e.target.value)}
                />
                <input
                  aria-label={`Student ${i + 1} ID`}
                  maxLength={160}
                  value={s.code}
                  disabled={busy}
                  onChange={(e) => edit(s.id, "code", e.target.value)}
                />
                <button
                  type="button"
                  aria-label={`Remove ${s.name || "student"}`}
                  disabled={busy}
                  onClick={() => {
                    setDirty(true);
                    setStudents((x) => x.filter((a) => a.id !== s.id));
                  }}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
          </div>
          <div className="manager-actions">
            <button
              type="button"
              className="secondary"
              disabled={busy || students.length >= 1000}
              onClick={() => {
                setDirty(true);
                setStudents((x) => [...x, { id: newId(), name: "", code: "" }]);
              }}
            >
              <Plus size={17} /> Add student
            </button>
            <span>{students.length} students</span>
            <button
              className="primary"
              disabled={busy || conflict || !students.length}
            >
              <Save size={16} /> Save roster
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="manager-help">
            Teachers can view attendance and edit the roster. Only the owner can
            add or remove teachers.
          </p>
          <div className="teacher-owner">
            <strong>Class owner</strong>
            <span>
              {details.isOwner ? "You" : "Access managed by the class owner"}
            </span>
          </div>
          {details.teachers.map((t) => (
            <div className="teacher-row" key={t.username}>
              <strong>{t.username}</strong>
              {details.isOwner && (
                <button
                  className="secondary compact"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Remove ${t.username} from this class?`))
                      void run("unshare", t.username);
                  }}
                >
                  Remove access
                </button>
              )}
            </div>
          ))}
          {details.isOwner && (
            <form
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
                  maxLength={40}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
                <button className="primary" disabled={busy}>
                  <UserPlus size={17} /> Add teacher
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </dialog>
  );
}
