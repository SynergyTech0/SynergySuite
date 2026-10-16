"use client";
import { RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { GroupDetail } from "@/lib/types";
import { ago, api, person } from "./client";
import { Confirm } from "./Modal";

const APP_LABEL: Record<string, string> = { chat: "Chat workspace", drive: "Drive library", calendar: "Group calendar", mail: "Mail address", sites: "Site" };

type Entry = { actor: string; action: string; detail: string; at: string };

export function Settings({ g, onChanged, onDeleted }: { g: GroupDetail; onChanged: (g?: GroupDetail) => void; onDeleted: () => void }) {
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [log, setLog] = useState<Entry[] | null>(null);
  const alias = g.email ? g.email.split("@")[0] : "";
  const domain = g.email ? g.email.split("@")[1] : "";

  useEffect(() => {
    api<{ entries: Entry[] }>(`/api/groups/${g.id}/audit`).then((d) => setLog(d.entries), () => setLog([]));
  }, [g.id, g.syncedAt]);

  return (
    <>
      <form
        className="form box"
        style={{ maxWidth: 640 }}
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setError("");
          setSaved(false);
          try {
            onChanged(
              await api<GroupDetail>(`/api/groups/${g.id}`, {
                method: "PATCH",
                json: {
                  name: f.get("name"),
                  description: f.get("description"),
                  privacy: f.get("privacy"),
                  ...(g.kind !== "security" ? { alias: f.get("alias") } : {}),
                  ...(g.kind === "distribution" ? { allowExternal: f.get("allowExternal") === "on" } : {}),
                },
              }),
            );
            setSaved(true);
          } catch (x) {
            setError((x as Error).message);
          }
        }}
      >
        <h2>Settings</h2>
        <label><span>Name</span><input name="name" defaultValue={g.name} maxLength={80} required /></label>
        <label><span>Description</span><textarea name="description" defaultValue={g.description} maxLength={1000} rows={2} /></label>
        {g.kind !== "security" && (
          <label>
            <span>Email address</span>
            <div className="toolbar" style={{ flexWrap: "nowrap" }}>
              <input name="alias" defaultValue={alias} style={{ flex: 1 }} required={g.kind !== "team"} />
              {domain && <span className="muted">@{domain}</span>}
            </div>
          </label>
        )}
        <label>
          <span>Privacy</span>
          <select name="privacy" defaultValue={g.privacy}>
            <option value="private">Private: owners add people</option>
            <option value="public">Public: anyone can join</option>
          </select>
        </label>
        {g.kind === "distribution" && (
          <label className="check"><input type="checkbox" name="allowExternal" defaultChecked={g.allowExternal} /> People outside the organization can send to it</label>
        )}
        {error && <p className="error">{error}</p>}
        <div className="actions">
          {saved && <span className="ok small">Saved</span>}
          <button className="btn primary">Save</button>
        </div>
      </form>

      {g.resources.length > 0 && (
        <section className="box" style={{ maxWidth: 640 }}>
          <h2>
            <span>In the other apps</span>
            <button
              className="btn small"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  onChanged(await api<GroupDetail>(`/api/groups/${g.id}/sync`, { method: "POST" }));
                } catch (x) {
                  setError((x as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <RefreshCw size={14} /> Update now
            </button>
          </h2>
          <div className="list">
            {g.resources.map((r) => (
              <div key={r.app} className="item">
                <span className="status"><span className={`dot ${r.status}`} /> {APP_LABEL[r.app] ?? r.app}</span>
                <span className="grow muted small">{r.status === "error" ? r.error : r.status === "off" ? "Removed" : r.name}</span>
                <span className="muted small">{ago(r.syncedAt)}</span>
              </div>
            ))}
          </div>
          <p className="muted small" style={{ margin: 0 }}>Membership changes reach every app right away, and are checked again every 15 minutes.</p>
        </section>
      )}

      <section className="box" style={{ maxWidth: 640 }}>
        <h2>History</h2>
        {!log ? (
          <p className="muted small">Loading…</p>
        ) : (
          <div className="list">
            {log.slice(0, 30).map((e, i) => (
              <div key={i} className="item small">
                <span className="grow"><b>{person(e.actor)}</b> {e.action}{e.detail ? `: ${e.detail}` : ""}</span>
                <span className="muted">{ago(e.at)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={{ maxWidth: 640 }}>
        <button className="btn danger" onClick={() => setDeleting(true)}><Trash2 size={14} /> Delete {g.kind === "team" ? "team" : "group"}</button>
      </section>
      {deleting && (
        <Confirm
          title={`Delete ${g.name}?`}
          message={
            g.kind === "team"
              ? "Everyone loses its channels, files, calendar and mailbox. Nothing is erased: an owner can restore the team for 30 days."
              : "Its address stops working. An owner can restore it for 30 days."
          }
          action="Delete"
          danger
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await api(`/api/groups/${g.id}`, { method: "DELETE" });
            onDeleted();
          }}
        />
      )}
    </>
  );
}
