"use client";
import { Inbox, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { Ctx } from "./FieldApp";
import { Modal } from "./Modal";
import { type Customer, type WorkOrder, type WorkOrderDetail, KIND_LABEL, STATUS_LABEL, api, person, shortDate, when } from "./client";

const FILTERS: [string, string][] = [["open", "Open"], ["new", "New"], ["scheduled", "Scheduled"], ["in_progress", "In progress"], ["on_hold", "On hold"], ["completed", "Completed"], ["all", "All"]];

export function JobsView({ ctx }: { ctx: Ctx }) {
  const [filter, setFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<WorkOrder[] | null>(null);
  const [dialog, setDialog] = useState<"new" | "case" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const p = new URLSearchParams();
    if (filter === "open") p.set("open", "1");
    else if (filter !== "all") p.set("status", filter);
    if (search.trim()) p.set("q", search.trim());
    const t = setTimeout(() => {
      api<WorkOrder[]>(`/api/work-orders?${p}`).then(setRows, (e) => setError((e as Error).message));
    }, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [filter, search, ctx.version]);

  return (
    <>
      <div className="head">
        <h1>Work orders</h1>
        <div className="grow" />
        {ctx.status.links.desk && (
          <button className="btn" onClick={() => setDialog("case")}><Inbox size={16} /> From a Desk case</button>
        )}
        <button className="btn primary" onClick={() => setDialog("new")}><Plus size={16} /> New work order</button>
      </div>
      <div className="tabs">
        {FILTERS.map(([id, label]) => (
          <button key={id} className={`tab${filter === id ? " on" : ""}`} onClick={() => setFilter(id)}>{label}</button>
        ))}
      </div>
      <div className="body">
        <div className="toolbar">
          <label className="searchbox"><Search size={15} /><input placeholder="Search number, job, customer, address or case" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        </div>
        <p className="error" role="alert">{error}</p>
        {!rows ? (
          <p className="muted">Loading…</p>
        ) : !rows.length ? (
          <p className="empty">No work orders here.</p>
        ) : (
          <div className="tablewrap">
            <table className="grid">
              <thead>
                <tr><th>Number</th><th>Job</th><th>Customer</th><th>Status</th><th>Priority</th><th>Next visit</th><th>Due</th></tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.id} className="click" onClick={() => ctx.openJob(w.id)}>
                    <td><b>{w.number}</b></td>
                    <td>{w.title}<div className="small muted">{KIND_LABEL[w.kind]}{w.deskTicket ? ` · case ${w.deskTicket}` : ""}</div></td>
                    <td>{w.customerName}{w.assetName && <div className="small muted">{w.assetName}</div>}</td>
                    <td><span className={`pill ${w.status}`}>{STATUS_LABEL[w.status]}</span>{w.invoiceStatus !== "none" && <span className="pill billed">billed</span>}</td>
                    <td><span className={`pill ${w.priority}`}>{w.priority}</span></td>
                    <td className="small">{w.nextVisit ? <>{when(w.nextVisit.startsAt)}<div className="muted">{person(w.nextVisit.technician, ctx.staff)}</div></> : <span className="muted">None</span>}</td>
                    <td className="small">{shortDate(w.dueDay)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {dialog === "new" && <NewWorkOrder ctx={ctx} onClose={() => setDialog(null)} />}
      {dialog === "case" && <FromCase ctx={ctx} onClose={() => setDialog(null)} />}
    </>
  );
}

/** A customer search box that settles on one customer. */
export function CustomerPicker({ value, onChange }: { value: Customer | null; onChange: (c: Customer | null) => void }) {
  const [text, setText] = useState(value?.name ?? "");
  const [hits, setHits] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      api<Customer[]>(`/api/customers?q=${encodeURIComponent(text)}`).then((r) => setHits(r.slice(0, 8)), () => setHits([]));
    }, 200);
    return () => clearTimeout(t);
  }, [text, open]);
  return (
    <div className="picker">
      <input
        value={text}
        placeholder="Search customers"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setText(e.target.value);
          if (value) onChange(null);
        }}
      />
      {open && hits.length > 0 && (
        <div className="menu">
          {hits.map((c) => (
            <button type="button" key={c.id} onMouseDown={() => { onChange(c); setText(c.name); setOpen(false); }}>
              <b>{c.name}</b> <span className="small muted">{c.address || c.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function NewWorkOrder({ ctx, onClose, customer: initial, assetId: initialAsset }: { ctx: Ctx; onClose: () => void; customer?: Customer | null; assetId?: string }) {
  const [customer, setCustomer] = useState<Customer | null>(initial ?? null);
  const [assets, setAssets] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!customer) return setAssets([]);
    api<Customer & { assets: { id: string; name: string }[] }>(`/api/customers/${customer.id}`).then((c) => setAssets(c.assets), () => setAssets([]));
  }, [customer]);
  const skills = [...new Set(ctx.staff.flatMap((s) => s.skills))].sort();
  return (
    <Modal title="New work order" onClose={onClose} wide>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget));
          try {
            const w = await api<WorkOrderDetail>("/api/work-orders", { method: "POST", json: { ...f, customerId: customer?.id, billable: f.billable === "on" } });
            ctx.changed();
            onClose();
            ctx.openJob(w.id);
          } catch (x) {
            setError((x as Error).message);
          }
        }}
      >
        <label><span>Customer</span><CustomerPicker value={customer} onChange={setCustomer} /></label>
        <label><span>Job</span><input name="title" required autoFocus placeholder="What needs doing" /></label>
        <label><span>Details</span><textarea name="description" /></label>
        <div className="row3">
          <label><span>Kind</span><select name="kind" defaultValue="repair">{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label><span>Priority</span><select name="priority" defaultValue="normal">{["low", "normal", "high", "urgent"].map((p) => <option key={p}>{p}</option>)}</select></label>
          <label><span>Estimate (hours)</span><input name="estimateHours" defaultValue="1" /></label>
        </div>
        <div className="row3">
          <label><span>Equipment</span><select name="assetId" defaultValue={initialAsset ?? ""}><option value="">None</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label><span>Skill needed</span><input name="skill" list="skills" placeholder="Any" /><datalist id="skills">{skills.map((s) => <option key={s} value={s} />)}</datalist></label>
          <label><span>Due</span><input name="dueDay" type="date" /></label>
        </div>
        <label><span>Service address</span><input name="address" placeholder={customer?.address || "The customer's address"} /></label>
        <label className="check"><input type="checkbox" name="billable" defaultChecked /> Bill the customer for this job</label>
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!customer}>Create</button>
        </div>
      </form>
    </Modal>
  );
}

type Ticket = { number: string; subject: string; status: string; priority: string; requesterEmail: string; requesterName: string; firstMessage: string };

function FromCase({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const [number, setNumber] = useState("");
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState("");
  const [again, setAgain] = useState(false);
  return (
    <Modal title="Work order from a Desk case" onClose={onClose} wide>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            if (!ticket) {
              setTicket(await api<Ticket>(`/api/desk/tickets/${encodeURIComponent(number.trim())}`));
              return;
            }
            const f = Object.fromEntries(new FormData(e.currentTarget));
            const w = await api<WorkOrderDetail>("/api/work-orders/from-case", { method: "POST", json: { ...f, number: ticket.number, again } });
            ctx.changed();
            onClose();
            ctx.openJob(w.id);
          } catch (x) {
            const err = x as Error & { status?: number };
            if (err.status === 409) setAgain(true);
            setError(err.message);
          }
        }}
      >
        <label><span>Case number</span><input value={number} autoFocus placeholder="T-2026-0042" onChange={(e) => { setNumber(e.target.value); setTicket(null); setAgain(false); }} /></label>
        {ticket && (
          <>
            <div className="casebox">
              <b>{ticket.subject}</b>
              <div className="small muted">{ticket.requesterName || ticket.requesterEmail} · {ticket.status} · {ticket.priority}</div>
              {ticket.firstMessage && <p className="small clip">{ticket.firstMessage}</p>}
            </div>
            <div className="row3">
              <label><span>Kind</span><select name="kind" defaultValue="repair">{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label><span>Estimate (hours)</span><input name="estimateHours" defaultValue="1" /></label>
              <label><span>Skill needed</span><input name="skill" placeholder="Any" /></label>
            </div>
            <p className="small muted">The work order goes to the customer with the requester&apos;s email, or a new customer if there isn&apos;t one. The case gets a note when a technician is booked and when the job is done.</p>
          </>
        )}
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!number.trim()}>{!ticket ? "Look up" : again ? "Open another work order" : "Create work order"}</button>
        </div>
      </form>
    </Modal>
  );
}
