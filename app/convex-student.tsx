"use client";
import { useEffect, useState } from "react";
import {
  Check,
  Clock,
  Loader2,
  Lock,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { Brand } from "./ui-components";

export default function ConvexStudent({ id }: { id: string }) {
  const [info, setInfo] = useState<{ title: string; closed: boolean } | null>(
    null,
  );
  const [error, setError] = useState(
    id ? "" : "This check-in link is invalid.",
  );
  const [identity, setIdentity] = useState(""),
    [success, setSuccess] = useState(""),
    [checkedAt, setCheckedAt] = useState(""),
    [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    fetch(`/api/convex/public?id=${encodeURIComponent(id)}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok)
          throw new Error(
            typeof data.error === "string"
              ? data.error
              : "Unable to load this session.",
          );
        setInfo(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e.message || "Unable to load this session.");
      });
    return () => controller.abort();
  }, [id]);

  async function checkin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/convex/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "checkin", id, identity }),
      });
      const data = await r.json();
      if (!r.ok)
        throw new Error(
          typeof data.error === "string" ? data.error : "Unable to check in.",
        );
      setCheckedAt(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
      setSuccess(
        data.already
          ? `You’re already checked in, ${data.name}.`
          : `You’re checked in, ${data.name}!`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to check in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="student-page">
      <div className="student-shell">
        <div className="student-header">
          <Brand size="md" />
          {info && (
            <span className={`badge ${info.closed ? "neutral" : ""}`}>
              <span /> {info.closed ? "Check-in closed" : "Check-in open"}
            </span>
          )}
        </div>

        <section className="student-card">
          <span className="eyebrow">STUDENT CHECK-IN</span>
          {success ? (
            <div className="checkin-receipt">
              <div className="success-icon">
                <Check size={34} strokeWidth={2.5} />
              </div>
              <h1>You’re all set.</h1>
              <p className="receipt-greeting">{success}</p>
              <div className="receipt-details">
                <div>
                  <span>Class</span>
                  <strong>{info?.title || "Class attendance"}</strong>
                </div>
                <div>
                  <span>Recorded</span>
                  <strong>
                    <Clock size={13} /> {checkedAt || "Just now"}
                  </strong>
                </div>
              </div>
              <p className="muted receipt-note">
                <Sparkles size={14} /> Your teacher has your attendance. You can
                safely close this page.
              </p>
            </div>
          ) : (
            <>
              <h1>{info?.title || "Class attendance"}</h1>
              {error && (
                <div role="alert" className="error">
                  <ShieldAlert size={16} />
                  <span>{error}</span>
                </div>
              )}
              {info?.closed ? (
                <div className="closed-notice">
                  <p>
                    Check-in has closed for this session. Please speak to your
                    teacher if you need to be marked present or excused.
                  </p>
                </div>
              ) : info ? (
                <form onSubmit={checkin} className="student-form">
                  <p>
                    Enter your name as it appears on the class roster, or use
                    your student ID.
                  </p>
                  <label htmlFor="identity">Full name or student ID</label>
                  <input
                    id="identity"
                    autoFocus
                    autoComplete="name"
                    value={identity}
                    onChange={(e) => setIdentity(e.target.value)}
                    required
                    maxLength={160}
                    placeholder="e.g. Avery Brooks or DEMO001"
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
                  <p className="privacy-note">
                    <Lock size={13} /> Your details are only visible to your
                    teacher.
                  </p>
                </form>
              ) : (
                !error && (
                  <div className="student-loading">
                    <Loader2 size={18} className="spin" />
                    <span>Loading your session…</span>
                  </div>
                )
              )}
            </>
          )}
        </section>

        <span className="student-footer">
          A little less admin. A little more teaching.
        </span>
      </div>
    </main>
  );
}
