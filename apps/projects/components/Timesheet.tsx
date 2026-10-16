"use client";
import { ChevronLeft, ChevronRight, Play, Plus, Send, Square, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { SheetRow, TimeEntry, Timer, Timesheet as Sheet } from "@/lib/types";
import { addDaysStr, api, dayName, hrs, isWeekend, shortDate, todayStr } from "./client";
import type { Me } from "./ProjectsApp";

const key = (r: { projectId: string; taskId: string | null }) => `${r.projectId}/${r.taskId ?? ""}`;

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function Timesheet({ onChange }: { me: Me; onChange: () => void }) {
  const [day, setDay] = useState(todayStr());
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [extra, setExtra] = useState<SheetRow[]>([]);
  const [timer, setTimer] = useState<Timer | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setSheet(await api<Sheet>(`/api/timesheet?day=${day}`));
      setTimer((await api<{ timer: Timer | null }>("/api/timer")).timer);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [day]);
  useEffect(() => {
    setExtra([]);
    void load();
  }, [load]);
  useEffect(() => {
    if (!timer) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [timer]);

  if (!sheet) return <p className="pad muted">{error || "Loading…"}</p>;
  const shown = new Set(sheet.rows.map(key));
  const rows = [...sheet.rows, ...extra.filter((r) => !shown.has(key(r)))];
  const cells = rows.flatMap((r) => r.cells.filter((c): c is TimeEntry => !!c));
  const open = cells.filter((c) => c.status === "draft" || c.status === "rejected").length;
  const submitted = cells.filter((c) => c.status === "submitted").length;
  const dayTotal = (i: number) => rows.reduce((s, r) => s + (r.cells[i]?.minutes ?? 0), 0);
  const total = sheet.days.reduce((s, _d, i) => s + dayTotal(i), 0);

  const setCell = async (row: SheetRow, i: number, value: string) => {
    const before = row.cells[i];
    if ((before ? hrs(before.minutes) : "") === value.trim()) return;
    setError("");
    try {
      await api("/api/timesheet/cell", { method: "PUT", json: { projectId: row.projectId, taskId: row.taskId, day: sheet.days[i], hours: value.trim() || 0 } });
      await load();
      onChange();
    } catch (e) {
      setError((e as Error).message);
      await load();
    }
  };

  const week = async (recall: boolean) => {
    setError("");
    try {
      await api("/api/timesheet/submit", { method: "POST", json: { day: sheet.week, recall } });
      await load();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>My timesheet</h1>
          <p className="sub muted">Week of {shortDate(sheet.week)}. Type hours as 1.5, 1:30 or 1h 30m; leave a cell empty to clear it.</p>
        </div>
        <button className="iconbtn" aria-label="Previous week" onClick={() => setDay(addDaysStr(sheet.week, -7))}><ChevronLeft size={18} /></button>
        <button className="btn" onClick={() => setDay(todayStr())}>This week</button>
        <button className="iconbtn" aria-label="Next week" onClick={() => setDay(addDaysStr(sheet.week, 7))}><ChevronRight size={18} /></button>
      </div>
      <div className="body">
        <TimerBar timer={timer} now={now} choices={sheet.choices} onChange={async (t) => { setTimer(t); await load(); onChange(); }} onError={setError} />
        <p className="error" role="alert">{error}</p>
        <div className="tablewrap">
          <table className="grid sheet">
            <thead>
              <tr>
                <th>Project and task</th>
                {sheet.days.map((d) => <th key={d} className={`num${isWeekend(d) ? " weekend" : ""}`}>{dayName(d)}</th>)}
                <th className="num">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rowTotal = r.cells.reduce((s, c) => s + (c?.minutes ?? 0), 0);
                const locked = r.cells.some((c) => c && c.status !== "draft" && c.status !== "rejected");
                return (
                  <tr key={key(r)}>
                    <td>
                      <span className="muted small">{r.projectCode}</span> {r.projectName}
                      <div className="small">{r.taskTitle ?? <span className="muted">General</span>}</div>
                    </td>
                    {sheet.days.map((d, i) => {
                      const c = r.cells[i];
                      const closed = !!c && c.status !== "draft" && c.status !== "rejected";
                      return (
                        <td key={`${d}/${c?.minutes ?? 0}/${c?.status ?? ""}`} className={`cellwrap num${isWeekend(d) ? " weekend" : ""}${closed ? " locked" : ""}${c ? ` st-${c.status}` : ""}`}>
                          <input
                            className="cellin"
                            aria-label={`${r.projectName} ${r.taskTitle ?? ""} ${d}`}
                            defaultValue={c ? hrs(c.minutes) : ""}
                            readOnly={closed}
                            title={c ? `${c.status}${c.rejectReason ? `: ${c.rejectReason}` : ""}${c.notes ? `\n${c.notes}` : ""}` : ""}
                            onBlur={(e) => !closed && void setCell(r, i, e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                          />
                        </td>
                      );
                    })}
                    <td className="num"><b>{hrs(rowTotal) || "0"}</b></td>
                    <td>
                      {!locked && (
                        <button
                          className="iconbtn small"
                          aria-label="Remove row"
                          title="Remove row"
                          onClick={async () => {
                            if (rowTotal) {
                              try {
                                await api("/api/timesheet/row", { method: "DELETE", json: { week: sheet.week, projectId: r.projectId, taskId: r.taskId } });
                              } catch (e) {
                                setError((e as Error).message);
                              }
                            }
                            setExtra((x) => x.filter((y) => key(y) !== key(r)));
                            await load();
                          }}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={10} className="empty">Add a project and task to start logging time.</td></tr>}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                {sheet.days.map((d, i) => <td key={d} className={`num${isWeekend(d) ? " weekend" : ""}`}>{hrs(dayTotal(i)) || "0"}</td>)}
                <td className="num">{hrs(total) || "0"}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="toolbar">
          <AddRow choices={sheet.choices} onAdd={(r) => setExtra((x) => [...x, { ...r, cells: sheet.days.map(() => null) }])} />
          <span className="grow" />
          {submitted > 0 && <button className="btn" onClick={() => void week(true)}><Undo2 size={15} /> Take back</button>}
          <button className="btn primary" disabled={!open} onClick={() => void week(false)}><Send size={15} /> Submit week</button>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Submitted time goes to each project&apos;s managers to approve. Time they send back is outlined in red; hover a cell for why.
        </p>
      </div>
    </>
  );
}

type Choices = Sheet["choices"];

function AddRow({ choices, onAdd }: { choices: Choices; onAdd: (r: Omit<SheetRow, "cells">) => void }) {
  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const p = choices.find((c) => c.id === projectId);
  if (!choices.length) return <span className="muted">You aren&apos;t on any open projects.</span>;
  return (
    <form
      className="toolbar"
      onSubmit={(e) => {
        e.preventDefault();
        if (!p) return;
        const t = p.tasks.find((x) => x.id === taskId);
        onAdd({ projectId: p.id, projectName: p.name, projectCode: p.code, taskId: t?.id ?? null, taskTitle: t?.title ?? null });
        setTaskId("");
      }}
    >
      <select className="cellin" value={projectId} onChange={(e) => { setProjectId(e.target.value); setTaskId(""); }} aria-label="Project">
        <option value="">Pick a project</option>
        {choices.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
      </select>
      <select className="cellin" value={taskId} onChange={(e) => setTaskId(e.target.value)} disabled={!p} aria-label="Task">
        <option value="">General (no task)</option>
        {p?.tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
      </select>
      <button className="btn" disabled={!p}><Plus size={15} /> Add row</button>
    </form>
  );
}

function TimerBar({ timer, now, choices, onChange, onError }: {
  timer: Timer | null; now: number; choices: Choices; onChange: (t: Timer | null) => void; onError: (m: string) => void;
}) {
  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [notes, setNotes] = useState("");
  const p = choices.find((c) => c.id === projectId);
  const run = async (body: Record<string, unknown>, method = "POST") => {
    onError("");
    try {
      const r = await api<{ timer: Timer | null }>("/api/timer", { method, json: method === "POST" ? body : undefined });
      onChange(r?.timer ?? null);
    } catch (e) {
      onError((e as Error).message);
    }
  };
  if (timer) {
    return (
      <div className="timer running">
        <span className="clock">{clock(now - new Date(timer.startedAt).getTime())}</span>
        <span className="grow">{timer.projectName}{timer.taskTitle ? `: ${timer.taskTitle}` : ""}{timer.notes ? <span className="muted"> · {timer.notes}</span> : null}</span>
        <button className="btn primary" onClick={() => void run({ stop: true, today: todayStr() })}><Square size={14} /> Stop and add to today</button>
        <button className="btn ghost" onClick={() => void run({}, "DELETE")}>Discard</button>
      </div>
    );
  }
  if (!choices.length) return null;
  return (
    <form className="timer" onSubmit={(e) => { e.preventDefault(); if (p) void run({ projectId, taskId: taskId || null, notes }); }}>
      <select className="cellin" value={projectId} onChange={(e) => { setProjectId(e.target.value); setTaskId(""); }} aria-label="Timer project">
        <option value="">Timer: pick a project</option>
        {choices.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
      </select>
      <select className="cellin" value={taskId} onChange={(e) => setTaskId(e.target.value)} disabled={!p} aria-label="Timer task">
        <option value="">General</option>
        {p?.tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
      </select>
      <input className="cellin grow" placeholder="What are you working on?" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <button className="btn" disabled={!p}><Play size={14} /> Start timer</button>
    </form>
  );
}
