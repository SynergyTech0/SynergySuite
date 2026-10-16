// Synergy Calendar — day / week / month, mini calendar, event editing.
import { mountShell, api, el, icon, snackbar, dialog, contextMenu } from '/shared/shell.js';

const DAY = 86400000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const S = {
  view: 'week', anchor: startOfDay(new Date()), miniMonth: new Date(),
  events: [], calendars: [], q: '',
};

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function startOfWeek(d) { const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x; }
function sameDay(a, b) { return startOfDay(a).getTime() === startOfDay(b).getTime(); }
const isToday = d => sameDay(d, new Date());
const fmtTime = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(':00', '');

document.getElementById('shell').appendChild(mountShell({
  app: 'calendar',
  onSearch: v => { S.q = v; render(); },
  right: [el('button', { class: 'icon-btn', 'data-tip': 'Today', onclick: () => { S.anchor = startOfDay(new Date()); S.miniMonth = new Date(); render(); } }, icon('today'))],
}));

// ------------------------------------------------------------------ data
async function load() {
  const from = S.anchor.getTime() - 45 * DAY, to = S.anchor.getTime() + 45 * DAY;
  [S.calendars, S.events] = await Promise.all([
    api.get('/calendar/calendars'),
    api.get(`/calendar/events?from=${from}&to=${to}`),
  ]);
  render();
}

const visibleEvents = () => S.events.filter(e => {
  const cal = S.calendars.find(c => c.id === e.calendar_id);
  if (cal && !cal.visible) return false;
  if (S.q && !(e.title || '').toLowerCase().includes(S.q.toLowerCase())) return false;
  return true;
});

// ------------------------------------------------------------------ nav
function renderNav() {
  const nav = document.getElementById('nav');
  const btn = el('button', { class: 'fab-extended', style: 'margin:8px 8px 12px 12px;align-self:flex-start', onclick: () => editEvent(null) },
    icon('add', 's24'), 'Create');

  // mini month
  const m = S.miniMonth;
  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const start = startOfWeek(first);
  const tbody = el('tbody');
  for (let w = 0; w < 6; w++) {
    const tr = el('tr');
    for (let d = 0; d < 7; d++) {
      const day = new Date(start.getTime() + (w * 7 + d) * DAY);
      tr.append(el('td', {}, el('span', {
        class: (isToday(day) ? 'today ' : '') + (sameDay(day, S.anchor) && !isToday(day) ? 'sel ' : '') +
          (day.getMonth() !== m.getMonth() ? 'other' : ''),
        onclick: () => { S.anchor = startOfDay(day); render(); },
      }, String(day.getDate()))));
    }
    tbody.append(tr);
  }
  const mini = el('div', { class: 'mini' },
    el('div', { class: 'mini-head' },
      el('span', { class: 'spacer gsans' }, `${MON[m.getMonth()]} ${m.getFullYear()}`),
      el('button', { class: 'icon-btn', style: 'width:28px;height:28px', onclick: () => { S.miniMonth = new Date(m.getFullYear(), m.getMonth() - 1, 1); render(); } }, icon('chevron_left', 's18')),
      el('button', { class: 'icon-btn', style: 'width:28px;height:28px', onclick: () => { S.miniMonth = new Date(m.getFullYear(), m.getMonth() + 1, 1); render(); } }, icon('chevron_right', 's18'))),
    el('table', {}, el('thead', {}, el('tr', {}, ...['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => el('th', {}, d)))), tbody));

  nav.replaceChildren(btn, mini, el('div', { class: 'nav-divider' }),
    el('div', { class: 'nav-section' }, 'My calendars'),
    ...S.calendars.map(c => el('div', {
      class: 'nav-item', style: 'padding-left:12px',
      onclick: async () => { await api.patch('/calendar/calendars/' + c.id, { visible: c.visible ? 0 : 1 }); load(); },
    },
      el('span', {
        style: `width:16px;height:16px;border-radius:3px;flex:none;border:2px solid ${c.color};background:${c.visible ? c.color : 'transparent'};display:inline-flex;align-items:center;justify-content:center`,
      }, c.visible ? el('span', { class: 'mi', style: 'font-size:12px;color:#fff' }, 'check') : null),
      el('span', { class: 'truncate' }, c.name))));
}

// ------------------------------------------------------------------ views
function render() {
  renderNav();
  const main = document.getElementById('main');
  main.replaceChildren(header(),
    S.view === 'month' ? monthView() : timeView(S.view === 'day' ? 1 : 7));
}

function header() {
  const a = S.anchor;
  let label;
  if (S.view === 'day') label = a.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
  else if (S.view === 'month') label = `${MON[a.getMonth()]} ${a.getFullYear()}`;
  else {
    const s = startOfWeek(a), e = new Date(s.getTime() + 6 * DAY);
    label = s.getMonth() === e.getMonth()
      ? `${MON[s.getMonth()]} ${s.getDate()} – ${e.getDate()}, ${s.getFullYear()}`
      : `${MON[s.getMonth()].slice(0, 3)} ${s.getDate()} – ${MON[e.getMonth()].slice(0, 3)} ${e.getDate()}, ${e.getFullYear()}`;
  }
  const step = d => {
    const n = new Date(S.anchor);
    if (S.view === 'day') n.setDate(n.getDate() + d);
    else if (S.view === 'week') n.setDate(n.getDate() + 7 * d);
    else n.setMonth(n.getMonth() + d);
    S.anchor = startOfDay(n); S.miniMonth = new Date(n); load();
  };
  return el('div', { class: 'cal-head' },
    el('button', { class: 'btn btn-outline', onclick: () => { S.anchor = startOfDay(new Date()); S.miniMonth = new Date(); render(); } }, 'Today'),
    el('button', { class: 'icon-btn', 'data-tip': 'Previous', onclick: () => step(-1) }, icon('chevron_left', 's24')),
    el('button', { class: 'icon-btn', 'data-tip': 'Next', onclick: () => step(1) }, icon('chevron_right', 's24')),
    el('h2', {}, label),
    el('div', { class: 'spacer' }),
    ...['day', 'week', 'month'].map(v => el('button', {
      class: 'chip' + (S.view === v ? ' on' : ''), style: 'margin-left:6px',
      onclick: () => { S.view = v; render(); },
    }, v[0].toUpperCase() + v.slice(1))));
}

function timeView(days) {
  const start = days === 1 ? startOfDay(S.anchor) : startOfWeek(S.anchor);
  const cols = Array.from({ length: days }, (_, i) => new Date(start.getTime() + i * DAY));

  const head = el('div', { class: 'grid-head' }, el('div', { class: 'gutter' }),
    ...cols.map(d => el('div', { class: 'dcol' + (isToday(d) ? ' today' : '') },
      el('div', { class: 'dow' }, DOW[d.getDay()]),
      el('div', { class: 'dnum', onclick: () => { S.anchor = startOfDay(d); S.view = 'day'; render(); } }, String(d.getDate())))));

  const grid = el('div', { class: 'tgrid' });
  for (let h = 0; h < 24; h++) {
    grid.append(el('div', { class: 'trow' },
      el('div', { class: 'gutter' }, h === 0 ? '' : `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`),
      ...cols.map((d, ci) => el('div', {
        class: 'cell',
        onclick: () => {
          const s = new Date(d); s.setHours(h, 0, 0, 0);
          editEvent({ start: s.getTime(), end: s.getTime() + 3600000 });
        },
      }))));
  }

  // overlay events per column
  const overlay = el('div', { style: 'position:absolute;inset:0;pointer-events:none' });
  const colW = `calc((100% - 60px) / ${days})`;
  cols.forEach((d, ci) => {
    const dayStart = startOfDay(d).getTime(), dayEnd = dayStart + DAY;
    const evs = visibleEvents().filter(e => e.start < dayEnd && e.end > dayStart)
      .sort((a, b) => a.start - b.start);
    const lane = el('div', {
      class: 'daycol',
      style: `left:calc(60px + ${colW} * ${ci});width:${colW};pointer-events:auto`,
    });
    // simple overlap packing
    const groups = [];
    for (const e of evs) {
      let g = groups.find(gr => gr.some(x => x.start < e.end && x.end > e.start));
      if (g) g.push(e); else groups.push([e]);
    }
    for (const g of groups) {
      g.forEach((e, i) => {
        const top = ((Math.max(e.start, dayStart) - dayStart) / DAY) * (24 * 48);
        const hgt = Math.max(18, ((Math.min(e.end, dayEnd) - Math.max(e.start, dayStart)) / DAY) * (24 * 48) - 2);
        const w = 100 / g.length;
        lane.append(el('div', {
          class: 'ev',
          style: `top:${top}px;height:${hgt}px;background:${e.cal_color || '#0b57d0'};left:calc(${i * w}% + 2px);width:calc(${w}% - 4px)`,
          onclick: ev => { ev.stopPropagation(); showEvent(e); },
        }, el('b', {}, e.recurring ? '⟳ ' + e.title : e.title),
           hgt > 30 ? el('span', {}, fmtTime(e.start)) : null));
      });
    }
    overlay.append(lane);
  });

  const now = new Date();
  if (cols.some(d => isToday(d))) {
    const top = ((now - startOfDay(now)) / DAY) * (24 * 48);
    overlay.append(el('div', { class: 'nowline', style: `top:${top}px` }));
  }
  grid.append(overlay);
  grid.style.position = 'relative';

  setTimeout(() => { grid.scrollTop = 7.5 * 48; }, 0);
  return el('div', { class: 'col', style: 'flex:1;min-height:0;display:flex;flex-direction:column' }, head, grid);
}

function monthView() {
  const first = new Date(S.anchor.getFullYear(), S.anchor.getMonth(), 1);
  const start = startOfWeek(first);
  const grid = el('div', { class: 'mgrid' },
    el('div', { class: 'mrow' }, ...DOW.map(d => el('div', { class: 'mdow' }, d))));
  for (let w = 0; w < 6; w++) {
    const row = el('div', { class: 'mrow' });
    for (let d = 0; d < 7; d++) {
      const day = new Date(start.getTime() + (w * 7 + d) * DAY);
      const ds = startOfDay(day).getTime(), de = ds + DAY;
      const evs = visibleEvents().filter(e => e.start < de && e.end > ds).sort((a, b) => a.start - b.start);
      row.append(el('div', {
        class: 'mcell' + (isToday(day) ? ' today' : '') + (day.getMonth() !== S.anchor.getMonth() ? ' other' : ''),
        onclick: () => { const s = new Date(day); s.setHours(9, 0, 0, 0); editEvent({ start: s.getTime(), end: s.getTime() + 3600000 }); },
      },
        el('div', { class: 'n' }, String(day.getDate())),
        ...evs.slice(0, 3).map(e => el('div', {
          class: 'mev', style: `background:${e.cal_color || '#0b57d0'}`,
          onclick: ev => { ev.stopPropagation(); showEvent(e); },
        }, `${fmtTime(e.start)} ${e.title}`)),
        evs.length > 3 ? el('div', { style: 'font-size:11px;color:var(--on-surface-variant);padding-left:4px' }, `+${evs.length - 3} more`) : null));
    }
    grid.append(row);
  }
  return grid;
}

// ------------------------------------------------------------------ event dialogs
function showEvent(e) {
  const cal = S.calendars.find(c => c.id === e.calendar_id);
  dialog(e.title, el('div', {},
    el('div', { class: 'row gap12', style: 'padding:6px 0' }, icon('schedule'),
      el('span', {}, `${new Date(e.start).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} · ${fmtTime(e.start)} – ${fmtTime(e.end)}`)),
    e.rrule ? el('div', { class: 'row gap12', style: 'padding:6px 0' }, icon('repeat'),
      el('span', {}, describeRrule(e.rrule))) : null,
    cal ? el('div', { class: 'row gap12', style: 'padding:6px 0' }, icon('calendar_month'), el('span', {}, cal.name)) : null,
    e.location ? el('div', { class: 'row gap12', style: 'padding:6px 0' }, icon('location_on'), el('span', {}, e.location)) : null,
    e.meet_link ? el('div', { class: 'row gap12', style: 'padding:6px 0' }, icon('videocam'),
      el('a', { href: '/meet/?code=' + e.meet_link.split('/').pop(), style: 'color:var(--blue-700)' }, e.meet_link)) : null,
    e.description ? el('div', { class: 'row gap12', style: 'padding:6px 0' }, icon('notes'), el('span', {}, e.description)) : null,
    (e.attendees || []).length ? el('div', { class: 'row gap12', style: 'padding:6px 0;align-items:flex-start' }, icon('group'),
      el('div', { class: 'col gap4' }, ...e.attendees.map(a => el('span', {}, a.email,
        el('span', { class: 'muted', style: 'font-size:12px' }, a.response === 'accepted' ? ' · Yes' : ' · Awaiting'))))) : null,
  ), [
    { label: 'Delete', onClick: async () => {
        await api.del('/calendar/events/' + e.id);
        snackbar(e.rrule ? 'Recurring event deleted' : 'Event deleted'); load();
      } },
    { label: 'Edit', onClick: () => setTimeout(() => editEvent(e), 50) },
    { label: 'Close', primary: true },
  ]);
}

function editEvent(e) {
  const isNew = !e || !e.id;
  const startD = new Date(e?.start || Date.now());
  const endD = new Date(e?.end || Date.now() + 3600000);
  const toDate = d => d.toISOString().slice(0, 10);
  const toTime = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  const title = el('input', { class: 'field', placeholder: 'Add title', value: e?.title || '' });
  const date = el('input', { class: 'field', type: 'date', value: toDate(startD) });
  const t1 = el('input', { class: 'field', type: 'time', value: toTime(startD) });
  const t2 = el('input', { class: 'field', type: 'time', value: toTime(endD) });
  const calSel = el('select', { class: 'field' }, ...S.calendars.map(c =>
    el('option', { value: c.id, selected: c.id === e?.calendar_id }, c.name)));
  const loc = el('input', { class: 'field', placeholder: 'Add location', value: e?.location || '' });
  const desc = el('textarea', { class: 'field', rows: 3, placeholder: 'Add description' }, e?.description || '');
  const guests = el('input', { class: 'field', placeholder: 'Add guests (comma separated)' });
  const meet = el('input', { type: 'checkbox', checked: !!e?.meet_link });
  const RRULES = [
    ['', 'Does not repeat'],
    ['FREQ=DAILY', 'Daily'],
    ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'Every weekday (Mon–Fri)'],
    ['FREQ=WEEKLY', 'Weekly'],
    ['FREQ=WEEKLY;INTERVAL=2', 'Every 2 weeks'],
    ['FREQ=MONTHLY', 'Monthly'],
    ['FREQ=YEARLY', 'Annually'],
  ];
  const repeat = el('select', { class: 'field' },
    ...RRULES.map(([v, l]) => el('option', { value: v, selected: (e?.rrule || '') === v }, l)));

  dialog(isNew ? 'New event' : 'Edit event', el('div', { class: 'col gap8' },
    title,
    el('div', { class: 'row gap8' }, date, t1, el('span', {}, '–'), t2),
    el('label', { class: 'field-label' }, 'Repeat'), repeat,
    el('label', { class: 'field-label' }, 'Calendar'), calSel,
    loc, guests, desc,
    el('label', { class: 'row gap8', style: 'padding:4px 0;cursor:pointer' }, meet, icon('videocam'), el('span', {}, 'Add Synergy Meet video conferencing'))),
    [
      { label: 'Cancel' },
      {
        label: 'Save', primary: true, onClick: async () => {
          const [y, mo, d] = date.value.split('-').map(Number);
          const [h1, m1] = t1.value.split(':').map(Number);
          const [h2, m2] = t2.value.split(':').map(Number);
          const s = new Date(y, mo - 1, d, h1, m1).getTime();
          let en = new Date(y, mo - 1, d, h2, m2).getTime();
          if (en <= s) en = s + 3600000;
          const payload = {
            title: title.value || '(No title)', description: desc.value, location: loc.value,
            start: s, end: en, calendar_id: calSel.value, meet: meet.checked,
            rrule: repeat.value || null,
            attendees: guests.value.split(',').map(x => x.trim()).filter(Boolean),
          };
          if (isNew) await api.post('/calendar/events', payload);
          else await api.patch('/calendar/events/' + e.id, payload);
          snackbar(isNew ? 'Event created' : 'Event updated');
          load();
        },
      },
    ]);
}

document.addEventListener('keydown', e => {
  if (e.target.matches('input,textarea,select')) return;
  const map = { d: 'day', w: 'week', m: 'month' };
  if (map[e.key.toLowerCase()]) { S.view = map[e.key.toLowerCase()]; render(); }
  if (e.key.toLowerCase() === 't') { S.anchor = startOfDay(new Date()); S.miniMonth = new Date(); render(); }
  if (e.key === 'c') editEvent(null);
});

load();


function describeRrule(r) {
  const p = Object.fromEntries(r.split(';').map(kv => kv.split('=')));
  const n = p.INTERVAL && p.INTERVAL !== '1' ? `every ${p.INTERVAL} ` : '';
  if (p.BYDAY === 'MO,TU,WE,TH,FR') return 'Every weekday (Mon–Fri)';
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[p.FREQ];
  if (!unit) return 'Repeats';
  return n ? `Repeats ${n}${unit}s` : `Repeats ${{ day: 'daily', week: 'weekly', month: 'monthly', year: 'annually' }[unit]}`;
}
