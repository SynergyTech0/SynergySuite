"use client";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { type Ctx, type TimeOff, KIND_LABELS, addDays, api, dayLabel, formData, rangeLabel, today } from "./client";
import { Modal } from "./Modal";

type Holiday = { day: string; name: string };

export function TimeOffView({ ctx }: { ctx: Ctx }) {
  const { me } = ctx;
  const [mine, setMine] = useState<TimeOff[]>([]);
  const [approvals, setApprovals] = useState<TimeOff[]>([]);
  const [calendar, setCalendar] = useState<TimeOff[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [asking, setAsking] = useState(false);
  const [deciding, setDeciding] = useState<TimeOff | null>(null);
  const year = new Date().getFullYear();
  const canApprove = me.roles.hrAdmin || me.roles.manager;

  const load = async () => {
    const [m, a, c, h] = await Promise.all([
      api<TimeOff[]>("/api/timeoff"),
      canApprove ? api<TimeOff[]>("/api/timeoff?scope=approvals") : Promise.resolve([]),
      api<TimeOff[]>(`/api/timeoff?scope=calendar&from=${today()}&to=${addDays(today(), 41)}`),
      api<Holiday[]>(`/api/holidays?year=${year}`),
    ]);
    setMine(m);
    setApprovals(a);
    setCalendar(c);
    setHolidays(h);
  };
  useEffect(() => {
    load().catch((e) => ctx.toast((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = async (r: TimeOff) => {
    await api(`/api/timeoff/${r.id}/cancel`, { method: "POST" });
    await Promise.all([load(), ctx.reloadMe()]);
  };

  return (
    <main className="view">
      <div className="viewhead">
        <h1>Time off</h1>
        <button className="btn primary right" onClick={() => setAsking(true)}><Plus size={16} /> Ask for time off</button>
      </div>
      <div className="viewbody">
        {me.balances && (
          <div className="cards">
            {me.balances.map((b) => (
              <div className="card" key={b.kind}>
                <div className="k">{b.kind === "vacation" ? "Vacation" : "Sick"} days left in {year}</div>
                <div className="v">{b.remaining}</div>
                <div className="s">of {b.allowance}{b.pending ? `, ${b.pending} waiting` : ""}</div>
              </div>
            ))}
          </div>
        )}

        {canApprove && (
          <section className="section">
            <h3>Waiting for you ({approvals.length})</h3>
            {approvals.length === 0 ? <p className="empty">Nothing to approve.</p> : (
              <table className="list"><tbody>
                {approvals.map((r) => (
                  <tr key={r.id}>
                    <td><b>{r.employee_name}</b><div className="small muted">{r.note}</div></td>
                    <td>{KIND_LABELS[r.kind ?? ""]}</td>
                    <td>{rangeLabel(r.start_date, r.end_date)}</td>
                    <td className="num">{r.days} d</td>
                    <td className="num"><button className="btn small" onClick={() => setDeciding(r)}>Decide</button></td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </section>
        )}

        <section className="section">
          <h3>Your requests</h3>
          {mine.length === 0 ? <p className="empty">You haven&apos;t asked for any time off.</p> : (
            <table className="list"><tbody>
              {mine.map((r) => (
                <tr key={r.id}>
                  <td>{rangeLabel(r.start_date, r.end_date)}</td>
                  <td>{KIND_LABELS[r.kind ?? ""]}</td>
                  <td className="num">{r.days} d</td>
                  <td><span className={`badge ${r.status}`}>{r.status}</span>{r.decision_note && <div className="small muted">{r.decision_note}</div>}</td>
                  <td className="num">
                    {(r.status === "pending" || (r.status === "approved" && r.start_date > today())) && (
                      <button className="btn small" onClick={() => cancel(r)}>Cancel</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody></table>
          )}
        </section>

        <section className="section">
          <h3>Who&apos;s out in the next six weeks</h3>
          {calendar.length === 0 ? <p className="empty">Nobody.</p> : (
            <table className="list"><tbody>
              {calendar.map((r) => (
                <tr key={r.id}>
                  <td>{r.employee_name}</td>
                  <td>{rangeLabel(r.start_date, r.end_date)}</td>
                  <td>{r.kind ? KIND_LABELS[r.kind] : ""}</td>
                  <td>{r.status === "pending" && <span className="badge pending">pending</span>}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </section>

        <Holidays ctx={ctx} year={year} holidays={holidays} onChange={load} />
      </div>
      {asking && <AskDialog onClose={() => setAsking(false)} onDone={async () => { setAsking(false); ctx.toast("Request sent"); await Promise.all([load(), ctx.reloadMe()]); }} />}
      {deciding && <DecideDialog r={deciding} onClose={() => setDeciding(null)} onDone={async () => { setDeciding(null); await load(); }} />}
    </main>
  );
}

function AskDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [err, setErr] = useState("");
  const [start, setStart] = useState(today());
  return (
    <Modal title="Ask for time off" onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api("/api/timeoff", { method: "POST", json: formData(e.currentTarget) });
          onDone();
        } catch (x) {
          setErr((x as Error).message);
        }
      }}>
        <label><span>Kind</span>
          <select name="kind" defaultValue="vacation">{Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <div className="grid2">
          <label><span>First day off</span><input type="date" name="startDate" value={start} onChange={(e) => setStart(e.target.value)} required /></label>
          <label><span>Last day off</span><input type="date" name="endDate" defaultValue={start} min={start} key={start} required /></label>
        </div>
        <label><span>Note for your manager (optional)</span><input name="note" /></label>
        <p className="small muted">Weekends and company holidays don&apos;t count against your days.</p>
        <p className="error" role="alert">{err}</p>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Send request</button></div>
      </form>
    </Modal>
  );
}

function DecideDialog({ r, onClose, onDone }: { r: TimeOff; onClose: () => void; onDone: () => void }) {
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const decide = async (status: "approved" | "denied") => {
    try {
      await api(`/api/timeoff/${r.id}/decide`, { method: "POST", json: { status, note } });
      onDone();
    } catch (x) {
      setErr((x as Error).message);
    }
  };
  return (
    <Modal title={`${r.employee_name}: ${KIND_LABELS[r.kind ?? ""] ?? "time off"}`} onClose={onClose}>
      <div className="form">
        <p>{rangeLabel(r.start_date, r.end_date)}, {r.days} working {r.days === 1 ? "day" : "days"}.</p>
        {r.note && <p className="muted">&ldquo;{r.note}&rdquo;</p>}
        <label><span>Note back (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <p className="error" role="alert">{err}</p>
        <div className="actions">
          <button className="btn" onClick={() => decide("denied")}>Decline</button>
          <button className="btn primary" onClick={() => decide("approved")}>Approve</button>
        </div>
      </div>
    </Modal>
  );
}

function Holidays({ ctx, year, holidays, onChange }: { ctx: Ctx; year: number; holidays: Holiday[]; onChange: () => Promise<void> }) {
  const [err, setErr] = useState("");
  const admin = ctx.me.roles.hrAdmin;
  if (!admin && !holidays.length) return null;
  return (
    <section className="section">
      <h3>Company holidays in {year}</h3>
      {holidays.length === 0 && <p className="empty">None yet.</p>}
      {holidays.length > 0 && (
        <table className="list"><tbody>
          {holidays.map((h) => (
            <tr key={h.day}>
              <td>{dayLabel(h.day)}</td><td>{h.name}</td>
              <td className="num">{admin && <button className="iconbtn" aria-label={`Remove ${h.name}`} onClick={async () => { await api(`/api/holidays/${h.day}`, { method: "DELETE" }); await onChange(); }}><Trash2 size={15} /></button>}</td>
            </tr>
          ))}
        </tbody></table>
      )}
      {admin && (
        <form className="row" onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          try {
            await api("/api/holidays", { method: "POST", json: formData(form) });
            form.reset();
            setErr("");
            await onChange();
          } catch (x) {
            setErr((x as Error).message);
          }
        }}>
          <input className="btn" type="date" name="day" required aria-label="Holiday date" />
          <input className="btn" name="name" placeholder="Holiday name" required style={{ minWidth: 200 }} />
          <button className="btn"><Plus size={15} /> Add holiday</button>
          <span className="error">{err}</span>
        </form>
      )}
    </section>
  );
}
