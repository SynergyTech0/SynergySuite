"use client";
import { Boxes, CalendarClock, ClipboardList, Cog, Factory, Gauge, Layers, Link2, ShoppingCart, Truck, Wrench } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AssetsPane } from "./AssetsPane";
import { BomsPane } from "./BomsPane";
import { api, setLink } from "./client";
import { ItemsPane } from "./ItemsPane";
import { MaintenancePane } from "./MaintenancePane";
import { PlanningPane } from "./PlanningPane";
import { PlansPane } from "./PlansPane";
import { PurchasePane } from "./PurchasePane";
import { WorkCentersPane } from "./WorkCentersPane";
import { WorkOrdersPane } from "./WorkOrdersPane";

export type Me = { email: string; name: string };
export type StockState = { linked: boolean; pending: number; failed: number; lastError: string };
type Counts = { assets: number; orders: number; mine: number; late: number; booksLinked: boolean };

export type Section = "planning" | "workorders" | "boms" | "items" | "purchase" | "workcenters" | "assets" | "maintenance" | "plans";

const MFG: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: "planning", label: "Planning", icon: <Gauge size={18} /> },
  { id: "workorders", label: "Work orders", icon: <Factory size={18} /> },
  { id: "boms", label: "Bills of materials", icon: <Layers size={18} /> },
  { id: "items", label: "Items and stock", icon: <Boxes size={18} /> },
  { id: "purchase", label: "Purchase requests", icon: <ShoppingCart size={18} /> },
  { id: "workcenters", label: "Work centers", icon: <Cog size={18} /> },
];
const ASSETS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: "assets", label: "Assets", icon: <Truck size={18} /> },
  { id: "maintenance", label: "Maintenance", icon: <Wrench size={18} /> },
  { id: "plans", label: "Preventive plans", icon: <CalendarClock size={18} /> },
];

/** Where a deep link (?item=, ?bom=, ?wo=, ?asset=, ?mo=) opens, from search results and other apps. */
function fromLink(): { section: Section; open: number | null } {
  const sp = new URL(location.href).searchParams;
  const pick = (k: string) => {
    const n = Number(sp.get(k));
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  };
  for (const [k, section] of [["wo", "workorders"], ["bom", "boms"], ["item", "items"], ["asset", "assets"], ["mo", "maintenance"]] as const) {
    const id = pick(k);
    if (id) return { section, open: id };
  }
  return { section: "planning", open: null };
}

export function OpsApp({ me }: { me: Me }) {
  const [section, setSection] = useState<Section>("planning");
  const [open, setOpen] = useState<number | null>(null);
  const [stock, setStock] = useState<StockState>({ linked: false, pending: 0, failed: 0, lastError: "" });
  const [counts, setCounts] = useState<Counts | null>(null);
  const [toast, setToast] = useState("");

  const say = useCallback((t: string) => {
    setToast(t);
    window.setTimeout(() => setToast((x) => (x === t ? "" : x)), 3500);
  }, []);

  const refreshMe = useCallback(async () => {
    const r = await api<{ stock: StockState; counts: Counts }>("/api/me");
    setStock(r.stock);
    setCounts(r.counts);
  }, []);

  useEffect(() => {
    const l = fromLink();
    setSection(l.section);
    setOpen(l.open);
    void refreshMe().catch(() => {});
  }, [refreshMe]);

  // Keep the open record in the address bar, so a reload or a shared link comes back to it.
  useEffect(() => {
    const key: Partial<Record<Section, string>> = { workorders: "wo", boms: "bom", items: "item", assets: "asset", maintenance: "mo" };
    setLink(key[section] ?? null, open);
  }, [section, open]);

  const go = (s: Section, id: number | null = null) => {
    setSection(s);
    setOpen(id);
  };

  const item = (n: { id: Section; label: string; icon: React.ReactNode }, count?: number) => (
    <button key={n.id} className={`navitem${section === n.id ? " active" : ""}`} onClick={() => go(n.id)}>
      {n.icon}
      <span className="grow">{n.label}</span>
      {count ? <span className="count">{count}</span> : null}
    </button>
  );

  const props = { me, say, open, setOpen, go, stock, booksLinked: !!counts?.booksLinked, refreshMe };

  return (
    <div className="ops">
      <nav className="nav" aria-label="Ops">
        <div className="navsection">Manufacturing</div>
        {MFG.map((n) => item(n))}
        <div className="navsection">Assets</div>
        {ASSETS.map((n) => item(n, n.id === "maintenance" ? counts?.orders : n.id === "assets" ? counts?.assets : undefined))}
        <div className="grow" />
        <div className="linkstate small muted">
          <span>
            <Link2 size={14} /> {stock.linked ? "Stock kept in Commerce" : "Stock kept here"}
          </span>
          {stock.linked && stock.failed > 0 && <span className="neg" title={stock.lastError}>Commerce isn't taking stock moves: {stock.lastError}</span>}
          {stock.linked && stock.pending > 0 && !stock.failed && <span>{stock.pending} stock moves waiting for Commerce</span>}
          {counts?.late ? <span><ClipboardList size={14} /> {counts.late} maintenance orders overdue</span> : null}
        </div>
      </nav>
      {section === "planning" && <PlanningPane {...props} />}
      {section === "workorders" && <WorkOrdersPane {...props} />}
      {section === "boms" && <BomsPane {...props} />}
      {section === "items" && <ItemsPane {...props} />}
      {section === "purchase" && <PurchasePane {...props} />}
      {section === "workcenters" && <WorkCentersPane {...props} />}
      {section === "assets" && <AssetsPane {...props} />}
      {section === "maintenance" && <MaintenancePane {...props} />}
      {section === "plans" && <PlansPane {...props} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

export type PaneProps = {
  me: Me;
  say: (t: string) => void;
  open: number | null;
  setOpen: (id: number | null) => void;
  go: (s: Section, id?: number | null) => void;
  /** Commerce owns stock: receiving and counting happen there. */
  stock: StockState;
  /** Assets can be sent to Books' fixed-asset register. */
  booksLinked: boolean;
  refreshMe: () => Promise<void>;
};
