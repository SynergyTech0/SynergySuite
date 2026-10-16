"use client";
import { CheckCircle2, Factory, Play, Plus } from "lucide-react";
import { useCallback, useState } from "react";
import type { WorkOrder, WorkOrderDetail } from "@/lib/mfg";
import { api, date, money, qty, stamp } from "./client";
import { Modal } from "./Modal";
import type { PaneProps } from "./OpsApp";
import { ItemSelect, useItems } from "./pickers";
import { Card, DetailPane, Empty, Field, Filters, ListPane, Pill, useAction, useFields, useLoad } from "./ui";

type Filter = "open" | "mine" | "done" | "all";

export function WorkOrdersPane({ say, open, setOpen, go }: PaneProps) {
  const [rows, setRows] = useState<WorkOrder[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("open");
  const [dialog, setDialog] = useState<React.ReactNode>(null);
  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (filter === "open" || filter === "done") p.set("status", filter);
    if (filter === "mine") {
      p.set("mine", "1");
      p.set("status", "open");
    }
    if (query) p.set("q", query);
    setRows(await api<WorkOrder[]>(`/api/work-orders?${p}`).catch((e) => (say(e.message), [])));
  }, [filter, query, say]);
  useLoad(load, [filter, query], !!query);

  return (
    <div className={`work${open ? " withdetail" : ""}`}>
      <ListPane
        title="Work orders"
        query={query}
        onQuery={setQuery}
        placeholder="Search number, item or notes"
        filters={<Filters value={filter} onChange={setFilter} options={[["open", "Open"], ["mine", "Assigned to me"], ["done", "Done"], ["all", "All"]]} />}
        actions={<button className="btn primary" onClick={() => setDialog(<NewWoDialog onClose={() => setDialog(null)} onMade={async (w) => { setDialog(null); await load(); setOpen(w.id); say(`${w.number} planned`); }} />)}><Plus size={16} /> New work order</button>}
      >
        {rows && !rows.length ? (
          <Empty icon={<Factory size={32} />}>
            <p>A work order builds a quantity of a made item from its active bill. Planning suggests them too.</p>
          </Empty>
        ) : (
          <table className="grid">
            <thead><tr><th>Number</th><th>Item</th><th className="num">Qty</th><th>Status</th><th>Start</th><th>Due</th><th>Assigned</th></tr></thead>
            <tbody>
              {(rows ?? []).map((w) => (
                <tr key={w.id} className={`click${open === w.id ? " sel" : ""}`} onClick={() => setOpen(w.id)}>
                  <td className="mono">{w.number}</td>
                  <td><span className="mono">{w.sku}</span> {w.name}</td>
                  <td className="num">{qty(w.status === "done" ? w.qtyDone : w.qty)}</td>
                  <td><Pill s={w.status} /> {w.late && <Pill s="late" text="Late" />}</td>
                  <td className="small">{date(w.startDate)}</td>
                  <td className="small">{date(w.dueDate)}</td>
                  <td className="small muted">{w.assignee}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ListPane>
      {open && <WoDetail key={open} id={open} say={say} onClose={() => setOpen(null)} onChanged={load} go={go} />}
      {dialog}
    </div>
  );
}

function NewWoDialog({ onClose, onMade }: { onClose: () => void; onMade: (w: WorkOrderDetail) => Promise<void> }) {
  const items = useItems();
  const { v, setV, bind } = useFields({ itemId: "", qty: "1", dueDate: "", assignee: "", notes: "" });
  const a = useAction();
  return (
    <Modal title="New work order" onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void a.run(async () => onMade(await api<WorkOrderDetail>("/api/work-orders", { method: "POST", json: v }))); }}>
        <Field label="Item to make"><ItemSelect items={items} value={v.itemId} onChange={(x) => setV((o) => ({ ...o, itemId: x }))} filter={(i) => i.hasBom} placeholder="Pick an item with an active bill" /></Field>
        <div className="grid2">
          <Field label="Quantity"><input {...bind("qty")} inputMode="decimal" required /></Field>
          <Field label="Due"><input type="date" {...bind("dueDate")} /></Field>
        </div>
        <Field label="Assigned to (email)"><input type="email" {...bind("assignee")} /></Field>
        <Field label="Notes"><textarea {...bind("notes")} rows={2} /></Field>
        <p className="error">{a.error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={a.busy || !v.itemId}>Plan it</button>
        </div>
      </form>
    </Modal>
  );
}

function WoDetail({ id, say, onClose, onChanged, go }: { id: number; say: (t: string) => void; onClose: () => void; onChanged: () => Promise<void>; go: PaneProps["go"] }) {
  const [w, setW] = useState<WorkOrderDetail | null>(null);
  const [dialog, setDialog] = useState<React.ReactNode>(null);
  const a = useAction();
  const load = useCallback(async () => setW(await api<WorkOrderDetail>(`/api/work-orders/${id}`).catch((e) => (say(e.message), null))), [id, say]);
  useLoad(load, [id]);
  if (!w) return <aside className="detail" />;

  const act = (json: Record<string, unknown>, done?: string) =>
    a.run(async () => {
      setW(await api<WorkOrderDetail>(`/api/work-orders/${id}/act`, { method: "POST", json }));
      await onChanged();
      if (done) say(done);
    });
  const open = w.status !== "done" && w.status !== "cancelled";
  const short = w.materials.filter((m) => m.required - m.issued > m.onHand + 1e-9);
  const unit = w.qtyDone ? (w.materialCost + w.laborCost) / w.qtyDone : 0;

  return (
    <DetailPane
      title={<><span className="mono">{w.number}</span> {w.name}</>}
      sub={<><Pill s={w.status} /> {w.late && <Pill s="late" text="Late" />} {qty(w.qty)} {w.uom} of <span className="mono">{w.sku}</span>{w.bomVersion && ` · bill v${w.bomVersion}`}</>}
      onClose={onClose}
      tools={
        <>
          {w.status === "planned" && <button className="btn small primary" disabled={a.busy} onClick={() => void act({ action: "release" }, `${w.number} released`)}>Release</button>}
          {w.status === "released" && <button className="btn small" disabled={a.busy} onClick={() => void act({ action: "start" })}><Play size={14} /> Start</button>}
          {(w.status === "released" || w.status === "in_progress") && (
            <>
              <button className="btn small" disabled={a.busy} onClick={() => void act({ action: "issue" }, "Materials issued")}>Issue all materials</button>
              <button className="btn small primary" disabled={a.busy} onClick={() => setDialog(<CompleteDialog w={w} onClose={() => setDialog(null)} onDone={async (made) => { setDialog(null); await act({ action: "complete", qtyDone: made }, `${w.number} done: ${made} ${w.uom} into stock`); }} />)}>
                <CheckCircle2 size={14} /> Complete
              </button>
            </>
          )}
          {open && <button className="btn small ghost" disabled={a.busy} onClick={() => confirm(`Cancel ${w.number}?`) && void act({ action: "cancel" }, `${w.number} cancelled`)}>Cancel order</button>}
          {w.bomId && <button className="btn small ghost" onClick={() => go("boms", w.bomId)}>Bill</button>}
        </>
      }
    >
      <p className="error">{a.error}</p>
      {open && w.status !== "planned" && short.length > 0 && <p className="banner">Short of {short.map((m) => m.sku).join(", ")}. Receive stock or run planning before issuing.</p>}
      <div className="stats">
        <div className="stat"><b>{date(w.startDate) || "-"}</b><span>Start</span></div>
        <div className="stat"><b>{date(w.dueDate) || "-"}</b><span>Due</span></div>
        {w.status === "done" && <div className="stat"><b>{money(unit)}</b><span>Actual cost per unit</span></div>}
        {(w.materialCost > 0 || w.laborCost > 0) && <div className="stat"><b>{money(w.materialCost + w.laborCost)}</b><span>Cost so far</span></div>}
      </div>
      {w.status === "planned" ? (
        <Card title="Before release">
          <p className="small muted">Releasing copies the bill&apos;s components and steps onto this order for {qty(w.qty)} {w.uom}. Until then the quantity and dates can change.</p>
          <PlanEdit w={w} onSaved={async (x) => { setW(x); await onChanged(); }} />
        </Card>
      ) : (
        <>
          <Card title="Materials">
            <table className="grid tight">
              <thead><tr><th>Part</th><th className="num">Needed</th><th className="num">Issued</th><th className="num">On hand</th>{open && <th />}</tr></thead>
              <tbody>
                {w.materials.map((m) => {
                  const owed = Math.max(0, m.required - m.issued);
                  return (
                    <tr key={m.id}>
                      <td><span className="mono">{m.sku}</span> {m.name}</td>
                      <td className="num">{qty(m.required)} {m.uom}</td>
                      <td className="num">{qty(m.issued)}</td>
                      <td className={`num${owed > m.onHand + 1e-9 ? " neg" : ""}`}>{qty(m.onHand)}</td>
                      {open && <td>{owed > 0 && <button className="btn small" disabled={a.busy || m.onHand <= 0} onClick={() => void act({ action: "issue", materialId: m.id, qty: Math.min(owed, m.onHand) }, `${m.sku} issued`)}>Issue</button>}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <Card title="Steps">
            {w.operations.length ? (
              <table className="grid tight">
                <thead><tr><th>#</th><th>Step</th><th>Work center</th><th className="num">Planned min</th><th className="num">Actual</th><th /></tr></thead>
                <tbody>
                  {w.operations.map((o) => (
                    <tr key={o.id}>
                      <td>{o.seq}</td>
                      <td>{o.name}</td>
                      <td>{o.workCenter}</td>
                      <td className="num">{qty(o.plannedMinutes)}</td>
                      <td className="num">{o.actualMinutes === null ? "" : qty(o.actualMinutes)}</td>
                      <td>{o.status === "done" ? <span className="small muted" title={o.doneAt ? stamp(o.doneAt) : undefined}>Done{o.doneBy && ` by ${o.doneBy}`}</span> : open && (
                        <button className="btn small" disabled={a.busy} onClick={() => {
                          const m = prompt(`Minutes spent on ${o.name}`, String(o.plannedMinutes));
                          if (m !== null) void act({ action: "operation", operationId: o.id, minutes: m });
                        }}>Done</button>
                      )}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="muted small">This bill has no steps, so no labor is costed.</p>}
          </Card>
        </>
      )}
      {w.status === "done" && (
        <Card title="Result">
          <dl className="kv">
            <dt>Made</dt><dd>{qty(w.qtyDone)} {w.uom}</dd>
            <dt>Material</dt><dd>{money(w.materialCost)}</dd>
            <dt>Labor</dt><dd>{money(w.laborCost)}</dd>
            {w.completedAt && <><dt>Completed</dt><dd>{stamp(w.completedAt)}</dd></>}
          </dl>
        </Card>
      )}
      {w.notes && <Card title="Notes"><p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{w.notes}</p></Card>}
      <p className="muted small">Raised by {w.createdBy || "planning"} on {date(w.createdAt)}{w.assignee && `, assigned to ${w.assignee}`}</p>
      {dialog}
    </DetailPane>
  );
}

function PlanEdit({ w, onSaved }: { w: WorkOrderDetail; onSaved: (w: WorkOrderDetail) => Promise<void> }) {
  const { v, bind } = useFields({ qty: String(w.qty), startDate: w.startDate ?? "", dueDate: w.dueDate ?? "", assignee: w.assignee });
  const a = useAction();
  return (
    <form className="inline" onSubmit={(e) => { e.preventDefault(); void a.run(async () => onSaved(await api<WorkOrderDetail>(`/api/work-orders/${w.id}`, { method: "PATCH", json: v }))); }}>
      <label>Quantity <input className="n" {...bind("qty")} inputMode="decimal" /></label>
      <label>Start <input type="date" {...bind("startDate")} /></label>
      <label>Due <input type="date" {...bind("dueDate")} /></label>
      <label>Assigned to <input type="email" {...bind("assignee")} /></label>
      <button className="btn small" disabled={a.busy}>Save</button>
      <p className="error" style={{ flexBasis: "100%" }}>{a.error}</p>
    </form>
  );
}

function CompleteDialog({ w, onClose, onDone }: { w: WorkOrderDetail; onClose: () => void; onDone: (made: string) => Promise<void> }) {
  const [made, setMade] = useState(String(w.qty));
  const owed = w.materials.filter((m) => m.required > m.issued);
  const pending = w.operations.filter((o) => o.status !== "done");
  return (
    <Modal title={`Complete ${w.number}`} onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void onDone(made); }}>
        <Field label={`Quantity made (${w.uom})`}><input value={made} onChange={(e) => setMade(e.target.value)} inputMode="decimal" autoFocus /></Field>
        {owed.length > 0 && <p className="small">Still to issue, taken from stock now: {owed.map((m) => `${qty(m.required - m.issued)} ${m.sku}`).join(", ")}.</p>}
        {pending.length > 0 && <p className="small">Steps not marked done are booked at their planned minutes: {pending.map((o) => o.name).join(", ")}.</p>}
        <p className="small muted">The finished goods go into stock at what they actually cost.</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Complete</button>
        </div>
      </form>
    </Modal>
  );
}
