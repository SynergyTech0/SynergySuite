"use client";
import { ArrowLeft, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import type { Movement, Product, StockLevel, Vendor } from "@/lib/types";
import { api, formData, formatDateTime, money, parseCsv, qty, useData } from "./client";
import { Confirm, Modal } from "./Modal";
import { ErrorLine, StockBadge, label, type AppCtx } from "./shared";

type Detail = Product & { levels: StockLevel[] };

export function Products({ app, id }: { app: AppCtx; id: string | null }) {
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState("active");
  const [category, setCategory] = useState("");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const list = useData<Product[]>(`/api/products?q=${encodeURIComponent(term)}&status=${status}&category=${encodeURIComponent(category)}`, [app.version]);
  const cats = useData<string[]>("/api/categories", [app.version]);

  return (
    <div className={`split${id ? " withdetail" : ""}`}>
      <section className="listpane">
        <div className="listhead">
          <div className="titlerow">
            <h1 className="grow">Products</h1>
            {app.manager && (
              <>
                <button className="iconbtn" title="Import from CSV" aria-label="Import from CSV" onClick={() => setImporting(true)}><Upload size={17} /></button>
                <button className="btn primary small" onClick={() => setEditing("new")}><Plus size={15} /> New</button>
              </>
            )}
          </div>
          <div className="search">
            <Search size={15} />
            <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Name, SKU or barcode" aria-label="Search products" />
          </div>
          <div className="filters">
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Show">
              <option value="active">For sale</option>
              <option value="low">Low stock</option>
              <option value="online">In the online store</option>
              <option value="archived">Archived</option>
              <option value="all">Everything</option>
            </select>
            <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
              <option value="">All categories</option>
              {(cats.data ?? []).map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="rlist">
          {list.error && <p className="error pad">{list.error}</p>}
          {list.data?.length === 0 && (
            <div className="empty">
              <p>No products here yet.</p>
              {app.manager && <button className="btn" onClick={() => setEditing("new")}>Add a product</button>}
            </div>
          )}
          {list.data?.map((p) => (
            <button key={p.id} className={`rrow${p.id === id ? " sel" : ""}`} onClick={() => app.go("products", p.id)}>
              <Thumb p={p} />
              <span className="grow">
                <span className="rname">{p.name}</span>
                <span className="rsub">{p.sku}{p.category ? ` · ${p.category}` : ""}</span>
              </span>
              <span className="rside">
                <strong>{money(p.price)}</strong>
                <StockBadge p={p} />
              </span>
            </button>
          ))}
        </div>
      </section>
      <section className="detail">
        {id ? (
          <ProductDetail key={`${id}-${app.version}`} app={app} id={id} onEdit={setEditing} />
        ) : (
          <div className="empty"><p>Pick a product to see its stock and history.</p></div>
        )}
      </section>
      {editing && (
        <ProductEditor
          app={app}
          product={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            setEditing(null);
            app.changed();
            app.go("products", p.id);
          }}
        />
      )}
      {importing && <ImportDialog app={app} onClose={() => setImporting(false)} />}
    </div>
  );
}

function Thumb({ p }: { p: Pick<Product, "imageUrl" | "name"> }) {
  // eslint-disable-next-line @next/next/no-img-element
  if (p.imageUrl) return <img className="thumb" src={p.imageUrl} alt="" />;
  return <span className="avatar square" aria-hidden>{p.name.slice(0, 2).toUpperCase()}</span>;
}

function ProductDetail({ app, id, onEdit }: { app: AppCtx; id: string; onEdit: (p: Product) => void }) {
  const { data: p, error } = useData<Detail>(`/api/products/${id}`);
  const moves = useData<Movement[]>(`/api/movements?product=${id}`);
  const [confirm, setConfirm] = useState(false);
  if (error) return <div className="card"><p className="error">{error}</p></div>;
  if (!p) return <div className="card muted">Loading…</div>;
  return (
    <div className="card">
      <div className="cardtools">
        <button className="iconbtn back" aria-label="Back" onClick={() => app.go("products")}><ArrowLeft size={18} /></button>
        <span className="grow" />
        {app.manager && (
          <>
            <button className="btn small" onClick={() => onEdit(p)}><Pencil size={14} /> Edit</button>
            <button className="iconbtn" aria-label={p.active ? "Archive or delete" : "Delete"} title="Archive or delete" onClick={() => setConfirm(true)}><Trash2 size={16} /></button>
          </>
        )}
      </div>
      <div className="cardhead">
        <Thumb p={p} />
        <div className="grow">
          <div className="bigname">{p.name}</div>
          <p className="muted">{p.sku}{p.barcode ? ` · ${p.barcode}` : ""}{p.category ? ` · ${p.category}` : ""}</p>
        </div>
        <StockBadge p={p} />
      </div>
      {!p.active && <div className="notice warn">Archived: not for sale anywhere.</div>}
      <section className="panel">
        <dl className="facts">
          <div><dt>Price</dt><dd>{money(p.price)} / {p.unit}</dd></div>
          {app.manager && <div><dt>Average cost</dt><dd>{money(p.cost)}</dd></div>}
          {app.manager && Number(p.price) > 0 && <div><dt>Margin</dt><dd>{(((Number(p.price) - Number(p.cost)) / Number(p.price)) * 100).toFixed(1)}%</dd></div>}
          <div><dt>Tax</dt><dd>{p.taxRate === null ? `Store default (${app.settings.defaultTaxRate}%)` : `${p.taxRate}%`}</dd></div>
          <div><dt>Reorder</dt><dd>{p.trackStock && p.reorderPoint > 0 ? `${qty(p.reorderQty)} when at ${qty(p.reorderPoint)}` : "—"}</dd></div>
          <div><dt>Vendor</dt><dd>{p.vendorName ?? "—"}{p.vendorSku ? ` (${p.vendorSku})` : ""}</dd></div>
          <div><dt>Online store</dt><dd>{p.online ? "Listed" : "Not listed"}</dd></div>
        </dl>
        {p.description && <p className="pre" style={{ marginTop: 12 }}>{p.description}</p>}
      </section>
      {p.trackStock && (
        <section className="panel">
          <h3>Stock by location</h3>
          <table className="mini">
            <tbody>
              {p.levels.map((l) => (
                <tr key={l.locationId}><td>{l.locationName}</td><td className="num">{qty(l.onHand)}</td></tr>
              ))}
              <tr><td><strong>Total</strong></td><td className="num"><strong>{qty(p.onHand)}</strong></td></tr>
            </tbody>
          </table>
        </section>
      )}
      <section className="panel">
        <h3>History</h3>
        {!moves.data?.length ? (
          <p className="muted">No stock movements yet.</p>
        ) : (
          <table className="mini">
            <thead><tr><th>When</th><th>What</th><th>Where</th><th className="num">Change</th><th>By</th></tr></thead>
            <tbody>
              {moves.data.map((m) => (
                <tr key={m.id}>
                  <td>{formatDateTime(m.at)}</td>
                  <td>{label(m.kind)}{m.note ? <span className="muted"> · {m.note}</span> : null}</td>
                  <td>{m.locationName}</td>
                  <td className={`num ${m.qty < 0 ? "neg" : "plus"}`}>{m.qty > 0 ? "+" : ""}{qty(m.qty)}</td>
                  <td className="small muted">{m.by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {confirm && (
        <Confirm
          title="Remove product"
          message="A product that was never stocked, sold or ordered is deleted. Anything with history is archived instead, so past orders keep their details."
          action="Remove"
          danger
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            const r = await api<{ archived: boolean }>(`/api/products/${p.id}`, { method: "DELETE" });
            app.say(r.archived ? "Archived" : "Deleted");
            app.changed();
            if (!r.archived) app.go("products");
          }}
        />
      )}
    </div>
  );
}

function ProductEditor({ app, product, onClose, onSaved }: { app: AppCtx; product: Product | null; onClose: () => void; onSaved: (p: Product) => void }) {
  const vendors = useData<Vendor[]>("/api/vendors");
  const cats = useData<string[]>("/api/categories");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const p = product;
  return (
    <Modal title={p ? `Edit ${p.name}` : "New product"} onClose={onClose} wide>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const body = formData(e.currentTarget);
            const saved = await api<Product>(p ? `/api/products/${p.id}` : "/api/products", { method: p ? "PUT" : "POST", json: body });
            onSaved(saved);
          } catch (x) {
            setErr((x as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid2">
          <label><span>Name</span><input name="name" defaultValue={p?.name} required autoFocus /></label>
          <label><span>SKU</span><input name="sku" defaultValue={p?.sku} required /></label>
          <label><span>Barcode</span><input name="barcode" defaultValue={p?.barcode} placeholder="Scan or type" /></label>
          <label><span>Category</span><input name="category" defaultValue={p?.category} list="categories" /></label>
          <datalist id="categories">{cats.data?.map((c) => <option key={c} value={c} />)}</datalist>
          <label><span>Price</span><input name="price" defaultValue={p?.price ?? ""} inputMode="decimal" required /></label>
          {p ? (
            <label><span>Average cost</span><input value={p.cost} disabled title="Deliveries set the cost" /></label>
          ) : (
            <label><span>Cost</span><input name="cost" inputMode="decimal" placeholder="What you pay per unit" /></label>
          )}
          <label><span>Tax rate %</span><input name="taxRate" defaultValue={p?.taxRate ?? ""} placeholder={`Store default (${app.settings.defaultTaxRate}%)`} inputMode="decimal" /></label>
          <label><span>Sold by</span><input name="unit" defaultValue={p?.unit ?? "each"} /></label>
        </div>
        <label><span>Description</span><textarea name="description" rows={3} defaultValue={p?.description} /></label>
        <label><span>Image address</span><input name="imageUrl" defaultValue={p?.imageUrl} placeholder="https://…" /></label>
        <fieldset>
          <legend>Stock and buying</legend>
          <label className="check"><input type="checkbox" name="trackStock" defaultChecked={p?.trackStock ?? true} /> Track stock for this product</label>
          <div className="grid2">
            <label><span>Reorder when at or under</span><input name="reorderPoint" defaultValue={p?.reorderPoint ?? ""} inputMode="decimal" /></label>
            <label><span>Reorder quantity</span><input name="reorderQty" defaultValue={p?.reorderQty ?? ""} inputMode="decimal" /></label>
            <label>
              <span>Vendor</span>
              <select name="vendorId" defaultValue={p?.vendorId ?? ""}>
                <option value="">None</option>
                {(vendors.data ?? []).filter((v) => v.active || v.id === p?.vendorId).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label><span>Vendor&apos;s code</span><input name="vendorSku" defaultValue={p?.vendorSku} /></label>
          </div>
        </fieldset>
        <label className="check"><input type="checkbox" name="online" defaultChecked={p?.online ?? false} /> List in the online store</label>
        {p && <label className="check"><input type="checkbox" name="active" defaultChecked={p.active} /> For sale</label>}
        <ErrorLine text={err} />
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{p ? "Save" : "Add product"}</button>
        </div>
      </form>
    </Modal>
  );
}

function ImportDialog({ app, onClose }: { app: AppCtx; onClose: () => void }) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [result, setResult] = useState<{ added: number; updated: number; errors: string[] } | null>(null);
  const [err, setErr] = useState("");
  return (
    <Modal title="Import products" onClose={onClose} wide>
      <div className="form">
        <p className="muted small">
          A CSV with a header row. Columns: sku, name, price, cost, barcode, category, description, unit, tax_rate, reorder_point, reorder_qty,
          vendor_sku, image_url, online. New SKUs are added; known SKUs are updated. Cost is only used for new products.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setRows(parseCsv(await f.text()));
          }}
        />
        {rows.length > 0 && <p>{rows.length} rows ready.</p>}
        {result && (
          <div className="notice">
            {result.added} added, {result.updated} updated{result.errors.length ? `, ${result.errors.length} skipped` : ""}.
          </div>
        )}
        {result?.errors.map((x) => <p key={x} className="error small">{x}</p>)}
        <ErrorLine text={err} />
        <div className="actions">
          <button className="btn" onClick={onClose}>Close</button>
          <button
            className="btn primary"
            disabled={!rows.length}
            onClick={async () => {
              try {
                setResult(await api("/api/products/import", { method: "POST", json: { rows } }));
                setRows([]);
                app.changed();
              } catch (x) {
                setErr((x as Error).message);
              }
            }}
          >
            Import
          </button>
        </div>
      </div>
    </Modal>
  );
}
