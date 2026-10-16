"use client";
import { ArrowLeft, PackageCheck, Plus, Printer, Send, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { PoSummary } from "@/lib/purchasing";
import type { Suggestion } from "@/lib/stock";
import type { PurchaseOrder, Vendor } from "@/lib/types";
import { api, formData, formatDate, formatDateTime, money, qty, useData } from "./client";
import { Confirm, Modal } from "./Modal";
import { Badge, ErrorLine, LocationSelect, ProductPicker, type AppCtx } from "./shared";

export function Purchasing({ app, id }: { app: AppCtx; id: string | null }) {
  const [status, setStatus] = useState("open");
  const [creating, setCreating] = useState(false);
  const list = useData<PoSummary[]>(`/api/purchase-orders?status=${status === "all" ? "" : status}`, [app.version]);
  return (
    <div className={`split${id ? " withdetail" : ""}`}>
      <section className="listpane">
        <div className="listhead">
          <div className="titlerow">
            <h1 className="grow">Purchase orders</h1>
            {app.manager && <button className="btn primary small" onClick={() => setCreating(true)}><Plus size={15} /> New</button>}
          </div>
          <div className="filters">
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Show">
              <option value="open">Open</option>
              <option value="draft">Drafts</option>
              <option value="ordered">Ordered</option>
              <option value="partial">Partly received</option>
              <option value="received">Received</option>
              <option value="cancelled">Cancelled</option>
              <option value="all">Everything</option>
            </select>
          </div>
        </div>
        <div className="rlist">
          {list.data?.length === 0 && <div className="empty"><p>No purchase orders here.</p></div>}
          {list.data?.map((o) => (
            <button key={o.id} className={`rrow${o.id === id ? " sel" : ""}`} onClick={() => app.go("purchasing", o.id)}>
              <span className="grow">
                <span className="rname">{o.number} · {o.vendorName}</span>
                <span className="rsub">{o.lineCount} lines · to {o.locationName}{o.expected ? ` · due ${formatDate(o.expected)}` : ""}</span>
              </span>
              <span className="rside"><strong>{money(o.total)}</strong><Badge value={o.status} /></span>
            </button>
          ))}
        </div>
      </section>
      <section className="detail">
        {id ? <PoDetail key={`${id}-${app.version}`} app={app} id={id} /> : <div className="empty"><p>Pick a purchase order.</p></div>}
      </section>
      {creating && <NewPo app={app} onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewPo({ app, onClose }: { app: AppCtx; onClose: () => void }) {
  const vendors = useData<Vendor[]>("/api/vendors");
  const [err, setErr] = useState("");
  const active = (vendors.data ?? []).filter((v) => v.active);
  return (
    <Modal title="New purchase order" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const po = await api<PurchaseOrder>("/api/purchase-orders", { method: "POST", json: formData(e.currentTarget) });
            app.changed();
            app.go("purchasing", po.id);
            onClose();
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        {vendors.data && !active.length ? (
          <p>Add a vendor first. <button type="button" className="linkbtn" onClick={() => (onClose(), app.go("vendors"))}>Go to vendors</button></p>
        ) : (
          <label>
            <span>Vendor</span>
            <select name="vendorId" required>{active.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
          </label>
        )}
        <LocationSelect app={app} label="Deliver to" />
        <label><span>Expected</span><input type="date" name="expected" /></label>
        <ErrorLine text={err} />
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!active.length}>Create draft</button>
        </div>
      </form>
    </Modal>
  );
}

type DraftLine = { productId: string; sku: string; name: string; qty: string; unitCost: string };

function PoDetail({ app, id }: { app: AppCtx; id: string }) {
  const { data: po, error, reload } = useData<PurchaseOrder>(`/api/purchase-orders/${id}`);
  const [lines, setLines] = useState<DraftLine[] | null>(null);
  const [err, setErr] = useState("");
  const [receiving, setReceiving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  if (error) return <div className="card"><p className="error">{error}</p></div>;
  if (!po) return <div className="card muted">Loading…</div>;
  const draft = po.status === "draft" && app.manager;
  const editLines = lines ?? po.lines.map((l) => ({ productId: l.productId, sku: l.sku, name: l.name, qty: String(l.qty), unitCost: l.unitCost }));
  const dirty = lines !== null;
  const draftTotal = editLines.reduce((a, l) => a + Math.round(Number(l.qty || 0) * Number(l.unitCost || 0) * 100), 0) / 100;

  const save = async () => {
    try {
      await api(`/api/purchase-orders/${po.id}`, { method: "PUT", json: { lines: editLines } });
      setLines(null);
      setErr("");
      reload();
      app.changed();
      return true;
    } catch (x) {
      setErr((x as Error).message);
      return false;
    }
  };
  const act = async (path: string, done: string) => {
    try {
      if (dirty && !(await save())) return;
      await api(`/api/purchase-orders/${po.id}/${path}`, { method: "POST", json: {} });
      app.say(done);
      app.changed();
    } catch (x) {
      setErr((x as Error).message);
    }
  };

  return (
    <div className="card">
      <div className="cardtools">
        <button className="iconbtn back" aria-label="Back" onClick={() => app.go("purchasing")}><ArrowLeft size={18} /></button>
        <span className="grow" />
        <button className="iconbtn" title="Print" aria-label="Print" onClick={() => window.print()}><Printer size={16} /></button>
        {draft && <button className="btn primary small" onClick={() => act("place", "Marked as ordered")}><Send size={14} /> Mark as ordered</button>}
        {(po.status === "ordered" || po.status === "partial") && (
          <button className="btn primary small" onClick={() => setReceiving(true)}><PackageCheck size={14} /> Receive</button>
        )}
        {app.manager && ["draft", "ordered", "partial"].includes(po.status) && (
          <button className="btn small" onClick={() => setCancelling(true)}><X size={14} /> {po.status === "partial" ? "Close" : "Cancel"}</button>
        )}
      </div>
      <div className="cardhead">
        <div className="grow">
          <div className="bigname">{po.number}</div>
          <p className="muted">{po.vendorName} · deliver to {po.locationName}</p>
        </div>
        <Badge value={po.status} />
      </div>
      <section className="panel">
        <dl className="facts">
          <div><dt>Created</dt><dd>{formatDate(po.createdAt)} by {po.createdBy}</dd></div>
          <div><dt>Ordered</dt><dd>{formatDate(po.orderedAt)}</dd></div>
          <div><dt>Expected</dt><dd>{formatDate(po.expected)}</dd></div>
          <div><dt>Total</dt><dd>{money(dirty ? draftTotal : po.total)}</dd></div>
        </dl>
      </section>
      <section className="panel">
        <h3>Lines {dirty && <button className="btn primary small" onClick={save}>Save lines</button>}</h3>
        <table className="mini">
          <thead><tr><th>Product</th><th className="num">Ordered</th><th className="num">Unit cost</th><th className="num">Received</th><th className="num">Amount</th>{draft && <th />}</tr></thead>
          <tbody>
            {editLines.map((l, i) => {
              const got = po.lines.find((x) => x.productId === l.productId)?.received ?? 0;
              return (
                <tr key={`${l.productId}-${i}`}>
                  <td>{l.name} <span className="muted small">{l.sku}</span></td>
                  <td className="num">
                    {draft ? <input className="cell" value={l.qty} inputMode="decimal" aria-label={`${l.sku} quantity`} onChange={(e) => setLines(editLines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /> : qty(Number(l.qty))}
                  </td>
                  <td className="num">
                    {draft ? <input className="cell" value={l.unitCost} inputMode="decimal" aria-label={`${l.sku} cost`} onChange={(e) => setLines(editLines.map((x, j) => (j === i ? { ...x, unitCost: e.target.value } : x)))} /> : money(l.unitCost)}
                  </td>
                  <td className="num">{qty(got)}</td>
                  <td className="num">{money(Number(l.qty || 0) * Number(l.unitCost || 0))}</td>
                  {draft && <td><button className="iconbtn small" aria-label="Remove line" onClick={() => setLines(editLines.filter((_, j) => j !== i))}><Trash2 size={13} /></button></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {draft && (
          <div style={{ marginTop: 10 }}>
            <ProductPicker
              tracked
              placeholder="Add a product to this order…"
              onPick={(p) => setLines([...editLines, { productId: p.id, sku: p.sku, name: p.name, qty: String(p.reorderQty || 1), unitCost: p.cost }])}
            />
          </div>
        )}
        <ErrorLine text={err} />
      </section>
      {po.receipts.length > 0 && (
        <section className="panel">
          <h3>Deliveries</h3>
          <table className="mini">
            <thead><tr><th>#</th><th>When</th><th>Vendor invoice</th><th>By</th><th className="num">Value</th></tr></thead>
            <tbody>
              {po.receipts.map((r) => (
                <tr key={r.seq}><td>{r.seq}</td><td>{formatDateTime(r.receivedAt)}</td><td>{r.vendorRef || "—"}</td><td className="small muted">{r.receivedBy}</td><td className="num">{money(r.total)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Each delivery is a bill from {po.vendorName} in Books.</p>
        </section>
      )}
      {po.notes && <section className="panel"><h3>Notes</h3><p className="pre">{po.notes}</p></section>}
      {receiving && <ReceiveDialog app={app} po={po} onClose={() => setReceiving(false)} />}
      {cancelling && (
        <Confirm
          title={po.status === "partial" ? "Close purchase order" : "Cancel purchase order"}
          message={po.status === "partial" ? "What has arrived stays received; nothing more is expected." : "Nothing on this order will be received."}
          action={po.status === "partial" ? "Close" : "Cancel order"}
          danger
          onClose={() => setCancelling(false)}
          onConfirm={() => act("cancel", "Done")}
        />
      )}
    </div>
  );
}

function ReceiveDialog({ app, po, onClose }: { app: AppCtx; po: PurchaseOrder; onClose: () => void }) {
  const open = po.lines.filter((l) => l.qty > l.received);
  const [counts, setCounts] = useState<Record<string, string>>(Object.fromEntries(open.map((l) => [l.id, String(l.qty - l.received)])));
  const [costs, setCosts] = useState<Record<string, string>>(Object.fromEntries(open.map((l) => [l.id, l.unitCost])));
  const [err, setErr] = useState("");
  return (
    <Modal title={`Receive ${po.number}`} onClose={onClose} wide>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = formData(e.currentTarget);
          try {
            await api(`/api/purchase-orders/${po.id}/receive`, {
              method: "POST",
              json: { vendorRef: f.vendorRef, note: f.note, lines: open.map((l) => ({ lineId: l.id, qty: counts[l.id], unitCost: costs[l.id] })) },
            });
            app.say("Delivery received");
            app.changed();
            onClose();
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        <table className="mini">
          <thead><tr><th>Product</th><th className="num">Still due</th><th className="num">Arrived</th><th className="num">Unit cost</th></tr></thead>
          <tbody>
            {open.map((l) => (
              <tr key={l.id}>
                <td>{l.name} <span className="muted small">{l.sku}</span></td>
                <td className="num">{qty(l.qty - l.received)}</td>
                <td className="num"><input className="cell" value={counts[l.id]} inputMode="decimal" aria-label={`${l.sku} arrived`} onChange={(e) => setCounts({ ...counts, [l.id]: e.target.value })} /></td>
                <td className="num"><input className="cell" value={costs[l.id]} inputMode="decimal" aria-label={`${l.sku} cost`} onChange={(e) => setCosts({ ...costs, [l.id]: e.target.value })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid2">
          <label><span>Vendor&apos;s invoice number</span><input name="vendorRef" /></label>
          <label><span>Note</span><input name="note" /></label>
        </div>
        <p className="muted small">Arrived goods go on the shelf at {po.locationName}. Change a cost if the invoice differs from the order.</p>
        <ErrorLine text={err} />
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Receive</button>
        </div>
      </form>
    </Modal>
  );
}

export function Reorder({ app }: { app: AppCtx }) {
  const { data, error } = useData<Suggestion[]>("/api/reorder", [app.version]);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [loc, setLoc] = useState(app.locations.find((l) => l.active)?.id ?? "");
  const [err, setErr] = useState("");
  const chosen = picked ?? new Set((data ?? []).filter((s) => s.vendorId).map((s) => s.productId));
  const toggle = (id: string) => {
    const n = new Set(chosen);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setPicked(n);
  };
  return (
    <div className="page">
      <div className="pagehead">
        <h1>Reorder</h1>
        {app.manager && data && data.length > 0 && (
          <div className="filters">
            <LocationSelect app={app} label="Deliver to" value={loc} onChange={setLoc} />
            <button
              className="btn primary"
              disabled={!chosen.size}
              onClick={async () => {
                try {
                  const pos = await api<PurchaseOrder[]>("/api/reorder", { method: "POST", json: { productIds: [...chosen], locationId: loc } });
                  app.say(`${pos.length} draft purchase ${pos.length === 1 ? "order" : "orders"} made`);
                  app.changed();
                  app.go("purchasing", pos[0]?.id);
                } catch (x) {
                  setErr((x as Error).message);
                }
              }}
            >
              Draft purchase orders
            </button>
          </div>
        )}
      </div>
      <p className="muted">Products at or under their reorder point, counting what is already on order. One draft is made per vendor.</p>
      <ErrorLine text={err || error} />
      <section className="panel">
        {data?.length === 0 ? (
          <p className="muted">Nothing needs reordering.</p>
        ) : (
          <table className="mini">
            <thead><tr>{app.manager && <th />}<th>Product</th><th>Vendor</th><th className="num">On hand</th><th className="num">On order</th><th className="num">Reorder at</th><th className="num">Suggested</th><th className="num">Cost</th></tr></thead>
            <tbody>
              {data?.map((s) => (
                <tr key={s.productId}>
                  {app.manager && <td><input type="checkbox" checked={chosen.has(s.productId)} disabled={!s.vendorId} onChange={() => toggle(s.productId)} aria-label={`Order ${s.sku}`} /></td>}
                  <td><a href={`#/products/${s.productId}`}>{s.name}</a> <span className="muted small">{s.sku}</span></td>
                  <td>{s.vendorName ?? <span className="muted">No vendor</span>}</td>
                  <td className="num">{qty(s.onHand)}</td>
                  <td className="num">{qty(s.onOrder)}</td>
                  <td className="num">{qty(s.reorderPoint)}</td>
                  <td className="num"><strong>{qty(s.suggest)}</strong></td>
                  <td className="num">{money(s.unitCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export function Vendors({ app }: { app: AppCtx }) {
  const { data, error } = useData<Vendor[]>("/api/vendors", [app.version]);
  const [editing, setEditing] = useState<Vendor | "new" | null>(null);
  return (
    <div className="page">
      <div className="pagehead">
        <h1>Vendors</h1>
        {app.manager && <button className="btn primary" onClick={() => setEditing("new")}><Plus size={15} /> New vendor</button>}
      </div>
      <ErrorLine text={error} />
      <section className="panel">
        {data?.length === 0 ? (
          <p className="muted">No vendors yet. Vendors are who you buy stock from; deliveries from them become bills in Books.</p>
        ) : (
          <table className="mini">
            <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th className="num">Lead time</th><th /></tr></thead>
            <tbody>
              {data?.map((v) => (
                <tr key={v.id} className={v.active ? "" : "muted"}>
                  <td>{v.name}{!v.active && " (not in use)"}</td>
                  <td>{v.email ? <a href={`mailto:${v.email}`}>{v.email}</a> : "—"}</td>
                  <td>{v.phone || "—"}</td>
                  <td className="num">{v.leadDays} days</td>
                  <td className="num">{app.manager && <button className="linkbtn" onClick={() => setEditing(v)}>Edit</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {editing && (
        <Modal title={editing === "new" ? "New vendor" : `Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <VendorForm
            vendor={editing === "new" ? null : editing}
            onDone={() => {
              setEditing(null);
              app.changed();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function VendorForm({ vendor: v, onDone }: { vendor: Vendor | null; onDone: () => void }) {
  const [err, setErr] = useState("");
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api(v ? `/api/vendors/${v.id}` : "/api/vendors", { method: v ? "PUT" : "POST", json: formData(e.currentTarget) });
          onDone();
        } catch (x) {
          setErr((x as Error).message);
        }
      }}
    >
      <label><span>Name</span><input name="name" defaultValue={v?.name} required autoFocus /></label>
      <div className="grid2">
        <label><span>Email</span><input name="email" type="email" defaultValue={v?.email} /></label>
        <label><span>Phone</span><input name="phone" defaultValue={v?.phone} /></label>
      </div>
      <label><span>Address</span><textarea name="address" rows={2} defaultValue={v?.address} /></label>
      <label><span>Lead time in days</span><input name="leadDays" inputMode="numeric" defaultValue={v?.leadDays ?? 7} /></label>
      <label><span>Notes</span><textarea name="notes" rows={2} defaultValue={v?.notes} /></label>
      {v && <label className="check"><input type="checkbox" name="active" defaultChecked={v.active} /> In use</label>}
      <ErrorLine text={err} />
      <div className="actions"><button className="btn primary">Save</button></div>
    </form>
  );
}
