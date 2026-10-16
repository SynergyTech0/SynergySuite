"use client";
import { CheckCircle2, Circle } from "lucide-react";
import { useEffect, useState } from "react";
import { type Ctx, type Task, type TimeOff, KIND_LABELS, addDays, api, dayLabel, money, rangeLabel, today } from "./client";

type Stub = { id: string; runNumber: number; payDate: string; periodStart: string; periodEnd: string; grossCents: number; netCents: number };

export function TaskList({ tasks, onToggle }: { tasks: Task[]; onToggle: (t: Task) => void }) {
  const now = today();
  if (!tasks.length) return <p className="empty">Nothing waiting on you.</p>;
  return (
    <ul className="tasklist">
      {tasks.map((t) => (
        <li key={t.id} className={t.done_at ? "done" : ""}>
          <button className="iconbtn" aria-label={t.done_at ? "Mark not done" : "Mark done"} onClick={() => onToggle(t)}>
            {t.done_at ? <CheckCircle2 size={18} color="var(--ok)" /> : <Circle size={18} />}
          </button>
          <div className="grow">
            <div className="t">{t.title}</div>
            <div className="small muted">
              {t.kind === "onboarding" ? "Onboarding" : "Offboarding"}: {t.employee_name}
              {t.due && <> · <span className={!t.done_at && t.due < now ? "error" : ""}>due {dayLabel(t.due)}</span></>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Home({ ctx }: { ctx: Ctx }) {
  const { me } = ctx;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [mine, setMine] = useState<TimeOff[]>([]);
  const [out, setOut] = useState<TimeOff[]>([]);
  const [stubs, setStubs] = useState<Stub[]>([]);
  const [approvals, setApprovals] = useState(0);

  const load = async () => {
    const [t, m, o, s, a] = await Promise.all([
      api<Task[]>("/api/tasks"),
      api<TimeOff[]>("/api/timeoff"),
      api<TimeOff[]>(`/api/timeoff?scope=calendar&from=${today()}&to=${addDays(today(), 13)}`),
      api<Stub[]>("/api/stubs"),
      me.roles.hrAdmin || me.roles.manager ? api<TimeOff[]>("/api/timeoff?scope=approvals") : Promise.resolve([]),
    ]);
    setTasks(t);
    setMine(m.filter((r) => r.end_date >= today() && ["pending", "approved"].includes(r.status)));
    setOut(o.filter((r) => r.status === "approved"));
    setStubs(s);
    setApprovals(a.length);
  };
  useEffect(() => {
    load().catch((e) => ctx.toast((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = async (t: Task) => {
    await api(`/api/tasks/${t.id}`, { method: "POST", json: { done: !t.done_at } });
    await Promise.all([load(), ctx.reloadMe()]);
  };

  const first = me.name.split(/\s+/)[0];
  return (
    <main className="view">
      <div className="viewhead"><h1>Hi {first}</h1></div>
      <div className="viewbody">
        {!me.employee && (
          <div className="banner info">
            You don&apos;t have an HR record yet, so there are no time off balances or pay stubs to show.
            {me.roles.hrAdmin ? " Add yourself and your team from People." : " Ask HR to add you."}
          </div>
        )}
        <div className="cards">
          {me.balances?.map((b) => (
            <div className="card" key={b.kind}>
              <div className="k">{b.kind === "vacation" ? "Vacation left this year" : "Sick days left this year"}</div>
              <div className="v">{b.remaining} <span className="small muted">of {b.allowance} days</span></div>
              <div className="s">{b.used} used{b.pending ? `, ${b.pending} waiting for approval` : ""}</div>
            </div>
          ))}
          {approvals > 0 && (
            <button className="card" style={{ textAlign: "left" }} onClick={() => ctx.go("timeoff")}>
              <div className="k">Time off to approve</div>
              <div className="v">{approvals}</div>
              <div className="s">From your team</div>
            </button>
          )}
          {stubs[0] && (
            <a className="card" style={{ textDecoration: "none", color: "inherit" }} href={`/stubs/${stubs[0].id}`} target="_blank" rel="noreferrer">
              <div className="k">Last paycheck</div>
              <div className="v">{money(stubs[0].netCents)}</div>
              <div className="s">Paid {dayLabel(stubs[0].payDate)}</div>
            </a>
          )}
        </div>

        <section className="section">
          <h3>Your tasks</h3>
          <TaskList tasks={tasks} onToggle={toggle} />
        </section>

        {mine.length > 0 && (
          <section className="section">
            <h3>Your upcoming time off</h3>
            <table className="list"><tbody>
              {mine.map((r) => (
                <tr key={r.id}>
                  <td>{rangeLabel(r.start_date, r.end_date)}</td>
                  <td>{KIND_LABELS[r.kind ?? ""] ?? ""}</td>
                  <td className="num">{r.days} {r.days === 1 ? "day" : "days"}</td>
                  <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody></table>
          </section>
        )}

        <section className="section">
          <h3>Who&apos;s out in the next two weeks</h3>
          {out.length ? (
            <table className="list"><tbody>
              {out.map((r) => (
                <tr key={r.id}><td>{r.employee_name}</td><td>{rangeLabel(r.start_date, r.end_date)}</td></tr>
              ))}
            </tbody></table>
          ) : <p className="empty">Everyone&apos;s in.</p>}
        </section>

        {stubs.length > 0 && (
          <section className="section">
            <h3>Pay stubs</h3>
            <table className="list">
              <thead><tr><th>Paid</th><th className="hide-sm">Period</th><th className="num">Gross</th><th className="num">Take-home</th><th /></tr></thead>
              <tbody>
                {stubs.slice(0, 12).map((s) => (
                  <tr key={s.id}>
                    <td>{dayLabel(s.payDate)}</td>
                    <td className="hide-sm">{rangeLabel(s.periodStart, s.periodEnd)}</td>
                    <td className="num">{money(s.grossCents)}</td>
                    <td className="num">{money(s.netCents)}</td>
                    <td className="num"><a href={`/stubs/${s.id}`} target="_blank" rel="noreferrer">View</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </main>
  );
}
