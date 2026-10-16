// Synergy Drive
import {
  mountShell, api, el, icon, fmtSize, fmtDate, mimeMeta, MIME,
  snackbar, dialog, contextMenu,
} from '/shared/shell.js';

const state = {
  view: 'my', parent: null, layout: localStorage.getItem('drive-layout') || 'list',
  sort: 'modified', dir: 'desc', q: '', files: [], sel: new Set(), typeFilter: '',
};

document.getElementById('shell').appendChild(mountShell({
  app: 'drive',
  onSearch: v => { state.q = v; load(); },
  right: [
    el('button', {
      class: 'icon-btn', 'data-tip': 'Grid view', id: 'layoutBtn',
      onclick: () => {
        state.layout = state.layout === 'list' ? 'grid' : 'list';
        localStorage.setItem('drive-layout', state.layout); render();
      },
    }, icon('grid_view', 's24')),
  ],
}));

// ------------------------------------------------------------------- nav
const NAV = [
  { id: 'my', label: 'My Drive', icon: 'hard_drive' },
  { id: 'shared', label: 'Shared with me', icon: 'folder_shared' },
  { id: 'recent', label: 'Recent', icon: 'schedule' },
  { id: 'starred', label: 'Starred', icon: 'star' },
  { id: 'trash', label: 'Trash', icon: 'delete' },
];

function newMenu(anchor) {
  const r = anchor.getBoundingClientRect();
  contextMenu(r.left, r.bottom + 4, [
    { label: 'New folder', icon: 'create_new_folder', onClick: () => createPrompt(MIME.folder, 'Untitled folder') },
    '-',
    { label: 'Synergy Docs', icon: 'description', onClick: () => createPrompt(MIME.doc, 'Untitled document') },
    { label: 'Synergy Sheets', icon: 'table_chart', onClick: () => createPrompt(MIME.sheet, 'Untitled spreadsheet') },
    { label: 'Synergy Slides', icon: 'slideshow', onClick: () => createPrompt(MIME.slide, 'Untitled presentation') },
    { label: 'Synergy Forms', icon: 'checklist', onClick: () => createPrompt(MIME.form, 'Untitled form') },
    '-',
    { label: 'File upload', icon: 'upload_file', onClick: uploadFile },
  ]);
}

function renderNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = '';
  const btn = el('button', { class: 'fab-extended new-btn', onclick: e => { e.stopPropagation(); newMenu(btn); } },
    icon('add', 's24'), 'New');
  nav.appendChild(btn);
  for (const n of NAV)
    nav.appendChild(el('div', {
      class: 'nav-item' + (state.view === n.id && !state.parent ? ' active' : ''),
      onclick: () => { state.view = n.id; state.parent = null; state.sel.clear(); load(); },
    }, icon(n.icon), n.label));
  nav.appendChild(el('div', { class: 'nav-divider' }));
  nav.appendChild(el('div', { class: 'storage', id: 'storage' }));
}

// ------------------------------------------------------------------- data
async function load() {
  const p = new URLSearchParams();
  if (state.parent) p.set('parent', state.parent); else p.set('view', state.view);
  if (state.q) p.set('q', state.q);
  if (state.typeFilter) p.set('mime', state.typeFilter);
  state.files = await api.get('/drive/files?' + p);
  render();
  renderStorage();
}

async function renderStorage() {
  const s = await api.get('/drive/storage');
  const pct = Math.min(100, (s.used / s.quota) * 100);
  const box = document.getElementById('storage');
  if (!box) return;
  box.innerHTML = '';
  box.append(
    el('div', { class: 'row gap8' }, icon('cloud', 's18'), el('span', {}, 'Storage')),
    el('div', { class: 'storage-bar' }, el('i', { style: `width:${Math.max(pct, 1.5)}%` })),
    el('div', {}, `${fmtSize(s.used)} of ${fmtSize(s.quota)} used`),
    el('button', { class: 'btn btn-outline', style: 'margin-top:10px;height:32px;font-size:13px' }, 'Get more storage'));
}

// ------------------------------------------------------------------- render
function sortFiles(rows) {
  const k = state.sort, d = state.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const af = a.mime === MIME.folder, bf = b.mime === MIME.folder;
    if (af !== bf) return af ? -1 : 1;
    let va = a[k], vb = b[k];
    if (k === 'name') return a.name.localeCompare(b.name) * d;
    return ((va || 0) - (vb || 0)) * d;
  });
}

function render() {
  renderNav();
  const main = document.getElementById('main');
  main.innerHTML = '';
  document.getElementById('layoutBtn').replaceChildren(
    icon(state.layout === 'list' ? 'grid_view' : 'format_list_bulleted', 's24'));

  // breadcrumb
  const head = el('div', { class: 'drive-head' });
  const crumb = el('div', { class: 'crumb gsans' });
  const title = state.parent ? null : (NAV.find(n => n.id === state.view) || {}).label;
  if (title) crumb.append(el('a', { href: '#' }, title));
  head.append(crumb, el('div', { class: 'spacer' }));
  main.append(head);

  if (state.parent) {
    api.get('/drive/breadcrumb/' + state.parent).then(cs => {
      crumb.innerHTML = '';
      crumb.append(el('a', {
        href: '#', onclick: e => { e.preventDefault(); state.parent = null; state.view = 'my'; load(); },
      }, 'My Drive'));
      cs.forEach((c, i) => {
        crumb.append(el('span', { class: 'mi sep' }, 'chevron_right'));
        crumb.append(el('a', {
          href: '#', onclick: e => { e.preventDefault(); state.parent = c.id; load(); },
        }, c.name));
      });
    });
  }

  // filter chips
  const TYPES = [['', 'All'], [MIME.folder, 'Folders'], [MIME.doc, 'Documents'],
                 [MIME.sheet, 'Spreadsheets'], [MIME.slide, 'Presentations']];
  const filters = el('div', { class: 'filters' },
    ...TYPES.map(([m, label]) => el('button', {
      class: 'chip' + (state.typeFilter === m ? ' on' : ''),
      onclick: () => { state.typeFilter = m; load(); },
    }, label)),
    el('div', { class: 'spacer' }),
    el('span', { class: 'muted', style: 'font-size:13px' },
      `${state.files.length} item${state.files.length === 1 ? '' : 's'}`));
  main.append(filters);

  if (!state.files.length) {
    main.append(el('div', { class: 'empty' },
      icon(state.view === 'trash' ? 'delete' : 'folder_open'),
      el('h3', {}, state.q ? 'No results' : state.view === 'trash' ? 'Trash is empty' : 'A place for all your files'),
      el('p', {}, state.q ? `Nothing matched “${state.q}”.`
        : 'Drag files here, or use the New button to get started.')));
    return;
  }

  main.append(state.layout === 'list' ? listView() : gridView());
}

function listView() {
  const rows = sortFiles(state.files);
  const th = (k, label, extra = '') => el('th', {
    style: extra,
    onclick: () => { if (state.sort === k) state.dir = state.dir === 'asc' ? 'desc' : 'asc'; else { state.sort = k; state.dir = k === 'name' ? 'asc' : 'desc'; } render(); },
  }, label, state.sort === k ? el('span', { class: 'mi s18', style: 'vertical-align:-4px' },
    state.dir === 'asc' ? 'arrow_upward' : 'arrow_downward') : null);

  const tbody = el('tbody');
  for (const f of rows) {
    const m = mimeMeta(f.mime);
    const tr = el('tr', {
      class: state.sel.has(f.id) ? 'sel' : '',
      onclick: e => select(f, e),
      ondblclick: () => open(f),
      oncontextmenu: e => { e.preventDefault(); select(f, {}); fileMenu(f, e.clientX, e.clientY); },
    },
      el('td', {}, el('div', { class: 'fname' },
        el('span', { class: 'mi fill', style: `color:${m.color}` }, m.icon),
        el('span', { class: 'truncate' }, f.name),
        f.starred ? el('span', { class: 'mi s18 fill', style: 'color:#f9ab00' }, 'star') : null,
        (f.shared || []).length ? el('span', { class: 'mi s18 muted', 'data-tip': 'Shared' }, 'group') : null)),
      el('td', { class: 'col-owner' }, 'me'),
      el('td', { class: 'col-owner' }, fmtDate(f.modified)),
      el('td', { class: 'col-size' }, f.mime === MIME.folder ? '—' : fmtSize(f.size)),
      el('td', { style: 'width:48px' }, el('button', {
        class: 'icon-btn', onclick: e => { e.stopPropagation(); fileMenu(f, e.clientX, e.clientY); },
      }, icon('more_vert'))));
    tbody.append(tr);
  }
  return el('table', { class: 'files' },
    el('thead', {}, el('tr', {},
      th('name', 'Name'), el('th', {}, 'Owner'),
      th('modified', 'Last modified'), th('size', 'File size'), el('th', {}))),
    tbody);
}

function gridView() {
  const wrap = el('div', { class: 'tiles' });
  for (const f of sortFiles(state.files)) {
    const m = mimeMeta(f.mime);
    wrap.append(el('div', {
      class: 'ftile' + (state.sel.has(f.id) ? ' sel' : ''),
      onclick: e => select(f, e), ondblclick: () => open(f),
      oncontextmenu: e => { e.preventDefault(); select(f, {}); fileMenu(f, e.clientX, e.clientY); },
    },
      el('div', { class: 'head' },
        el('span', { class: 'mi fill', style: `color:${m.color}` }, m.icon),
        el('span', { class: 'truncate spacer' }, f.name),
        el('button', {
          class: 'icon-btn', style: 'width:28px;height:28px',
          onclick: e => { e.stopPropagation(); fileMenu(f, e.clientX, e.clientY); },
        }, icon('more_vert', 's18'))),
      f.mime === MIME.folder ? null
        : el('div', { class: 'prev' }, el('span', { class: 'mi', style: `color:${m.color}` }, m.icon))));
  }
  return wrap;
}

// ------------------------------------------------------------------- actions
function select(f, e) {
  if (!e.ctrlKey && !e.metaKey) state.sel.clear();
  state.sel.has(f.id) ? state.sel.delete(f.id) : state.sel.add(f.id);
  render(); showDetails(state.sel.size === 1 ? f : null);
}

function open(f) {
  if (f.mime === MIME.folder) { state.parent = f.id; state.sel.clear(); return load(); }
  const m = mimeMeta(f.mime);
  if (m.app) location.href = m.app + '?id=' + f.id;
  else snackbar(`Preview for ${f.name} — download to open in a native app.`);
}

function fileMenu(f, x, y) {
  contextMenu(x, y, [
    { label: 'Open', icon: 'open_in_new', onClick: () => open(f) },
    { label: 'Share', icon: 'person_add', onClick: () => shareDialog(f) },
    { label: 'Get link', icon: 'link', onClick: () => { navigator.clipboard?.writeText(location.origin + '/drive/?id=' + f.id); snackbar('Link copied to clipboard'); } },
    '-',
    { label: 'Rename', icon: 'edit', onClick: () => renameDialog(f) },
    { label: f.starred ? 'Remove from starred' : 'Add to starred', icon: 'star', onClick: () => toggleStar(f) },
    { label: 'File information', icon: 'info', onClick: () => showDetails(f, true) },
    '-',
    f.trashed
      ? { label: 'Restore', icon: 'restore_from_trash', onClick: () => setTrashed(f, 0) }
      : { label: 'Move to trash', icon: 'delete', danger: true, onClick: () => setTrashed(f, 1) },
    f.trashed ? { label: 'Delete forever', icon: 'delete_forever', danger: true, onClick: () => hardDelete(f) } : null,
  ].filter(Boolean));
}

async function toggleStar(f) {
  await api.patch('/drive/files/' + f.id, { starred: f.starred ? 0 : 1 });
  snackbar(f.starred ? 'Removed from starred' : 'Added to starred'); load();
}
async function setTrashed(f, v) {
  await api.patch('/drive/files/' + f.id, { trashed: v });
  snackbar(v ? `“${f.name}” moved to trash` : 'Restored', v ? 'Undo' : null,
    () => api.patch('/drive/files/' + f.id, { trashed: 0 }).then(load));
  load();
}
async function hardDelete(f) {
  await api.del('/drive/files/' + f.id); snackbar('Deleted forever'); load();
}

function renameDialog(f) {
  const input = el('input', { class: 'field', value: f.name });
  dialog('Rename', el('div', {}, input), [
    { label: 'Cancel' },
    { label: 'OK', primary: true, onClick: async () => { await api.patch('/drive/files/' + f.id, { name: input.value }); load(); } },
  ]);
}

async function createPrompt(mime, placeholder) {
  const input = el('input', { class: 'field', value: placeholder });
  dialog(mime === MIME.folder ? 'New folder' : 'Create', el('div', {}, input), [
    { label: 'Cancel' },
    {
      label: 'Create', primary: true, onClick: async () => {
        const f = await api.post('/drive/files', { name: input.value || placeholder, mime, parent: state.parent });
        snackbar(`Created “${f.name}”`);
        if (mime !== MIME.folder) { const m = mimeMeta(mime); if (m.app) return location.href = m.app + '?id=' + f.id; }
        load();
      },
    },
  ]);
}

function uploadFile() {
  const inp = el('input', { type: 'file', multiple: true, style: 'display:none' });
  document.body.appendChild(inp);
  inp.addEventListener('change', async () => {
    for (const file of inp.files)
      await api.post('/drive/files', { name: file.name, mime: file.type || 'application/octet-stream', parent: state.parent });
    snackbar(`${inp.files.length} file(s) uploaded`); inp.remove(); load();
  });
  inp.click();
}

function shareDialog(f) {
  const email = el('input', { class: 'field', placeholder: 'Add people and groups' });
  const roleSel = el('select', { class: 'field', style: 'width:140px' },
    ...['reader', 'commenter', 'writer'].map(r => el('option', { value: r }, r[0].toUpperCase() + r.slice(1))));
  const list = el('div', { style: 'margin-top:16px' });
  const refresh = async () => {
    const file = await api.get('/drive/files/' + f.id);
    list.innerHTML = '';
    list.append(el('div', { style: 'font-weight:500;margin-bottom:8px' }, 'People with access'));
    list.append(el('div', { class: 'row gap12', style: 'padding:6px 0' },
      el('div', { class: 'avatar sm' }, 'SA'),
      el('div', { class: 'col spacer' }, el('span', {}, 'Shane Ansel (you)'),
        el('span', { class: 'muted', style: 'font-size:12px' }, 'shane@example.com')),
      el('span', { class: 'muted' }, 'Owner')));
    for (const p of file.shared)
      list.append(el('div', { class: 'row gap12', style: 'padding:6px 0' },
        el('div', { class: 'avatar sm', style: 'background:#188038' }, p.user_email[0].toUpperCase()),
        el('div', { class: 'col spacer' }, el('span', {}, p.user_email)),
        el('span', { class: 'muted' }, p.role),
        el('button', {
          class: 'icon-btn', onclick: async () => {
            await api.del(`/drive/files/${f.id}/share/${encodeURIComponent(p.user_email)}`); refresh();
          },
        }, icon('close', 's18'))));
  };
  refresh();
  dialog(`Share “${f.name}”`, el('div', {},
    el('div', { class: 'row gap8' }, el('div', { class: 'spacer' }, email), roleSel), list,
    el('div', { class: 'row gap8', style: 'margin-top:20px;padding-top:16px;border-top:1px solid var(--divider)' },
      icon('public'), el('div', { class: 'col spacer' },
        el('span', {}, 'General access'),
        el('span', { class: 'muted', style: 'font-size:12px' }, 'Restricted — only people with access can open')))),
    [
      { label: 'Copy link', onClick: () => { navigator.clipboard?.writeText(location.origin + '/drive/?id=' + f.id); snackbar('Link copied'); return false; } },
      {
        label: 'Send', primary: true, onClick: async () => {
          if (!email.value) return;
          await api.post(`/drive/files/${f.id}/share`, { email: email.value, role: roleSel.value });
          snackbar(`Shared with ${email.value}`); load();
        },
      },
    ]);
}

async function showDetails(f, force) {
  const pane = document.getElementById('details');
  if (!f) { if (!force) pane.classList.add('hidden'); return; }
  pane.classList.remove('hidden');
  const m = mimeMeta(f.mime);
  const revs = await api.get(`/drive/files/${f.id}/revisions`);
  pane.innerHTML = '';
  pane.append(
    el('div', { class: 'row gap8', style: 'margin-bottom:12px' },
      el('span', { class: 'mi fill s24', style: `color:${m.color}` }, m.icon),
      el('h3', { class: 'spacer truncate' }, f.name),
      el('button', { class: 'icon-btn', onclick: () => pane.classList.add('hidden') }, icon('close'))),
    el('div', { class: 'divider' }),
    el('div', { style: 'padding-top:8px' },
      row('Type', m.label), row('Size', f.mime === MIME.folder ? '—' : fmtSize(f.size)),
      row('Owner', 'me'), row('Modified', new Date(f.modified).toLocaleString()),
      row('Created', new Date(f.created).toLocaleString()),
      row('Shared with', (f.shared || []).map(s => s.user_email).join(', ') || 'Nobody'),
      row('Versions', String(revs.length))));
  function row(k, v) { return el('div', { class: 'detail-row' }, el('b', {}, k), el('span', { class: 'spacer' }, v)); }
}

// keyboard, drag-drop
document.addEventListener('keydown', e => {
  if (e.target.matches('input,textarea')) return;
  if (e.key === 'Delete' && state.sel.size) {
    for (const id of state.sel) api.patch('/drive/files/' + id, { trashed: 1 });
    snackbar(`${state.sel.size} item(s) moved to trash`); state.sel.clear(); setTimeout(load, 60);
  }
  if (e.key === '/') { e.preventDefault(); document.getElementById('shellSearch').focus(); }
});
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', async e => {
  e.preventDefault();
  for (const f of e.dataTransfer.files)
    await api.post('/drive/files', { name: f.name, mime: f.type || 'application/octet-stream', parent: state.parent });
  if (e.dataTransfer.files.length) { snackbar(`${e.dataTransfer.files.length} file(s) uploaded`); load(); }
});

const qid = new URLSearchParams(location.search).get('id');
if (qid) api.get('/drive/files/' + qid).then(f => { if (f && !f.error) { state.parent = f.parent; showDetails(f, true); } });
load();
