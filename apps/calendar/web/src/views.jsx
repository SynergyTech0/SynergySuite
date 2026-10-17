import React, { useEffect, useMemo, useRef } from 'react';
import {
  addDays, addMonths, allDayDays, coversDay, dayKey, eventKey, fmtHour, fmtTime, lanes, monthGrid, sameDay, startOfDay,
  startOfMonth, startOfWeek,
} from './dates.js';

const HOUR_PX = 48;

function chipClass(e, me) {
  return `${e.calendar} ${e.source === 'booking' ? 'booking' : ''} ${e.owner_email === me?.email ? '' : 'other'}`;
}

function Repeat({ e }) {
  return e.recurring ? <span className="repeat" title="Repeating event" aria-label="Repeats">↻</span> : null;
}

/** Month: six weeks of days with up to three events each. */
export function MonthView({ cursor, events, me, onOpen, onNew, onDay }) {
  const days = useMemo(() => monthGrid(cursor), [cursor]);
  const today = new Date();
  const byDay = useMemo(() => {
    const m = new Map();
    for (const e of events) {
      const ds = e.all_day ? allDayDays(e) : days.filter(d => coversDay(e, d));
      for (const d of ds) {
        const k = dayKey(d);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(e);
      }
    }
    for (const list of m.values()) list.sort((a, b) => (b.all_day - a.all_day) || new Date(a.start_at) - new Date(b.start_at));
    return m;
  }, [events, days]);
  return (
    <div className="month" role="grid" aria-label={cursor.toLocaleDateString([], { month: 'long', year: 'numeric' })}>
      {days.slice(0, 7).map(d => <div key={d.getDay()} className="month-head" role="columnheader">{d.toLocaleDateString([], { weekday: 'short' })}</div>)}
      {days.map(d => {
        const list = byDay.get(dayKey(d)) || [];
        const more = list.length - 3;
        return (
          <div key={dayKey(d)} role="gridcell" data-day={dayKey(d)}
            className={`month-cell ${d.getMonth() !== cursor.getMonth() ? 'outside' : ''} ${sameDay(d, today) ? 'today' : ''}`}
            onClick={ev => { if (ev.target === ev.currentTarget) onNew(d); }}>
            <button type="button" className="month-date" onClick={() => onDay(d)} aria-label={d.toLocaleDateString([], { dateStyle: 'full' })}>{d.getDate()}</button>
            {list.slice(0, more > 0 ? 2 : 3).map(e => (
              <button type="button" key={eventKey(e)} className={`month-chip ${e.all_day ? 'allday' : 'timed'} ${chipClass(e, me)}`} onClick={() => onOpen(e)}>
                {!e.all_day && <span className="chip-time">{fmtTime(e.start_at)}</span>}
                <span className="chip-title">{e.title}</span><Repeat e={e} />
              </button>
            ))}
            {more > 0 && <button type="button" className="month-more" onClick={() => onDay(d)}>{more + 1} more</button>}
          </div>
        );
      })}
    </div>
  );
}

/** Day and week: a 24-hour grid, scrolled to the morning, all-day events on top. */
export function TimeGrid({ days, events, me, onOpen, onNew, calendarName }) {
  const scroller = useRef(null);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 7 * HOUR_PX; }, [days.length]);
  const today = new Date();
  const now = new Date();
  return (
    <div className="grid-wrap" ref={scroller}>
      <div className={`grid ${days.length === 1 ? 'single' : ''}`}>
        <div className="gutter">
          <div className="day-head" />
          {[...Array(24)].map((_, i) => <div key={i} className="hour-label">{i ? fmtHour(i) : ''}</div>)}
        </div>
        {days.map(day => {
          const timed = events.filter(e => !e.all_day && coversDay(e, day));
          const lay = lanes(timed);
          return (
            <div key={day.toISOString()} className={`day-col ${sameDay(day, today) ? 'today' : ''}`}>
              <div className="day-head">
                {day.toLocaleDateString([], { weekday: 'short' })} <b>{day.getDate()}</b>
                {events.filter(e => e.all_day && coversDay(e, day)).map(e => (
                  <button type="button" key={eventKey(e)} className={`allday-chip ${chipClass(e, me)}`} onClick={() => onOpen(e)}>{e.title}<Repeat e={e} /></button>
                ))}
              </div>
              <div className="day-body" style={{ height: 24 * HOUR_PX }}
                onClick={ev => {
                  if (ev.target !== ev.currentTarget) return;
                  const rect = ev.currentTarget.getBoundingClientRect();
                  const half = Math.floor(((ev.clientY - rect.top) / HOUR_PX) * 2);
                  const s = new Date(day); s.setHours(Math.floor(half / 2), (half % 2) * 30, 0, 0);
                  onNew(s);
                }}>
                {[...Array(24)].map((_, i) => <div key={i} className="hour-line" style={{ top: i * HOUR_PX }} />)}
                {sameDay(day, now) && <div className="now-line" style={{ top: (now.getHours() + now.getMinutes() / 60) * HOUR_PX }} />}
                {timed.map(e => {
                  const s = Math.max(new Date(e.start_at), day.getTime());
                  const en = Math.min(new Date(e.end_at), addDays(day, 1).getTime());
                  const top = ((s - day.getTime()) / 3600000) * HOUR_PX;
                  const height = Math.max(20, ((en - s) / 3600000) * HOUR_PX - 2);
                  const { lane, lanes: n } = lay.get(eventKey(e)) || { lane: 0, lanes: 1 };
                  return (
                    <button type="button" key={eventKey(e)} className={`event ${chipClass(e, me)}`}
                      style={{ top, height, left: `calc(${(lane / n) * 100}% + 2px)`, width: `calc(${100 / n}% - 4px)` }}
                      onClick={() => onOpen(e)}>
                      <span className="ev-title">{e.title}<Repeat e={e} /></span>
                      {e.calendar === 'group' && calendarName && <span className="ev-cal">{calendarName(e)}</span>}
                      <span className="ev-time">{fmtTime(e.start_at)}{e.location ? ` · ${e.location}` : ''}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Agenda: the coming days as a list. */
export function AgendaView({ from, days, events, me, onOpen }) {
  const groups = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    const list = events.filter(e => coversDay(e, d)).sort((a, b) => (b.all_day - a.all_day) || new Date(a.start_at) - new Date(b.start_at));
    if (list.length) groups.push({ d, list });
  }
  if (!groups.length) return <div className="agenda empty">Nothing in the next {days} days.</div>;
  return (
    <div className="agenda">
      {groups.map(({ d, list }) => (
        <section key={dayKey(d)} className={sameDay(d, new Date()) ? 'today' : ''}>
          <h3>{d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
          {list.map(e => (
            <button type="button" key={eventKey(e)} className={`agenda-row ${chipClass(e, me)}`} onClick={() => onOpen(e)}>
              <span className="agenda-time">{e.all_day ? 'All day' : `${fmtTime(e.start_at)} – ${fmtTime(e.end_at)}`}</span>
              <span className="agenda-dot" />
              <span className="agenda-title">{e.title}<Repeat e={e} />{e.location && <span className="hint"> · {e.location}</span>}</span>
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}

/** The small month in the sidebar: pick any day. */
export function MiniMonth({ month, setMonth, selected, range, onPick }) {
  const days = monthGrid(month);
  const today = new Date();
  return (
    <div className="mini" aria-label="Pick a date">
      <div className="mini-head">
        <button type="button" className="mini-nav" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>‹</button>
        <b>{month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</b>
        <button type="button" className="mini-nav" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>›</button>
      </div>
      <div className="mini-grid">
        {days.slice(0, 7).map(d => <span key={d.getDay()} className="mini-dow">{d.toLocaleDateString([], { weekday: 'narrow' })}</span>)}
        {days.map(d => (
          <button type="button" key={dayKey(d)} onClick={() => onPick(d)}
            aria-label={d.toLocaleDateString([], { dateStyle: 'long' })}
            className={`mini-day ${d.getMonth() !== month.getMonth() ? 'outside' : ''} ${sameDay(d, today) ? 'today' : ''} ${sameDay(d, selected) ? 'selected' : ''} ${d >= range.from && d < range.to ? 'in-range' : ''}`}>
            {d.getDate()}
          </button>
        ))}
      </div>
    </div>
  );
}

export { startOfDay, startOfWeek, startOfMonth };
