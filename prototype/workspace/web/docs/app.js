// Synergy Docs — rich text editor over contenteditable.
import { mountShell, api, el, icon, snackbar, dialog, contextMenu, MIME } from '/shared/shell.js';

const S = {
  fileId: new URLSearchParams(location.search).get('id'),
  name: 'Untitled document',
  mode: 'edit',
};

const page = document.getElementById('page');
const exec = (cmd, val = null) => { page.focus(); document.execCommand(cmd, false, val); sync(); };

document.getElementById('shell').appendChild(mountShell({ app: 'docs', search: false }));

// ---------------------------------------------------------------- toolbar
function tb(name, tip, onClick, isOnFn) {
  const b = el('button', { class: 'tb-btn', 'data-tip': tip, onmousedown: e => e.preventDefault(), onclick: onClick }, icon(name));
  if (isOnFn) b.dataset.state = isOnFn;
  return b;
}

const FONTS = ['Arial', 'Times New Roman', 'Georgia', 'Courier New', 'Verdana', 'Roboto'];
const SIZES = [8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48];
const STYLES = [['p', 'Normal text'], ['h1', 'Title'], ['h2', 'Heading 1'], ['h3', 'Heading 2'], ['blockquote', 'Quote']];
const PALETTE = ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#ffffff',
  '#d93025', '#e8710a', '#f9ab00', '#188038', '#1a73e8', '#9334e6',
  '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#cfe2f3', '#d9d2e9'];

function colorBtn(iconName, tip, cmd) {
  const b = el('button', { class: 'tb-btn', 'data-tip': tip, onmousedown: e => e.preventDefault() }, icon(iconName));
  b.addEventListener('click', e => {
    e.stopPropagation();
    const r = b.getBoundingClientRect();
    const pop = el('div', {
      class: 'menu open',
      style: `left:${r.left}px;top:${r.bottom + 4}px;padding:10px;display:grid;grid-template-columns:repeat(6,24px);gap:6px`,
    }, ...PALETTE.map(c => el('div', {
      style: `width:24px;height:24px;border-radius:4px;background:${c};border:1px solid var(--outline-variant);cursor:pointer`,
      onclick: () => { exec(cmd, c); pop.remove(); },
    })));
    document.body.appendChild(pop);
    setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }), 0);
  });
  return b;
}

function renderToolbar() {
  document.getElementById('toolbar').replaceChildren(
    tb('undo', 'Undo (Ctrl+Z)', () => exec('undo')),
    tb('redo', 'Redo (Ctrl+Y)', () => exec('redo')),
    tb('print', 'Print (Ctrl+P)', () => window.print()),
    tb('format_paint', 'Paint format', () => snackbar('Select text, then click to copy its formatting')),
    el('select', {
      class: 'tb-sel', style: 'width:120px', 'data-tip': 'Zoom',
      onchange: e => { page.style.zoom = e.target.value; },
    }, ...['50%', '75%', '90%', '100%', '125%', '150%', '200%'].map(z =>
      el('option', { value: z, selected: z === '100%' }, z))),
    el('div', { class: 'sep' }),
    el('select', {
      class: 'tb-sel', style: 'width:130px', id: 'styleSel', 'data-tip': 'Styles',
      onchange: e => exec('formatBlock', e.target.value),
    }, ...STYLES.map(([v, l]) => el('option', { value: v }, l))),
    el('select', {
      class: 'tb-sel', style: 'width:130px', 'data-tip': 'Font',
      onchange: e => exec('fontName', e.target.value),
    }, ...FONTS.map(f => el('option', { value: f, selected: f === 'Times New Roman' }, f))),
    el('select', {
      class: 'tb-sel', style: 'width:56px', 'data-tip': 'Font size',
      onchange: e => applyFontSize(e.target.value),
    }, ...SIZES.map(s => el('option', { value: s, selected: s === 11 }, String(s)))),
    el('div', { class: 'sep' }),
    tb('format_bold', 'Bold (Ctrl+B)', () => exec('bold'), 'bold'),
    tb('format_italic', 'Italic (Ctrl+I)', () => exec('italic'), 'italic'),
    tb('format_underlined', 'Underline (Ctrl+U)', () => exec('underline'), 'underline'),
    tb('strikethrough_s', 'Strikethrough', () => exec('strikeThrough'), 'strikeThrough'),
    colorBtn('format_color_text', 'Text color', 'foreColor'),
    colorBtn('format_color_fill', 'Highlight color', 'hiliteColor'),
    el('div', { class: 'sep' }),
    tb('link', 'Insert link (Ctrl+K)', insertLink),
    tb('add_comment', 'Add comment', addComment),
    tb('image', 'Insert image', insertImage),
    tb('table', 'Insert table', insertTable),
    el('div', { class: 'sep' }),
    tb('format_align_left', 'Left align', () => exec('justifyLeft'), 'justifyLeft'),
    tb('format_align_center', 'Center align', () => exec('justifyCenter'), 'justifyCenter'),
    tb('format_align_right', 'Right align', () => exec('justifyRight'), 'justifyRight'),
    tb('format_align_justify', 'Justify', () => exec('justifyFull'), 'justifyFull'),
    el('select', {
      class: 'tb-sel', 'data-tip': 'Line spacing',
      onchange: e => { document.execCommand('styleWithCSS', false, true); applyBlockStyle('lineHeight', e.target.value); },
    }, ...[['1.5', 'Line spacing'], ['1', 'Single'], ['1.15', '1.15'], ['1.5', '1.5'], ['2', 'Double']]
      .map(([v, l]) => el('option', { value: v }, l))),
    tb('format_list_bulleted', 'Bulleted list', () => exec('insertUnorderedList')),
    tb('format_list_numbered', 'Numbered list', () => exec('insertOrderedList')),
    tb('format_indent_decrease', 'Decrease indent', () => exec('outdent')),
    tb('format_indent_increase', 'Increase indent', () => exec('indent')),
    tb('format_clear', 'Clear formatting', () => exec('removeFormat')),
  );
}

function applyFontSize(px) {
  document.execCommand('styleWithCSS', false, true);
  // execCommand's fontSize only takes 1-7, so relabel the produced element
  document.execCommand('fontSize', false, '7');
  for (const f of page.querySelectorAll('font[size="7"]')) {
    const span = document.createElement('span');
    span.style.fontSize = px + 'pt';
    span.innerHTML = f.innerHTML;
    f.replaceWith(span);
  }
  sync();
}

function applyBlockStyle(prop, value) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType === 3) node = node.parentNode;
  const block = node.closest('p,h1,h2,h3,li,blockquote,div') || page;
  block.style[prop] = value;
  sync();
}

function insertLink() {
  const sel = window.getSelection();
  const text = sel.toString();
  const url = el('input', { class: 'field', placeholder: 'https://example.com' });
  const label = el('input', { class: 'field', value: text, placeholder: 'Text to display', style: 'margin-bottom:8px' });
  const range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  dialog('Insert link', el('div', {}, label, url), [
    { label: 'Cancel' },
    {
      label: 'Apply', primary: true, onClick: () => {
        if (!url.value) return;
        page.focus();
        if (range) { sel.removeAllRanges(); sel.addRange(range); }
        const a = `<a href="${url.value}" target="_blank">${label.value || url.value}</a>`;
        document.execCommand('insertHTML', false, a);
        sync();
      },
    },
  ]);
}

function insertImage() {
  const url = el('input', { class: 'field', placeholder: 'Image URL' });
  dialog('Insert image', el('div', {}, url), [
    { label: 'Cancel' },
    { label: 'Insert', primary: true, onClick: () => { if (url.value) exec('insertHTML', `<img src="${url.value}" style="max-width:100%">`); } },
  ]);
}

function insertTable() {
  const rows = el('input', { class: 'field', type: 'number', value: 3, style: 'margin-bottom:8px' });
  const cols = el('input', { class: 'field', type: 'number', value: 3 });
  dialog('Insert table', el('div', {},
    el('label', { class: 'field-label' }, 'Rows'), rows,
    el('label', { class: 'field-label' }, 'Columns'), cols), [
    { label: 'Cancel' },
    {
      label: 'Insert', primary: true, onClick: () => {
        let html = '<table>';
        for (let r = 0; r < +rows.value; r++) {
          html += '<tr>';
          for (let c = 0; c < +cols.value; c++) html += '<td><br></td>';
          html += '</tr>';
        }
        exec('insertHTML', html + '</table><p><br></p>');
      },
    },
  ]);
}

// ---------------------------------------------------------------- comments
async function addComment() {
  const sel = window.getSelection();
  const anchor = sel.toString().slice(0, 60);
  const inp = el('textarea', { class: 'field', rows: 3, placeholder: 'Comment' });
  dialog('Comment', el('div', {},
    anchor ? el('div', { class: 'muted', style: 'margin-bottom:8px;font-style:italic' }, `“${anchor}”`) : null, inp), [
    { label: 'Cancel' },
    {
      label: 'Comment', primary: true, onClick: async () => {
        if (!inp.value.trim() || !S.fileId) return;
        await api.post('/comments/' + S.fileId, { anchor, body: inp.value });
        document.getElementById('cmtPane').classList.remove('hidden');
        loadComments();
      },
    },
  ]);
}

async function loadComments() {
  if (!S.fileId) return;
  const list = await api.get('/comments/' + S.fileId);
  const pane = document.getElementById('cmtPane');
  pane.replaceChildren(
    el('div', { class: 'row', style: 'margin-bottom:12px' },
      el('h3', { class: 'gsans spacer', style: 'margin:0;font-size:16px;font-weight:400' }, `Comments (${list.filter(c => !c.resolved).length})`),
      el('button', { class: 'icon-btn', onclick: () => pane.classList.add('hidden') }, icon('close'))),
    ...(list.length ? list.map(c => el('div', { class: 'cmt' + (c.resolved ? ' resolved' : '') },
      el('div', { class: 'row gap8', style: 'margin-bottom:6px' },
        el('div', { class: 'avatar sm' }, 'SA'),
        el('div', { class: 'col spacer' },
          el('b', { style: 'font-size:13px;font-weight:500' }, 'Shane Ansel'),
          el('span', { class: 'muted', style: 'font-size:11px' }, new Date(c.created).toLocaleString())),
        el('button', {
          class: 'icon-btn', 'data-tip': c.resolved ? 'Re-open' : 'Resolve',
          onclick: async () => { await api.patch(`/comments/${S.fileId}/${c.id}`, { resolved: c.resolved ? 0 : 1 }); loadComments(); },
        }, icon(c.resolved ? 'replay' : 'check')),
        el('button', {
          class: 'icon-btn', 'data-tip': 'Delete',
          onclick: async () => { await api.del(`/comments/${S.fileId}/${c.id}`); loadComments(); },
        }, icon('delete'))),
      c.anchor ? el('div', { class: 'muted', style: 'font-size:12px;font-style:italic;margin-bottom:4px' }, `“${c.anchor}”`) : null,
      el('div', { style: 'font-size:14px' }, c.body)))
      : [el('div', { class: 'muted', style: 'font-size:13px;padding:8px' }, 'No comments yet. Select text and click the comment button.')]));
}

document.getElementById('cmtToggle').addEventListener('click', () => {
  const p = document.getElementById('cmtPane');
  p.classList.toggle('hidden');
  if (!p.classList.contains('hidden')) loadComments();
});

// ---------------------------------------------------------------- outline + word count
function sync() {
  const text = page.innerText || '';
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  document.getElementById('wordcount').textContent =
    `${words} word${words === 1 ? '' : 's'} · ${text.length} characters`;

  const out = document.getElementById('outline');
  const hs = [...page.querySelectorAll('h1,h2,h3')];
  out.replaceChildren(el('h4', {}, 'OUTLINE'),
    ...(hs.length ? hs.map((h, i) => {
      h.id = h.id || 'h' + i;
      return el('a', {
        href: '#' + h.id,
        style: 'padding-left:' + ({ H1: 8, H2: 20, H3: 32 }[h.tagName]) + 'px',
        onclick: e => { e.preventDefault(); h.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
      }, h.textContent || 'Untitled');
    }) : [el('div', { class: 'muted', style: 'font-size:13px' },
      'Headings you add to the document will appear here.')]));
  save();
}

// ---------------------------------------------------------------- menubar
function renderMenubar() {
  const menus = {
    File: [
      { label: 'New document', icon: 'add', onClick: async () => { const f = await api.post('/drive/files', { name: 'Untitled document', mime: MIME.doc }); location.href = '/docs/?id=' + f.id; } },
      { label: 'Make a copy', icon: 'file_copy', onClick: async () => { const f = await api.post('/drive/files', { name: 'Copy of ' + S.name, mime: MIME.doc, content: JSON.stringify({ html: page.innerHTML }) }); location.href = '/docs/?id=' + f.id; } },
      '-',
      { label: 'Download as HTML', icon: 'download', onClick: downloadHtml },
      { label: 'Print', icon: 'print', onClick: () => window.print() },
    ],
    Edit: [
      { label: 'Undo', icon: 'undo', onClick: () => exec('undo') },
      { label: 'Redo', icon: 'redo', onClick: () => exec('redo') },
      '-',
      { label: 'Select all', icon: 'select_all', onClick: () => exec('selectAll') },
      { label: 'Find and replace', icon: 'find_replace', onClick: findReplace },
    ],
    View: [
      { label: 'Show outline', icon: 'toc', onClick: () => document.getElementById('outline').classList.toggle('hidden') },
      { label: 'Show comments', icon: 'comment', onClick: () => { document.getElementById('cmtPane').classList.toggle('hidden'); loadComments(); } },
      { label: 'Full screen', icon: 'fullscreen', onClick: () => document.documentElement.requestFullscreen?.() },
    ],
    Insert: [
      { label: 'Image', icon: 'image', onClick: insertImage },
      { label: 'Table', icon: 'table', onClick: insertTable },
      { label: 'Link', icon: 'link', onClick: insertLink },
      { label: 'Comment', icon: 'add_comment', onClick: addComment },
      '-',
      { label: 'Horizontal line', icon: 'horizontal_rule', onClick: () => exec('insertHorizontalRule') },
      { label: 'Page break', icon: 'insert_page_break', onClick: () => exec('insertHTML', '<div style="page-break-after:always"></div>') },
      { label: 'Date', icon: 'event', onClick: () => exec('insertText', new Date().toLocaleDateString()) },
    ],
    Format: [
      { label: 'Bold', icon: 'format_bold', onClick: () => exec('bold') },
      { label: 'Italic', icon: 'format_italic', onClick: () => exec('italic') },
      { label: 'Underline', icon: 'format_underlined', onClick: () => exec('underline') },
      '-',
      ...STYLES.map(([v, l]) => ({ label: l, icon: 'title', onClick: () => exec('formatBlock', v) })),
      '-',
      { label: 'Clear formatting', icon: 'format_clear', onClick: () => exec('removeFormat') },
    ],
    Tools: [
      { label: 'Word count', icon: 'calculate', onClick: wordCountDialog },
      { label: 'Spelling', icon: 'spellcheck', onClick: () => snackbar('Spell check is handled by the browser — misspellings are underlined as you type.') },
    ],
    Help: [
      { label: 'Keyboard shortcuts', icon: 'keyboard', onClick: shortcutsDialog },
    ],
  };
  document.getElementById('menubar').replaceChildren(...Object.entries(menus).map(([name, m]) =>
    el('button', {
      onclick: e => { e.stopPropagation(); const r = e.target.getBoundingClientRect(); contextMenu(r.left, r.bottom + 2, m); },
    }, name)));
}

function wordCountDialog() {
  const text = page.innerText || '';
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const rows = [['Pages', String(Math.max(1, Math.ceil(page.scrollHeight / 1056)))],
    ['Words', String(words)], ['Characters', String(text.length)],
    ['Characters excluding spaces', String(text.replace(/\s/g, '').length)],
    ['Paragraphs', String(page.querySelectorAll('p,h1,h2,h3,li').length)]];
  dialog('Word count', el('div', {}, ...rows.map(([k, v]) =>
    el('div', { class: 'row', style: 'padding:6px 0' },
      el('span', { class: 'spacer' }, k), el('b', {}, v)))), [{ label: 'OK', primary: true }]);
}

function shortcutsDialog() {
  const rows = [['Ctrl+B / I / U', 'Bold / italic / underline'], ['Ctrl+K', 'Insert link'],
    ['Ctrl+Z / Y', 'Undo / redo'], ['Ctrl+Alt+1/2/3', 'Heading 1 / 2 / 3'],
    ['Ctrl+Shift+8', 'Bulleted list'], ['Ctrl+Shift+7', 'Numbered list'], ['Ctrl+P', 'Print']];
  dialog('Keyboard shortcuts', el('div', {}, ...rows.map(([k, v]) =>
    el('div', { class: 'row', style: 'padding:6px 0;gap:16px' },
      el('b', { style: 'width:150px;font-weight:500' }, k), el('span', { class: 'muted' }, v)))),
    [{ label: 'Close', primary: true }]);
}

function findReplace() {
  const find = el('input', { class: 'field', placeholder: 'Find', style: 'margin-bottom:8px' });
  const rep = el('input', { class: 'field', placeholder: 'Replace with' });
  dialog('Find and replace', el('div', {}, find, rep), [
    { label: 'Cancel' },
    {
      label: 'Replace all', primary: true, onClick: () => {
        if (!find.value) return;
        const rx = new RegExp(find.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        const n = (page.innerHTML.match(rx) || []).length;
        page.innerHTML = page.innerHTML.replace(rx, rep.value);
        sync(); snackbar(`${n} replacement(s) made`);
      },
    },
  ]);
}

function downloadHtml() {
  const html = `<!doctype html><meta charset="utf-8"><title>${S.name}</title><body>${page.innerHTML}`;
  const a = el('a', { href: URL.createObjectURL(new Blob([html], { type: 'text/html' })), download: S.name + '.html' });
  document.body.appendChild(a); a.click(); a.remove();
  snackbar('Downloaded');
}

// ---------------------------------------------------------------- shortcuts
page.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;
  const k = e.key.toLowerCase();
  if (k === 'k') { e.preventDefault(); insertLink(); }
  if (e.altKey && '123'.includes(e.key)) { e.preventDefault(); exec('formatBlock', 'h' + e.key); }
  if (e.shiftKey && e.key === '*') { e.preventDefault(); exec('insertUnorderedList'); }
});
page.addEventListener('input', sync);
page.addEventListener('blur', sync);

// ---------------------------------------------------------------- persistence
let saveTimer;
function save() {
  if (!S.fileId) return;
  const st = document.getElementById('saveState');
  st.textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await api.patch('/drive/files/' + S.fileId, {
      name: S.name, content: JSON.stringify({ html: page.innerHTML }),
    });
    st.textContent = 'Saved to Drive';
    setTimeout(() => { if (st.textContent === 'Saved to Drive') st.textContent = ''; }, 2500);
  }, 800);
}

document.getElementById('title').addEventListener('change', e => { S.name = e.target.value; save(); });
document.getElementById('shareBtn').addEventListener('click', () =>
  dialog('Share “' + S.name + '”', el('div', {},
    el('input', { class: 'field', placeholder: 'Add people and groups' }),
    el('div', { class: 'muted', style: 'margin-top:16px;font-size:13px' },
      'Restricted — only people with access can open this document.')),
    [{ label: 'Copy link', onClick: () => { navigator.clipboard?.writeText(location.href); snackbar('Link copied'); return false; } },
     { label: 'Done', primary: true }]));

// Convert the seeded block format into HTML.
function blocksToHtml(blocks) {
  const out = [];
  let inList = false;
  for (const b of blocks) {
    if (typeof b === 'string') { if (inList) { out.push('</ul>'); inList = false; } out.push(`<p>${b}</p>`); continue; }
    if (b.type === 'li') { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${b.text}</li>`); continue; }
    if (inList) { out.push('</ul>'); inList = false; }
    if (b.type === 'h1') out.push(`<h1>${b.text}</h1>`);
    else if (b.type === 'h2') out.push(`<h2>${b.text}</h2>`);
    else if (b.type === 'h3') out.push(`<h3>${b.text}</h3>`);
    else out.push(`<p>${b.text}</p>`);
  }
  if (inList) out.push('</ul>');
  return out.join('');
}

const SAMPLE = `<h1>Untitled document</h1><p>Start writing, or use the toolbar above to format your text.</p>`;

async function boot() {
  renderToolbar(); renderMenubar();
  if (S.fileId) {
    const f = await api.get('/drive/files/' + S.fileId);
    if (f && !f.error) {
      S.name = f.name;
      document.getElementById('title').value = f.name;
      let html = '';
      try {
        const parsed = JSON.parse(f.content || 'null');
        if (parsed && parsed.html) html = parsed.html;
        else if (parsed && parsed.blocks) html = blocksToHtml(parsed.blocks);
      } catch { html = `<p>${(f.content || '').replace(/\n/g, '</p><p>')}</p>`; }
      page.innerHTML = html || SAMPLE;
    } else page.innerHTML = SAMPLE;
    loadComments();
  } else page.innerHTML = SAMPLE;
  sync();
  clearTimeout(saveTimer);
  document.getElementById('saveState').textContent = '';
}
boot();
