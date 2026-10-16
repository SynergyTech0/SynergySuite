"use client";
import { Boxes, Download, Plus } from "lucide-react";
import { useCallback, useState } from "react";
import type { BomSummary, Costing } from "@/lib/mfg";
import type { Item, Move } from "@/lib/stock";
import { api, date, label, money, qty, stamp } from "./client";
import { Modal } from "./Modal";
import type { PaneProps } from "./OpsApp";
import { Card, DetailPane, Empty, Field, Filters, ListPane, Pill, useAction, useFields, useLoad } from "./ui";

type Filter = "all" | "make" | "buy" | "low";

export function ItemsPane({ say, open, setOpen, go, stock, refreshMe }: PaneProps) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [dialog, setDialog] = useState<React.ReactNode>(null);

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (query) p.set("q", query);
    if (filter === "make" || filter === "buy") p.set("source", filter);
    if (filter === "low") p.set("low", "1");
    setItems(await api<Item[]>(`/api/items?${p}`).catch((e) => (say(e.message), [])));
  }, [query, filter, say]);
  useLoad(load, [query, filter], !!query);

  const importCommerce = async () => {
    try {
      const r = await api<{ added: number; linked: number }>("/api/items/import", { method: "POST" });
      say(`Brought over ${r.added} products from Commerce, linked ${r.linked}`);
      await load();
    } catch (e) {
      say((e as Error).message);
    }
  };

  return (
    <div className={`work${open ? " withdetail" : ""}`}>
      <ListPane
        title="Items and stock"
        query={query}
        onQuery={setQuery}
        placeholder="Search SKU or name"
        filters={<Filters value={filter} onChange={setFilter} options={[["all", "All"], ["make", "Made"], ["buy", "Bought"], ["low", "Below reorder point"]]} />}
        actions={
          <>
            {stock.linked && <button className="btn" onClick={importCommerce}><Download size={16} /> From Commerce</button>}
            <button className="btn primary" onClick={() => setDialog(<ItemDialog localStock={!stock.linked} onClose={() => setDialog(null)} onSaved={async (i) => { setDialog(null); await load(); setOpen(i.id); say(`${i.sku} added`); }} />)}>
              <Plus size={16} /> New item
            </button>
          </>
        }
      >
        {items && !items.length ? (
          <Empty icon={<Boxes size={32} />}>
            <p>Items are the parts you buy and the products you make. Add them here, or bring them over from Commerce.</p>
          </Empty>
        ) : (
          <table className="grid">
            <thead>
              <tr><th>SKU</th><th>Name</th><th>Type</th><th className="num">On hand</th><th className="num">Reorder at</th><th className="num">Unit cost</th></tr>
            </thead>
            <tbody>
              {(items ?? []).map((i) => (
                <tr key={i.id} className={`click${open === i.id ? " sel" : ""}`} onClick={() => setOpen(i.id)}>
                  <td className="mono">{i.sku}</td>
                  <td>{i.name}</td>
                  <td>{i.source === "make" ? <span className="tag">Made{i.hasBom ? "" : ", no bill yet"}</span> : "Bought"}</td>
                  <td className={`num${i.reorderPoint > 0 && i.onHand < i.reorderPoint ? " neg" : ""}`}>{qty(i.onHand)} {i.uom}</td>
                  <td className="num">{i.reorderPoint ? qty(i.reorderPoint) : ""}</td>
                  <td className="num">{money(i.unitCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ListPane>
      {open && <ItemDetail key={open} id={open} onClose={() => setOpen(null)} onChanged={async () => { await load(); await refreshMe(); }} say={say} go={go} localStock={!stock.linked} />}
      {dialog}
    </div>
  );
}

type ItemData = { item: Item; moves: Move[]; boms: BomSummary[]; cost: Costing };

function ItemDetail({ id, onClose, onChanged, say, go, localStock }: { id: number; onClose: () => void; onChanged: () => Promise<void>; say: (t: string) => void; go: PaneProps["go"]; localStock: boolean }) {
  const [d, setD] = useState<ItemData | null>(null);
  const [dialog, setDialog] = useState<React.ReactNode>(null);
  const load = useCallback(async () => setD(await api<ItemData>(`/api/items/${id}`).catch((e) => (say(e.message), null))), [id, say]);
  useLoad(load, [id]);
  if (!d) return <aside className="detail" />;
  const { item, moves, boms, cost } = d;

  const remove = async () => {
    if (!confirm(`Remove ${item.sku}?`)) return;
    const r = await api<{ deleted: boolean }>(`/api/items/${id}`, { method: "DELETE" }).catch((e) => (say(e.message), null));
    if (!r) return;
    say(r.deleted ? `${item.sku} deleted` : `${item.sku} is used elsewhere, so it was made inactive`);
    await onChanged();
    onClose();
  };

  return (
    <DetailPane
      title={<><span className="mono">{item.sku}</span> {item.name}</>}
      sub={<>{item.source === "make" ? "Made here" : "Bought in"}{!item.active && " · inactive"}{item.commerceId && " · stock in Commerce"}</>}
      onClose={onClose}
      tools={
        <>
          {localStock && <button className="btn small primary" onClick={() => setDialog(<StockDialog item={item} onClose={() => setDialog(null)} onSaved={async () => { setDialog(null); await load(); await onChanged(); }} />)}>Change stock</button>}
          <button className="btn small" onClick={() => setDialog(<ItemDialog item={item} onClose={() => setDialog(null)} onSaved={async () => { setDialog(null); await load(); await onChanged(); }} />)}>Edit</button>
          {item.source === "make" && <button className="btn small" onClick={() => go("boms", boms[0]?.id ?? null)}>{boms.length ? "Bills of materials" : "Add a bill"}</button>}
          <button className="btn small ghost" onClick={remove}>Remove</button>
        </>
      }
    >
      <div className="stats">
        <div className="stat"><b>{qty(item.onHand)}</b><span>On hand ({item.uom})</span></div>
        <div className="stat"><b>{money(item.unitCost)}</b><span>Average cost</span></div>
        {item.source === "make" && cost && <div className="stat"><b>{money(cost.total)}</b><span>Standard cost from the bill</span></div>}
      </div>
      <Card title="Planning">
        <dl className="kv">
          <dt>Safety stock</dt><dd>{qty(item.safetyStock)}</dd>
          <dt>Reorder point</dt><dd>{qty(item.reorderPoint)}</dd>
          <dt>Lot size</dt><dd>{item.lotSize ? qty(item.lotSize) : "Exactly what is short"}</dd>
          <dt>Lead time</dt><dd>{item.leadDays} days</dd>
          {item.description && <><dt>Description</dt><dd>{item.description}</dd></>}
        </dl>
      </Card>
      {item.source === "make" && cost.components.length > 0 && (
        <Card title={`Cost roll-up: material ${money(cost.material)}, labor ${money(cost.labor)}`}>
          <table className="grid tight">
            <thead><tr><th>Component</th><th className="num">Level</th><th className="num">Per unit</th><th className="num">On hand</th></tr></thead>
            <tbody>
              {cost.components.map((c) => (
                <tr key={c.itemId}><td><span className="mono">{c.sku}</span> {c.name}</td><td className="num">{c.level}</td><td className="num">{qty(c.qty)} {c.uom}</td><td className="num">{qty(c.onHand)}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Card title="Stock history">
        {moves.length ? (
          <table className="grid tight">
            <thead><tr><th>When</th><th>What</th><th className="num">Qty</th><th className="num">Cost</th></tr></thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m.id} title={m.syncError || undefined}>
                  <td className="small">{stamp(m.createdAt)}</td>
                  <td className="small">{label(m.kind)} {m.ref && <span className="mono">{m.ref}</span>} {m.note && <span className="muted">{m.note}</span>} {m.syncStatus === "failed" && <Pill s="late" text="Commerce refused" />}</td>
                  <td className={`num${m.qty < 0 ? " neg" : ""}`}>{m.qty > 0 ? "+" : ""}{qty(m.qty)}</td>
                  <td className="num">{money(m.unitCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted small">Nothing has moved yet.</p>}
      </Card>
      <p className="muted small">Last changed {date(item.updatedAt)}</p>
      {dialog}
    </DetailPane>
  );
}

export function ItemDialog({ item, onClose, onSaved, defaults, localStock = true }: { item?: Item; onClose: () => void; onSaved: (i: Item) => Promise<void>; defaults?: Partial<Record<string, string>>; localStock?: boolean }) {
  const s = (n: number | undefined) => (n === undefined ? "" : String(n));
  const { v, bind } = useFields({
    sku: item?.sku ?? defaults?.sku ?? "", name: item?.name ?? "", description: item?.description ?? "", uom: item?.uom ?? "ea",
    source: item?.source ?? defaults?.source ?? "buy", unitCost: s(item?.unitCost), onHand: "", safetyStock: s(item?.safetyStock),
    reorderPoint: s(item?.reorderPoint), lotSize: s(item?.lotSize), leadDays: s(item?.leadDays),
  });
  const a = useAction();
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    void a.run(async () => {
      const { onHand, ...rest } = v;
      const out = item ? await api<Item>(`/api/items/${item.id}`, { method: "PATCH", json: rest }) : await api<Item>("/api/items", { method: "POST", json: v });
      await onSaved(out);
    });
  };
  return (
    <Modal title={item ? `Edit ${item.sku}` : "New item"} onClose={onClose} wide>
      <form className="form" onSubmit={save}>
        <div className="grid2">
          <Field label="SKU"><input {...bind("sku")} autoFocus required /></Field>
          <Field label="Name"><input {...bind("name")} required /></Field>
          <Field label="Made or bought">
            <select {...bind("source")}><option value="buy">Bought in</option><option value="make">Made here</option></select>
          </Field>
          <Field label="Unit of measure"><input {...bind("uom")} placeholder="ea, kg, m" /></Field>
          <Field label="Unit cost"><input {...bind("unitCost")} inputMode="decimal" /></Field>
          {!item && localStock && <Field label="Opening stock"><input {...bind("onHand")} inputMode="decimal" /></Field>}
          <Field label="Safety stock"><input {...bind("safetyStock")} inputMode="decimal" /></Field>
          <Field label="Reorder point"><input {...bind("reorderPoint")} inputMode="decimal" /></Field>
          <Field label="Lot size (smallest order)"><input {...bind("lotSize")} inputMode="decimal" /></Field>
          <Field label="Lead time (days)"><input {...bind("leadDays")} inputMode="numeric" /></Field>
          <Field label="Description" wide><textarea {...bind("description")} rows={2} /></Field>
        </div>
        <p className="error">{a.error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={a.busy}>{item ? "Save" : "Add item"}</button>
        </div>
      </form>
    </Modal>
  );
}

function StockDialog({ item, onClose, onSaved }: { item: Item; onClose: () => void; onSaved: () => Promise<void> }) {
  const { v, bind } = useFields({ kind: "receipt", qty: "", unitCost: String(item.unitCost), ref: "", note: "" });
  const a = useAction();
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    void a.run(async () => {
      await api(`/api/items/${item.id}/stock`, { method: "POST", json: { ...v, unitCost: v.kind === "receipt" ? v.unitCost : undefined } });
      await onSaved();
    });
  };
  return (
    <Modal title={`Change stock of ${item.sku}`} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <Field label="What happened">
          <select {...bind("kind")}><option value="receipt">Received stock</option><option value="adjust">Count correction (+ or -)</option></select>
        </Field>
        <div className="grid2">
          <Field label={v.kind === "receipt" ? "Quantity received" : "Change, e.g. -3"}><input {...bind("qty")} inputMode="decimal" autoFocus required /></Field>
          {v.kind === "receipt" && <Field label="Unit cost paid"><input {...bind("unitCost")} inputMode="decimal" /></Field>}
          <Field label="Reference"><input {...bind("ref")} placeholder="PO or packing slip" /></Field>
          <Field label="Note"><input {...bind("note")} /></Field>
        </div>
        <p className="muted small">Now {qty(item.onHand)} {item.uom} on hand.</p>
        <p className="error">{a.error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={a.busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}
