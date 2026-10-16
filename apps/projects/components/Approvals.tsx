"use client";
import { Check, Undo2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Expense, TimeEntry } from "@/lib/types";
import { api, hrs, money, person, shortDate } from "./client";
import { Modal } from "./Modal";
import type { Me } from "./ProjectsApp";

type Pending = { time: TimeEntry[]; expenses: Expense[] };

/** Time and expenses submitted on projects you manage. */
export function Approvals({ me, onChange }: { me: Me; onChange: () => void }) {
  const [data, setData] = useState<Pending | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [rejecting, setRejecting] = useState(false);

  const load = useCallback(() => {
    api<Pending>("/api/approvals").then((d) => { setData(d); setPicked(new Set()); }).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  if (!data) return <p className="pad muted">{error || "Loading…"}</p>;
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const all = [...data.time.map((t) => t.id), ...data.expenses.map((x) => x.id)];
  const decide = async (approve: boolean, reason?: string) => {
    setError("");
    try {
      await api("/api/approvals", {
        method: "POST",
        json: { approve, reason, time: data.time.filter((t) => picked.has(t.id)).map((t) => t.id), expenses: data.expenses.filter((x) => picked.has(x.id)).map((x) => x.id) },
      });
      load();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  // One block per person, each week's time together.
  const people = [...new Set([...data.time.map((t) => t.person), ...data.expenses.map((x) => x.person)])].sort();

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Approvals</h1>
          <p className="sub muted">Approving time fixes its bill and cost rates from the team list. Approved, billable time and expenses can then be billed.</p>
        </div>
      </div>
      <div className="body">
        {!all.length ? <div className="empty">Nothing is waiting for you.</div> : (
          <>
            <div className="toolbar">
              <label className="check" style={{ display: "flex" }}>
                <input type="checkbox" checked={picked.size === all.length} onChange={(e) => setPicked(new Set(e.target.checked ? all : []))} /> Select all
              </label>
              <span className="grow" />
              <button className="btn" disabled={!picked.size} onClick={() => setRejecting(true)}><Undo2 size={15} /> Send back</button>
              <button className="btn primary" disabled={!picked.size} onClick={() => void decide(true)}><Check size={15} /> Approve {picked.size || ""}</button>
            </div>
            <p className="error" role="alert">{error}</p>
            {people.map((p) => {
              const time = data.time.filter((t) => t.person === p);
              const exp = data.expenses.filter((x) => x.person === p);
              return (
                <section key={p}>
                  <h2>{person(p, me.email)} <span className="muted small">{p}</span></h2>
                  <div className="tablewrap">
                    <table className="grid">
                      <thead><tr><th /><th>Day</th><th>Project</th><th>Task or category</th><th>Notes</th><th className="num">Hours or amount</th><th>Billable</th></tr></thead>
                      <tbody>
                        {time.map((t) => (
                          <tr key={t.id} className={`click${picked.has(t.id) ? " sel" : ""}`} onClick={() => toggle(t.id)}>
                            <td><input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} onClick={(e) => e.stopPropagation()} aria-label="Select" /></td>
                            <td>{shortDate(t.day)}</td>
                            <td><span className="muted small">{t.projectCode}</span> {t.projectName}</td>
                            <td>{t.taskTitle ?? <span className="muted">General</span>}</td>
                            <td className="muted">{t.notes}</td>
                            <td className="num">{hrs(t.minutes)} h</td>
                            <td>{t.billable ? "Yes" : "No"}</td>
                          </tr>
                        ))}
                        {exp.map((x) => (
                          <tr key={x.id} className={`click${picked.has(x.id) ? " sel" : ""}`} onClick={() => toggle(x.id)}>
                            <td><input type="checkbox" checked={picked.has(x.id)} onChange={() => toggle(x.id)} onClick={(e) => e.stopPropagation()} aria-label="Select" /></td>
                            <td>{shortDate(x.day)}</td>
                            <td><span className="muted small">{x.projectCode}</span> {x.projectName}</td>
                            <td>{x.category}</td>
                            <td className="muted">
                              {x.description}
                              {x.receiptName && <> <a className="linkbtn" href={`/api/expenses/${x.id}/receipt`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Receipt</a></>}
                            </td>
                            <td className="num">{money(x.amountCents, x.currency)}</td>
                            <td>{x.billable ? "Yes" : "No"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}
          </>
        )}
      </div>
      {rejecting && (
        <Modal title="Send back" onClose={() => setRejecting(false)}>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
              setRejecting(false);
              await decide(false, reason);
            }}
          >
            <label><span>Why? They see this next to the time or expense.</span><input name="reason" required autoFocus maxLength={500} /></label>
            <div className="actions">
              <button type="button" className="btn" onClick={() => setRejecting(false)}>Cancel</button>
              <button className="btn primary">Send back {picked.size}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
