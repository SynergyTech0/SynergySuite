// Synergy Chat — spaces and direct messages.
import { mountShell, api, el, icon, snackbar, dialog, initials, fmtDate } from '/shared/shell.js';

const ME = 'shane@example.com';
const S = { spaces: [], space: null, msgs: [], q: '' };

document.getElementById('shell').appendChild(mountShell({
  app: 'chat',
  onSearch: v => { S.q = v; render(); },
}));

async function load() {
  S.spaces = await api.get('/chat/spaces');
  if (!S.space && S.spaces.length) S.space = S.spaces[0].id;
  if (S.space) S.msgs = await api.get(`/chat/spaces/${S.space}/messages`);
  render();
}

function renderNav() {
  const rooms = S.spaces.filter(s => s.type === 'room');
  const dms = S.spaces.filter(s => s.type === 'dm');
  const item = s => el('div', {
    class: 'nav-item' + (S.space === s.id ? ' active' : ''),
    onclick: async () => { S.space = s.id; S.msgs = await api.get(`/chat/spaces/${s.id}/messages`); render(); },
  },
    s.type === 'dm'
      ? el('div', { class: 'avatar sm', style: 'background:#188038' }, initials(s.name))
      : icon('tag'),
    el('span', { class: 'truncate' }, s.name));

  document.getElementById('nav').replaceChildren(
    el('button', {
      class: 'fab-extended', style: 'margin:8px 8px 16px 4px;align-self:flex-start',
      onclick: newSpace,
    }, icon('add', 's24'), 'New chat'),
    el('div', { class: 'nav-section' }, 'Spaces'),
    ...rooms.map(item),
    el('div', { class: 'nav-section' }, 'Direct messages'),
    ...dms.map(item));
}

function render() {
  renderNav();
  const sp = S.spaces.find(s => s.id === S.space);
  const main = document.getElementById('main');
  if (!sp) { main.replaceChildren(el('div', { class: 'empty' }, icon('chat'), el('h3', {}, 'Select a conversation'))); return; }

  const head = el('div', { class: 'sp-head' },
    sp.type === 'dm'
      ? el('div', { class: 'avatar', style: 'background:#188038' }, initials(sp.name))
      : el('span', { class: 'mi s24' }, 'tag'),
    el('div', { class: 'col spacer' },
      el('b', { class: 'gsans', style: 'font-size:17px;font-weight:500' }, sp.name),
      el('span', { class: 'muted', style: 'font-size:12px' },
        sp.type === 'dm' ? 'Direct message' : `${JSON.parse(sp.members || '[]').length} members`)),
    el('button', { class: 'icon-btn', 'data-tip': 'Start a meeting', onclick: () => location.href = '/meet/' }, icon('videocam')),
    el('button', { class: 'icon-btn', 'data-tip': 'Add people', onclick: () => snackbar('Invite people from the Groups app') }, icon('person_add')));

  const visible = S.msgs.filter(m => !S.q || (m.body || '').toLowerCase().includes(S.q.toLowerCase()));
  const thread = el('div', { class: 'thread' });
  if (!visible.length)
    thread.append(el('div', { class: 'empty' }, icon('forum'),
      el('h3', {}, 'No messages yet'), el('p', {}, 'Say something to start the conversation.')));
  let prevAuthor = null, prevTime = 0;
  for (const m of visible) {
    const cont = m.author === prevAuthor && (m.sent_at - prevTime) < 5 * 60000;
    thread.append(el('div', { class: 'cm' + (cont ? ' cont' : '') },
      cont ? el('div', { style: 'width:36px;flex:none' })
        : el('div', { class: 'avatar', style: `background:${m.author === ME ? '#0b57d0' : '#188038'}` }, initials(m.author_name || m.author)),
      el('div', { class: 'col spacer' },
        cont ? null : el('div', {}, el('span', { class: 'who' }, m.author_name || m.author),
          el('span', { class: 'when' }, new Date(m.sent_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))),
        el('div', { class: 'txt' }, m.body))));
    prevAuthor = m.author; prevTime = m.sent_at;
  }

  const ta = el('textarea', {
    rows: 1, placeholder: `Message ${sp.type === 'dm' ? sp.name : '#' + sp.name}`,
    oninput: e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(160, e.target.scrollHeight) + 'px'; },
    onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(ta); } },
  });
  const bar = el('div', { class: 'composer-bar' },
    el('div', { class: 'composer-box' },
      el('button', { class: 'icon-btn', 'data-tip': 'Attach' }, icon('add')),
      ta,
      el('button', { class: 'icon-btn', 'data-tip': 'Emoji' }, icon('mood')),
      el('button', { class: 'icon-btn', 'data-tip': 'Send', onclick: () => send(ta) }, icon('send'))));

  main.replaceChildren(head, thread, bar);
  thread.scrollTop = thread.scrollHeight;
  ta.focus();
}

async function send(ta) {
  const body = ta.value.trim();
  if (!body) return;
  ta.value = '';
  await api.post(`/chat/spaces/${S.space}/messages`, { body });
  S.msgs = await api.get(`/chat/spaces/${S.space}/messages`);
  render();
}

function newSpace() {
  const name = el('input', { class: 'field', placeholder: 'Space name' });
  dialog('Create a space', el('div', {}, name), [
    { label: 'Cancel' },
    {
      label: 'Create', primary: true, onClick: async () => {
        if (!name.value.trim()) return;
        const sp = await api.post('/chat/spaces', { name: name.value, type: 'room', members: [ME] });
        S.space = sp.id; load();
      },
    },
  ]);
}

load();
