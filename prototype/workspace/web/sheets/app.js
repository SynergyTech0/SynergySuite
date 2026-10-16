// Synergy Sheets — grid, editing, formatting, recalculation.
import {
  mountShell, api, el, icon, snackbar, dialog, contextMenu, MIME,
} from '/shared/shell.js';
import {
  compile, evaluate, dependencies, FErr, addr, parseAddr, colToName, FUNC_NAMES,
} from './formula.js';

const ROWS = 200, COLS = 26;
const DEF_W = 100, DEF_H = 21;

const S = {
  fileId: new URLSearchParams(location.search).get('id'),
  name: 'Untitled spreadsheet',
  sheets: [],            // [{ name, cells:{A1:{v,f}}, widths:{}, frozen:{r,c} }]
  active: 0,
  sel: { r: 0, c: 0, r2: 0, c2: 0 },
  editing: null,
  values: new Map(),      // computed values for the active sheet
  dirty: false,
  undo: [], redo: [],
};

const sheet = () => S.sheets[S.active];
const cellAt = (r, c) => sheet().cells[addr(r, c)];
const rawAt = (r, c) => { const x = cellAt(r, c); return x ? x.v : ''; };

// ---------------------------------------------------------------- compute
function recompute() {
  const cells = sheet().cells;
  S.values = new Map();
  const asts = new Map();
  const deps = new Map();

  for (const [key, cell] of Object.entries(cells)) {
    const raw = cell.v;
    if (typeof raw === 'string' && raw.startsWith('=')) {
      const ast = compile(raw.slice(1));
      asts.set(key, ast);
      deps.set(key, ast ? dependencies(ast) : new Set());
    }
  }

  const visiting = new Set();
  const resolveKey = key => {
    if (S.values.has(key)) return S.values.get(key);
    const cell = cells[key];
    if (!cell) return '';
    const raw = cell.v;
    if (!(typeof raw === 'string' && raw.startsWith('='))) {
      const v = literal(raw);
      S.values.set(key, v);
      return v;
    }
    if (visiting.has(key)) return new FErr('#CYCLE!');
    visiting.add(key);
    const ast = asts.get(key);
    let out;
    if (!ast) out = new FErr('#ERROR!');
    else {
      const pos = parseAddr(key);
      out = evaluate(ast, {
        self: pos,
        cell: ref => resolveKey(ref.replace(/\$/g, '').toUpperCase()),
        range: rs => {
          const [a, b] = rs.split(':').map(x => parseAddr(x.replace(/\$/g, '')));
          if (!a || !b) return null;
          const grid = [];
          for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++) {
            const row = [];
            for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++)
              row.push(resolveKey(addr(r, c)));
            grid.push(row);
          }
          return grid;
        },
      });
    }
    visiting.delete(key);
    S.values.set(key, out);
    return out;
  };

  for (const key of Object.keys(cells)) resolveKey(key);
}

function literal(raw) {
  if (raw === '' || raw === null || raw === undefined) return '';
  if (typeof raw === 'number') return raw;
  const s = String(raw).trim();
  if (/^-?\$?[\d,]*\.?\d+%?$/.test(s) && /\d/.test(s)) {
    const pct = s.endsWith('%');
    const n = Number(s.replace(/[$,%]/g, ''));
    if (!isNaN(n)) return pct ? n / 100 : n;
  }
  if (/^(TRUE|FALSE)$/i.test(s)) return s.toUpperCase() === 'TRUE';
  return raw;
}

// ---------------------------------------------------------------- formatting
function displayValue(r, c) {
  const key = addr(r, c);
  const cell = sheet().cells[key];
  if (!cell) return '';
  const v = S.values.has(key) ? S.values.get(key) : literal(cell.v);
  if (v instanceof FErr) return v.code;
  return formatNumber(v, cell.f || {});
}

function formatNumber(v, f) {
  if (v === '' || v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v !== 'number') return String(v);
  const dec = f.dec;
  switch (f.num) {
    case 'currency':
      return '$' + v.toLocaleString('en-US', { minimumFractionDigits: dec ?? 2, maximumFractionDigits: dec ?? 2 });
    case 'percent':
      return (v * 100).toFixed(dec ?? 2) + '%';
    case 'comma':
      return v.toLocaleString('en-US', { minimumFractionDigits: dec ?? 2, maximumFractionDigits: dec ?? 2 });
    case 'date': {
      const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
      return isNaN(d) ? String(v) : d.toLocaleDateString('en-US', { timeZone: 'UTC' });
    }
    case 'plain': return String(v);
    default:
      if (dec !== undefined) return v.toFixed(dec);
      // Google trims float noise at ~10 significant digits
      return String(Math.round(v * 1e10) / 1e10);
  }
}

// Evaluate this sheet's conditional-format rules against one cell.
function condFormat(sh, r, c, v) {
  const rules = sh.rules || [];
  for (const rule of rules) {
    const a = parseAddr(rule.from), b = parseAddr(rule.to);
    if (!a || !b) continue;
    if (r < Math.min(a.r, b.r) || r > Math.max(a.r, b.r)) continue;
    if (c < Math.min(a.c, b.c) || c > Math.max(a.c, b.c)) continue;
    if (v === '' || v === undefined || v === null) continue;
    const n = typeof v === 'number' ? v : Number(v);
    const t = String(v).toLowerCase();
    const val = rule.value, valNum = Number(val);
    let hit = false;
    switch (rule.op) {
      case 'gt':       hit = !isNaN(n) && n > valNum; break;
      case 'lt':       hit = !isNaN(n) && n < valNum; break;
      case 'eq':       hit = String(v).toLowerCase() === String(val).toLowerCase(); break;
      case 'contains': hit = t.includes(String(val).toLowerCase()); break;
      case 'notempty': hit = true; break;
    }
    if (hit) return rule.fmt;
  }
  return null;
}

function cellStyle(cell, v, cond) {
  const f = { ...((cell && cell.f) || {}), ...(cond || {}) };
  const st = [];
  if (f.b) st.push('font-weight:700');
  if (f.i) st.push('font-style:italic');
  const dec = [];
  if (f.u) dec.push('underline');
  if (f.s) dec.push('line-through');
  if (dec.length) st.push('text-decoration:' + dec.join(' '));
  if (f.color) st.push('color:' + f.color);
  if (f.bg) st.push('background:' + f.bg);
  if (f.size) st.push('font-size:' + f.size + 'px');
  const align = f.align || (typeof v === 'number' ? 'right' : v instanceof FErr ? 'center' : 'left');
  st.push('text-align:' + align);
  if (f.wrap) st.push('white-space:normal');
  if (f.border) st.push('border:1px solid var(--on-surface)');
  return st.join(';');
}

// ---------------------------------------------------------------- render
function render() {
  const wrap = document.getElementById('gridWrap');
  const scroll = { t: wrap.scrollTop, l: wrap.scrollLeft };
  recompute();

  const sh = sheet();
  const table = el('table', { class: 'grid' });
  const colgroup = el('colgroup');
  colgroup.append(el('col', { style: 'width:46px' }));
  for (let c = 0; c < COLS; c++)
    colgroup.append(el('col', { style: `width:${sh.widths[c] || DEF_W}px` }));
  table.append(colgroup);

  const { r1, c1, r2, c2 } = normSel();
  const fz = sh.frozen || { r: 0, c: 0 };
  const head = el('tr', {}, el('th', { class: 'corner' },
    el('span', { class: 'mi s18', style: 'transform:rotate(45deg);opacity:.5' }, 'arrow_drop_down')));
  for (let c = 0; c < COLS; c++) {
    const th = el('th', {
      class: c >= c1 && c <= c2 ? 'sel-head' : '',
      onclick: e => { S.sel = { r: 0, c, r2: ROWS - 1, c2: e.shiftKey ? S.sel.c2 : c }; render(); },
      oncontextmenu: e => { e.preventDefault(); colMenu(c, e.clientX, e.clientY); },
    }, colToName(c));
    const rz = el('div', { class: 'colresize' });
    rz.addEventListener('mousedown', e => startResize(e, c));
    th.style.position = 'sticky';
    th.appendChild(rz);
    head.append(th);
  }
  table.append(el('thead', {}, head));

  const tbody = el('tbody');
  for (let r = 0; r < ROWS; r++) {
    const tr = el('tr');
    tr.append(el('th', {
      class: 'rowhead' + (r >= r1 && r <= r2 ? ' sel-head' : ''),
      onclick: e => { S.sel = { r, c: 0, r2: r, c2: COLS - 1 }; render(); },
      oncontextmenu: e => { e.preventDefault(); rowMenu(r, e.clientX, e.clientY); },
    }, String(r + 1)));
    for (let c = 0; c < COLS; c++) {
      const key = addr(r, c);
      const cell = sh.cells[key];
      const val = S.values.get(key);
      const inSel = r >= r1 && r <= r2 && c >= c1 && c <= c2;
      const isAnchor = r === S.sel.r && c === S.sel.c;
      const frozenR = r < fz.r, frozenC = c < fz.c;
      const td = el('td', {
        'data-r': r, 'data-c': c,
        class: (inSel ? 'sel ' : '') + (isAnchor ? 'anchor ' : '') + (val instanceof FErr ? 'err ' : '') +
               (frozenR || frozenC ? 'frozen' : ''),
        style: cellStyle(cell, val, condFormat(sh, r, c, val)) +
          (frozenR ? `;position:sticky;top:${22 + r * DEF_H}px;z-index:${frozenC ? 4 : 3}` : '') +
          (frozenC && !frozenR ? `;position:sticky;left:${46 + colLeft(sh, c)}px;z-index:2` : '') +
          (frozenC && frozenR ? `;left:${46 + colLeft(sh, c)}px` : ''),
        title: val instanceof FErr ? errorHelp(val.code) : '',
      }, displayValue(r, c));
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.replaceChildren(table);
  wrap.scrollTop = scroll.t; wrap.scrollLeft = scroll.l;

  document.getElementById('namebox').value =
    (r1 === r2 && c1 === c2) ? addr(r1, c1) : `${addr(r1, c1)}:${addr(r2, c2)}`;
  const raw = rawAt(S.sel.r, S.sel.c);
  document.getElementById('formula').value = raw === '' ? '' : String(raw);
  renderTabs();
  renderToolbarState();
  renderStatus();
}

// Cumulative x offset of a column, used to pin frozen columns.
function colLeft(sh, c) {
  let x = 0;
  for (let i = 0; i < c; i++) x += sh.widths[i] || DEF_W;
  return x;
}

function errorHelp(code) {
  return {
    '#DIV/0!': 'Function divides by zero.',
    '#VALUE!': 'Wrong type of argument.',
    '#REF!': 'Reference does not exist.',
    '#NAME?': 'Unknown function name.',
    '#N/A': 'A value is not available.',
    '#NUM!': 'Number is invalid for this function.',
    '#CYCLE!': 'Circular dependency detected.',
    '#ERROR!': 'Formula parse error.',
  }[code] || code;
}

function normSel() {
  const { r, c, r2, c2 } = S.sel;
  return { r1: Math.min(r, r2), c1: Math.min(c, c2), r2: Math.max(r, r2), c2: Math.max(c, c2) };
}

function renderStatus() {
  const { r1, c1, r2, c2 } = normSel();
  const vals = [];
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
    const v = S.values.get(addr(r, c));
    if (typeof v === 'number') vals.push(v);
  }
  const bar = document.getElementById('status');
  if (!bar) return;
  if (vals.length < 1) { bar.textContent = ''; return; }
  const sum = vals.reduce((a, b) => a + b, 0);
  bar.textContent = `Sum: ${round(sum)}   Average: ${round(sum / vals.length)}   Count: ${vals.length}   Min: ${round(Math.min(...vals))}   Max: ${round(Math.max(...vals))}`;
}
const round = n => String(Math.round(n * 1e6) / 1e6);

// ---------------------------------------------------------------- editing
function setCell(r, c, raw, pushUndo = true) {
  const key = addr(r, c);
  const sh = sheet();
  const before = sh.cells[key] ? { ...sh.cells[key] } : null;
  if (pushUndo) S.undo.push({ sheet: S.active, key, before });
  if (raw === '' || raw === null) {
    if (sh.cells[key]) { if (sh.cells[key].f) sh.cells[key].v = ''; else delete sh.cells[key]; }
  } else {
    sh.cells[key] = { ...(sh.cells[key] || {}), v: raw };
  }
  S.dirty = true;
}

function applyFormat(patch) {
  const { r1, c1, r2, c2 } = normSel();
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
    const key = addr(r, c), sh = sheet();
    const before = sh.cells[key] ? JSON.parse(JSON.stringify(sh.cells[key])) : null;
    S.undo.push({ sheet: S.active, key, before });
    sh.cells[key] = sh.cells[key] || { v: '' };
    sh.cells[key].f = { ...(sh.cells[key].f || {}), ...patch };
    for (const k of Object.keys(sh.cells[key].f))
      if (sh.cells[key].f[k] === null) delete sh.cells[key].f[k];
  }
  S.dirty = true; render(); save();
}

function currentFormat() {
  const cell = cellAt(S.sel.r, S.sel.c);
  return (cell && cell.f) || {};
}

function beginEdit(initial) {
  if (S.editing) return;
  const { r, c } = S.sel;
  const td = document.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
  if (!td) return;
  const raw = initial !== undefined ? initial : String(rawAt(r, c) ?? '');
  const inp = el('input', { class: 'ed', value: raw });
  S.editing = { r, c, inp };
  td.appendChild(inp);
  inp.focus();
  if (initial !== undefined) inp.setSelectionRange(raw.length, raw.length);
  else inp.select();

  const hint = el('div', { class: 'menu', style: 'display:none' });
  document.body.appendChild(hint);

  inp.addEventListener('input', () => {
    document.getElementById('formula').value = inp.value;
    const m = /=\s*([A-Za-z]+)$/.exec(inp.value);
    if (m) {
      const q = m[1].toUpperCase();
      const hits = FUNC_NAMES.filter(f => f.startsWith(q)).slice(0, 8);
      if (hits.length) {
        const rect = inp.getBoundingClientRect();
        hint.innerHTML = '';
        hits.forEach(h => hint.appendChild(el('div', {
          class: 'menu-item',
          onmousedown: e => { e.preventDefault(); inp.value = inp.value.slice(0, m.index + 1) + h + '('; hint.style.display = 'none'; },
        }, h)));
        hint.style.cssText = `left:${rect.left}px;top:${rect.bottom + 2}px;display:block`;
        hint.classList.add('open');
        return;
      }
    }
    hint.style.display = 'none';
  });
  inp.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter')      { commitEdit(inp.value); hint.remove(); move(1, 0); }
    else if (e.key === 'Tab')   { e.preventDefault(); commitEdit(inp.value); hint.remove(); move(0, e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape'){ S.editing = null; inp.remove(); hint.remove(); render(); }
  });
  inp.addEventListener('blur', () => { if (S.editing) { commitEdit(inp.value); hint.remove(); render(); } });
}

function commitEdit(value) {
  if (!S.editing) return;
  const { r, c } = S.editing;
  S.editing = null;
  setCell(r, c, value);
  save();
}

function move(dr, dc, extend) {
  if (S.editing) { commitEdit(S.editing.inp.value); }
  if (extend) {
    S.sel.r2 = Math.max(0, Math.min(ROWS - 1, S.sel.r2 + dr));
    S.sel.c2 = Math.max(0, Math.min(COLS - 1, S.sel.c2 + dc));
  } else {
    S.sel.r = Math.max(0, Math.min(ROWS - 1, S.sel.r + dr));
    S.sel.c = Math.max(0, Math.min(COLS - 1, S.sel.c + dc));
    S.sel.r2 = S.sel.r; S.sel.c2 = S.sel.c;
  }
  render();
  const td = document.querySelector('td.anchor');
  td && td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// ---------------------------------------------------------------- selection by mouse
let dragging = false;
document.addEventListener('mousedown', e => {
  const td = e.target.closest && e.target.closest('td[data-r]');
  if (!td) return;
  if (S.editing) commitEdit(S.editing.inp.value);
  const r = +td.dataset.r, c = +td.dataset.c;
  if (e.shiftKey) { S.sel.r2 = r; S.sel.c2 = c; }
  else { S.sel = { r, c, r2: r, c2: c }; dragging = true; }
  render();
});
document.addEventListener('mouseover', e => {
  if (!dragging) return;
  const td = e.target.closest && e.target.closest('td[data-r]');
  if (!td) return;
  S.sel.r2 = +td.dataset.r; S.sel.c2 = +td.dataset.c;
  render();
});
document.addEventListener('mouseup', () => { dragging = false; });
document.addEventListener('dblclick', e => {
  const td = e.target.closest && e.target.closest('td[data-r]');
  if (td) { S.sel = { r: +td.dataset.r, c: +td.dataset.c, r2: +td.dataset.r, c2: +td.dataset.c }; beginEdit(); }
});

// ---------------------------------------------------------------- keyboard
document.addEventListener('keydown', e => {
  if (S.editing) return;
  const t = e.target;
  if (t.id === 'formula' || t.id === 'namebox' || t.id === 'title') return;
  const mod = e.ctrlKey || e.metaKey;

  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); return undo(); }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); return redo(); }
  if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); return applyFormat({ b: currentFormat().b ? null : 1 }); }
  if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); return applyFormat({ i: currentFormat().i ? null : 1 }); }
  if (mod && e.key.toLowerCase() === 'u') { e.preventDefault(); return applyFormat({ u: currentFormat().u ? null : 1 }); }
  if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); return copySel(); }
  if (mod && e.key.toLowerCase() === 'x') { e.preventDefault(); copySel(); return clearSel(); }
  if (mod && e.key.toLowerCase() === 'v') { return; }   // handled by paste listener

  switch (e.key) {
    case 'ArrowUp':    e.preventDefault(); return move(-1, 0, e.shiftKey);
    case 'ArrowDown':  e.preventDefault(); return move(1, 0, e.shiftKey);
    case 'ArrowLeft':  e.preventDefault(); return move(0, -1, e.shiftKey);
    case 'ArrowRight': e.preventDefault(); return move(0, 1, e.shiftKey);
    case 'Tab':        e.preventDefault(); return move(0, e.shiftKey ? -1 : 1);
    case 'Enter':      e.preventDefault(); return beginEdit();
    case 'F2':         e.preventDefault(); return beginEdit();
    case 'Delete': case 'Backspace': e.preventDefault(); return clearSel();
    case 'Home':       e.preventDefault(); S.sel = { r: S.sel.r, c: 0, r2: S.sel.r, c2: 0 }; return render();
    case 'Escape':     return;
  }
  if (e.key.length === 1 && !mod && !e.altKey) { e.preventDefault(); beginEdit(e.key); }
});

function clearSel() {
  const { r1, c1, r2, c2 } = normSel();
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) setCell(r, c, '');
  render(); save();
}

function copySel() {
  const { r1, c1, r2, c2 } = normSel();
  const lines = [];
  for (let r = r1; r <= r2; r++) {
    const row = [];
    for (let c = c1; c <= c2; c++) row.push(displayValue(r, c));
    lines.push(row.join('\t'));
  }
  navigator.clipboard?.writeText(lines.join('\n'));
  snackbar(`Copied ${(r2 - r1 + 1) * (c2 - c1 + 1)} cell(s)`);
}

document.addEventListener('paste', e => {
  if (S.editing) return;
  const text = e.clipboardData?.getData('text/plain');
  if (!text) return;
  e.preventDefault();
  const rows = text.replace(/\r/g, '').split('\n');
  rows.forEach((line, i) => line.split('\t').forEach((v, j) =>
    setCell(S.sel.r + i, S.sel.c + j, v)));
  render(); save();
  snackbar(`Pasted ${rows.length} row(s)`);
});

function undo() {
  const u = S.undo.pop();
  if (!u) return snackbar('Nothing to undo');
  const sh = S.sheets[u.sheet];
  const after = sh.cells[u.key] ? JSON.parse(JSON.stringify(sh.cells[u.key])) : null;
  S.redo.push({ ...u, before: after });
  if (u.before) sh.cells[u.key] = u.before; else delete sh.cells[u.key];
  render(); save();
}
function redo() {
  const u = S.redo.pop();
  if (!u) return snackbar('Nothing to redo');
  const sh = S.sheets[u.sheet];
  const after = sh.cells[u.key] ? JSON.parse(JSON.stringify(sh.cells[u.key])) : null;
  S.undo.push({ ...u, before: after });
  if (u.before) sh.cells[u.key] = u.before; else delete sh.cells[u.key];
  render(); save();
}

// ---------------------------------------------------------------- column resize
function startResize(e, c) {
  e.preventDefault(); e.stopPropagation();
  const startX = e.clientX, startW = sheet().widths[c] || DEF_W;
  const onMove = ev => {
    sheet().widths[c] = Math.max(24, startW + ev.clientX - startX);
    const col = document.querySelectorAll('table.grid colgroup col')[c + 1];
    if (col) col.style.width = sheet().widths[c] + 'px';
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    S.dirty = true; save();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function colMenu(c, x, y) {
  contextMenu(x, y, [
    { label: `Insert 1 column left`, icon: 'add', onClick: () => insertCol(c) },
    { label: `Delete column ${colToName(c)}`, icon: 'delete', onClick: () => deleteCol(c) },
    '-',
    { label: 'Resize column…', icon: 'width', onClick: () => resizeDialog(c) },
  ]);
}
function rowMenu(r, x, y) {
  contextMenu(x, y, [
    { label: 'Insert 1 row above', icon: 'add', onClick: () => insertRow(r) },
    { label: `Delete row ${r + 1}`, icon: 'delete', onClick: () => deleteRow(r) },
  ]);
}
function shiftCells(fn) {
  const sh = sheet(), next = {};
  for (const [k, v] of Object.entries(sh.cells)) {
    const p = parseAddr(k); const np = fn(p);
    if (np) next[addr(np.r, np.c)] = v;
  }
  sh.cells = next; S.dirty = true; render(); save();
}
const insertRow = r => shiftCells(p => p.r >= r ? { r: p.r + 1, c: p.c } : p);
const deleteRow = r => shiftCells(p => p.r === r ? null : p.r > r ? { r: p.r - 1, c: p.c } : p);
const insertCol = c => shiftCells(p => p.c >= c ? { r: p.r, c: p.c + 1 } : p);
const deleteCol = c => shiftCells(p => p.c === c ? null : p.c > c ? { r: p.r, c: p.c - 1 } : p);
function resizeDialog(c) {
  const inp = el('input', { class: 'field', type: 'number', value: sheet().widths[c] || DEF_W });
  dialog('Resize column', el('div', {}, inp), [
    { label: 'Cancel' },
    { label: 'OK', primary: true, onClick: () => { sheet().widths[c] = +inp.value; render(); save(); } },
  ]);
}

// ---------------------------------------------------------------- toolbar
function tb(iconName, tip, onClick, isOn) {
  return el('button', {
    class: 'tb-btn' + (isOn ? ' on' : ''), 'data-tip': tip,
    onclick: onClick,
  }, icon(iconName));
}

function renderToolbar() {
  const t = document.getElementById('toolbar');
  const f = currentFormat();
  t.replaceChildren(
    tb('undo', 'Undo (Ctrl+Z)', undo),
    tb('redo', 'Redo (Ctrl+Y)', redo),
    tb('print', 'Print', () => window.print()),
    el('div', { class: 'sep' }),
    tb('attach_money', 'Format as currency', () => applyFormat({ num: f.num === 'currency' ? null : 'currency' }), f.num === 'currency'),
    tb('percent', 'Format as percent', () => applyFormat({ num: f.num === 'percent' ? null : 'percent' }), f.num === 'percent'),
    tb('decimal_decrease', 'Decrease decimal places', () => applyFormat({ dec: Math.max(0, (f.dec ?? 2) - 1) })),
    tb('decimal_increase', 'Increase decimal places', () => applyFormat({ dec: (f.dec ?? 2) + 1 })),
    el('select', {
      class: 'tb-sel', 'data-tip': 'Number format',
      onchange: e => applyFormat({ num: e.target.value || null }),
    }, ...[['', 'Automatic'], ['plain', 'Plain text'], ['comma', 'Number'], ['currency', 'Currency'],
           ['percent', 'Percent'], ['date', 'Date']].map(([v, l]) =>
      el('option', { value: v, selected: (f.num || '') === v }, l))),
    el('div', { class: 'sep' }),
    el('select', {
      class: 'tb-sel', 'data-tip': 'Font size',
      onchange: e => applyFormat({ size: +e.target.value }),
    }, ...[8, 9, 10, 11, 12, 13, 14, 18, 24, 36].map(n =>
      el('option', { value: n, selected: (f.size || 13) === n }, String(n)))),
    tb('format_bold', 'Bold (Ctrl+B)', () => applyFormat({ b: f.b ? null : 1 }), f.b),
    tb('format_italic', 'Italic (Ctrl+I)', () => applyFormat({ i: f.i ? null : 1 }), f.i),
    tb('format_underlined', 'Underline (Ctrl+U)', () => applyFormat({ u: f.u ? null : 1 }), f.u),
    tb('strikethrough_s', 'Strikethrough', () => applyFormat({ s: f.s ? null : 1 }), f.s),
    colorBtn('format_color_text', 'Text color', c => applyFormat({ color: c })),
    colorBtn('format_color_fill', 'Fill color', c => applyFormat({ bg: c })),
    el('div', { class: 'sep' }),
    tb('border_all', 'Borders', () => applyFormat({ border: f.border ? null : 1 }), f.border),
    tb('format_align_left', 'Align left', () => applyFormat({ align: 'left' }), f.align === 'left'),
    tb('format_align_center', 'Align center', () => applyFormat({ align: 'center' }), f.align === 'center'),
    tb('format_align_right', 'Align right', () => applyFormat({ align: 'right' }), f.align === 'right'),
    tb('wrap_text', 'Text wrapping', () => applyFormat({ wrap: f.wrap ? null : 1 }), f.wrap),
    el('div', { class: 'sep' }),
    tb('functions', 'Functions', insertFunctionMenu),
    tb('add_chart', 'Insert chart', insertChart),
  );
}
function renderToolbarState() { renderToolbar(); }

const PALETTE = ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#ffffff',
  '#d93025', '#e8710a', '#f9ab00', '#188038', '#1a73e8', '#9334e6',
  '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#cfe2f3', '#d9d2e9'];

function colorBtn(iconName, tip, apply) {
  const b = el('button', { class: 'tb-btn', 'data-tip': tip }, icon(iconName));
  b.addEventListener('click', e => {
    e.stopPropagation();
    const r = b.getBoundingClientRect();
    const pop = el('div', {
      class: 'menu open',
      style: `left:${r.left}px;top:${r.bottom + 4}px;padding:10px;display:grid;grid-template-columns:repeat(6,24px);gap:6px`,
    }, ...PALETTE.map(c => el('div', {
      style: `width:24px;height:24px;border-radius:4px;background:${c};border:1px solid var(--outline-variant);cursor:pointer`,
      onclick: () => { apply(c); pop.remove(); },
    })), el('div', {
      style: 'grid-column:1/-1;text-align:center;font-size:12px;color:var(--blue-700);cursor:pointer;padding-top:4px',
      onclick: () => { apply(null); pop.remove(); },
    }, 'Reset'));
    document.body.appendChild(pop);
    setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }), 0);
  });
  return b;
}

function insertFunctionMenu(e) {
  e.stopPropagation();
  const common = ['SUM', 'AVERAGE', 'COUNT', 'MAX', 'MIN', 'IF', 'VLOOKUP', 'COUNTIF', 'SUMIF', 'ROUND'];
  contextMenu(e.clientX, e.clientY, [
    ...common.map(f => ({
      label: f, icon: 'functions',
      onClick: () => { beginEdit('=' + f + '('); },
    })),
    '-',
    { label: `All ${FUNC_NAMES.length} functions…`, icon: 'list', onClick: allFunctionsDialog },
  ]);
}

function allFunctionsDialog() {
  const list = el('div', { style: 'max-height:340px;overflow:auto;display:grid;grid-template-columns:repeat(3,1fr);gap:4px' },
    ...FUNC_NAMES.map(f => el('div', {
      class: 'menu-item', style: 'height:28px;border-radius:4px',
      onclick: () => { d.close(); beginEdit('=' + f + '('); },
    }, f)));
  const d = dialog(`Functions (${FUNC_NAMES.length})`, list, [{ label: 'Close' }]);
}

function insertChart() {
  const { r1, c1, r2, c2 } = normSel();
  const series = [];
  for (let r = r1; r <= r2; r++) {
    const v = S.values.get(addr(r, c2));
    if (typeof v === 'number') series.push({ label: String(S.values.get(addr(r, c1)) ?? addr(r, c1)), v });
  }
  if (!series.length) return snackbar('Select a range with numbers to chart');
  const max = Math.max(...series.map(s => s.v), 1);
  const body = el('div', { style: 'display:flex;align-items:flex-end;gap:10px;height:220px;padding:12px 0' },
    ...series.slice(0, 12).map(s => el('div', { class: 'col', style: 'align-items:center;flex:1;gap:4px;height:100%;justify-content:flex-end' },
      el('span', { style: 'font-size:11px' }, round(s.v)),
      el('div', { style: `width:100%;background:var(--blue-600);border-radius:4px 4px 0 0;height:${(s.v / max) * 150}px` }),
      el('span', { style: 'font-size:11px;color:var(--on-surface-variant)' }, s.label.slice(0, 8)))));
  dialog('Chart', body, [{ label: 'Close', primary: true }]);
}

// ---------------------------------------------------------------- menubar
function renderMenubar() {
  const items = {
    File: [
      { label: 'New spreadsheet', icon: 'add', onClick: () => newFile() },
      { label: 'Rename', icon: 'edit', onClick: () => document.getElementById('title').focus() },
      { label: 'Make a copy', icon: 'file_copy', onClick: copyFile },
      '-',
      { label: 'Download as CSV', icon: 'download', onClick: downloadCsv },
      { label: 'Print', icon: 'print', onClick: () => window.print() },
    ],
    Edit: [
      { label: 'Undo', icon: 'undo', onClick: undo }, { label: 'Redo', icon: 'redo', onClick: redo },
      '-', { label: 'Copy', icon: 'content_copy', onClick: copySel },
      { label: 'Delete values', icon: 'backspace', onClick: clearSel },
    ],
    Insert: [
      { label: 'Row above', icon: 'add', onClick: () => insertRow(S.sel.r) },
      { label: 'Column left', icon: 'add', onClick: () => insertCol(S.sel.c) },
      '-', { label: 'Function', icon: 'functions', onClick: allFunctionsDialog },
      { label: 'Chart', icon: 'add_chart', onClick: insertChart },
      { label: 'Sheet', icon: 'tab', onClick: addSheet },
    ],
    Format: [
      { label: 'Bold', icon: 'format_bold', onClick: () => applyFormat({ b: currentFormat().b ? null : 1 }) },
      { label: 'Italic', icon: 'format_italic', onClick: () => applyFormat({ i: currentFormat().i ? null : 1 }) },
      '-',
      { label: 'Currency', icon: 'attach_money', onClick: () => applyFormat({ num: 'currency' }) },
      { label: 'Percent', icon: 'percent', onClick: () => applyFormat({ num: 'percent' }) },
      { label: 'Date', icon: 'event', onClick: () => applyFormat({ num: 'date' }) },
      '-', { label: 'Clear formatting', icon: 'format_clear', onClick: () => applyFormat({ b: null, i: null, u: null, s: null, color: null, bg: null, num: null, dec: null, align: null }) },
    ],
    Data: [
      { label: 'Sort sheet A→Z', icon: 'sort', onClick: () => sortBy(S.sel.c, true) },
      { label: 'Sort sheet Z→A', icon: 'sort', onClick: () => sortBy(S.sel.c, false) },
    ],
    Help: [
      { label: `Function list (${FUNC_NAMES.length})`, icon: 'functions', onClick: allFunctionsDialog },
      { label: 'Keyboard shortcuts', icon: 'keyboard', onClick: shortcutsDialog },
    ],
  };
  const bar = document.getElementById('menubar');
  bar.replaceChildren(...Object.entries(items).map(([name, menu]) =>
    el('button', {
      onclick: e => { e.stopPropagation(); const r = e.target.getBoundingClientRect(); contextMenu(r.left, r.bottom + 2, menu); },
    }, name)));
}

function shortcutsDialog() {
  const rows = [['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+B / I / U', 'Bold / italic / underline'],
    ['Ctrl+C / X / V', 'Copy / cut / paste'], ['Arrows', 'Move selection'],
    ['Shift+Arrows', 'Extend selection'], ['Enter / F2', 'Edit cell'],
    ['Tab / Shift+Tab', 'Next / previous cell'], ['Delete', 'Clear values'],
    ['Type any character', 'Start editing']];
  dialog('Keyboard shortcuts', el('div', {},
    ...rows.map(([k, v]) => el('div', { class: 'row', style: 'padding:6px 0;gap:16px' },
      el('b', { style: 'width:170px;font-weight:500' }, k), el('span', { class: 'muted' }, v)))),
    [{ label: 'Close', primary: true }]);
}

function sortBy(col, asc) {
  const sh = sheet();
  const rows = [];
  for (let r = 0; r < ROWS; r++) {
    const row = {};
    let any = false;
    for (let c = 0; c < COLS; c++) { const k = addr(r, c); if (sh.cells[k]) { row[c] = sh.cells[k]; any = true; } }
    if (any) rows.push({ key: S.values.get(addr(r, col)), row });
  }
  rows.sort((a, b) => {
    const x = a.key ?? '', y = b.key ?? '';
    const n = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return asc ? n : -n;
  });
  sh.cells = {};
  rows.forEach((entry, i) => { for (const [c, cell] of Object.entries(entry.row)) sh.cells[addr(i, +c)] = cell; });
  S.dirty = true; render(); save();
  snackbar(`Sorted by column ${colToName(col)}`);
}

function downloadCsv() {
  const lines = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    let any = false;
    for (let c = 0; c < COLS; c++) { const v = displayValue(r, c); if (v !== '') any = true; row.push(`"${String(v).replace(/"/g, '""')}"`); }
    if (any) lines.push(row.join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = el('a', { href: URL.createObjectURL(blob), download: S.name + '.csv' });
  document.body.appendChild(a); a.click(); a.remove();
  snackbar('Downloaded CSV');
}

// ---------------------------------------------------------------- sheet tabs
function renderTabs() {
  const t = document.getElementById('tabs');
  t.replaceChildren(
    el('button', { class: 'icon-btn', 'data-tip': 'Add sheet', onclick: addSheet }, icon('add')),
    ...S.sheets.map((sh, i) => el('div', {
      class: 'stab' + (i === S.active ? ' on' : ''),
      onclick: () => { S.active = i; S.sel = { r: 0, c: 0, r2: 0, c2: 0 }; render(); },
      oncontextmenu: e => {
        e.preventDefault();
        contextMenu(e.clientX, e.clientY, [
          { label: 'Rename', icon: 'edit', onClick: () => renameSheet(i) },
          { label: 'Duplicate', icon: 'file_copy', onClick: () => { S.sheets.splice(i + 1, 0, JSON.parse(JSON.stringify(sh))); S.sheets[i + 1].name += ' copy'; render(); save(); } },
          S.sheets.length > 1 ? { label: 'Delete', icon: 'delete', danger: true, onClick: () => { S.sheets.splice(i, 1); S.active = 0; render(); save(); } } : null,
        ].filter(Boolean));
      },
    }, sh.name)),
    el('div', { class: 'statusbar' }, el('span', { id: 'status' })));
}
function addSheet() {
  S.sheets.push({ name: 'Sheet' + (S.sheets.length + 1), cells: {}, widths: {} });
  S.active = S.sheets.length - 1; render(); save();
}
function renameSheet(i) {
  const inp = el('input', { class: 'field', value: S.sheets[i].name });
  dialog('Rename sheet', el('div', {}, inp), [
    { label: 'Cancel' },
    { label: 'OK', primary: true, onClick: () => { S.sheets[i].name = inp.value; render(); save(); } },
  ]);
}

// ---------------------------------------------------------------- persistence
let saveTimer;
function save() {
  if (!S.fileId) return;
  document.getElementById('saveState').textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await api.patch('/drive/files/' + S.fileId, {
      name: S.name,
      content: JSON.stringify({ sheets: S.sheets }),
    });
    S.dirty = false;
    document.getElementById('saveState').textContent = 'Saved to Drive';
    setTimeout(() => { const n = document.getElementById('saveState'); if (n.textContent === 'Saved to Drive') n.textContent = ''; }, 2500);
  }, 700);
}

async function newFile() {
  const f = await api.post('/drive/files', { name: 'Untitled spreadsheet', mime: MIME.sheet });
  location.href = '/sheets/?id=' + f.id;
}
async function copyFile() {
  const f = await api.post('/drive/files', {
    name: 'Copy of ' + S.name, mime: MIME.sheet,
    content: JSON.stringify({ sheets: S.sheets }),
  });
  location.href = '/sheets/?id=' + f.id;
}

// ---------------------------------------------------------------- boot
document.getElementById('shell').appendChild(mountShell({ app: 'sheets', search: false }));

document.getElementById('title').addEventListener('change', e => { S.name = e.target.value; save(); });
document.getElementById('formula').addEventListener('keydown', e => {
  if (e.key === 'Enter') { setCell(S.sel.r, S.sel.c, e.target.value); render(); save(); move(1, 0); }
  if (e.key === 'Escape') render();
});
document.getElementById('namebox').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const p = parseAddr(e.target.value.trim());
  if (p) { S.sel = { r: p.r, c: p.c, r2: p.r, c2: p.c }; render(); }
});
document.getElementById('shareBtn').addEventListener('click', () =>
  dialog('Share “' + S.name + '”', el('div', {},
    el('input', { class: 'field', placeholder: 'Add people and groups' }),
    el('div', { class: 'muted', style: 'margin-top:16px;font-size:13px' },
      'Restricted — only people with access can open this spreadsheet.')),
    [{ label: 'Copy link', onClick: () => { navigator.clipboard?.writeText(location.href); snackbar('Link copied'); return false; } },
     { label: 'Done', primary: true }]));

function defaultBudget() {
  // A seeded spreadsheet with live formulas, so the app opens on something real.
  const cells = {};
  const put = (a, v, f) => cells[a] = f ? { v, f } : { v };
  const hdr = { b: 1, bg: '#cfe2f3' };
  put('A1', 'Department', hdr); put('B1', 'Q1', hdr); put('C1', 'Q2', hdr);
  put('D1', 'Q3', hdr); put('E1', 'Q4', hdr); put('F1', 'Total', hdr); put('G1', 'Share', hdr);
  const rows = [
    ['Engineering', 142000, 151000, 149500, 163000],
    ['Sales', 98000, 104500, 112000, 121000],
    ['Marketing', 54000, 58500, 61000, 72000],
    ['Support', 41000, 43000, 44500, 47000],
    ['Operations', 33000, 34500, 35000, 36500],
  ];
  rows.forEach((r, i) => {
    const n = i + 2;
    put('A' + n, r[0]);
    ['B', 'C', 'D', 'E'].forEach((col, j) => put(col + n, r[j + 1], { num: 'currency', dec: 0 }));
    put('F' + n, `=SUM(B${n}:E${n})`, { num: 'currency', dec: 0, b: 1 });
    put('G' + n, `=F${n}/$F$8`, { num: 'percent', dec: 1 });
  });
  const tot = { b: 1, num: 'currency', dec: 0, bg: '#d9ead3' };
  put('A8', 'Total', { b: 1, bg: '#d9ead3' });
  ['B', 'C', 'D', 'E'].forEach(col => put(col + '8', `=SUM(${col}2:${col}7)`, tot));
  put('F8', '=SUM(F2:F7)', tot); put('G8', '=SUM(G2:G7)', { num: 'percent', dec: 1, b: 1, bg: '#d9ead3' });
  put('A10', 'Largest department', { b: 1 });
  put('B10', '=INDEX(A2:A7,MATCH(MAX(F2:F7),F2:F7,0))');
  put('A11', 'Average quarter', { b: 1 });
  put('B11', '=ROUND(AVERAGE(B2:E7),0)', { num: 'currency', dec: 0 });
  put('A12', 'Over 400k?', { b: 1 });
  put('B12', '=IF(F8>400000,"Yes — over plan","Within plan")');
  return { name: 'Budget', cells, widths: { 0: 140, 5: 120 } };
}

async function boot() {
  if (S.fileId) {
    const f = await api.get('/drive/files/' + S.fileId);
    if (f && !f.error) {
      S.name = f.name;
      document.getElementById('title').value = f.name;
      try {
        const parsed = JSON.parse(f.content || 'null');
        if (parsed && parsed.sheets && parsed.sheets.length) S.sheets = parsed.sheets;
      } catch {}
    }
  }
  if (!S.sheets.length) S.sheets = [defaultBudget(), { name: 'Sheet2', cells: {}, widths: {} }];
  for (const sh of S.sheets) { sh.cells = sh.cells || {}; sh.widths = sh.widths || {}; }
  renderMenubar();
  render();
}
boot();
