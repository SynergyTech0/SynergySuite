// Synergy Tasks
import { mountShell, api, el, icon, snackbar, dialog, contextMenu } from '/shared/shell.js';

const S = { lists: [], tasks: [], list: null, showDone: true, q: '' };

document.getElementById('shell').appendChild(mountShell({
  app: 'tasks',
  onSearch: v => { S.q = v; render(); },
}));

async function load() {
  S.lists = await api.get('/tasks/lists');
  if (!S.list && S.lists.length) S.list = S.lists[0].id;
  S.tasks = await api.get('/tasks' + (S.list ? '?list=' + S.list : ''));
  render();
}

function renderNav() {
  document.getElementById('nav').replaceChildren(
    el('button', {
      class: 'fab-extended', style: 'margin:8px 8px 16px 4px;align-self:flex-start',
      onclick: () => addTask(),
    }, icon('add', 's24'), 'Add a task'),
    el('div', { class: 'nav-section' }, 'Lists'),
    ...S.lists.map(l => el('div', {
      class: 'nav-item' + (S.list === l.id ? ' active' : ''),
      onclick: () => { S.list = l.id; load(); },
      oncontextmenu: e => {
        e.preventDefault();
        contextMenu(e.clientX, e.clientY, [
          { label: 'Delete list', icon: 'delete', danger: true, onClick: async () => { await api.del('/tasks/lists/' + l.id); S.list = null; load(); } },
        ]);
      },
    }, icon('check_circle'), el('span', { class: 'spacer truncate' }, l.name),
      el('span', { class: 'count' }, String(S.tasks.filter(t => t.list_id === l.id && !t.completed).length || '')))),
    el('div', { class: 'nav-divider' }),
    el('div', {
      class: 'nav-item', onclick: async () => {
        const inp = el('input', { class: 'field', placeholder: 'List name' });
        dialog('New list', el('div', {}, inp), [
          { label: 'Cancel' },
          { label: 'Create', primary: true, onClick: async () => { const l = await api.post('/tasks/lists', { name: inp.value || 'New list' }); S.list = l.id; load(); } },
        ]);
      },
    }, icon('add'), 'Create new list'));
}

function render() {
  renderNav();
  const list = S.lists.find(l => l.id === S.list);
  const visible = S.tasks.filter(t => !S.q || (t.title || '').toLowerCase().includes(S.q.toLowerCase()));
  const open = visible.filter(t => !t.completed);
  const done = visible.filter(t => t.completed);

  const wrap = el('div', { class: 'tasklist-wrap' },
    el('div', { class: 'row', style: 'margin-bottom:12px' },
      el('h2', { class: 'gsans spacer', style: 'font-size:22px;font-weight:400;margin:0' }, list ? list.name : 'Tasks'),
      el('button', {
        class: 'icon-btn', 'data-tip': 'More', onclick: e => contextMenu(e.clientX, e.clientY, [
          { label: S.showDone ? 'Hide completed' : 'Show completed', icon: 'visibility', onClick: () => { S.showDone = !S.showDone; render(); } },
          { label: 'Delete all completed', icon: 'delete_sweep', danger: true, onClick: async () => { for (const t of done) await api.del('/tasks/' + t.id); snackbar(`${done.length} completed task(s) deleted`); load(); } },
        ]),
      }, icon('more_vert'))),
    el('div', { class: 'add-row', onclick: () => addTask() }, icon('add'), el('span', {}, 'Add a task')));

  if (!open.length && !done.length)
    wrap.append(el('div', { class: 'empty' }, icon('task_alt'),
      el('h3', {}, 'No tasks yet'), el('p', {}, 'Add a task to get started.')));

  for (const t of open) wrap.append(taskRow(t));
  if (done.length && S.showDone) {
    wrap.append(el('div', { style: 'margin-top:20px;font-size:13px;font-weight:500;color:var(--on-surface-variant);padding:8px' },
      `Completed (${done.length})`));
    for (const t of done) wrap.append(taskRow(t));
  }
  document.getElementById('main').replaceChildren(wrap);
}

function taskRow(t) {
  const overdue = t.due && !t.completed && t.due < Date.now();
  return el('div', {
    class: 'task' + (t.completed ? ' done' : ''),
    onclick: () => editTask(t),
  },
    el('span', {
      class: 'mi box' + (t.completed ? ' fill' : ''),
      onclick: async e => {
        e.stopPropagation();
        await api.patch('/tasks/' + t.id, { completed: t.completed ? 0 : 1 });
        if (!t.completed) snackbar('Task completed', 'Undo', () => api.patch('/tasks/' + t.id, { completed: 0 }).then(load));
        load();
      },
    }, t.completed ? 'check_circle' : 'radio_button_unchecked'),
    el('div', { class: 'col spacer' },
      el('span', { class: 'title' }, t.title),
      t.notes ? el('span', { class: 'notes' }, t.notes) : null,
      t.due ? el('span', { class: 'due' + (overdue ? ' overdue' : '') },
        icon('event', 's18'), new Date(t.due).toLocaleDateString([], { month: 'short', day: 'numeric' })) : null),
    el('button', {
      class: 'icon-btn', 'data-tip': 'Delete',
      onclick: async e => { e.stopPropagation(); await api.del('/tasks/' + t.id); snackbar('Task deleted'); load(); },
    }, icon('delete', 's18')));
}

function addTask() { editTask(null); }

function editTask(t) {
  const title = el('input', { class: 'field', placeholder: 'Title', value: t?.title || '', style: 'margin-bottom:8px' });
  const notes = el('textarea', { class: 'field', rows: 3, placeholder: 'Details', style: 'margin-bottom:8px' }, t?.notes || '');
  const due = el('input', { class: 'field', type: 'date', value: t?.due ? new Date(t.due).toISOString().slice(0, 10) : '' });
  const listSel = el('select', { class: 'field', style: 'margin-top:8px' },
    ...S.lists.map(l => el('option', { value: l.id, selected: l.id === (t?.list_id || S.list) }, l.name)));
  dialog(t ? 'Edit task' : 'Add a task', el('div', {}, title, notes,
    el('label', { class: 'field-label' }, 'Date'), due,
    el('label', { class: 'field-label', style: 'margin-top:8px' }, 'List'), listSel), [
    { label: 'Cancel' },
    {
      label: t ? 'Save' : 'Add', primary: true, onClick: async () => {
        if (!title.value.trim()) return;
        const payload = {
          title: title.value, notes: notes.value,
          due: due.value ? new Date(due.value + 'T12:00').getTime() : null,
          list_id: listSel.value,
        };
        if (t) await api.patch('/tasks/' + t.id, payload);
        else await api.post('/tasks', payload);
        load();
      },
    },
  ]);
}

load();
