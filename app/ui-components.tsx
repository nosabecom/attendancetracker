"use client";
import { useEffect, useState } from "react";
import {
  Check,
  CheckCheck,
  Copy,
  Download,
  Eye,
  EyeOff,
  Maximize2,
  QrCode,
  Upload,
  Users,
  X,
} from "lucide-react";

export type RosterFilter = "all" | "present" | "waiting" | "excused";
export type RosterSort = "roster" | "name" | "time" | "status";

const AVATAR_TONES = [
  "tone-cobalt",
  "tone-emerald",
  "tone-amber",
  "tone-iris",
  "tone-teal",
  "tone-rose",
] as const;

export function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function getAvatarTone(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

export function Brand({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  return (
    <div className={`brand brand-${size}`}>
      <span className="brandmark" aria-hidden="true">
        <CheckCheck size={size === "sm" ? 18 : size === "lg" ? 24 : 20} />
      </span>
      <span className="brand-word">
        rollcall<span className="brand-dot">.</span>
      </span>
    </div>
  );
}

export function StudentAvatar({ name }: { name: string }) {
  return (
    <span className={`initials ${getAvatarTone(name)}`} aria-hidden="true">
      {getInitials(name)}
    </span>
  );
}

export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  minLength = 10,
  maxLength = 128,
  required = true,
  placeholder,
  showStrength = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  minLength?: number;
  maxLength?: number;
  required?: boolean;
  placeholder?: string;
  showStrength?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const ratio = Math.min(1, value.length / minLength);
  const ready = value.length >= minLength;

  return (
    <div className="password-field">
      <div className="password-input-wrap">
        <input
          id={id}
          type={revealed ? "text" : "password"}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          maxLength={maxLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="password-toggle"
          aria-label={revealed ? "Hide characters" : "Reveal characters"}
          aria-pressed={revealed}
          onClick={() => setRevealed((v) => !v)}
        >
          {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {showStrength && (
        <div className="password-meter" aria-live="polite">
          <div className="password-meter-track">
            <span
              className={`password-meter-fill ${ready ? "ready" : ""}`}
              style={{ width: `${Math.round(ratio * 100)}%` }}
            />
          </div>
          <span className={`password-meter-text ${ready ? "ready" : ""}`}>
            {ready ? "10+ characters" : `${value.length} / ${minLength} characters`}
          </span>
        </div>
      )}
    </div>
  );
}

export function AuthShowcase() {
  return (
    <section className="auth-showcase" aria-hidden="true">
      <div className="auth-showcase-inner">
        <Brand size="md" />
        <div className="auth-showcase-copy">
          <h2>
            Live classroom attendance, <em>zero friction.</em>
          </h2>
        </div>

        <div className="showcase-preview">
          <div className="showcase-preview-head">
            <div>
              <strong>CS 204 · Algorithms</strong>
              <span>24 students</span>
            </div>
            <span className="live-pill">
              <span className="pulse-dot" /> Live
            </span>
          </div>
          <div className="showcase-progress">
            <div className="showcase-progress-bar">
              <span className="seg-present" style={{ width: "79%" }} />
              <span className="seg-excused" style={{ width: "8%" }} />
            </div>
            <div className="showcase-progress-meta">
              <span>19 present · 2 excused · 3 waiting</span>
              <strong>88%</strong>
            </div>
          </div>
          <div className="showcase-rows">
            {[
              { name: "Avery Brooks", code: "CS-014", status: "Present", time: "09:01", cls: "present" },
              { name: "Riley Chen", code: "CS-019", status: "Present", time: "09:02", cls: "present" },
              { name: "Morgan Patel", code: "CS-022", status: "Excused", time: "—", cls: "excused" },
            ].map((row) => (
              <div className="showcase-row" key={row.code}>
                <StudentAvatar name={row.name} />
                <div className="showcase-row-info">
                  <strong>{row.name}</strong>
                  <span>{row.code}</span>
                </div>
                <span className={`status ${row.cls}`}>{row.status}</span>
                <span className="showcase-row-time">{row.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function AttendanceProgressBar({
  present,
  excused,
  total,
  closed,
}: {
  present: number;
  excused: number;
  total: number;
  closed: boolean;
}) {
  const waiting = Math.max(0, total - present - excused);
  const presentPct = total ? (present / total) * 100 : 0;
  const excusedPct = total ? (excused / total) * 100 : 0;
  const accountedPct = total ? Math.round(((present + excused) / total) * 100) : 0;

  return (
    <div className="attendance-meter">
      <div className="attendance-meter-head">
        <div className="attendance-meter-legend">
          <span className="legend-item">
            <i className="dot dot-present" />
            <strong>{present}</strong> present
          </span>
          <span className="legend-item">
            <i className="dot dot-excused" />
            <strong>{excused}</strong> excused
          </span>
          <span className="legend-item">
            <i className="dot dot-waiting" />
            <strong>{waiting}</strong> {closed ? "absent" : "waiting"}
          </span>
        </div>
        <span className="attendance-meter-rate">
          <strong>{accountedPct}%</strong>
        </span>
      </div>
      <div
        className="attendance-meter-track"
        role="progressbar"
        aria-label="Attendance progress"
        aria-valuenow={accountedPct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {present > 0 && (
          <span
            className="meter-seg meter-present"
            style={{ width: `${presentPct}%` }}
          />
        )}
        {excused > 0 && (
          <span
            className="meter-seg meter-excused"
            style={{ width: `${excusedPct}%` }}
          />
        )}
      </div>
    </div>
  );
}

export function ProjectorModal({
  open,
  onClose,
  title,
  dateLabel,
  qr,
  joinUrl,
  present,
  excused,
  total,
  closed,
  onCopy,
  downloadName,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  dateLabel: string;
  qr: string;
  joinUrl: string;
  present: number;
  excused: number;
  total: number;
  closed: boolean;
  onCopy: () => void;
  downloadName: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const pct = total ? Math.round(((present + excused) / total) * 100) : 0;

  return (
    <div
      className="projector-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="projector-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="projector-stage">
        <div className="projector-topbar">
          <Brand size="sm" />
          <div className="projector-topbar-right">
            <span className={`badge ${closed ? "neutral" : ""}`}>
              <span /> {closed ? "Closed" : "Open"}
            </span>
            <button
              type="button"
              className="secondary compact"
              onClick={onClose}
              aria-label="Exit presentation mode"
            >
              <X size={16} /> Close
            </button>
          </div>
        </div>

        <div className="projector-body">
          <div className="projector-info">
            <h2 id="projector-title">{title}</h2>
            <p className="projector-date">{dateLabel}</p>

            <div className="projector-counter">
              <div className="projector-counter-nums">
                <strong>{present + excused}</strong>
                <span>/ {total} checked in</span>
              </div>
              <div className="projector-bar">
                <span style={{ width: `${pct}%` }} />
              </div>
              <div className="projector-substats">
                <span>{present} present</span>
                {excused > 0 && <span>· {excused} excused</span>}
                <span>· {Math.max(0, total - present - excused)} remaining</span>
              </div>
            </div>

            <p className="projector-instruction">
              Scan the QR code and enter your name or student ID.
            </p>

            <div className="projector-actions">
              <button
                type="button"
                className="primary"
                onClick={() => {
                  onCopy();
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2200);
                }}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? "Copied" : "Copy link"}
              </button>
              {qr && (
                <a className="secondary" href={qr} download={downloadName}>
                  <Download size={16} /> Save PNG
                </a>
              )}
            </div>
            <p className="projector-url" title={joinUrl}>
              {joinUrl}
            </p>
          </div>

          <div className="projector-qr-column">
            <div className="projector-qr-frame">
              <span className="qr-corner tl" aria-hidden="true" />
              <span className="qr-corner tr" aria-hidden="true" />
              <span className="qr-corner bl" aria-hidden="true" />
              <span className="qr-corner br" aria-hidden="true" />
              {qr ? (
                <img
                  src={qr}
                  width="360"
                  height="360"
                  alt="Large classroom QR code for student attendance check-in"
                />
              ) : (
                <div className="qr-placeholder">
                  <QrCode size={140} strokeWidth={1.2} />
                </div>
              )}
            </div>
            <span className="projector-hint">
              <kbd>Esc</kbd> to exit
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel,
  tone = "danger",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop confirm-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <section
        className="modal confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-desc"
      >
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-desc">{description}</p>
        <div className="confirm-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={tone === "danger" ? "danger" : "primary"}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

export function RosterPreview({
  students,
  total,
}: {
  students: { name: string; code: string }[];
  total: number;
}) {
  if (!total) return null;
  const sample = students.slice(0, 4);
  const extra = total - sample.length;
  return (
    <div className="roster-preview">
      <div className="roster-preview-head">
        <span>Preview</span>
        <strong>{total} students</strong>
      </div>
      <div className="roster-preview-list">
        {sample.map((s, idx) => (
          <div className="roster-preview-chip" key={`${s.name}-${idx}`}>
            <span>{s.name}</span>
            {s.code && <code>{s.code}</code>}
          </div>
        ))}
        {extra > 0 && (
          <span className="roster-preview-more">+{extra} more</span>
        )}
      </div>
    </div>
  );
}

export function EmptyWorkspaceStage({ onImport }: { onImport: () => void }) {
  return (
    <section className="panel empty-stage">
      <div className="empty-stage-main">
        <div className="upload-art">
          <Users size={30} />
          <span>
            <Upload size={12} />
          </span>
        </div>
        <h2>No classes yet</h2>
        <p>Import a CSV roster to start taking attendance.</p>
        <div className="empty-stage-actions">
          <button type="button" className="primary" onClick={onImport}>
            <Upload size={16} /> Import CSV
          </button>
          <a className="secondary" href="/sample-roster.csv" download>
            <Download size={15} /> Sample CSV
          </a>
        </div>
        <div className="csv-hint">
          <span>name</span>
          <span>
            student_id <small>(optional)</small>
          </span>
        </div>
      </div>
    </section>
  );
}

export function ProjectQrButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="primary full project-qr-btn"
      onClick={onClick}
    >
      <Maximize2 size={15} /> Project QR
    </button>
  );
}
