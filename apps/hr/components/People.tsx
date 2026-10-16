"use client";
import { Pencil, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type Ctx, type Employee, EMPLOYMENT_LABELS, api, dayLabel, formData, initials } from "./client";
import { Modal } from "./Modal";
import { PayTab } from "./PayTab";

export function People({ ctx, selected, onSelect }: { ctx: Ctx; selected: string | null; onSelect: (id: string | null) => void }) {
  const { me } = ctx;
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("");
  const [former, setFormer] = useState<Employee[] | null>(null);
  const [adding, setAdding] = useState(false);

  const list = former ?? ctx.people;
  const departments = useMemo(() => [...new Set(ctx.people.map((p) => p.department).filter(Boolean))].sort() as string[], [ctx.people]);
  const shown = list.filter((p) => {
    const hay = `${p.name} ${p.email} ${p.title ?? ""} ${p.department ?? ""} ${p.location ?? ""}`.toLowerCase();
    return (!dept || p.department === dept) && query.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
  });
  const byEmail = new Map(ctx.people.map((p) => [p.email, p]));

  const toggleFormer = async () => setFormer(former ? null : await api<Employee[]>("/api/employees?former=1"));

  return (
    <div className={selected ? "split" : "single"}>
      <main className="view">
        <div className="viewhead">
          <h1>People</h1>
          <span className="muted">{shown.length} of {list.length}</span>
          <div className="right row">
            <label className="search"><Search size={16} /><input placeholder="Search people" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
            {departments.length > 0 && (
              <select className="btn" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
                <option value="">All teams</option>
                {departments.map((d) => <option key={d}>{d}</option>)}
              </select>
            )}
            {me.roles.hrAdmin && <button className="btn" onClick={toggleFormer}>{former ? "Current only" : "Show former"}</button>}
            {me.roles.hrAdmin && <button className="btn primary" onClick={() => setAdding(true)}><Plus size={16} /> Add person</button>}
          </div>
        </div>
        <div className="viewbody">
          {list.length === 0 ? (
            <p className="empty">{me.roles.hrAdmin ? "Nobody here yet. Add the first person." : "HR hasn't added anyone yet."}</p>
          ) : (
            <table className="list">
              <thead><tr><th>Name</th><th className="hide-sm">Team</th><th className="hide-sm">Manager</th><th className="hide-sm">Location</th></tr></thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} className={`click${p.id === selected ? " sel" : ""}`} onClick={() => onSelect(p.id)}>
                    <td>
                      <div className="who">
                        <span className="avatar">{initials(p.name)}</span>
                        <div><b>{p.name}{p.active === false && <span className="badge" style={{ display: "inline", marginLeft: 6 }}>former</span>}</b><span>{p.title || p.email}</span></div>
                      </div>
                    </td>
                    <td className="hide-sm">{p.department}</td>
                    <td className="hide-sm">{byEmail.get(p.manager_email)?.name ?? p.manager_email}</td>
                    <td className="hide-sm">{p.location}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
      {selected && <PersonPanel key={selected} ctx={ctx} id={selected} onClose={() => onSelect(null)} />}
      {adding && (
        <EditPerson
          ctx={ctx}
          onClose={() => setAdding(false)}
          onSaved={(e) => {
            setAdding(false);
            onSelect(e.id);
          }}
        />
      )}
    </div>
  );
}

function PersonPanel({ ctx, id, onClose }: { ctx: Ctx; id: string; onClose: () => void }) {
  const [p, setP] = useState<Employee | null>(null);
  const [tab, setTab] = useState<"profile" | "pay">("profile");
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState("");
  const load = () => api<Employee>(`/api/employees/${id}`).then(setP, (e) => setErr((e as Error).message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (err) return <aside className="view pad"><p className="error">{err}</p></aside>;
  if (!p) return <aside className="view pad muted">Loading…</aside>;
  const manager = ctx.people.find((x) => x.email === p.manager_email);
  const reports = ctx.people.filter((x) => x.manager_email === p.email);
  const canEdit = ctx.me.roles.hrAdmin || p.tier === "self";

  return (
    <aside className="view" aria-label={p.name}>
      <div className="viewhead">
        <span className="avatar big">{initials(p.name)}</span>
        <div className="grow">
          <h2>{p.name}</h2>
          <div className="muted">{[p.title, p.department].filter(Boolean).join(", ")}</div>
          {p.pronouns && <div className="small muted">{p.pronouns}</div>}
        </div>
        {canEdit && <button className="iconbtn" aria-label="Edit" onClick={() => setEditing(true)}><Pencil size={17} /></button>}
        <button className="iconbtn" aria-label="Close" onClick={onClose}><X size={18} /></button>
      </div>
      {ctx.me.roles.payrollAdmin && (
        <div className="tabs">
          <button className={tab === "profile" ? "on" : ""} onClick={() => setTab("profile")}>Profile</button>
          <button className={tab === "pay" ? "on" : ""} onClick={() => setTab("pay")}>Pay</button>
        </div>
      )}
      {tab === "profile" ? (
        <div className="viewbody" style={{ paddingTop: 16 }}>
          <dl className="facts">
            <dt>Email</dt><dd><a href={`mailto:${p.email}`}>{p.email}</a></dd>
            {p.phone && <><dt>Phone</dt><dd>{p.phone}</dd></>}
            {p.location && <><dt>Location</dt><dd>{p.location}</dd></>}
            <dt>Manager</dt>
            <dd>{manager ? <button className="linkbtn" onClick={() => ctx.openPerson(manager.id)}>{manager.name}</button> : p.manager_email || "None"}</dd>
            {p.employment_type && <><dt>Employment</dt><dd>{EMPLOYMENT_LABELS[p.employment_type] ?? p.employment_type}</dd></>}
            {p.start_date && <><dt>Started</dt><dd>{dayLabel(p.start_date)}</dd></>}
            {p.end_date && <><dt>Last day</dt><dd>{dayLabel(p.end_date)}</dd></>}
            {p.pto_days_per_year !== undefined && <><dt>Time off a year</dt><dd>{p.pto_days_per_year} vacation, {p.sick_days_per_year} sick days</dd></>}
            {p.emergency_contact !== undefined && <><dt>Emergency contact</dt><dd>{p.emergency_contact || <span className="muted">Not given</span>}</dd></>}
            {p.personal_email && <><dt>Personal email</dt><dd>{p.personal_email}</dd></>}
            {p.home_address && <><dt>Home address</dt><dd style={{ whiteSpace: "pre-wrap" }}>{p.home_address}</dd></>}
            {p.notes && <><dt>HR notes</dt><dd style={{ whiteSpace: "pre-wrap" }}>{p.notes}</dd></>}
          </dl>
          {reports.length > 0 && (
            <section className="section">
              <h3>Reports ({reports.length})</h3>
              {reports.map((r) => (
                <button key={r.id} className="orgcard" onClick={() => ctx.openPerson(r.id)}>
                  <span className="avatar">{initials(r.name)}</span><span><b>{r.name}</b><br /><span className="small muted">{r.title}</span></span>
                </button>
              ))}
            </section>
          )}
        </div>
      ) : (
        <PayTab ctx={ctx} person={p} />
      )}
      {editing && (
        <EditPerson
          ctx={ctx}
          person={p}
          onClose={() => setEditing(false)}
          onSaved={(e) => {
            setEditing(false);
            setP(e);
          }}
        />
      )}
    </aside>
  );
}

function EditPerson({ ctx, person, onClose, onSaved }: { ctx: Ctx; person?: Employee; onClose: () => void; onSaved: (e: Employee) => void }) {
  const admin = ctx.me.roles.hrAdmin;
  const [err, setErr] = useState("");
  const p = person;
  const managers = ctx.people.filter((x) => x.email !== p?.email);
  return (
    <Modal title={p ? `Edit ${p.name}` : "Add a person"} onClose={onClose} wide>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const b = formData(e.currentTarget);
          try {
            const saved = p
              ? await api<Employee>(`/api/employees/${p.id}`, { method: "PATCH", json: b })
              : await api<Employee>("/api/employees", { method: "POST", json: b });
            await Promise.all([ctx.reloadPeople(), ctx.reloadMe()]);
            ctx.toast(p ? "Saved" : `${saved.name} added`);
            onSaved(saved);
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        {admin && (
          <>
            <div className="grid2">
              <label><span>Name</span><input name="name" defaultValue={p?.name} required autoFocus /></label>
              {p ? <label><span>Work email</span><input value={p.email} disabled /></label>
                : <label><span>Work email</span><input name="email" type="email" required /></label>}
              <label><span>Job title</span><input name="title" defaultValue={p?.title} /></label>
              <label><span>Team or department</span><input name="department" defaultValue={p?.department} list="hr-departments" /></label>
              <label>
                <span>Manager</span>
                <select name="managerEmail" defaultValue={p?.manager_email ?? ""}>
                  <option value="">None</option>
                  {managers.map((m) => <option key={m.id} value={m.email}>{m.name}</option>)}
                </select>
              </label>
              <label><span>Location</span><input name="location" defaultValue={p?.location} /></label>
              <label>
                <span>Employment</span>
                <select name="employmentType" defaultValue={p?.employment_type ?? "full_time"}>
                  {Object.entries(EMPLOYMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <div className="grid2">
                <label><span>Start date</span><input name="startDate" type="date" defaultValue={p?.start_date ?? ""} /></label>
                <label><span>Last day</span><input name="endDate" type="date" defaultValue={p?.end_date ?? ""} /></label>
              </div>
              <label><span>Vacation days a year</span><input name="ptoDays" inputMode="decimal" defaultValue={p?.pto_days_per_year ?? 15} /></label>
              <label><span>Sick days a year</span><input name="sickDays" inputMode="decimal" defaultValue={p?.sick_days_per_year ?? 5} /></label>
            </div>
            <datalist id="hr-departments">{[...new Set(ctx.people.map((x) => x.department).filter(Boolean))].map((d) => <option key={d} value={d} />)}</datalist>
          </>
        )}
        <div className="grid2">
          <label><span>Phone</span><input name="phone" defaultValue={p?.phone} /></label>
          <label><span>Pronouns</span><input name="pronouns" defaultValue={p?.pronouns} /></label>
          <label><span>Personal email</span><input name="personalEmail" type="email" defaultValue={p?.personal_email} /></label>
          <label><span>Emergency contact</span><input name="emergencyContact" defaultValue={p?.emergency_contact} placeholder="Name, relationship, phone" /></label>
        </div>
        <label><span>Home address</span><textarea name="homeAddress" rows={2} defaultValue={p?.home_address} /></label>
        {admin && <label><span>HR notes (only HR sees these)</span><textarea name="notes" rows={3} defaultValue={p?.notes} /></label>}
        {admin && p && <label className="check"><input type="checkbox" name="active" defaultChecked={p.active !== false} /> Current employee</label>}
        <p className="error" role="alert">{err}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">{p ? "Save" : "Add"}</button>
        </div>
      </form>
    </Modal>
  );
}
