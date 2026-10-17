"use client";
import { useEffect, useState } from "react";
import { api, person, shortDate } from "./client";
import type { Go } from "./LawApp";
import { Modal } from "./Modal";
import type { AppInfo, CheckResult, Hit } from "./types";
import { ROLE_LABELS } from "./client";

type Row = { id: string; names: string[]; matter_id: string | null; matter_number: string | null; hits: number; decision: string; note: string; checked_by: string; checked_at: string; decided_by: string | null };

export function roleLabel(h: Pick<Hit, "source" | "role">): string {
  return h.source === "client" ? "Client of the firm" : ROLE_LABELS[h.role] ?? h.role;
}

/** The hits from a check, grouped by the name searched. */
export function HitsTable({ result, go }: { result: CheckResult; go?: Go }) {
  if (!result.hits.length) return <p className="ok">No matches at {result.threshold}% or above. Nothing in the firm&apos;s records conflicts.</p>;
  return (
    <div className="tablewrap">
      <table className="grid">
        <thead><tr><th>Searched</th><th>Found</th><th className="num">Match</th><th>Who they are</th><th>Where</th></tr></thead>
        <tbody>
          {result.hits.map((h, i) => (
            <tr key={i}>
              <td className="muted">{h.query}</td>
              <td><b>{h.name}</b></td>
              <td className="num">{h.score}%</td>
              <td>{roleLabel(h)}{h.source === "party" && <div className="muted small">against or alongside {h.clientName}</div>}</td>
              <td>
                {h.source === "party" ? (
                  <MatterRef id={h.matterId!} number={h.matterNumber!} title={h.matterTitle!} status={h.matterStatus!} responsible={h.responsible!} go={go} />
                ) : (result.clientMatters[h.clientId] ?? []).length ? (
                  (result.clientMatters[h.clientId] ?? []).slice(0, 5).map((m) => <MatterRef key={m.id} {...m} go={go} />)
                ) : (
                  <span className="muted">No matters</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatterRef({ id, number, title, status, responsible, go }: { id: string; number: string; title: string; status: string; responsible: string; go?: Go }) {
  return (
    <div>
      {go ? <button className="linkbtn" onClick={() => go.matter(id)}>{number}</button> : <span>{number}</span>} {title}{" "}
      <span className="muted small">({status}, {person(responsible)})</span>
    </div>
  );
}

export function DecideForm({ id, onDone }: { id: string; onDone: (decision: string) => void }) {
  const [decision, setDecision] = useState("cleared");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      className="decide"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api(`/api/conflicts/${id}`, { method: "PATCH", json: { decision, note } });
          onDone(decision);
        } catch (x) {
          setError((x as Error).message);
        }
      }}
    >
      <div className="toolbar">
        {[["cleared", "No conflict"], ["waived", "Conflict waived with consent"], ["declined", "Decline the matter"]].map(([v, l]) => (
          <label key={v} className="check"><input type="radio" name="decision" checked={decision === v} onChange={() => setDecision(v)} /> {l}</label>
        ))}
      </div>
      <input className="cellin wide" placeholder={decision === "waived" ? "Who consented, and how (required)" : decision === "declined" ? "Why (required)" : "Note (optional)"} value={note} onChange={(e) => setNote(e.target.value)} />
      <p className="error">{error}</p>
      <div><button className="btn primary">Record decision</button></div>
    </form>
  );
}

export function ConflictsView({ info, go }: { info: AppInfo; go: Go }) {
  const [names, setNames] = useState("");
  const [threshold, setThreshold] = useState(75);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<CheckResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api<Row[]>("/api/conflicts").then(setRows).catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Conflict checks</h1>
          <p className="sub muted">Checks every client and every party on every matter in the firm, spelled differently or not. Each check and its decision is kept.</p>
        </div>
      </div>
      <div className="body">
        <form
          className="narrow form flat"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              setResult(await api<CheckResult>("/api/conflicts", { method: "POST", json: { names, threshold } }));
              void load();
            } catch (x) {
              setError((x as Error).message);
            }
            setBusy(false);
          }}
        >
          <label>
            <span>Names to check, one per line: the prospective client, the other side, their lawyers, anyone related</span>
            <textarea rows={5} value={names} onChange={(e) => setNames(e.target.value)} placeholder={"Jane Q. Doe\nAcme Holdings, Inc. d/b/a Acme Supply"} />
          </label>
          <label className="inline">
            <span>Match names at least this alike</span>
            <select className="cellin" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>
              {[60, 70, 75, 85, 95].map((t) => <option key={t} value={t}>{t}%</option>)}
            </select>
          </label>
          <p className="error">{error}</p>
          <div><button className="btn primary" disabled={busy || !names.trim()}>Run check</button></div>
        </form>
        {result && (
          <section>
            <h2>Result</h2>
            <HitsTable result={result} go={go} />
            {result.decision === "pending" && (
              <DecideForm id={result.id} onDone={(d) => { setResult({ ...result, decision: d }); void load(); }} />
            )}
            {result.decision !== "pending" && <p className="muted">Recorded as {result.decision}.</p>}
          </section>
        )}
        <section>
          <h2>Earlier checks</h2>
          {!rows ? <p className="muted">Loading…</p> : !rows.length ? <p className="muted">None yet.</p> : (
            <div className="tablewrap">
              <table className="grid">
                <thead><tr><th>Names</th><th>Matches</th><th>Decision</th><th>Matter</th><th>By</th><th>When</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className="click"
                      onClick={async () => {
                        const c = await api<{ id: string; names: string[]; decision: string; results: Omit<CheckResult, "id" | "names" | "decision"> }>(`/api/conflicts/${r.id}`);
                        setOpen({ ...c.results, id: c.id, names: c.names, decision: c.decision });
                      }}
                    >
                      <td>{r.names.join(", ")}</td>
                      <td>{r.hits}</td>
                      <td><span className={`pill ${r.decision}`}>{r.decision}</span>{r.note && <div className="muted small">{r.note}</div>}</td>
                      <td>{r.matter_number ?? ""}</td>
                      <td className="muted">{person(r.checked_by, info.email)}</td>
                      <td className="muted">{shortDate(r.checked_at.slice(0, 10))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      {open && (
        <Modal title={`Check: ${open.names.join(", ")}`} onClose={() => setOpen(null)} wide>
          <div className="form">
            <HitsTable result={open} go={go} />
            {open.decision === "pending" ? (
              <DecideForm id={open.id} onDone={() => { setOpen(null); void load(); }} />
            ) : (
              <p className="muted">Recorded as {open.decision}.</p>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
