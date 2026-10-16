"use client";
import { Plus, ShoppingCart } from "lucide-react";
import { useCallback, useState } from "react";
import type { PurchaseRequest } from "@/lib/mfg";
import { api, date, money, qty } from "./client";
import { Modal } from "./Modal";
import type { PaneProps } from "./OpsApp";
import { ItemSelect, useItems } from "./pickers";
import { Empty, Field, Filters, ListPane, Pill, useAction, useFields, useLoad } from "./ui";

type Filter = "open" | "received" | "cancelled" | "all";

/** What planning (or a person) says to buy. Purchasing places the order; receiving puts it in stock. */
export function PurchasePane({ say, stock }: PaneProps) {
  const [rows, setRows] = useState<PurchaseRequest[] | null>(null);
  const [filter, setFilter] = useState<Filter>("open");
  const [dialog, setDialog] = useState<React.ReactNode>(null);
  const a = useAction();
  const load = useCallback(async () => {
    setRows(await api<PurchaseRequest[]>(`/api/purchase-requests${filter === "all" ? "" : `?status=${filter}`}`).catch((e) => (say(e.message), [])));
  }, [filter, say]);
  useLoad(load, [filter]);

  const act = (p: PurchaseRequest, json: Record<string, unknown>, done: string) =>
    a.run(async () => {
      await api(`/api/purchase-requests/${p.id}`, { method: "POST", json });
      await load();
      say(done);
    });

  return (
    <div className="work">
      <ListPane
        title="Purchase requests"
        filters={<Filters value={filter} onChange={setFilter} options={[["open", "Open"], ["received", "Received"], ["cancelled", "Cancelled"], ["all", "All"]]} />}
        actions={<button className="btn primary" onClick={() => setDialog(<NewPrDialog onClose={() => setDialog(null)} onMade={async () => { setDialog(null); await load(); }} />)}><Plus size={16} /> New request</button>}
      >
        <p className="error" style={{ padding: "0 20px" }}>{a.error}</p>
        {rows && !rows.length ? (
          <Empty icon={<ShoppingCart size={32} />}><p>Requests to buy parts. Planning creates them when you accept a buy suggestion.</p></Empty>
        ) : (
          <table className="grid">
            <thead><tr><th>Number</th><th>Item</th><th className="num">Qty</th><th>Need by</th><th>Status</th><th>Vendor</th><th>Reference</th><th /></tr></thead>
            <tbody>
              {(rows ?? []).map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.number}</td>
                  <td><span className="mono">{p.sku}</span> {p.name}</td>
                  <td className="num">{qty(p.qty)} {p.uom}</td>
                  <td>{date(p.needDate)}</td>
                  <td><Pill s={p.status} /></td>
                  <td>{p.vendor}</td>
                  <td className="small muted">{p.reference}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {p.status === "open" && (
                      <button className="btn small" disabled={a.busy} onClick={() => {
                        const vendor = prompt("Ordered from which vendor?", p.vendor);
                        if (vendor !== null) void act(p, { action: "ordered", vendor }, `${p.number} marked ordered`);
                      }}>Ordered</button>
                    )}
                    {(p.status === "open" || p.status === "ordered") && (
                      <>
                        {stock.linked ? (
                          <button className="btn small" disabled={a.busy} title="Receive the goods in Commerce; this only closes the request" onClick={() => void act(p, { action: "receive" }, `${p.number} closed; receive the goods in Commerce`)}>Mark received</button>
                        ) : <button className="btn small" disabled={a.busy} onClick={() => setDialog(<ReceiveDialog p={p} onClose={() => setDialog(null)} onDone={async (json) => { setDialog(null); await act(p, { action: "receive", ...json }, `${p.number} received into stock`); }} />)}>Receive</button>}
                        <button className="btn small ghost" disabled={a.busy} onClick={() => confirm(`Cancel ${p.number}?`) && void act(p, { action: "cancel" }, `${p.number} cancelled`)}>Cancel</button>
                      </>
                    )}
                  </td>
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

function NewPrDialog({ onClose, onMade }: { onClose: () => void; onMade: () => Promise<void> }) {
  const items = useItems();
  const { v, setV, bind } = useFields({ itemId: "", qty: "", needDate: "", vendor: "", reference: "" });
  const a = useAction();
  return (
    <Modal title="New purchase request" onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await api("/api/purchase-requests", { method: "POST", json: v }); await onMade(); }); }}>
        <Field label="Item"><ItemSelect items={items} value={v.itemId} onChange={(x) => setV((o) => ({ ...o, itemId: x }))} /></Field>
        <div className="grid2">
          <Field label="Quantity"><input {...bind("qty")} inputMode="decimal" required /></Field>
          <Field label="Need by"><input type="date" {...bind("needDate")} /></Field>
          <Field label="Vendor"><input {...bind("vendor")} /></Field>
          <Field label="Reference"><input {...bind("reference")} /></Field>
        </div>
        <p className="error">{a.error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={a.busy || !v.itemId}>Add request</button>
        </div>
      </form>
    </Modal>
  );
}

function ReceiveDialog({ p, onClose, onDone }: { p: PurchaseRequest; onClose: () => void; onDone: (json: Record<string, string>) => Promise<void> }) {
  const { v, bind } = useFields({ qty: String(p.qty), unitCost: String(p.unitCost) });
  return (
    <Modal title={`Receive ${p.number}`} onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void onDone(v); }}>
        <div className="grid2">
          <Field label={`Quantity (${p.uom})`}><input {...bind("qty")} inputMode="decimal" autoFocus /></Field>
          <Field label="Unit cost paid"><input {...bind("unitCost")} inputMode="decimal" /></Field>
        </div>
        <p className="small muted">The current average cost of {p.sku} is {money(p.unitCost)}.</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Receive into stock</button>
        </div>
      </form>
    </Modal>
  );
}
