// Synergy Admin — directory, audit, org settings.
import { mountShell, api, el, icon, snackbar, dialog, contextMenu, initials, fmtSize, fmtDate, toggleTheme } from '/shared/shell.js';

const S = { view: 'home', users: [], stats: {}, audit: [], q: '' };

document.getElementById('shell').appendChild(mountShell({
  app: 'admin',
  onSearch: v => { S.q = v; render(); },
}));

async function load() {
  [S.stats, S.users, S.audit] = await Promise.all([
    api.get('/admin/stats'), api.get('/users'), api.get('/admin/audit?limit=120'),
  ]);
  render();
}

const NAV = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'users', label: 'Directory', icon: 'group' },
  { id: 'apps', label: 'Apps', icon: 'apps' },
  { id: 'security', label: 'Security', icon: 'security' },
  { id: 'audit', label: 'Reporting', icon: 'analytics' },
  { id: 'settings', label: 'Account', icon: 'settings' },
];

function renderNav() {
  document.getElementById('nav').replaceChildren(...NAV.map(n => el('div', {
    class: 'nav-item' + (S.view === n.id ? ' active' : ''),
    onclick: () => { S.view = n.id; render(); },
  }, icon(n.icon), n.label)));
}

function render() {
  renderNav();
  const views = { home, users: usersView, apps, security, audit: auditView, settings };
  document.getElementById('main').replaceChildren((views[S.view] || home)());
}

function h2(text) {
  return el('h2', { class: 'gsans', style: 'font-weight:400;font-size:22px;margin:0 0 16px' }, text);
}

function home() {
  const s = S.stats;
  return el('div', { class: 'adm-wrap' }, h2('Admin console'),
    el('div', { class: 'cards' },
      ...[['Users', s.users], ['Files', s.files], ['Storage', fmtSize(s.storage)],
          ['Calendar events', s.events], ['Messages', s.messages], ['Chat spaces', s.spaces],
          ['Groups', s.groups]].map(([label, v]) =>
        el('div', { class: 'stat-card' }, el('b', {}, String(v)), el('span', {}, label)))),
    h2('Recent activity'), auditTable(S.audit.slice(0, 12)));
}

function usersView() {
  const list = S.users.filter(u => !S.q ||
    (u.name + u.email).toLowerCase().includes(S.q.toLowerCase()));
  const tbody = el('tbody');
  for (const u of list)
    tbody.append(el('tr', {},
      el('td', {}, el('div', { class: 'row gap12' },
        el('div', { class: 'avatar', style: `background:${u.avatar_color}` }, initials(u.name)),
        el('div', { class: 'col' }, el('span', {}, u.name),
          el('span', { class: 'muted', style: 'font-size:12px' }, u.email)))),
      el('td', {}, el('span', { class: 'pill ' + (u.role === 'superadmin' ? 'warn' : u.role === 'admin' ? 'ok' : '') },
        u.role)),
      el('td', {}, u.org_unit || '/'),
      el('td', {}, el('span', { class: 'pill ' + (u.suspended ? 'bad' : 'ok') },
        u.suspended ? 'Suspended' : 'Active')),
      el('td', { style: 'width:56px' }, el('button', {
        class: 'icon-btn',
        onclick: e => contextMenu(e.clientX, e.clientY, [
          { label: 'Change role', icon: 'admin_panel_settings', onClick: () => roleDialog(u) },
          {
            label: u.suspended ? 'Restore user' : 'Suspend user',
            icon: u.suspended ? 'person_add' : 'person_off', danger: !u.suspended,
            onClick: async () => {
              await api.patch('/admin/users/' + u.id, { suspended: u.suspended ? 0 : 1 });
              snackbar(u.suspended ? `${u.name} restored` : `${u.name} suspended`); load();
            },
          },
        ]),
      }, icon('more_vert')))));

  return el('div', { class: 'adm-wrap' },
    el('div', { class: 'row', style: 'margin-bottom:16px' },
      el('div', { class: 'spacer' }, h2(`Users (${list.length})`)),
      el('button', { class: 'btn btn-filled', onclick: newUser }, icon('person_add', 's18'), 'Add user')),
    el('table', { class: 'adm' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Name'), el('th', {}, 'Role'),
        el('th', {}, 'Org unit'), el('th', {}, 'Status'), el('th', {}))),
      tbody));
}

function roleDialog(u) {
  const sel = el('select', { class: 'field' },
    ...['member', 'admin', 'superadmin'].map(r => el('option', { value: r, selected: r === u.role }, r)));
  dialog(`Role for ${u.name}`, el('div', {}, sel), [
    { label: 'Cancel' },
    { label: 'Save', primary: true, onClick: async () => { await api.patch('/admin/users/' + u.id, { role: sel.value }); snackbar('Role updated'); load(); } },
  ]);
}

function newUser() {
  const name = el('input', { class: 'field', placeholder: 'Full name', style: 'margin-bottom:8px' });
  const email = el('input', { class: 'field', placeholder: 'Email address', style: 'margin-bottom:8px' });
  const role = el('select', { class: 'field' }, ...['member', 'admin', 'superadmin'].map(r => el('option', { value: r }, r)));
  dialog('Add a user', el('div', {}, name, email, role), [
    { label: 'Cancel' },
    {
      label: 'Add', primary: true, onClick: async () => {
        if (!name.value || !email.value) return snackbar('Name and email are required');
        await api.post('/admin/users', { name: name.value, email: email.value, role: role.value });
        snackbar('User created'); load();
      },
    },
  ]);
}

function apps() {
  const APPS = ['Mail', 'Drive', 'Docs', 'Sheets', 'Slides', 'Forms', 'Calendar', 'Keep',
    'Tasks', 'Contacts', 'Chat', 'Meet', 'Sites', 'Groups', 'Vault', 'Admin'];
  const tbody = el('tbody');
  for (const a of APPS)
    tbody.append(el('tr', {},
      el('td', {}, a),
      el('td', {}, el('span', { class: 'pill ok' }, 'ON for everyone')),
      el('td', { class: 'muted' }, 'All org units'),
      el('td', { style: 'width:56px' }, el('button', {
        class: 'icon-btn', onclick: () => snackbar(`${a} service settings`),
      }, icon('more_vert')))));
  return el('div', { class: 'adm-wrap' }, h2('Apps'),
    el('table', { class: 'adm' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Service'), el('th', {}, 'Status'),
        el('th', {}, 'Applies to'), el('th', {}))), tbody));
}

function security() {
  const rows = [
    ['Two-step verification', 'Enforced for administrators', 'ok'],
    ['Password strength', 'Minimum 12 characters', 'ok'],
    ['Session length', '14 days', 'ok'],
    ['External sharing', 'Restricted to allowlisted domains', 'warn'],
    ['Less secure app access', 'Blocked', 'ok'],
    ['Audit log retention', '180 days', 'ok'],
  ];
  return el('div', { class: 'adm-wrap' }, h2('Security'),
    el('table', { class: 'adm' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Setting'), el('th', {}, 'Value'), el('th', {}, 'Status'))),
      el('tbody', {}, ...rows.map(([k, v, s]) => el('tr', {},
        el('td', {}, k), el('td', { class: 'muted' }, v),
        el('td', {}, el('span', { class: 'pill ' + s }, s === 'ok' ? 'Compliant' : 'Review')))))));
}

function auditTable(rows) {
  return el('table', { class: 'adm' },
    el('thead', {}, el('tr', {}, el('th', {}, 'When'), el('th', {}, 'Actor'),
      el('th', {}, 'App'), el('th', {}, 'Action'), el('th', {}, 'Target'))),
    el('tbody', {}, ...rows.map(a => el('tr', {},
      el('td', { class: 'muted' }, new Date(a.at).toLocaleString()),
      el('td', {}, a.actor),
      el('td', {}, el('span', { class: 'pill' }, a.app)),
      el('td', {}, a.action),
      el('td', { class: 'log muted' }, `${a.target}${a.detail ? ' · ' + a.detail : ''}`)))));
}

function auditView() {
  const rows = S.audit.filter(a => !S.q ||
    JSON.stringify(a).toLowerCase().includes(S.q.toLowerCase()));
  return el('div', { class: 'adm-wrap' },
    el('div', { class: 'row', style: 'margin-bottom:16px' },
      el('div', { class: 'spacer' }, h2(`Audit log (${rows.length})`)),
      el('button', { class: 'btn btn-outline', onclick: () => { load(); snackbar('Refreshed'); } }, icon('refresh', 's18'), 'Refresh')),
    auditTable(rows));
}

function settings() {
  return el('div', { class: 'adm-wrap' }, h2('Account'),
    el('table', { class: 'adm' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Setting'), el('th', {}, 'Value'), el('th', {}))),
      el('tbody', {},
        row('Organisation', 'Synergy Technologies'),
        row('Primary domain', 'example.com'),
        row('Users', String(S.stats.users)),
        row('Storage used', fmtSize(S.stats.storage)),
        el('tr', {}, el('td', {}, 'Appearance'),
          el('td', { class: 'muted' }, 'Light / dark theme'),
          el('td', {}, el('button', { class: 'btn btn-outline', onclick: toggleTheme }, 'Toggle theme'))))));
  function row(k, v) { return el('tr', {}, el('td', {}, k), el('td', { class: 'muted' }, v), el('td', {})); }
}

load();
