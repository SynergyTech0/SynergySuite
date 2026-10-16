"use client";
import { Gauge, Plus, Send, Truck, Wrench } from "lucide-react";
import { useCallback, useState } from "react";
import type { Asset, MaintOrder, MaintPlan } from "@/lib/assets";
import { api, date, money, qty, stamp } from "./client";
import { NewOrderDialog } from "./MaintenancePane";
import { Modal } from "./Modal";
import type { PaneProps } from "./OpsApp";
import { PlanDialog } from "./PlansPane";
import { Card, DetailPane, Empty, Field, Filters, ListPane, Pill, useAction, useFields, useLoad } from "./ui";

type Filter = "in_service" | "mine" | "retired" | "all";

export function AssetsPane({ say, open, setOpen, go, booksLinked, refreshMe }: PaneProps) {
  const [rows, setRows] = useState<Asset[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("in_service");
  const [dialog, setDialog] = useState<React.ReactNode>(null);
  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (filter === "in_service" || filter === "retired") p.set("status", filter);
    if (filter === "mine") p.set("mine", "1");
    if (query) p.set("q", query);
    setRows(await api<Asset[]>(`/api/assets?${p}`).catch((e) => (say(e.message), [])));
  }, [filter, query, say]);
  useLoad(load, [filter, query], !!query);

  return (
    <div className={`work${open ? " withdetail" : ""}`}>
      <ListPane
        title="Assets"
        query={query}
        onQuery={setQuery}
        placeholder="Search tag, name, serial or location"
        filters={<Filters value={filter} onChange={setFilter} options={[["in_service", "In service"], ["mine", "Mine"], ["retired", "Retired"], ["all", "All"]]} />}
        actions={<button className="btn primary" onClick={() => setDialog(<AssetDialog onClose={() => setDialog(null)} onSaved={async (x) => { setDialog(null); await load(); await refreshMe(); setOpen(x.id); say(`${x.tag} added`); }} />)}><Plus size={16} /> New asset</button>}
      >
        {rows && !rows.length ? (
          <Empty icon={<Truck size={32} />}><p>Machines, vehicles, tools and equipment you look after. Give them maintenance plans and keep their repair history here.</p></Empty>
        ) : (
          <table className="grid">
            <thead><tr><th>Tag</th><th>Name</th><th>Category</th><th>Location</th><th>Status</th><th className="num">Meter</th><th className="num">Open work</th></tr></thead>
            <tbody>
              {(rows ?? []).map((x) => (
                <tr key={x.id} className={`click${open === x.id ? " sel" : ""}`} onClick={() => setOpen(x.id)}>
                  <td className="mono">{x.tag}</td>
                  <td>{x.name}</td>
                  <td>{x.category}</td>
                  <td>{x.location}</td>
                  <td><Pill s={x.status} /></td>
                  <td className="num">{x.meterValue !== null ? `${qty(x.meterValue)} ${x.meterUnit}` : ""}</td>
                  <td className="num">{x.openOrders || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ListPane>
      {open && <AssetDetail key={open} id={open} say={say} books={booksLinked} onClose={() => setOpen(null)} onChanged={async () => { await load(); await refreshMe(); }} go={go} />}
      {dialog}
    </div>
  );
}

type AssetData = {
  asset: Asset; plans: MaintPlan[]; orders: MaintOrder[]; readings: { value: number; by: string; at: string }[];
  depreciation: { monthly: number; accumulated: number; value: number } | null;
};

function AssetDetail({ id, say, books, onClose, onChanged, go }: { id: number; say: (t: string) => void; books: boolean; onClose: () => void; onChanged: () => Promise<void>; go: PaneProps["go"] }) {
  const [d, setD] = useState<AssetData | null>(null);
  const [dialog, setDialog] = useState<React.ReactNode>(null);
  const [reading, setReading] = useState("");
  const a = useAction();
  const load = useCallback(async () => setD(await api<AssetData>(`/api/assets/${id}`).catch((e) => (say(e.message), null))), [id, say]);
  useLoad(load, [id]);
  if (!d) return <aside className="detail" />;
  const { asset: x, plans, orders, readings, depreciation } = d;
  const changed = async () => {
    await load();
    await onChanged();
  };
  const setStatus = (status: string) => a.run(async () => { await api(`/api/assets/${id}`, { method: "PATCH", json: { status } }); await changed(); });
  const sendToBooks = () => a.run(async () => { await api(`/api/assets/${id}/books`, { method: "POST" }); await changed(); say(`${x.tag} is in Books' fixed assets`); });
  const addReading = (e: React.FormEvent) => {
    e.preventDefault();
    void a.run(async () => { await api(`/api/assets/${id}/readings`, { method: "POST", json: { value: reading } }); setReading(""); await changed(); });
  };

  return (
    <DetailPane
      title={<><span className="mono">{x.tag}</span> {x.name}</>}
      sub={<><Pill s={x.status} /> {[x.category, x.location].filter(Boolean).join(" · ")}{x.parentTag && ` · part of ${x.parentTag}`}</>}
      onClose={onClose}
      tools={
        <>
          <button className="btn small primary" onClick={() => setDialog(<NewOrderDialog assetId={x.id} onClose={() => setDialog(null)} onMade={async (o) => { setDialog(null); await changed(); say(`${o.number} opened`); }} />)}><Wrench size={14} /> Report a problem</button>
          <button className="btn small" onClick={() => setDialog(<AssetDialog asset={x} onClose={() => setDialog(null)} onSaved={async () => { setDialog(null); await changed(); }} />)}>Edit</button>
          {books && <button className="btn small" disabled={a.busy} onClick={() => void sendToBooks()} title="Books keeps the fixed-asset register and depreciation"><Send size={14} /> {x.booksAssetId ? "Update in Books" : "Send to Books"}</button>}
          {x.status !== "retired" && x.status !== "disposed" ? (
            <button className="btn small ghost" disabled={a.busy} onClick={() => confirm(`Retire ${x.tag}? Its plans stop making work.`) && void setStatus("retired")}>Retire</button>
          ) : (
            <button className="btn small ghost" disabled={a.busy} onClick={() => void setStatus("active")}>Back in service</button>
          )}
        </>
      }
    >
      <p className="error">{a.error}</p>
      {x.booksError && <p className="banner">Books: {x.booksError}</p>}
      <div className="stats">
        {x.meterUnit && <div className="stat"><b>{x.meterValue !== null ? qty(x.meterValue) : "-"}</b><span>{x.meterUnit}</span></div>}
        {depreciation && <div className="stat"><b>{money(depreciation.value)}</b><span>Book value (straight line)</span></div>}
        <div className="stat"><b>{x.openOrders}</b><span>Open maintenance</span></div>
      </div>
      <Card title="Details">
        <dl className="kv">
          {x.make && <><dt>Make</dt><dd>{x.make}</dd></>}
          {x.model && <><dt>Model</dt><dd>{x.model}</dd></>}
          {x.serial && <><dt>Serial</dt><dd className="mono">{x.serial}</dd></>}
          {x.assignee && <><dt>With</dt><dd>{x.assignee}</dd></>}
          {x.purchaseDate && <><dt>Bought</dt><dd>{date(x.purchaseDate)}{x.purchaseCost !== null && ` for ${money(x.purchaseCost)}`}</dd></>}
          {depreciation && <><dt>Depreciation</dt><dd>{money(depreciation.monthly)} a month, {money(depreciation.accumulated)} so far, over {x.usefulLifeMonths} months</dd></>}
          {x.booksAssetId && <><dt>Books</dt><dd>In the fixed-asset register</dd></>}
          {x.notes && <><dt>Notes</dt><dd style={{ whiteSpace: "pre-wrap" }}>{x.notes}</dd></>}
        </dl>
      </Card>
      {x.meterUnit && (
        <Card title="Meter">
          <form className="inline" onSubmit={addReading}>
            <label>New reading ({x.meterUnit}) <input className="n" value={reading} onChange={(e) => setReading(e.target.value)} inputMode="decimal" /></label>
            <button className="btn small" disabled={a.busy || !reading}><Gauge size={14} /> Record</button>
          </form>
          {readings.length > 0 && <p className="small muted" style={{ margin: 0 }}>Last read {stamp(readings[0].at)}{readings[0].by && ` by ${readings[0].by}`}</p>}
        </Card>
      )}
      <Card title="Preventive plans" actions={<button className="btn small" onClick={() => setDialog(<PlanDialog asset={x} onClose={() => setDialog(null)} onSaved={async () => { setDialog(null); await changed(); }} />)}><Plus size={14} /> Add plan</button>}>
        {plans.length ? (
          <table className="grid tight">
            <thead><tr><th>Plan</th><th>Every</th><th>Next</th><th /></tr></thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} className="click" onClick={() => setDialog(<PlanDialog asset={x} plan={p} onClose={() => setDialog(null)} onSaved={async () => { setDialog(null); await changed(); }} />)}>
                  <td>{p.title} {!p.active && <span className="muted small">(paused)</span>}</td>
                  <td className="small">{[p.intervalDays && `${p.intervalDays} days`, p.intervalMeter && `${qty(p.intervalMeter)} ${x.meterUnit}`].filter(Boolean).join(" or ")}</td>
                  <td className="small">{[p.nextDue && date(p.nextDue), p.nextMeter !== null && `${qty(p.nextMeter)} ${x.meterUnit}`].filter(Boolean).join(" or ")}</td>
                  <td>{p.due && <Pill s="late" text="Due" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted small">No plans. Add one to have maintenance opened on a schedule or by meter.</p>}
      </Card>
      <Card title="Maintenance history">
        {orders.length ? (
          <table className="grid tight">
            <thead><tr><th>Number</th><th>Work</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="click" onClick={() => go("maintenance", o.id)}>
                  <td className="mono">{o.number}</td>
                  <td>{o.title}</td>
                  <td><Pill s={o.status} /></td>
                  <td className="small">{date(o.completedAt ?? o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted small">No maintenance yet.</p>}
      </Card>
      {dialog}
    </DetailPane>
  );
}

function AssetDialog({ asset, onClose, onSaved }: { asset?: Asset; onClose: () => void; onSaved: (a: Asset) => Promise<void> }) {
  const s = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  const { v, bind } = useFields({
    tag: asset?.tag ?? "", name: asset?.name ?? "", category: asset?.category ?? "", location: asset?.location ?? "", make: asset?.make ?? "",
    model: asset?.model ?? "", serial: asset?.serial ?? "", assignee: asset?.assignee ?? "", purchaseDate: asset?.purchaseDate ?? "",
    purchaseCost: s(asset?.purchaseCost), salvageValue: s(asset?.salvageValue), usefulLifeMonths: s(asset?.usefulLifeMonths),
    meterUnit: asset?.meterUnit ?? "", meterValue: "", notes: asset?.notes ?? "",
  });
  const a = useAction();
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    void a.run(async () => {
      const { meterValue, ...rest } = v;
      const out = asset ? await api<Asset>(`/api/assets/${asset.id}`, { method: "PATCH", json: rest }) : await api<Asset>("/api/assets", { method: "POST", json: { ...v, meterValue } });
      await onSaved(out);
    });
  };
  return (
    <Modal title={asset ? `Edit ${asset.tag}` : "New asset"} onClose={onClose} wide>
      <form className="form" onSubmit={save}>
        <div className="grid2">
          <Field label="Name"><input {...bind("name")} autoFocus required /></Field>
          <Field label="Asset tag"><input {...bind("tag")} placeholder={asset ? undefined : "Leave blank to number it"} required={!!asset} /></Field>
          <Field label="Category"><input {...bind("category")} placeholder="Machinery, vehicle, IT" /></Field>
          <Field label="Location"><input {...bind("location")} /></Field>
          <Field label="Make"><input {...bind("make")} /></Field>
          <Field label="Model"><input {...bind("model")} /></Field>
          <Field label="Serial number"><input {...bind("serial")} /></Field>
          <Field label="With (email)"><input type="email" {...bind("assignee")} /></Field>
          <Field label="Purchase date"><input type="date" {...bind("purchaseDate")} /></Field>
          <Field label="Purchase cost"><input {...bind("purchaseCost")} inputMode="decimal" /></Field>
          <Field label="Salvage value"><input {...bind("salvageValue")} inputMode="decimal" /></Field>
          <Field label="Useful life (months)"><input {...bind("usefulLifeMonths")} inputMode="numeric" /></Field>
          <Field label="Meter unit"><input {...bind("meterUnit")} placeholder="hours, miles, cycles" /></Field>
          {!asset && <Field label="Meter reading now"><input {...bind("meterValue")} inputMode="decimal" /></Field>}
          <Field label="Notes" wide><textarea {...bind("notes")} rows={2} /></Field>
        </div>
        <p className="error">{a.error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={a.busy}>{asset ? "Save" : "Add asset"}</button>
        </div>
      </form>
    </Modal>
  );
}
