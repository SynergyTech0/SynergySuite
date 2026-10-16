// Synergy Workspace — shared shell.
// Every app in the suite renders its chrome from here, so the top bar, the
// waffle, search and the account chip are literally the same component.

export const APPS = [
  { id: 'mail',     name: 'Mail',     icon: 'mail',                    color: '#ea4335', url: '/mail/' },
  { id: 'drive',    name: 'Drive',    icon: 'add_to_drive',            color: '#1a73e8', url: '/drive/' },
  { id: 'docs',     name: 'Docs',     icon: 'description',             color: '#4285f4', url: '/docs/' },
  { id: 'sheets',   name: 'Sheets',   icon: 'table_chart',             color: '#0f9d58', url: '/sheets/' },
  { id: 'slides',   name: 'Slides',   icon: 'slideshow',               color: '#f4b400', url: '/slides/' },
  { id: 'forms',    name: 'Forms',    icon: 'checklist',               color: '#7248b9', url: '/forms/' },
  { id: 'calendar', name: 'Calendar', icon: 'calendar_month',          color: '#1a73e8', url: '/calendar/' },
  { id: 'keep',     name: 'Keep',     icon: 'lightbulb',               color: '#fbbc04', url: '/keep/' },
  { id: 'tasks',    name: 'Tasks',    icon: 'task_alt',                color: '#2c68d6', url: '/tasks/' },
  { id: 'contacts', name: 'Contacts', icon: 'contacts',                color: '#1a73e8', url: '/contacts/' },
  { id: 'chat',     name: 'Chat',     icon: 'chat',                    color: '#00ac47', url: '/chat/' },
  { id: 'meet',     name: 'Meet',     icon: 'videocam',                color: '#00832d', url: '/meet/' },
  { id: 'sites',    name: 'Sites',    icon: 'web',                     color: '#5f6368', url: '/sites/' },
  { id: 'groups',   name: 'Groups',   icon: 'groups',                  color: '#1a73e8', url: '/groups/' },
  { id: 'vault',    name: 'Vault',    icon: 'shield',                  color: '#f9ab00', url: '/vault/' },
  { id: 'admin',    name: 'Admin',    icon: 'admin_panel_settings',    color: '#5f6368', url: '/admin/' },
];

export const api = {
  async get(path)          { const r = await fetch('/api' + path); return r.json(); },
  async post(path, body)   { return (await fetch('/api' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })).json(); },
  async patch(path, body)  { return (await fetch('/api' + path, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })).json(); },
  async del(path)          { return (await fetch('/api' + path, { method: 'DELETE' })).json(); },
};

export const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(kid) : kid);
  }
  return n;
};
export const icon = (name, cls = '') => el('span', { class: 'mi ' + cls }, name);

export const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

export function appIcon(app, size = 40) {
  return el('span', {
    class: 'app-icon',
    style: `background:${app.color};width:${size}px;height:${size}px`,
  }, el('span', { class: 'mi fill', style: `font-size:${Math.round(size * 0.55)}px` }, app.icon));
}

// ---------------------------------------------------------------- top bar
export function mountShell({ app, search = true, onSearch, left, right, flat }) {
  const me = { name: 'Shane Ansel', email: 'shane@example.com' };
  const cur = APPS.find(a => a.id === app) || APPS[0];

  const waffle = el('div', { class: 'waffle-panel', id: 'wafflePanel' },
    ...APPS.map(a => el('a', { class: 'waffle-item', href: a.url },
      appIcon(a, 40), el('span', {}, a.name))));

  const searchBox = search ? el('div', { class: 'topbar-search' },
    el('button', { class: 'icon-btn', 'data-tip': 'Search' }, icon('search')),
    el('input', {
      type: 'text', placeholder: `Search ${cur.name.toLowerCase()}`, id: 'shellSearch',
      oninput: e => onSearch && onSearch(e.target.value),
      onkeydown: e => { if (e.key === 'Escape') { e.target.value = ''; onSearch && onSearch(''); } },
    }),
    el('button', {
      class: 'icon-btn', 'data-tip': 'Clear',
      onclick: () => { const i = document.getElementById('shellSearch'); i.value = ''; onSearch && onSearch(''); },
    }, icon('close'))
  ) : el('div', { class: 'topbar-spacer' });

  const avatarBtn = el('div', { class: 'avatar', 'data-tip': me.email, id: 'shellAvatar' }, initials(me.name));
  const accountCard = el('div', { class: 'menu', id: 'accountCard', style: 'right:8px;top:56px;min-width:300px;padding:16px;border-radius:28px' },
    el('div', { class: 'col', style: 'align-items:center;gap:8px' },
      el('div', { class: 'muted', style: 'font-size:13px' }, me.email),
      el('div', { class: 'avatar lg', style: 'margin:8px 0' }, initials(me.name)),
      el('div', { class: 'gsans', style: 'font-size:20px' }, `Hi, ${me.name.split(' ')[0]}!`),
      el('div', { class: 'row gap8', style: 'margin-top:16px' },
        el('button', { class: 'btn btn-outline', onclick: () => toggleTheme() }, 'Toggle theme'),
        el('a', { class: 'btn btn-outline', href: '/admin/' }, 'Admin'))));

  const bar = el('header', { class: 'topbar' },
    el('button', { class: 'icon-btn', id: 'shellMenuBtn', 'data-tip': 'Main menu' }, icon('menu', 's24')),
    el('a', { class: 'topbar-brand', href: '/' },
      appIcon(cur, 40),
      el('span', { class: 'name' }, 'Synergy ', el('span', { style: 'font-weight:500;color:var(--on-surface-variant)' }, cur.name))),
    searchBox,
    el('div', { class: 'topbar-actions' },
      ...(right || []),
      el('button', { class: 'icon-btn', 'data-tip': 'Support' }, icon('help', 's24')),
      el('button', { class: 'icon-btn', 'data-tip': 'Settings', onclick: () => location.href = '/admin/' }, icon('settings', 's24')),
      el('button', {
        class: 'icon-btn', 'data-tip': 'Synergy apps', id: 'waffleBtn',
        onclick: e => { e.stopPropagation(); waffle.classList.toggle('open'); accountCard.classList.remove('open'); },
      }, icon('apps', 's24')),
      avatarBtn),
    waffle, accountCard);

  avatarBtn.addEventListener('click', e => {
    e.stopPropagation(); accountCard.classList.toggle('open'); waffle.classList.remove('open');
  });
  document.addEventListener('click', () => {
    waffle.classList.remove('open'); accountCard.classList.remove('open');
    document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open'));
  });
  waffle.addEventListener('click', e => e.stopPropagation());
  accountCard.addEventListener('click', e => e.stopPropagation());

  return bar;
}

// ---------------------------------------------------------------- theme
export function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('sw-theme', next); } catch {}
}
export function applyTheme() {
  try {
    const t = localStorage.getItem('sw-theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
  } catch {}
}
applyTheme();

// ---------------------------------------------------------------- utilities
export function snackbar(text, actionLabel, action) {
  let sb = document.querySelector('.snackbar');
  if (!sb) { sb = el('div', { class: 'snackbar' }); document.body.appendChild(sb); }
  sb.innerHTML = '';
  sb.appendChild(el('span', { class: 'spacer' }, text));
  if (actionLabel) sb.appendChild(el('button', { onclick: () => { action && action(); sb.classList.remove('show'); } }, actionLabel));
  sb.classList.add('show');
  clearTimeout(sb._t); sb._t = setTimeout(() => sb.classList.remove('show'), 5000);
}

export function dialog(title, content, actions) {
  const scrim = el('div', { class: 'scrim open', onclick: e => { if (e.target === scrim) close(); } });
  const close = () => scrim.remove();
  const d = el('div', { class: 'dialog' },
    el('h2', { class: 'gsans' }, title), content,
    el('div', { class: 'dialog-actions' },
      ...(actions || []).map(a => el('button', {
        class: 'btn ' + (a.primary ? 'btn-filled' : 'btn-text'),
        onclick: () => { const r = a.onClick && a.onClick(); if (r !== false) close(); },
      }, a.label))));
  scrim.appendChild(d);
  document.body.appendChild(scrim);
  const f = d.querySelector('input,textarea'); if (f) setTimeout(() => f.focus(), 30);
  return { close, root: d };
}

export function contextMenu(x, y, items) {
  document.querySelectorAll('.menu.ctx').forEach(m => m.remove());
  const m = el('div', { class: 'menu ctx open', style: `left:${x}px;top:${y}px` },
    ...items.map(i => i === '-' ? el('div', { class: 'menu-sep' })
      : el('div', { class: 'menu-item ' + (i.danger ? 'danger' : ''), onclick: () => { m.remove(); i.onClick && i.onClick(); } },
        i.icon ? icon(i.icon) : el('span', { style: 'width:18px' }), i.label)));
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  if (r.bottom > innerHeight) m.style.top = (y - r.height) + 'px';
  if (r.right > innerWidth) m.style.left = (x - r.width) + 'px';
  setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0);
  return m;
}

export const fmtSize = b => {
  if (!b) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return (i === 0 ? b : b.toFixed(1)) + ' ' + u[i];
};

export const fmtDate = ts => {
  if (!ts) return '—';
  const d = new Date(ts), n = new Date();
  const sameDay = d.toDateString() === n.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.getFullYear() === n.getFullYear())
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};

export const MIME = {
  folder: 'application/vnd.synergy-apps.folder',
  doc: 'application/vnd.synergy-apps.document',
  sheet: 'application/vnd.synergy-apps.spreadsheet',
  slide: 'application/vnd.synergy-apps.presentation',
  form: 'application/vnd.synergy-apps.form',
  site: 'application/vnd.synergy-apps.site',
};

export function mimeMeta(mime) {
  switch (mime) {
    case MIME.folder: return { icon: 'folder', color: '#5f6368', label: 'Folder', app: null };
    case MIME.doc:    return { icon: 'description', color: '#4285f4', label: 'Synergy Doc', app: '/docs/' };
    case MIME.sheet:  return { icon: 'table_chart', color: '#0f9d58', label: 'Synergy Sheet', app: '/sheets/' };
    case MIME.slide:  return { icon: 'slideshow', color: '#f4b400', label: 'Synergy Slides', app: '/slides/' };
    case MIME.form:   return { icon: 'checklist', color: '#7248b9', label: 'Synergy Form', app: '/forms/' };
    case MIME.site:   return { icon: 'web', color: '#5f6368', label: 'Synergy Site', app: '/sites/' };
  }
  if (/^image\//.test(mime))  return { icon: 'image', color: '#ea4335', label: 'Image', app: null };
  if (/^video\//.test(mime))  return { icon: 'movie', color: '#ea4335', label: 'Video', app: null };
  if (/^audio\//.test(mime))  return { icon: 'audio_file', color: '#ea4335', label: 'Audio', app: null };
  if (mime === 'application/pdf') return { icon: 'picture_as_pdf', color: '#ea4335', label: 'PDF', app: null };
  if (/csv|sheet|excel/.test(mime)) return { icon: 'table_chart', color: '#0f9d58', label: 'Spreadsheet', app: null };
  return { icon: 'draft', color: '#5f6368', label: 'File', app: null };
}
