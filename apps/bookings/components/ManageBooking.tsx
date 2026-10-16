"use client";
import { CalendarCheck, CalendarX, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { CustomerView } from "@/lib/appointments";
import { COLOR_HEX, type Slot, api, browserZone, timeIn, whenIn, zoneLabel } from "./client";
import { SlotPicker } from "./SlotPicker";

/** The customer's page for one appointment: join, move or cancel it. */
export function ManageBooking({ token, initial }: { token: string; initial: CustomerView }) {
  const [view, setView] = useState(initial);
  const [zone, setZone] = useState(initial.page.timeZone);
  const [mode, setMode] = useState<"" | "move" | "cancel">("");
  const [slot, setSlot] = useState<Slot | null>(null);
  const [error, setError] = useState("");
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setZone(browserZone());
    setIsNew(new URLSearchParams(window.location.search).get("new") === "1");
  }, []);

  const load = useCallback((from: string, to: string) => api<Slot[]>(`/api/public/bookings/${token}/slots?${new URLSearchParams({ from, to })}`), [token]);

  async function act(path: string, json: unknown, method = "POST") {
    setBusy(true);
    setError("");
    try {
      setView(await api<CustomerView>(path, { method, json }));
      setMode("");
      setSlot(null);
      setIsNew(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const cancelled = view.status === "cancelled";
  return (
    <div className="pub" style={{ "--c": COLOR_HEX[view.page.color] ?? COLOR_HEX.blue } as React.CSSProperties}>
      <div className="band" />
      <div className="pubwrap">
        <section className="panel done">
          {cancelled ? <CalendarX size={36} color="var(--danger)" /> : <CalendarCheck size={36} color="var(--c)" />}
          <h2>{cancelled ? "This appointment is cancelled" : isNew ? "You're booked" : "Your appointment"}</h2>
          {isNew && !cancelled && <p className="muted">We&apos;ve emailed a confirmation to {view.customerEmail}.</p>}
          <p>
            <b>{view.serviceName}</b> with {view.staffName} at {view.page.name}<br />
            {whenIn(view.start, zone)} to {timeIn(view.end, zone)} ({zoneLabel(zone)})
          </p>
          {!cancelled && view.joinUrl && (
            <a className="btn primary" href={view.joinUrl} target="_blank" rel="noreferrer"><Video size={16} /> Join the online meeting</a>
          )}
          {!cancelled && !view.joinUrl && view.location && <p className="muted">{view.location}</p>}
          {!cancelled && (view.canChange ? (
            <div className="toolbar" style={{ justifyContent: "center" }}>
              {view.serviceId && <button className="btn" onClick={() => setMode(mode === "move" ? "" : "move")}>Change time</button>}
              <button className="btn" onClick={() => setMode(mode === "cancel" ? "" : "cancel")}>Cancel appointment</button>
            </div>
          ) : (
            <p className="small muted">It&apos;s too close to the start to change this online.{view.page.phone ? ` Call ${view.page.phone}.` : ""}</p>
          ))}
          {cancelled && <a className="btn primary" href={`/book/${view.page.slug}`}>Book again</a>}
        </section>

        {mode === "move" && (
          <>
            <SlotPicker load={load} pageZone={view.page.timeZone} maxDaysAhead={365} zone={zone} onZone={setZone} value={slot?.start ?? null} onPick={setSlot} />
            {slot && (
              <div className="panel">
                <p>Move to <b>{whenIn(slot.start, zone)}</b>?</p>
                <div className="actions">
                  <button className="btn" onClick={() => setSlot(null)}>Back</button>
                  <button className="btn primary" disabled={busy} onClick={() => act(`/api/public/bookings/${token}`, { start: slot.start }, "PATCH")}>Move it</button>
                </div>
              </div>
            )}
          </>
        )}

        {mode === "cancel" && (
          <form className="panel form" style={{ padding: "18px 20px" }} onSubmit={(e) => {
            e.preventDefault();
            void act(`/api/public/bookings/${token}/cancel`, { reason: new FormData(e.currentTarget).get("reason") });
          }}>
            <label><span>Reason (optional)</span><textarea name="reason" maxLength={1000} /></label>
            <div className="actions">
              <button type="button" className="btn" onClick={() => setMode("")}>Keep it</button>
              <button className="btn danger" disabled={busy}>Cancel appointment</button>
            </div>
          </form>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
