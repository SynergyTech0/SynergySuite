"use client";
// Retention: how long each app may keep content. Apps delete older content for everyone not on hold.
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { RetentionRuleRecord } from "@/lib/types";
import { api, formatDate } from "./client";
import { Confirm, Modal } from "./Modal";
import { appLabel, type AppCtx } from "./shared";

type Data = { rules: RetentionRuleRecord[]; kinds: Record<string, string[]>; apps: { id: string; name: string }[]; canEdit: boolean };

/** "400 days" → "400 days (about 1 year 1 month)". */
function about(days: number): string {
  if (days < 60) return `${days} ${days === 1 ? "day" : "days"}`;
  const years = Math.floor(days / 365);
  const months = Math.round((days % 365) / 30.4);
  const parts = [years ? `${years} ${years === 1 ? "year" : "years"}` : "", months ? `${months} ${months === 1 ? "month" : "months"}` : ""].filter(Boolean);
  return `${days} days (about ${parts.join(" ")})`;
}

export function Retention({ app }: { app: AppCtx }) {
  const [d, setD] = useState<Data | null>(null);
  const [editing, setEditing] = useState<RetentionRuleRecord | "new" | null>(null);
  const [removing, setRemoving] = useState<RetentionRuleRecord | null>(null);
  const load = useCallback(() => {
    void api<Data>("/api/retention").then(setD).catch((e) => app.say(e.message));
  }, [app]);
  useEffect(load, [load]);

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="pagehead">
        <div>
          <h1>Retention</h1>
          <p className="muted">How long content may live in each app. The shortest rule that matches wins.</p>
        </div>
        {d?.canEdit ? <button className="btn primary" onClick={() => setEditing("new")}><Plus size={16} /> New rule</button> : null}
      </div>
      <div className="notice danger">
        <AlertTriangle size={16} />
        <div>
          <p><strong>Retention rules permanently delete content, for everyone who is not on hold.</strong></p>
          <p>Each app checks its rules about once an hour and removes anything older than the rule allows: people&apos;s own mail, files and messages included. Deleted content can&apos;t be brought back. Only custodians of an active hold in an open matter are spared. Apps that can&apos;t reach the Admin center delete nothing.</p>
        </div>
      </div>
      {d && !d.canEdit ? <p className="muted small">Only admins change retention rules.</p> : null}
      <section className="panel flush">
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>App</th><th>Content</th><th>Deleted after</th><th>Set by</th><th /></tr></thead>
            <tbody>
              {!d ? <tr><td colSpan={5} className="muted">Loading…</td></tr>
                : !d.rules.length ? <tr><td colSpan={5}><div className="empty"><p>No retention rules: apps keep content until people delete it.</p></div></td></tr>
                : d.rules.map((r) => (
                  <tr key={r.id}>
                    <td className="rname">{appLabel(app, r.app)}</td>
                    <td>{r.kind ? <code>{r.kind}</code> : <span className="muted">Everything</span>}</td>
                    <td>{about(r.days)}</td>
                    <td><div className="cellstack"><span>{r.createdBy}</span><span className="rsub">{formatDate(r.createdAt)}</span></div></td>
                    <td className="num nowrap">
                      {d.canEdit ? (
                        <>
                          <button className="btn small" onClick={() => setEditing(r)}>Change</button>{" "}
                          <button className="iconbtn small" aria-label="Delete rule" title="Delete rule" onClick={() => setRemoving(r)}><Trash2 size={14} /></button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      {editing && d ? <RuleEditor data={d} rule={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); app.say("Rule saved"); load(); }} /> : null}
      {removing ? (
        <Confirm
          title="Delete this rule?"
          action="Delete rule"
          message={<>{appLabel(app, removing.app)} will stop deleting {removing.kind ? <code>{removing.kind}</code> : "content"} by age.</>}
          onConfirm={async () => {
            try {
              await api(`/api/retention/${removing.id}`, { method: "DELETE" });
              app.say("Rule deleted");
              load();
            } catch (e) {
              app.say((e as Error).message);
            }
          }}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </div>
  );
}

function RuleEditor({ data, rule, onClose, onSaved }: { data: Data; rule?: RetentionRuleRecord; onClose: () => void; onSaved: () => void }) {
  const [appId, setAppId] = useState(rule?.app ?? Object.keys(data.kinds)[0] ?? data.apps[0]?.id ?? "");
  const [days, setDays] = useState(String(rule?.days ?? 365));
  const [error, setError] = useState("");
  const [sure, setSure] = useState(false);
  const kinds = data.kinds[appId] ?? [];
  const n = Number(days);
  return (
    <Modal title={rule ? "Change retention rule" : "New retention rule"} onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            await api("/api/retention", { method: "POST", json: { app: appId, kind: f.get("kind"), days: Number(days) } });
            onSaved();
          } catch (x) {
            setError((x as Error).message);
          }
        }}
      >
        <label>
          <span>App</span>
          <select value={appId} onChange={(e) => setAppId(e.target.value)} disabled={!!rule}>
            {data.apps.map((a) => <option key={a.id} value={a.id}>{a.name}{data.kinds[a.id] ? "" : " (may not support retention)"}</option>)}
          </select>
        </label>
        <label>
          <span>Kind of content (empty = everything in the app)</span>
          <input name="kind" list="kinds" defaultValue={rule?.kind ?? ""} readOnly={!!rule} placeholder={kinds.length ? `e.g. ${kinds[0]}` : "e.g. message"} />
          <datalist id="kinds">{kinds.map((k) => <option key={k} value={k} />)}</datalist>
        </label>
        {kinds.length ? <p className="muted small">{data.apps.find((a) => a.id === appId)?.name} keeps: {kinds.join(", ")}</p> : null}
        <label>
          <span>Delete content older than (days)</span>
          <input type="number" min={1} max={36500} step={1} value={days} onChange={(e) => setDays(e.target.value)} required />
        </label>
        <div className="notice danger">
          <div>
            <p>Content older than {Number.isInteger(n) && n >= 1 ? about(n) : "this"} will be <strong>permanently deleted</strong> for everyone not on hold, within about an hour.</p>
          </div>
        </div>
        <label className="check"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> I understand this deletes content</label>
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn danger" disabled={!sure}>Save rule</button>
        </div>
      </form>
    </Modal>
  );
}
