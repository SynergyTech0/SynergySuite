"use client";
import { ArrowLeft, Car, ChevronLeft, ChevronRight, Flag, MapPin, Phone, PlayCircle, Check } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Checklist, CompleteDialog, Parts, Timeline } from "./JobParts";
import {
  type BoardBooking, type Role, type Staff, type Status, type WorkOrderDetail, STATUS_LABEL, api, dayStart, dayStr, longDay, mapsUrl, time, when,
} from "./client";

type Visit = BoardBooking & { contactName: string; contactPhone: string };

/**
 * The technician's phone: today's visits in order, then each job with big buttons to move the
 * visit along, its steps, parts, photos and notes, and sign-off on the customer's screen.
 */
export function TechApp({ me, role }: { me: { email: string; name: string }; role: Role }) {
  const [day, setDay] = useState(dayStr());
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [job, setJob] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api<{ visits: Visit[] }>(`/api/my-visits?from=${encodeURIComponent(dayStart(day).toISOString())}&to=${encodeURIComponent(dayStart(day, 1).toISOString())}`);
      setVisits(r.visits);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [day]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    api<Status>("/api/status").then(setStatus, () => {});
    api<Staff[]>("/api/staff").then(setStaff, () => {});
    const p = new URLSearchParams(window.location.search);
    if (p.get("job")) setJob(p.get("job"));
  }, []);

  if (job) return <TechJob id={job} me={me.email} staff={staff} status={status} onBack={() => { setJob(null); void load(); }} />;

  return (
    <div className="tech">
      <div className="techhead">
        <button className="iconbtn" aria-label="Previous day" onClick={() => setDay(dayStr(dayStart(day, -1)))}><ChevronLeft size={20} /></button>
        <div className="grow center">
          <b>{day === dayStr() ? "Today" : longDay(day)}</b>
          {day !== dayStr() && <button className="btn small ghost" onClick={() => setDay(dayStr())}>Back to today</button>}
        </div>
        <button className="iconbtn" aria-label="Next day" onClick={() => setDay(dayStr(dayStart(day, 1)))}><ChevronRight size={20} /></button>
      </div>
      {role === "dispatcher" && <p className="small muted center">This is the technician view. <a href="/">Back to the board</a></p>}
      <p className="error pad" role="alert">{error}</p>
      {!visits ? <p className="pad muted">Loading…</p> : !visits.length ? <p className="empty">No visits booked{day === dayStr() ? " today" : ""}.</p> : (
        <ul className="visits">
          {visits.map((v) => (
            <li key={v.id}>
              <button className={`visit st-${v.status} p-${v.priority}`} onClick={() => setJob(v.workOrderId)}>
                <div className="vtime">{time(v.startsAt)}<span className="small">{time(v.endsAt)}</span></div>
                <div className="grow">
                  <b>{v.customerName}</b>
                  <div>{v.title}</div>
                  <div className="small muted">{v.number} · {v.address}</div>
                </div>
                <span className={`pill ${v.status}`}>{STATUS_LABEL[v.status]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TechJob({ id, me, staff, status, onBack }: { id: string; me: string; staff: Staff[]; status: Status | null; onBack: () => void }) {
  const [wo, setWo] = useState<WorkOrderDetail | null>(null);
  const [error, setError] = useState("");
  const [completing, setCompleting] = useState(false);
  const reload = useCallback(async () => {
    try {
      setWo(await api<WorkOrderDetail>(`/api/work-orders/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    void reload();
  }, [reload]);
  if (!wo) return <div className="tech"><button className="btn ghost" onClick={onBack}><ArrowLeft size={16} /> My visits</button><p className="pad muted">{error || "Loading…"}</p></div>;

  const mine = wo.bookings.filter((b) => b.technician === me.toLowerCase() && b.status !== "cancelled" && b.status !== "done");
  const visit = mine.find((b) => b.status === "on_site" || b.status === "traveling") ?? mine[0];
  const open = wo.status !== "completed" && wo.status !== "cancelled";
  const step = async (s: "travel" | "arrive" | "finish") => {
    if (!visit) return;
    try {
      setError("");
      await api(`/api/bookings/${visit.id}/step`, { method: "POST", json: { step: s } });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="tech">
      <div className="techhead">
        <button className="btn ghost" onClick={onBack}><ArrowLeft size={16} /> My visits</button>
        <span className="grow" />
        <span className={`pill ${wo.status}`}>{STATUS_LABEL[wo.status]}</span>
      </div>
      <div className="techbody">
        <h1>{wo.customerName}</h1>
        <p>{wo.title} <span className="small muted">{wo.number}</span></p>
        <div className="bigrow">
          {wo.address && <a className="btn" href={mapsUrl(wo.address)} target="_blank" rel="noreferrer"><MapPin size={16} /> Map</a>}
          {wo.contactPhone && <a className="btn" href={`tel:${wo.contactPhone}`}><Phone size={16} /> {wo.contactName || "Call"}</a>}
        </div>
        <p className="small muted">{wo.address}</p>
        {wo.asset && (
          <div className="casebox">
            <b>{wo.asset.name}</b> <span className="small muted">{[wo.asset.make, wo.asset.model, wo.asset.serial && `SN ${wo.asset.serial}`].filter(Boolean).join(" ")}</span>
            {wo.asset.location && <div className="small">{wo.asset.location}</div>}
            {wo.asset.underWarranty && <div className="small ok">Under warranty</div>}
          </div>
        )}
        {wo.description && <p className="prewrap">{wo.description}</p>}

        {open && visit && (
          <div className="stepbar">
            {visit.status === "scheduled" && <button className="btn big" onClick={() => void step("travel")}><Car size={18} /> On my way</button>}
            {(visit.status === "scheduled" || visit.status === "traveling") && <button className="btn big primary" onClick={() => void step("arrive")}><PlayCircle size={18} /> Arrived</button>}
            {visit.status === "on_site" && (
              <>
                <span className="small muted grow">On site since {time(visit.arrivedAt)}</span>
                <button className="btn big" onClick={() => void step("finish")}><Flag size={18} /> Leave, not done</button>
              </>
            )}
          </div>
        )}
        {open && !visit && <p className="small muted">You have no visit booked on this job.</p>}
        {!open && wo.completedAt && <p className="ok">Completed {when(wo.completedAt)}{wo.signedBy ? `, signed off by ${wo.signedBy}` : ""}.</p>}
        <p className="error" role="alert">{error}</p>

        <Checklist wo={wo} reload={reload} />
        <Parts wo={wo} reload={reload} commerce={!!status?.links.commerce} currency={status?.settings.currency ?? "USD"} />
        <Timeline wo={wo} reload={reload} me={me} staff={staff} />
        {open && (
          <div className="stepbar sticky">
            <button className="btn big primary grow" onClick={() => setCompleting(true)}><Check size={18} /> Complete job</button>
          </div>
        )}
      </div>
      {completing && <CompleteDialog wo={wo} onClose={() => setCompleting(false)} onDone={reload} />}
    </div>
  );
}
