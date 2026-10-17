"use client";
import { ChevronLeft, ChevronRight, GripVertical, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Ctx } from "./FieldApp";
import { type Board, type BoardBooking, type WorkOrder, STATUS_LABEL, api, dayStart, dayStr, longDay, person, shortDate, time } from "./client";

const FIRST_HOUR = 6;
const HOURS = 15; // 6:00 to 21:00
const SNAP = 15 * 60_000;

/**
 * The schedule board: one row per technician across the day. Drag a waiting job onto a row to
 * book it at that time for its estimate; drag a booking to move it to another time or person.
 */
export function BoardView({ ctx }: { ctx: Ctx }) {
  const [day, setDay] = useState(dayStr());
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ kind: "job"; job: WorkOrder } | { kind: "booking"; booking: BoardBooking; grabMs: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const from = dayStart(day).toISOString();
      const to = dayStart(day, 1).toISOString();
      setBoard(await api<Board>(`/api/board?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [day]);

  useEffect(() => {
    void load();
  }, [load, ctx.version]);

  const origin = dayStart(day).getTime() + FIRST_HOUR * 3_600_000;
  const span = HOURS * 3_600_000;

  /** The instant under the pointer in a technician's row, snapped to 15 minutes. */
  const at = (e: React.DragEvent<HTMLDivElement>, grabMs = 0) => {
    const r = e.currentTarget.getBoundingClientRect();
    const ms = origin + ((e.clientX - r.left) / r.width) * span - grabMs;
    return Math.round(ms / SNAP) * SNAP;
  };

  async function save(path: string, method: "POST" | "PATCH", json: Record<string, unknown>) {
    setBusy(true);
    try {
      try {
        await api(path, { method, json });
      } catch (e) {
        if ((e as { status?: number }).status === 409 && window.confirm((e as Error).message)) await api(path, { method, json: { ...json, force: true } });
        else throw e;
      }
      ctx.changed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function drop(e: React.DragEvent<HTMLDivElement>, technician: string) {
    e.preventDefault();
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === "job") {
      const start = at(e);
      await save("/api/bookings", "POST", {
        workOrderId: d.job.id, technician, start: new Date(start).toISOString(), end: new Date(start + d.job.estimateMinutes * 60_000).toISOString(),
      });
    } else {
      const b = d.booking;
      const len = new Date(b.endsAt).getTime() - new Date(b.startsAt).getTime();
      const start = at(e, d.grabMs);
      await save(`/api/bookings/${b.id}`, "PATCH", { technician, start: new Date(start).toISOString(), end: new Date(start + len).toISOString() });
    }
  }

  const hours = Array.from({ length: HOURS }, (_, i) => FIRST_HOUR + i);
  const now = Date.now();
  const nowPct = ((now - origin) / span) * 100;

  return (
    <div className="boardwrap">
      <div className="head">
        <h1>Schedule board</h1>
        <div className="toolbar grow">
          <button className="iconbtn" aria-label="Previous day" onClick={() => setDay(dayStr(dayStart(day, -1)))}><ChevronLeft size={18} /></button>
          <button className="btn small" onClick={() => setDay(dayStr())}>Today</button>
          <button className="iconbtn" aria-label="Next day" onClick={() => setDay(dayStr(dayStart(day, 1)))}><ChevronRight size={18} /></button>
          <input type="date" className="cellin" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
          <b>{longDay(day)}</b>
          <span className="grow" />
          <button className="iconbtn" aria-label="Refresh" onClick={() => void load()} disabled={busy}><RefreshCw size={16} /></button>
        </div>
      </div>
      <p className="error pad" role="alert">{error}</p>
      {!board ? (
        <p className="pad muted">Loading…</p>
      ) : (
        <div className="board">
          <aside className="waiting">
            <h3>Waiting for a technician ({board.unscheduled.length})</h3>
            {!board.unscheduled.length && <p className="muted small">Every open job is booked.</p>}
            {board.unscheduled.map((w) => (
              <div
                key={w.id}
                className={`jobcard p-${w.priority}`}
                draggable
                onDragStart={(e) => {
                  drag.current = { kind: "job", job: w };
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", w.number);
                }}
                onClick={() => ctx.openJob(w.id)}
              >
                <GripVertical size={14} className="muted grip" />
                <div className="grow">
                  <div className="fname"><b>{w.number}</b> {w.title}</div>
                  <div className="small muted fname">{w.customerName}{w.dueDay ? ` · due ${shortDate(w.dueDay)}` : ""}</div>
                  <div className="small">
                    <span className={`pill ${w.priority}`}>{w.priority}</span> <span className="muted">{hrsText(w.estimateMinutes)}</span>
                    {w.skill && <span className="pill">{w.skill}</span>}
                    {w.status === "on_hold" && <span className="pill on_hold">return visit</span>}
                  </div>
                </div>
              </div>
            ))}
          </aside>
          <section className="lanes">
            <div className="lane scale">
              <div className="who" />
              <div className="track">
                {hours.map((h) => (
                  <span key={h} style={{ left: `${((h - FIRST_HOUR) / HOURS) * 100}%` }}>{fmtHour(h)}</span>
                ))}
              </div>
            </div>
            {!board.technicians.length && <p className="pad muted">Add technicians under Team and settings to start booking.</p>}
            {board.technicians.map((t) => {
              const mine = board.bookings.filter((b) => b.technician === t.email);
              const booked = mine.reduce((a, b) => a + (new Date(b.endsAt).getTime() - new Date(b.startsAt).getTime()), 0);
              return (
                <div key={t.email} className="lane">
                  <div className="who">
                    <b className="fname">{person(t.email, ctx.staff)}</b>
                    <span className="small muted fname">{t.skills.join(", ") || "No skills listed"}</span>
                    <span className="small muted">{hrsText(Math.round(booked / 60_000))} booked</span>
                  </div>
                  <div className="track" onDragOver={(e) => e.preventDefault()} onDrop={(e) => void drop(e, t.email)}>
                    {hours.map((h) => <i key={h} className="hourline" style={{ left: `${((h - FIRST_HOUR) / HOURS) * 100}%` }} />)}
                    {nowPct > 0 && nowPct < 100 && <i className="nowline" style={{ left: `${nowPct}%` }} />}
                    {mine.map((b) => {
                      const s = Math.max(origin, new Date(b.startsAt).getTime());
                      const e = Math.min(origin + span, new Date(b.endsAt).getTime());
                      if (e <= s) return null;
                      return (
                        <div
                          key={b.id}
                          className={`booking st-${b.status} p-${b.priority}`}
                          style={{ left: `${((s - origin) / span) * 100}%`, width: `${((e - s) / span) * 100}%` }}
                          draggable={b.status === "scheduled"}
                          onDragStart={(ev) => {
                            const r = ev.currentTarget.parentElement!.getBoundingClientRect();
                            const grabMs = origin + ((ev.clientX - r.left) / r.width) * span - new Date(b.startsAt).getTime();
                            drag.current = { kind: "booking", booking: b, grabMs };
                            ev.dataTransfer.effectAllowed = "move";
                            ev.dataTransfer.setData("text/plain", b.number);
                          }}
                          onClick={() => ctx.openJob(b.workOrderId)}
                          title={`${b.number} ${b.title}\n${b.customerName}\n${time(b.startsAt)} to ${time(b.endsAt)} · ${STATUS_LABEL[b.status]}`}
                        >
                          <b>{b.number}</b> <span>{b.customerName}</span>
                          <span className="small">{time(b.startsAt)} · {STATUS_LABEL[b.status]}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </section>
        </div>
      )}
    </div>
  );
}

function fmtHour(h: number): string {
  return new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: "numeric" });
}

function hrsText(min: number): string {
  return `${Math.round((min / 60) * 10) / 10} h`;
}
