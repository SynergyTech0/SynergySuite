"use client";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Send, Trash2, Users, X } from "lucide-react";

type Position = { id: string; name: string; color: string };
type Employee = { id: string; name: string; email: string; position_id: string | null; position_name: string | null; position_color: string | null; active: boolean };
type Shift = {
  id: string;
  employee_id: string | null;
  employee_name: string | null;
  position_id: string | null;
  position_name: string | null;
  position_color: string | null;
  location: string;
  shift_date: string;
  start_min: number;
  end_min: number;
  notes: string;
  published: boolean;
};
type Schedule = { weekOf: string; weekEnd: string; shifts: Shift[]; hours: Record<string, number>; drafts: number; admin: boolean; me: string | null };
type Draft = { id?: string; date: string; employeeId: string; positionId: string; start: string; end: string; location: string; notes: string };

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return data as T;
}

const api = {
  schedule: (week: string) => call<Schedule>("GET", `/api/schedule?week=${week}`),
  positions: () => call<Position[]>("GET", "/api/positions"),
  employees: (all = false) => call<Employee[]>("GET", `/api/employees${all ? "?all" : ""}`),
  mine: () => call<Shift[]>("GET", "/api/my-shifts"),
  createShift: (s: object) => call<Shift>("POST", "/api/shifts", s),
  updateShift: (id: string, s: object) => call<Shift>("PATCH", `/api/shifts/${id}`, s),
  deleteShift: (id: string) => call("DELETE", `/api/shifts/${id}`),
  claim: (id: string) => call<Shift>("POST", `/api/shifts/${id}/claim`),
  publish: (week: string) => call<{ published: number }>("POST", "/api/publish", { week }),
  createPosition: (p: object) => call<Position>("POST", "/api/positions", p),
  updatePosition: (id: string, p: object) => call<Position>("PATCH", `/api/positions/${id}`, p),
  deletePosition: (id: string) => call("DELETE", `/api/positions/${id}`),
  createEmployee: (e: object) => call<Employee>("POST", "/api/employees", e),
  updateEmployee: (id: string, e: object) => call<Employee>("PATCH", `/api/employees/${id}`, e),
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const short = (m: number) => {
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  return `${h % 12 || 12}${min ? `:${String(min).padStart(2, "0")}` : ""}${h < 12 ? "a" : "p"}`;
};
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const label = (d: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString([], { ...opts, timeZone: "UTC" });

export function ShiftsApp({ admin }: { admin: boolean }) {
  const [week, setWeek] = useState("");
  const [sched, setSched] = useState<Schedule | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [mine, setMine] = useState<Shift[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [roster, setRoster] = useState(false);
  const [toast, setToast] = useState("");

  const flash = useCallback((e: unknown) => {
    setToast(e instanceof Error ? e.message : String(e));
    setTimeout(() => setToast(""), 5000);
  }, []);

  useEffect(() => {
    setWeek(new URLSearchParams(location.search).get("week") || localToday());
  }, []);

  const load = useCallback(async () => {
    if (!week) return;
    try {
      const [s, p, e, m] = await Promise.all([api.schedule(week), api.positions(), api.employees(), api.mine()]);
      setSched(s);
      setPositions(p);
      setEmployees(e);
      setMine(m);
    } catch (err) {
      flash(err);
    }
  }, [week, flash]);
  useEffect(() => {
    void load();
  }, [load]);

  const monday = sched?.weekOf ?? (week || localToday());
  const days = [...Array(7)].map((_, i) => addDays(monday, i));
  const today = localToday();
  const cell = new Map<string, Shift[]>();
  for (const s of sched?.shifts ?? []) {
    const k = `${s.employee_id ?? "open"}|${s.shift_date}`;
    cell.set(k, [...(cell.get(k) ?? []), s]);
  }
  // People who left the roster but still have shifts this week stay visible.
  const rows = [...employees];
  for (const s of sched?.shifts ?? [])
    if (s.employee_id && !rows.some((e) => e.id === s.employee_id))
      rows.push({ id: s.employee_id, name: s.employee_name ?? "", email: "", position_id: null, position_name: null, position_color: null, active: false });

  const openEditor = (s: Shift | null, date: string, employeeId: string) =>
    setDraft(
      s
        ? { id: s.id, date: s.shift_date, employeeId: s.employee_id ?? "", positionId: s.position_id ?? "", start: hm(s.start_min), end: hm(s.end_min), location: s.location, notes: s.notes }
        : { date, employeeId, positionId: employees.find((e) => e.id === employeeId)?.position_id ?? "", start: "09:00", end: "17:00", location: "", notes: "" },
    );

  const chip = (s: Shift) => (
    <button
      key={s.id}
      className={`chip${s.published ? "" : " draft"}`}
      style={{ borderLeftColor: s.position_color ?? undefined }}
      title={s.published ? undefined : "Draft: only schedulers see it until the week is published"}
      onClick={async () => {
        if (admin) openEditor(s, s.shift_date, s.employee_id ?? "");
        else if (!s.employee_id && sched?.me && confirm(`Take this shift on ${label(s.shift_date, { weekday: "long", month: "short", day: "numeric" })}?`)) {
          try {
            await api.claim(s.id);
            flash("The shift is yours");
            await load();
          } catch (e) {
            flash(e);
          }
        }
      }}
    >
      <div className="t">
        {short(s.start_min)}–{short(s.end_min)}
      </div>
      <div className="m">{[s.position_name, s.location].filter(Boolean).join(" · ")}</div>
      {!s.employee_id && !admin && sched?.me && <div className="m">Click to claim</div>}
    </button>
  );

  return (
    <div className="shifts">
      <div className="board">
        <div className="bar">
          <button className="iconbtn" title="Previous week" onClick={() => setWeek(addDays(monday, -7))}>
            <ChevronLeft size={16} />
          </button>
          <span className="week">
            {label(monday)} – {label(addDays(monday, 6))}
          </span>
          <button className="iconbtn" title="Next week" onClick={() => setWeek(addDays(monday, 7))}>
            <ChevronRight size={16} />
          </button>
          <button className="btn small" onClick={() => setWeek(localToday())}>
            This week
          </button>
          <span className="spacer" />
          {admin && (
            <>
              <button className="btn small" onClick={() => setRoster(true)}>
                <Users size={14} /> Roster
              </button>
              <button
                className="btn small primary"
                disabled={!sched?.drafts}
                onClick={async () => {
                  try {
                    const r = await api.publish(monday);
                    flash(`Published ${r.published} ${r.published === 1 ? "shift" : "shifts"}`);
                    await load();
                  } catch (e) {
                    flash(e);
                  }
                }}
              >
                <Send size={14} /> Publish{sched?.drafts ? ` ${sched.drafts} ${sched.drafts === 1 ? "draft" : "drafts"}` : ""}
              </button>
            </>
          )}
        </div>
        <div className="gridwrap">
          {!sched ? (
            <p className="pad muted">Loading…</p>
          ) : (
            <table className="grid">
              <thead>
                <tr>
                  <th className="who">Person</th>
                  {days.map((d, i) => (
                    <th key={d} className={d === today ? "today" : ""}>
                      {DAYS[i]}
                      <span className="date">{label(d)}</span>
                    </th>
                  ))}
                  <th className="hrs">Hours</th>
                </tr>
              </thead>
              <tbody>
                <tr className="open">
                  <td className="who">
                    <b>Open shifts</b>
                    <div className="muted small">Anyone on the roster can take one</div>
                  </td>
                  {days.map((d) => (
                    <td key={d}>
                      {(cell.get(`open|${d}`) ?? []).map(chip)}
                      {admin && (
                        <button className="add" title="Add an open shift" onClick={() => openEditor(null, d, "")}>
                          <Plus size={12} />
                        </button>
                      )}
                    </td>
                  ))}
                  <td className="hrs" />
                </tr>
                {rows.map((e) => (
                  <tr key={e.id} className={e.id === sched.me ? "mine" : ""}>
                    <td className="who">
                      <div>
                        {e.name}
                        {e.id === sched.me ? " (you)" : ""}
                        {!e.active ? <span className="muted small"> (left)</span> : null}
                      </div>
                      {e.position_name && (
                        <span className="pos" style={{ background: e.position_color ?? "#4f46e5" }}>
                          {e.position_name}
                        </span>
                      )}
                    </td>
                    {days.map((d) => (
                      <td key={d}>
                        {(cell.get(`${e.id}|${d}`) ?? []).map(chip)}
                        {admin && e.active && (
                          <button className="add" title={`Add a shift for ${e.name}`} onClick={() => openEditor(null, d, e.id)}>
                            <Plus size={12} />
                          </button>
                        )}
                      </td>
                    ))}
                    <td className="hrs">{(sched.hours[e.id] ?? 0).toFixed(1).replace(/\.0$/, "")}</td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={9} className="muted">
                      {admin ? "Add people to the roster to start scheduling." : "Nothing has been scheduled yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <aside className="mine">
        <h3>My shifts</h3>
        {!sched?.me && <p className="muted small">You aren&apos;t on the roster, so no shifts are yours yet.</p>}
        {mine.map((s) => (
          <div key={s.id} className="item">
            <b>{label(s.shift_date, { weekday: "short", month: "short", day: "numeric" })}</b> {short(s.start_min)}–{short(s.end_min)}
            <div className="muted small">{[s.position_name, s.location, s.notes].filter(Boolean).join(" · ")}</div>
          </div>
        ))}
        {sched?.me && !mine.length && <p className="muted small">Nothing coming up.</p>}
      </aside>
      {draft && (
        <ShiftEditor
          draft={draft}
          positions={positions}
          employees={employees}
          onClose={() => setDraft(null)}
          onSave={async (d) => {
            const body = { date: d.date, employeeId: d.employeeId || null, positionId: d.positionId || null, start: d.start, end: d.end, location: d.location, notes: d.notes };
            try {
              if (d.id) await api.updateShift(d.id, body);
              else await api.createShift(body);
              setDraft(null);
              await load();
            } catch (e) {
              flash(e);
            }
          }}
          onDelete={
            draft.id
              ? async () => {
                  try {
                    await api.deleteShift(draft.id!);
                    setDraft(null);
                    await load();
                  } catch (e) {
                    flash(e);
                  }
                }
              : undefined
          }
        />
      )}
      {roster && (
        <Roster
          flash={flash}
          onClose={() => {
            setRoster(false);
            void load();
          }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function ShiftEditor({
  draft,
  positions,
  employees,
  onClose,
  onSave,
  onDelete,
}: {
  draft: Draft;
  positions: Position[];
  employees: Employee[];
  onClose: () => void;
  onSave: (d: Draft) => void;
  onDelete?: () => void;
}) {
  const [d, setD] = useState(draft);
  const set = (p: Partial<Draft>) => setD((prev) => ({ ...prev, ...p }));
  return (
    <div className="scrim" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(d);
        }}
      >
        <div className="modalhead">
          <h2>{d.id ? "Edit shift" : "New shift"}</h2>
          <button type="button" className="iconbtn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="form">
          <label>
            <span>Day</span>
            <input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} required />
          </label>
          <div className="row2">
            <label>
              <span>Starts</span>
              <input type="time" value={d.start} onChange={(e) => set({ start: e.target.value })} required />
            </label>
            <label>
              <span>Ends</span>
              <input type="time" value={d.end} onChange={(e) => set({ end: e.target.value })} required />
            </label>
          </div>
          <label>
            <span>Person</span>
            <select value={d.employeeId} onChange={(e) => set({ employeeId: e.target.value })}>
              <option value="">Open shift (anyone can take it)</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Position</span>
            <select value={d.positionId} onChange={(e) => set({ positionId: e.target.value })}>
              <option value="">None</option>
              {positions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Location</span>
            <input value={d.location} onChange={(e) => set({ location: e.target.value })} />
          </label>
          <label>
            <span>Notes</span>
            <textarea value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
          </label>
          <div className="actions">
            {onDelete && (
              <button type="button" className="btn ghost" style={{ marginRight: "auto" }} onClick={() => confirm("Delete this shift?") && onDelete()}>
                <Trash2 size={14} /> Delete
              </button>
            )}
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary">Save</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Roster({ flash, onClose }: { flash: (e: unknown) => void; onClose: () => void }) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [people, setPeople] = useState<Employee[]>([]);
  const [pos, setPos] = useState({ name: "", color: "#4f46e5" });
  const [person, setPerson] = useState({ name: "", email: "", positionId: "" });
  const load = useCallback(async () => {
    try {
      const [p, e] = await Promise.all([api.positions(), api.employees(true)]);
      setPositions(p);
      setPeople(e);
    } catch (err) {
      flash(err);
    }
  }, [flash]);
  useEffect(() => {
    void load();
  }, [load]);
  const run = (p: Promise<unknown>) => p.then(load).catch(flash);

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modalhead">
          <h2>Roster</h2>
          <button className="iconbtn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="form">
          <h3>People</h3>
          <p className="muted small">Someone whose email matches their suite account sees their shifts and can claim open ones.</p>
          <div className="roster">
            {people.map((e) => (
              <div key={e.id} className="row">
                <input defaultValue={e.name} onBlur={(ev) => ev.target.value !== e.name && run(api.updateEmployee(e.id, { name: ev.target.value }))} />
                <input
                  defaultValue={e.email}
                  placeholder="Email"
                  onBlur={(ev) => ev.target.value !== e.email && run(api.updateEmployee(e.id, { email: ev.target.value }))}
                />
                <select value={e.position_id ?? ""} onChange={(ev) => run(api.updateEmployee(e.id, { positionId: ev.target.value || null }))}>
                  <option value="">No position</option>
                  {positions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <label className="check small">
                  <input type="checkbox" checked={e.active} onChange={(ev) => run(api.updateEmployee(e.id, { active: ev.target.checked }))} /> Active
                </label>
              </div>
            ))}
            <form
              className="row"
              onSubmit={(ev) => {
                ev.preventDefault();
                run(api.createEmployee({ ...person, positionId: person.positionId || null }).then(() => setPerson({ name: "", email: "", positionId: "" })));
              }}
            >
              <input placeholder="Name" value={person.name} onChange={(ev) => setPerson({ ...person, name: ev.target.value })} />
              <input placeholder="Email" value={person.email} onChange={(ev) => setPerson({ ...person, email: ev.target.value })} />
              <select value={person.positionId} onChange={(ev) => setPerson({ ...person, positionId: ev.target.value })}>
                <option value="">No position</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button className="btn small primary" disabled={!person.name.trim()}>
                <Plus size={13} /> Add
              </button>
            </form>
          </div>
          <h3>Positions</h3>
          <div className="roster">
            {positions.map((p) => (
              <div key={p.id} className="row">
                <input type="color" defaultValue={p.color} onBlur={(ev) => ev.target.value !== p.color && run(api.updatePosition(p.id, { color: ev.target.value }))} />
                <input defaultValue={p.name} onBlur={(ev) => ev.target.value !== p.name && run(api.updatePosition(p.id, { name: ev.target.value }))} />
                <button
                  className="iconbtn small"
                  title="Delete position"
                  onClick={() => confirm(`Delete ${p.name}? Shifts and people keep everything else.`) && run(api.deletePosition(p.id))}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <form
              className="row"
              onSubmit={(ev) => {
                ev.preventDefault();
                run(api.createPosition(pos).then(() => setPos({ name: "", color: "#4f46e5" })));
              }}
            >
              <input type="color" value={pos.color} onChange={(ev) => setPos({ ...pos, color: ev.target.value })} />
              <input placeholder="New position" value={pos.name} onChange={(ev) => setPos({ ...pos, name: ev.target.value })} />
              <button className="btn small primary" disabled={!pos.name.trim()}>
                <Plus size={13} /> Add
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
