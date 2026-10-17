"use client";
import { Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { api, money, person } from "./client";
import type { Go } from "./LawApp";
import { MatterTable } from "./Matters";
import { Modal } from "./Modal";
import type { AppInfo, MatterSummary } from "./types";

type Client = {
  id: string; kind: string; name: string; aliases: string[]; email: string; phone: string; address: string; notes: string; status: string;
  created_by: string; matters?: number;
};

const STATUS: Record<string, string> = { prospect: "Prospect", active: "Client", former: "Former client" };

function ClientDialog({ c, onClose, onSaved }: { c: Client | null; onClose: () => void; onSaved: (id: string) => void }) {
  const [v, setV] = useState({
    kind: c?.kind ?? "person", name: c?.name ?? "", aliases: (c?.aliases ?? []).join("\n"), email: c?.email ?? "", phone: c?.phone ?? "",
    address: c?.address ?? "", notes: c?.notes ?? "", status: c?.status ?? "prospect",
  });
  const [error, setError] = useState("");
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <Modal title={c ? c.name : "New client"} onClose={onClose} wide>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const out = await api<{ id: string }>(c ? `/api/clients/${c.id}` : "/api/clients", { method: c ? "PATCH" : "POST", json: v });
            onSaved(out.id);
          } catch (x) {
            setError((x as Error).message);
          }
        }}
      >
        <div className="row3">
          <label><span>Name</span><input value={v.name} onChange={set("name")} required /></label>
          <label><span>Kind</span><select value={v.kind} onChange={set("kind")}><option value="person">Person</option><option value="organization">Organization</option></select></label>
          <label><span>Status</span><select value={v.status} onChange={set("status")}>{Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        </div>
        <div className="row2">
          <label><span>Email</span><input type="email" value={v.email} onChange={set("email")} /></label>
          <label><span>Phone</span><input value={v.phone} onChange={set("phone")} /></label>
        </div>
        <label><span>Address</span><input value={v.address} onChange={set("address")} /></label>
        <label><span>Other names, one per line (maiden names, trade names, subsidiaries): conflict checks look for these too</span><textarea rows={3} value={v.aliases} onChange={set("aliases")} /></label>
        <label><span>Notes</span><textarea rows={3} value={v.notes} onChange={set("notes")} /></label>
        <p className="error">{error}</p>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Save</button></div>
      </form>
    </Modal>
  );
}

export function ClientsView({ go }: { info: AppInfo; go: Go }) {
  const [rows, setRows] = useState<Client[] | null>(null);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const t = setTimeout(() => api<Client[]>(`/api/clients?q=${encodeURIComponent(q)}`).then(setRows).catch((e) => setError((e as Error).message)), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Clients</h1>
          <p className="sub muted">The firm&apos;s clients and prospects. Matter details stay with the people on each matter.</p>
        </div>
        <button className="btn" onClick={() => setCreating(true)}><Plus size={16} /> New client</button>
      </div>
      <div className="body">
        <div className="toolbar">
          <label className="searchbox"><Search size={15} /><input placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        </div>
        {error && <p className="error">{error}</p>}
        {!rows ? <p className="muted">Loading…</p> : !rows.length ? <div className="empty">No clients.</div> : (
          <div className="tablewrap">
            <table className="grid">
              <thead><tr><th>Name</th><th>Email</th><th>Status</th><th className="num">Matters</th></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="click" onClick={() => go.client(c.id)}>
                    <td>{c.name}{c.aliases.length > 0 && <div className="muted small">also {c.aliases.join(", ")}</div>}</td>
                    <td>{c.email}</td>
                    <td>{STATUS[c.status]}</td>
                    <td className="num">{c.matters}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && <ClientDialog c={null} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); go.client(id); }} />}
    </>
  );
}

export function ClientView({ id, info, go }: { id: string; info: AppInfo; go: Go }) {
  const [c, setC] = useState<(Client & { matters: MatterSummary[]; hiddenMatters: number; trustCents: number }) | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const load = () => api<typeof c>(`/api/clients/${id}`).then(setC).catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (error) return <p className="pad error">{error}</p>;
  if (!c) return <p className="pad muted">Loading…</p>;
  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>{c.name}</h1>
          <p className="sub muted">{STATUS[c.status]} · {c.kind === "organization" ? "Organization" : "Person"}{c.email && ` · ${c.email}`}{c.phone && ` · ${c.phone}`}</p>
        </div>
        <button className="btn" onClick={() => setEditing(true)}>Edit</button>
        {info.admin && c.matters.length === 0 && c.hiddenMatters === 0 && (
          <button className="btn" onClick={async () => { if (confirm(`Remove ${c.name}?`)) { try { await api(`/api/clients/${id}`, { method: "DELETE" }); go.page("clients"); } catch (x) { setError((x as Error).message); } } }}>Remove</button>
        )}
      </div>
      <div className="body">
        <div className="kpis">
          <div className="kpi"><span className="muted">Held in trust for them</span><b>{money(c.trustCents)}</b></div>
          <div className="kpi"><span className="muted">Matters</span><b>{c.matters.length + c.hiddenMatters}</b></div>
        </div>
        {c.address && <p>{c.address}</p>}
        {c.aliases.length > 0 && <p className="muted">Also known as {c.aliases.join(", ")}</p>}
        {c.notes && <p className="prewrap">{c.notes}</p>}
        <section>
          <h2>Matters</h2>
          {c.matters.length ? <MatterTable rows={c.matters} go={go} /> : <p className="muted">None you are on.</p>}
          {c.hiddenMatters > 0 && <p className="muted small">{c.hiddenMatters} other {c.hiddenMatters === 1 ? "matter you aren't on" : "matters you aren't on"}.</p>}
        </section>
        <p className="muted small">Added by {person(c.created_by, info.email)}.</p>
      </div>
      {editing && <ClientDialog c={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void load(); }} />}
    </>
  );
}
