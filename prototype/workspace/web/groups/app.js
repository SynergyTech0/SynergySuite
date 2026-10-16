// Synergy Groups — mailing lists and membership.
import { mountShell, api, el, icon, snackbar, dialog, initials } from '/shared/shell.js';

const S = { groups: [], sel: null, q: '' };

document.getElementById('shell').appendChild(mountShell({
  app: 'groups',
  onSearch: v => { S.q = v; render(); },
}));

async function load() {
  S.groups = await api.get('/groups');
  render();
}

function render() {
  document.getElementById('nav').replaceChildren(
    el('button', { class: 'fab-extended', style: 'margin:8px 8px 16px 4px;align-self:flex-start', onclick: create },
      icon('add', 's24'), 'Create group'),
    el('div', { class: 'nav-item active' }, icon('groups'), 'All groups'),
    el('div', { class: 'nav-item' }, icon('star'), 'My groups'));

  const list = S.groups.filter(g => !S.q || (g.name + g.email).toLowerCase().includes(S.q.toLowerCase()));
  const main = document.getElementById('main');
  if (!list.length) {
    main.replaceChildren(el('div', { class: 'empty' }, icon('groups'),
      el('h3', {}, 'No groups'), el('p', {}, 'Create a group to share a single address with a team.')));
    return;
  }
  const tbody = el('tbody');
  for (const g of list) {
    const members = JSON.parse(g.members || '[]');
    tbody.append(el('tr', { onclick: () => detail(g, members) },
      el('td', {}, el('div', { class: 'row gap12' },
        el('div', { class: 'avatar', style: 'background:#1a73e8' }, icon('groups')),
        el('div', { class: 'col' }, el('span', {}, g.name),
          el('span', { class: 'muted', style: 'font-size:12px' }, g.email)))),
      el('td', { class: 'muted' }, g.description || ''),
      el('td', {}, `${members.length} member${members.length === 1 ? '' : 's'}`),
      el('td', { class: 'muted' }, g.access)));
  }
  main.replaceChildren(el('div', { style: 'padding:24px' },
    el('h2', { class: 'gsans', style: 'font-weight:400;font-size:22px;margin:0 0 16px' }, `Groups (${list.length})`),
    el('table', { class: 'adm' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Group'), el('th', {}, 'Description'),
        el('th', {}, 'Members'), el('th', {}, 'Access'))), tbody)));
}

function detail(g, members) {
  dialog(g.name, el('div', {},
    el('div', { class: 'muted', style: 'margin-bottom:16px' }, g.email),
    g.description ? el('p', {}, g.description) : null,
    el('div', { class: 'divider', style: 'margin:12px 0' }),
    el('div', { style: 'font-weight:500;margin-bottom:8px' }, `Members (${members.length})`),
    ...members.map(m => el('div', { class: 'row gap12', style: 'padding:6px 0' },
      el('div', { class: 'avatar sm', style: 'background:#188038' }, initials(m.split('@')[0])),
      el('span', { class: 'spacer' }, m),
      el('span', { class: 'muted', style: 'font-size:12px' }, 'Member')))),
    [{ label: 'Close', primary: true }]);
}

function create() {
  const name = el('input', { class: 'field', placeholder: 'Group name', style: 'margin-bottom:8px' });
  const email = el('input', { class: 'field', placeholder: 'group@example.com', style: 'margin-bottom:8px' });
  const desc = el('input', { class: 'field', placeholder: 'Description', style: 'margin-bottom:8px' });
  const mem = el('input', { class: 'field', placeholder: 'Members (comma separated)' });
  dialog('Create group', el('div', {}, name, email, desc, mem), [
    { label: 'Cancel' },
    {
      label: 'Create', primary: true, onClick: async () => {
        if (!name.value || !email.value) return snackbar('Name and address are required');
        await api.post('/groups', {
          name: name.value, email: email.value, description: desc.value,
          members: mem.value.split(',').map(s => s.trim()).filter(Boolean),
        });
        snackbar('Group created'); load();
      },
    },
  ]);
}

load();
