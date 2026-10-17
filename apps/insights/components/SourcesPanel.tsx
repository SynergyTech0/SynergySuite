"use client";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

type Source = { source: string; name: string; status: "ok" | "missing" | "error"; tables: number; hiddenColumns: string[]; detail?: string };
type Executive = { status: "ok" | "skipped" | "error"; dashboardId?: number; cards: number; detail?: string };
type Report = { at: string; ok: boolean; error?: string; sources: Source[]; executive?: Executive };
type State = { sources: string[]; names: Record<string, string>; last: Report | null };

export function SourcesPanel() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = async (method: "GET" | "POST") => {
    setError(null);
    if (method === "POST") setBusy(true);
    try {
      const res = await fetch("/api/sources", { method, cache: "no-store" });
      const body = (await res.json()) as State & { error?: string };
      if (!res.ok) throw new Error(body.error || "Something went wrong");
      setState(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void call("GET");
  }, []);

  const last = state?.last;
  return (
    <div className="panel">
      <div className="head">
        <h2 className="grow">
          {last ? `Last sync ${new Date(last.at).toLocaleString()}` : "Not synced since Insights started"}
        </h2>
        <button className="btn primary" disabled={busy} onClick={() => void call("POST")}>
          <RefreshCw size={16} /> {busy ? "Syncing…" : "Sync now"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {last?.error && <p className="error">{last.error}</p>}
      <table className="list">
        <thead>
          <tr><th>Source</th><th>Status</th><th>Tables</th><th>Hidden columns</th></tr>
        </thead>
        <tbody>
          {(state?.sources ?? []).map((id) => {
            const s = last?.sources.find((x) => x.source === id);
            return (
              <tr key={id}>
                <td>{s?.name ?? state?.names[id] ?? id} <span className="muted small">({id})</span></td>
                <td className={s?.status === "ok" ? "ok" : s?.status === "error" ? "error" : "muted"}>
                  {s ? (s.status === "ok" ? "Connected" : s.status === "missing" ? "Not installed" : "Failed") : "Waiting"}
                  {s?.detail && <div className="small muted">{s.detail}</div>}
                </td>
                <td>{s?.tables ?? ""}</td>
                <td className="small muted">{s?.hiddenColumns.length ? s.hiddenColumns.join(", ") : s ? "None" : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {last?.executive && (
        <p className={last.executive.status === "error" ? "error" : "muted"}>
          Executive overview:{" "}
          {last.executive.status === "ok" && last.executive.dashboardId ? (
            <a href={`/d/${last.executive.dashboardId}`}>ready, {last.executive.cards} cards</a>
          ) : last.executive.status === "skipped" ? (
            "not set up yet"
          ) : (
            "failed"
          )}
          {last.executive.detail && ` (${last.executive.detail})`}
        </p>
      )}
    </div>
  );
}
