"use client";
// Content search: one query sent to every app at once. Results show per app, with any app that
// failed or timed out named next to the others. Save a search to a matter to export it.
import { AlertTriangle, Download, FileArchive, Paperclip, Save, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ExportItem } from "@synergy/compliance";
import type { AppResult, AppHit } from "@/lib/fanout";
import type { SavedSearch } from "@/lib/types";
import { api, formatDate, formatDateTime, formatSize, plural, saveBase64 } from "./client";
import { PickMatter } from "./Holds";
import { Modal } from "./Modal";
import { AppPicker, Badge, Facts, PeoplePicker, appLabel, type AppCtx } from "./shared";

type Form = { query: string; custodians: string[]; apps: string[]; from: string; to: string };
type Result = { results: Omit<AppResult, "hits">[]; hits: AppHit[]; counts: Record<string, number> };

const EMPTY: Form = { query: "", custodians: [], apps: [], from: "", to: "" };

export function QueryHelp() {
  return (
    <details className="help">
      <summary>How keywords work</summary>
      <ul>
        <li><code>budget forecast</code> finds content with both words (in any order).</li>
        <li><code>&quot;board meeting&quot;</code> keeps a phrase together.</li>
        <li><code>contract OR agreement</code> finds either word.</li>
        <li><code>-draft</code> or <code>-&quot;out of office&quot;</code> leaves out content with it.</li>
        <li>Matching ignores case and finds parts of words: <code>invoice</code> also finds <em>invoices</em>.</li>
        <li>Leave keywords empty to find everything the custodians own in the dates.</li>
      </ul>
    </details>
  );
}

export function SearchView({ app, savedId }: { app: AppCtx; savedId: string | null }) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [saved, setSaved] = useState<SavedSearch | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [cursors, setCursors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [item, setItem] = useState<AppHit | null>(null);
  const [saving, setSaving] = useState<{ id: string; name: string } | null>(null);
  const [picking, setPicking] = useState(false);

  const run = useCallback(async (f: Form, more = false) => {
    setBusy(true);
    setError("");
    try {
      const r = await api<Result>("/api/search", { method: "POST", json: { ...f, from: f.from || undefined, to: f.to || undefined, cursors: more ? cursors : undefined } });
      const next: Record<string, string> = {};
      for (const x of r.results) if (x.nextCursor) next[x.app] = x.nextCursor;
      setCursors(next);
      if (more) {
        setResult((cur) => {
          if (!cur) return r;
          const keep = cur.results.map((old) => r.results.find((n) => n.app === old.app) ?? { ...old, nextCursor: undefined });
          const seen = new Set(cur.hits.map((h) => `${h.app}:${h.id}`));
          return { ...cur, results: keep, hits: [...cur.hits, ...r.hits.filter((h) => !seen.has(`${h.app}:${h.id}`))] };
        });
      } else {
        setResult(r);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [cursors]);

  useEffect(() => {
    if (!savedId) return;
    void api<SavedSearch>(`/api/searches/${savedId}`).then((s) => {
      setSaved(s);
      const f = { query: s.query, custodians: s.custodians, apps: s.apps, from: s.from ?? "", to: s.to ?? "" };
      setForm(f);
      void run(f);
    }).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per saved search
  }, [savedId]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const total = result ? Object.values(result.counts).reduce((a, b) => a + b, 0) : 0;
  const failed = result?.results.filter((r) => !r.ok) ?? [];

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          {saved ? <div className="crumbs"><a href="#/matters">Matters</a> <span>/</span> <a href={`#/matters/${saved.matterId}/searches`}>Matter</a> <span>/</span> <span>{saved.name}</span></div> : null}
          <h1>{saved ? saved.name : "Content search"}</h1>
          <p className="muted">Searches every app that keeps people&apos;s content, including what people deleted while on hold. Every search is recorded in the audit log.</p>
        </div>
        {saved ? (
          <button className="btn" onClick={async () => {
            try {
              await api(`/api/searches/${saved.id}/export`, { method: "POST" });
              app.say("Export started");
              app.go({ view: "matters", id: saved.matterId, tab: "exports" });
            } catch (e) {
              app.say((e as Error).message);
            }
          }}><FileArchive size={15} /> Export</button>
        ) : null}
      </div>

      <section className="panel">
        <form className="searchform" onSubmit={(e) => { e.preventDefault(); void run(form); }}>
          <label className="full">
            <span>Keywords</span>
            <input type="search" value={form.query} onChange={(e) => set("query", e.target.value)} placeholder={'e.g. contract OR agreement "Northwind" -draft'} autoFocus={!savedId} />
          </label>
          <div className="full" style={{ marginTop: -6 }}><QueryHelp /></div>
          <label>
            <span>Custodians (empty = everyone)</span>
            <PeoplePicker label="Custodians" value={form.custodians} onChange={(v) => set("custodians", v)} />
          </label>
          <label>
            <span>Dates (on the content&apos;s own date)</span>
            <div className="daterow">
              <input type="date" aria-label="From" value={form.from} onChange={(e) => set("from", e.target.value)} />
              <span className="muted">to</span>
              <input type="date" aria-label="To" value={form.to} onChange={(e) => set("to", e.target.value)} />
            </div>
          </label>
          <div className="full" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="muted" style={{ fontSize: 13 }}>Apps</span>
            <AppPicker app={app} value={form.apps} onChange={(v) => set("apps", v)} />
          </div>
          <div className="full actions" style={{ justifyContent: "flex-start" }}>
            <button className="btn primary" disabled={busy}><Search size={15} /> {busy ? "Searching…" : "Search"}</button>
            {!saved && result ? <button type="button" className="btn" onClick={() => setPicking(true)}><Save size={15} /> Save to matter</button> : null}
            {!saved ? <button type="button" className="btn ghost" onClick={() => { setForm(EMPTY); setResult(null); setError(""); }}>Clear</button> : null}
          </div>
        </form>
      </section>

      {error ? <div className="notice danger"><AlertTriangle size={16} /><div><p>{error}</p></div></div> : null}

      {result ? (
        <>
          <div className="perapp" aria-label="Results by app">
            {result.results.map((r) => (
              <span key={r.app} className={`pa${r.ok ? "" : " bad"}`} title={r.error ?? `${r.ms} ms`}>
                <strong>{appLabel(app, r.app)}</strong>
                {r.ok ? <span>{(result.counts[r.app] ?? 0).toLocaleString()}{r.total === undefined && r.nextCursor ? "+" : ""}</span> : <span className="muted">{r.error}</span>}
              </span>
            ))}
          </div>
          {failed.length ? (
            <p className="muted small">{plural(failed.length, "app")} didn&apos;t answer; their content is not in these results.</p>
          ) : null}
          <section className="panel flush">
            <h3>{plural(total, "item")} found {result.hits.length < total ? <span className="muted small" style={{ textTransform: "none", letterSpacing: 0 }}>showing {result.hits.length.toLocaleString()}</span> : null}</h3>
            {!result.hits.length ? <div className="empty"><p>Nothing matched.</p></div> : (
              <div className="tablewrap">
                <table className="table">
                  <thead><tr><th>App</th><th>Item</th><th>Owner</th><th>Date</th></tr></thead>
                  <tbody>
                    {result.hits.map((h) => (
                      <tr key={`${h.app}:${h.id}`} className="click" onClick={() => setItem(h)}>
                        <td className="nowrap"><Badge>{appLabel(app, h.app)}</Badge> <span className="muted small">{h.kind}</span></td>
                        <td>
                          <div className="cellstack">
                            <span className="rname">{h.title || <span className="muted">(untitled)</span>} {h.deleted ? <Badge tone="red">Deleted</Badge> : null}</span>
                            {h.snippet ? <span className="snippet">{h.snippet}</span> : null}
                          </div>
                        </td>
                        <td className="clip">{h.owner}</td>
                        <td className="muted nowrap">{formatDate(h.date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {Object.keys(cursors).length ? (
            <div><button className="btn" disabled={busy} onClick={() => run(form, true)}>{busy ? "Loading…" : "Show more"}</button></div>
          ) : null}
        </>
      ) : null}

      {item ? <ItemView app={app} hit={item} onClose={() => setItem(null)} /> : null}
      {picking ? <PickMatter app={app} title="Save this search to a matter" onClose={() => setPicking(false)} onPick={(m) => { setPicking(false); setSaving({ id: m.id, name: m.name }); }} /> : null}
      {saving ? (
        <Modal title={`Save to ${saving.name}`} onClose={() => setSaving(null)}>
          <form className="form" onSubmit={async (e) => {
            e.preventDefault();
            const name = new FormData(e.currentTarget).get("name");
            try {
              const s = await api<SavedSearch>(`/api/matters/${saving.id}/searches`, { method: "POST", json: { ...form, name, counts: result?.counts } });
              setSaving(null);
              app.say("Search saved");
              app.go({ view: "search", id: s.id });
            } catch (x) {
              (e.currentTarget.querySelector(".error") as HTMLElement).textContent = (x as Error).message;
            }
          }}>
            <label><span>Name</span><input name="name" required autoFocus defaultValue={form.query ? form.query.slice(0, 80) : "All content"} /></label>
            <p className="error" role="alert" />
            <div className="actions">
              <button type="button" className="btn" onClick={() => setSaving(null)}>Cancel</button>
              <button className="btn primary">Save</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}

/** One item in full, fetched through the app's export call. */
function ItemView({ app, hit, onClose }: { app: AppCtx; hit: AppHit; onClose: () => void }) {
  const [item, setItem] = useState<ExportItem | null>(null);
  const [error, setError] = useState("");
  const [html, setHtml] = useState(false);
  useEffect(() => {
    void api<ExportItem>("/api/search/item", { method: "POST", json: { app: hit.app, id: hit.id } }).then((it) => { setItem(it); setHtml(!it.text && !!it.html); }).catch((e) => setError(e.message));
  }, [hit]);
  const meta = item ? Object.entries(item.metadata ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== "") : [];
  return (
    <Modal title={hit.title || "(untitled)"} onClose={onClose} wide>
      <div className="form itemview">
        <Facts items={[
          ["App", `${appLabel(app, hit.app)} · ${hit.kind}`],
          ["Owner", hit.owner],
          ["Date", formatDateTime(hit.date)],
          ["People on it", (item?.participants ?? hit.participants ?? []).join(", ")],
          ...(hit.deleted ? [["Status", <Badge key="d" tone="red">Deleted by its owner while on hold</Badge>] as [string, React.ReactNode]] : []),
        ]} />
        {error ? <p className="error">{error}</p> : !item ? <p className="muted">Loading…</p> : (
          <>
            {item.text && item.html ? (
              <div className="seg" role="group" aria-label="Show as">
                <button className={!html ? "on" : ""} onClick={() => setHtml(false)}>Text</button>
                <button className={html ? "on" : ""} onClick={() => setHtml(true)}>Formatted</button>
              </div>
            ) : null}
            {html && item.html ? (
              // The app's HTML is shown with scripts, forms and network requests off.
              <iframe sandbox="" title="Item content" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">${item.html}`} />
            ) : item.text ? <div className="body pre">{item.text}</div> : <p className="muted">No text content.</p>}
            {item.attachments?.length ? (
              <div>
                <h3><Paperclip size={14} /> Attachments</h3>
                <ul className="chips" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {item.attachments.map((a, i) => (
                    <li key={i} className="chip plain">
                      {a.base64 ? (
                        <button type="button" className="link" style={{ width: "auto", height: "auto", borderRadius: 0, display: "inline-flex", gap: 4, alignItems: "center", color: "var(--accent)" }} onClick={() => saveBase64(a.name, a.type, a.base64!)}>
                          <Download size={12} /> {a.name}
                        </button>
                      ) : <span title={a.skipped}>{a.name} <span className="muted">(not included: {a.skipped || "too big"})</span></span>}
                      <span className="muted small">{formatSize(a.size)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {meta.length ? (
              <details className="help">
                <summary>Details from {appLabel(app, hit.app)}</summary>
                <pre style={{ marginTop: 6 }}>{JSON.stringify(Object.fromEntries(meta), null, 2)}</pre>
              </details>
            ) : null}
          </>
        )}
        <div className="actions"><button className="btn" onClick={onClose}>Close</button></div>
      </div>
    </Modal>
  );
}
