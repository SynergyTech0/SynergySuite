import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, addMonths, monthGrid, startOfDay, startOfMonth, startOfWeek, eventKey } from './dates.js';
import { AgendaView, MiniMonth, MonthView, TimeGrid } from './views.jsx';
import { EventEditor, ScopeDialog, calendarId } from './editor.jsx';

const DEV_AS = new URLSearchParams(location.search).get('as');
async function req(method, url, body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (DEV_AS) headers['x-dev-user'] = DEV_AS;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
const api = {
  me: () => req('GET', '/api/me'),
  calendars: () => req('GET', '/api/calendars'),
  draft: d => req('POST', '/api/draft', d),
  events: (from, to) => req('GET', `/api/events?from=${from.toISOString()}&to=${to.toISOString()}`),
  create: e => req('POST', '/api/events', e),
  update: (id, e) => req('PATCH', `/api/events/${id}`, e),
  remove: (id, scope, occurrence) =>
    req('DELETE', `/api/events/${id}${scope ? `?scope=${scope}${occurrence ? `&occurrence=${encodeURIComponent(occurrence)}` : ''}` : ''}`),
};

const VIEWS = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['agenda', 'Agenda']];
const AGENDA_DAYS = 30;

function rangeFor(view, cursor) {
  if (view === 'day') { const from = startOfDay(cursor); return { from, to: addDays(from, 1) }; }
  if (view === 'week') { const from = startOfWeek(cursor); return { from, to: addDays(from, 7) }; }
  if (view === 'agenda') { const from = startOfDay(cursor); return { from, to: addDays(from, AGENDA_DAYS) }; }
  const days = monthGrid(cursor);
  return { from: days[0], to: addDays(days[41], 1) };
}

function title(view, cursor, range) {
  if (view === 'day') return cursor.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  if (view === 'month') return cursor.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const last = addDays(range.to, -1);
  const md = d => d.toLocaleDateString([], { month: 'long', day: 'numeric' });
  if (range.from.getMonth() === last.getMonth()) return `${md(range.from)} – ${last.getDate()}, ${last.getFullYear()}`;
  if (range.from.getFullYear() === last.getFullYear()) return `${md(range.from)} – ${md(last)}, ${last.getFullYear()}`;
  return `${md(range.from)}, ${range.from.getFullYear()} – ${md(last)}, ${last.getFullYear()}`;
}

function savedView() {
  try { const v = localStorage.getItem('cal.view'); return VIEWS.some(([k]) => k === v) ? v : null; } catch { return null; }
}

export default function App() {
  const [me, setMe] = useState(null);
  // Deep link from suite search: /?event=<id>&at=<start ISO> opens that week and the event.
  const [link] = useState(() => {
    const p = new URLSearchParams(location.search);
    const at = new Date(p.get('at') || '');
    return { event: Number(p.get('event')) || null, at: isNaN(at) ? null : at };
  });
  const [view, setViewState] = useState(() => (link.event ? 'week' : savedView() || 'week'));
  const [cursor, setCursor] = useState(() => startOfDay(link.at || new Date()));
  const [miniMonth, setMiniMonth] = useState(() => startOfMonth(link.at || new Date()));
  const [events, setEvents] = useState([]);
  const [calendars, setCalendars] = useState([]); // [{id, name, source?, role?}]
  const [editor, setEditor] = useState(null); // { event?, startAt?, endAt?, allDay? }
  const [scope, setScope] = useState(null); // { action, allowThis, run(scope) }
  const [error, setError] = useState('');
  const flash = useCallback(e => { setError(String(e.message || e)); setTimeout(() => setError(''), 5000); }, []);

  const setView = v => { setViewState(v); try { localStorage.setItem('cal.view', v); } catch { /* private mode */ } };
  const range = useMemo(() => rangeFor(view, cursor), [view, cursor]);
  const refresh = useCallback(async () => {
    try { setEvents(await api.events(range.from, range.to)); } catch (e) { flash(e); }
  }, [range, flash]);

  useEffect(() => { api.me().then(setMe).catch(flash); }, []); // eslint-disable-line
  useEffect(() => { api.calendars().then(setCalendars).catch(flash); }, []); // eslint-disable-line
  const calendarName = e => calendars.find(c => c.id === calendarId(e))?.name || (e.calendar === 'group' ? 'Group calendar' : e.calendar);
  // The organizer, or an owner of the group calendar the event is on.
  const canEdit = e => e.owner_email === me?.email
    || (e.calendar === 'group' && calendars.some(c => c.id === calendarId(e) && c.role === 'owner'));
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { setMiniMonth(startOfMonth(cursor)); }, [cursor]);

  const [linkOpened, setLinkOpened] = useState(false);
  useEffect(() => {
    if (linkOpened || !link.event) return;
    const near = e => Math.abs(new Date(e.start_at) - link.at);
    const matches = events.filter(x => Number(x.id) === link.event).sort((a, b) => near(a) - near(b));
    if (matches.length) { setLinkOpened(true); setEditor({ event: matches[0] }); }
  }, [events, link, linkOpened]);

  function step(n) {
    if (view === 'day') setCursor(addDays(cursor, n));
    else if (view === 'week') setCursor(addDays(cursor, 7 * n));
    else if (view === 'agenda') setCursor(addDays(cursor, AGENDA_DAYS * n));
    else setCursor(addMonths(cursor, n));
  }

  // Keyboard: t today, d/w/m/a views, arrows or j/k to move, n new event.
  useEffect(() => {
    const onKey = e => {
      if (editor || scope || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === 't') setCursor(startOfDay(new Date()));
      else if (k === 'd') setView('day');
      else if (k === 'w') setView('week');
      else if (k === 'm') setView('month');
      else if (k === 'a') setView('agenda');
      else if (k === 'arrowleft' || k === 'k') step(-1);
      else if (k === 'arrowright' || k === 'j') step(1);
      else if (k === 'n') newEvent(nextHour());
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const nextHour = () => { const s = new Date(); s.setMinutes(0, 0, 0); s.setHours(s.getHours() + 1); return s; };
  function newEvent(at, allDay = false) {
    if (allDay) {
      const s = new Date(Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()));
      setEditor({ startAt: s, endAt: addDays(s, 1), allDay: true });
    } else setEditor({ startAt: at, endAt: new Date(at.getTime() + 3600000) });
  }

  async function run(fn) {
    try { await fn(); setEditor(null); setScope(null); refresh(); } catch (e) { flash(e); }
  }

  function save(payload, meta) {
    const ev = editor.event;
    if (!ev) return run(() => api.create(payload));
    if (!ev.recurring) return run(() => api.update(ev.id, payload));
    setScope({
      action: 'edit',
      allowThis: !meta.repeatChanged,
      run: s => run(() => api.update(ev.id, { ...payload, scope: s, occurrence: ev.occurrence })),
    });
  }

  function remove() {
    const ev = editor.event;
    if (!ev.recurring) {
      if (confirm('Delete event?')) run(() => api.remove(ev.id));
      return;
    }
    setScope({ action: 'delete', allowThis: true, run: s => run(() => api.remove(ev.id, s, ev.occurrence)) });
  }

  const days = view === 'day' ? [startOfDay(cursor)] : [...Array(7)].map((_, i) => addDays(range.from, i));
  const open = e => setEditor({ event: e });

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">S</span> SynergyCal</div>
        <div className="nav-week">
          <button className="mini" onClick={() => setCursor(startOfDay(new Date()))}>Today</button>
          <button className="mini" aria-label={`Previous ${view}`} onClick={() => step(-1)}>←</button>
          <button className="mini" aria-label={`Next ${view}`} onClick={() => step(1)}>→</button>
          <b className="range-title" aria-live="polite">{title(view, cursor, range)}</b>
        </div>
        <div className="views" role="tablist" aria-label="View">
          {VIEWS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{label}</button>
          ))}
        </div>
        <div>
          <button className="primary" onClick={() => newEvent(nextHour())}>+ Event</button>
          <span className="hint"> {me?.email}</span>
        </div>
      </header>

      <div className="body">
        <aside className="side">
          <MiniMonth month={miniMonth} setMonth={setMiniMonth} selected={cursor} range={view === 'week' ? range : { from: cursor, to: cursor }}
            onPick={d => setCursor(startOfDay(d))} />
          <div className="legend">
            <span><i className="dot personal" /> Personal</span>
            <span><i className="dot company" /> Company</span>
            <span><i className="dot booking" /> Bookings</span>
            {calendars.some(c => c.source) && <span><i className="dot group" /> Groups</span>}
          </div>
        </aside>
        <main className="main">
          {view === 'month' && (
            <MonthView cursor={cursor} events={events} me={me} onOpen={open}
              onNew={d => { const s = new Date(d); s.setHours(9, 0, 0, 0); newEvent(s); }}
              onDay={d => { setCursor(startOfDay(d)); setView('day'); }} />
          )}
          {(view === 'week' || view === 'day') && (
            <TimeGrid days={days} events={events} me={me} onOpen={open} onNew={s => newEvent(s)} calendarName={calendarName} />
          )}
          {view === 'agenda' && <AgendaView from={range.from} days={AGENDA_DAYS} events={events} me={me} onOpen={open} />}
        </main>
      </div>

      {editor && (
        <EventEditor
          key={editor.event ? eventKey(editor.event) : 'new'}
          me={me}
          calendars={calendars}
          calendarName={calendarName}
          canEdit={!editor.event || canEdit(editor.event)}
          draft={api.draft}
          event={editor.event}
          defaults={editor}
          onClose={() => setEditor(null)}
          onSave={save}
          onDelete={editor.event ? remove : null}
        />
      )}
      {scope && <ScopeDialog action={scope.action} allowThis={scope.allowThis} onPick={scope.run} onClose={() => setScope(null)} />}

      {error && <div className="toast" role="alert">{error}</div>}
    </div>
  );
}
