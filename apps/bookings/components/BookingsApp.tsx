"use client";
import {
  CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Copy, ExternalLink, Globe, Mail, Plus, Search, Settings, Trash2,
  Users, UserRound, Video, Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Appointment, Customer } from "@/lib/appointments";
import type { Page, Service, Staff } from "@/lib/pages";
import type { WeekHours } from "@/lib/time";
import { COLOR_HEX, addDays, api, browserZone, dayKey, localInput, longDay, minutesLabel, timeIn, whenIn, zoneLabel, zones } from "./client";
import { HoursEditor } from "./HoursEditor";
import { Confirm, Modal } from "./Modal";

type Me = { email: string; name: string };
type Tab = "calendar" | "customers" | "services" | "staff" | "settings";
type View = { tab: Tab; pageId: string | null };

const COLORS = Object.keys(COLOR_HEX);

function monday(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3500);
    return () => clearTimeout(t);
  }, [text, onDone]);
  return <div className="toast" role="status">{text}</div>;
}

async function copy(text: string, say: (s: string) => void) {
  try {
    await navigator.clipboard.writeText(text);
    say("Copied");
  } catch {
    say("Couldn't copy; select the text and copy it yourself");
  }
}

export function BookingsApp({ me, publicBase, suiteDomain }: { me: Me; publicBase: string; suiteDomain?: string }) {
  const [pages, setPages] = useState<Page[] | null>(null);
  const [view, setView] = useState<View>({ tab: "calendar", pageId: null });
  const [open, setOpen] = useState<Appointment | null>(null);
  const [toast, setToast] = useState("");
  const [newPage, setNewPage] = useState(false);
  const [newAppt, setNewAppt] = useState(false);
  const [reload, setReload] = useState(0);

  const loadPages = useCallback(async () => setPages(await api<Page[]>("/api/pages")), []);
  useEffect(() => {
    void loadPages().catch((e) => setToast((e as Error).message));
  }, [loadPages]);

  // Links from emails, Calendar and Search open one appointment: /?appointment=<id>.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("appointment");
    if (id) api<Appointment>(`/api/appointments/${id}`).then(setOpen).catch((e) => setToast((e as Error).message));
  }, []);

  const page = pages?.find((p) => p.id === view.pageId) ?? null;
  const isAdmin = (p: Page | null) => Boolean(p?.staff.some((s) => s.email === me.email && s.role === "admin"));
  const updated = (p: Page) => setPages((ps) => ps?.map((x) => (x.id === p.id ? p : x)) ?? [p]);

  const go = (tab: Tab, pageId: string | null) => {
    setView({ tab, pageId });
    setOpen(null);
  };

  return (
    <div className={`bk${open ? " withdetails" : ""}`}>
      <nav className="nav" aria-label="Bookings">
        <button className="btn primary newbtn" onClick={() => setNewAppt(true)} disabled={!pages?.length}><CalendarPlus size={16} /> New appointment</button>
        <button className={`navitem${view.tab === "calendar" && !view.pageId ? " active" : ""}`} onClick={() => go("calendar", null)}>
          <CalendarDays size={18} /> All appointments
        </button>
        {pages?.map((p) => (
          <div key={p.id}>
            <div className="navsection"><span className="dot" style={{ background: COLOR_HEX[p.color] }} /> <span className="fname">{p.name}</span></div>
            <button className={`navitem sub${view.pageId === p.id && view.tab === "calendar" ? " active" : ""}`} onClick={() => go("calendar", p.id)}>Calendar</button>
            <button className={`navitem sub${view.pageId === p.id && view.tab === "customers" ? " active" : ""}`} onClick={() => go("customers", p.id)}>Customers</button>
            <button className={`navitem sub${view.pageId === p.id && view.tab === "services" ? " active" : ""}`} onClick={() => go("services", p.id)}>Services</button>
            <button className={`navitem sub${view.pageId === p.id && view.tab === "staff" ? " active" : ""}`} onClick={() => go("staff", p.id)}>Staff</button>
            <button className={`navitem sub${view.pageId === p.id && view.tab === "settings" ? " active" : ""}`} onClick={() => go("settings", p.id)}>Booking page</button>
          </div>
        ))}
        <button className="navitem" style={{ color: "var(--accent)", marginTop: 8 }} onClick={() => setNewPage(true)}><Plus size={18} /> New booking page</button>
      </nav>

      <main className="main">
        {pages === null ? <p className="pad muted">Loading…</p>
          : !pages.length ? (
            <div className="empty">
              <CalendarDays size={40} />
              <h2>Let customers book time with you</h2>
              <p>Make a booking page for your business or just for yourself. Add services and staff, share the link, and appointments land on everyone&apos;s calendar with a Meet link.</p>
              <button className="btn primary" onClick={() => setNewPage(true)}><Plus size={16} /> New booking page</button>
            </div>
          )
          : view.tab === "calendar" ? <Appointments me={me} pages={pages} page={page} open={open} onOpen={setOpen} reload={reload} onNew={() => setNewAppt(true)} />
            : !page ? null
              : view.tab === "customers" ? <Customers page={page} suiteDomain={suiteDomain} />
                : view.tab === "services" ? <Services page={page} admin={isAdmin(page)} publicBase={publicBase} onChange={loadPages} say={setToast} />
                  : view.tab === "staff" ? <StaffList page={page} admin={isAdmin(page)} onSaved={updated} say={setToast} />
                    : <PageSettings page={page} admin={isAdmin(page)} publicBase={publicBase} onSaved={updated} say={setToast}
                      onDeleted={() => { go("calendar", null); void loadPages(); }} />}
      </main>

      {open && (
        <Details appt={open} page={pages?.find((p) => p.id === open.pageId) ?? null} suiteDomain={suiteDomain} onClose={() => setOpen(null)}
          onChanged={(a) => { setOpen(a); setReload((n) => n + 1); }} say={setToast} />
      )}
      {newPage && (
        <NewPage onClose={() => setNewPage(false)} onMade={(p) => { setPages((ps) => [...(ps ?? []), p]); go("settings", p.id); setToast("Booking page made. Publish it when it's ready."); }} />
      )}
      {newAppt && pages && (
        <NewAppointment me={me} pages={pages} pageId={view.pageId} onClose={() => setNewAppt(false)}
          onMade={(a) => { setOpen(a); setReload((n) => n + 1); setToast("Booked. The customer has been emailed."); }} />
      )}
      {toast && <Toast text={toast} onDone={() => setToast("")} />}
    </div>
  );
}

// ---------- appointments ----------

function Appointments({ me, pages, page, open, onOpen, reload, onNew }: {
  me: Me; pages: Page[]; page: Page | null; open: Appointment | null; onOpen: (a: Appointment) => void; reload: number; onNew: () => void;
}) {
  const zone = useMemo(browserZone, []);
  const [week, setWeek] = useState(() => monday(dayKey(Date.now(), zone)));
  const [mine, setMine] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);
  const [q, setQ] = useState("");
  const [list, setList] = useState<Appointment[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      // The week in the viewer's zone, a day wider each side; grouped by their days below.
      const params = new URLSearchParams({ from: `${addDays(week, -1)}T00:00:00Z`, to: `${addDays(week, 8)}T00:00:00Z` });
      if (page) params.set("page", page.id);
      if (mine) params.set("mine", "1");
      if (!showCancelled) params.set("status", "confirmed");
      if (q.trim()) params.set("q", q.trim());
      api<Appointment[]>(`/api/appointments?${params}`).then((l) => live && setList(l), (e) => live && setError((e as Error).message));
    }, q ? 250 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [week, page, mine, showCancelled, q, reload]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const byDay = new Map<string, Appointment[]>();
  for (const a of list ?? []) {
    const k = dayKey(a.start, zone);
    if (days.includes(k)) byDay.set(k, [...(byDay.get(k) ?? []), a]);
  }
  const colorOf = (a: Appointment) => COLOR_HEX[pages.find((p) => p.id === a.pageId)?.color ?? "blue"];
  const today = dayKey(Date.now(), zone);

  return (
    <>
      <div className="head">
        <h1 className="grow">{page ? page.name : "All appointments"}</h1>
        <button className="btn" onClick={onNew}><CalendarPlus size={16} /> New appointment</button>
      </div>
      <div className="body">
        <div className="toolbar">
          <button className="btn" onClick={() => setWeek(monday(today))}>This week</button>
          <button className="iconbtn" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}><ChevronLeft size={18} /></button>
          <button className="iconbtn" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))}><ChevronRight size={18} /></button>
          <b>{longDay(week).replace(/, \d{4}$/, "")} – {longDay(addDays(week, 6))}</b>
          <span className="grow" />
          <label className="search"><Search size={15} /><input placeholder="Find a customer" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <label className="small"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine</label>
          <label className="small"><input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Cancelled</label>
        </div>
        {error && <p className="error">{error}</p>}
        {list === null ? <p className="muted">Loading…</p> : !byDay.size ? (
          <div className="empty"><CalendarDays size={32} /><p>No appointments this week.</p></div>
        ) : days.filter((d) => byDay.has(d)).map((d) => (
          <div className="daygroup" key={d}>
            <h3>{d === today ? "Today, " : ""}{longDay(d)}</h3>
            {byDay.get(d)!.map((a) => (
              <button key={a.id} className={`appt${open?.id === a.id ? " open" : ""}${a.status === "cancelled" ? " cancelled" : ""}`}
                style={{ "--c": colorOf(a) } as React.CSSProperties} onClick={() => onOpen(a)}>
                <span className="time">{timeIn(a.start, zone)} – {timeIn(a.end, zone)}</span>
                <span className="grow">
                  <span className="who">{a.customerName}</span> <span className="muted">· {a.serviceName}</span><br />
                  <span className="small muted">{a.staffEmail === me.email ? "You" : a.staffName}{page ? "" : ` · ${a.pageName}`}</span>
                </span>
                {a.joinUrl && a.status === "confirmed" && <Video size={16} color="var(--muted)" aria-label="Online" />}
                {a.status === "cancelled" && <span className="badge red">Cancelled</span>}
              </button>
            ))}
          </div>
        ))}
        <p className="hint">Times are in {zoneLabel(zone)}.</p>
      </div>
    </>
  );
}

function Details({ appt, page, suiteDomain, onClose, onChanged, say }: {
  appt: Appointment; page: Page | null; suiteDomain?: string; onClose: () => void; onChanged: (a: Appointment) => void; say: (s: string) => void;
}) {
  const zone = useMemo(browserZone, []);
  const [mode, setMode] = useState<"" | "move" | "cancel">("");
  const [error, setError] = useState("");
  useEffect(() => {
    setMode("");
    setError("");
  }, [appt.id]);
  const mailHref = suiteDomain ? `https://mail.${suiteDomain}/?compose=${encodeURIComponent(appt.customerEmail)}` : `mailto:${appt.customerEmail}`;
  const upcoming = appt.status === "confirmed" && Date.parse(appt.end) > Date.now();

  async function act(fn: () => Promise<Appointment>, done: string) {
    setError("");
    try {
      onChanged(await fn());
      setMode("");
      say(done);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <aside className="details" aria-label="Appointment">
      <div className="inner">
        <div className="toolbar">
          <h2 className="grow">{appt.customerName}</h2>
          <button className="iconbtn" aria-label="Close" onClick={onClose}>×</button>
        </div>
        {appt.status === "cancelled" && <span className="badge red" style={{ alignSelf: "flex-start" }}>Cancelled{appt.cancelledBy === appt.customerEmail ? " by the customer" : ""}</span>}
        <dl>
          <dt>Service</dt><dd>{appt.serviceName}</dd>
          <dt>When</dt><dd>{whenIn(appt.start, zone)} – {timeIn(appt.end, zone)}</dd>
          <dt>With</dt><dd>{appt.staffName || appt.staffEmail}</dd>
          <dt>Page</dt><dd>{appt.pageName}</dd>
          <dt>Email</dt><dd>{appt.customerEmail}</dd>
          {appt.customerPhone && <><dt>Phone</dt><dd>{appt.customerPhone}</dd></>}
          {appt.joinUrl ? <><dt>Meeting</dt><dd><a href={appt.joinUrl} target="_blank" rel="noreferrer">{appt.joinUrl}</a></dd></>
            : appt.location ? <><dt>Where</dt><dd>{appt.location}</dd></> : null}
          {appt.notes && <><dt>Notes</dt><dd style={{ whiteSpace: "pre-wrap" }}>{appt.notes}</dd></>}
          {appt.answers.map((a, i) => <span key={i} style={{ display: "contents" }}><dt>{a.label}</dt><dd>{a.answer}</dd></span>)}
          <dt>Booked</dt><dd>{whenIn(appt.createdAt, zone)}{appt.bookedBy ? ` by ${appt.bookedBy}` : " online"}</dd>
          {appt.cancelReason && <><dt>Reason</dt><dd>{appt.cancelReason}</dd></>}
        </dl>
        <div className="toolbar">
          {appt.joinUrl && upcoming && <a className="btn primary" href={appt.joinUrl} target="_blank" rel="noreferrer"><Video size={16} /> Join</a>}
          <a className="btn" href={mailHref} target="_blank" rel="noreferrer"><Mail size={16} /> Email</a>
          {upcoming && <button className="btn" onClick={() => setMode("move")}>Reschedule</button>}
          {upcoming && <button className="btn" onClick={() => setMode("cancel")}>Cancel</button>}
        </div>
        {mode === "move" && (
          <form className="form" style={{ padding: 0 }} onSubmit={(e) => {
            e.preventDefault();
            const v = new FormData(e.currentTarget).get("start") as string;
            void act(() => api<Appointment>(`/api/appointments/${appt.id}`, { method: "PATCH", json: { start: new Date(v).toISOString() } }), "Moved. The customer has been emailed.");
          }}>
            <label><span>New start</span><input type="datetime-local" name="start" required defaultValue={localInput(appt.start)} /></label>
            <div className="actions"><button type="button" className="btn" onClick={() => setMode("")}>Back</button><button className="btn primary">Move</button></div>
          </form>
        )}
        {mode === "cancel" && (
          <form className="form" style={{ padding: 0 }} onSubmit={(e) => {
            e.preventDefault();
            const reason = new FormData(e.currentTarget).get("reason");
            void act(() => api<Appointment>(`/api/appointments/${appt.id}/cancel`, { method: "POST", json: { reason } }), "Cancelled. The customer has been emailed.");
          }}>
            <label><span>Reason, sent to the customer (optional)</span><textarea name="reason" maxLength={1000} /></label>
            <div className="actions"><button type="button" className="btn" onClick={() => setMode("")}>Keep it</button><button className="btn danger">Cancel appointment</button></div>
          </form>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        {page && <p className="hint">Times are in {zoneLabel(zone)}. The page works in {zoneLabel(page.timeZone)}.</p>}
      </div>
    </aside>
  );
}

function NewAppointment({ me, pages, pageId, onClose, onMade }: {
  me: Me; pages: Page[]; pageId: string | null; onClose: () => void; onMade: (a: Appointment) => void;
}) {
  const [pid, setPid] = useState(pageId ?? pages[0].id);
  const page = pages.find((p) => p.id === pid)!;
  const [sid, setSid] = useState(page.services[0]?.id ?? "");
  const service = page.services.find((s) => s.id === sid);
  const offering = service ? (service.staffIds.length ? page.staff.filter((s) => service.staffIds.includes(s.id)) : page.staff) : [];
  const [error, setError] = useState("");
  useEffect(() => setSid(page.services[0]?.id ?? ""), [page]);

  return (
    <Modal title="New appointment" onClose={onClose} wide>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        try {
          onMade(await api<Appointment>("/api/appointments", {
            method: "POST",
            json: {
              pageId: pid, serviceId: sid, staffEmail: f.get("staff"), start: new Date(String(f.get("start"))).toISOString(),
              name: f.get("name"), email: f.get("email"), phone: f.get("phone"), notes: f.get("notes"),
            },
          }));
          onClose();
        } catch (x) {
          setError((x as Error).message);
        }
      }}>
        <div className="row2">
          <label><span>Booking page</span><select value={pid} onChange={(e) => setPid(e.target.value)}>{pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label><span>Service</span><select value={sid} onChange={(e) => setSid(e.target.value)} required>{page.services.map((s) => <option key={s.id} value={s.id}>{s.name} ({minutesLabel(s.durationMin)})</option>)}</select></label>
        </div>
        <div className="row2">
          <label><span>Staff</span><select name="staff" defaultValue={offering.some((s) => s.email === me.email) ? me.email : offering[0]?.email} key={sid}>
            {offering.map((s) => <option key={s.id} value={s.email}>{s.email === me.email ? `${s.name} (you)` : s.name}</option>)}
          </select></label>
          <label><span>Starts</span><input type="datetime-local" name="start" required /></label>
        </div>
        <div className="row3">
          <label><span>Customer name</span><input name="name" required /></label>
          <label><span>Email</span><input name="email" type="email" required /></label>
          <label><span>Phone</span><input name="phone" type="tel" /></label>
        </div>
        <label><span>Notes</span><textarea name="notes" /></label>
        <p className="hint">Staff may book outside opening hours. The customer gets the same confirmation as booking online.</p>
        <p className="error" role="alert">{error}</p>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!service}>Book</button></div>
      </form>
    </Modal>
  );
}

// ---------- customers ----------

function Customers({ page, suiteDomain }: { page: Page; suiteDomain?: string }) {
  const [list, setList] = useState<Customer[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setList(null);
    api<Customer[]>(`/api/pages/${page.id}/customers`).then(setList, (e) => setError((e as Error).message));
  }, [page.id]);
  const shown = (list ?? []).filter((c) => !q || `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="head"><h1 className="grow">Customers</h1><label className="search"><Search size={15} /><input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} /></label></div>
      <div className="body">
        {error && <p className="error">{error}</p>}
        {list === null ? <p className="muted">Loading…</p> : !list.length ? (
          <div className="empty"><Users size={32} /><p>People who book on {page.name} show up here. Each is also added to the staff member&apos;s Contacts.</p></div>
        ) : (
          <div className="tablewrap">
            <table className="list">
              <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Visits</th><th>Upcoming</th><th>Latest</th></tr></thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.email}>
                    <td>{c.name}</td>
                    <td><a href={suiteDomain ? `https://mail.${suiteDomain}/?compose=${encodeURIComponent(c.email)}` : `mailto:${c.email}`} target="_blank" rel="noreferrer">{c.email}</a></td>
                    <td>{c.phone}</td><td>{c.visits}</td><td>{c.upcoming}</td><td>{new Date(c.last).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ---------- services ----------

const LOCATION_LABELS: Record<string, string> = { meet: "Online (Synergy Meet)", in_person: "In person", phone: "Phone call", custom: "Somewhere else" };

function Services({ page, admin, publicBase, onChange, say }: { page: Page; admin: boolean; publicBase: string; onChange: () => Promise<void>; say: (s: string) => void }) {
  const [editing, setEditing] = useState<Service | "new" | null>(null);
  return (
    <>
      <div className="head">
        <h1 className="grow">Services</h1>
        {admin && <button className="btn primary" onClick={() => setEditing("new")}><Plus size={16} /> Add a service</button>}
      </div>
      <div className="body">
        {!page.services.length && <div className="empty"><Wrench size={32} /><p>Add what customers can book: a consultation, a haircut, a demo.</p></div>}
        <div className="cards">
          {page.services.map((s) => (
            <div key={s.id} className="card">
              <div className="toolbar"><h2 className="grow">{s.name}</h2>{!s.active && <span className="badge">Hidden</span>}</div>
              <span className="muted small">{minutesLabel(s.durationMin)} · {LOCATION_LABELS[s.locationKind]}{s.price ? ` · ${s.price}` : ""}</span>
              <span className="small muted">
                {s.staffIds.length ? page.staff.filter((x) => s.staffIds.includes(x.id)).map((x) => x.name).join(", ") : "Everyone on the page"}
              </span>
              <div className="toolbar">
                {admin && <button className="btn small" onClick={() => setEditing(s)}>Edit</button>}
                <button className="btn small" onClick={() => copy(`${publicBase}/book/${page.slug}/${s.slug}`, say)}><Copy size={14} /> Copy link</button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {editing && <ServiceDialog page={page} service={editing === "new" ? null : editing} onClose={() => setEditing(null)}
        onSaved={async (msg) => { await onChange(); say(msg); }} />}
    </>
  );
}

function ServiceDialog({ page, service, onClose, onSaved }: { page: Page; service: Service | null; onClose: () => void; onSaved: (msg: string) => Promise<void> }) {
  const [kind, setKind] = useState(service?.locationKind ?? "meet");
  const [staffIds, setStaffIds] = useState<string[]>(service?.staffIds ?? []);
  const [questions, setQuestions] = useState(service?.questions ?? []);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <Modal title={service ? `Edit ${service.name}` : "Add a service"} onClose={onClose} wide>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const reminders = String(f.get("reminders") ?? "").split(",").map((x) => x.trim()).filter(Boolean).map(Number);
        const json = {
          name: f.get("name"), description: f.get("description"), durationMin: Number(f.get("duration")),
          bufferBeforeMin: Number(f.get("before")), bufferAfterMin: Number(f.get("after")), locationKind: kind, location: f.get("location") ?? "",
          price: f.get("price"), staffIds, questions: questions.filter((x) => x.label.trim()), reminderHours: reminders, active: f.get("active") === "on",
          ...(f.get("slug") ? { slug: f.get("slug") } : {}),
        };
        try {
          if (service) await api(`/api/services/${service.id}`, { method: "PATCH", json });
          else await api(`/api/pages/${page.id}/services`, { method: "POST", json });
          await onSaved(service ? "Service saved" : "Service added");
          onClose();
        } catch (x) {
          setError((x as Error).message);
        }
      }}>
        <div className="row2">
          <label><span>Name</span><input name="name" required defaultValue={service?.name} maxLength={120} /></label>
          <label><span>Web address</span><input name="slug" defaultValue={service?.slug} placeholder="made from the name" pattern="[a-z0-9-]+" /></label>
        </div>
        <label><span>Description</span><textarea name="description" defaultValue={service?.description} maxLength={2000} /></label>
        <div className="row3">
          <label><span>Duration (minutes)</span><input name="duration" type="number" min={5} max={720} step={5} required defaultValue={service?.durationMin ?? 30} /></label>
          <label><span>Free before (minutes)</span><input name="before" type="number" min={0} max={240} step={5} defaultValue={service?.bufferBeforeMin ?? 0} /></label>
          <label><span>Free after (minutes)</span><input name="after" type="number" min={0} max={240} step={5} defaultValue={service?.bufferAfterMin ?? 0} /></label>
        </div>
        <div className="row2">
          <label><span>Where</span><select value={kind} onChange={(e) => setKind(e.target.value as Service["locationKind"])}>
            {Object.entries(LOCATION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
          {kind === "meet" ? <p className="hint" style={{ alignSelf: "end" }}>Each appointment gets its own Meet link, sent to the customer.</p>
            : <label><span>{kind === "in_person" ? "Address (blank: the page's)" : kind === "phone" ? "Number or note" : "Details"}</span><input name="location" defaultValue={service?.location} maxLength={300} /></label>}
        </div>
        <div className="row2">
          <label><span>Price (shown only)</span><input name="price" defaultValue={service?.price} placeholder="Free, $40" maxLength={60} /></label>
          <label><span>Reminder emails, hours before</span><input name="reminders" defaultValue={(service?.reminderHours ?? [24]).join(", ")} placeholder="24, 1" /></label>
        </div>
        <fieldset style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "8px 12px" }}>
          <legend className="small muted">Who offers it</legend>
          <label className="check"><input type="checkbox" checked={!staffIds.length} onChange={(e) => setStaffIds(e.target.checked ? [] : page.staff.map((s) => s.id))} /> Everyone on the page</label>
          {staffIds.length > 0 && page.staff.map((s) => (
            <label className="check" key={s.id}><input type="checkbox" checked={staffIds.includes(s.id)}
              onChange={(e) => setStaffIds(e.target.checked ? [...staffIds, s.id] : staffIds.filter((x) => x !== s.id))} /> {s.name}</label>
          ))}
        </fieldset>
        <fieldset style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "8px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
          <legend className="small muted">Questions for the customer</legend>
          {questions.map((qn, i) => (
            <div className="toolbar" key={i}>
              <input className="grow" aria-label="Question" value={qn.label} onChange={(e) => setQuestions(questions.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <label className="check small"><input type="checkbox" checked={qn.required} onChange={(e) => setQuestions(questions.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} /> Required</label>
              <button type="button" className="iconbtn small" aria-label="Remove question" onClick={() => setQuestions(questions.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
          ))}
          {questions.length < 10 && <button type="button" className="linkbtn" style={{ alignSelf: "flex-start" }}
            onClick={() => setQuestions([...questions, { id: `q${Date.now().toString(36)}`, label: "", required: false }])}>Add a question</button>}
        </fieldset>
        <label className="check"><input type="checkbox" name="active" defaultChecked={service?.active ?? true} /> Customers can book it</label>
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          {service && <button type="button" className="btn ghost" style={{ marginRight: "auto", color: "var(--danger)" }} onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Delete</button>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Save</button>
        </div>
      </form>
      {confirmDelete && service && (
        <Confirm title="Delete this service?" danger action="Delete" onClose={() => setConfirmDelete(false)}
          message={<>Customers won&apos;t be able to book {service.name}. Appointments already booked stay as they are.</>}
          onConfirm={async () => { await api(`/api/services/${service.id}`, { method: "DELETE" }); await onSaved("Service deleted"); onClose(); }} />
      )}
    </Modal>
  );
}

// ---------- staff ----------

type StaffDraft = Pick<Staff, "email" | "name" | "role" | "hours">;

function StaffList({ page, admin, onSaved, say }: { page: Page; admin: boolean; onSaved: (p: Page) => void; say: (s: string) => void }) {
  const saved = useMemo(() => page.staff.map(({ email, name, role, hours }): StaffDraft => ({ email, name, role, hours })), [page]);
  const [list, setList] = useState<StaffDraft[]>(saved);
  const [hoursFor, setHoursFor] = useState<number | null>(null);
  const [adding, setAdding] = useState("");
  const [error, setError] = useState("");
  useEffect(() => setList(saved), [saved]);
  const dirty = JSON.stringify(list) !== JSON.stringify(saved);

  const set = (i: number, patch: Partial<StaffDraft>) => setList(list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  async function save() {
    setError("");
    try {
      onSaved(await api<Page>(`/api/pages/${page.id}/staff`, { method: "PUT", json: { staff: list } }));
      say("Staff saved");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <div className="head">
        <h1 className="grow">Staff</h1>
        {admin && <button className="btn primary" disabled={!dirty} onClick={save}>Save</button>}
      </div>
      <div className="body">
        <p className="hint">Admins change the booking page. Everyone here can be booked, sees the page&apos;s appointments and gets an email for each of theirs. Their suite calendar keeps busy times from being offered.</p>
        <div className="tablewrap">
          <table className="list">
            <thead><tr><th>Person</th><th>Name shown to customers</th><th>Role</th><th>Hours</th>{admin && <th />}</tr></thead>
            <tbody>
              {list.map((s, i) => (
                <tr key={s.email}>
                  <td><UserRound size={14} /> {s.email}</td>
                  <td>{admin ? <input value={s.name} onChange={(e) => set(i, { name: e.target.value })} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "4px 8px" }} /> : s.name}</td>
                  <td>{admin ? <select value={s.role} onChange={(e) => set(i, { role: e.target.value as StaffDraft["role"] })}><option value="admin">Admin</option><option value="staff">Staff</option></select> : s.role === "admin" ? "Admin" : "Staff"}</td>
                  <td>{s.hours ? "Own hours" : "Page hours"} {admin && <button className="linkbtn" onClick={() => setHoursFor(i)}>Change</button>}</td>
                  {admin && <td><button className="iconbtn small" aria-label={`Remove ${s.email}`} onClick={() => setList(list.filter((_, j) => j !== i))}><Trash2 size={14} /></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {admin && (
          <form className="toolbar" onSubmit={(e) => {
            e.preventDefault();
            const email = adding.trim().toLowerCase();
            if (!email || list.some((s) => s.email === email)) return;
            setList([...list, { email, name: "", role: "staff", hours: null }]);
            setAdding("");
          }}>
            <input type="email" placeholder="Add someone by email" value={adding} onChange={(e) => setAdding(e.target.value)} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "6px 10px", minWidth: 260 }} />
            <button className="btn"><Plus size={15} /> Add</button>
          </form>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      {hoursFor !== null && (
        <StaffHours who={list[hoursFor]} pageHours={page.hours} onClose={() => setHoursFor(null)} onSet={(h) => set(hoursFor, { hours: h })} />
      )}
    </>
  );
}

function StaffHours({ who, pageHours, onClose, onSet }: { who: StaffDraft; pageHours: WeekHours; onClose: () => void; onSet: (h: WeekHours | null) => void }) {
  const [own, setOwn] = useState(Boolean(who.hours));
  const [hours, setHours] = useState<WeekHours>(who.hours ?? pageHours);
  return (
    <Modal title={`Hours for ${who.name || who.email}`} onClose={onClose} wide>
      <div className="form">
        <label className="check"><input type="radio" checked={!own} onChange={() => setOwn(false)} /> Same as the booking page</label>
        <label className="check"><input type="radio" checked={own} onChange={() => setOwn(true)} /> Their own hours</label>
        {own && <HoursEditor value={hours} onChange={setHours} />}
        <div className="actions"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => { onSet(own ? hours : null); onClose(); }}>Done</button></div>
      </div>
    </Modal>
  );
}

// ---------- page settings ----------

function NewPage({ onClose, onMade }: { onClose: () => void; onMade: (p: Page) => void }) {
  const [error, setError] = useState("");
  return (
    <Modal title="New booking page" onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        try {
          onMade(await api<Page>("/api/pages", { method: "POST", json: { name: f.get("name"), timeZone: browserZone() } }));
          onClose();
        } catch (x) {
          setError((x as Error).message);
        }
      }}>
        <label><span>Business or page name</span><input name="name" required autoFocus maxLength={120} placeholder="Contoso Clinic, or Book time with Sam" /></label>
        <p className="hint">You&apos;ll be its admin. It starts unpublished with one 30-minute service, in your time zone ({zoneLabel(browserZone())}).</p>
        <p className="error" role="alert">{error}</p>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Make page</button></div>
      </form>
    </Modal>
  );
}

function PageSettings({ page, admin, publicBase, onSaved, onDeleted, say }: {
  page: Page; admin: boolean; publicBase: string; onSaved: (p: Page) => void; onDeleted: () => void; say: (s: string) => void;
}) {
  const [hours, setHours] = useState(page.hours);
  const [color, setColor] = useState(page.color);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    setHours(page.hours);
    setColor(page.color);
  }, [page]);
  const link = `${publicBase}/book/${page.slug}`;
  const embed = `<iframe src="${link}?embed=1" title="Book with ${page.name.replace(/"/g, "&quot;")}" style="width:100%;height:900px;border:0"></iframe>`;

  return (
    <>
      <div className="head">
        <h1 className="grow">Booking page</h1>
        {page.published ? <span className="badge green">Published</span> : <span className="badge">Not published</span>}
        {page.published && <a className="btn" href={link} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open</a>}
      </div>
      <div className="body">
        <section className="section">
          <h2><Globe size={16} /> Share</h2>
          <div className="form">
            <label><span>Link for customers</span>
              <span className="linkrow"><input readOnly value={link} onFocus={(e) => e.currentTarget.select()} /><button type="button" className="btn" onClick={() => copy(link, say)}><Copy size={14} /> Copy</button></span>
            </label>
            <label><span>Put it on a website (in Sites, use a Booking block with page &quot;{page.slug}&quot;)</span>
              <span className="linkrow"><textarea readOnly rows={2} value={embed} onFocus={(e) => e.currentTarget.select()} /><button type="button" className="btn" onClick={() => copy(embed, say)}><Copy size={14} /> Copy</button></span>
            </label>
            {!page.published && <p className="hint">Customers can&apos;t open the link until the page is published.</p>}
          </div>
        </section>

        <form className="section" onSubmit={async (e) => {
          e.preventDefault();
          if (!admin) return;
          const f = new FormData(e.currentTarget);
          setError("");
          try {
            onSaved(await api<Page>(`/api/pages/${page.id}`, {
              method: "PATCH",
              json: {
                name: f.get("name"), slug: f.get("slug"), description: f.get("description"), timeZone: f.get("timeZone"), hours, color,
                minNoticeMin: Math.round(Number(f.get("notice")) * 60), maxDaysAhead: Number(f.get("ahead")), stepMin: Number(f.get("step")),
                published: f.get("published") === "on", chooseStaff: f.get("chooseStaff") === "on", senderEmail: f.get("sender") || null,
                phone: f.get("phone"), address: f.get("address"),
              },
            }));
            say("Saved");
          } catch (x) {
            setError((x as Error).message);
          }
        }}>
          <h2><Settings size={16} /> Details and rules</h2>
          <fieldset disabled={!admin} className="form" style={{ border: 0, margin: 0 }} key={page.id}>
            <div className="row2">
              <label><span>Name</span><input name="name" required defaultValue={page.name} maxLength={120} /></label>
              <label><span>Web address</span><input name="slug" required defaultValue={page.slug} pattern="[a-z0-9-]+" /></label>
            </div>
            <label><span>About (shown at the top of the page)</span><textarea name="description" defaultValue={page.description} maxLength={4000} /></label>
            <div className="row2">
              <label><span>Phone</span><input name="phone" defaultValue={page.phone} /></label>
              <label><span>Address</span><input name="address" defaultValue={page.address} /></label>
            </div>
            <div className="row2">
              <label><span>Time zone</span><select name="timeZone" defaultValue={page.timeZone}>
                {[...new Set([page.timeZone, ...zones()])].map((z) => <option key={z} value={z}>{zoneLabel(z)}</option>)}
              </select></label>
              <label><span>Emails come from (a suite mailbox; blank: {page.createdBy})</span><input name="sender" type="email" defaultValue={page.senderEmail ?? ""} /></label>
            </div>
            <div className="row3">
              <label><span>Book at least (hours ahead)</span><input name="notice" type="number" min={0} max={720} step={0.25} defaultValue={page.minNoticeMin / 60} /></label>
              <label><span>Book up to (days ahead)</span><input name="ahead" type="number" min={1} max={365} defaultValue={page.maxDaysAhead} /></label>
              <label><span>Start times every (minutes)</span><select name="step" defaultValue={page.stepMin}>{[10, 15, 20, 30, 45, 60, 90, 120].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            </div>
            <p className="hint">Customers can change or cancel online until the same notice before the start.</p>
            <div>
              <span className="small muted">Color</span>
              <div className="toolbar" style={{ marginTop: 4 }}>
                {COLORS.map((c) => (
                  <button type="button" key={c} aria-label={c} aria-pressed={color === c} onClick={() => setColor(c)}
                    style={{ width: 24, height: 24, borderRadius: "50%", border: color === c ? "3px solid var(--text)" : "2px solid var(--panel)", background: COLOR_HEX[c] }} />
                ))}
              </div>
            </div>
            <div>
              <span className="small muted">Opening hours ({zoneLabel(page.timeZone)})</span>
              <HoursEditor value={hours} onChange={setHours} />
            </div>
            <label className="check"><input type="checkbox" name="chooseStaff" defaultChecked={page.chooseStaff} /> Customers can choose who they see</label>
            <label className="check"><input type="checkbox" name="published" defaultChecked={page.published} /> Published: anyone with the link can book</label>
            <p className="error" role="alert">{error}</p>
            {admin ? (
              <div className="actions">
                <button type="button" className="btn ghost" style={{ marginRight: "auto", color: "var(--danger)" }} onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Delete page</button>
                <button className="btn primary">Save</button>
              </div>
            ) : <p className="hint">Only the page&apos;s admins can change these.</p>}
          </fieldset>
        </form>
      </div>
      {confirmDelete && (
        <Confirm title="Delete this booking page?" danger action="Delete" onClose={() => setConfirmDelete(false)}
          message={<>{page.name}, its services and all its appointments will be deleted, and its link will stop working. Customers are not emailed.</>}
          onConfirm={async () => { await api(`/api/pages/${page.id}`, { method: "DELETE" }); onDeleted(); }} />
      )}
    </>
  );
}
