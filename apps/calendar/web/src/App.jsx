import React, { useEffect, useState, useCallback, useMemo } from 'react';

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
  events: (from, to) => req('GET', `/api/events?from=${from.toISOString()}&to=${to.toISOString()}`),
  create: e => req('POST', '/api/events', e),
  update: (id, e) => req('PATCH', `/api/events/${id}`, e),
  remove: id => req('DELETE', `/api/events/${id}`),
  draft: d => req('POST', '/api/draft', d),
};

const HOUR_START = 7, HOUR_END = 21;
const startOfWeek = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fmtHour = h => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });
const fmtTime = d => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export default function App() {
  const [me, setMe] = useState(null);
  // Deep link from suite search: /?event=<id>&at=<start ISO> opens that week and the event.
  const [link] = useState(() => {
    const p = new URLSearchParams(location.search);
    const at = new Date(p.get('at') || '');
    return { event: Number(p.get('event')) || null, at: isNaN(at) ? null : at };
  });
  const [weekStart, setWeekStart] = useState(startOfWeek(link.at || new Date()));
  const [events, setEvents] = useState([]);
  const [editor, setEditor] = useState(null); // {event?, startAt?, endAt?}
  const [error, setError] = useState('');
  const flash = useCallback(e => { setError(String(e.message || e)); setTimeout(() => setError(''), 5000); }, []);

  const refresh = useCallback(async ws => {
    try { setEvents(await api.events(ws, addDays(ws, 7))); } catch (e) { flash(e); }
  }, [flash]);

  useEffect(() => { api.me().then(setMe).catch(flash); }, []); // eslint-disable-line
  useEffect(() => { refresh(weekStart); }, [weekStart, refresh]);
  const [linkOpened, setLinkOpened] = useState(false);
  useEffect(() => {
    if (linkOpened || !link.event) return;
    const e = events.find(x => Number(x.id) === link.event);
    if (e) { setLinkOpened(true); setEditor({ event: e }); }
  }, [events, link, linkOpened]);

  const days = useMemo(() => [...Array(7)].map((_, i) => addDays(weekStart, i)), [weekStart]);
  const now = new Date();

  function eventsFor(day) {
    const dayEnd = addDays(day, 1);
    return events.filter(e => !e.all_day && new Date(e.start_at) < dayEnd && new Date(e.end_at) > day);
  }
  function allDayFor(day) {
    const dayEnd = addDays(day, 1);
    return events.filter(e => e.all_day && new Date(e.start_at) < dayEnd && new Date(e.end_at) > day);
  }
  function posFor(e, day) {
    const s = Math.max(new Date(e.start_at), day.getTime() + HOUR_START * 3600000);
    const en = Math.min(new Date(e.end_at), day.getTime() + HOUR_END * 3600000);
    const top = ((s - day.getTime()) / 3600000 - HOUR_START) * 48;
    const height = Math.max(20, ((en - s) / 3600000) * 48 - 2);
    return { top, height };
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">S</span> SynergyCal</div>
        <div className="nav-week">
          <button className="mini" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}>←</button>
          <b>{weekStart.toLocaleDateString([], { month: 'long', year: 'numeric' })}</b>
          <button className="mini" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}>→</button>
          <button className="mini" onClick={() => setWeekStart(startOfWeek(new Date()))}>Today</button>
        </div>
        <div>
          <button className="primary" onClick={() => {
            const s = new Date(); s.setMinutes(0, 0, 0); s.setHours(s.getHours() + 1);
            setEditor({ startAt: s, endAt: new Date(s.getTime() + 3600000) });
          }}>+ Event</button>
          <span className="hint"> {me?.email}</span>
        </div>
      </header>

      <div className="grid-wrap">
        <div className="grid">
          <div className="gutter">
            <div className="day-head" />
            {[...Array(HOUR_END - HOUR_START)].map((_, i) => (
              <div key={i} className="hour-label">{fmtHour(HOUR_START + i)}</div>
            ))}
          </div>
          {days.map(day => (
            <div key={day.toISOString()} className={`day-col ${day.toDateString() === now.toDateString() ? 'today' : ''}`}>
              <div className="day-head">
                {day.toLocaleDateString([], { weekday: 'short' })} <b>{day.getDate()}</b>
                {allDayFor(day).map(e => (
                  <button type="button" key={e.id} className="allday-chip" onClick={() => setEditor({ event: e })}>{e.title}</button>
                ))}
              </div>
              <div className="day-body"
                onClick={ev => {
                  if (ev.target !== ev.currentTarget) return;
                  const rect = ev.currentTarget.getBoundingClientRect();
                  const hour = HOUR_START + Math.floor((ev.clientY - rect.top) / 48);
                  const s = new Date(day); s.setHours(hour, 0, 0, 0);
                  setEditor({ startAt: s, endAt: new Date(s.getTime() + 3600000) });
                }}>
                {[...Array(HOUR_END - HOUR_START)].map((_, i) => <div key={i} className="hour-line" style={{ top: i * 48 }} />)}
                {eventsFor(day).map(e => {
                  const { top, height } = posFor(e, day);
                  const mine = e.owner_email === me?.email;
                  return (
                    <button type="button" key={e.id}
                      className={`event ${e.calendar} ${e.source === 'booking' ? 'booking' : ''} ${mine ? '' : 'other'}`}
                      style={{ top, height }}
                      onClick={() => setEditor({ event: e })}>
                      <span className="ev-title">{e.title}</span>
                      <span className="ev-time">{fmtTime(e.start_at)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {editor && (
        <EventEditor
          me={me}
          event={editor.event}
          defaults={editor}
          onClose={() => setEditor(null)}
          onSave={async payload => {
            try {
              editor.event ? await api.update(editor.event.id, payload) : await api.create(payload);
              setEditor(null); refresh(weekStart);
            } catch (e) { flash(e); }
          }}
          onDelete={editor.event ? async () => {
            try { await api.remove(editor.event.id); setEditor(null); refresh(weekStart); } catch (e) { flash(e); }
          } : null}
        />
      )}

      {error && <div className="toast">{error}</div>}
    </div>
  );
}

const toLocal = d => {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 16);
};

function EventEditor({ me, event, defaults, onClose, onSave, onDelete }) {
  const [f, setF] = useState({
    title: event?.title || '',
    description: event?.description || '',
    location: event?.location || '',
    calendar: event?.calendar || 'personal',
    startAt: toLocal(event?.start_at || defaults.startAt),
    endAt: toLocal(event?.end_at || defaults.endAt),
    attendees: (event?.attendees || []).join(', '),
  });
  const set = p => setF(prev => ({ ...prev, ...p }));
  const mine = !event || event.owner_email === me?.email;
  // Draft with Copilot: notes from the title, attendees and what the person asks for. Saved only with Save.
  const [assist, setAssist] = useState(false);
  const [ask, setAsk] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState('');
  async function copilot(mode) {
    setDrafting(true);
    setDraftError('');
    try {
      const { text } = await api.draft({
        mode, instructions: ask, title: f.title, description: f.description, location: f.location,
        attendees: f.attendees, when: f.startAt ? new Date(f.startAt).toLocaleString() : '',
      });
      set({ description: text });
      setAssist(false);
    } catch (e) {
      setDraftError(String(e.message || e));
    } finally {
      setDrafting(false);
    }
  }
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="event-editor-title"
        onClick={e => e.stopPropagation()}>
        <h3 id="event-editor-title">{event ? (mine ? 'Edit event' : event.title) : 'New event'}</h3>
        {mine ? (
          <>
            <label>Title <input autoFocus value={f.title} onChange={e => set({ title: e.target.value })} /></label>
            <div className="row2">
              <label>Start <input type="datetime-local" value={f.startAt} onChange={e => set({ startAt: e.target.value })} /></label>
              <label>End <input type="datetime-local" value={f.endAt} onChange={e => set({ endAt: e.target.value })} /></label>
            </div>
            <label>Calendar
              <select value={f.calendar} onChange={e => set({ calendar: e.target.value })}>
                <option value="personal">Personal</option>
                <option value="company">Company (everyone sees)</option>
              </select>
            </label>
            <label>Location / link <input value={f.location} onChange={e => set({ location: e.target.value })} /></label>
            <label>Attendees <input placeholder="emails, comma separated" value={f.attendees} onChange={e => set({ attendees: e.target.value })} /></label>
            <label>Notes <textarea rows={4} maxLength={2000} value={f.description} onChange={e => set({ description: e.target.value })} /></label>
            {me?.ai && (
              <div className="assist">
                {!assist ? (
                  <button type="button" onClick={() => setAssist(true)}>✨ Draft with Copilot</button>
                ) : (
                  <>
                    <input aria-label="What should the notes cover?" placeholder="What should the notes cover? e.g. agenda for the Q3 review"
                      value={ask} maxLength={1000} onChange={e => setAsk(e.target.value)} />
                    <div className="assist-actions">
                      <button type="button" className="primary" disabled={drafting} onClick={() => copilot('write')}>{drafting ? 'Writing…' : 'Write notes'}</button>
                      <button type="button" disabled={drafting || !f.description.trim()} onClick={() => copilot('rewrite')}>Rewrite</button>
                      <button type="button" disabled={drafting || !f.description.trim()} onClick={() => copilot('shorten')}>Shorten</button>
                      <button type="button" onClick={() => setAssist(false)}>Close</button>
                    </div>
                    <p className="hint">Copilot replaces the notes above. Check them, then Save.</p>
                    {draftError && <p className="hint bad-text" role="alert">{draftError}</p>}
                  </>
                )}
              </div>
            )}
            <div className="modal-actions">
              {onDelete && <button className="bad" onClick={() => confirm('Delete event?') && onDelete()}>Delete</button>}
              <button onClick={onClose}>Cancel</button>
              <button className="primary" disabled={!f.title.trim()}
                onClick={() => onSave({
                  title: f.title, description: f.description, location: f.location,
                  calendar: f.calendar,
                  startAt: new Date(f.startAt).toISOString(),
                  endAt: new Date(f.endAt).toISOString(),
                  attendees: f.attendees.split(',').map(s => s.trim()).filter(Boolean),
                })}>Save</button>
            </div>
          </>
        ) : (
          <>
            <p>{fmtRange(event)}</p>
            {event.location && <p>📍 {event.location}</p>}
            {event.description && <p className="hint">{event.description}</p>}
            <p className="hint">Owner: {event.owner_email} · {event.calendar}</p>
            <div className="modal-actions"><button onClick={onClose}>Close</button></div>
          </>
        )}
      </div>
    </div>
  );
}

function fmtRange(e) {
  const s = new Date(e.start_at), en = new Date(e.end_at);
  return `${s.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} – ${en.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}
