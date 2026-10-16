"use client";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { MessageSquareText, Search as SearchIcon, SendHorizontal, Sparkles } from "lucide-react";
import type { AppOutcome, Hit } from "@/lib/fanout";
import type { Source } from "@/lib/ask";

type AppInfo = { id: string; name: string };
type Tab = "results" | "ask";
type Results = { query: string; results: Omit<Hit, "text">[]; apps: AppOutcome[] };
type Turn = { role: "user" | "assistant"; content: string; sources?: Source[]; error?: boolean; missing?: AppOutcome[] };

async function post<T>(path: string, json: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(json), signal });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error || `Request failed (${res.status})`), { status: res.status });
  return data as T;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

const STATUS_WORDS: Record<string, string> = { "not-supported": "doesn't take part yet", unavailable: "didn't answer", error: "had a problem" };

function Missing({ apps }: { apps: AppOutcome[] }) {
  const missing = apps.filter((a) => a.status !== "ok");
  if (!missing.length) return null;
  return (
    <p className="quiet small">
      Not included:{" "}
      {missing.map((a, i) => (
        <Fragment key={a.app}>
          {i > 0 && ", "}
          <span title={a.detail}>{a.name}</span> <span className="muted">({STATUS_WORDS[a.status] ?? a.status})</span>
        </Fragment>
      ))}
    </p>
  );
}

function setUrl(q: string, tab: Tab, push: boolean) {
  const u = new URL(window.location.href);
  if (q) u.searchParams.set("q", q);
  else u.searchParams.delete("q");
  if (tab === "ask") u.searchParams.set("tab", "ask");
  else u.searchParams.delete("tab");
  if (u.href === window.location.href) return;
  if (push) window.history.pushState(null, "", u);
  else window.history.replaceState(null, "", u);
}

export function SearchApp({ initialQuery, initialTab, apps, aiOn, name }: { initialQuery: string; initialTab: Tab; apps: AppInfo[]; aiOn: boolean; name: string }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [input, setInput] = useState(initialQuery);
  const [data, setData] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const inputRef = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ results: null, ask: null });

  const run = useCallback(async (q: string) => {
    abort.current?.abort();
    const query = q.trim();
    setFilter("all");
    if (!query) {
      setData(null);
      setError("");
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    abort.current = ac;
    setLoading(true);
    setError("");
    try {
      const r = await post<Results>("/api/search", { query }, ac.signal);
      if (!ac.signal.aborted) setData(r);
    } catch (e) {
      if (ac.signal.aborted) return;
      setData(null);
      setError((e as Error).message || "Search failed");
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialQuery && initialTab === "results") void run(initialQuery);
    const onPop = () => {
      const sp = new URLSearchParams(window.location.search);
      const q = sp.get("q") ?? "";
      const t: Tab = sp.get("tab") === "ask" ? "ask" : "results";
      setInput(q);
      setTab(t);
      if (t === "results") void run(q);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [initialQuery, initialTab, run]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setUrl(input.trim(), "results", true);
    setTab("results");
    void run(input);
  };

  const choose = (t: Tab) => {
    setTab(t);
    setUrl(input.trim(), t, false);
  };

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next: Tab = e.key === "Home" ? "results" : e.key === "End" ? "ask" : tab === "results" ? "ask" : "results";
    choose(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <main className="search-page">
      <form className="bigsearch" role="search" onSubmit={submit}>
        <label htmlFor="q" className="sr-only">Search your apps</label>
        <SearchIcon size={20} aria-hidden="true" className="muted" />
        <input
          id="q"
          ref={inputRef}
          type="search"
          name="q"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search mail, files, chats, events, notes…"
          autoComplete="off"
          autoFocus
          maxLength={500}
        />
        <button className="btn primary" type="submit">Search</button>
      </form>

      <div className="tabs" role="tablist" aria-label="Search or ask">
        <button
          ref={(el) => { tabRefs.current.results = el; }}
          role="tab" id="tab-results" aria-controls="panel-results" aria-selected={tab === "results"} tabIndex={tab === "results" ? 0 : -1}
          className={tab === "results" ? "on" : ""} onClick={() => choose("results")} onKeyDown={onTabKey} type="button"
        >
          <SearchIcon size={15} aria-hidden="true" /> Results
        </button>
        <button
          ref={(el) => { tabRefs.current.ask = el; }}
          role="tab" id="tab-ask" aria-controls="panel-ask" aria-selected={tab === "ask"} tabIndex={tab === "ask" ? 0 : -1}
          className={tab === "ask" ? "on" : ""} onClick={() => choose("ask")} onKeyDown={onTabKey} type="button"
        >
          <Sparkles size={15} aria-hidden="true" /> Ask
        </button>
      </div>

      <section id="panel-results" role="tabpanel" aria-labelledby="tab-results" hidden={tab !== "results"}>
        <ResultsView data={data} loading={loading} error={error} filter={filter} setFilter={setFilter} apps={apps} />
      </section>
      <section id="panel-ask" role="tabpanel" aria-labelledby="tab-ask" hidden={tab !== "ask"}>
        <AskView aiOn={aiOn} name={name} seed={tab === "ask" ? initialQuery : ""} />
      </section>
    </main>
  );
}

function ResultsView({ data, loading, error, filter, setFilter, apps }: { data: Results | null; loading: boolean; error: string; filter: string; setFilter: (f: string) => void; apps: AppInfo[] }) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data?.results ?? []) m.set(r.app, (m.get(r.app) ?? 0) + 1);
    return m;
  }, [data]);
  const shown = useMemo(() => (data?.results ?? []).filter((r) => filter === "all" || r.app === filter), [data, filter]);

  return (
    <div className="results">
      <p className="sr-only" role="status" aria-live="polite">
        {loading ? "Searching…" : data ? `${data.results.length} results` : ""}
      </p>
      {error && <div className="notice danger" role="alert"><p>{error}</p></div>}
      {loading && !data && <p className="muted">Searching your apps…</p>}
      {!loading && !data && !error && (
        <div className="empty">
          <SearchIcon size={28} aria-hidden="true" />
          <p>Search everything you can open across {apps.map((a) => a.name).join(", ")}.</p>
          <p className="small">All words must match. Use <code>&quot;exact phrase&quot;</code>, <code>budget OR forecast</code>, or <code>-draft</code> to leave something out.</p>
        </div>
      )}
      {data && (
        <>
          {data.results.length > 0 && (
            <div className="chips" role="group" aria-label="Filter by app">
              <button type="button" className={`chip ${filter === "all" ? "on" : ""}`} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
                All <span className="count">{data.results.length}</span>
              </button>
              {apps.filter((a) => counts.get(a.id)).map((a) => (
                <button key={a.id} type="button" className={`chip ${filter === a.id ? "on" : ""}`} aria-pressed={filter === a.id} onClick={() => setFilter(a.id)}>
                  {a.name} <span className="count">{counts.get(a.id)}</span>
                </button>
              ))}
            </div>
          )}
          {data.results.length === 0 ? (
            <div className="empty">
              <p>Nothing found for <strong>{data.query}</strong>.</p>
              <p className="small">Try fewer or different words: every word has to appear.</p>
            </div>
          ) : (
            <ol className={`hits ${loading ? "stale" : ""}`} aria-busy={loading}>
              {shown.map((r) => (
                <li key={`${r.app}:${r.id}`} className="hit">
                  <div className="hitmeta">
                    <span className="badge blue">{r.appName}</span>
                    <span className="muted small">{r.kind}</span>
                    {r.date && <time className="muted small" dateTime={r.date}>{formatDate(r.date)}</time>}
                    {r.person && <span className="muted small person">{r.person}</span>}
                  </div>
                  <a className="hittitle" href={r.url}>{r.title}</a>
                  {r.snippet && <p className="snippet">{r.snippet}</p>}
                </li>
              ))}
            </ol>
          )}
          <Missing apps={data.apps} />
        </>
      )}
    </div>
  );
}

/** The answer's text with [n] turned into links to source n. */
function withCitations(text: string, sources: Source[]): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[(\d{1,2})\]/g;
  let last = 0;
  for (let m; (m = re.exec(text)); ) {
    const s = sources.find((x) => x.n === Number(m![1]));
    if (!s) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <a key={`${m.index}`} className="cite" href={s.url} title={`${s.appName}: ${s.title}`} aria-label={`Source ${s.n}: ${s.title} (${s.appName})`}>
        {s.n}
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function AskView({ aiOn, name, seed }: { aiOn: boolean; name: string; seed: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState(seed);
  const [busy, setBusy] = useState(false);
  const [off, setOff] = useState(!aiOn);
  const [offMsg, setOffMsg] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [turns, busy]);

  if (off) {
    return (
      <div className="notice warn" role="note">
        <MessageSquareText size={18} aria-hidden="true" />
        <div>
          <p><strong>The assistant is off.</strong> {offMsg || "No AI model is configured for the suite."}</p>
          {!offMsg && <p>An administrator can turn it on by setting <code>AI_PROVIDER</code>, <code>AI_MODEL</code> and <code>AI_API_KEY</code> or <code>AI_BASE_URL</code> (or <code>SEARCH_AI_*</code> to give Search its own model).</p>}
          <p>Search still works: use the Results tab.</p>
        </div>
      </div>
    );
  }

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    const history = turns.filter((t) => !t.error).slice(-6).map(({ role, content }) => ({ role, content }));
    setTurns((t) => [...t, { role: "user", content: q }]);
    setQuestion("");
    setBusy(true);
    try {
      const r = await post<{ answer: string; sources: Source[]; apps: AppOutcome[] }>("/api/ask", { question: q, history });
      setTurns((t) => [...t, { role: "assistant", content: r.answer, sources: r.sources, missing: r.apps }]);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 503) {
        setOff(true);
        setOffMsg((err as Error).message);
      }
      setTurns((t) => [...t, { role: "assistant", content: (err as Error).message || "Something went wrong", error: true }]);
    } finally {
      setBusy(false);
      boxRef.current?.focus();
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="ask">
      {turns.length === 0 && (
        <div className="empty">
          <Sparkles size={28} aria-hidden="true" />
          <p>Hi {name}. Ask a question about your own mail, files, chats, meetings, notes and tasks.</p>
          <p className="small">Answers come only from what you can open, with links to the sources. Check important details in the source.</p>
        </div>
      )}
      <ol className="thread" aria-live="polite">
        {turns.map((t, i) => (
          <li key={i} className={`turn ${t.role} ${t.error ? "err" : ""}`}>
            <span className="sr-only">{t.role === "user" ? "You asked:" : "Answer:"}</span>
            <div className="bubble">{t.role === "assistant" && !t.error ? withCitations(t.content, t.sources ?? []) : t.content}</div>
            {t.sources && t.sources.length > 0 && (
              <ol className="sources" aria-label="Sources">
                {t.sources.map((s) => (
                  <li key={s.n} value={s.n}>
                    <a href={s.url}>{s.title}</a> <span className="muted small">· {s.appName}{s.date ? ` · ${formatDate(s.date)}` : ""}</span>
                  </li>
                ))}
              </ol>
            )}
            {t.missing && <Missing apps={t.missing} />}
          </li>
        ))}
        {busy && <li className="turn assistant"><div className="bubble muted">Searching your apps and writing an answer…</div></li>}
      </ol>
      <div ref={endRef} />
      <form className="askform" onSubmit={send}>
        <label htmlFor="question" className="sr-only">Ask a question</label>
        <textarea
          id="question"
          ref={boxRef}
          rows={2}
          value={question}
          maxLength={1000}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onKey}
          placeholder="e.g. What did we decide about the Contoso renewal?"
        />
        <button className="btn primary" type="submit" disabled={busy || !question.trim()} aria-label="Ask">
          <SendHorizontal size={16} aria-hidden="true" /> Ask
        </button>
      </form>
      {turns.length > 0 && (
        <button type="button" className="linkbtn small" onClick={() => setTurns([])} disabled={busy}>New conversation</button>
      )}
    </div>
  );
}
