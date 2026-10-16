"use client";
import { Plus, Wrench } from "lucide-react";
import { useCallback, useState } from "react";
import type { MaintOrder, MaintPart } from "@/lib/assets";
import { api, date, label, money, qty, stamp } from "./client";
import { Modal } from "./Modal";
import type { PaneProps } from "./OpsApp";
import { ItemSelect, useAssets, useItems } from "./pickers";
import { Card, DetailPane, Empty, Field, Filters, ListPane, Pill, useAction, useFields, useLoad } from "./ui";

type Filter = "active" | "mine" | "done" | "all";
type Detail = MaintOrder & { parts: MaintPart[] };

export function MaintenancePane({ say, open, setOpen, go, refreshMe }: PaneProps) {
  const [rows, setRows] = useState<MaintOrder[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("active");
  const [dialog, setDialog] = useState<React.ReactNode>(null);
  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (filter === "active" || filter === "done") p.set("status", filter);
    if (filter === "mine") {
      p.set("mine", "1");
      p.set("status", "active");
    }
    if (query) p.set("q", query);
    setRows(await api<MaintOrder[]>(`/api/maintenance?${p}`).catch((e) => (say(e.message), [])));
  }, [filter, query, say]);
  useLoad(load, [filter, query], !!query);

  return (
    <div className={`work${open ? " withdetail" : ""}`}>
      <ListPane
        title="Maintenance"
        query={query}
        onQuery={setQuery}
        placeholder="Search work or asset"
        filters={<Filters value={filter} onChange={setFilter} options={[["active", "Open"], ["mine", "Assigned to me"], ["done", "Done"], ["all", "All"]]} />}
        actions={<button className="btn primary" onClick={() => setDialog(<NewOrderDialog onClose={() => setDialog(null)} onMade={async (o) => { setDialog(null); await load(); await refreshMe(); setOpen(o.id); say(`${o.number} opened`); }} />)}><Plus size={16} /> New request</button>}
      >
        {rows && !rows.length ? (
          <Empty icon={<Wrench size={32} />}><p>Repairs, inspections and planned service. Preventive plans open these on their own when they come due.</p></Empty>
        ) : (
          <table className="grid">
            <thead><tr><th>Number</th><th>Work</th><th>Asset</th><th>Kind</th><th>Priority</th><th>Status</th><th>Due</th><th>Assigned</th></tr></thead>
            <tbody>
              {(rows ?? []).map((o) => (
                <tr key={o.id} className={`click${open === o.id ? " sel" : ""}`} onClick={() => setOpen(o.id)}>
                  <td className="mono">{o.number}</td>
                  <td>{o.title}</td>
                  <td><span className="mono">{o.assetTag}</span> {o.assetName}</td>
                  <td className="small">{label(o.kind)}</td>
                  <td>{o.priority !== "normal" && <Pill s={o.priority} />}</td>
                  <td><Pill s={o.status} /> {o.late && <Pill s="late" text="Late" />}</td>
                  <td className="small">{date(o.dueDate)}</td>
                  <td className="small muted">{o.assignee}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ListPane>
      {open && <OrderDetail key={open} id={open} say={say} onClose={() => setOpen(null)} onChanged={async () => { await load(); await refreshMe(); }} go={go} />}
      {dialog}
    </div>
  );
}

function OrderDetail({ id, say, onClose, onChanged, go }: { id: number; say: (t: string) => void; onClose: () => void; onChanged: () => Promise<void>; go: PaneProps["go"] }) {
  const [o, setO] = useState<Detail | null>(null);
  const items = useItems();
  const [part, setPart] = useState({ itemId: "", qty: "1" });
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const a = useAction();
  const load = useCallback(async () => {
    const r = await api<Detail>(`/api/maintenance/${id}`).catch((e) => (say(e.message), null));
    setO(r);
    if (r) setForm({ assignee: r.assignee, dueDate: r.dueDate ?? "", priority: r.priority, laborMinutes: String(r.laborMinutes), laborRate: String(r.laborRate), downtimeMinutes: String(r.downtimeMinutes), resolution: r.resolution });
  }, [id, say]);
  useLoad(load, [id]);
  if (!o || !form) return <aside className="detail" />;
  const open = o.status !== "done" && o.status !== "cancelled";
  const patch = (json: Record<string, unknown>, done?: string) =>
    a.run(async () => {
      setO(await api<Detail>(`/api/maintenance/${id}`, { method: "PATCH", json }));
      await onChanged();
      if (done) say(done);
    });
  const bind = (k: string) => ({ value: form[k] ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f!, [k]: e.target.value })) });
  const addPart = (e: React.FormEvent) => {
    e.preventDefault();
    void a.run(async () => {
      setO(await api<Detail>(`/api/maintenance/${id}/parts`, { method: "POST", json: part }));
      setPart({ itemId: "", qty: "1" });
    });
  };
  const labor = (o.laborMinutes * o.laborRate) / 60;

  return (
    <DetailPane
      title={<><span className="mono">{o.number}</span> {o.title}</>}
      sub={<><Pill s={o.status} /> {o.late && <Pill s="late" text="Late" />} {label(o.kind)} on <button className="linkbtn" onClick={() => go("assets", o.assetId)}>{o.assetTag} {o.assetName}</button></>}
      onClose={onClose}
      tools={open && (
        <>
          {o.status !== "in_progress" && <button className="btn small primary" disabled={a.busy} onClick={() => void patch({ status: "in_progress" })}>Start work</button>}
          {o.status === "in_progress" && <button className="btn small" disabled={a.busy} onClick={() => void patch({ status: "on_hold" })}>Put on hold</button>}
          <button className="btn small primary" disabled={a.busy} onClick={() => void patch({ ...form, status: "done" }, `${o.number} done`)}>Mark done</button>
          <button className="btn small ghost" disabled={a.busy} onClick={() => confirm(`Cancel ${o.number}?`) && void patch({ status: "cancelled" })}>Cancel</button>
        </>
      )}
    >
      <p className="error">{a.error}</p>
      {o.description && <Card title="What needs doing"><p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{o.description}</p></Card>}
      <Card title="Work">
        <div className="form" style={{ padding: 0 }}>
          <div className="grid2">
            <Field label="Assigned to (email)"><input type="email" {...bind("assignee")} disabled={!open} /></Field>
            <Field label="Due"><input type="date" {...bind("dueDate")} disabled={!open} /></Field>
            <Field label="Priority">
              <select {...bind("priority")} disabled={!open}>{["low", "normal", "high", "urgent"].map((p) => <option key={p} value={p}>{label(p)}</option>)}</select>
            </Field>
            <Field label="Downtime (minutes)"><input {...bind("downtimeMinutes")} inputMode="numeric" disabled={!open} /></Field>
            <Field label="Labor (minutes)"><input {...bind("laborMinutes")} inputMode="numeric" disabled={!open} /></Field>
            <Field label="Labor rate per hour"><input {...bind("laborRate")} inputMode="decimal" disabled={!open} /></Field>
            <Field label="What was done" wide><textarea {...bind("resolution")} rows={3} /></Field>
          </div>
          <div className="actions">
            <button className="btn small" disabled={a.busy} onClick={() => void patch(open ? form : { resolution: form.resolution }, "Saved")}>Save</button>
          </div>
        </div>
      </Card>
      <Card title={`Parts used${o.partsCost ? `: ${money(o.partsCost)}` : ""}`}>
        {o.parts.length > 0 && (
          <table className="grid tight">
            <thead><tr><th>Part</th><th className="num">Qty</th><th className="num">Cost</th><th>By</th></tr></thead>
            <tbody>
              {o.parts.map((p) => (
                <tr key={p.id}><td><span className="mono">{p.sku}</span> {p.name}</td><td className="num">{qty(p.qty)} {p.uom}</td><td className="num">{money(p.qty * p.unitCost)}</td><td className="small muted">{p.by}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        {open ? (
          <form className="inline" onSubmit={addPart}>
            <label>Part <ItemSelect items={items} value={part.itemId} onChange={(x) => setPart((p) => ({ ...p, itemId: x }))} filter={(i) => i.onHand > 0} placeholder="Pick a part in stock" /></label>
            <label>Qty <input className="n" value={part.qty} onChange={(e) => setPart((p) => ({ ...p, qty: e.target.value }))} inputMode="decimal" /></label>
            <button className="btn small" disabled={a.busy || !part.itemId}>Take from stock</button>
          </form>
        ) : !o.parts.length && <p className="muted small">No parts used.</p>}
      </Card>
      <Card title="Cost">
        <dl className="kv">
          <dt>Labor</dt><dd>{money(labor)}</dd>
          <dt>Parts</dt><dd>{money(o.partsCost)}</dd>
          <dt>Total</dt><dd><b>{money(labor + o.partsCost)}</b></dd>
        </dl>
      </Card>
      <p className="muted small">
        {o.requestedBy === "scheduler" ? "Opened by its preventive plan" : `Reported by ${o.requestedBy}`} on {stamp(o.createdAt)}
        {o.completedAt && `. Done ${stamp(o.completedAt)}`}
      </p>
    </DetailPane>
  );
}

export function NewOrderDialog({ assetId, onClose, onMade }: { assetId?: number; onClose: () => void; onMade: (o: MaintOrder) => Promise<void> }) {
  const assets = useAssets();
  const { v, bind } = useFields({ assetId: assetId ? String(assetId) : "", title: "", description: "", kind: "corrective", priority: "normal", assignee: "", dueDate: "" });
  const a = useAction();
  return (
    <Modal title="New maintenance request" onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void a.run(async () => onMade(await api<MaintOrder>("/api/maintenance", { method: "POST", json: v }))); }}>
        {!assetId && (
          <Field label="Asset">
            <select {...bind("assetId")} required>
              <option value="">Pick an asset</option>
              {assets.map((x) => <option key={x.id} value={x.id}>{x.tag} · {x.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="What's wrong or what needs doing"><input {...bind("title")} autoFocus required /></Field>
        <Field label="Details"><textarea {...bind("description")} rows={3} /></Field>
        <div className="grid2">
          <Field label="Kind">
            <select {...bind("kind")}><option value="corrective">Repair</option><option value="inspection">Inspection</option><option value="preventive">Planned service</option></select>
          </Field>
          <Field label="Priority">
            <select {...bind("priority")}>{["low", "normal", "high", "urgent"].map((p) => <option key={p} value={p}>{label(p)}</option>)}</select>
          </Field>
          <Field label="Assign to (email)"><input type="email" {...bind("assignee")} /></Field>
          <Field label="Due"><input type="date" {...bind("dueDate")} /></Field>
        </div>
        <p className="error">{a.error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={a.busy || !v.assetId}>Open request</button>
        </div>
      </form>
    </Modal>
  );
}
