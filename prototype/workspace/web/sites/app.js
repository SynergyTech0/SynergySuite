// Synergy Sites — internal site builder backed by Drive.
import { mountShell, api, el, icon, snackbar, dialog, contextMenu, MIME, fmtDate } from '/shared/shell.js';

const S = { sites: [], site: null, doc: null, editing: true };

document.getElementById('shell').appendChild(mountShell({ app: 'sites', search: false }));

const BLANK = () => ({
  theme: '#0b57d0',
  pages: [{
    name: 'Home',
    sections: [
      { type: 'hero', title: 'Team site', sub: 'A place for everything the team needs' },
      { type: 'text', title: 'About', body: 'Describe what this site is for.' },
    ],
  }],
  page: 0,
});

async function load() {
  S.sites = await api.get('/drive/files?mime=' + encodeURIComponent(MIME.site));
  render();
}

function renderNav() {
  document.getElementById('nav').replaceChildren(
    el('button', { class: 'fab-extended', style: 'margin:8px 8px 16px 4px;align-self:flex-start', onclick: create },
      icon('add', 's24'), 'Create'),
    el('div', {
      class: 'nav-item' + (!S.site ? ' active' : ''),
      onclick: () => { S.site = null; S.doc = null; render(); },
    }, icon('web'), 'All sites'));
}

function render() {
  renderNav();
  document.getElementById('main').replaceChildren(S.site ? editor() : list());
}

function list() {
  const wrap = el('div', { style: 'padding:24px' },
    el('h2', { class: 'gsans', style: 'font-weight:400;font-size:22px;margin:0 0 16px' },
      `Sites (${S.sites.length})`));
  if (!S.sites.length) {
    wrap.append(el('div', { class: 'empty' }, icon('web'),
      el('h3', {}, 'No sites yet'),
      el('p', {}, 'Create a site to publish an internal page for your team.')));
    return wrap;
  }
  wrap.append(el('table', { class: 'adm' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Site'), el('th', {}, 'Owner'), el('th', {}, 'Last modified'))),
    el('tbody', {}, ...S.sites.map(s => el('tr', { onclick: () => open(s) },
      el('td', {}, el('div', { class: 'row gap12' }, icon('web'), el('span', {}, s.name))),
      el('td', { class: 'muted' }, 'me'),
      el('td', { class: 'muted' }, fmtDate(s.modified)))))));
  return wrap;
}

async function open(s) {
  S.site = s;
  const f = await api.get('/drive/files/' + s.id);
  try { S.doc = JSON.parse(f.content || 'null') || BLANK(); }
  catch { S.doc = BLANK(); }
  S.doc.page = S.doc.page || 0;
  render();
}

async function create() {
  const name = el('input', { class: 'field', value: 'Team site' });
  dialog('Create site', el('div', {}, name), [
    { label: 'Cancel' },
    {
      label: 'Create', primary: true, onClick: async () => {
        const f = await api.post('/drive/files', {
          name: name.value || 'Team site', mime: MIME.site, content: JSON.stringify(BLANK()),
        });
        await load(); open(f);
      },
    },
  ]);
}

function editor() {
  const d = S.doc, page = d.pages[d.page];
  const bar = el('div', { class: 'row gap8', style: 'padding:12px 24px;border-bottom:1px solid var(--divider)' },
    el('button', { class: 'icon-btn', onclick: () => { S.site = null; S.doc = null; render(); } }, icon('arrow_back')),
    el('h2', { class: 'gsans spacer', style: 'font-weight:400;font-size:20px;margin:0' }, S.site.name),
    ...d.pages.map((p, i) => el('button', {
      class: 'chip' + (i === d.page ? ' on' : ''),
      onclick: () => { d.page = i; render(); },
    }, p.name)),
    el('button', {
      class: 'icon-btn', 'data-tip': 'Add page',
      onclick: () => {
        const n = el('input', { class: 'field', placeholder: 'Page name' });
        dialog('New page', el('div', {}, n), [{ label: 'Cancel' }, {
          label: 'Add', primary: true, onClick: () => {
            d.pages.push({ name: n.value || 'Page', sections: [{ type: 'text', title: n.value || 'Page', body: '' }] });
            d.page = d.pages.length - 1; save(); render();
          },
        }]);
      },
    }, icon('add')),
    el('button', {
      class: 'chip' + (S.editing ? '' : ' on'),
      onclick: () => { S.editing = !S.editing; render(); },
    }, S.editing ? 'Preview' : 'Edit'),
    el('button', {
      class: 'btn btn-filled',
      onclick: () => { save(); snackbar('Site published to example.com/sites/' + S.site.id); },
    }, 'Publish'));

  const canvas = el('div', { style: 'max-width:900px;margin:0 auto;padding:24px' });
  page.sections.forEach((sec, i) => canvas.append(section(sec, i)));

  if (S.editing)
    canvas.append(el('div', { class: 'row gap8', style: 'margin-top:16px;justify-content:center' },
      el('button', { class: 'btn btn-outline', onclick: () => { page.sections.push({ type: 'text', title: 'Section', body: '' }); save(); render(); } },
        icon('add', 's18'), 'Text section'),
      el('button', { class: 'btn btn-outline', onclick: () => { page.sections.push({ type: 'hero', title: 'Headline', sub: 'Supporting line' }); save(); render(); } },
        icon('add', 's18'), 'Hero'),
      el('button', { class: 'btn btn-outline', onclick: () => { page.sections.push({ type: 'cards', title: 'Links', items: ['Drive', 'Calendar', 'Chat'] }); save(); render(); } },
        icon('add', 's18'), 'Card row')));

  return el('div', {}, bar, canvas);
}

function section(sec, i) {
  const page = S.doc.pages[S.doc.page];
  const ed = S.editing;
  const del = ed ? el('button', {
    class: 'icon-btn', style: 'position:absolute;top:8px;right:8px',
    onclick: () => { page.sections.splice(i, 1); save(); render(); },
  }, icon('delete', 's18')) : null;

  const editable = (val, key, style) => el(ed ? 'div' : 'div', {
    contenteditable: ed ? 'true' : null, style,
    oninput: e => { sec[key] = e.target.textContent; save(); },
  }, val || '');

  if (sec.type === 'hero')
    return el('div', {
      style: `position:relative;background:${S.doc.theme};color:#fff;border-radius:12px;padding:56px 40px;margin-bottom:16px`,
    }, del,
      editable(sec.title, 'title', 'font-family:var(--font);font-size:40px;font-weight:400;outline:none'),
      editable(sec.sub, 'sub', 'font-size:17px;opacity:.85;margin-top:8px;outline:none'));

  if (sec.type === 'cards')
    return el('div', { style: 'position:relative;margin-bottom:16px' }, del,
      editable(sec.title, 'title', 'font-family:var(--font);font-size:22px;margin-bottom:12px;outline:none'),
      el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px' },
        ...(sec.items || []).map((it, j) => el('div', {
          class: 'card', style: 'text-align:center;padding:24px',
          contenteditable: ed ? 'true' : null,
          oninput: e => { sec.items[j] = e.target.textContent; save(); },
        }, it))));

  return el('div', { style: 'position:relative;margin-bottom:16px' }, del,
    editable(sec.title, 'title', 'font-family:var(--font);font-size:22px;margin-bottom:8px;outline:none'),
    editable(sec.body, 'body', 'font-size:15px;line-height:1.6;outline:none;white-space:pre-wrap;min-height:24px'));
}

let t;
function save() {
  if (!S.site) return;
  clearTimeout(t);
  t = setTimeout(() => api.patch('/drive/files/' + S.site.id, { content: JSON.stringify(S.doc) }), 600);
}

load();
