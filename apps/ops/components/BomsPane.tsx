"use client";
import { Copy, Layers, Plus, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import type { Bom, BomSummary, Costing } from "@/lib/mfg";
import { api, date, money, qty } from "./client";
import { Modal } from "./Modal";
import type { PaneProps } from "./OpsApp";
import { ItemSelect, useItems, useWorkCenters } from "./pickers";
import { Card, DetailPane, Empty, Field, ListPane, Pill, useAction, useLoad } from "./ui";

export function BomsPane({ say, open, setOpen, go }: PaneProps) {
  const [boms, setBoms] = useState<BomSummary[] | null>(null);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<React.ReactNode>(null);
  const load = useCallback(async () => {
    setBoms(await api<BomSummary[]>(`/api/boms${query ? `?q=${encodeURIComponent(query)}` : ""}`).catch((e) => (say(e.message), [])));
  }, [query, say]);
  useLoad(load, [query], !!query);

  return (
    <div className={`work${open ? " withdetail" : ""}`}>
      <ListPane
        title="Bills of materials"
        query={query}
        onQuery={setQuery}
        placeholder="Search by item"
        actions={<button className="btn primary" onClick={() => setDialog(<NewBomDialog onClose={() => setDialog(null)} onMade={async (b) => { setDialog(null); await load(); setOpen(b.id); }} />)}><Plus size={16} /> New bill</button>}
      >
        {boms && !boms.length ? (
          <Empty icon={<Layers size={32} />}>
            <p>A bill of materials lists the parts that go into a product and the steps to build it. Work orders and planning use the active one.</p>
          </Empty>
        ) : (
          <table className="grid">
            <thead><tr><th>Item</th><th>Version</th><th>Status</th><th className="num">Makes</th><th className="num">Components</th><th>Changed</th></tr></thead>
            <tbody>
              {(boms ?? []).map((b) => (
                <tr key={b.id} className={`click${open === b.id ? " sel" : ""}`} onClick={() => setOpen(b.id)}>
                  <td><span className="mono">{b.sku}</span> {b.name}</td>
                  <td>v{b.version}</td>
                  <td><Pill s={b.status} /></td>
                  <td className="num">{qty(b.outputQty)}</td>
                  <td className="num">{b.lineCount}</td>
                  <td className="small muted">{date(b.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ListPane>
      {open && <BomDetail key={open} id={open} say={say} onClose={() => setOpen(null)} onChanged={load} onOpen={setOpen} go={go} />}
      {dialog}
    </div>
  );
}

function NewBomDialog({ onClose, onMade }: { onClose: () => void; onMade: (b: Bom) => Promise<void> }) {
  const items = useItems();
  const [itemId, setItemId] = useState("");
  const a = useAction();
  return (
    <Modal title="New bill of materials" onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void a.run(async () => onMade(await api<Bom>("/api/boms", { method: "POST", json: { itemId, lines: [], operations: [] } }))); }}>
        <Field label="Item it makes"><ItemSelect items={items} value={itemId} onChange={setItemId} /></Field>
        <p className="muted small">It starts as a draft. Add components and steps, then make it active.</p>
        <p className="error">{a.error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={a.busy || !itemId}>Create draft</button>
        </div>
      </form>
    </Modal>
  );
}

type Line = { componentId: string; qty: string; scrapPct: string };
type Op = { seq: string; name: string; workCenterId: string; setupMinutes: string; runMinutes: string };

function BomDetail({ id, say, onClose, onChanged, onOpen, go }: { id: number; say: (t: string) => void; onClose: () => void; onChanged: () => Promise<void>; onOpen: (id: number) => void; go: PaneProps["go"] }) {
  const [d, setD] = useState<{ bom: Bom; cost: Costing | null } | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [ops, setOps] = useState<Op[]>([]);
  const [output, setOutput] = useState("1");
  const [notes, setNotes] = useState("");
  const [dirty, setDirty] = useState(false);
  const items = useItems();
  const wcs = useWorkCenters();
  const a = useAction();

  const load = useCallback(async () => {
    const r = await api<{ bom: Bom; cost: Costing | null }>(`/api/boms/${id}`).catch((e) => (say(e.message), null));
    if (!r) return;
    setD(r);
    setLines(r.bom.lines.map((l) => ({ componentId: String(l.componentId), qty: String(l.qty), scrapPct: String(l.scrapPct) })));
    setOps(r.bom.operations.map((o) => ({ seq: String(o.seq), name: o.name, workCenterId: String(o.workCenterId), setupMinutes: String(o.setupMinutes), runMinutes: String(o.runMinutes) })));
    setOutput(String(r.bom.outputQty));
    setNotes(r.bom.notes);
    setDirty(false);
  }, [id, say]);
  useLoad(load, [id]);
  if (!d) return <aside className="detail" />;
  const { bom, cost } = d;
  const draft = bom.status === "draft";
  const edit = <T,>(set: React.Dispatch<React.SetStateAction<T[]>>, i: number, k: keyof T, val: string) => {
    set((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: val } : r)));
    setDirty(true);
  };

  const save = () =>
    a.run(async () => {
      await api(`/api/boms/${id}`, { method: "PUT", json: { outputQty: output, notes, lines, operations: ops } });
      await load();
      await onChanged();
      say("Bill saved");
    });
  const status = (s: string) =>
    a.run(async () => {
      if (dirty) await api(`/api/boms/${id}`, { method: "PUT", json: { outputQty: output, notes, lines, operations: ops } });
      await api(`/api/boms/${id}`, { method: "PATCH", json: { status: s } });
      await load();
      await onChanged();
      say(s === "active" ? `v${bom.version} is now the active bill for ${bom.sku}` : `v${bom.version} marked ${s}`);
    });
  const copy = () =>
    a.run(async () => {
      const b = await api<Bom>(`/api/boms/${id}/copy`, { method: "POST" });
      await onChanged();
      onOpen(b.id);
    });
  const remove = () =>
    a.run(async () => {
      if (!confirm("Delete this draft?")) return;
      await api(`/api/boms/${id}`, { method: "DELETE" });
      await onChanged();
      onClose();
    });

  return (
    <DetailPane
      title={<><span className="mono">{bom.sku}</span> v{bom.version}</>}
      sub={<><Pill s={bom.status} /> {bom.name}{bom.createdBy && ` · by ${bom.createdBy}`}</>}
      onClose={onClose}
      tools={
        <>
          {draft && <button className="btn small primary" disabled={a.busy || !dirty} onClick={() => void save()}>Save draft</button>}
          {draft && <button className="btn small" disabled={a.busy} onClick={() => void status("active")}>Make active</button>}
          {bom.status === "active" && <button className="btn small" onClick={() => go("workorders")}>Work orders</button>}
          {bom.status === "active" && <button className="btn small" disabled={a.busy} onClick={() => void status("obsolete")}>Retire</button>}
          <button className="btn small" disabled={a.busy} onClick={() => void copy()}><Copy size={14} /> New version</button>
          {draft && <button className="btn small ghost" disabled={a.busy} onClick={() => void remove()}>Delete</button>}
        </>
      }
    >
      <p className="error">{a.error}</p>
      {!draft && <p className="banner">Only drafts can change. Make a new version to edit this bill.</p>}
      <div className="inline">
        <label>One batch makes <input className="n" value={output} disabled={!draft} onChange={(e) => { setOutput(e.target.value); setDirty(true); }} inputMode="decimal" /></label>
        {cost && <span className="small">Standard cost per unit <b>{money(cost.total)}</b> (material {money(cost.material)}, labor {money(cost.labor)})</span>}
      </div>
      <Card
        title="Components"
        actions={draft && <button className="btn small" onClick={() => { setLines((l) => [...l, { componentId: "", qty: "1", scrapPct: "0" }]); setDirty(true); }}><Plus size={14} /> Add</button>}
      >
        {lines.length ? (
          <table className="grid tight">
            <thead><tr><th>Part</th><th className="num">Qty per batch</th><th className="num">Scrap %</th>{draft && <th />}</tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>{draft ? <ItemSelect items={items} value={l.componentId} onChange={(v) => edit(setLines, i, "componentId", v)} filter={(it) => it.id !== bom.itemId} placeholder="Pick a part" /> : <><span className="mono">{bom.lines[i]?.sku}</span> {bom.lines[i]?.name}</>}</td>
                  <td className="num">{draft ? <input className="n" value={l.qty} onChange={(e) => edit(setLines, i, "qty", e.target.value)} inputMode="decimal" /> : `${qty(Number(l.qty))} ${bom.lines[i]?.uom ?? ""}`}</td>
                  <td className="num">{draft ? <input className="n" value={l.scrapPct} onChange={(e) => edit(setLines, i, "scrapPct", e.target.value)} inputMode="decimal" /> : qty(Number(l.scrapPct))}</td>
                  {draft && <td><button className="iconbtn small" aria-label="Remove" onClick={() => { setLines((r) => r.filter((_, j) => j !== i)); setDirty(true); }}><Trash2 size={14} /></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted small">No components yet.</p>}
      </Card>
      <Card
        title="Routing"
        actions={draft && <button className="btn small" disabled={!wcs.length} title={wcs.length ? undefined : "Add a work center first"} onClick={() => { setOps((o) => [...o, { seq: String((o.length + 1) * 10), name: "", workCenterId: String(wcs[0]?.id ?? ""), setupMinutes: "0", runMinutes: "0" }]); setDirty(true); }}><Plus size={14} /> Add step</button>}
      >
        {ops.length ? (
          <table className="grid tight">
            <thead><tr><th>#</th><th>Step</th><th>Work center</th><th className="num">Setup min</th><th className="num">Run min / unit</th>{draft && <th />}</tr></thead>
            <tbody>
              {ops.map((o, i) => (
                <tr key={i}>
                  <td>{draft ? <input className="n" style={{ maxWidth: 52 }} value={o.seq} onChange={(e) => edit(setOps, i, "seq", e.target.value)} /> : o.seq}</td>
                  <td>{draft ? <input value={o.name} onChange={(e) => edit(setOps, i, "name", e.target.value)} placeholder="Cut, weld, assemble" /> : o.name}</td>
                  <td>{draft ? (
                    <select value={o.workCenterId} onChange={(e) => edit(setOps, i, "workCenterId", e.target.value)}>
                      {wcs.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
                    </select>
                  ) : bom.operations[i]?.workCenter}</td>
                  <td className="num">{draft ? <input className="n" value={o.setupMinutes} onChange={(e) => edit(setOps, i, "setupMinutes", e.target.value)} inputMode="decimal" /> : qty(Number(o.setupMinutes))}</td>
                  <td className="num">{draft ? <input className="n" value={o.runMinutes} onChange={(e) => edit(setOps, i, "runMinutes", e.target.value)} inputMode="decimal" /> : qty(Number(o.runMinutes))}</td>
                  {draft && <td><button className="iconbtn small" aria-label="Remove" onClick={() => { setOps((r) => r.filter((_, j) => j !== i)); setDirty(true); }}><Trash2 size={14} /></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted small">{wcs.length ? "No steps yet. Labor is costed from the steps." : "Add a work center to describe the steps."}</p>}
      </Card>
      <Card title="Notes">
        <textarea value={notes} disabled={!draft} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} rows={3} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 8 }} />
      </Card>
      {cost && cost.components.length > 0 && (
        <Card title={`Everything for one batch (${qty(bom.outputQty)})`}>
          <table className="grid tight">
            <thead><tr><th>Part</th><th className="num">Level</th><th className="num">Needed</th><th className="num">On hand</th><th className="num">Short</th></tr></thead>
            <tbody>
              {cost.components.map((c) => (
                <tr key={c.itemId}><td><span className="mono">{c.sku}</span> {c.name}</td><td className="num">{c.level}</td><td className="num">{qty(c.qty)}</td><td className="num">{qty(c.onHand)}</td><td className={`num${c.short ? " neg" : ""}`}>{c.short ? qty(c.short) : ""}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </DetailPane>
  );
}
