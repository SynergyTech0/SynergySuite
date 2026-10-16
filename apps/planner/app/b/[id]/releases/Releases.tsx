"use client";
import { useCallback, useEffect, useState } from "react";

type Stamp = string | Date | null;
type Version = {
  id: string; name: string; description: string | null; startDate: Stamp; releaseDate: Stamp; releasedAt: Stamp;
  isArchived: boolean; total: number; done: number;
};
type Component = { id: string; name: string; description: string | null; leadId: string | null; lead: string | null };
type Person = { id: string; name: string; isMind: boolean };
type Issue = { id: string; title: string; issueKey: string | null; isComplete: boolean; issueType?: string; fixVersions?: { id: string }[] };

const json = (method: string, body?: unknown): RequestInit => ({
  method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const day = (v: Stamp) => (v ? new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");
const DAY = 86400000;

function status(v: Version): { label: string; cls: string } {
  if (v.releasedAt) return { label: "Released", cls: "released" };
  if (v.releaseDate && new Date(v.releaseDate).getTime() + DAY < Date.now()) return { label: "Overdue", cls: "overdue" };
  return { label: "Unreleased", cls: "unreleased" };
}

export function Releases({ board, initialVersions, initialComponents, canAdmin }:
  { board: { id: string; title: string; keyPrefix: string }; initialVersions: Version[]; initialComponents: Component[]; canAdmin: boolean }) {
  const [versions, setVersions] = useState<Version[]>(initialVersions);
  const [components, setComponents] = useState<Component[]>(initialComponents);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [releasing, setReleasing] = useState<Version | null>(null);
  const [carryTo, setCarryTo] = useState("");
  const [draft, setDraft] = useState({ name: "", startDate: "", releaseDate: "", description: "" });
  const [compDraft, setCompDraft] = useState({ name: "", leadId: "" });
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [v, c, s] = await Promise.all([
      fetch(`/api/boards/${board.id}/versions`), fetch(`/api/boards/${board.id}/components`), fetch(`/api/boards/${board.id}`),
    ]);
    if (v.ok) setVersions(await v.json());
    if (c.ok) setComponents(await c.json());
    if (s.ok) setIssues((await s.json()).cards);
  }, [board.id]);

  useEffect(() => {
    refresh();
    fetch("/api/users").then((r) => (r.ok ? r.json() : [])).then(setPeople);
    const es = new EventSource(`/api/stream/${board.id}`);
    es.onmessage = () => refresh();
    return () => es.close();
  }, [board.id, refresh]);

  async function send(url: string, init: RequestInit) {
    setError(null);
    const r = await fetch(url, init);
    if (!r.ok) setError((await r.json().catch(() => ({}))).error || `Refused (${r.status}).`);
    await refresh();
    return r;
  }

  async function createVersion() {
    if (!draft.name.trim()) return;
    const r = await send(`/api/boards/${board.id}/versions`, json("POST", {
      name: draft.name, description: draft.description || undefined,
      startDate: draft.startDate || null, releaseDate: draft.releaseDate || null,
    }));
    if (r.ok) setDraft({ name: "", startDate: "", releaseDate: "", description: "" });
  }

  async function release() {
    if (!releasing) return;
    const r = await send(`/api/versions/${releasing.id}/release`, json("POST", { moveUnresolvedTo: carryTo || null }));
    if (r.ok) { setReleasing(null); setCarryTo(""); }
  }

  async function createComponent() {
    if (!compDraft.name.trim()) return;
    const r = await send(`/api/boards/${board.id}/components`, json("POST", { name: compDraft.name, leadId: compDraft.leadId || null }));
    if (r.ok) setCompDraft({ name: "", leadId: "" });
  }

  const shown = versions.filter((v) => !v.isArchived);

  return (
    <div className="boardpage">
      <div className="boardhead">
        <a href={`/b/${board.id}`} className="back">← {board.title}</a>
        <h1>Releases</h1>
        <span className="spill">{board.keyPrefix}</span>
        <div style={{ flex: 1 }} />
        <a href={`/b/${board.id}/backlog`} className="mini">Backlog</a>
      </div>
      {error && <div className="bnote warn" onClick={() => setError(null)}>{error}</div>}

      <div className="backlog">
        <section className="sprint">
          <div className="shead"><b>Versions</b><span className="muted">{shown.length}</span></div>
          {canAdmin && (
            <div className="relform">
              <input placeholder="Version name, e.g. v2.4" value={draft.name} aria-label="Version name"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && createVersion()} />
              <label className="dfield">Start<input type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} /></label>
              <label className="dfield">Release<input type="date" value={draft.releaseDate} onChange={(e) => setDraft({ ...draft, releaseDate: e.target.value })} /></label>
              <input placeholder="Description (optional)" value={draft.description} style={{ flex: 1 }} aria-label="Version description"
                onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              <button className="btn" onClick={createVersion}>Create version</button>
            </div>
          )}
          {shown.map((v) => {
            const st = status(v);
            const pct = v.total ? Math.round((v.done / v.total) * 100) : 0;
            const mine = issues.filter((i) => i.fixVersions?.some((f) => f.id === v.id));
            return (
              <div key={v.id} className="relrow">
                <div className="relmain" onClick={() => setOpen(open === v.id ? null : v.id)}>
                  <span className="relname">{open === v.id ? "▾" : "▸"} {v.name}</span>
                  <span className={`relstatus ${st.cls}`}>{st.label}</span>
                  <div className="relprog" title={`${v.done} of ${v.total} issues done`}>
                    <div className="rollup" style={{ marginTop: 0 }}><div style={{ width: `${pct}%` }} /></div>
                    <span className="muted">{v.done}/{v.total}</span>
                  </div>
                  <span className="muted reldates">{day(v.startDate)} → {v.releasedAt ? `released ${day(v.releasedAt)}` : day(v.releaseDate)}</span>
                  {canAdmin && (
                    <span className="relactions" onClick={(e) => e.stopPropagation()}>
                      {v.releasedAt
                        ? <button className="mini" onClick={() => send(`/api/versions/${v.id}`, json("PATCH", { released: false }))}>Unrelease</button>
                        : <button className="mini" onClick={() => { setReleasing(v); setCarryTo(""); }}>Release</button>}
                      <button className="mini" onClick={() => send(`/api/versions/${v.id}`, json("PATCH", { isArchived: true }))}>Archive</button>
                      <button className="mini" onClick={() => { if (confirm(`Delete ${v.name}? Issues lose this fix version; the issues themselves stay.`)) send(`/api/versions/${v.id}`, json("DELETE")); }}>Delete</button>
                    </span>
                  )}
                </div>
                {v.description && <div className="muted" style={{ fontSize: 12, padding: "0 12px 6px 28px" }}>{v.description}</div>}
                {open === v.id && (
                  <div className="bzone">
                    {mine.map((i) => (
                      <a key={i.id} href={`/b/${board.id}?card=${i.id}`} className={`brow ${i.isComplete ? "done" : ""}`}>
                        {i.issueKey && <span className="ikey">{i.issueKey}</span>}
                        <span className="btitle">{i.title}</span>
                        <span className={`relstatus ${i.isComplete ? "released" : "unreleased"}`}>{i.isComplete ? "Done" : "Open"}</span>
                      </a>
                    ))}
                    {!mine.length && <div className="bempty">No issues have this fix version yet — set it on a card.</div>}
                  </div>
                )}
              </div>
            );
          })}
          {!shown.length && <div className="bempty">No versions yet.</div>}
        </section>

        <section className="sprint">
          <div className="shead"><b>Components</b><span className="muted">{components.length}</span></div>
          {canAdmin && (
            <div className="relform">
              <input placeholder="Component name, e.g. Payments" value={compDraft.name} aria-label="Component name"
                onChange={(e) => setCompDraft({ ...compDraft, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && createComponent()} />
              <select className="plainsel" value={compDraft.leadId} aria-label="Component lead" onChange={(e) => setCompDraft({ ...compDraft, leadId: e.target.value })}>
                <option value="">No lead</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button className="btn" onClick={createComponent}>Add component</button>
            </div>
          )}
          {components.map((c) => (
            <div key={c.id} className="brow" style={{ cursor: "default", margin: "4px 8px" }}>
              <span className="btitle">{c.name}</span>
              <span className="muted" style={{ fontSize: 12 }}>{c.lead ? `Lead: ${c.lead}` : "No lead"}</span>
              <span className="muted" style={{ fontSize: 12 }}>{issues.filter((i) => (i as { components?: { id: string }[] }).components?.some((x) => x.id === c.id)).length} issues</span>
              {canAdmin && (
                <button className="mini" onClick={() => { if (confirm(`Delete component ${c.name}?`)) send(`/api/components/${c.id}`, json("DELETE")); }}>Delete</button>
              )}
            </div>
          ))}
          {!components.length && <div className="bempty">No components yet.</div>}
        </section>
      </div>

      {releasing && (
        <div className="modal-bg" onClick={() => setReleasing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-top"><b style={{ flex: 1 }}>Release {releasing.name}</b><button className="mini" onClick={() => setReleasing(null)}>✕</button></div>
            <p className="muted" style={{ margin: "10px 0" }}>
              {releasing.total - releasing.done} of {releasing.total} issues are unfinished.
            </p>
            {releasing.total - releasing.done > 0 && (
              <label className="dfield">Unfinished issues
                <select className="plainsel" value={carryTo} aria-label="Move unfinished issues to" onChange={(e) => setCarryTo(e.target.value)}>
                  <option value="">Leave them on {releasing.name}</option>
                  {versions.filter((v) => v.id !== releasing.id && !v.releasedAt && !v.isArchived).map((v) => (
                    <option key={v.id} value={v.id}>Move to {v.name}</option>
                  ))}
                </select>
              </label>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button className="btn" onClick={release}>Release</button>
              <button className="mini" onClick={() => setReleasing(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
