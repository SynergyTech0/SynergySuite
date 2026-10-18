"use client";
import { useState } from "react";
import { api } from "./client";

/** The application form on a job's careers page. */
export function ApplyForm({ slug }: { slug: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  if (done) return <p className="ok">Thank you. Your application has been sent, and the team will be in touch.</p>;
  return (
    <form
      className="form"
      style={{ padding: "12px 0 0" }}
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setErr("");
        try {
          await api(`/api/public/apply/${encodeURIComponent(slug)}`, { method: "POST", json: Object.fromEntries(f) });
          setDone(true);
        } catch (e) {
          setErr((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="row2">
        <label><span>Name</span><input name="name" required maxLength={160} autoComplete="name" /></label>
        <label><span>Email</span><input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
      </div>
      <div className="row2">
        <label><span>Phone (optional)</span><input name="phone" maxLength={40} autoComplete="tel" /></label>
        <label><span>LinkedIn or portfolio (optional)</span><input name="profileUrl" type="url" placeholder="https://" /></label>
      </div>
      <label><span>Link to your résumé (optional)</span><input name="resumeUrl" type="url" placeholder="https://" /></label>
      <label><span>Why this job? (optional)</span><textarea name="coverNote" maxLength={5000} rows={5} /></label>
      <label className="hp" aria-hidden="true">
        <span>Website</span>
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      <p className="error">{err}</p>
      <div className="actions">
        <button className="btn primary" disabled={busy}>{busy ? "Sending…" : "Send application"}</button>
      </div>
    </form>
  );
}
