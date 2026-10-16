// Synergy Keep — notes, checklists, colours, pinning.
import { mountShell, api, el, icon, snackbar, dialog, contextMenu } from '/shared/shell.js';

const COLORS = {
  default: 'var(--surface)', red: '#f28b82', orange: '#fbbc04', yellow: '#fff475',
  green: '#ccff90', teal: '#a7ffeb', blue: '#cbf0f8', darkblue: '#aecbfa',
  purple: '#d7aefb', pink: '#fdcfe8', brown: '#e6c9a8', gray: '#e8eaed',
};

const S = { view: 'active', notes: [], q: '', layout: 'grid' };

document.getElementById('shell').appendChild(mountShell({
  app: 'keep',
  onSearch: v => { S.q = v; load(); },
  right: [el('button', {
    class: 'icon-btn', 'data-tip': 'Toggle list view',
    onclick: () => { S.layout = S.layout === 'grid' ? 'list' : 'grid'; render(); },
  }, icon('view_agenda'))],
}));

async function load() {
  const p = new URLSearchParams({ view: S.view });
  if (S.q) p.set('q', S.q);
  S.notes = await api.get('/notes?' + p);
  render();
}

function renderNav() {
  const items = [
    { id: 'active', label: 'Notes', icon: 'lightbulb' },
    { id: 'archive', label: 'Archive', icon: 'archive' },
    { id: 'trash', label: 'Trash', icon: 'delete' },
  ];
  document.getElementById('nav').replaceChildren(...items.map(i => el('div', {
    class: 'nav-item' + (S.view === i.id ? ' active' : ''),
    onclick: () => { S.view = i.id; load(); },
  }, icon(i.icon), i.label)));
}

function render() {
  renderNav();
  const main = document.getElementById('main');
  main.replaceChildren();
  if (S.view === 'active') main.append(composer());

  const pinned = S.notes.filter(n => n.pinned);
  const others = S.notes.filter(n => !n.pinned);

  if (!S.notes.length) {
    main.append(el('div', { class: 'empty' }, icon('lightbulb'),
      el('h3', {}, S.q ? 'No matching notes' : 'Notes you add appear here'),
      el('p', {}, S.q ? `Nothing matched “${S.q}”.` : 'Capture a thought, a list, or a reminder.')));
    return;
  }
  if (pinned.length) {
    main.append(el('div', { class: 'section-label' }, 'Pinned'));
    main.append(grid(pinned));
    if (others.length) main.append(el('div', { class: 'section-label' }, 'Others'));
  }
  if (others.length) main.append(grid(others));
}

function grid(list) {
  const wrap = el('div', {
    class: 'masonry',
    style: S.layout === 'list' ? 'columns:1;max-width:640px;margin:0 auto' : '',
  });
  for (const n of list) wrap.append(noteCard(n));
  return wrap;
}

function noteCard(n) {
  let checklist = null;
  try { checklist = n.checklist ? JSON.parse(n.checklist) : null; } catch {}
  const card = el('div', {
    class: 'note' + (n.pinned ? ' pinned' : ''),
    style: `background:${COLORS[n.color] || COLORS.default}` +
      (n.color && n.color !== 'default' ? ';border-color:transparent;color:#202124' : ''),
    onclick: () => edit(n),
  },
    el('button', {
      class: 'icon-btn pin', style: 'width:32px;height:32px',
      'data-tip': n.pinned ? 'Unpin' : 'Pin',
      onclick: async e => { e.stopPropagation(); await api.patch('/notes/' + n.id, { pinned: n.pinned ? 0 : 1 }); load(); },
    }, el('span', { class: 'mi s18' + (n.pinned ? ' fill' : '') }, 'keep')),
    n.title ? el('h4', {}, n.title) : null,
    checklist
      ? el('div', {}, ...checklist.map((c, i) => el('div', {
          class: 'chk' + (c.d ? ' done' : ''),
          onclick: async e => {
            e.stopPropagation(); checklist[i].d = c.d ? 0 : 1;
            await api.patch('/notes/' + n.id, { checklist }); load();
          },
        }, el('span', { class: 'mi s18' }, c.d ? 'check_box' : 'check_box_outline_blank'), el('span', {}, c.t))))
      : (n.body ? el('p', {}, n.body) : null),
    el('div', { class: 'acts' },
      colorBtn(n),
      el('button', {
        class: 'icon-btn', style: 'width:32px;height:32px', 'data-tip': n.archived ? 'Unarchive' : 'Archive',
        onclick: async e => { e.stopPropagation(); await api.patch('/notes/' + n.id, { archived: n.archived ? 0 : 1 }); snackbar(n.archived ? 'Note unarchived' : 'Note archived'); load(); },
      }, icon(n.archived ? 'unarchive' : 'archive', 's18')),
      el('button', {
        class: 'icon-btn', style: 'width:32px;height:32px', 'data-tip': n.trashed ? 'Restore' : 'Delete',
        onclick: async e => {
          e.stopPropagation();
          if (n.trashed) { await api.del('/notes/' + n.id); snackbar('Deleted forever'); }
          else { await api.patch('/notes/' + n.id, { trashed: 1 }); snackbar('Note trashed', 'Undo', () => api.patch('/notes/' + n.id, { trashed: 0 }).then(load)); }
          load();
        },
      }, icon(n.trashed ? 'restore_from_trash' : 'delete', 's18'))));
  return card;
}

function colorBtn(n) {
  const b = el('button', { class: 'icon-btn', style: 'width:32px;height:32px', 'data-tip': 'Background options' }, icon('palette', 's18'));
  b.addEventListener('click', e => {
    e.stopPropagation();
    const r = b.getBoundingClientRect();
    const pop = el('div', {
      class: 'menu open',
      style: `left:${Math.min(r.left, innerWidth - 260)}px;top:${r.bottom + 4}px;padding:10px;display:grid;grid-template-columns:repeat(6,28px);gap:8px`,
    }, ...Object.entries(COLORS).map(([k, c]) => el('div', {
      'data-tip': k,
      style: `width:28px;height:28px;border-radius:50%;background:${c};border:2px solid ${n.color === k ? 'var(--blue-700)' : 'var(--outline-variant)'};cursor:pointer`,
      onclick: async ev => { ev.stopPropagation(); await api.patch('/notes/' + n.id, { color: k }); pop.remove(); load(); },
    })));
    document.body.appendChild(pop);
    setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }), 0);
  });
  return b;
}

// ------------------------------------------------------------------ composer
function composer() {
  const box = el('div', { class: 'composer' });
  const collapsed = el('input', { placeholder: 'Take a note…', style: 'font-size:16px;padding:4px 0' });
  const title = el('input', { class: 't', placeholder: 'Title' });
  const body = el('textarea', { rows: 3, placeholder: 'Take a note…' });
  let items = null;

  const expand = (asList) => {
    items = asList ? [{ t: '', d: 0 }] : null;
    box.replaceChildren(title, asList ? listEditor() : body, actions());
    setTimeout(() => (asList ? box.querySelector('input.ci') : body).focus(), 30);
  };
  function listEditor() {
    const wrap = el('div', {});
    items.forEach((it, i) => wrap.append(el('div', { class: 'chk' },
      el('span', { class: 'mi s18', onclick: () => { items[i].d = it.d ? 0 : 1; expandKeep(); } }, it.d ? 'check_box' : 'check_box_outline_blank'),
      el('input', {
        class: 'ci', value: it.t, placeholder: 'List item', style: 'flex:1',
        oninput: e => items[i].t = e.target.value,
        onkeydown: e => { if (e.key === 'Enter') { items.push({ t: '', d: 0 }); expandKeep(); } },
      }))));
    wrap.append(el('div', { class: 'chk muted', style: 'cursor:pointer', onclick: () => { items.push({ t: '', d: 0 }); expandKeep(); } },
      el('span', { class: 'mi s18' }, 'add'), el('span', {}, 'List item')));
    return wrap;
  }
  function expandKeep() { box.replaceChildren(title, listEditor(), actions()); }

  function actions() {
    return el('div', { class: 'row gap4', style: 'margin-top:10px' },
      el('button', { class: 'icon-btn', 'data-tip': 'New list', style: 'width:32px;height:32px', onclick: () => expand(true) }, icon('check_box', 's18')),
      el('div', { class: 'spacer' }),
      el('button', {
        class: 'btn btn-text', onclick: async () => {
          const payload = { title: title.value, body: items ? '' : body.value };
          if (items) payload.checklist = items.filter(i => i.t.trim());
          if (!payload.title && !payload.body && !(payload.checklist || []).length) return reset();
          await api.post('/notes', payload); reset(); load(); snackbar('Note saved');
        },
      }, 'Close'));
  }
  function reset() { title.value = ''; body.value = ''; items = null; box.replaceChildren(collapsed); }

  collapsed.addEventListener('focus', () => expand(false));
  box.append(collapsed);
  return box;
}

function edit(n) {
  const title = el('input', { class: 'field', value: n.title || '', placeholder: 'Title', style: 'margin-bottom:8px' });
  const body = el('textarea', { class: 'field', rows: 6, placeholder: 'Note' }, n.body || '');
  dialog('Edit note', el('div', {}, title, body), [
    { label: 'Cancel' },
    { label: 'Save', primary: true, onClick: async () => { await api.patch('/notes/' + n.id, { title: title.value, body: body.value }); load(); } },
  ]);
}

load();
