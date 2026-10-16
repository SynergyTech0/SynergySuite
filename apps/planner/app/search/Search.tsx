"use client";
import { useCallback, useEffect, useState } from "react";
import { dueState, shortDate } from "@/lib/due";

type Hit = {
  id: string; title: string; issueKey: string | null; issueType: string; priority: string;
  isComplete: boolean; dueDate: string | null; updatedAt: string; points: number | null;
  boardId: string; boardTitle: string; listTitle: string; statusCategory: string;
};
type Filter = { id: string; name: string; query: string };

const EXAMPLES = [
  "assignee = me AND statusCategory != done",
  "type = bug AND priority IN (high, highest) ORDER BY updated DESC",
  "label = blocked OR blocked = true",
  "due < 7d AND resolution IS EMPTY",
  "fixVersion = v2.4 ORDER BY status",
];
const TYPE_MARK: Record<string, string> = { epic: "E", story: "S", task: "T", bug: "B", subtask: "·" };
const json = (method: string, body?: unknown): RequestInit => ({
  method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export function Search() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState({ priority: "", issueType: "", complete: "" });
  const [bulkNote, setBulkNote] = useState<string | null>(null);

  const loadFilters = useCallback(async () => {
    const r = await fetch("/api/filters");
    if (r.ok) setFilters(await r.json());
  }, []);

  const run = useCallback(async (q: string) => {
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/search/jql?q=${encodeURIComponent(q)}`);
    const body = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setError(body.error || `Search failed (${r.status}).`); setHits(null); return; }
    setHits(body.cards);
    setSelected(new Set());
    const url = new URL(window.location.href);
    if (q.trim()) url.searchParams.set("q", q); else url.searchParams.delete("q");
    window.history.replaceState(null, "", url);
  }, []);

  useEffect(() => {
    loadFilters();
    const q = new URLSearchParams(window.location.search).get("q") ?? "";
    setQuery(q);
    run(q);
  }, [loadFilters, run]);

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  /** Apply the bulk change, then re-run the search so the list shows what actually happened. */
  async function applyBulk() {
    const set: Record<string, unknown> = {};
    if (bulk.priority) set.priority = bulk.priority;
    if (bulk.issueType) set.issueType = bulk.issueType;
    if (bulk.complete) set.isComplete = bulk.complete === "complete";
    if (!Object.keys(set).length || !selected.size) return;
    if (!confirm(`Apply this change to ${selected.size} issue(s)?`)) return;
    setBulkNote(null);
    const r = await fetch("/api/cards/bulk", json("POST", { ids: [...selected], set }));
    const b = await r.json().catch(() => ({}));
    if (!r.ok) { setError(b.error || `Bulk change refused (${r.status}).`); return; }
    const why = Object.entries(b.reasons ?? {}).map(([k, v]) => `${v} ${k}`).join(", ");
    setBulkNote(`${b.updated} updated${b.skipped ? `, ${b.skipped} skipped (${why})` : ""}.`);
    setBulk({ priority: "", issueType: "", complete: "" });
    run(query);
  }

  async function saveFilter() {
    const name = prompt("Name this filter");
    if (!name?.trim()) return;
    const r = await fetch("/api/filters", json("POST", { name, query }));
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error || "Could not save."); return; }
    loadFilters();
  }

  return (
    <div className="wrap searchpage">
      <div className="h1">Search</div>
      <div className="jqlbar">
        <input className="jqlinput" value={query} aria-label="Search query" spellCheck={false}
          placeholder='e.g. assignee = me AND statusCategory != done ORDER BY priority'
          onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run(query)} />
        <button className="btn" onClick={() => run(query)} disabled={busy}>{busy ? "Searching…" : "Search"}</button>
        <button className="mini" onClick={saveFilter} disabled={!query.trim()}>Save filter</button>
      </div>
      {error && <div className="bnote warn" onClick={() => setError(null)}>{error}</div>}

      <div className="searchlayout">
        <aside className="savedlist">
          <div className="mlabel">Saved filters</div>
          {filters.map((f) => (
            <div key={f.id} className="savedrow">
              <button className="linkbtn" onClick={() => { setQuery(f.query); run(f.query); }} title={f.query}>{f.name}</button>
              <button className="mini" aria-label={`Delete filter ${f.name}`}
                onClick={async () => { if (confirm(`Delete filter "${f.name}"?`)) { await fetch(`/api/filters/${f.id}`, json("DELETE")); loadFilters(); } }}>✕</button>
            </div>
          ))}
          {!filters.length && <div className="muted" style={{ fontSize: 12 }}>None yet — search, then Save filter.</div>}
          <div className="mlabel" style={{ marginTop: 16 }}>Examples</div>
          {EXAMPLES.map((e) => (
            <div key={e} className="savedrow">
              <button className="linkbtn" onClick={() => { setQuery(e); run(e); }}>{e}</button>
            </div>
          ))}
        </aside>

        <div className="results">
          {hits && (
            <div className="resulthead">
              <label className="selall">
                <input type="checkbox" aria-label="Select all results"
                  checked={!!hits.length && selected.size === hits.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(hits.map((h) => h.id)) : new Set())} />
                {hits.length} issue{hits.length === 1 ? "" : "s"}{selected.size ? ` · ${selected.size} selected` : ""}
              </label>
            </div>
          )}
          {selected.size > 0 && (
            <div className="bulkbar">
              <span className="muted">Change {selected.size}:</span>
              <select className="plainsel" aria-label="Bulk priority" value={bulk.priority} onChange={(e) => setBulk({ ...bulk, priority: e.target.value })}>
                <option value="">Priority…</option>
                {["highest", "high", "medium", "low", "lowest"].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select className="plainsel" aria-label="Bulk type" value={bulk.issueType} onChange={(e) => setBulk({ ...bulk, issueType: e.target.value })}>
                <option value="">Type…</option>
                {["epic", "story", "task", "bug", "subtask"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select className="plainsel" aria-label="Bulk completion" value={bulk.complete} onChange={(e) => setBulk({ ...bulk, complete: e.target.value })}>
                <option value="">Completion…</option>
                <option value="complete">Mark complete</option>
                <option value="open">Reopen</option>
              </select>
              <button className="btn" onClick={applyBulk}>Apply</button>
              <button className="mini" onClick={() => setSelected(new Set())}>Clear selection</button>
            </div>
          )}
          {bulkNote && <div className="bnote" onClick={() => setBulkNote(null)}>{bulkNote}</div>}
          {hits?.map((h) => {
            const due = dueState(h.dueDate, h.isComplete);
            return (
              <div key={h.id} className={`brow resultrow${selected.has(h.id) ? " picked" : ""}`}>
                <input type="checkbox" aria-label={`Select ${h.issueKey ?? h.title}`} checked={selected.has(h.id)}
                  onChange={() => toggleOne(h.id)} />
                <a href={`/b/${h.boardId}?card=${h.id}`} className="resultlink">
                <span className={`itype ${h.issueType}`}>{TYPE_MARK[h.issueType]}</span>
                {h.issueKey && <span className="ikey">{h.issueKey}</span>}
                <span className="btitle">{h.title}</span>
                <span className={`cat ${h.statusCategory}`}>{h.listTitle}</span>
                {h.points != null && <span className="pts">{h.points}</span>}
                {due && due !== "later" && <span className={`fb due ${due}`}>{h.dueDate ? shortDate(h.dueDate) : ""}</span>}
                <span className="muted resultboard">{h.boardTitle}</span>
                </a>
              </div>
            );
          })}
          {hits && !hits.length && <div className="bempty">No issues match.</div>}
        </div>
      </div>
    </div>
  );
}
