"use client";
import { Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { Ctx } from "./FieldApp";
import { Modal } from "./Modal";
import { type Staff, api, money } from "./client";

export function TeamView({ ctx }: { ctx: Ctx }) {
  const [editing, setEditing] = useState<Staff | "new" | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const s = ctx.status.settings;
  return (
    <>
      <div className="head"><h1>Team and settings</h1></div>
      <div className="body">
        <section>
          <div className="toolbar"><h2 className="grow">Team</h2><button className="btn small primary" onClick={() => setEditing("new")}><Plus size={14} /> Add someone</button></div>
          <p className="small muted">Dispatchers take jobs in, book, bill and run the team. Technicians see the jobs booked to them on their phone.</p>
          <div className="tablewrap">
            <table className="grid">
              <thead><tr><th>Name</th><th>Role</th><th>Skills</th><th>Phone</th><th className="num">Bill rate</th><th /></tr></thead>
              <tbody>
                {ctx.staff.map((p) => (
                  <tr key={p.email} className={`click${p.active ? "" : " muted"}`} onClick={() => setEditing(p)}>
                    <td><b>{p.name || p.email}</b><div className="small muted">{p.email}</div></td>
                    <td>{p.role === "dispatcher" ? "Dispatcher" : "Technician"}{!p.active && <span className="pill">off the team</span>}</td>
                    <td>{p.skills.map((k) => <span key={k} className="pill">{k}</span>)}</td>
                    <td>{p.phone}</td>
                    <td className="num">{p.billRateCents !== null ? money(p.billRateCents, s.currency) : <span className="muted">default</span>}</td>
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section>
          <h2>Billing and schedule</h2>
          <form className="form flush narrow" onSubmit={async (e) => {
            e.preventDefault();
            try {
              setError("");
              await api("/api/settings", { method: "PUT", json: Object.fromEntries(new FormData(e.currentTarget)) });
              await ctx.reloadStatus();
              setSaved("Saved");
            } catch (x) {
              setError((x as Error).message);
            }
          }}>
            <div className="row2">
              <label><span>Labor rate per hour</span><input name="laborRate" defaultValue={String(s.laborRateCents / 100)} /></label>
              <label><span>Trip fee per visit</span><input name="tripFee" defaultValue={String(s.tripFeeCents / 100)} /></label>
            </div>
            <div className="row2">
              <label><span>Currency</span><input name="currency" defaultValue={s.currency} maxLength={3} /></label>
              <label><span>Time zone for working hours</span><input name="timeZone" defaultValue={s.timeZone} placeholder="America/Chicago" /></label>
            </div>
            <p className="small muted">A technician&apos;s own rate wins over the labor rate. Suggestions look for gaps between 8:00 and 17:00 in this time zone.</p>
            <p className="error" role="alert">{error}</p>
            <div className="actions"><span className="ok small">{saved}</span><button className="btn primary">Save</button></div>
          </form>
        </section>
        {ctx.status.links.commerce && (
          <section>
            <h2>Parts to Commerce</h2>
            <p className="small">
              {ctx.status.parts.pending + ctx.status.parts.failed === 0 ? "Every part used has reached Commerce." : `${ctx.status.parts.pending + ctx.status.parts.failed} parts are waiting to reach Commerce.`}
              {ctx.status.parts.lastError && <span className="error"> Last error: {ctx.status.parts.lastError}</span>}
            </p>
            <button className="btn small" onClick={async () => {
              await api("/api/parts/sync", { method: "POST" }).catch((e) => setError((e as Error).message));
              await ctx.reloadStatus();
            }}><RefreshCw size={14} /> Send now</button>
          </section>
        )}
      </div>
      {editing && <StaffDialog ctx={ctx} person={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function StaffDialog({ ctx, person, onClose }: { ctx: Ctx; person: Staff | null; onClose: () => void }) {
  const [error, setError] = useState("");
  return (
    <Modal title={person ? person.name || person.email : "Add someone"} onClose={onClose} wide>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.currentTarget));
        try {
          await api("/api/staff", { method: "POST", json: { ...f, email: person?.email ?? f.email, active: f.active === "on" } });
          await ctx.reloadStaff();
          onClose();
        } catch (x) {
          setError((x as Error).message);
        }
      }}>
        {!person && <label><span>Email</span><input name="email" type="email" required autoFocus /></label>}
        <div className="row2">
          <label><span>Name</span><input name="name" defaultValue={person?.name} /></label>
          <label><span>Role</span><select name="role" defaultValue={person?.role ?? "technician"}><option value="technician">Technician</option><option value="dispatcher">Dispatcher</option></select></label>
        </div>
        <label><span>Skills, separated by commas</span><input name="skills" defaultValue={person?.skills.join(", ")} placeholder="hvac, electrical, refrigeration" /></label>
        <div className="row3">
          <label><span>Phone</span><input name="phone" defaultValue={person?.phone} /></label>
          <label><span>Home base</span><input name="homeBase" defaultValue={person?.homeBase} /></label>
          <label><span>Bill rate per hour</span><input name="billRate" defaultValue={person?.billRateCents != null ? String(person.billRateCents / 100) : ""} placeholder="Default" /></label>
        </div>
        <label className="check"><input type="checkbox" name="active" defaultChecked={person?.active ?? true} /> On the team</label>
        <p className="error" role="alert">{error}</p>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Save</button></div>
      </form>
    </Modal>
  );
}
