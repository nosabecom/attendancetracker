"use client";
import { useEffect, useState } from "react";
import { Check, Loader2, ShieldAlert } from "lucide-react";
import { Brand, PasswordInput } from "./ui-components";

export default function ConvexReset({ token }: { token: string }) {
  const [info, setInfo] = useState<{ username: string } | null>(null);
  const [loadError, setLoadError] = useState(
    token ? "" : "This reset link is invalid or has expired.",
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    fetch(`/api/convex/reset?token=${encodeURIComponent(token)}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) {
          throw new Error(
            typeof data.error === "string"
              ? data.error
              : "This reset link is invalid or has expired.",
          );
        }
        setInfo({ username: data.username });
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setLoadError(
            e instanceof Error && e.message
              ? e.message
              : "This reset link is invalid or has expired.",
          );
        }
      });
    return () => controller.abort();
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 10 || password.length > 128) {
      setError("Use a password of 10–128 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/convex/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await r.json();
      if (!r.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Unable to reset password.",
        );
      }
      setPassword("");
      setConfirm("");
      setDone(true);
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : "Unable to reset password.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="student-page">
      <div className="student-shell">
        <div className="student-header">
          <Brand size="md" />
        </div>

        <section className="student-card">
          {done ? (
            <div className="checkin-receipt">
              <div className="success-icon">
                <Check size={32} strokeWidth={2.5} />
              </div>
              <h1>Password updated.</h1>
              <p className="muted">
                You can now sign in as <strong>{info?.username}</strong> with
                your new password.
              </p>
              <a className="primary full btn-lg" href="/">
                Sign in
              </a>
            </div>
          ) : loadError ? (
            <div className="checkin-receipt">
              <div className="error-icon">
                <ShieldAlert size={28} strokeWidth={2} />
              </div>
              <h1>Link unavailable</h1>
              <p className="muted">{loadError}</p>
              <a className="secondary full btn-lg" href="/">
                Back to sign in
              </a>
            </div>
          ) : !info ? (
            <div className="loading-inline">
              <Loader2 size={18} className="spin" />
              <span>Verifying reset link…</span>
            </div>
          ) : (
            <>
              <h1>Reset password</h1>
              <p className="muted">
                Choose a new password for <strong>{info.username}</strong>.
              </p>
              <form onSubmit={submit}>
                <label htmlFor="new-password">New password</label>
                <PasswordInput
                  id="new-password"
                  autoComplete="new-password"
                  required
                  minLength={10}
                  maxLength={128}
                  placeholder="At least 10 characters"
                  value={password}
                  onChange={setPassword}
                  showStrength
                />
                <label htmlFor="confirm-password">Confirm password</label>
                <PasswordInput
                  id="confirm-password"
                  autoComplete="new-password"
                  required
                  minLength={10}
                  maxLength={128}
                  placeholder="Re-enter your new password"
                  value={confirm}
                  onChange={setConfirm}
                />
                {error && (
                  <div role="alert" className="error">
                    {error}
                  </div>
                )}
                <button className="primary full btn-lg" disabled={busy}>
                  {busy ? (
                    <>
                      <Loader2 size={17} className="spin" /> Updating…
                    </>
                  ) : (
                    "Save new password"
                  )}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
