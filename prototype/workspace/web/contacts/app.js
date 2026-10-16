// Synergy Contacts
import { mountShell, api, el, icon, snackbar, dialog, contextMenu, initials, fmtDate } from '/shared/shell.js';

const S = { view: 'all', list: [], q: '', sel: null };

document.getElementById('shell').appendChild(mountShell({
  app: 'contacts',
  onSearch: v => { S.q = v; load(); },
}));

async function load() {
  const p = new URLSearchParams({ view: S.view });
  if (S.q) p.set('q', S.q);
  S.list = await api.get('/contacts?' + p);
  render();
}

function renderNav() {
  const items = [
    { id: 'all', label: 'Contacts', icon: 'person' },
    { id: 'starred', label: 'Starred', icon: 'star' },
  ];
  document.getElementById('nav').replaceChildren(
    el('button', {
      class: 'fab-extended', style: 'margin:8px 8px 16px 4px;align-self:flex-start',
      onclick: () => edit(null),
    }, icon('add', 's24'), 'Create contact'),
    ...items.map(i => el('div', {
      class: 'nav-item' + (S.view === i.id ? ' active' : ''),
      onclick: () => { S.view = i.id; load(); },
    }, icon(i.icon), el('span', { class: 'spacer' }, i.label),
      el('span', { class: 'count' }, String(i.id === 'all' ? S.list.length : S.list.filter(c => c.starred).length)))));
}

function render() {
  renderNav();
  const main = document.getElementById('main');
  if (!S.list.length) {
    main.replaceChildren(el('div', { class: 'empty' }, icon('contacts'),
      el('h3', {}, S.q ? 'No matching contacts' : 'No contacts yet'),
      el('p', {}, S.q ? `Nothing matched “${S.q}”.` : 'Add someone to get started.')));
    return;
  }
  const tbody = el('tbody');
  for (const c of S.list)
    tbody.append(el('tr', { onclick: () => showDetails(c) },
      el('td', {}, el('div', { class: 'cname' },
        el('div', { class: 'avatar', style: `background:${c.photo_color || '#0b57d0'}` }, initials(c.name)),
        el('span', {}, c.name),
        c.starred ? el('span', { class: 'mi s18 fill', style: 'color:#f9ab00' }, 'star') : null)),
      el('td', { class: 'muted' }, c.email || ''),
      el('td', { class: 'muted' }, c.phone || ''),
      el('td', { class: 'muted' }, [c.job_title, c.company].filter(Boolean).join(', ')),
      el('td', { style: 'width:120px' }, el('div', { class: 'row gap4' },
        el('button', {
          class: 'icon-btn', 'data-tip': 'Star',
          onclick: async e => { e.stopPropagation(); await api.patch('/contacts/' + c.id, { starred: c.starred ? 0 : 1 }); load(); },
        }, el('span', { class: 'mi s18' + (c.starred ? ' fill' : ''), style: c.starred ? 'color:#f9ab00' : '' }, c.starred ? 'star' : 'star_border')),
        el('button', { class: 'icon-btn', 'data-tip': 'Edit', onclick: e => { e.stopPropagation(); edit(c); } }, icon('edit', 's18')),
        el('button', {
          class: 'icon-btn', 'data-tip': 'Delete',
          onclick: async e => { e.stopPropagation(); await api.del('/contacts/' + c.id); snackbar(`${c.name} deleted`); load(); },
        }, icon('delete', 's18'))))));

  main.replaceChildren(el('table', { class: 'ct' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Name'), el('th', {}, 'Email'),
      el('th', {}, 'Phone number'), el('th', {}, 'Job title & company'), el('th', {}))),
    tbody));
}

function showDetails(c) {
  const pane = document.getElementById('details');
  pane.classList.remove('hidden');
  pane.replaceChildren(
    el('div', { class: 'row', style: 'justify-content:flex-end' },
      el('button', { class: 'icon-btn', onclick: () => pane.classList.add('hidden') }, icon('close'))),
    el('div', { class: 'col', style: 'align-items:center;gap:8px;margin-bottom:16px' },
      el('div', { class: 'avatar lg', style: `background:${c.photo_color || '#0b57d0'}` }, initials(c.name)),
      el('h3', { class: 'gsans', style: 'margin:8px 0 0;font-weight:400;font-size:20px' }, c.name),
      c.job_title ? el('span', { class: 'muted' }, `${c.job_title}${c.company ? ' · ' + c.company : ''}`) : null,
      el('div', { class: 'row gap8', style: 'margin-top:12px' },
        el('button', { class: 'btn btn-outline', onclick: () => location.href = '/mail/' }, icon('mail', 's18'), 'Email'),
        el('button', { class: 'btn btn-outline', onclick: () => edit(c) }, icon('edit', 's18'), 'Edit'))),
    el('div', { class: 'divider' }),
    el('div', { style: 'padding-top:8px' },
      c.email ? el('div', { class: 'drow' }, icon('mail'), el('div', { class: 'col' },
        el('span', {}, c.email), el('span', { class: 'muted', style: 'font-size:12px' }, 'Email'))) : null,
      c.phone ? el('div', { class: 'drow' }, icon('call'), el('div', { class: 'col' },
        el('span', {}, c.phone), el('span', { class: 'muted', style: 'font-size:12px' }, 'Phone'))) : null,
      c.company ? el('div', { class: 'drow' }, icon('business'), el('div', { class: 'col' },
        el('span', {}, c.company), el('span', { class: 'muted', style: 'font-size:12px' }, 'Company'))) : null,
      c.notes ? el('div', { class: 'drow' }, icon('notes'), el('span', {}, c.notes)) : null,
      el('div', { class: 'drow' }, icon('schedule'), el('div', { class: 'col' },
        el('span', {}, fmtDate(c.created)), el('span', { class: 'muted', style: 'font-size:12px' }, 'Added')))));
}

function edit(c) {
  const f = {};
  const field = (key, label, type = 'text') => {
    f[key] = el('input', { class: 'field', type, value: c?.[key] || '', style: 'margin-bottom:10px' });
    return el('div', {}, el('label', { class: 'field-label' }, label), f[key]);
  };
  const notes = el('textarea', { class: 'field', rows: 3 }, c?.notes || '');
  dialog(c ? 'Edit contact' : 'Create contact', el('div', {},
    field('name', 'Name'), field('email', 'Email', 'email'), field('phone', 'Phone'),
    field('company', 'Company'), field('job_title', 'Job title'),
    el('label', { class: 'field-label' }, 'Notes'), notes), [
    { label: 'Cancel' },
    {
      label: 'Save', primary: true, onClick: async () => {
        if (!f.name.value.trim()) return snackbar('Name is required');
        const payload = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.value]));
        payload.notes = notes.value;
        if (c) await api.patch('/contacts/' + c.id, payload);
        else await api.post('/contacts', { ...payload, photo_color: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0') });
        snackbar(c ? 'Contact updated' : 'Contact created');
        load();
      },
    },
  ]);
}

load();
