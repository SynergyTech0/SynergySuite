"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CircleCheck, CircleX, ExternalLink, Info, LoaderCircle, Plus, Trash2, Workflow } from "lucide-react";

type Flow = { id: string; name: string; enabled: boolean; published: boolean; trigger: string; updated: string; link: string };
type Run = { id: string; flowId: string; flowName: string; status: string; started: string | null; finished: string | null; link: string };
type RecipeCard = { id: string; name: string; description: string; apps: string[] };
type Data = { flows: Flow[]; runs: Run[] };

async function call<T>(path: string, init?: { method?: string; json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.json !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

const RUN_WORDS: Record<string, { label: string; tone: "ok" | "bad" | "busy" | "" }> = {
  SUCCEEDED: { label: "Succeeded", tone: "ok" },
  FAILED: { label: "Failed", tone: "bad" },
  INTERNAL_ERROR: { label: "Engine error", tone: "bad" },
  TIMEOUT: { label: "Timed out", tone: "bad" },
  QUOTA_EXCEEDED: { label: "Over limit", tone: "bad" },
  MEMORY_LIMIT_EXCEEDED: { label: "Out of memory", tone: "bad" },
  RUNNING: { label: "Running", tone: "busy" },
  QUEUED: { label: "Queued", tone: "busy" },
  PAUSED: { label: "Waiting", tone: "busy" },
  STOPPED: { label: "Stopped", tone: "" },
  CANCELED: { label: "Canceled", tone: "" },
};

function RunStatus({ status }: { status: string }) {
  const w = RUN_WORDS[status] ?? { label: status.toLowerCase().replace(/_/g, " "), tone: "" };
  const Icon = w.tone === "ok" ? CircleCheck : w.tone === "bad" ? CircleX : w.tone === "busy" ? LoaderCircle : null;
  return (
    <span className={`status ${w.tone}`}>
      {Icon && <Icon size={14} aria-hidden />} {w.label}
    </span>
  );
}

export function FlowApp({ name, studio, recipes }: { name: string; studio: string; recipes: RecipeCard[] }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await call<Data>("/api/flows"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(recipe?: string, nameOverride?: string) {
    setBusy(recipe ?? "new");
    setError("");
    try {
      const { link } = await call<{ link: string }>("/api/flows", { method: "POST", json: { recipe, name: nameOverride } });
      window.location.href = link;
    } catch (e) {
      setError((e as Error).message);
      setBusy("");
    }
  }

  async function toggle(f: Flow) {
    setBusy(f.id);
    setError("");
    try {
      const { flow } = await call<{ flow: Omit<Flow, "link"> }>(`/api/flows/${encodeURIComponent(f.id)}`, { method: "PATCH", json: { enabled: !f.enabled } });
      setData((d) => d && { ...d, flows: d.flows.map((x) => (x.id === f.id ? { ...x, ...flow } : x)) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function remove(f: Flow) {
    if (!window.confirm(`Delete "${f.name}"? Its run history goes too.`)) return;
    setBusy(f.id);
    try {
      await call(`/api/flows/${encodeURIComponent(f.id)}`, { method: "DELETE" });
      setData((d) => d && { ...d, flows: d.flows.filter((x) => x.id !== f.id) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  function submitNew(e: FormEvent) {
    e.preventDefault();
    void create(undefined, newName.trim() || undefined);
  }

  const first = name.split(/\s+/)[0] || "there";

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Flow</h1>
          <p className="muted">Hi {first}. Automate the busywork between your apps: when something happens in one, do something in another.</p>
        </div>
        <div className="actions">
          <a className="btn" href={studio}>
            <ExternalLink size={15} aria-hidden /> Open designer
          </a>
          <a className="btn" href="/about">
            <Info size={15} aria-hidden /> About
          </a>
        </div>
      </header>

      {error && (
        <div className="notice danger" role="alert">
          <div>
            <p>{error}</p>
          </div>
        </div>
      )}

      <section>
        <h2>Start from a recipe</h2>
        <div className="recipes">
          {recipes.map((r) => (
            <button key={r.id} className="recipe" onClick={() => create(r.id)} disabled={!!busy}>
              <span className="recipe-apps">{r.apps.join(" → ")}</span>
              <strong>{r.name}</strong>
              <span className="muted small">{r.description}</span>
              {busy === r.id && <span className="small muted">Creating…</span>}
            </button>
          ))}
        </div>
        <form className="newflow" onSubmit={submitNew}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name a new flow" aria-label="New flow name" maxLength={200} />
          <button className="btn primary" disabled={!!busy}>
            <Plus size={15} aria-hidden /> {busy === "new" ? "Creating…" : "Blank flow"}
          </button>
        </form>
      </section>

      <section>
        <h2>My flows</h2>
        {!data && !error && <p className="muted">Loading…</p>}
        {data && data.flows.length === 0 && (
          <div className="empty">
            <Workflow size={28} aria-hidden />
            <p>No flows yet. Pick a recipe above or start a blank flow.</p>
          </div>
        )}
        {data && data.flows.length > 0 && (
          <table className="grid">
            <thead>
              <tr>
                <th>Name</th>
                <th>Starts when</th>
                <th>Changed</th>
                <th>On</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {data.flows.map((f) => (
                <tr key={f.id}>
                  <td>
                    <a href={f.link}>{f.name}</a>
                    {!f.published && <span className="badge">Draft</span>}
                  </td>
                  <td className="muted">{f.trigger}</td>
                  <td className="muted">{when(f.updated)}</td>
                  <td>
                    <label className="switch" title={f.published ? "" : "Publish the flow in the designer before turning it on"}>
                      <input type="checkbox" checked={f.enabled} disabled={busy === f.id || (!f.published && !f.enabled)} onChange={() => toggle(f)} aria-label={`${f.name} on`} />
                      <span />
                    </label>
                  </td>
                  <td className="row-actions">
                    <button className="iconbtn" onClick={() => remove(f)} disabled={busy === f.id} aria-label={`Delete ${f.name}`} title="Delete">
                      <Trash2 size={15} aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Recent runs</h2>
        {data && data.runs.length === 0 && <p className="muted">Nothing has run yet.</p>}
        {data && data.runs.length > 0 && (
          <table className="grid">
            <thead>
              <tr>
                <th>Flow</th>
                <th>Result</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a href={r.link}>{r.flowName}</a>
                  </td>
                  <td>
                    <RunStatus status={r.status} />
                  </td>
                  <td className="muted">{when(r.started)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
