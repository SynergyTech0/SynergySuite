"use client";
import { Download, Plus, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Ctx } from "./FieldApp";
import { NewWorkOrder } from "./Jobs";
import { Confirm, Modal } from "./Modal";
import { type Asset, type Customer, type WorkOrder, STATUS_LABEL, api, shortDate } from "./client";

type Detail = Customer & { assets: Asset[] };
type OpsAsset = { tag: string; name: string; category: string; location: string; make: string; model: string; serial: string; status: string };

export function CustomersView({ ctx, initial }: { ctx: Ctx; initial: string | null }) {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [sel, setSel] = useState<string | null>(initial);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setRows(await api<Customer[]>(`/api/customers?q=${encodeURIComponent(search)}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [search]);
  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, ctx.version]);

  return (
    <div className="split">
      <div className="listcol">
        <div className="toolbar">
          <label className="searchbox grow"><Search size={15} /><input placeholder="Search customers" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
          <button className="btn small primary" onClick={() => setAdding(true)}><Plus size={14} /> New</button>
        </div>
        <p className="error" role="alert">{error}</p>
        {rows?.map((c) => (
          <button key={c.id} className={`listitem${sel === c.id ? " on" : ""}`} onClick={() => setSel(c.id)}>
            <b className="fname">{c.name}</b>
            <span className="small muted fname">{c.address || c.email}</span>
            <span className="small muted">{c.assetCount} assets{c.openJobs ? ` · ${c.openJobs} open jobs` : ""}</span>
          </button>
        ))}
        {rows && !rows.length && <p className="empty">No customers yet.</p>}
      </div>
      <div className="detailcol">
        {sel ? <CustomerDetail key={sel} id={sel} ctx={ctx} onGone={() => { setSel(null); void load(); }} onSaved={load} /> : <p className="empty">Pick a customer to see their equipment and jobs.</p>}
      </div>
      {adding && <CustomerDialog onClose={() => setAdding(false)} onSaved={(c) => { setSel(c.id); void load(); }} />}
    </div>
  );
}

function CustomerDialog({ customer, onClose, onSaved }: { customer?: Customer; onClose: () => void; onSaved: (c: Customer) => void }) {
  const [error, setError] = useState("");
  return (
    <Modal title={customer ? "Edit customer" : "New customer"} onClose={onClose} wide>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        try {
          const c = await api<Customer>(customer ? `/api/customers/${customer.id}` : "/api/customers", { method: customer ? "PUT" : "POST", json: Object.fromEntries(new FormData(e.currentTarget)) });
          onSaved(c);
          onClose();
        } catch (x) {
          setError((x as Error).message);
        }
      }}>
        <label><span>Name</span><input name="name" required autoFocus defaultValue={customer?.name} /></label>
        <div className="row2">
          <label><span>Email</span><input name="email" type="email" defaultValue={customer?.email} /></label>
          <label><span>Phone</span><input name="phone" defaultValue={customer?.phone} /></label>
        </div>
        <label><span>Address</span><textarea name="address" defaultValue={customer?.address} /></label>
        <label><span>Notes</span><textarea name="notes" defaultValue={customer?.notes} placeholder="Gate code, parking, opening hours" /></label>
        <p className="error" role="alert">{error}</p>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Save</button></div>
      </form>
    </Modal>
  );
}

function CustomerDetail({ id, ctx, onGone, onSaved }: { id: string; ctx: Ctx; onGone: () => void; onSaved: () => void }) {
  const [c, setC] = useState<Detail | null>(null);
  const [jobs, setJobs] = useState<WorkOrder[]>([]);
  const [dialog, setDialog] = useState<"edit" | "asset" | "ops" | "job" | "delete" | null>(null);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [jobAsset, setJobAsset] = useState<string | undefined>();
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [d, w] = await Promise.all([api<Detail>(`/api/customers/${id}`), api<WorkOrder[]>(`/api/work-orders?customer=${id}`)]);
      setC(d);
      setJobs(w);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load, ctx.version]);
  if (!c) return <p className="pad muted">{error || "Loading…"}</p>;
  return (
    <div className="body">
      <div className="toolbar">
        <h1 className="grow">{c.name}</h1>
        <button className="btn small" onClick={() => setDialog("edit")}>Edit</button>
        <button className="btn small primary" onClick={() => { setJobAsset(undefined); setDialog("job"); }}><Plus size={14} /> Work order</button>
        <button className="iconbtn" aria-label="Delete customer" onClick={() => setDialog("delete")}><Trash2 size={16} /></button>
      </div>
      <p className="muted prewrap">{[c.address, c.email, c.phone].filter(Boolean).join("\n")}</p>
      {c.notes && <p className="prewrap small">{c.notes}</p>}
      <p className="error" role="alert">{error}</p>
      <section>
        <div className="toolbar">
          <h2 className="grow">Equipment</h2>
          {ctx.status.links.ops && <button className="btn small" onClick={() => setDialog("ops")}><Download size={14} /> From Ops</button>}
          <button className="btn small" onClick={() => { setAsset(null); setDialog("asset"); }}><Plus size={14} /> Add</button>
        </div>
        {!c.assets.length ? <p className="small muted">No equipment recorded.</p> : (
          <div className="tablewrap">
            <table className="grid">
              <thead><tr><th>Name</th><th>Make and model</th><th>Serial</th><th>Where</th><th>Warranty</th><th /></tr></thead>
              <tbody>
                {c.assets.map((a) => (
                  <tr key={a.id} className="click" onClick={() => { setAsset(a); setDialog("asset"); }}>
                    <td><b>{a.name}</b>{a.opsTag && <div className="small muted">Ops {a.opsTag}</div>}</td>
                    <td>{[a.make, a.model].filter(Boolean).join(" ")}</td>
                    <td>{a.serial}</td>
                    <td>{a.location}</td>
                    <td>{a.warrantyUntil ? <span className={`pill ${a.underWarranty ? "active" : ""}`}>{a.underWarranty ? "to" : "ended"} {shortDate(a.warrantyUntil)}</span> : ""}</td>
                    <td><button className="btn small" onClick={(e) => { e.stopPropagation(); setJobAsset(a.id); setDialog("job"); }}>Work order</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section>
        <h2>Service history</h2>
        {!jobs.length ? <p className="small muted">No work orders yet.</p> : (
          <div className="tablewrap">
            <table className="grid">
              <thead><tr><th>Number</th><th>Job</th><th>Equipment</th><th>Status</th><th>Opened</th></tr></thead>
              <tbody>
                {jobs.map((w) => (
                  <tr key={w.id} className="click" onClick={() => ctx.openJob(w.id)}>
                    <td><b>{w.number}</b></td><td>{w.title}</td><td>{w.assetName}</td>
                    <td><span className={`pill ${w.status}`}>{STATUS_LABEL[w.status]}</span></td>
                    <td className="small">{shortDate(w.createdAt.slice(0, 10))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {dialog === "edit" && <CustomerDialog customer={c} onClose={() => setDialog(null)} onSaved={() => { void load(); onSaved(); }} />}
      {dialog === "asset" && <AssetDialog customerId={c.id} asset={asset} onClose={() => setDialog(null)} onSaved={load} />}
      {dialog === "ops" && <OpsImport customerId={c.id} onClose={() => setDialog(null)} onSaved={load} />}
      {dialog === "job" && <NewWorkOrder ctx={ctx} customer={c} assetId={jobAsset} onClose={() => setDialog(null)} />}
      {dialog === "delete" && (
        <Confirm title={`Delete ${c.name}?`} message="The customer and their equipment are removed. Customers with work orders stay on record." action="Delete" danger
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            try {
              await api(`/api/customers/${c.id}`, { method: "DELETE" });
              onGone();
            } catch (e) {
              setError((e as Error).message);
            }
          }} />
      )}
    </div>
  );
}

function AssetDialog({ customerId, asset, onClose, onSaved }: { customerId: string; asset: Asset | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [error, setError] = useState("");
  return (
    <Modal title={asset ? asset.name : "Add equipment"} onClose={onClose} wide>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        try {
          const json = { ...Object.fromEntries(new FormData(e.currentTarget)), customerId };
          await api(asset ? `/api/assets/${asset.id}` : "/api/assets", { method: asset ? "PUT" : "POST", json });
          await onSaved();
          onClose();
        } catch (x) {
          setError((x as Error).message);
        }
      }}>
        <label><span>Name</span><input name="name" required autoFocus defaultValue={asset?.name} placeholder="Walk-in freezer" /></label>
        <div className="row3">
          <label><span>Make</span><input name="make" defaultValue={asset?.make} /></label>
          <label><span>Model</span><input name="model" defaultValue={asset?.model} /></label>
          <label><span>Serial</span><input name="serial" defaultValue={asset?.serial} /></label>
        </div>
        <label><span>Where it is</span><input name="location" defaultValue={asset?.location} placeholder="Back kitchen, roof, plant room" /></label>
        <div className="row2">
          <label><span>Installed</span><input name="installedOn" type="date" defaultValue={asset?.installedOn ?? ""} /></label>
          <label><span>Warranty until</span><input name="warrantyUntil" type="date" defaultValue={asset?.warrantyUntil ?? ""} /></label>
        </div>
        <label><span>Notes</span><textarea name="notes" defaultValue={asset?.notes} /></label>
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          {asset && (
            <button type="button" className="btn ghost" onClick={async () => {
              try {
                await api(`/api/assets/${asset.id}`, { method: "DELETE" });
                await onSaved();
                onClose();
              } catch (x) {
                setError((x as Error).message);
              }
            }}><Trash2 size={14} /> Remove</button>
          )}
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}

function OpsImport({ customerId, onClose, onSaved }: { customerId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<OpsAsset[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const t = setTimeout(() => api<OpsAsset[]>(`/api/ops/assets?q=${encodeURIComponent(search)}`).then(setHits, (e) => setError((e as Error).message)), 250);
    return () => clearTimeout(t);
  }, [search]);
  return (
    <Modal title="Equipment from Ops" onClose={onClose} wide>
      <div className="form">
        <input autoFocus placeholder="Search Ops by tag, name, serial or location" value={search} onChange={(e) => setSearch(e.target.value)} />
        <p className="error" role="alert">{error}</p>
        <div className="hits tall">
          {hits.map((a) => (
            <button key={a.tag} type="button" onClick={async () => {
              try {
                await api(`/api/customers/${customerId}/import-asset`, { method: "POST", json: { tag: a.tag } });
                await onSaved();
                onClose();
              } catch (x) {
                setError((x as Error).message);
              }
            }}>
              <span className="grow"><b>{a.tag}</b> {a.name} <span className="small muted">{[a.make, a.model, a.serial].filter(Boolean).join(" ")}</span></span>
              <span className="small muted">{a.location}</span>
            </button>
          ))}
          {!hits.length && <p className="small muted">Nothing in Ops matches.</p>}
        </div>
      </div>
    </Modal>
  );
}
