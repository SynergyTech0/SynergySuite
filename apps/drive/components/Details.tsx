"use client";
import { History, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { FileIcon } from "./FileIcon";
import { type Item, type Role, api, contentUrl, formatSize, formatWhen, person } from "./client";

type Detail = Item & { role: Role; summary: string | null; hasText: boolean };
type Version = { n: number; size: number; createdBy: string; createdAt: string; current: boolean };
type Event = { actor: string; action: string; detail: string; at: string };

/** Side panel: properties, version history, activity and an AI summary. */
export function Details({ id, me, ai, onClose, onChanged, onShare }: {
  id: string; me: string; ai: boolean; onClose: () => void; onChanged: () => void; onShare: () => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setError("");
    api<Detail>(`/api/items/${id}`).then((x) => {
      setD(x);
      setSummary(x.summary);
      if (x.kind === "file") api<{ versions: Version[] }>(`/api/items/${id}/versions`).then((v) => setVersions(v.versions));
      else setVersions([]);
    }, (e) => setError(e.message));
    api<{ activity: Event[] }>(`/api/items/${id}/activity`).then((a) => setEvents(a.activity), () => setEvents([]));
  }, [id, tick]);

  if (!d) return <aside className="details">{error ? <p className="error pad">{error}</p> : <p className="muted pad">Loading…</p>}</aside>;
  const canEdit = d.role !== "viewer";

  return (
    <aside className="details" aria-label="Details">
      <div className="detailshead">
        <FileIcon kind={d.kind} name={d.name} size={28} />
        <h2 className="grow">{d.name}</h2>
        <button className="iconbtn" aria-label="Close details" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="detailsbody">
        <section>
          <button className="btn small" onClick={onShare}>{d.shared ? "Manage access" : "Share"}</button>
        </section>
        <section>
          <h3>Properties</h3>
          <dl>
            <dt>Type</dt>
            <dd>{d.kind === "folder" ? "Folder" : d.mime || "File"}</dd>
            {d.kind === "file" && (
              <>
                <dt>Size</dt>
                <dd>{formatSize(d.size)}</dd>
              </>
            )}
            <dt>Where</dt>
            <dd>{d.location}</dd>
            <dt>Modified</dt>
            <dd>{formatWhen(d.modifiedAt)} by {person(d.modifiedBy, me)}</dd>
            <dt>Created</dt>
            <dd>{new Date(d.createdAt).toLocaleString()}</dd>
            {d.owner && (
              <>
                <dt>Owner</dt>
                <dd>{person(d.owner, me)}</dd>
              </>
            )}
            <dt>Your access</dt>
            <dd>{d.role === "owner" ? "Owner" : d.role === "editor" ? "Can edit" : "Can view"}</dd>
          </dl>
        </section>
        {d.hasText && (
          <section>
            <h3>Summary</h3>
            {summary ? (
              <p>{summary}</p>
            ) : ai ? (
              <button
                className="btn small"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    setSummary((await api<{ summary: string }>(`/api/items/${id}/summary`, { method: "POST" })).summary);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Sparkles size={14} /> {busy ? "Summarizing…" : "Summarize with AI"}
              </button>
            ) : (
              <p className="muted small">AI is off on this server.</p>
            )}
          </section>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        {d.kind === "file" && (
          <section>
            <h3><History size={14} /> Version history</h3>
            <ul className="versions">
              {versions.map((v) => (
                <li key={v.n}>
                  <div className="grow">
                    <b>Version {v.n}</b> {v.current && <span className="tag">Current</span>}
                    <div className="muted small">
                      {formatWhen(v.createdAt)} · {person(v.createdBy, me)} · {formatSize(v.size)}
                    </div>
                  </div>
                  <a className="linkbtn small" href={contentUrl(id, { v: v.n })}>Download</a>
                  {!v.current && canEdit && (
                    <button
                      className="linkbtn small"
                      onClick={async () => {
                        try {
                          await api(`/api/items/${id}/versions/${v.n}`, { method: "POST" });
                          setTick((t) => t + 1);
                          onChanged();
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      Restore
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section>
          <h3>Activity</h3>
          <ul className="activity">
            {events.map((e, i) => (
              <li key={i}>
                <b>{person(e.actor, me)}</b> {e.action}
                {e.detail ? ` ${e.detail}` : ""}
                <div className="muted small">{formatWhen(e.at)}</div>
              </li>
            ))}
            {!events.length && <li className="muted small">Nothing yet</li>}
          </ul>
        </section>
      </div>
    </aside>
  );
}
