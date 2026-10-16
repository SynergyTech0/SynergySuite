"use client";
import { Cog, Plus } from "lucide-react";
import { useCallback, useState } from "react";
import type { WorkCenter } from "@/lib/mfg";
import { api, money, qty } from "./client";
import { Modal } from "./Modal";
import type { PaneProps } from "./OpsApp";
import { Empty, Field, ListPane, useAction, useFields, useLoad } from "./ui";

/** Machines, cells or teams that do the steps of a routing, with what an hour there costs. */
export function WorkCentersPane({ say }: PaneProps) {
  const [rows, setRows] = useState<WorkCenter[] | null>(null);
  const [dialog, setDialog] = useState<React.ReactNode>(null);
  const load = useCallback(async () => setRows(await api<WorkCenter[]>("/api/work-centers").catch((e) => (say(e.message), []))), [say]);
  useLoad(load, []);
  const edit = (w?: WorkCenter) => setDialog(<WcDialog w={w} onClose={() => setDialog(null)} onSaved={async () => { setDialog(null); await load(); }} />);

  return (
    <div className="work">
      <ListPane title="Work centers" actions={<button className="btn primary" onClick={() => edit()}><Plus size={16} /> New work center</button>}>
        {rows && !rows.length ? (
          <Empty icon={<Cog size={32} />}><p>Add the machines, cells or teams that do the work. Their hourly rate costs the labor in each bill.</p></Empty>
        ) : (
          <table className="grid">
            <thead><tr><th>Code</th><th>Name</th><th className="num">Rate per hour</th><th className="num">Hours per day</th><th /></tr></thead>
            <tbody>
              {(rows ?? []).map((w) => (
                <tr key={w.id} className="click" onClick={() => edit(w)}>
                  <td className="mono">{w.code}</td>
                  <td>{w.name} {!w.active && <span className="muted small">(inactive)</span>}</td>
                  <td className="num">{money(w.ratePerHour)}</td>
                  <td className="num">{qty(w.hoursPerDay)}</td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ListPane>
      {dialog}
    </div>
  );
}

function WcDialog({ w, onClose, onSaved }: { w?: WorkCenter; onClose: () => void; onSaved: () => Promise<void> }) {
  const { v, bind } = useFields({ code: w?.code ?? "", name: w?.name ?? "", ratePerHour: w ? String(w.ratePerHour) : "", hoursPerDay: w ? String(w.hoursPerDay) : "8", active: w?.active === false ? "0" : "1" });
  const a = useAction();
  return (
    <Modal title={w ? `Edit ${w.code}` : "New work center"} onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await api(w ? `/api/work-centers/${w.id}` : "/api/work-centers", { method: w ? "PATCH" : "POST", json: { ...v, active: v.active === "1" } }); await onSaved(); }); }}>
        <div className="grid2">
          <Field label="Code"><input {...bind("code")} autoFocus required placeholder="CNC1" /></Field>
          <Field label="Name"><input {...bind("name")} required /></Field>
          <Field label="Rate per hour"><input {...bind("ratePerHour")} inputMode="decimal" /></Field>
          <Field label="Hours per day"><input {...bind("hoursPerDay")} inputMode="decimal" /></Field>
          {w && <Field label="In use"><select {...bind("active")}><option value="1">Active</option><option value="0">Inactive</option></select></Field>}
        </div>
        <p className="error">{a.error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={a.busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}
