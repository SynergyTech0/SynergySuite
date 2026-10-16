"use client";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ACCOUNT_KEYS, type Location, type Member, type Register, type Settings, type Shift } from "@/lib/types";
import { api, formData, formatDateTime, money, useData } from "./client";
import { Modal } from "./Modal";
import { ErrorLine, LocationSelect, label, type AppCtx } from "./shared";

const DEFAULT_HINT: Record<string, string> = {
  cash: "Checking account", card: "Card payouts land here", online: "Online payouts land here", other: "Gift cards, vouchers…",
};

export function SettingsView({ app, onLocations }: { app: AppCtx; onLocations: (l: Location[]) => void }) {
  const admin = app.me.role === "admin";
  const s = app.settings;
  const [err, setErr] = useState("");
  const save = async (patch: Partial<Record<keyof Settings, unknown>>) => {
    try {
      await api<Settings>("/api/settings", { method: "PUT", json: patch });
      setErr("");
      app.say("Saved");
      app.refreshSettings();
    } catch (x) {
      setErr((x as Error).message);
    }
  };
  return (
    <div className="page">
      <div className="pagehead"><h1>Settings</h1></div>
      {!admin && <p className="muted">Only an admin can change settings.</p>}
      <ErrorLine text={err} />
      <div className="cols">
        <section className="panel">
          <h3>Business</h3>
          <form
            className="form flat"
            onSubmit={(e) => {
              e.preventDefault();
              void save(formData(e.currentTarget));
            }}
          >
            <fieldset disabled={!admin}>
              <label><span>Store name</span><input name="storeName" defaultValue={s.storeName} /></label>
              <div className="grid2">
                <label><span>Currency</span><input name="currency" defaultValue={s.currency} maxLength={3} /></label>
                <label><span>Default tax rate %</span><input name="defaultTaxRate" defaultValue={s.defaultTaxRate} inputMode="decimal" /></label>
              </div>
              <label><span>Receipt footer</span><input name="receiptFooter" defaultValue={s.receiptFooter} /></label>
              <div className="actions"><button className="btn primary">Save</button></div>
            </fieldset>
          </form>
        </section>
        <section className="panel">
          <h3>Online store</h3>
          <form
            className="form flat"
            onSubmit={(e) => {
              e.preventDefault();
              void save({ store: formData(e.currentTarget) });
            }}
          >
            <fieldset disabled={!admin}>
              <label className="check"><input type="checkbox" name="enabled" defaultChecked={s.store.enabled} /> Open the store at /store</label>
              <label><span>Tagline</span><input name="tagline" defaultValue={s.store.tagline} /></label>
              <LocationSelect app={app} label="Online orders are picked from" value={s.store.locationId ?? undefined} />
              <div className="grid2">
                <label className="check"><input type="checkbox" name="pickup" defaultChecked={s.store.pickup} /> Pickup</label>
                <label className="check"><input type="checkbox" name="shipping" defaultChecked={s.store.shipping} /> Delivery</label>
                <label><span>Delivery fee</span><input name="shippingFee" defaultValue={(s.store.shippingFee / 100).toFixed(2)} inputMode="decimal" /></label>
                <label><span>Accent color</span><input name="accent" type="color" defaultValue={s.store.accent} /></label>
              </div>
              <label className="check"><input type="checkbox" name="payLater" defaultChecked={s.store.payLater} /> Let shoppers pay at pickup or on delivery</label>
              <p className="muted small">
                {app.checkout
                  ? "Online payment is connected."
                  : "Online payment isn't connected (COMMERCE_CHECKOUT_URL). Shoppers can only order to pay later."}
              </p>
              <div className="actions"><button className="btn primary">Save</button></div>
            </fieldset>
          </form>
        </section>
      </div>
      <section className="panel">
        <h3>Books accounts</h3>
        <p className="muted small">The Books account number each kind of money is posted to. The defaults match Books&apos; standard chart of accounts.</p>
        <form
          className="form flat"
          onSubmit={(e) => {
            e.preventDefault();
            void save({ accounts: formData(e.currentTarget) });
          }}
        >
          <fieldset disabled={!admin}>
            <div className="acctgrid">
              {ACCOUNT_KEYS.map((k) => (
                <label key={k}>
                  <span>{k === "cash" || k === "card" || k === "online" || k === "other" ? `${label(k)} takings` : label(k)}</span>
                  <input name={k} defaultValue={s.accounts[k]} title={DEFAULT_HINT[k]} />
                </label>
              ))}
            </div>
            <div className="actions"><button className="btn primary">Save</button></div>
          </fieldset>
        </form>
      </section>
      <div className="cols">
        <Locations app={app} onLocations={onLocations} />
        <Registers app={app} />
      </div>
      <div className="cols">
        <People app={app} />
        <Shifts app={app} />
      </div>
    </div>
  );
}

function Locations({ app, onLocations }: { app: AppCtx; onLocations: (l: Location[]) => void }) {
  const [editing, setEditing] = useState<Location | "new" | null>(null);
  const [err, setErr] = useState("");
  return (
    <section className="panel">
      <h3>Locations {app.manager && <button className="btn small" onClick={() => setEditing("new")}><Plus size={14} /> Add</button>}</h3>
      <table className="mini">
        <tbody>
          {app.locations.map((l) => (
            <tr key={l.id} className={l.active ? "" : "muted"}>
              <td>{l.name}{!l.active && " (not in use)"}</td>
              <td>{label(l.kind)}</td>
              <td className="num">{app.manager && <button className="linkbtn" onClick={() => setEditing(l)}>Edit</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <Modal title={editing === "new" ? "New location" : `Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const l = editing === "new" ? null : editing;
              try {
                await api(l ? `/api/locations/${l.id}` : "/api/locations", { method: l ? "PUT" : "POST", json: formData(e.currentTarget) });
                onLocations(await api<Location[]>("/api/locations"));
                setEditing(null);
                app.changed();
              } catch (x) {
                setErr((x as Error).message);
              }
            }}
          >
            <label><span>Name</span><input name="name" defaultValue={editing === "new" ? "" : editing.name} required autoFocus /></label>
            <label>
              <span>Kind</span>
              <select name="kind" defaultValue={editing === "new" ? "store" : editing.kind}>
                <option value="store">Store</option>
                <option value="warehouse">Warehouse</option>
              </select>
            </label>
            <label><span>Address</span><textarea name="address" rows={2} defaultValue={editing === "new" ? "" : editing.address} /></label>
            {editing !== "new" && <label className="check"><input type="checkbox" name="active" defaultChecked={editing.active} /> In use</label>}
            <ErrorLine text={err} />
            <div className="actions"><button className="btn primary">Save</button></div>
          </form>
        </Modal>
      )}
    </section>
  );
}

function Registers({ app }: { app: AppCtx }) {
  const { data, reload } = useData<Register[]>("/api/registers", [app.version]);
  const [editing, setEditing] = useState<Register | "new" | null>(null);
  const [err, setErr] = useState("");
  return (
    <section className="panel">
      <h3>Registers {app.manager && <button className="btn small" onClick={() => setEditing("new")}><Plus size={14} /> Add</button>}</h3>
      <table className="mini">
        <tbody>
          {data?.map((r) => (
            <tr key={r.id} className={r.active ? "" : "muted"}>
              <td>{r.name}</td>
              <td>{r.locationName}</td>
              <td>{r.shift ? `Open since ${formatDateTime(r.shift.openedAt)}` : "Closed"}</td>
              <td className="num">{app.manager && <button className="linkbtn" onClick={() => setEditing(r)}>Edit</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <Modal title={editing === "new" ? "New register" : `Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = editing === "new" ? null : editing;
              try {
                await api(r ? `/api/registers/${r.id}` : "/api/registers", { method: r ? "PUT" : "POST", json: formData(e.currentTarget) });
                setEditing(null);
                reload();
              } catch (x) {
                setErr((x as Error).message);
              }
            }}
          >
            <label><span>Name</span><input name="name" defaultValue={editing === "new" ? "" : editing.name} required autoFocus /></label>
            <LocationSelect app={app} value={editing === "new" ? undefined : editing.locationId} />
            {editing !== "new" && <label className="check"><input type="checkbox" name="active" defaultChecked={editing.active} /> In use</label>}
            <ErrorLine text={err} />
            <div className="actions"><button className="btn primary">Save</button></div>
          </form>
        </Modal>
      )}
    </section>
  );
}

function People({ app }: { app: AppCtx }) {
  const { data, reload } = useData<Member[]>("/api/members", [app.version]);
  const [err, setErr] = useState("");
  return (
    <section className="panel">
      <h3>People</h3>
      <p className="muted small">Staff sell, fulfil and receive deliveries. Managers also run products, stock, buying and refunds. Admins also change settings.</p>
      <ul className="people">
        {data?.map((m) => (
          <li key={m.email}>
            <span className="grow">{m.name || m.email}<div className="muted small">{m.email}</div></span>
            {app.me.role === "admin" ? (
              <select
                value={m.role}
                aria-label={`Role for ${m.email}`}
                onChange={async (e) => {
                  try {
                    await api(`/api/members/${encodeURIComponent(m.email)}`, { method: "PUT", json: { role: e.target.value } });
                    reload();
                  } catch (x) {
                    setErr((x as Error).message);
                  }
                }}
              >
                <option value="staff">Staff</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
            ) : (
              <span className="badge">{label(m.role)}</span>
            )}
          </li>
        ))}
      </ul>
      <ErrorLine text={err} />
    </section>
  );
}

function Shifts({ app }: { app: AppCtx }) {
  const { data } = useData<(Shift & { registerName: string })[]>("/api/shifts", [app.version]);
  return (
    <section className="panel">
      <h3>Register shifts</h3>
      {!data?.length ? (
        <p className="muted">No shifts yet.</p>
      ) : (
        <table className="mini">
          <thead><tr><th>Register</th><th>Opened</th><th>Closed</th><th className="num">Over / short</th></tr></thead>
          <tbody>
            {data.map((s) => {
              const diff = s.countedCash !== null && s.expectedCash !== null ? Number(s.countedCash) - Number(s.expectedCash) : null;
              return (
                <tr key={s.id}>
                  <td>{s.registerName}</td>
                  <td>{formatDateTime(s.openedAt)}<div className="muted small">{s.openedBy}</div></td>
                  <td>{s.closedAt ? formatDateTime(s.closedAt) : "Open"}</td>
                  <td className={`num${diff !== null && Math.abs(diff) >= 0.01 ? (diff < 0 ? " neg" : " plus") : ""}`}>{diff === null ? "—" : money(diff)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
