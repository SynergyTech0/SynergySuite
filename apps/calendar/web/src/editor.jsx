import React, { useEffect, useMemo, useState } from 'react';
import { WEEKDAYS, addDays, browserZone, describeRule, nthOfMonth, ruleToState, stateToRule } from './dates.js';

const toLocal = d => {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 16);
};
// All-day dates are UTC midnights; the date inputs show them as they are.
const toDateInput = d => new Date(d).toISOString().slice(0, 10);
const localDateOf = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

let zones = null;
function zoneList(extra) {
  if (!zones) {
    try { zones = Intl.supportedValuesOf('timeZone'); } catch { zones = []; }
  }
  return [...new Set([...extra.filter(Boolean), ...zones])];
}

// The picker value for an event's calendar: personal, company or group:<source>.
export const calendarId = e => (e.calendar === 'group' ? `group:${e.group_source}` : e.calendar);

function useEscape(onClose) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
}

/**
 * New event or edit. `event` is the occurrence clicked (for a series, with `occurrence` and
 * the series' `rrule`). onSave gets only what changed, so moving one occurrence never moves
 * the rest by accident.
 */
export function EventEditor({ me, calendars = [], calendarName = e => e.calendar, canEdit = true, draft, event, defaults, onClose, onSave, onDelete }) {
  const allDay0 = Boolean(event?.all_day ?? defaults.allDay);
  const start0 = event?.start_at || defaults.startAt;
  const end0 = event?.end_at || defaults.endAt;
  const initial = useMemo(() => ({
    title: event?.title || '',
    description: event?.description || '',
    location: event?.location || '',
    calendar: event ? calendarId(event) : 'personal',
    allDay: allDay0,
    startAt: toLocal(start0),
    endAt: toLocal(end0),
    startDate: allDay0 ? toDateInput(start0) : localDateOf(start0),
    endDate: allDay0 ? toDateInput(new Date(new Date(end0).getTime() - 86400000)) : localDateOf(end0),
    tzid: event?.tzid && event.tzid !== 'UTC' ? event.tzid : browserZone(),
    attendees: (event?.attendees || []).join(', '),
    repeat: ruleToState(event?.rrule || null, start0),
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [f, setF] = useState(initial);
  const set = p => setF(prev => ({ ...prev, ...p }));
  const mine = !event || event.owner_email === me?.email;
  const isOverride = event?.recurring && event.series_id && String(event.series_id) !== String(event.id);
  useEscape(onClose);
  const groups = calendars.filter(c => c.source);
  // An event on a group calendar the person has left still shows its own calendar.
  const stale = f.calendar.startsWith('group:') && !groups.some(c => c.id === f.calendar);

  // Draft with Copilot: notes from the title, attendees and what the person asks for. Saved only with Save.
  const [assist, setAssist] = useState(false);
  const [ask, setAsk] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState('');
  async function copilot(mode) {
    setDrafting(true);
    setDraftError('');
    try {
      const when = f.allDay ? f.startDate : f.startAt ? new Date(f.startAt).toLocaleString() : '';
      const { text } = await draft({
        mode, instructions: ask, title: f.title, description: f.description, location: f.location, attendees: f.attendees, when,
      });
      set({ description: text });
      setAssist(false);
    } catch (e) {
      setDraftError(String(e.message || e));
    } finally {
      setDrafting(false);
    }
  }

  function payload() {
    const out = {};
    const changed = k => JSON.stringify(f[k]) !== JSON.stringify(initial[k]);
    for (const k of ['title', 'description', 'location']) if (!event || changed(k)) out[k] = f[k];
    if (!event || changed('calendar')) {
      Object.assign(out, f.calendar.startsWith('group:')
        ? { calendar: 'group', groupSource: f.calendar.slice('group:'.length) }
        : { calendar: f.calendar });
    }
    if (!event || changed('attendees')) out.attendees = f.attendees.split(',').map(s => s.trim()).filter(Boolean);
    const timesChanged = ['allDay', 'startAt', 'endAt', 'startDate', 'endDate'].some(changed);
    let start;
    if (f.allDay) {
      start = new Date(`${f.startDate}T00:00:00Z`);
      const endDay = new Date(`${f.endDate}T00:00:00Z`);
      if (!event || timesChanged) {
        out.allDay = true;
        out.startAt = start.toISOString();
        out.endAt = new Date(Math.max(endDay.getTime(), start.getTime()) + 86400000).toISOString();
      }
    } else {
      start = new Date(f.startAt);
      if (!event || timesChanged) {
        out.allDay = false;
        out.startAt = start.toISOString();
        out.endAt = new Date(f.endAt).toISOString();
      }
    }
    if (!event || changed('tzid')) out.tzid = f.tzid;
    const rule = stateToRule(f.repeat, start);
    if (!event || changed('repeat')) out.rrule = rule;
    return out;
  }

  const invalid = !f.title.trim() || (f.allDay ? !(f.startDate && f.endDate >= f.startDate) : !(new Date(f.endAt) > new Date(f.startAt)));
  const startForRule = f.allDay ? new Date(`${f.startDate}T12:00:00`) : new Date(f.startAt);

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="event-editor-title" onClick={e => e.stopPropagation()}>
        <h3 id="event-editor-title">{event ? (canEdit ? 'Edit event' : event.title) : 'New event'}</h3>
        {canEdit ? (
          <>
            <label>Title <input autoFocus value={f.title} onChange={e => set({ title: e.target.value })} /></label>
            <label className="check"><input type="checkbox" checked={f.allDay} onChange={e => set({ allDay: e.target.checked })} /> All day</label>
            {f.allDay ? (
              <div className="row2">
                <label>Start <input type="date" value={f.startDate} onChange={e => set({ startDate: e.target.value, endDate: e.target.value > f.endDate ? e.target.value : f.endDate })} /></label>
                <label>End <input type="date" value={f.endDate} min={f.startDate} onChange={e => set({ endDate: e.target.value })} /></label>
              </div>
            ) : (
              <div className="row2">
                <label>Start <input type="datetime-local" value={f.startAt} onChange={e => {
                  const dur = new Date(f.endAt) - new Date(f.startAt);
                  const s = new Date(e.target.value);
                  set({ startAt: e.target.value, endAt: isNaN(s) ? f.endAt : toLocal(new Date(s.getTime() + Math.max(dur, 0))) });
                }} /></label>
                <label>End <input type="datetime-local" value={f.endAt} onChange={e => set({ endAt: e.target.value })} /></label>
              </div>
            )}
            {!isOverride && (
              <RepeatEditor value={f.repeat} start={startForRule} onChange={repeat => set({ repeat })} />
            )}
            {isOverride && <p className="hint">This occurrence was changed on its own. To change how the series repeats, open another occurrence.</p>}
            {!f.allDay && f.repeat.freq !== 'NONE' && (
              <label>Time zone <span className="hint">(repeats at this local time, through daylight saving changes)</span>
                <select value={f.tzid} onChange={e => set({ tzid: e.target.value })}>
                  {zoneList([f.tzid, browserZone(), 'UTC']).map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
                </select>
              </label>
            )}
            <label>Calendar
              <select value={f.calendar} disabled={!mine} onChange={e => set({ calendar: e.target.value })}>
                <option value="personal">Personal</option>
                <option value="company">Company (everyone sees)</option>
                {groups.map(c => <option key={c.id} value={c.id}>{c.name} (group)</option>)}
                {stale && <option value={f.calendar}>{calendarName(event)}</option>}
              </select>
            </label>
            <label>Location / link <input value={f.location} onChange={e => set({ location: e.target.value })} /></label>
            <label>Attendees <input placeholder="emails, comma separated" value={f.attendees} onChange={e => set({ attendees: e.target.value })} /></label>
            <label>Notes <textarea rows={3} maxLength={2000} value={f.description} onChange={e => set({ description: e.target.value })} /></label>
            {me?.ai && draft && (
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
              {onDelete && <button className="bad" onClick={() => onDelete()}>Delete</button>}
              <button onClick={onClose}>Cancel</button>
              <button className="primary" disabled={invalid} onClick={() => onSave(payload(), { repeatChanged: JSON.stringify(f.repeat) !== JSON.stringify(initial.repeat) })}>Save</button>
            </div>
          </>
        ) : (
          <>
            <p>{fmtRange(event)}</p>
            {event.recurring && <p className="hint">↻ {describeRule(event.rrule, event.start_at)}</p>}
            {event.location && <p>📍 {event.location}</p>}
            {event.description && <p className="hint">{event.description}</p>}
            <p className="hint">Owner: {event.owner_email} · {calendarName(event)}</p>
            <div className="modal-actions"><button onClick={onClose}>Close</button></div>
          </>
        )}
      </div>
    </div>
  );
}

export function RepeatEditor({ value, start, onChange }) {
  const v = value;
  const set = p => onChange({ ...v, ...p, raw: undefined });
  const s = isNaN(start) ? new Date() : start;
  const wd = WEEKDAYS[s.getDay()];
  const { n, last } = nthOfMonth(s);
  const dayLong = s.toLocaleDateString([], { weekday: 'long' });
  const ord = ['', 'first', 'second', 'third', 'fourth', 'fifth'][n];
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[v.freq];
  return (
    <fieldset className="repeat-box">
      <legend>Repeat</legend>
      {v.raw ? (
        <p className="hint">{describeRule(v.raw, s)} (set on another device) <button type="button" className="mini" onClick={() => set({ freq: 'NONE' })}>Change</button></p>
      ) : (
        <>
          <div className="repeat-row">
            <select aria-label="Repeat" value={v.freq} onChange={e => set({ freq: e.target.value, byDay: e.target.value === 'WEEKLY' && !v.byDay.length ? [wd] : v.byDay })}>
              <option value="NONE">Does not repeat</option>
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
              <option value="YEARLY">Yearly</option>
            </select>
            {v.freq !== 'NONE' && (
              <label className="inline">every <input aria-label="Interval" type="number" min="1" max="999" value={v.interval} onChange={e => set({ interval: Math.max(1, Number(e.target.value) || 1) })} /> {unit}{v.interval > 1 ? 's' : ''}</label>
            )}
          </div>
          {v.freq === 'WEEKLY' && (
            <div className="weekdays" role="group" aria-label="On these days">
              {WEEKDAYS.map((d, i) => (
                <button type="button" key={d} aria-pressed={v.byDay.includes(d)} className={v.byDay.includes(d) ? 'on' : ''}
                  onClick={() => set({ byDay: v.byDay.includes(d) ? v.byDay.filter(x => x !== d) : [...v.byDay, d] })}>
                  {new Date(2023, 0, 1 + i).toLocaleDateString([], { weekday: 'narrow' })}
                </button>
              ))}
            </div>
          )}
          {v.freq === 'MONTHLY' && (
            <select aria-label="Monthly on" value={v.monthMode} onChange={e => set({ monthMode: e.target.value })}>
              <option value="date">On day {s.getDate()}</option>
              <option value="nth">On the {ord} {dayLong}</option>
              {last && <option value="last">On the last {dayLong}</option>}
            </select>
          )}
          {v.freq !== 'NONE' && (
            <div className="repeat-row">
              <select aria-label="Ends" value={v.end} onChange={e => set({ end: e.target.value })}>
                <option value="never">Never ends</option>
                <option value="until">Ends on</option>
                <option value="count">Ends after</option>
              </select>
              {v.end === 'until' && <input aria-label="End date" type="date" value={v.until} onChange={e => set({ until: e.target.value })} />}
              {v.end === 'count' && <label className="inline"><input aria-label="Occurrences" type="number" min="1" max="999" value={v.count} onChange={e => set({ count: Math.max(1, Number(e.target.value) || 1) })} /> times</label>}
            </div>
          )}
          {v.freq !== 'NONE' && <p className="hint">{describeRule(stateToRule(v, s), s)}</p>}
        </>
      )}
    </fieldset>
  );
}

/** "This event / This and following / All events" for a change to a repeating event. */
export function ScopeDialog({ action, allowThis = true, onPick, onClose }) {
  const [scope, setScope] = useState(allowThis ? 'this' : 'following');
  useEscape(onClose);
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal small" role="dialog" aria-modal="true" aria-labelledby="scope-title" onClick={e => e.stopPropagation()}>
        <h3 id="scope-title">{action === 'delete' ? 'Delete repeating event' : 'Edit repeating event'}</h3>
        <div role="radiogroup">
          {allowThis && <label className="check"><input type="radio" name="scope" checked={scope === 'this'} onChange={() => setScope('this')} /> This event</label>}
          <label className="check"><input type="radio" name="scope" checked={scope === 'following'} onChange={() => setScope('following')} /> This and following events</label>
          <label className="check"><input type="radio" name="scope" checked={scope === 'all'} onChange={() => setScope('all')} /> All events</label>
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className={action === 'delete' ? 'bad' : 'primary'} onClick={() => onPick(scope)}>{action === 'delete' ? 'Delete' : 'OK'}</button>
        </div>
      </div>
    </div>
  );
}

function fmtRange(e) {
  const s = new Date(e.start_at), en = new Date(e.end_at);
  if (e.all_day) {
    const last = addDays(new Date(en.getUTCFullYear(), en.getUTCMonth(), en.getUTCDate()), -1);
    const first = new Date(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
    const f = d => d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    return last > first ? `${f(first)} – ${f(last)}, all day` : `${f(first)}, all day`;
  }
  return `${s.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} – ${en.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}
