// Synergy Slides — deck editor, filmstrip, speaker notes, presenter mode.
import { mountShell, api, el, icon, snackbar, dialog, contextMenu, MIME } from '/shared/shell.js';

const W = 960, H = 540;

const THEMES = {
  Simple:   { bg: '#ffffff', fg: '#202124', accent: '#1a73e8', font: "'Google Sans', Arial, sans-serif" },
  Focus:    { bg: '#0b57d0', fg: '#ffffff', accent: '#a8c7fa', font: "'Google Sans', Arial, sans-serif" },
  Slate:    { bg: '#202124', fg: '#e8eaed', accent: '#8ab4f8', font: "'Google Sans', Arial, sans-serif" },
  Paper:    { bg: '#fdf6e3', fg: '#3c3020', accent: '#b45309', font: 'Georgia, serif' },
  Coral:    { bg: '#fff1f0', fg: '#5f2120', accent: '#d93025', font: "'Google Sans', Arial, sans-serif" },
};

const S = {
  fileId: new URLSearchParams(location.search).get('id'),
  name: 'Untitled presentation',
  theme: 'Simple',
  slides: [],
  i: 0,
  selEl: null,
  presentIdx: 0,
};

const cur = () => S.slides[S.i];
const theme = () => THEMES[S.theme] || THEMES.Simple;

document.getElementById('shell').appendChild(mountShell({ app: 'slides', search: false }));

// ---------------------------------------------------------------- layouts
function layout(kind, title = '', body = '') {
  const t = theme();
  switch (kind) {
    case 'title':
      return [
        { type: 'text', x: 80, y: 190, w: 800, h: 90, text: title || 'Click to add title',
          style: { size: 44, weight: 500, align: 'center', color: t.fg } },
        { type: 'text', x: 80, y: 290, w: 800, h: 50, text: body || 'Click to add subtitle',
          style: { size: 20, align: 'center', color: t.fg, opacity: .8 } },
      ];
    case 'titleBody':
      return [
        { type: 'text', x: 60, y: 50, w: 840, h: 70, text: title || 'Click to add title',
          style: { size: 32, weight: 500, color: t.fg } },
        { type: 'text', x: 60, y: 150, w: 840, h: 330, text: body || 'Click to add text',
          style: { size: 18, color: t.fg } },
      ];
    case 'twoCol':
      return [
        { type: 'text', x: 60, y: 50, w: 840, h: 60, text: title || 'Click to add title', style: { size: 32, weight: 500, color: t.fg } },
        { type: 'text', x: 60, y: 140, w: 400, h: 340, text: 'Column one', style: { size: 17, color: t.fg } },
        { type: 'text', x: 500, y: 140, w: 400, h: 340, text: 'Column two', style: { size: 17, color: t.fg } },
      ];
    case 'section':
      return [
        { type: 'text', x: 60, y: 230, w: 840, h: 80, text: title || 'Section',
          style: { size: 40, weight: 500, color: t.accent } },
      ];
    case 'blank': return [];
    default: return layout('titleBody', title, body);
  }
}

// ---------------------------------------------------------------- render
function renderStage(container = document.getElementById('stage'), slide = cur(), interactive = true) {
  const t = theme();
  container.style.background = slide.bg || t.bg;
  container.style.fontFamily = t.font;
  container.replaceChildren();
  if (!slide) return;
  slide.elements.forEach((e, idx) => {
    const st = e.style || {};
    const node = el(e.type === 'shape' ? 'div' : 'div', {
      class: 'el' + (interactive && S.selEl === idx ? ' sel' : ''),
      style: [
        `left:${e.x}px`, `top:${e.y}px`, `width:${e.w}px`, `min-height:${e.h}px`,
        `font-size:${st.size || 18}px`, `font-weight:${st.weight || 400}`,
        `text-align:${st.align || 'left'}`, `color:${st.color || t.fg}`,
        st.opacity ? `opacity:${st.opacity}` : '',
        st.italic ? 'font-style:italic' : '',
        st.underline ? 'text-decoration:underline' : '',
        e.type === 'shape' ? `background:${st.fill || t.accent};border-radius:${st.round || 8}px` : '',
        'line-height:1.3', 'white-space:pre-wrap', 'word-wrap:break-word',
      ].filter(Boolean).join(';'),
      contenteditable: interactive && e.type === 'text' ? 'true' : null,
    });
    if (e.type === 'image') {
      node.replaceChildren(el('img', { src: e.src, style: 'width:100%;display:block' }));
      node.removeAttribute('contenteditable');
    } else {
      node.textContent = e.text || '';
    }
    if (interactive) {
      node.addEventListener('mousedown', ev => {
        S.selEl = idx;
        if (ev.target.getAttribute('contenteditable') !== 'true' || ev.detail > 1) startDrag(ev, e, node);
        renderFilmstrip();
        document.querySelectorAll('#stage .el').forEach((n, j) => n.classList.toggle('sel', j === idx));
      });
      node.addEventListener('input', () => { e.text = node.textContent; save(); renderFilmstrip(); });
      node.addEventListener('contextmenu', ev => {
        ev.preventDefault();
        contextMenu(ev.clientX, ev.clientY, [
          { label: 'Bring to front', icon: 'flip_to_front', onClick: () => { slide.elements.push(slide.elements.splice(idx, 1)[0]); redraw(); } },
          { label: 'Duplicate', icon: 'file_copy', onClick: () => { slide.elements.push({ ...JSON.parse(JSON.stringify(e)), x: e.x + 20, y: e.y + 20 }); redraw(); } },
          { label: 'Delete', icon: 'delete', danger: true, onClick: () => { slide.elements.splice(idx, 1); S.selEl = null; redraw(); } },
        ]);
      });
    }
    container.append(node);
  });
}

function startDrag(ev, e, node) {
  if (node.getAttribute('contenteditable') === 'true' && document.activeElement === node) return;
  ev.preventDefault();
  const stage = document.getElementById('stage');
  const scale = stage.getBoundingClientRect().width / W;
  const sx = ev.clientX, sy = ev.clientY, ox = e.x, oy = e.y;
  const move = m => {
    e.x = Math.round(ox + (m.clientX - sx) / scale);
    e.y = Math.round(oy + (m.clientY - sy) / scale);
    node.style.left = e.x + 'px'; node.style.top = e.y + 'px';
  };
  const up = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    save(); renderFilmstrip();
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

function renderFilmstrip() {
  const strip = document.getElementById('filmstrip');
  strip.replaceChildren(...S.slides.map((sl, i) => {
    const thumb = el('div', { class: 'thumb' + (i === S.i ? ' on' : '') });
    const inner = el('div', {
      style: `position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform:scale(${168 / W});transform-origin:top left;pointer-events:none`,
    });
    renderStage(inner, sl, false);
    thumb.append(inner);
    return el('div', {
      class: 'thumb-row',
      onclick: () => { S.i = i; S.selEl = null; redraw(); },
      oncontextmenu: ev => {
        ev.preventDefault();
        contextMenu(ev.clientX, ev.clientY, [
          { label: 'New slide', icon: 'add', onClick: () => addSlide() },
          { label: 'Duplicate slide', icon: 'file_copy', onClick: () => { S.slides.splice(i + 1, 0, JSON.parse(JSON.stringify(sl))); S.i = i + 1; redraw(); } },
          { label: 'Move up', icon: 'arrow_upward', onClick: () => { if (i > 0) { S.slides.splice(i - 1, 0, S.slides.splice(i, 1)[0]); S.i = i - 1; redraw(); } } },
          { label: 'Move down', icon: 'arrow_downward', onClick: () => { if (i < S.slides.length - 1) { S.slides.splice(i + 1, 0, S.slides.splice(i, 1)[0]); S.i = i + 1; redraw(); } } },
          '-',
          S.slides.length > 1 ? { label: 'Delete slide', icon: 'delete', danger: true, onClick: () => { S.slides.splice(i, 1); S.i = Math.max(0, i - 1); redraw(); } } : null,
        ].filter(Boolean));
      },
    }, el('span', { class: 'n' }, String(i + 1)), thumb);
  }));
}

function redraw() {
  renderStage();
  renderFilmstrip();
  const n = document.getElementById('notes');
  n.textContent = cur().notes || '';
  save();
}

// ---------------------------------------------------------------- edits
function addSlide(kind = 'titleBody') {
  S.slides.splice(S.i + 1, 0, { layout: kind, elements: layout(kind), notes: '' });
  S.i++; S.selEl = null; redraw();
}

function styleSel(patch) {
  const e = cur().elements[S.selEl];
  if (!e) return snackbar('Select a text box first');
  e.style = { ...(e.style || {}), ...patch };
  for (const k of Object.keys(e.style)) if (e.style[k] === null) delete e.style[k];
  redraw();
}

function addText() {
  cur().elements.push({ type: 'text', x: 120, y: 240, w: 400, h: 60, text: 'New text box', style: { size: 20, color: theme().fg } });
  S.selEl = cur().elements.length - 1; redraw();
}
function addShape(round) {
  cur().elements.push({ type: 'shape', x: 200, y: 200, w: 240, h: 140, text: '', style: { fill: theme().accent, round } });
  S.selEl = cur().elements.length - 1; redraw();
}
function addImage() {
  const url = el('input', { class: 'field', placeholder: 'Image URL' });
  dialog('Insert image', el('div', {}, url), [
    { label: 'Cancel' },
    { label: 'Insert', primary: true, onClick: () => {
      if (!url.value) return;
      cur().elements.push({ type: 'image', x: 240, y: 140, w: 480, h: 270, src: url.value });
      S.selEl = cur().elements.length - 1; redraw();
    } },
  ]);
}

// ---------------------------------------------------------------- toolbar
function tb(name, tip, onClick) {
  return el('button', { class: 'tb-btn', 'data-tip': tip, onmousedown: e => e.preventDefault(), onclick: onClick }, icon(name));
}

function renderToolbar() {
  document.getElementById('toolbar').replaceChildren(
    el('button', { class: 'btn btn-tonal', style: 'height:32px;padding:0 14px;margin-right:6px', onclick: () => addSlide() },
      icon('add', 's18'), 'New slide'),
    tb('dashboard', 'Layout', e => {
      contextMenu(e.clientX, e.clientY, [
        { label: 'Title slide', icon: 'title', onClick: () => setLayout('title') },
        { label: 'Title and body', icon: 'article', onClick: () => setLayout('titleBody') },
        { label: 'Two columns', icon: 'view_column', onClick: () => setLayout('twoCol') },
        { label: 'Section header', icon: 'horizontal_rule', onClick: () => setLayout('section') },
        { label: 'Blank', icon: 'crop_square', onClick: () => setLayout('blank') },
      ]);
    }),
    tb('palette', 'Theme', e => contextMenu(e.clientX, e.clientY,
      Object.keys(THEMES).map(t => ({ label: t, icon: 'palette', onClick: () => { S.theme = t; retheme(); } })))),
    el('div', { class: 'sep' }),
    tb('text_fields', 'Text box', addText),
    tb('image', 'Image', addImage),
    tb('crop_square', 'Rectangle', () => addShape(0)),
    tb('circle', 'Rounded shape', () => addShape(999)),
    el('div', { class: 'sep' }),
    tb('format_bold', 'Bold', () => { const e = cur().elements[S.selEl]; styleSel({ weight: (e?.style?.weight === 700) ? 400 : 700 }); }),
    tb('format_italic', 'Italic', () => { const e = cur().elements[S.selEl]; styleSel({ italic: e?.style?.italic ? null : 1 }); }),
    tb('format_underlined', 'Underline', () => { const e = cur().elements[S.selEl]; styleSel({ underline: e?.style?.underline ? null : 1 }); }),
    tb('text_increase', 'Increase font size', () => { const e = cur().elements[S.selEl]; styleSel({ size: (e?.style?.size || 18) + 4 }); }),
    tb('text_decrease', 'Decrease font size', () => { const e = cur().elements[S.selEl]; styleSel({ size: Math.max(8, (e?.style?.size || 18) - 4) }); }),
    tb('format_align_left', 'Align left', () => styleSel({ align: 'left' })),
    tb('format_align_center', 'Align center', () => styleSel({ align: 'center' })),
    tb('format_align_right', 'Align right', () => styleSel({ align: 'right' })),
    el('div', { class: 'sep' }),
    tb('delete', 'Delete element', () => { if (S.selEl != null) { cur().elements.splice(S.selEl, 1); S.selEl = null; redraw(); } }),
  );
}

function setLayout(kind) {
  const s = cur();
  const title = (s.elements.find(e => e.type === 'text') || {}).text || '';
  s.layout = kind;
  s.elements = layout(kind, title);
  S.selEl = null; redraw();
}
function retheme() {
  const t = theme();
  for (const s of S.slides) for (const e of s.elements) {
    if (e.type === 'text' && e.style) e.style.color = t.fg;
    if (e.type === 'shape' && e.style) e.style.fill = t.accent;
  }
  redraw();
}

// ---------------------------------------------------------------- present
const present = document.getElementById('present');
function startPresent() {
  S.presentIdx = S.i;
  present.classList.add('on');
  drawPresent();
  document.documentElement.requestFullscreen?.().catch(() => {});
  if (!document.getElementById('hud')) {
    const hud = el('div', { class: 'present-hud', id: 'hud' },
      el('button', { onclick: () => stepPresent(-1) }, icon('chevron_left', 's24')),
      el('span', { id: 'hudN', style: 'font-size:13px' }),
      el('button', { onclick: () => stepPresent(1) }, icon('chevron_right', 's24')),
      el('button', { onclick: endPresent }, icon('close', 's24')));
    present.appendChild(hud);
  }
}
function drawPresent() {
  const st = document.getElementById('presentStage');
  renderStage(st, S.slides[S.presentIdx], false);
  const scale = Math.min(innerWidth / W, innerHeight / H);
  st.style.transform = `scale(${scale})`;
  const n = document.getElementById('hudN');
  if (n) n.textContent = `${S.presentIdx + 1} / ${S.slides.length}`;
}
function stepPresent(d) {
  S.presentIdx = Math.max(0, Math.min(S.slides.length - 1, S.presentIdx + d));
  drawPresent();
}
function endPresent() {
  present.classList.remove('on');
  document.exitFullscreen?.().catch(() => {});
}
document.getElementById('presentBtn').addEventListener('click', startPresent);
document.addEventListener('keydown', e => {
  if (!present.classList.contains('on')) return;
  if (['ArrowRight', 'ArrowDown', ' ', 'PageDown'].includes(e.key)) { e.preventDefault(); stepPresent(1); }
  if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); stepPresent(-1); }
  if (e.key === 'Escape') endPresent();
});
addEventListener('resize', () => { if (present.classList.contains('on')) drawPresent(); });

document.getElementById('notes').addEventListener('input', e => { cur().notes = e.target.textContent; save(); });

// ---------------------------------------------------------------- menubar
function renderMenubar() {
  const menus = {
    File: [
      { label: 'New presentation', icon: 'add', onClick: async () => { const f = await api.post('/drive/files', { name: 'Untitled presentation', mime: MIME.slide }); location.href = '/slides/?id=' + f.id; } },
      { label: 'Make a copy', icon: 'file_copy', onClick: async () => { const f = await api.post('/drive/files', { name: 'Copy of ' + S.name, mime: MIME.slide, content: JSON.stringify({ theme: S.theme, slides: S.slides }) }); location.href = '/slides/?id=' + f.id; } },
      '-', { label: 'Print', icon: 'print', onClick: () => window.print() },
    ],
    Edit: [{ label: 'Duplicate slide', icon: 'file_copy', onClick: () => { S.slides.splice(S.i + 1, 0, JSON.parse(JSON.stringify(cur()))); S.i++; redraw(); } },
           { label: 'Delete slide', icon: 'delete', danger: true, onClick: () => { if (S.slides.length > 1) { S.slides.splice(S.i, 1); S.i = Math.max(0, S.i - 1); redraw(); } } }],
    View: [{ label: 'Present', icon: 'slideshow', onClick: startPresent },
           { label: 'Show speaker notes', icon: 'sticky_note_2', onClick: () => document.getElementById('notes').classList.toggle('hidden') }],
    Insert: [{ label: 'Text box', icon: 'text_fields', onClick: addText },
             { label: 'Image', icon: 'image', onClick: addImage },
             { label: 'Shape', icon: 'crop_square', onClick: () => addShape(0) },
             { label: 'New slide', icon: 'add', onClick: () => addSlide() }],
    Slide: [{ label: 'Change layout', icon: 'dashboard', onClick: e => setLayout('titleBody') },
            ...Object.keys(THEMES).map(t => ({ label: 'Theme: ' + t, icon: 'palette', onClick: () => { S.theme = t; retheme(); } }))],
    Help: [{ label: 'Keyboard shortcuts', icon: 'keyboard', onClick: () =>
      dialog('Keyboard shortcuts', el('div', {},
        ...[['→ / Space', 'Next slide (presenting)'], ['←', 'Previous slide'], ['Esc', 'Exit presentation'],
            ['Ctrl+M', 'New slide'], ['Drag', 'Move a text box or shape']]
          .map(([k, v]) => el('div', { class: 'row', style: 'padding:6px 0;gap:16px' },
            el('b', { style: 'width:160px;font-weight:500' }, k), el('span', { class: 'muted' }, v)))),
        [{ label: 'Close', primary: true }]) }],
  };
  document.getElementById('menubar').replaceChildren(...Object.entries(menus).map(([name, m]) =>
    el('button', { onclick: e => { e.stopPropagation(); const r = e.target.getBoundingClientRect(); contextMenu(r.left, r.bottom + 2, m); } }, name)));
}

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') { e.preventDefault(); addSlide(); }
});

// ---------------------------------------------------------------- persistence
let saveTimer;
function save() {
  if (!S.fileId) return;
  const st = document.getElementById('saveState');
  st.textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await api.patch('/drive/files/' + S.fileId, {
      name: S.name, content: JSON.stringify({ theme: S.theme, slides: S.slides }),
    });
    st.textContent = 'Saved to Drive';
    setTimeout(() => { if (st.textContent === 'Saved to Drive') st.textContent = ''; }, 2500);
  }, 800);
}

document.getElementById('title').addEventListener('change', e => { S.name = e.target.value; save(); });
document.getElementById('shareBtn').addEventListener('click', () =>
  dialog('Share “' + S.name + '”', el('div', {},
    el('input', { class: 'field', placeholder: 'Add people and groups' }),
    el('div', { class: 'muted', style: 'margin-top:16px;font-size:13px' }, 'Restricted — only people with access can open.')),
    [{ label: 'Copy link', onClick: () => { navigator.clipboard?.writeText(location.href); snackbar('Link copied'); return false; } },
     { label: 'Done', primary: true }]));

function sampleDeck() {
  return [
    { layout: 'title', elements: layout('title', 'Q4 Business Review', 'Synergy Technologies · January 2026'), notes: 'Welcome the team and set the agenda.' },
    { layout: 'titleBody', elements: layout('titleBody', 'Where we landed',
      '• Revenue up 18% quarter over quarter\n• Net retention at 114%\n• Two enterprise logos closed in December\n• Support backlog down 40%'), notes: 'Lead with the retention number.' },
    { layout: 'twoCol', elements: layout('twoCol', 'What worked and what did not'), notes: '' },
    { layout: 'section', elements: layout('section', 'The plan for Q1'), notes: 'Transition slide.' },
    { layout: 'titleBody', elements: layout('titleBody', 'Q1 priorities',
      '1. Ship the unified suite shell\n2. Reach editor parity on Docs, Sheets and Slides\n3. Move every app onto single sign-on'), notes: 'Ask for questions at the end.' },
  ];
}

async function boot() {
  renderToolbar(); renderMenubar();
  if (S.fileId) {
    const f = await api.get('/drive/files/' + S.fileId);
    if (f && !f.error) {
      S.name = f.name;
      document.getElementById('title').value = f.name;
      try {
        const p = JSON.parse(f.content || 'null');
        if (p && p.slides && p.slides.length) { S.slides = p.slides; S.theme = p.theme || 'Simple'; }
      } catch {}
    }
  }
  if (!S.slides.length) S.slides = sampleDeck();
  redraw();
  clearTimeout(saveTimer);
  document.getElementById('saveState').textContent = '';
}
boot();
