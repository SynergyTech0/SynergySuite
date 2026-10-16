"use client";
import { Building2, Copy, Link2, Lock, X } from "lucide-react";
import { useState } from "react";
import type { VideoDetail } from "@/lib/videos";
import { api, person } from "./client";
import { Modal } from "./Modal";

/** Who can watch: people added one by one, everyone in the organization, and an optional link. */
export function ShareDialog({ video, onChange, onClose }: { video: VideoDetail; onChange: (v: VideoDetail) => void; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const link = video.share_token ? `${location.origin}/s/${video.share_token}` : "";
  const embed = video.share_token
    ? `<iframe src="${location.origin}/embed/${video.share_token}" width="640" height="360" allow="fullscreen; picture-in-picture" style="border:0"></iframe>`
    : "";

  const act = async (fn: () => Promise<{ video: VideoDetail }>) => {
    try {
      setError("");
      onChange((await fn()).video);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const copy = async (what: string, label: string) => {
    await navigator.clipboard.writeText(what).catch(() => {});
    setCopied(label);
    setTimeout(() => setCopied(""), 1500);
  };

  return (
    <Modal title={`Share "${video.title}"`} onClose={onClose}>
      <div className="form">
        <fieldset className="choices">
          <label>
            <input
              type="radio"
              name="vis"
              checked={video.visibility === "private"}
              onChange={() => act(() => api(`/api/videos/${video.id}`, { method: "PATCH", json: { visibility: "private" } }))}
            />
            <Lock size={15} /> <span><strong>Only people I add</strong></span>
          </label>
          <label>
            <input
              type="radio"
              name="vis"
              checked={video.visibility === "org"}
              onChange={() => act(() => api(`/api/videos/${video.id}`, { method: "PATCH", json: { visibility: "org" } }))}
            />
            <Building2 size={15} /> <span><strong>Everyone in the organization</strong> <span className="muted small">It shows on their Organization shelf.</span></span>
          </label>
        </fieldset>

        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => api(`/api/videos/${video.id}/members`, { method: "POST", json: { email } })).then(() => setEmail(""));
          }}
        >
          <input className="grow" type="email" placeholder="Add people by email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn primary" disabled={!email.trim()}>Add</button>
        </form>
        {video.members.length > 0 && (
          <ul className="people">
            {video.members.map((m) => (
              <li key={m}>
                <span className="grow">{person(m)} <span className="muted small">{m}</span></span>
                <button
                  className="iconbtn small"
                  aria-label={`Stop sharing with ${m}`}
                  onClick={() => act(() => api(`/api/videos/${video.id}/members`, { method: "DELETE", json: { email: m } }))}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="linkbox">
          <div className="row">
            <Link2 size={16} />
            <span className="grow">
              <strong>Anyone with the link</strong>
              <span className="muted small"> can watch without signing in</span>
            </span>
            <label className="switch">
              <input
                type="checkbox"
                checked={!!video.share_token}
                onChange={(e) => act(() => api(`/api/videos/${video.id}/link`, { method: e.target.checked ? "POST" : "DELETE" }))}
              />
              <span>{video.share_token ? "On" : "Off"}</span>
            </label>
          </div>
          {link && (
            <>
              <div className="row">
                <input className="grow" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
                <button className="btn small" onClick={() => copy(link, "link")}>
                  <Copy size={14} /> {copied === "link" ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="row">
                <input className="grow" readOnly value={embed} onFocus={(e) => e.currentTarget.select()} aria-label="Embed code" />
                <button className="btn small" onClick={() => copy(embed, "embed")}>
                  <Copy size={14} /> {copied === "embed" ? "Copied" : "Embed code"}
                </button>
              </div>
              <button className="linkbtn small" onClick={() => act(() => api(`/api/videos/${video.id}/link`, { method: "POST" }))}>
                Make a new link (the current one stops working)
              </button>
            </>
          )}
        </div>
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </Modal>
  );
}
