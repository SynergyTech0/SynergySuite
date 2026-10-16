"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type Slot, addDays, dayKey, longDay, shortDay, timeIn, zoneLabel, zones } from "./client";

/**
 * A week of days with free times, then the times on the chosen day, shown in the viewer's own
 * time zone (they can pick another). Slots are asked for by the page's days, a day either side.
 */
export function SlotPicker({
  load, pageZone, maxDaysAhead, zone, onZone, value, onPick,
}: {
  load: (fromDay: string, toDay: string) => Promise<Slot[]>;
  pageZone: string; maxDaysAhead: number; zone: string; onZone: (tz: string) => void;
  value: string | null; onPick: (slot: Slot) => void;
}) {
  const today = dayKey(Date.now(), zone);
  const last = addDays(today, maxDaysAhead);
  const [weekStart, setWeekStart] = useState(today);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    setSlots(null);
    setError("");
    const from = addDays(dayKey(new Date(`${weekStart}T12:00:00Z`), pageZone), -1);
    load(from, addDays(from, 8))
      .then((s) => live && setSlots(s))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [weekStart, load, pageZone]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const byDay = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots ?? []) {
      const k = dayKey(s.start, zone);
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return m;
  }, [slots, zone]);

  // Land on the first day with times once a week loads.
  useEffect(() => {
    if (!slots) return;
    if (day && days.includes(day) && byDay.has(day)) return;
    setDay(days.find((d) => byDay.has(d)) ?? null);
  }, [slots, byDay, days, day]);

  const list = day ? byDay.get(day) ?? [] : [];
  return (
    <div className="panel">
      <div className="week">
        <button className="iconbtn" aria-label="Earlier week" disabled={weekStart <= today} onClick={() => setWeekStart(addDays(weekStart, -7) < today ? today : addDays(weekStart, -7))}>
          <ChevronLeft size={18} />
        </button>
        {days.map((d) => {
          const s = shortDay(d);
          const has = byDay.has(d);
          return (
            <button key={d} className={`daybtn${has ? " has" : ""}${d === day ? " on" : ""}`} disabled={!has} onClick={() => setDay(d)}
              aria-label={`${longDay(d)}${has ? "" : ", no times"}`}>
              <span>{s.dow}</span><b>{s.num}</b><span>{s.mon}</span>
            </button>
          );
        })}
        <button className="iconbtn" aria-label="Later week" disabled={addDays(weekStart, 7) > last} onClick={() => setWeekStart(addDays(weekStart, 7))}>
          <ChevronRight size={18} />
        </button>
      </div>
      {error ? <p className="error">{error}</p>
        : !slots ? <p className="muted">Finding free times…</p>
          : !day ? <p className="muted">No free times this week. Try the next one.</p>
            : (
              <>
                <h3 style={{ textTransform: "none", letterSpacing: 0, fontSize: 14, color: "var(--text)", margin: 0 }}>{longDay(day)}</h3>
                <div className="times">
                  {list.map((s) => (
                    <button key={s.start} className={value === s.start ? "on" : ""} onClick={() => onPick(s)}>{timeIn(s.start, zone)}</button>
                  ))}
                </div>
              </>
            )}
      <div className="tzline">
        <span>Times are in</span>
        <select value={zone} onChange={(e) => onZone(e.target.value)} aria-label="Time zone">
          {[...new Set([zone, pageZone, ...zones()])].map((z) => <option key={z} value={z}>{zoneLabel(z)}</option>)}
        </select>
      </div>
    </div>
  );
}
