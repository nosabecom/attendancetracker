"use client";
import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, X, Loader2, Users, UserPlus, Save } from "lucide-react";
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
  const [details, setDetails] = useState<Details | null>(null),
    [students, setStudents] = useState<Student[]>([]),
    [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [conflict, setConflict] = useState(false);
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
      setConflict(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load();
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
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function edit(id: string, field: "name" | "code", value: string) {
    setStudents((previous) =>
      previous.map((s) => (s.id === id ? { ...s, [field]: value } : s)),
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
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            if (
              confirm("Reload the latest class and discard your unsaved edits?")
            )
              load();
          }}
        >
          Reload latest version
        </button>
      )}
      {!details && !error && <Loader2 className="spin" />}
      {details && (
        <>
          {mode === "roster" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                mutate("roster", { students });
              }}
            >
              <p className="manager-help">
                Edit the saved class roster. Changes apply to new attendance
                sessions; existing sessions and their attendance stay unchanged.
              </p>
              <div className="roster-editor">
                <div className="editor-head">
                  <span>Student name</span>
                  <span>Student ID (optional)</span>
                  <span />
                </div>
                {students.map((s, index) => (
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
                      aria-label={`Remove ${s.name || "student " + (index + 1)}`}
                      disabled={busy}
                      onClick={() =>
                        setStudents((previous) =>
                          previous.filter((x) => x.id !== s.id),
                        )
                      }
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
                  onClick={() =>
                    setStudents([
                      ...students,
                      { id: crypto.randomUUID(), name: "", code: "" },
                    ])
                  }
                >
                  <Plus size={17} /> Add student
                </button>
                <span>{students.length} students</span>
                <button
                  className="primary"
                  disabled={busy || conflict || !students.length}
                >
                  <Save size={16} />
                  {busy ? "Saving…" : "Save roster"}
                </button>
              </div>
            </form>
          ) : (
            <>
              <p className="manager-help">
                Teachers can view attendance history, take attendance, close
                check-in, and edit the saved roster. Only the owner can add or
                remove teachers.
              </p>
              <div className="teacher-owner">
                <strong>Class owner</strong>
                <span>
                  {details.isOwner
                    ? "You"
                    : "Access managed by the class owner"}
                </span>
              </div>
              {details.teachers.map((t) => (
                <div className="teacher-row" key={t.username}>
                  <strong>{t.username}</strong>
                  {details.isOwner ? (
                    <button
                      className="secondary compact"
                      disabled={busy || conflict}
                      onClick={() => {
                        if (confirm(`Remove ${t.username} from this class?`))
                          mutate("unshare", { username: t.username });
                      }}
                    >
                      Remove access
                    </button>
                  ) : (
                    <span>Teacher</span>
                  )}
                </div>
              ))}
              {!details.teachers.length && (
                <p className="manager-help">No additional teachers yet.</p>
              )}
              {details.isOwner && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    mutate("share", { username });
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
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="e.g. alex.teacher"
                      disabled={busy}
                    />
                    <button className="primary" disabled={busy || conflict}>
                      <UserPlus size={17} />
                      {busy ? "Saving…" : "Add teacher"}
                    </button>
                  </div>
                  <p className="manager-help">
                    They must create a Rollcall account first. Share access to
                    this class only.
                  </p>
                </form>
              )}
            </>
          )}
        </>
      )}
    </dialog>
  );
}
