"use client";
import { Check, Gauge, Plus, RefreshCw, X } from "lucide-react";
import { useCallback, useState } from "react";
import type { Demand, MrpState } from "@/lib/mfg";
import { api, date, qty, stamp } from "./client";
import type { PaneProps } from "./OpsApp";
import { ItemSelect, useItems } from "./pickers";
import { Card, Empty, Filters, ListPane, Pill, useAction, useFields, useLoad } from "./ui";

type Filter = "suggested" | "all";

/**
 * MRP: what to build and buy, and when, to meet demand. Suggestions come from the last run;
 * firming one makes a planned work order or a purchase request.
 */
export function PlanningPane({ say, go }: PaneProps) {
  const [state, setState] = useState<MrpState | null>(null);
  const [demands, setDemands] = useState<Demand[]>([]);
  const [filter, setFilter] = useState<Filter>("suggested");
  const [itemsVersion, setItemsVersion] = useState(0);
  const items = useItems([itemsVersion]);
  const a = useAction();
  const { v, setV, bind } = useFields({ itemId: "", qty: "", dueDate: "", reference: "" });

  const load = useCallback(async () => {
    const [s, d] = await Promise.all([api<MrpState>("/api/mrp"), api<Demand[]>("/api/demands")]).catch((e) => (say(e.message), [null, []] as const));
    if (s) setState(s);
    setDemands([...d]);
  }, [say]);
  useLoad(load, []);

  const run = () =>
    a.run(async () => {
      const s = await api<MrpState>("/api/mrp", { method: "POST" });
      setState(s);
      setItemsVersion((n) => n + 1);
      say(s.orders.length ? `Planning suggests ${s.orders.length} orders` : "Nothing to order: stock and open orders cover demand");
    });
  const decide = (id: number, action: "firm" | "dismiss") =>
    a.run(async () => {
      const r = await api<{ ref?: string; kind?: string; id?: number }>(`/api/mrp/${id}`, { method: "POST", json: { action } });
      if (r.ref) say(`${r.ref} created`);
      await load();
    });
  const addDemand = (e: React.FormEvent) => {
    e.preventDefault();
    void a.run(async () => {
      setDemands(await api<Demand[]>("/api/demands", { method: "POST", json: v }));
      setV({ itemId: "", qty: "", dueDate: "", reference: "" });
    });
  };
  const closeDemand = (id: number) => a.run(async () => setDemands(await api<Demand[]>(`/api/demands/${id}`, { method: "DELETE" })));

  const orders = (state?.orders ?? []).filter((o) => filter === "all" || o.status === "suggested");
  const late = orders.filter((o) => o.late && o.status === "suggested").length;

  return (
    <div className="work">
      <ListPane
        title="Planning"
        actions={<button className="btn primary" disabled={a.busy} onClick={() => void run()}><RefreshCw size={16} /> Run planning</button>}
      >
        <div className="dbody">
          <p className="error">{a.error}</p>
          <Card
            title={state?.runAt ? `Suggestions from ${stamp(state.runAt)}${state.runBy ? ` by ${state.runBy}` : ""}` : "Suggestions"}
            actions={<Filters value={filter} onChange={setFilter} options={[["suggested", "To decide"], ["all", "Whole run"]]} />}
          >
            {late > 0 && <p className="banner">{late} of these should already have started, so they will finish late.</p>}
            {!state?.runAt ? (
              <Empty icon={<Gauge size={32} />}>
                <p>Planning looks at demand, open work orders, purchase requests and stock, then says what to build and buy and when to start.</p>
              </Empty>
            ) : orders.length ? (
              <table className="grid tight">
                <thead><tr><th>Item</th><th>Do</th><th className="num">Qty</th><th>Start by</th><th>Needed</th><th>Why</th><th /></tr></thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td><span className="mono">{o.sku}</span> {o.name}</td>
                      <td>{o.kind === "make" ? "Build" : "Buy"}</td>
                      <td className="num">{qty(o.qty)} {o.uom}</td>
                      <td>{date(o.startDate)} {o.late && <Pill s="late" text="Late" />}</td>
                      <td>{date(o.needDate)}</td>
                      <td className="small muted">{o.reason}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {o.status === "suggested" ? (
                          <>
                            <button className="btn small" disabled={a.busy} onClick={() => void decide(o.id, "firm")}><Check size={14} /> {o.kind === "make" ? "Plan work order" : "Request purchase"}</button>
                            <button className="iconbtn small" aria-label="Dismiss" title="Dismiss" disabled={a.busy} onClick={() => void decide(o.id, "dismiss")}><X size={14} /></button>
                          </>
                        ) : o.status === "firmed" ? (
                          <button className="linkbtn mono" onClick={() => go(o.kind === "make" ? "workorders" : "purchase")}>{o.firmedRef}</button>
                        ) : <Pill s={o.status} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="muted small">Nothing left to decide. Run planning again after demand or stock changes.</p>}
          </Card>
          <Card title="Demand">
            <p className="small muted">Forecasts and orders to plan for. Other apps can add these too (POST /api/svc/demand). Reorder points and the materials released work orders still need are planned on top.</p>
            <form className="inline" onSubmit={addDemand}>
              <label>Item <ItemSelect items={items} value={v.itemId} onChange={(x) => setV((o) => ({ ...o, itemId: x }))} /></label>
              <label>Qty <input className="n" {...bind("qty")} inputMode="decimal" /></label>
              <label>Due <input type="date" {...bind("dueDate")} /></label>
              <label>Reference <input {...bind("reference")} placeholder="Order or forecast" /></label>
              <button className="btn small" disabled={a.busy || !v.itemId}><Plus size={14} /> Add</button>
            </form>
            {demands.length ? (
              <table className="grid tight">
                <thead><tr><th>Item</th><th className="num">Qty</th><th>Due</th><th>Reference</th><th>From</th><th /></tr></thead>
                <tbody>
                  {demands.map((d) => (
                    <tr key={d.id}>
                      <td><span className="mono">{d.sku}</span> {d.name}</td>
                      <td className="num">{qty(d.qty)}</td>
                      <td>{date(d.dueDate)}</td>
                      <td>{d.reference}</td>
                      <td className="small muted">{d.source === "manual" ? d.createdBy : d.source}</td>
                      <td><button className="btn small ghost" disabled={a.busy} onClick={() => void closeDemand(d.id)}>Close</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="muted small">No open demand.</p>}
          </Card>
        </div>
      </ListPane>
    </div>
  );
}
