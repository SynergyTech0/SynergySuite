"use client";
import {
  BookOpen, Boxes, ClipboardList, ExternalLink, LayoutDashboard, Monitor, Package, Repeat, Settings as Cog, ShoppingBag, Store, Truck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Ctx, Location, Settings } from "@/lib/types";
import { Accounting } from "./Accounting";
import { api, setCurrency, useRoute, type View } from "./client";
import { Orders } from "./Orders";
import { Overview } from "./Overview";
import { Products } from "./Products";
import { Purchasing, Reorder, Vendors } from "./Purchasing";
import { SettingsView } from "./Settings";
import type { AppCtx } from "./shared";
import { Stock } from "./Stock";

type Me = Ctx & { settings: Settings; books: boolean; checkout: boolean };

const NAV: { view: View; text: string; icon: React.ReactNode; section?: string }[] = [
  { view: "overview", text: "Overview", icon: <LayoutDashboard size={17} /> },
  { view: "orders", text: "Orders", icon: <ShoppingBag size={17} />, section: "Sell" },
  { view: "products", text: "Products", icon: <Package size={17} />, section: "Stock" },
  { view: "stock", text: "Stock levels", icon: <Boxes size={17} /> },
  { view: "purchasing", text: "Purchase orders", icon: <ClipboardList size={17} />, section: "Buy" },
  { view: "reorder", text: "Reorder", icon: <Repeat size={17} /> },
  { view: "vendors", text: "Vendors", icon: <Truck size={17} /> },
  { view: "accounting", text: "Books", icon: <BookOpen size={17} />, section: "Manage" },
  { view: "settings", text: "Settings", icon: <Cog size={17} /> },
];

export function CommerceApp({ me: initial }: { me: Ctx }) {
  const [route, go] = useRoute();
  const [me, setMe] = useState<Me | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [toast, setToast] = useState("");
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    Promise.all([api<Me>("/api/me"), api<Location[]>("/api/locations")])
      .then(([m, l]) => {
        setCurrency(m.settings.currency);
        setMe(m);
        setLocations(l);
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  if (error) return <div className="pad"><p className="error">{error}</p></div>;
  if (!me) return <div className="pad muted">Loading…</div>;

  const app: AppCtx = {
    me: { email: me.email, name: me.name, role: me.role ?? initial.role },
    settings: me.settings,
    locations,
    books: me.books,
    checkout: me.checkout,
    manager: me.role === "manager" || me.role === "admin",
    go,
    say: setToast,
    changed: () => setVersion((v) => v + 1),
    version,
    refreshSettings: load,
  };

  return (
    <div className="shell">
      <nav className="nav" aria-label="Commerce">
        <a className="btn primary newbtn" href="/pos">
          <Monitor size={16} /> Open register
        </a>
        {NAV.map((n) => (
          <div key={n.view} style={{ display: "contents" }}>
            {n.section && <div className="navsection">{n.section}</div>}
            <button className={`navitem${route.view === n.view ? " active" : ""}`} onClick={() => go(n.view)}>
              {n.icon} {n.text}
            </button>
          </div>
        ))}
        {me.settings.store.enabled && (
          <a className="navitem" href="/store" target="_blank" rel="noreferrer">
            <Store size={17} /> Online store <ExternalLink size={13} className="muted" />
          </a>
        )}
        <div className="grow" />
        <div className="whoami small muted">
          <span>{me.name || me.email}</span>
          <span>{me.role === "admin" ? "Admin" : me.role === "manager" ? "Manager" : "Staff"}</span>
        </div>
      </nav>
      <main className="view">
        {route.view === "overview" && <Overview app={app} />}
        {route.view === "orders" && <Orders app={app} id={route.id} />}
        {route.view === "products" && <Products app={app} id={route.id} />}
        {route.view === "stock" && <Stock app={app} />}
        {route.view === "purchasing" && <Purchasing app={app} id={route.id} />}
        {route.view === "reorder" && <Reorder app={app} />}
        {route.view === "vendors" && <Vendors app={app} />}
        {route.view === "accounting" && <Accounting app={app} />}
        {route.view === "settings" && <SettingsView app={app} onLocations={setLocations} />}
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
