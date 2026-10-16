// Synergy Forms — builder, live preview, responses.
import { mountShell, api, el, icon, snackbar, dialog, contextMenu, MIME } from '/shared/shell.js';

const TYPES = [
  { id: 'short', label: 'Short answer', icon: 'short_text' },
  { id: 'para', label: 'Paragraph', icon: 'notes' },
  { id: 'radio', label: 'Multiple choice', icon: 'radio_button_checked' },
  { id: 'check', label: 'Checkboxes', icon: 'check_box' },
  { id: 'select', label: 'Dropdown', icon: 'arrow_drop_down_circle' },
  { id: 'scale', label: 'Linear scale', icon: 'linear_scale' },
  { id: 'date', label: 'Date', icon: 'event' },
];

const S = {
  fileId: new URLSearchParams(location.search).get('id'),
  tab: 'questions',
  form: { title: 'Untitled form', desc: '', questions: [] },
  sel: 0,
  responses: [],
  answers: {},
};

document.getElementById('shell').appendChild(mountShell({ app: 'forms', search: false }));

function renderTabs() {
  document.getElementById('tabs').replaceChildren(
    ...[['questions', 'Questions'], ['responses', `Responses (${S.responses.length})`], ['preview', 'Preview']]
      .map(([id, label]) => el('button', {
        class: S.tab === id ? 'on' : '',
        onclick: () => { S.tab = id; render(); },
      }, label)));
}

function render() {
  renderTabs();
  const main = document.getElementById('main');
  main.replaceChildren(
    S.tab === 'questions' ? builder() : S.tab === 'responses' ? responses() : preview());
}

// ------------------------------------------------------------------ builder
function builder() {
  const wrap = el('div', { class: 'form-wrap' });

  wrap.append(el('div', { class: 'card-q form-head' },
    el('input', {
      class: 't', value: S.form.title, placeholder: 'Untitled form',
      oninput: e => { S.form.title = e.target.value; save(); },
    }),
    el('input', {
      class: 'd', value: S.form.desc, placeholder: 'Form description',
      oninput: e => { S.form.desc = e.target.value; save(); },
    })));

  S.form.questions.forEach((q, i) => wrap.append(questionCard(q, i)));

  wrap.append(el('div', { class: 'row gap8', style: 'margin-top:16px' },
    el('button', { class: 'btn btn-filled', style: 'background:#7248b9', onclick: () => addQuestion() },
      icon('add', 's18'), 'Add question'),
    el('button', { class: 'btn btn-outline', style: 'color:#7248b9', onclick: () => { S.tab = 'preview'; render(); } },
      icon('visibility', 's18'), 'Preview'),
    el('button', {
      class: 'btn btn-outline', style: 'color:#7248b9',
      onclick: () => { navigator.clipboard?.writeText(location.origin + '/forms/?id=' + S.fileId + '#fill'); snackbar('Form link copied'); },
    }, icon('link', 's18'), 'Send')));
  return wrap;
}

function questionCard(q, i) {
  const card = el('div', {
    class: 'card-q' + (S.sel === i ? ' sel' : ''),
    onclick: () => { S.sel = i; render(); },
  });
  card.append(el('div', { class: 'row gap16', style: 'align-items:flex-start' },
    el('input', {
      class: 'q-title', value: q.title, placeholder: 'Question',
      oninput: e => { q.title = e.target.value; save(); },
    }),
    el('select', {
      class: 'field', style: 'width:190px;height:44px',
      onchange: e => { q.type = e.target.value; if (needsOptions(q.type) && !q.options?.length) q.options = ['Option 1']; render(); save(); },
    }, ...TYPES.map(t => el('option', { value: t.id, selected: t.id === q.type }, t.label)))));

  const body = el('div', { style: 'margin-top:16px' });
  if (needsOptions(q.type)) {
    (q.options || []).forEach((opt, oi) => body.append(el('div', { class: 'opt-row' },
      icon(q.type === 'check' ? 'check_box_outline_blank' : q.type === 'select' ? 'arrow_drop_down' : 'radio_button_unchecked'),
      el('input', {
        class: 'txt', value: opt,
        oninput: e => { q.options[oi] = e.target.value; save(); },
      }),
      el('button', {
        class: 'icon-btn', onclick: () => { q.options.splice(oi, 1); render(); save(); },
      }, icon('close', 's18')))));
    body.append(el('div', { class: 'opt-row' },
      icon(q.type === 'check' ? 'check_box_outline_blank' : 'radio_button_unchecked'),
      el('span', {
        class: 'muted', style: 'cursor:pointer',
        onclick: () => { q.options = [...(q.options || []), 'Option ' + ((q.options || []).length + 1)]; render(); save(); },
      }, 'Add option')));
  } else if (q.type === 'scale') {
    body.append(el('div', { class: 'row gap12' },
      el('select', { class: 'field', style: 'width:80px', onchange: e => { q.min = +e.target.value; save(); } },
        ...[0, 1].map(n => el('option', { value: n, selected: (q.min ?? 1) === n }, String(n)))),
      el('span', {}, 'to'),
      el('select', { class: 'field', style: 'width:80px', onchange: e => { q.max = +e.target.value; save(); } },
        ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => el('option', { value: n, selected: (q.max ?? 5) === n }, String(n))))));
  } else {
    body.append(el('div', { class: 'muted', style: 'border-bottom:1px dotted var(--outline-variant);padding-bottom:6px;font-size:14px' },
      q.type === 'para' ? 'Long answer text' : q.type === 'date' ? 'Month, day, year' : 'Short answer text'));
  }
  card.append(body);

  card.append(el('div', { class: 'q-foot' },
    el('button', {
      class: 'icon-btn', 'data-tip': 'Duplicate',
      onclick: e => { e.stopPropagation(); S.form.questions.splice(i + 1, 0, JSON.parse(JSON.stringify(q))); render(); save(); },
    }, icon('file_copy')),
    el('button', {
      class: 'icon-btn', 'data-tip': 'Delete',
      onclick: e => { e.stopPropagation(); S.form.questions.splice(i, 1); S.sel = Math.max(0, i - 1); render(); save(); },
    }, icon('delete')),
    el('div', { style: 'width:1px;height:24px;background:var(--divider);margin:0 8px' }),
    el('label', { class: 'row gap8', style: 'font-size:14px;cursor:pointer' },
      el('span', {}, 'Required'),
      el('input', {
        type: 'checkbox', checked: !!q.required,
        onchange: e => { q.required = e.target.checked; save(); },
      }))));
  return card;
}

const needsOptions = t => ['radio', 'check', 'select'].includes(t);

function addQuestion(type = 'radio') {
  S.form.questions.push({
    title: '', type, required: false,
    options: needsOptions(type) ? ['Option 1'] : undefined,
  });
  S.sel = S.form.questions.length - 1;
  render(); save();
}

// ------------------------------------------------------------------ preview / fill
function preview() {
  const wrap = el('div', { class: 'form-wrap' });
  wrap.append(el('div', { class: 'card-q form-head' },
    el('h1', { class: 'gsans', style: 'font-weight:400;font-size:32px;margin:0 0 8px' }, S.form.title),
    S.form.desc ? el('p', { class: 'muted', style: 'margin:0' }, S.form.desc) : null,
    el('div', { class: 'divider', style: 'margin:16px 0 8px' }),
    el('span', { style: 'color:var(--red);font-size:13px' }, '* Required')));

  S.form.questions.forEach((q, i) => {
    const card = el('div', { class: 'card-q' },
      el('div', { style: 'font-size:16px;margin-bottom:14px' }, q.title || `Question ${i + 1}`,
        q.required ? el('span', { style: 'color:var(--red)' }, ' *') : null));
    const name = 'q' + i;
    if (q.type === 'short' || q.type === 'date')
      card.append(el('input', {
        class: 'field', type: q.type === 'date' ? 'date' : 'text',
        placeholder: 'Your answer', oninput: e => S.answers[i] = e.target.value,
      }));
    else if (q.type === 'para')
      card.append(el('textarea', { class: 'field', rows: 3, placeholder: 'Your answer', oninput: e => S.answers[i] = e.target.value }));
    else if (q.type === 'select')
      card.append(el('select', { class: 'field', onchange: e => S.answers[i] = e.target.value },
        el('option', { value: '' }, 'Choose'), ...(q.options || []).map(o => el('option', { value: o }, o))));
    else if (q.type === 'scale') {
      const row = el('div', { class: 'row gap16' });
      for (let n = (q.min ?? 1); n <= (q.max ?? 5); n++)
        row.append(el('label', { class: 'col', style: 'align-items:center;gap:6px;cursor:pointer' },
          el('span', {}, String(n)),
          el('input', { type: 'radio', name, value: n, onchange: () => S.answers[i] = n })));
      card.append(row);
    } else {
      for (const o of (q.options || []))
        card.append(el('label', { class: 'opt-row', style: 'cursor:pointer' },
          el('input', {
            type: q.type === 'check' ? 'checkbox' : 'radio', name, value: o,
            onchange: e => {
              if (q.type === 'check') {
                const cur = new Set(S.answers[i] || []);
                e.target.checked ? cur.add(o) : cur.delete(o);
                S.answers[i] = [...cur];
              } else S.answers[i] = o;
            },
          }),
          el('span', {}, o)));
    }
    wrap.append(card);
  });

  wrap.append(el('div', { class: 'row gap8', style: 'margin-top:16px' },
    el('button', {
      class: 'btn btn-filled', style: 'background:#7248b9',
      onclick: async () => {
        const missing = S.form.questions.findIndex((q, i) =>
          q.required && (S.answers[i] === undefined || S.answers[i] === '' || (Array.isArray(S.answers[i]) && !S.answers[i].length)));
        if (missing >= 0) return snackbar(`“${S.form.questions[missing].title || 'Question ' + (missing + 1)}” is required`);
        if (!S.fileId) return snackbar('Save the form to Drive before collecting responses');
        await api.post(`/forms/${S.fileId}/responses`, { answers: S.answers, respondent: 'shane@example.com' });
        S.answers = {};
        S.responses = await api.get(`/forms/${S.fileId}/responses`);
        snackbar('Response recorded');
        render();
      },
    }, 'Submit'),
    el('button', { class: 'btn btn-text', style: 'color:#7248b9', onclick: () => { S.answers = {}; render(); } }, 'Clear form')));
  return wrap;
}

// ------------------------------------------------------------------ responses
function responses() {
  const wrap = el('div', { class: 'form-wrap' });
  if (!S.responses.length) {
    wrap.append(el('div', { class: 'resp-summary' },
      el('div', { class: 'empty' }, icon('inbox'),
        el('h3', {}, 'Waiting for responses'),
        el('p', {}, 'Share the form link, or submit one from the Preview tab to see the summary here.'))));
    return wrap;
  }
  wrap.append(el('div', { class: 'resp-summary' },
    el('div', { class: 'row' },
      el('h2', { class: 'gsans spacer', style: 'font-weight:400;margin:0' }, `${S.responses.length} response${S.responses.length === 1 ? '' : 's'}`),
      el('button', { class: 'btn btn-outline', onclick: exportCsv }, icon('download', 's18'), 'Download CSV'))));

  S.form.questions.forEach((q, i) => {
    const card = el('div', { class: 'resp-summary' },
      el('div', { style: 'font-weight:500;margin-bottom:12px' }, q.title || `Question ${i + 1}`));
    const vals = S.responses.map(r => { try { return JSON.parse(r.answers)[i]; } catch { return undefined; } })
      .filter(v => v !== undefined && v !== '');
    if (needsOptions(q.type) || q.type === 'scale') {
      const counts = {};
      for (const v of vals) for (const x of (Array.isArray(v) ? v : [v])) counts[x] = (counts[x] || 0) + 1;
      const max = Math.max(1, ...Object.values(counts));
      const keys = needsOptions(q.type) ? (q.options || []) : Object.keys(counts);
      for (const k of keys)
        card.append(el('div', { class: 'row gap12', style: 'padding:4px 0' },
          el('span', { style: 'width:150px;font-size:13px' }, String(k)),
          el('div', { class: 'bar', style: `width:${((counts[k] || 0) / max) * 100}%;min-width:2px;flex:0 0 auto` }),
          el('span', { class: 'muted', style: 'font-size:12px' }, `${counts[k] || 0}`)));
    } else {
      for (const v of vals.slice(0, 20))
        card.append(el('div', { style: 'padding:8px 12px;background:var(--surface-c-low);border-radius:6px;margin-bottom:6px;font-size:14px' }, String(v)));
      if (!vals.length) card.append(el('div', { class: 'muted' }, 'No answers yet'));
    }
    wrap.append(card);
  });
  return wrap;
}

function exportCsv() {
  const head = ['Timestamp', ...S.form.questions.map((q, i) => q.title || 'Q' + (i + 1))];
  const rows = S.responses.map(r => {
    let a = {}; try { a = JSON.parse(r.answers); } catch {}
    return [new Date(r.submitted).toLocaleString(), ...S.form.questions.map((q, i) =>
      Array.isArray(a[i]) ? a[i].join('; ') : (a[i] ?? ''))];
  });
  const csv = [head, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: S.form.title + '.csv' });
  document.body.appendChild(a); a.click(); a.remove();
  snackbar('Responses downloaded');
}

// ------------------------------------------------------------------ persistence
let t;
function save() {
  if (!S.fileId) return;
  clearTimeout(t);
  t = setTimeout(() => api.patch('/drive/files/' + S.fileId, {
    name: S.form.title, content: JSON.stringify(S.form),
  }), 700);
}

const SAMPLE = {
  title: 'Customer Satisfaction Survey',
  desc: 'Help us understand how the suite is working for your team. Takes about two minutes.',
  questions: [
    { title: 'How satisfied are you with Synergy Workspace?', type: 'scale', min: 1, max: 5, required: true },
    { title: 'Which apps do you use weekly?', type: 'check', required: false,
      options: ['Mail', 'Drive', 'Docs', 'Sheets', 'Slides', 'Calendar', 'Chat', 'Meet'] },
    { title: 'What is your role?', type: 'radio', required: true,
      options: ['Engineering', 'Sales', 'Operations', 'Leadership', 'Other'] },
    { title: 'What should we build next?', type: 'para', required: false },
  ],
};

async function boot() {
  if (S.fileId) {
    const f = await api.get('/drive/files/' + S.fileId);
    if (f && !f.error) {
      try {
        const p = JSON.parse(f.content || 'null');
        if (p && p.questions) S.form = p;
        else S.form = { ...SAMPLE, title: f.name };
      } catch { S.form = { ...SAMPLE, title: f.name }; }
    }
    S.responses = await api.get(`/forms/${S.fileId}/responses`);
  } else {
    S.form = JSON.parse(JSON.stringify(SAMPLE));
  }
  if (location.hash === '#fill') S.tab = 'preview';
  render();
}
boot();
