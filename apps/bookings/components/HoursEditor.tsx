"use client";
import { Plus, X } from "lucide-react";
import type { WeekHours } from "@/lib/time";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// Monday first, as people read a week.
const ORDER = [1, 2, 3, 4, 5, 6, 0];

const toTime = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = (v: string, end: boolean) => {
  const [h, m] = v.split(":").map(Number);
  const n = h * 60 + m;
  return end && n === 0 ? 1440 : n;
};

/** Opening or working hours: per weekday, any number of windows (9-12 and 1-5, say). */
export function HoursEditor({ value, onChange }: { value: WeekHours; onChange: (h: WeekHours) => void }) {
  const set = (day: number, wins: WeekHours[number]) => onChange(value.map((w, i) => (i === day ? wins : w)));
  return (
    <div className="hours">
      {ORDER.map((d) => {
        const wins = value[d] ?? [];
        return (
          <div className="hourrow" key={d}>
            <label className="check" style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 4 }}>
              <input type="checkbox" checked={wins.length > 0} onChange={(e) => set(d, e.target.checked ? [[540, 1020]] : [])} />
              {DAYS[d]}
            </label>
            <div className="wins">
              {!wins.length && <span className="muted small" style={{ paddingTop: 5 }}>Closed</span>}
              {wins.map(([s, e], i) => (
                <span className="win" key={i}>
                  <input type="time" aria-label={`${DAYS[d]} from`} value={toTime(s)} step={300}
                    onChange={(ev) => set(d, wins.map((w, j) => (j === i ? [toMin(ev.target.value, false), w[1]] : w)))} />
                  –
                  <input type="time" aria-label={`${DAYS[d]} until`} value={toTime(e)} step={300}
                    onChange={(ev) => set(d, wins.map((w, j) => (j === i ? [w[0], toMin(ev.target.value, true)] : w)))} />
                  <button type="button" className="iconbtn small" aria-label="Remove these hours" onClick={() => set(d, wins.filter((_, j) => j !== i))}><X size={14} /></button>
                </span>
              ))}
              {wins.length > 0 && wins.length < 4 && (
                <button type="button" className="iconbtn small" aria-label={`More hours on ${DAYS[d]}`}
                  onClick={() => { const last = wins[wins.length - 1][1]; set(d, [...wins, [Math.min(last + 60, 1380), Math.min(last + 180, 1440)]]); }}>
                  <Plus size={14} />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
