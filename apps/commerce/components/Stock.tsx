"use client";
import { ArrowLeftRight, ClipboardCheck, Search, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import type { StockRow } from "@/lib/stock";
import type { Movement } from "@/lib/types";
import { api, formData, formatDateTime, money, qty, useData } from "./client";
import { Modal } from "./Modal";
import { ErrorLine, LocationSelect, ProductPicker, label, type AppCtx } from "./shared";

type Sheet = { rows: StockRow[]; totalValue: string };
type Pick = { productId: string; name: string; sku: string };

export function Stock({ app }: { app: AppCtx }) {
  const [term, setTerm] = useState("");
  const [tab, setTab] = useState<"levels" | "history">("levels");
  const [dialog, setDialog] = useState<{ kind: "adjust" | "count" | "transfer"; product: Pick | null } | null>(null);
  const sheet = useData<Sheet>(`/api/stock?q=${encodeURIComponent(term)}`, [app.version]);
  const moves = useData<Movement[]>(tab === "history" ? "/api/movements" : null, [app.version]);
  const locs = app.locations.filter((l) => l.active);

  return (
    <div className="page">
      <div className="pagehead">
        <h1>Stock levels</h1>
        {app.manager && (
          <div className="filters">
            <button className="btn" onClick={() => setDialog({ kind: "count", product: null })}><ClipboardCheck size={15} /> Count</button>
            <button className="btn" onClick={() => setDialog({ kind: "adjust", product: null })}><SlidersHorizontal size={15} /> Adjust</button>
            <button className="btn" onClick={() => setDialog({ kind: "transfer", product: null })}><ArrowLeftRight size={15} /> Transfer</button>
          </div>
        )}
      </div>
      <div className="filters">
        <div className="seg">
          <button className={tab === "levels" ? "on" : ""} onClick={() => setTab("levels")}>On hand</button>
          <button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>Recent movements</button>
        </div>
        {tab === "levels" && (
          <div className="search" style={{ minWidth: 260 }}>
            <Search size={15} />
            <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Find a product" aria-label="Find a product" />
          </div>
        )}
        {tab === "levels" && sheet.data && <span className="muted">Valued at average cost: <strong>{money(sheet.data.totalValue)}</strong></span>}
      </div>
      {tab === "levels" && (
        <section className="panel tablewrap">
          {sheet.error && <p className="error">{sheet.error}</p>}
          <table className="mini">
            <thead>
              <tr>
                <th>Product</th>
                {locs.map((l) => <th key={l.id} className="num">{l.name}</th>)}
                <th className="num">Total</th>
                {app.manager && <th className="num">Value</th>}
              </tr>
            </thead>
            <tbody>
              {sheet.data?.rows.map((r) => (
                <tr key={r.productId}>
                  <td>
                    <a href={`#/products/${r.productId}`}>{r.name}</a> <span className="muted small">{r.sku}</span>
                  </td>
                  {locs.map((l) => (
                    <td key={l.id} className="num">
                      {app.manager ? (
                        <button className="linkbtn" title="Count this" onClick={() => setDialog({ kind: "count", product: { productId: r.productId, name: r.name, sku: r.sku } })}>
                          {qty(r.levels[l.id] ?? 0)}
                        </button>
                      ) : qty(r.levels[l.id] ?? 0)}
                    </td>
                  ))}
                  <td className={`num${r.total < 0 ? " neg" : ""}`}><strong>{qty(r.total)}</strong></td>
                  {app.manager && <td className="num">{money(r.value)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {sheet.data?.rows.length === 0 && <p className="muted">No stock-tracked products.</p>}
        </section>
      )}
      {tab === "history" && (
        <section className="panel">
          <table className="mini">
            <thead><tr><th>When</th><th>Product</th><th>What</th><th>Where</th><th className="num">Change</th><th>By</th></tr></thead>
            <tbody>
              {moves.data?.map((m) => (
                <tr key={m.id}>
                  <td>{formatDateTime(m.at)}</td>
                  <td><a href={`#/products/${m.productId}`}>{m.productName}</a></td>
                  <td>{label(m.kind)}{m.note ? <span className="muted"> · {m.note}</span> : null}</td>
                  <td>{m.locationName}</td>
                  <td className={`num ${m.qty < 0 ? "neg" : "plus"}`}>{m.qty > 0 ? "+" : ""}{qty(m.qty)}</td>
                  <td className="small muted">{m.by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {dialog && <StockDialog app={app} kind={dialog.kind} initial={dialog.product} onClose={() => setDialog(null)} />}
    </div>
  );
}

function StockDialog({ app, kind, initial, onClose }: { app: AppCtx; kind: "adjust" | "count" | "transfer"; initial: Pick | null; onClose: () => void }) {
  const [product, setProduct] = useState<Pick | null>(initial);
  const [err, setErr] = useState("");
  const title = kind === "count" ? "Count stock" : kind === "adjust" ? "Adjust stock" : "Transfer stock";
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!product) return setErr("Pick a product");
          const f = formData(e.currentTarget);
          try {
            if (kind === "transfer") {
              await api("/api/stock/transfer", { method: "POST", json: { ...f, productId: product.productId } });
              app.say(`Moved ${f.qty} ${product.sku}`);
            } else {
              const r = await api<{ onHand: number; change: number }>("/api/stock/adjust", {
                method: "POST",
                json: { ...f, productId: product.productId, mode: kind },
              });
              app.say(r.change === 0 ? "No change" : `${product.sku} now ${qty(r.onHand)} (${r.change > 0 ? "+" : ""}${qty(r.change)})`);
            }
            app.changed();
            onClose();
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        {product ? (
          <p><strong>{product.name}</strong> <span className="muted">{product.sku}</span> <button type="button" className="linkbtn" onClick={() => setProduct(null)}>Change</button></p>
        ) : (
          <ProductPicker tracked onPick={(p) => setProduct({ productId: p.id, name: p.name, sku: p.sku })} placeholder="Find a product" />
        )}
        {kind === "transfer" ? (
          <div className="grid2">
            <LocationSelect app={app} name="from" label="From" />
            <LocationSelect app={app} name="to" label="To" value={app.locations.filter((l) => l.active)[1]?.id} />
          </div>
        ) : (
          <LocationSelect app={app} />
        )}
        <label>
          <span>{kind === "count" ? "Counted on the shelf" : kind === "adjust" ? "Change (use minus for losses, like -2)" : "How many"}</span>
          <input name="qty" inputMode="decimal" required autoFocus={Boolean(product)} />
        </label>
        <label><span>Note</span><input name="note" placeholder={kind === "adjust" ? "Damaged, expired, found…" : ""} /></label>
        {kind !== "transfer" && <p className="muted small">The difference is valued at average cost and posted to Books as a stock gain or loss.</p>}
        <ErrorLine text={err} />
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}
