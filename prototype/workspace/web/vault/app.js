// Synergy Vault — retention, legal holds, eDiscovery search across the suite.
import { mountShell, api, el, icon, snackbar, dialog, fmtDate, mimeMeta } from '/shared/shell.js';

const S = { view: 'matters', q: '', results: [], matters: [], holds: [], rules: [] };

// Matters/holds/rules are governance records; they live in localStorage until the
// compliance service exists, but searches run against the live suite data.
const store = {
  read(k, d) { try { return JSON.parse(localStorage.getItem('vault-' + k)) ?? d; } catch { return d; } },
  write(k, v) { try { localStorage.setItem('vault-' + k, JSON.stringify(v)); } catch {} },
};

document.getElementById('shell').appendChild(mountShell({
  app: 'vault',
  onSearch: v => { S.q = v; if (S.view === 'search') runSearch(); },
}));

const NAV = [
  { id: 'matters', label: 'Matters', icon: 'folder_special' },
  { id: 'holds', label: 'Holds', icon: 'gavel' },
  { id: 'retention', label: 'Retention', icon: 'schedule' },
  { id: 'search', label: 'Search', icon: 'search' },
];

function renderNav() {
  document.getElementById('nav').replaceChildren(...NAV.map(n => el('div', {
    class: 'nav-item' + (S.view === n.id ? ' active' : ''),
    onclick: () => { S.view = n.id; render(); },
  }, icon(n.icon), n.label)));
}

function h2(t, action) {
  return el('div', { class: 'row', style: 'margin-bottom:16px' },
    el('h2', { class: 'gsans spacer', style: 'font-weight:400;font-size:22px;margin:0' }, t),
    action || null);
}

function render() {
  renderNav();
  const main = document.getElementById('main');
  const views = { matters, holds, retention, search };
  main.replaceChildren(el('div', { style: 'padding:24px' }, views[S.view]()));
}

function matters() {
  S.matters = store.read('matters', [
    { id: 'M-2026-001', name: 'Northwind contract dispute', owner: 'dana@example.com', state: 'Open', created: Date.now() - 12 * 86400000 },
    { id: 'M-2026-002', name: 'Employment claim — redacted', owner: 'shane@example.com', state: 'Open', created: Date.now() - 40 * 86400000 },
    { id: 'M-2025-114', name: 'Vendor audit 2025', owner: 'shane@example.com', state: 'Closed', created: Date.now() - 300 * 86400000 },
  ]);
  const tbody = el('tbody', {}, ...S.matters.map(m => el('tr', { onclick: () => openMatter(m) },
    el('td', {}, m.id), el('td', {}, m.name), el('td', { class: 'muted' }, m.owner),
    el('td', {}, el('span', { class: 'pill ' + (m.state === 'Open' ? 'ok' : '') }, m.state)),
    el('td', { class: 'muted' }, fmtDate(m.created)))));
  return el('div', {},
    h2(`Matters (${S.matters.length})`,
      el('button', { class: 'btn btn-filled', onclick: newMatter }, icon('add', 's18'), 'New matter')),
    el('table', { class: 'adm' }, el('thead', {}, el('tr', {},
      el('th', {}, 'ID'), el('th', {}, 'Name'), el('th', {}, 'Owner'),
      el('th', {}, 'State'), el('th', {}, 'Created'))), tbody));
}

function openMatter(m) {
  dialog(m.name, el('div', {},
    el('div', { class: 'row', style: 'padding:6px 0' }, el('b', { style: 'width:110px;font-weight:500' }, 'Matter ID'), el('span', {}, m.id)),
    el('div', { class: 'row', style: 'padding:6px 0' }, el('b', { style: 'width:110px;font-weight:500' }, 'Owner'), el('span', {}, m.owner)),
    el('div', { class: 'row', style: 'padding:6px 0' }, el('b', { style: 'width:110px;font-weight:500' }, 'State'), el('span', {}, m.state)),
    el('div', { class: 'row', style: 'padding:6px 0' }, el('b', { style: 'width:110px;font-weight:500' }, 'Opened'), el('span', {}, new Date(m.created).toLocaleString())),
    el('div', { class: 'divider', style: 'margin:12px 0' }),
    el('p', { class: 'muted', style: 'font-size:13px;margin:0' },
      'Holds attached to this matter preserve data beyond its retention rule, across Mail, Drive and Chat.')),
    [
      { label: 'Search this matter', onClick: () => { S.view = 'search'; render(); } },
      { label: 'Close', primary: true },
    ]);
}

function newMatter() {
  const name = el('input', { class: 'field', placeholder: 'Matter name' });
  dialog('New matter', el('div', {}, name), [
    { label: 'Cancel' },
    {
      label: 'Create', primary: true, onClick: () => {
        if (!name.value.trim()) return;
        const id = 'M-' + new Date().getFullYear() + '-' + String(S.matters.length + 1).padStart(3, '0');
        S.matters.unshift({ id, name: name.value, owner: 'shane@example.com', state: 'Open', created: Date.now() });
        store.write('matters', S.matters); snackbar('Matter created'); render();
      },
    },
  ]);
}

function holds() {
  S.holds = store.read('holds', [
    { name: 'Northwind — all custodians', matter: 'M-2026-001', scope: 'Mail, Drive', custodians: 4, created: Date.now() - 11 * 86400000 },
    { name: 'Employment claim hold', matter: 'M-2026-002', scope: 'Mail', custodians: 2, created: Date.now() - 39 * 86400000 },
  ]);
  const tbody = el('tbody', {}, ...S.holds.map(h => el('tr', {},
    el('td', {}, h.name), el('td', { class: 'muted' }, h.matter), el('td', {}, h.scope),
    el('td', {}, String(h.custodians)), el('td', { class: 'muted' }, fmtDate(h.created)),
    el('td', {}, el('span', { class: 'pill warn' }, 'Active')))));
  return el('div', {},
    h2(`Holds (${S.holds.length})`,
      el('button', {
        class: 'btn btn-filled', onclick: () => {
          const name = el('input', { class: 'field', placeholder: 'Hold name' });
          dialog('New hold', el('div', {}, name), [{ label: 'Cancel' }, {
            label: 'Create', primary: true, onClick: () => {
              if (!name.value.trim()) return;
              S.holds.unshift({ name: name.value, matter: S.matters[0]?.id || '—', scope: 'Mail, Drive', custodians: 1, created: Date.now() });
              store.write('holds', S.holds); snackbar('Hold placed'); render();
            },
          }]);
        },
      }, icon('add', 's18'), 'New hold')),
    el('table', { class: 'adm' }, el('thead', {}, el('tr', {},
      el('th', {}, 'Hold'), el('th', {}, 'Matter'), el('th', {}, 'Scope'),
      el('th', {}, 'Custodians'), el('th', {}, 'Created'), el('th', {}, 'Status'))), tbody),
    el('p', { class: 'muted', style: 'font-size:13px;margin-top:16px' },
      'While a hold is active, matching data is preserved even if a user deletes it or its retention rule expires.'));
}

function retention() {
  S.rules = store.read('rules', [
    { scope: 'Mail', duration: '3 years', action: 'Delete', applies: 'Everyone' },
    { scope: 'Drive', duration: '7 years', action: 'Delete', applies: 'Everyone' },
    { scope: 'Chat', duration: '18 months', action: 'Delete', applies: 'Everyone' },
    { scope: 'Meet recordings', duration: '1 year', action: 'Delete', applies: 'Everyone' },
  ]);
  const tbody = el('tbody', {}, ...S.rules.map(r => el('tr', {},
    el('td', {}, r.scope), el('td', {}, r.duration), el('td', {}, r.action),
    el('td', { class: 'muted' }, r.applies),
    el('td', {}, el('span', { class: 'pill ok' }, 'Active')))));
  return el('div', {}, h2('Retention rules'),
    el('table', { class: 'adm' }, el('thead', {}, el('tr', {},
      el('th', {}, 'Scope'), el('th', {}, 'Duration'), el('th', {}, 'Action'),
      el('th', {}, 'Applies to'), el('th', {}, 'Status'))), tbody),
    el('p', { class: 'muted', style: 'font-size:13px;margin-top:16px' },
      'Retention rules run daily. A rule never removes data that an active hold covers.'));
}

function search() {
  const box = el('div', {},
    h2('Search all data'),
    el('div', { class: 'row gap8', style: 'margin-bottom:16px' },
      el('input', {
        class: 'field', id: 'vq', placeholder: 'Search Mail, Drive, Chat…', value: S.q,
        style: 'flex:1', onkeydown: e => { if (e.key === 'Enter') { S.q = e.target.value; runSearch(); } },
      }),
      el('button', {
        class: 'btn btn-filled',
        onclick: () => { S.q = document.getElementById('vq').value; runSearch(); },
      }, 'Search')),
    el('div', { id: 'vres' }));
  setTimeout(() => { if (S.results.length) paintResults(); }, 0);
  return box;
}

async function runSearch() {
  if (!S.q) return;
  S.results = await api.get('/search?q=' + encodeURIComponent(S.q));
  if (S.view !== 'search') { S.view = 'search'; render(); }
  paintResults();
}

function paintResults() {
  const box = document.getElementById('vres');
  if (!box) return;
  if (!S.results.length) {
    box.replaceChildren(el('div', { class: 'empty' }, icon('search_off'),
      el('h3', {}, 'No results'), el('p', {}, `Nothing in the suite matched “${S.q}”.`)));
    return;
  }
  box.replaceChildren(
    el('div', { class: 'muted', style: 'margin-bottom:8px;font-size:13px' },
      `${S.results.length} item(s) across ${new Set(S.results.map(r => r.app)).size} service(s)`),
    el('table', { class: 'adm' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Service'), el('th', {}, 'Item'),
        el('th', {}, 'Detail'), el('th', {}, 'Date'))),
      el('tbody', {}, ...S.results.map(r => el('tr', {},
        el('td', {}, el('span', { class: 'pill' }, r.app)),
        el('td', {}, r.title),
        el('td', { class: 'muted' }, r.sub || (r.mime ? mimeMeta(r.mime).label : '')),
        el('td', { class: 'muted' }, r.at ? fmtDate(r.at) : ''))))),
    el('div', { class: 'row gap8', style: 'margin-top:16px' },
      el('button', {
        class: 'btn btn-outline',
        onclick: () => {
          const csv = ['Service,Item,Detail,Date',
            ...S.results.map(r => `"${r.app}","${r.title}","${r.sub || ''}","${r.at ? new Date(r.at).toISOString() : ''}"`)].join('\n');
          const a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'vault-export.csv' });
          document.body.appendChild(a); a.click(); a.remove();
          snackbar('Export downloaded');
        },
      }, icon('download', 's18'), 'Export results')));
}

render();
