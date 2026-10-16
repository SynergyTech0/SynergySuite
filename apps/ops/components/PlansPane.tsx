"use client";
import { CalendarClock, RefreshCw } from "lucide-react";
import { useCallback, useState } from "react";
import type { Asset, MaintPlan } from "@/lib/assets";
import { api, date, qty } from "./client";
import { Modal } from "./Modal";
import type { PaneProps } from "./OpsApp";
import { Empty, Field, ListPane, Pill, useAction, useFields, useLoad } from "./ui";

/** Every preventive plan across the register; plans are added from an asset. */
export function PlansPane({ say, go, refreshMe }: PaneProps) {
  const [rows, setRows] = useState<MaintPlan[] | null>(null);
  const a = useAction();
  const load = useCallback(async () => setRows(await api<MaintPlan[]>("/api/plans").catch((e) => (say(e.message), []))), [say]);
  useLoad(load, []);
  const schedule = () =>
    a.run(async () => {
      const r = await api<{ created: string[] }>("/api/plans/schedule", { method: "POST" });
      say(r.created.length ? `Opened ${r.created.join(", ")}` : "Nothing is due");
      await load();
      await refreshMe();
    });

  return (
    <div className="work">
      <ListPane title="Preventive plans" actions={<button className="btn" disabled={a.busy} onClick={() => void schedule()}><RefreshCw size={16} /> Open due work now</button>}>
        <p className="error" style={{ padding: "0 20px" }}>{a.error}</p>
        {rows && !rows.length ? (
          <Empty icon={<CalendarClock size={32} />}><p>Plans open maintenance on a schedule (every 90 days) or by meter (every 250 hours). Add them from an asset. Due work opens on its own every hour.</p></Empty>
        ) : (
          <table className="grid">
            <thead><tr><th>Plan</th><th>Asset</th><th>Every</th><th>Next due</th><th>Last done</th><th>Assigned</th><th /></tr></thead>
            <tbody>
              {(rows ?? []).map((p) => (
                <tr key={p.id} className="click" onClick={() => go("assets", p.assetId)}>
                  <td>{p.title} {!p.active && <span className="muted small">(paused)</span>}</td>
                  <td><span className="mono">{p.assetTag}</span> {p.assetName}</td>
                  <td className="small">{[p.intervalDays && `${p.intervalDays} days`, p.intervalMeter && `${qty(p.intervalMeter)} on the meter`].filter(Boolean).join(" or ")}</td>
                  <td className="small">{[p.nextDue && date(p.nextDue), p.nextMeter !== null && `at ${qty(p.nextMeter)}`].filter(Boolean).join(" or ")}</td>
                  <td className="small">{date(p.lastDone)}</td>
                  <td className="small muted">{p.assignee}</td>
                  <td>{p.due && <Pill s="late" text={p.due} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ListPane>
    </div>
  );
}

export function PlanDialog({ asset, plan, onClose, onSaved }: { asset: Asset; plan?: MaintPlan; onClose: () => void; onSaved: () => Promise<void> }) {
  const s = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  const { v, bind } = useFields({
    title: plan?.title ?? "", instructions: plan?.instructions ?? "", intervalDays: s(plan?.intervalDays), intervalMeter: s(plan?.intervalMeter),
    nextDue: "", assignee: plan?.assignee ?? "", estimatedMinutes: s(plan?.estimatedMinutes), active: plan?.active === false ? "0" : "1",
  });
  const a = useAction();
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    void a.run(async () => {
      const json = { ...v, active: v.active === "1", assetId: asset.id };
      await api(plan ? `/api/plans/${plan.id}` : "/api/plans", { method: plan ? "PATCH" : "POST", json });
      await onSaved();
    });
  };
  const remove = () =>
    a.run(async () => {
      if (!plan || !confirm(`Delete the plan "${plan.title}"? Work it already opened stays.`)) return;
      await api(`/api/plans/${plan.id}`, { method: "DELETE" });
      await onSaved();
    });
  return (
    <Modal title={plan ? "Edit plan" : `New plan for ${asset.tag}`} onClose={onClose} wide>
      <form className="form" onSubmit={save}>
        <Field label="Title"><input {...bind("title")} autoFocus required placeholder="Oil and filter change" /></Field>
        <Field label="Instructions"><textarea {...bind("instructions")} rows={3} /></Field>
        <div className="grid2">
          <Field label="Every so many days"><input {...bind("intervalDays")} inputMode="numeric" placeholder="90" /></Field>
          <Field label={`Every so much on the meter${asset.meterUnit ? ` (${asset.meterUnit})` : ""}`}>
            <input {...bind("intervalMeter")} inputMode="decimal" disabled={!asset.meterUnit} placeholder={asset.meterUnit ? "250" : "Give the asset a meter first"} />
          </Field>
          {!plan && <Field label="First due (optional)"><input type="date" {...bind("nextDue")} /></Field>}
          <Field label="Assign to (email)"><input type="email" {...bind("assignee")} /></Field>
          <Field label="Estimated minutes"><input {...bind("estimatedMinutes")} inputMode="numeric" /></Field>
          {plan && <Field label="State"><select {...bind("active")}><option value="1">Active</option><option value="0">Paused</option></select></Field>}
        </div>
        <p className="error">{a.error}</p>
        <div className="actions">
          {plan && <button type="button" className="btn ghost" onClick={() => void remove()}>Delete</button>}
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={a.busy}>Save plan</button>
        </div>
      </form>
    </Modal>
  );
}
