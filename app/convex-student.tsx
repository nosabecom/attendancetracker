"use client";
import { useEffect, useState } from "react";
import { Check, CheckCheck, Lock } from "lucide-react";
export default function ConvexStudent({ id }: { id: string }) {
  const [info, setInfo] = useState<{ title: string; closed: boolean } | null>(
    null,
  );
  const [error, setError] = useState(
    id ? "" : "This check-in link is invalid.",
  );
  const [identity, setIdentity] = useState(""),
    [success, setSuccess] = useState(""),
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
      <div className="brand">
        <span className="brandmark">
          <CheckCheck size={24} />
        </span>
        rollcall<span className="brand-dot">.</span>
      </div>
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
            <h1>{info?.title || "Class attendance"}</h1>
            {error && (
              <div role="alert" className="error">
                {error}
              </div>
            )}
            {info?.closed ? (
              <p>Check-in has closed. Please speak to your teacher.</p>
            ) : info ? (
              <form onSubmit={checkin}>
                <p>
                  Enter your name as it appears on the class roster, or use your
                  student ID.
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
                  {busy ? "Checking in…" : "Check me in"} <Check size={18} />
                </button>
                <p className="privacy-note">
                  <Lock size={14} /> Your details are only visible to your
                  teacher.
                </p>
              </form>
            ) : (
              !error && <p>Loading your session…</p>
            )}
          </>
        )}
      </section>
      <span className="student-footer">
        A little less admin. A little more teaching.
      </span>
    </main>
  );
}
