// Synergy Mail
import { mountShell, api, el, icon, snackbar, dialog, contextMenu, fmtDate, initials } from '/shared/shell.js';

const LABELS = [
  { id: 'INBOX', label: 'Inbox', icon: 'inbox' },
  { id: 'STARRED', label: 'Starred', icon: 'star' },
  { id: 'SNOOZED', label: 'Snoozed', icon: 'schedule' },
  { id: 'SENT', label: 'Sent', icon: 'send' },
  { id: 'DRAFTS', label: 'Drafts', icon: 'draft' },
  { id: 'ALL', label: 'All Mail', icon: 'all_inbox' },
  { id: 'SPAM', label: 'Spam', icon: 'report' },
  { id: 'TRASH', label: 'Trash', icon: 'delete' },
];

const S = { label: 'INBOX', msgs: [], counts: {}, open: null, checked: new Set(), q: '' };

document.getElementById('shell').appendChild(mountShell({
  app: 'mail',
  onSearch: v => { S.q = v; load(); },
}));

async function load() {
  const p = new URLSearchParams({ label: S.label });
  if (S.q) p.set('q', S.q);
  [S.msgs, S.counts] = await Promise.all([
    api.get('/mail/messages?' + p), api.get('/mail/counts'),
  ]);
  render();
}

function renderNav() {
  const nav = document.getElementById('nav');
  nav.replaceChildren(
    el('button', { class: 'fab-extended', style: 'margin:8px 8px 16px 4px;align-self:flex-start', onclick: () => compose() },
      icon('edit', 's24'), 'Compose'),
    ...LABELS.map(l => el('div', {
      class: 'nav-item' + (S.label === l.id ? ' active' : ''),
      onclick: () => { S.label = l.id; S.open = null; S.checked.clear(); load(); },
    }, icon(l.icon), el('span', { class: 'spacer' }, l.label),
      S.counts[l.id] ? el('span', { class: 'count' }, String(S.counts[l.id])) : null)));
}

function render() {
  renderNav();
  const main = document.getElementById('main');
  main.replaceChildren(S.open ? readerView() : listView());
}

// ------------------------------------------------------------------ list
function listView() {
  const allChecked = S.msgs.length && S.checked.size === S.msgs.length;
  const bulk = S.checked.size > 0;
  const toolbar = el('div', { class: 'list-toolbar' },
    el('input', {
      type: 'checkbox', checked: allChecked, style: 'margin:0 10px 0 4px;width:16px;height:16px',
      onchange: e => { S.checked = e.target.checked ? new Set(S.msgs.map(m => m.id)) : new Set(); render(); },
    }),
    el('button', { class: 'icon-btn', 'data-tip': 'Refresh', onclick: load }, icon('refresh')),
    bulk ? el('button', { class: 'icon-btn', 'data-tip': 'Archive', onclick: () => bulkLabel('ARCHIVE') }, icon('archive')) : null,
    bulk ? el('button', { class: 'icon-btn', 'data-tip': 'Report spam', onclick: () => bulkLabel('SPAM') }, icon('report')) : null,
    bulk ? el('button', { class: 'icon-btn', 'data-tip': 'Delete', onclick: () => bulkLabel('TRASH') }, icon('delete')) : null,
    bulk ? el('button', { class: 'icon-btn', 'data-tip': 'Mark as read', onclick: () => bulkPatch({ unread: 0 }) }, icon('mark_email_read')) : null,
    bulk && S.label !== 'INBOX' ? el('button', { class: 'icon-btn', 'data-tip': 'Move to Inbox', onclick: () => bulkLabel('INBOX') }, icon('move_to_inbox')) : null,
    el('div', { class: 'spacer' }),
    el('span', { class: 'muted', style: 'font-size:12px;margin-right:8px' },
      S.msgs.length ? `1–${S.msgs.length} of ${S.msgs.length}` : ''));

  if (!S.msgs.length)
    return el('div', { class: 'col', style: 'flex:1' }, toolbar,
      el('div', { class: 'empty' }, icon('inbox'),
        el('h3', {}, S.q ? 'No results' : 'Nothing here'),
        el('p', {}, S.q ? `No messages matched “${S.q}”.` : 'When messages arrive they will show up here.')));

  const list = el('div', { style: 'flex:1;overflow-y:auto' });
  for (const m of S.msgs) {
    const checked = S.checked.has(m.id);
    list.append(el('div', {
      class: 'msg ' + (m.unread ? 'unread' : 'read') + (checked ? ' checked' : ''),
      onclick: () => openMsg(m),
    },
      el('input', {
        type: 'checkbox', checked, style: 'margin:0 2px;width:16px;height:16px',
        onclick: e => { e.stopPropagation(); checked ? S.checked.delete(m.id) : S.checked.add(m.id); render(); },
      }),
      el('button', {
        class: 'icon-btn', style: 'width:32px;height:32px',
        onclick: async e => { e.stopPropagation(); await api.patch('/mail/messages/' + m.id, { starred: m.starred ? 0 : 1 }); load(); },
      }, el('span', { class: 'mi s18' + (m.starred ? ' fill' : ''), style: m.starred ? 'color:#f9ab00' : '' },
        m.starred ? 'star' : 'star_border')),
      el('button', {
        class: 'icon-btn', style: 'width:32px;height:32px',
        onclick: async e => { e.stopPropagation(); await api.patch('/mail/messages/' + m.id, { important: m.important ? 0 : 1 }); load(); },
      }, el('span', { class: 'mi s18' + (m.important ? ' fill' : ''), style: m.important ? 'color:#f9ab00' : '' }, 'label_important')),
      el('span', { class: 'from' }, m.sender_name || m.sender),
      el('span', { class: 'subj' }, m.subject,
        el('span', { class: 'snip' }, ' — ' + (m.snippet || ''))),
      el('div', { class: 'hover-acts' },
        el('button', { class: 'icon-btn', 'data-tip': 'Archive', onclick: async e => { e.stopPropagation(); await api.patch('/mail/messages/' + m.id, { labels: 'ARCHIVE' }); snackbar('Conversation archived', 'Undo', () => api.patch('/mail/messages/' + m.id, { labels: 'INBOX' }).then(load)); load(); } }, icon('archive', 's18')),
        el('button', { class: 'icon-btn', 'data-tip': 'Delete', onclick: async e => { e.stopPropagation(); await api.patch('/mail/messages/' + m.id, { labels: 'TRASH' }); snackbar('Moved to trash', 'Undo', () => api.patch('/mail/messages/' + m.id, { labels: 'INBOX' }).then(load)); load(); } }, icon('delete', 's18')),
        el('button', { class: 'icon-btn', 'data-tip': m.unread ? 'Mark as read' : 'Mark as unread', onclick: async e => { e.stopPropagation(); await api.patch('/mail/messages/' + m.id, { unread: m.unread ? 0 : 1 }); load(); } }, icon(m.unread ? 'drafts' : 'mark_email_unread', 's18')),
        S.label === 'INBOX'
          ? el('button', { class: 'icon-btn', 'data-tip': 'Snooze', onclick: async e => { e.stopPropagation(); await api.patch('/mail/messages/' + m.id, { labels: 'SNOOZED' }); snackbar('Conversation snoozed', 'Undo', () => api.patch('/mail/messages/' + m.id, { labels: 'INBOX' }).then(load)); load(); } }, icon('schedule', 's18'))
          : el('button', { class: 'icon-btn', 'data-tip': 'Move to Inbox', onclick: async e => { e.stopPropagation(); await api.patch('/mail/messages/' + m.id, { labels: 'INBOX' }); snackbar('Moved to Inbox'); load(); } }, icon('move_to_inbox', 's18'))),
      el('span', { class: 'when' }, fmtDate(m.sent_at))));
  }
  return el('div', { class: 'col', style: 'flex:1;min-height:0;display:flex;flex-direction:column' }, toolbar, list);
}

async function bulkLabel(label) {
  for (const id of S.checked) await api.patch('/mail/messages/' + id, { labels: label });
  snackbar(`${S.checked.size} conversation(s) moved`);
  S.checked.clear(); load();
}
async function bulkPatch(patch) {
  for (const id of S.checked) await api.patch('/mail/messages/' + id, patch);
  S.checked.clear(); load();
}

// ------------------------------------------------------------------ reader
async function openMsg(m) {
  S.open = m;
  if (m.unread) { await api.patch('/mail/messages/' + m.id, { unread: 0 }); m.unread = 0; }
  render();
}

function readerView() {
  const m = S.open;
  const toolbar = el('div', { class: 'list-toolbar' },
    el('button', { class: 'icon-btn', 'data-tip': 'Back', onclick: () => { S.open = null; load(); } }, icon('arrow_back')),
    el('button', { class: 'icon-btn', 'data-tip': 'Archive', onclick: async () => { await api.patch('/mail/messages/' + m.id, { labels: 'ARCHIVE' }); S.open = null; snackbar('Archived'); load(); } }, icon('archive')),
    el('button', { class: 'icon-btn', 'data-tip': 'Report spam', onclick: async () => { await api.patch('/mail/messages/' + m.id, { labels: 'SPAM' }); S.open = null; snackbar('Reported as spam'); load(); } }, icon('report')),
    el('button', { class: 'icon-btn', 'data-tip': 'Delete', onclick: async () => { await api.patch('/mail/messages/' + m.id, { labels: 'TRASH' }); S.open = null; snackbar('Moved to trash'); load(); } }, icon('delete')),
    el('button', { class: 'icon-btn', 'data-tip': 'Mark as unread', onclick: async () => { await api.patch('/mail/messages/' + m.id, { unread: 1 }); S.open = null; load(); } }, icon('mark_email_unread')),
    el('button', { class: 'icon-btn', 'data-tip': 'Snooze', onclick: async () => { await api.patch('/mail/messages/' + m.id, { labels: 'SNOOZED' }); S.open = null; snackbar('Snoozed'); load(); } }, icon('schedule')),
    m.labels !== 'INBOX'
      ? el('button', { class: 'icon-btn', 'data-tip': 'Move to Inbox', onclick: async () => { await api.patch('/mail/messages/' + m.id, { labels: 'INBOX' }); S.open = null; snackbar('Moved to Inbox'); load(); } }, icon('move_to_inbox'))
      : null,
    el('div', { class: 'spacer' }));

  const reader = el('div', { class: 'reader' },
    el('h1', {}, m.subject),
    el('div', { class: 'row gap12', style: 'margin-top:8px' },
      el('div', { class: 'avatar' }, initials(m.sender_name || m.sender)),
      el('div', { class: 'col spacer' },
        el('div', {}, el('b', { style: 'font-weight:500' }, m.sender_name || m.sender),
          el('span', { class: 'muted', style: 'font-size:12px' }, ` <${m.sender}>`)),
        el('span', { class: 'muted', style: 'font-size:12px' }, 'to ' + (m.recipients || 'me'))),
      el('span', { class: 'muted', style: 'font-size:12px' }, new Date(m.sent_at).toLocaleString()),
      el('button', {
        class: 'icon-btn', onclick: async () => { await api.patch('/mail/messages/' + m.id, { starred: m.starred ? 0 : 1 }); m.starred = m.starred ? 0 : 1; render(); },
      }, el('span', { class: 'mi' + (m.starred ? ' fill' : ''), style: m.starred ? 'color:#f9ab00' : '' }, m.starred ? 'star' : 'star_border')),
      el('button', { class: 'icon-btn', 'data-tip': 'Reply', onclick: () => compose({ reply: m }) }, icon('reply'))),
    el('div', { class: 'body' }, m.body),
    el('div', { class: 'row gap8', style: 'margin-top:28px' },
      el('button', { class: 'btn btn-outline', onclick: () => compose({ reply: m }) }, icon('reply', 's18'), 'Reply'),
      el('button', { class: 'btn btn-outline', onclick: () => compose({ forward: m }) }, icon('forward', 's18'), 'Forward')));

  return el('div', { class: 'col', style: 'flex:1;min-height:0;display:flex;flex-direction:column' }, toolbar, reader);
}

// ------------------------------------------------------------------ compose
function compose(opts = {}) {
  document.querySelector('.compose')?.remove();
  const r = opts.reply, f = opts.forward;
  const to = el('input', { placeholder: 'To', value: r ? r.sender : '' });
  const subj = el('input', {
    placeholder: 'Subject',
    value: r ? (r.subject.startsWith('Re:') ? r.subject : 'Re: ' + r.subject)
      : f ? (f.subject.startsWith('Fwd:') ? f.subject : 'Fwd: ' + f.subject) : '',
  });
  const bodyInit = r ? `\n\n\nOn ${new Date(r.sent_at).toLocaleString()}, ${r.sender_name} wrote:\n> ${r.body.split('\n').join('\n> ')}`
    : f ? `\n\n---------- Forwarded message ----------\nFrom: ${f.sender_name} <${f.sender}>\nSubject: ${f.subject}\n\n${f.body}` : '';
  const body = el('textarea', { placeholder: 'Compose your message' }, bodyInit);

  const win = el('div', { class: 'compose' },
    el('header', {}, el('span', { class: 'spacer' }, r ? 'Reply' : f ? 'Forward' : 'New message'),
      el('button', { class: 'icon-btn', style: 'width:28px;height:28px', onclick: () => win.remove() }, icon('close', 's18'))),
    to, subj, body,
    el('footer', {},
      el('button', {
        class: 'btn btn-filled', onclick: async () => {
          if (!to.value) return snackbar('Add at least one recipient');
          await api.post('/mail/messages', { to: to.value, subject: subj.value, body: body.value, thread_id: r?.thread_id });
          win.remove(); snackbar('Message sent'); load();
        },
      }, 'Send'),
      el('button', {
        class: 'icon-btn', 'data-tip': 'Save draft', onclick: async () => {
          await api.post('/mail/messages', { to: to.value, subject: subj.value, body: body.value, draft: true });
          win.remove(); snackbar('Draft saved'); load();
        },
      }, icon('save')),
      el('div', { class: 'spacer' }),
      el('button', { class: 'icon-btn', 'data-tip': 'Discard', onclick: () => { win.remove(); snackbar('Draft discarded'); } }, icon('delete'))));
  document.body.appendChild(win);
  setTimeout(() => (r ? body : to).focus(), 50);
}

document.addEventListener('keydown', e => {
  if (e.target.matches('input,textarea')) return;
  if (e.key === 'c') { e.preventDefault(); compose(); }
  if (e.key === '/') { e.preventDefault(); document.getElementById('shellSearch').focus(); }
  if (e.key === 'u' && S.open) { S.open = null; load(); }
});

load();
