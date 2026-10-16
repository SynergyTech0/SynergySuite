"use client";
import { CalendarPlus, Check, ExternalLink, MapPin, Receipt, Trash2, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Ctx } from "./FieldApp";
import { Checklist, CompleteDialog, Parts, Timeline } from "./JobParts";
import { Confirm } from "./Modal";
import {
  type Invoice, type Suggestion, type WorkOrderDetail, KIND_LABEL, STATUS_LABEL, api, dayStr, fromLocalInput, hrs, mapsUrl, money, person,
  shortDate, time, toLocalInput, when,
} from "./client";

type Tab = "details" | "schedule" | "work" | "timeline" | "billing";

/** A work order, side by side with whatever the dispatcher was looking at. */
export function WorkOrderPanel({ ctx, id, onClose }: { ctx: Ctx; id: string; onClose: () => void }) {
  const [wo, setWo] = useState<WorkOrderDetail | null>(null);
  const [tab, setTab] = useState<Tab>("details");
  const [error, setError] = useState("");
  const [completing, setCompleting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(async () => {
    try {
      setWo(await api<WorkOrderDetail>(`/api/work-orders/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    setWo(null);
    setTab("details");
    void reload();
  }, [reload]);

  const changed = async () => {
    await reload();
    ctx.changed();
  };
  const patch = async (json: Record<string, unknown>) => {
    try {
      setError("");
      setWo(await api<WorkOrderDetail>(`/api/work-orders/${id}`, { method: "PATCH", json }));
      ctx.changed();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const open = wo && wo.status !== "completed" && wo.status !== "cancelled";
  const currency = ctx.status.settings.currency;
  return (
    <aside className="wopanel" aria-label="Work order">
      <div className="modalhead">
        <h2>{wo ? `${wo.number} ${wo.title}` : "Work order"}</h2>
        <button className="iconbtn" aria-label="Close" onClick={onClose}><X size={18} /></button>
      </div>
      {!wo ? (
        <p className="pad muted">{error || "Loading…"}</p>
      ) : (
        <>
          <div className="toolbar padx">
            <span className={`pill ${wo.status}`}>{STATUS_LABEL[wo.status]}</span>
            <span className={`pill ${wo.priority}`}>{wo.priority}</span>
            {wo.invoiceStatus !== "none" && <span className="pill billed">billed</span>}
            <span className="grow" />
            {open && <button className="btn small primary" onClick={() => setCompleting(true)}><Check size={14} /> Complete</button>}
            {wo.status === "completed" && wo.invoiceStatus === "none" && wo.billable && <button className="btn small primary" onClick={() => setTab("billing")}><Receipt size={14} /> Bill</button>}
            {wo.invoiceStatus === "none" && !wo.labor.length && !wo.parts.length && (
              <button className="iconbtn" aria-label="Delete work order" onClick={() => setDeleting(true)}><Trash2 size={16} /></button>
            )}
          </div>
          <div className="tabs padx">
            {(["details", "schedule", "work", "timeline", "billing"] as Tab[]).map((t) => (
              <button key={t} className={`tab${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
            ))}
          </div>
          <p className="error padx" role="alert">{error}</p>
          <div className="panelbody">
            {tab === "details" && <Details wo={wo} ctx={ctx} patch={patch} />}
            {tab === "schedule" && <Schedule wo={wo} ctx={ctx} reload={changed} />}
            {tab === "work" && (
              <>
                <Checklist wo={wo} reload={reload} canDraft={ctx.status.ai} />
                <Parts wo={wo} reload={reload} commerce={ctx.status.links.commerce} currency={currency} />
                <LaborTable wo={wo} ctx={ctx} reload={reload} />
              </>
            )}
            {tab === "timeline" && <Timeline wo={wo} reload={reload} me={ctx.me.email} staff={ctx.staff} />}
            {tab === "billing" && <Billing wo={wo} ctx={ctx} reload={changed} />}
          </div>
        </>
      )}
      {completing && wo && <CompleteDialog wo={wo} onClose={() => setCompleting(false)} onDone={changed} />}
      {deleting && wo && (
        <Confirm
          title={`Delete ${wo.number}?`}
          message="The work order and its visits are removed. Use Cancelled instead to keep it on record."
          action="Delete"
          danger
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            try {
              await api(`/api/work-orders/${wo.id}`, { method: "DELETE" });
              ctx.changed();
              onClose();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      )}
    </aside>
  );
}

function Details({ wo, ctx, patch }: { wo: WorkOrderDetail; ctx: Ctx; patch: (j: Record<string, unknown>) => Promise<void> }) {
  const [edit, setEdit] = useState(false);
  return (
    <>
      <dl className="facts">
        <dt>Customer</dt><dd>{wo.customerName}{wo.customerEmail && <div className="small muted">{wo.customerEmail}</div>}</dd>
        <dt>Where</dt><dd>{wo.address ? <a href={mapsUrl(wo.address)} target="_blank" rel="noreferrer"><MapPin size={13} /> {wo.address}</a> : <span className="muted">No address</span>}</dd>
        <dt>Contact</dt><dd>{wo.contactName} {wo.contactPhone && <a href={`tel:${wo.contactPhone}`}>{wo.contactPhone}</a>}</dd>
        <dt>Equipment</dt>
        <dd>
          {wo.asset ? (
            <>
              {wo.asset.name} <span className="small muted">{[wo.asset.make, wo.asset.model, wo.asset.serial && `SN ${wo.asset.serial}`].filter(Boolean).join(" ")}</span>
              {wo.asset.underWarranty && <span className="pill active">under warranty to {shortDate(wo.asset.warrantyUntil)}</span>}
              {wo.asset.opsTag && <span className="pill">Ops {wo.asset.opsTag}</span>}
            </>
          ) : <span className="muted">None</span>}
        </dd>
        <dt>Kind</dt><dd>{KIND_LABEL[wo.kind]}{wo.skill && <> · needs <b>{wo.skill}</b></>} · {hrs(wo.estimateMinutes)} h estimated</dd>
        <dt>Due</dt><dd>{wo.dueDay ? shortDate(wo.dueDay) : <span className="muted">No date</span>}</dd>
        {wo.deskTicket && (
          <>
            <dt>Desk case</dt>
            <dd><a href={`${ctx.status.urls.desk}/?q=${encodeURIComponent(wo.deskTicket)}`} target="_blank" rel="noreferrer">{wo.deskTicket} <ExternalLink size={12} /></a></dd>
          </>
        )}
        {wo.completedAt && (
          <>
            <dt>Completed</dt>
            <dd>{when(wo.completedAt)} by {person(wo.completedBy ?? "", ctx.staff, ctx.me.email)}{wo.signedBy && <>, signed off by {wo.signedBy}</>}</dd>
            <dt>Resolution</dt><dd className="prewrap">{wo.resolution}</dd>
          </>
        )}
      </dl>
      {wo.signature && <img className="sigimg" src={wo.signature} alt={`Signature of ${wo.signedBy}`} />}
      {wo.description && <p className="prewrap">{wo.description}</p>}
      <div className="toolbar">
        <label className="small">Status{" "}
          <select className="cellin" value={wo.status} onChange={(e) => void patch({ status: e.target.value })}>
            {["new", "scheduled", "in_progress", "on_hold", "completed", "cancelled"].map((k) => (
              <option key={k} value={k} disabled={k === "completed"}>{STATUS_LABEL[k]}</option>
            ))}
          </select>
        </label>
        <button className="btn small" onClick={() => setEdit(!edit)}>{edit ? "Close" : "Edit details"}</button>
      </div>
      {edit && (
        <form className="form flush" onSubmit={async (e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget));
          await patch({ ...f, billable: f.billable === "on", assetId: f.assetId || null });
          setEdit(false);
        }}>
          <label><span>Job</span><input name="title" defaultValue={wo.title} /></label>
          <label><span>Details</span><textarea name="description" defaultValue={wo.description} /></label>
          <div className="row3">
            <label><span>Kind</span><select name="kind" defaultValue={wo.kind}>{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label><span>Priority</span><select name="priority" defaultValue={wo.priority}>{["low", "normal", "high", "urgent"].map((p) => <option key={p}>{p}</option>)}</select></label>
            <label><span>Estimate (hours)</span><input name="estimateHours" defaultValue={hrs(wo.estimateMinutes)} /></label>
          </div>
          <div className="row3">
            <label><span>Skill needed</span><input name="skill" defaultValue={wo.skill} /></label>
            <label><span>Due</span><input name="dueDay" type="date" defaultValue={wo.dueDay ?? ""} /></label>
            <AssetSelect customerId={wo.customerId} value={wo.assetId} />
          </div>
          <label><span>Service address</span><input name="address" defaultValue={wo.address} /></label>
          <div className="row2">
            <label><span>Contact</span><input name="contactName" defaultValue={wo.contactName} /></label>
            <label><span>Phone</span><input name="contactPhone" defaultValue={wo.contactPhone} /></label>
          </div>
          <label className="check"><input type="checkbox" name="billable" defaultChecked={wo.billable} /> Bill the customer for this job</label>
          <div className="actions"><button className="btn primary">Save</button></div>
        </form>
      )}
    </>
  );
}

function AssetSelect({ customerId, value }: { customerId: string; value: string | null }) {
  const [assets, setAssets] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    api<{ assets: { id: string; name: string }[] }>(`/api/customers/${customerId}`).then((c) => setAssets(c.assets), () => setAssets([]));
  }, [customerId]);
  return (
    <label><span>Equipment</span>
      <select name="assetId" defaultValue={value ?? ""} key={assets.length}>
        <option value="">None</option>
        {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </label>
  );
}

function Schedule({ wo, ctx, reload }: { wo: WorkOrderDetail; ctx: Ctx; reload: () => Promise<void> }) {
  const techs = ctx.staff.filter((s) => s.role === "technician" && s.active);
  const [tech, setTech] = useState(techs[0]?.email ?? "");
  const [start, setStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return toLocalInput(d.toISOString());
  });
  const [hours, setHours] = useState(hrs(wo.estimateMinutes));
  const [day, setDay] = useState(dayStr());
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState("");
  const open = wo.status !== "completed" && wo.status !== "cancelled";

  const book = async (technician: string, startIso: string, endIso: string) => {
    const json = { workOrderId: wo.id, technician, start: startIso, end: endIso };
    try {
      setError("");
      try {
        await api("/api/bookings", { method: "POST", json });
      } catch (e) {
        if ((e as { status?: number }).status === 409 && window.confirm((e as Error).message)) await api("/api/bookings", { method: "POST", json: { ...json, force: true } });
        else throw e;
      }
      setSuggestions(null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <section>
        <h3>Visits</h3>
        {!wo.bookings.length && <p className="small muted">Nobody is booked yet.</p>}
        <ul className="lines">
          {wo.bookings.map((b) => (
            <li key={b.id} className={b.status === "cancelled" ? "muted" : ""}>
              <span className="grow"><b>{person(b.technician, ctx.staff)}</b> {when(b.startsAt)} to {time(b.endsAt)}</span>
              <span className={`pill ${b.status}`}>{STATUS_LABEL[b.status]}</span>
              {(b.status === "scheduled" || b.status === "traveling") && (
                <button className="iconbtn small" aria-label="Cancel visit" onClick={async () => {
                  await api(`/api/bookings/${b.id}`, { method: "DELETE" }).catch((e) => setError((e as Error).message));
                  await reload();
                }}><X size={14} /></button>
              )}
            </li>
          ))}
        </ul>
      </section>
      {open && (
        <>
          <section>
            <h3>Book a technician</h3>
            <div className="form flush">
              <div className="row3">
                <label><span>Technician</span><select value={tech} onChange={(e) => setTech(e.target.value)}>{techs.map((t) => <option key={t.email} value={t.email}>{person(t.email, ctx.staff)}</option>)}</select></label>
                <label><span>Starts</span><input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
                <label><span>Hours</span><input value={hours} onChange={(e) => setHours(e.target.value)} /></label>
              </div>
              <div className="actions">
                <button className="btn primary" disabled={!tech || !start} onClick={() => {
                  const s = fromLocalInput(start);
                  const h = Number(hours) || wo.estimateMinutes / 60;
                  void book(tech, s, new Date(new Date(s).getTime() + h * 3_600_000).toISOString());
                }}><CalendarPlus size={16} /> Book</button>
              </div>
            </div>
          </section>
          <section>
            <h3>Who can go soonest</h3>
            <div className="toolbar">
              <label className="small">From <input type="date" className="cellin" value={day} onChange={(e) => setDay(e.target.value)} /></label>
              <button className="btn small" onClick={async () => {
                try {
                  setSuggestions(await api<Suggestion[]>(`/api/work-orders/${wo.id}/suggest?day=${day}`));
                } catch (e) {
                  setError((e as Error).message);
                }
              }}><Wand2 size={14} /> Suggest</button>
            </div>
            {suggestions && (
              suggestions.length ? (
                <ul className="lines">
                  {suggestions.slice(0, 6).map((s) => (
                    <li key={s.technician}>
                      <span className="grow"><b>{s.name || person(s.technician)}</b> {when(s.start)}{" "}
                        {wo.skill && (s.skillMatch ? <span className="pill active">has {wo.skill}</span> : <span className="pill on_hold">no {wo.skill}</span>)}
                        <span className="small muted"> {hrs(s.bookedMinutes)} h booked that day</span>
                      </span>
                      <button className="btn small" onClick={() => void book(s.technician, s.start, s.end)}>Book</button>
                    </li>
                  ))}
                </ul>
              ) : <p className="small muted">Nobody has a long enough gap that week.</p>
            )}
          </section>
        </>
      )}
      <p className="error" role="alert">{error}</p>
    </>
  );
}

function LaborTable({ wo, ctx, reload }: { wo: WorkOrderDetail; ctx: Ctx; reload: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const locked = wo.invoiceStatus !== "none";
  const currency = ctx.status.settings.currency;
  const run = async (f: () => Promise<unknown>) => {
    try {
      setError("");
      await f();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section>
      <h3>Time on site</h3>
      {!wo.labor.length && <p className="small muted">Time is recorded when a technician finishes a visit.</p>}
      {wo.labor.length > 0 && (
        <div className="tablewrap">
          <table className="grid">
            <thead><tr><th>Who</th><th>Day</th><th className="num">Hours</th><th className="num">Rate</th><th /></tr></thead>
            <tbody>
              {wo.labor.map((l) => (
                <tr key={l.id}>
                  <td>{person(l.technician, ctx.staff)}</td>
                  <td>{shortDate(l.day)}</td>
                  <td className="num">
                    {locked ? hrs(l.minutes) : (
                      <input className="cellin" style={{ width: 64, textAlign: "right" }} defaultValue={hrs(l.minutes)}
                        onBlur={(e) => e.target.value !== hrs(l.minutes) && run(() => api(`/api/work-orders/${wo.id}/labor/${l.id}`, { method: "PATCH", json: { hours: e.target.value } }))} />
                    )}
                  </td>
                  <td className="num">{money(l.rateCents, currency)}</td>
                  <td>{!locked && <button className="iconbtn small" aria-label="Remove time" onClick={() => run(() => api(`/api/work-orders/${wo.id}/labor/${l.id}`, { method: "DELETE" }))}><Trash2 size={14} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!locked && !adding && <button className="btn small" onClick={() => setAdding(true)}>Add time</button>}
      {adding && (
        <form className="addrow" onSubmit={(e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget));
          void run(async () => {
            await api(`/api/work-orders/${wo.id}/labor`, { method: "POST", json: f });
            setAdding(false);
          });
        }}>
          <select name="technician" className="cellin">{ctx.staff.filter((s) => s.role === "technician").map((t) => <option key={t.email} value={t.email}>{person(t.email, ctx.staff)}</option>)}</select>
          <input name="day" type="date" className="cellin" defaultValue={dayStr()} />
          <input name="hours" className="cellin" style={{ width: 64 }} placeholder="Hours" />
          <button className="btn small primary">Add</button>
          <button type="button" className="btn small" onClick={() => setAdding(false)}>Cancel</button>
        </form>
      )}
      <p className="error" role="alert">{error}</p>
    </section>
  );
}

function Billing({ wo, ctx, reload }: { wo: WorkOrderDetail; ctx: Ctx; reload: () => Promise<void> }) {
  const [inv, setInv] = useState<Invoice | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Invoice>(`/api/work-orders/${wo.id}/invoice`).then(setInv, (e) => setError((e as Error).message));
  }, [wo.id, wo.modifiedAt, wo.labor.length, wo.parts.length]);
  if (!inv) return <p className="muted">{error || "Loading…"}</p>;
  return (
    <section>
      {inv.status === "sent" && <p className="ok">Sent to Books as draft invoice {inv.booksNumber}. Review and send it from <a href={inv.booksUrl} target="_blank" rel="noreferrer">Books</a>.</p>}
      {inv.status === "recorded" && <p className="ok">Billed. Books isn&apos;t linked, so copy these lines into your invoice.</p>}
      {inv.status === "none" && !inv.billable && <p className="muted">This job is marked not billable.</p>}
      {inv.status === "none" && inv.warranty && <p className="warn">The equipment is under warranty. Check what the customer should pay before billing.</p>}
      <div className="tablewrap">
        <table className="grid">
          <thead><tr><th>Line</th><th className="num">Qty</th><th className="num">Each</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {inv.lines.map((l, i) => (
              <tr key={i}><td>{l.description}</td><td className="num">{l.quantity}</td><td className="num">{money(l.unitCents, inv.currency)}</td><td className="num">{money(l.amountCents, inv.currency)}</td></tr>
            ))}
            {!inv.lines.length && <tr><td colSpan={4} className="muted">Nothing to bill yet.</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={3}>Total</td><td className="num">{money(inv.totalCents, inv.currency)}</td></tr></tfoot>
        </table>
      </div>
      <p className="small muted">Labor is the time on site at each technician&apos;s rate. Parts are at their catalog price.</p>
      {inv.status === "none" && inv.billable && (
        <div className="actions">
          <button className="btn primary" disabled={busy || wo.status !== "completed" || !inv.lines.length} onClick={async () => {
            setBusy(true);
            try {
              setInv(await api<Invoice>(`/api/work-orders/${wo.id}/invoice`, { method: "POST", json: {} }));
              await reload();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}><Receipt size={16} /> {inv.booksLinked ? "Send to Books as a draft invoice" : "Mark billed"}</button>
        </div>
      )}
      {wo.status !== "completed" && inv.status === "none" && <p className="small muted">Complete the job to bill it.</p>}
      <p className="error" role="alert">{error}</p>
    </section>
  );
}
