"use client";
import { Clock, MapPin, Phone, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { PublicPage } from "@/lib/pages";
import { COLOR_HEX, type Slot, api, browserZone, minutesLabel, whenIn, zoneLabel } from "./client";
import { SlotPicker } from "./SlotPicker";

type Service = PublicPage["services"][number];

export function LocationLine({ kind, location }: { kind: string; location: string }) {
  if (kind === "meet") return <span className="loc"><Video size={14} /> Online meeting (Synergy Meet)</span>;
  if (kind === "phone") return <span className="loc"><Phone size={14} /> Phone call</span>;
  return location ? <span className="loc"><MapPin size={14} /> {location}</span> : null;
}

/** The customer's side: pick a service, a person (if the page lets them), a time, then fill in details. */
export function BookingFlow({ page, serviceId, embed }: { page: PublicPage; serviceId?: string; embed?: boolean }) {
  const [service, setService] = useState<Service | null>(page.services.find((s) => s.id === serviceId) ?? (page.services.length === 1 ? page.services[0] : null));
  const [staffId, setStaffId] = useState("");
  const [zone, setZone] = useState(page.timeZone);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => setZone(browserZone()), []);
  useEffect(() => setSlot(null), [service, staffId]);

  const load = useCallback(
    (from: string, to: string) => api<Slot[]>(`/api/public/pages/${page.slug}/slots?${new URLSearchParams({ service: service!.id, from, to, ...(staffId ? { staff: staffId } : {}) })}`),
    [page.slug, service, staffId],
  );

  const staff = service ? page.staff.filter((s) => service.staffIds.includes(s.id)) : [];

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!service || !slot) return;
    const f = new FormData(e.currentTarget);
    const answers: Record<string, string> = {};
    for (const qn of service.questions) answers[qn.id] = String(f.get(`q_${qn.id}`) ?? "");
    setBusy(true);
    setError("");
    try {
      const r = await api<{ token: string | null }>(`/api/public/pages/${page.slug}/book`, {
        method: "POST",
        json: {
          serviceId: service.id, staffId: staffId || undefined, start: slot.start,
          name: f.get("name"), email: f.get("email"), phone: f.get("phone"), notes: f.get("notes"), answers, website: f.get("website"),
        },
      });
      if (r.token) window.location.href = `/booking/${r.token}?new=1`;
    } catch (x) {
      setError((x as Error).message);
      if (/taken/.test((x as Error).message)) setSlot(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`pub${embed ? " embed" : ""}`} style={{ "--c": COLOR_HEX[page.color] ?? COLOR_HEX.blue } as React.CSSProperties}>
      {!embed && <div className="band" />}
      <div className="pubwrap">
        {!embed && (
          <header className="pubhead">
            <h1>{page.name}</h1>
            {page.description && <p className="muted">{page.description}</p>}
            {(page.address || page.phone) && <p className="small muted">{[page.address, page.phone].filter(Boolean).join(" · ")}</p>}
          </header>
        )}

        <section className="panel">
          <h2>Choose a service</h2>
          {!page.services.length && <p className="muted">There is nothing to book here yet.</p>}
          <div className="services">
            {page.services.map((s) => (
              <button key={s.id} className={`svc${service?.id === s.id ? " on" : ""}`} onClick={() => setService(s)} aria-pressed={service?.id === s.id}>
                <div className="grow">
                  <b>{s.name}</b>
                  {s.description && <p className="small muted">{s.description}</p>}
                  <LocationLine kind={s.locationKind} location={s.location} />
                </div>
                <span className="tzline"><Clock size={14} /> {minutesLabel(s.durationMin)}</span>
                {s.price && <span className="badge">{s.price}</span>}
              </button>
            ))}
          </div>
        </section>

        {service && page.chooseStaff && staff.length > 1 && (
          <section className="panel">
            <h2>Who would you like to see?</h2>
            <div className="toolbar">
              <button className={`btn${staffId === "" ? " primary" : ""}`} onClick={() => setStaffId("")}>Anyone</button>
              {staff.map((s) => (
                <button key={s.id} className={`btn${staffId === s.id ? " primary" : ""}`} onClick={() => setStaffId(s.id)}>{s.name}</button>
              ))}
            </div>
          </section>
        )}

        {service && (
          <SlotPicker load={load} pageZone={page.timeZone} maxDaysAhead={page.maxDaysAhead} zone={zone} onZone={setZone}
            value={slot?.start ?? null} onPick={setSlot} />
        )}

        {service && slot && (
          <form className="panel form" onSubmit={submit} style={{ padding: "18px 20px" }}>
            <h2>Your details</h2>
            <p className="muted">{service.name}, {whenIn(slot.start, zone)} ({zoneLabel(zone)}), {minutesLabel(service.durationMin)}</p>
            <div className="row2">
              <label><span>Name</span><input name="name" required autoComplete="name" maxLength={200} /></label>
              <label><span>Email</span><input name="email" type="email" required autoComplete="email" maxLength={254} /></label>
            </div>
            <label><span>Phone (optional)</span><input name="phone" type="tel" autoComplete="tel" maxLength={50} /></label>
            {service.questions.map((qn) => (
              <label key={qn.id}><span>{qn.label}{qn.required ? "" : " (optional)"}</span><input name={`q_${qn.id}`} required={qn.required} maxLength={2000} /></label>
            ))}
            <label><span>Anything we should know? (optional)</span><textarea name="notes" maxLength={4000} /></label>
            <label className="hp" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
            <p className="error" role="alert">{error}</p>
            <div className="actions">
              <button className="btn primary" disabled={busy}>{busy ? "Booking…" : "Book"}</button>
            </div>
          </form>
        )}
        {error && !slot && <p className="error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
