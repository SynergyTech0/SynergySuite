// Synergy Sheets — formula engine.
// Tokenizer -> precedence-climbing parser -> evaluator over a cell-resolver.
// Errors propagate as sentinel objects so #DIV/0! behaves the way a spreadsheet
// user expects rather than throwing.

export class FErr {
  constructor(code) { this.code = code; }
  toString() { return this.code; }
}
export const ERR = {
  DIV0: () => new FErr('#DIV/0!'), VALUE: () => new FErr('#VALUE!'),
  REF: () => new FErr('#REF!'), NAME: () => new FErr('#NAME?'),
  NA: () => new FErr('#N/A'), NUM: () => new FErr('#NUM!'),
  PARSE: () => new FErr('#ERROR!'), CYCLE: () => new FErr('#CYCLE!'),
};
const isErr = v => v instanceof FErr;

// ---------------------------------------------------------------- addresses
export function colToName(n) {           // 0 -> A, 26 -> AA
  let s = '';
  n += 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - 1 - r) / 26; }
  return s;
}
export function nameToCol(s) {
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export const addr = (r, c) => colToName(c) + (r + 1);
export function parseAddr(a) {
  const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(a);
  if (!m) return null;
  return { r: parseInt(m[2], 10) - 1, c: nameToCol(m[1]) };
}

// ---------------------------------------------------------------- tokenizer
const OPS = ['<=', '>=', '<>', '+', '-', '*', '/', '^', '&', '=', '<', '>', '%'];

function tokenize(src) {
  const t = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if (c === '"') {                                    // string
      let j = i + 1, s = '';
      while (j < src.length) {
        if (src[j] === '"' && src[j + 1] === '"') { s += '"'; j += 2; continue; }
        if (src[j] === '"') break;
        s += src[j++];
      }
      t.push({ t: 'str', v: s }); i = j + 1; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      if (/[eE]/.test(src[j] || '') && /[0-9+\-]/.test(src[j + 1] || '')) {
        j++; if (/[+\-]/.test(src[j])) j++;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
      }
      t.push({ t: 'num', v: parseFloat(src.slice(i, j)) }); i = j; continue;
    }
    // identifier: function name, cell ref, range, boolean, sheet-qualified ref
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_.$!]/.test(src[j])) j++;
      let word = src.slice(i, j);
      // range  A1:B10
      if (src[j] === ':' && /^\$?[A-Za-z]+\$?\d+$/.test(word)) {
        let k = j + 1;
        while (k < src.length && /[A-Za-z0-9_$]/.test(src[k])) k++;
        const end = src.slice(j + 1, k);
        if (parseAddr(end)) { t.push({ t: 'range', v: word + ':' + end }); i = k; continue; }
      }
      if (src[j] === '(') { t.push({ t: 'func', v: word.toUpperCase() }); i = j; continue; }
      const up = word.toUpperCase();
      if (up === 'TRUE' || up === 'FALSE') { t.push({ t: 'bool', v: up === 'TRUE' }); i = j; continue; }
      if (parseAddr(word)) { t.push({ t: 'ref', v: word }); i = j; continue; }
      t.push({ t: 'name', v: up }); i = j; continue;
    }
    const op = OPS.find(o => src.startsWith(o, i));
    if (op) { t.push({ t: 'op', v: op }); i += op.length; continue; }
    if ('(),;'.includes(c)) { t.push({ t: c === ';' ? ',' : c }); i++; continue; }
    if (c === '{' || c === '}') { t.push({ t: c }); i++; continue; }
    return null;                                        // unknown character
  }
  return t;
}

// ---------------------------------------------------------------- parser
const PREC = { '=': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '<>': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };

function parse(tokens) {
  let p = 0;
  const peek = () => tokens[p];
  const next = () => tokens[p++];

  function parseExpr(minPrec = 0) {
    let left = parseUnary();
    if (left === null) return null;
    for (;;) {
      const tk = peek();
      if (!tk || tk.t !== 'op' || !(tk.v in PREC)) break;
      const prec = PREC[tk.v];
      if (prec < minPrec) break;
      next();
      // ^ is right-associative in spreadsheets
      const right = parseExpr(tk.v === '^' ? prec : prec + 1);
      if (right === null) return null;
      left = { k: 'bin', op: tk.v, a: left, b: right };
    }
    return left;
  }

  function parseUnary() {
    const tk = peek();
    if (!tk) return null;
    if (tk.t === 'op' && (tk.v === '-' || tk.v === '+')) {
      next();
      const operand = parseUnary();
      if (operand === null) return null;
      return tk.v === '-' ? { k: 'neg', a: operand } : operand;
    }
    return parsePostfix();
  }

  function parsePostfix() {
    let node = parsePrimary();
    while (peek() && peek().t === 'op' && peek().v === '%') { next(); node = { k: 'pct', a: node }; }
    return node;
  }

  function parsePrimary() {
    const tk = next();
    if (!tk) return null;
    switch (tk.t) {
      case 'num': return { k: 'num', v: tk.v };
      case 'str': return { k: 'str', v: tk.v };
      case 'bool': return { k: 'bool', v: tk.v };
      case 'ref': return { k: 'ref', v: tk.v };
      case 'range': return { k: 'range', v: tk.v };
      case 'name': return { k: 'name', v: tk.v };
      case 'func': {
        const name = tk.v;
        if (!peek() || peek().t !== '(') return null;
        next();
        const args = [];
        if (peek() && peek().t === ')') next();
        else {
          for (;;) {
            // support omitted args: SUM(A1,,B2)
            if (peek() && (peek().t === ',' || peek().t === ')')) args.push({ k: 'blank' });
            else { const a = parseExpr(0); if (a === null) return null; args.push(a); }
            const d = next();
            if (!d) return null;
            if (d.t === ')') break;
            if (d.t !== ',') return null;
          }
        }
        return { k: 'call', name, args };
      }
      case '(': {
        const e = parseExpr(0);
        if (e === null) return null;
        const cl = next();
        if (!cl || cl.t !== ')') return null;
        return e;
      }
      case '{': {                                      // inline array {1,2;3,4}
        const items = [];
        for (;;) {
          if (peek() && peek().t === '}') { next(); break; }
          const e = parseExpr(0); if (e === null) return null;
          items.push(e);
          const d = next(); if (!d) return null;
          if (d.t === '}') break;
          if (d.t !== ',') return null;
        }
        return { k: 'array', items };
      }
      default: return null;
    }
  }

  const ast = parseExpr(0);
  if (ast === null || p !== tokens.length) return null;
  return ast;
}

export function compile(src) {
  const tk = tokenize(src);
  if (!tk || !tk.length) return null;
  return parse(tk);
}

// ---------------------------------------------------------------- coercion
const num = v => {
  if (isErr(v)) return v;
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = String(v).trim().replace(/[$,]/g, '');
  if (s === '') return 0;
  if (/%$/.test(s)) { const n = parseFloat(s); return isNaN(n) ? ERR.VALUE() : n / 100; }
  const n = Number(s);
  return isNaN(n) ? ERR.VALUE() : n;
};
const str = v => {
  if (isErr(v)) return v;
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
};
const bool = v => {
  if (isErr(v)) return v;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).toUpperCase();
  if (s === 'TRUE') return true;
  if (s === 'FALSE' || s === '') return false;
  return ERR.VALUE();
};

// flatten arg values (ranges become arrays)
function flat(vals) {
  const out = [];
  const walk = v => Array.isArray(v) ? v.forEach(walk) : out.push(v);
  vals.forEach(walk);
  return out;
}
// numeric values only, ignoring blanks/text (SUM/AVERAGE semantics)
function nums(vals) {
  const out = [];
  for (const v of flat(vals)) {
    if (isErr(v)) return v;
    if (v === null || v === undefined || v === '') continue;
    if (typeof v === 'boolean') continue;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,]/g, ''));
    if (!isNaN(n)) out.push(n);
  }
  return out;
}

// criteria matcher used by SUMIF / COUNTIF / AVERAGEIF
function matcher(crit) {
  if (isErr(crit)) return () => false;
  let op = '=', val = crit;
  if (typeof crit === 'string') {
    const m = /^(<=|>=|<>|<|>|=)(.*)$/.exec(crit.trim());
    if (m) { op = m[1]; val = m[2].trim(); }
  }
  const vnum = Number(val);
  const isNum = val !== '' && !isNaN(vnum);
  // wildcard support for = / <>
  let rx = null;
  if (typeof val === 'string' && /[*?]/.test(val) && (op === '=' || op === '<>'))
    rx = new RegExp('^' + val.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');

  return cell => {
    if (isErr(cell)) return false;
    if (rx) { const hit = rx.test(String(cell ?? '')); return op === '=' ? hit : !hit; }
    if (isNum) {
      const c = typeof cell === 'number' ? cell : Number(String(cell ?? '').replace(/[$,]/g, ''));
      if (isNaN(c)) return op === '<>';
      switch (op) {
        case '=': return c === vnum; case '<>': return c !== vnum;
        case '<': return c < vnum; case '>': return c > vnum;
        case '<=': return c <= vnum; case '>=': return c >= vnum;
      }
    }
    const a = String(cell ?? '').toUpperCase(), b = String(val).toUpperCase();
    switch (op) {
      case '=': return a === b; case '<>': return a !== b;
      case '<': return a < b; case '>': return a > b;
      case '<=': return a <= b; case '>=': return a >= b;
    }
    return false;
  };
}

const EPOCH = Date.UTC(1899, 11, 30);                 // spreadsheet serial epoch
const toSerial = d => (d.getTime() - EPOCH) / 86400000;
const fromSerial = s => new Date(EPOCH + s * 86400000);

// ---------------------------------------------------------------- functions
// Each receives (args, ctx). `args` are lazily-evaluated thunks for IF/IFERROR.
export const FUNCS = {
  // --- math ---
  SUM:      a => { const n = nums(a); return isErr(n) ? n : n.reduce((x, y) => x + y, 0); },
  PRODUCT:  a => { const n = nums(a); return isErr(n) ? n : n.reduce((x, y) => x * y, 1); },
  AVERAGE:  a => { const n = nums(a); if (isErr(n)) return n; return n.length ? n.reduce((x, y) => x + y, 0) / n.length : ERR.DIV0(); },
  MEDIAN:   a => { const n = nums(a); if (isErr(n)) return n; if (!n.length) return ERR.NUM();
                   const s = [...n].sort((x, y) => x - y), m = s.length >> 1;
                   return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; },
  MIN:      a => { const n = nums(a); if (isErr(n)) return n; return n.length ? Math.min(...n) : 0; },
  MAX:      a => { const n = nums(a); if (isErr(n)) return n; return n.length ? Math.max(...n) : 0; },
  COUNT:    a => { const n = nums(a); return isErr(n) ? n : n.length; },
  COUNTA:   a => flat(a).filter(v => v !== null && v !== undefined && v !== '').length,
  COUNTBLANK: a => flat(a).filter(v => v === null || v === undefined || v === '').length,
  ABS:      a => { const n = num(a[0]); return isErr(n) ? n : Math.abs(n); },
  SQRT:     a => { const n = num(a[0]); if (isErr(n)) return n; return n < 0 ? ERR.NUM() : Math.sqrt(n); },
  POWER:    a => { const x = num(a[0]), y = num(a[1]); return isErr(x) ? x : isErr(y) ? y : Math.pow(x, y); },
  EXP:      a => Math.exp(num(a[0])),
  LN:       a => { const n = num(a[0]); return n <= 0 ? ERR.NUM() : Math.log(n); },
  LOG:      a => { const n = num(a[0]), b = a.length > 1 ? num(a[1]) : 10; return n <= 0 ? ERR.NUM() : Math.log(n) / Math.log(b); },
  LOG10:    a => { const n = num(a[0]); return n <= 0 ? ERR.NUM() : Math.log10(n); },
  MOD:      a => { const x = num(a[0]), y = num(a[1]); if (isErr(x)) return x; if (isErr(y)) return y;
                   return y === 0 ? ERR.DIV0() : x - y * Math.floor(x / y); },
  INT:      a => Math.floor(num(a[0])),
  TRUNC:    a => { const n = num(a[0]), d = a.length > 1 ? num(a[1]) : 0, f = Math.pow(10, d);
                   return Math.trunc(n * f) / f; },
  ROUND:    a => { const n = num(a[0]); if (isErr(n)) return n;
                   const d = a.length > 1 ? num(a[1]) : 0, f = Math.pow(10, d);
                   return Math.sign(n) * Math.round(Math.abs(n) * f + Number.EPSILON) / f; },
  ROUNDUP:  a => { const n = num(a[0]), d = a.length > 1 ? num(a[1]) : 0, f = Math.pow(10, d);
                   return Math.sign(n) * Math.ceil(Math.abs(n) * f) / f; },
  ROUNDDOWN:a => { const n = num(a[0]), d = a.length > 1 ? num(a[1]) : 0, f = Math.pow(10, d);
                   return Math.sign(n) * Math.floor(Math.abs(n) * f) / f; },
  CEILING:  a => { const n = num(a[0]), s = a.length > 1 ? num(a[1]) : 1; return s === 0 ? 0 : Math.ceil(n / s) * s; },
  FLOOR:    a => { const n = num(a[0]), s = a.length > 1 ? num(a[1]) : 1; return s === 0 ? ERR.DIV0() : Math.floor(n / s) * s; },
  SIGN:     a => Math.sign(num(a[0])),
  PI:       () => Math.PI,
  RAND:     () => Math.random(),
  RANDBETWEEN: a => { const lo = num(a[0]), hi = num(a[1]); return Math.floor(Math.random() * (hi - lo + 1)) + lo; },
  SUMPRODUCT: a => {
    const arrs = a.map(v => flat([v]));
    const len = Math.max(...arrs.map(x => x.length));
    let total = 0;
    for (let i = 0; i < len; i++) {
      let p = 1;
      for (const arr of arrs) { const n = num(arr[i] ?? 0); if (isErr(n)) return n; p *= n; }
      total += p;
    }
    return total;
  },
  STDEV: a => {
    const n = nums(a); if (isErr(n)) return n;
    if (n.length < 2) return ERR.DIV0();
    const m = n.reduce((x, y) => x + y, 0) / n.length;
    return Math.sqrt(n.reduce((s, v) => s + (v - m) ** 2, 0) / (n.length - 1));
  },
  VAR: a => {
    const n = nums(a); if (isErr(n)) return n;
    if (n.length < 2) return ERR.DIV0();
    const m = n.reduce((x, y) => x + y, 0) / n.length;
    return n.reduce((s, v) => s + (v - m) ** 2, 0) / (n.length - 1);
  },
  LARGE: a => { const n = nums([a[0]]); if (isErr(n)) return n;
                const k = num(a[1]); const s = [...n].sort((x, y) => y - x);
                return k >= 1 && k <= s.length ? s[k - 1] : ERR.NUM(); },
  SMALL: a => { const n = nums([a[0]]); if (isErr(n)) return n;
                const k = num(a[1]); const s = [...n].sort((x, y) => x - y);
                return k >= 1 && k <= s.length ? s[k - 1] : ERR.NUM(); },
  RANK: a => { const v = num(a[0]), n = nums([a[1]]); if (isErr(n)) return n;
               const asc = a.length > 2 && bool(a[2]) === true;
               const s = [...n].sort((x, y) => asc ? x - y : y - x);
               const i = s.indexOf(v); return i < 0 ? ERR.NA() : i + 1; },

  // --- conditional aggregates ---
  SUMIF: (a) => {
    const range = flat([a[0]]), test = matcher(a[1]);
    const sumRange = a.length > 2 ? flat([a[2]]) : range;
    let s = 0;
    range.forEach((v, i) => { if (test(v)) { const n = num(sumRange[i] ?? 0); if (!isErr(n)) s += n; } });
    return s;
  },
  COUNTIF: a => { const test = matcher(a[1]); return flat([a[0]]).filter(test).length; },
  AVERAGEIF: a => {
    const range = flat([a[0]]), test = matcher(a[1]);
    const avgRange = a.length > 2 ? flat([a[2]]) : range;
    const picked = [];
    range.forEach((v, i) => { if (test(v)) { const n = num(avgRange[i] ?? 0); if (!isErr(n)) picked.push(n); } });
    return picked.length ? picked.reduce((x, y) => x + y, 0) / picked.length : ERR.DIV0();
  },
  SUMIFS: a => {
    const sumRange = flat([a[0]]);
    const pairs = [];
    for (let i = 1; i + 1 < a.length; i += 2) pairs.push([flat([a[i]]), matcher(a[i + 1])]);
    let s = 0;
    for (let i = 0; i < sumRange.length; i++)
      if (pairs.every(([r, t]) => t(r[i]))) { const n = num(sumRange[i] ?? 0); if (!isErr(n)) s += n; }
    return s;
  },
  COUNTIFS: a => {
    const pairs = [];
    for (let i = 0; i + 1 < a.length; i += 2) pairs.push([flat([a[i]]), matcher(a[i + 1])]);
    const len = Math.max(...pairs.map(([r]) => r.length));
    let c = 0;
    for (let i = 0; i < len; i++) if (pairs.every(([r, t]) => t(r[i]))) c++;
    return c;
  },

  // --- logic (lazy args) ---
  IF: (a, ctx, lazy) => {
    const c = bool(lazy[0]());
    if (isErr(c)) return c;
    if (c) return lazy.length > 1 ? lazy[1]() : true;
    return lazy.length > 2 ? lazy[2]() : false;
  },
  IFS: (a, ctx, lazy) => {
    for (let i = 0; i + 1 < lazy.length; i += 2) {
      const c = bool(lazy[i]()); if (isErr(c)) return c;
      if (c) return lazy[i + 1]();
    }
    return ERR.NA();
  },
  IFERROR: (a, ctx, lazy) => { const v = lazy[0](); return isErr(v) ? (lazy.length > 1 ? lazy[1]() : '') : v; },
  IFNA:    (a, ctx, lazy) => { const v = lazy[0](); return (isErr(v) && v.code === '#N/A') ? lazy[1]() : v; },
  AND: a => { for (const v of flat(a)) { if (v === '' || v === null) continue; const b = bool(v); if (isErr(b)) return b; if (!b) return false; } return true; },
  OR:  a => { for (const v of flat(a)) { if (v === '' || v === null) continue; const b = bool(v); if (isErr(b)) return b; if (b) return true; } return false; },
  NOT: a => { const b = bool(a[0]); return isErr(b) ? b : !b; },
  XOR: a => flat(a).filter(v => bool(v) === true).length % 2 === 1,
  TRUE: () => true, FALSE: () => false,
  ISBLANK:  a => a[0] === '' || a[0] === null || a[0] === undefined,
  ISNUMBER: a => typeof a[0] === 'number' || (a[0] !== '' && a[0] !== null && !isNaN(Number(a[0])) && typeof a[0] !== 'boolean'),
  ISTEXT:   a => typeof a[0] === 'string' && a[0] !== '' && isNaN(Number(a[0])),
  ISERROR:  (a, ctx, lazy) => isErr(lazy[0]()),
  ISNA:     (a, ctx, lazy) => { const v = lazy[0](); return isErr(v) && v.code === '#N/A'; },
  ISLOGICAL: a => typeof a[0] === 'boolean',
  NA: () => ERR.NA(),

  // --- lookup ---
  VLOOKUP: (a, ctx) => {
    const key = a[0], grid = ctx.grid(a.__nodes[1]), colIdx = num(a[2]);
    if (!grid) return ERR.REF();
    if (isErr(colIdx)) return colIdx;
    if (colIdx < 1 || colIdx > (grid[0] || []).length) return ERR.VALUE();
    const approx = a.length > 3 ? bool(a[3]) !== false : true;
    if (!approx) {
      for (const row of grid) if (looseEq(row[0], key)) return row[colIdx - 1];
      return ERR.NA();
    }
    let best = null;
    for (const row of grid) {
      const cmp = compareVals(row[0], key);
      if (cmp === 0) return row[colIdx - 1];
      if (cmp < 0) best = row;
    }
    return best ? best[colIdx - 1] : ERR.NA();
  },
  HLOOKUP: (a, ctx) => {
    const key = a[0], grid = ctx.grid(a.__nodes[1]), rowIdx = num(a[2]);
    if (!grid) return ERR.REF();
    if (rowIdx < 1 || rowIdx > grid.length) return ERR.VALUE();
    const header = grid[0] || [];
    const approx = a.length > 3 ? bool(a[3]) !== false : true;
    let bestCol = -1;
    for (let c = 0; c < header.length; c++) {
      const cmp = compareVals(header[c], key);
      if (cmp === 0) return grid[rowIdx - 1][c];
      if (approx && cmp < 0) bestCol = c;
    }
    return bestCol >= 0 ? grid[rowIdx - 1][bestCol] : ERR.NA();
  },
  XLOOKUP: (a, ctx) => {
    const key = a[0], look = flat([a[1]]), ret = flat([a[2]]);
    for (let i = 0; i < look.length; i++) if (looseEq(look[i], key)) return ret[i] ?? '';
    return a.length > 3 ? a[3] : ERR.NA();
  },
  MATCH: a => {
    const key = a[0], arr = flat([a[1]]);
    const type = a.length > 2 ? num(a[2]) : 1;
    if (type === 0) { for (let i = 0; i < arr.length; i++) if (looseEq(arr[i], key)) return i + 1; return ERR.NA(); }
    let best = -1;
    for (let i = 0; i < arr.length; i++) {
      const cmp = compareVals(arr[i], key);
      if (cmp === 0) return i + 1;
      if (type === 1 && cmp < 0) best = i;
      if (type === -1 && cmp > 0) best = i;
    }
    return best >= 0 ? best + 1 : ERR.NA();
  },
  INDEX: (a, ctx) => {
    const grid = ctx.grid(a.__nodes[0]);
    if (!grid) { const arr = flat([a[0]]); const i = num(a[1]); return arr[i - 1] ?? ERR.REF(); }
    const r = num(a[1]), c = a.length > 2 ? num(a[2]) : 1;
    if (grid.length === 1 && a.length === 2) return grid[0][r - 1] ?? ERR.REF();
    if ((grid[0] || []).length === 1 && a.length === 2) return (grid[r - 1] || [])[0] ?? ERR.REF();
    const row = grid[r - 1];
    if (!row) return ERR.REF();
    return row[c - 1] ?? ERR.REF();
  },
  CHOOSE: (a, ctx, lazy) => { const i = num(lazy[0]()); return i >= 1 && i < lazy.length ? lazy[i]() : ERR.VALUE(); },
  ROW:    (a, ctx) => ctx.self ? ctx.self.r + 1 : ERR.REF(),
  COLUMN: (a, ctx) => ctx.self ? ctx.self.c + 1 : ERR.REF(),
  ROWS:   (a, ctx) => { const g = ctx.grid(a.__nodes[0]); return g ? g.length : 1; },
  COLUMNS:(a, ctx) => { const g = ctx.grid(a.__nodes[0]); return g ? (g[0] || []).length : 1; },

  // --- text ---
  CONCATENATE: a => flat(a).map(str).join(''),
  CONCAT:      a => flat(a).map(str).join(''),
  TEXTJOIN: a => {
    const sep = str(a[0]), skip = bool(a[1]) !== false;
    return flat(a.slice(2)).filter(v => !skip || (v !== '' && v !== null && v !== undefined)).map(str).join(sep);
  },
  LEN:   a => str(a[0]).length,
  LEFT:  a => str(a[0]).slice(0, a.length > 1 ? num(a[1]) : 1),
  RIGHT: a => { const s = str(a[0]), n = a.length > 1 ? num(a[1]) : 1; return n <= 0 ? '' : s.slice(-n); },
  MID:   a => { const s = str(a[0]), st = num(a[1]), n = num(a[2]); return st < 1 ? ERR.VALUE() : s.substr(st - 1, n); },
  UPPER: a => str(a[0]).toUpperCase(),
  LOWER: a => str(a[0]).toLowerCase(),
  PROPER: a => str(a[0]).replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase()),
  TRIM:  a => str(a[0]).trim().replace(/\s+/g, ' '),
  SUBSTITUTE: a => {
    const s = str(a[0]), find = str(a[1]), rep = str(a[2]);
    if (a.length > 3) {
      const n = num(a[3]); let i = -1, count = 0;
      while (count < n) { i = s.indexOf(find, i + 1); if (i < 0) return s; count++; }
      return s.slice(0, i) + rep + s.slice(i + find.length);
    }
    return find === '' ? s : s.split(find).join(rep);
  },
  REPLACE: a => { const s = str(a[0]), st = num(a[1]), n = num(a[2]), r = str(a[3]);
                  return s.slice(0, st - 1) + r + s.slice(st - 1 + n); },
  FIND: a => { const i = str(a[1]).indexOf(str(a[0]), a.length > 2 ? num(a[2]) - 1 : 0); return i < 0 ? ERR.VALUE() : i + 1; },
  SEARCH: a => { const i = str(a[1]).toLowerCase().indexOf(str(a[0]).toLowerCase(), a.length > 2 ? num(a[2]) - 1 : 0);
                 return i < 0 ? ERR.VALUE() : i + 1; },
  REPT: a => str(a[0]).repeat(Math.max(0, num(a[1]))),
  VALUE: a => { const n = num(a[0]); return n; },
  EXACT: a => str(a[0]) === str(a[1]),
  CHAR: a => String.fromCharCode(num(a[0])),
  CODE: a => str(a[0]).charCodeAt(0) || ERR.VALUE(),
  TEXT: a => {
    const v = a[0], fmt = str(a[1]);
    const n = num(v);
    if (isErr(n)) return str(v);
    if (/^0+%$/.test(fmt) || /%$/.test(fmt)) {
      const dec = (fmt.split('.')[1] || '').replace('%', '').length;
      return (n * 100).toFixed(dec) + '%';
    }
    if (/\$/.test(fmt)) {
      const dec = (fmt.split('.')[1] || '').length;
      return '$' + n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    }
    if (/[dmy]/i.test(fmt) && !/^0/.test(fmt)) {
      const d = fromSerial(n);
      return fmt.replace(/yyyy/gi, d.getUTCFullYear())
        .replace(/mm/g, String(d.getUTCMonth() + 1).padStart(2, '0'))
        .replace(/dd/g, String(d.getUTCDate()).padStart(2, '0'));
    }
    if (fmt.includes('.')) return n.toFixed((fmt.split('.')[1] || '').length);
    if (fmt.includes(',')) return n.toLocaleString('en-US');
    return String(n);
  },

  // --- date/time ---
  TODAY: () => { const d = new Date(); return Math.floor(toSerial(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())))); },
  NOW:   () => toSerial(new Date()),
  DATE:  a => toSerial(new Date(Date.UTC(num(a[0]), num(a[1]) - 1, num(a[2])))),
  YEAR:  a => fromSerial(num(a[0])).getUTCFullYear(),
  MONTH: a => fromSerial(num(a[0])).getUTCMonth() + 1,
  DAY:   a => fromSerial(num(a[0])).getUTCDate(),
  WEEKDAY: a => fromSerial(num(a[0])).getUTCDay() + 1,
  HOUR:  a => Math.floor((num(a[0]) % 1) * 24),
  MINUTE:a => Math.floor((num(a[0]) * 1440) % 60),
  DAYS:  a => num(a[0]) - num(a[1]),
  EDATE: a => { const d = fromSerial(num(a[0])); d.setUTCMonth(d.getUTCMonth() + num(a[1])); return toSerial(d); },
};

function looseEq(a, b) {
  if (a === null || a === undefined) a = '';
  if (b === null || b === undefined) b = '';
  if (typeof a === 'number' || typeof b === 'number') {
    const x = Number(a), y = Number(b);
    if (!isNaN(x) && !isNaN(y)) return x === y;
  }
  return String(a).toUpperCase() === String(b).toUpperCase();
}
function compareVals(a, b) {          // -1 a<b, 0 equal, 1 a>b
  const x = Number(a), y = Number(b);
  if (!isNaN(x) && !isNaN(y) && a !== '' && b !== '') return x < y ? -1 : x > y ? 1 : 0;
  const s = String(a ?? '').toUpperCase(), t = String(b ?? '').toUpperCase();
  return s < t ? -1 : s > t ? 1 : 0;
}

// Functions that must see their arguments lazily (short-circuit / error-trapping).
const LAZY = new Set(['IF', 'IFS', 'IFERROR', 'IFNA', 'CHOOSE', 'ISERROR', 'ISNA']);
// Functions that want the raw range node, not flattened values.
const WANTS_NODES = new Set(['VLOOKUP', 'HLOOKUP', 'INDEX', 'ROWS', 'COLUMNS']);

// ---------------------------------------------------------------- evaluator
// resolver: { cell(ref) -> value, range(rangeStr) -> 2D array, self: {r,c} }
export function evaluate(ast, resolver) {
  const ctx = {
    self: resolver.self,
    grid: node => {
      if (!node) return null;
      if (node.k === 'range') return resolver.range(node.v);
      if (node.k === 'ref') return [[resolver.cell(node.v)]];
      return null;
    },
  };

  function ev(node) {
    if (!node) return '';
    switch (node.k) {
      case 'num': case 'str': case 'bool': return node.v;
      case 'blank': return '';
      case 'ref': return resolver.cell(node.v);
      case 'range': {
        const g = resolver.range(node.v);
        return g ? g : ERR.REF();
      }
      case 'array': return node.items.map(ev);
      case 'name': {
        if (node.v === 'TRUE') return true;
        if (node.v === 'FALSE') return false;
        return ERR.NAME();
      }
      case 'neg': { const v = num(ev(node.a)); return isErr(v) ? v : -v; }
      case 'pct': { const v = num(ev(node.a)); return isErr(v) ? v : v / 100; }
      case 'bin': {
        const op = node.op;
        const a = ev(node.a), b = ev(node.b);
        if (isErr(a)) return a;
        if (isErr(b)) return b;
        if (op === '&') { const x = str(a), y = str(b); return isErr(x) ? x : isErr(y) ? y : x + y; }
        if ('=<>'.includes(op) || op === '<=' || op === '>=' || op === '<>') {
          const av = Array.isArray(a) ? a.flat()[0] : a, bv = Array.isArray(b) ? b.flat()[0] : b;
          const c = compareVals(av ?? '', bv ?? '');
          switch (op) {
            case '=': return looseEq(av, bv); case '<>': return !looseEq(av, bv);
            case '<': return c < 0; case '>': return c > 0;
            case '<=': return c <= 0; case '>=': return c >= 0;
          }
        }
        const x = num(Array.isArray(a) ? a.flat()[0] : a);
        const y = num(Array.isArray(b) ? b.flat()[0] : b);
        if (isErr(x)) return x; if (isErr(y)) return y;
        switch (op) {
          case '+': return x + y; case '-': return x - y; case '*': return x * y;
          case '/': return y === 0 ? ERR.DIV0() : x / y;
          case '^': return Math.pow(x, y);
        }
        return ERR.PARSE();
      }
      case 'call': {
        const fn = FUNCS[node.name];
        if (!fn) return ERR.NAME();
        const lazy = node.args.map(n => () => ev(n));
        if (LAZY.has(node.name)) return fn([], ctx, lazy);
        const args = node.args.map(ev);
        for (const a of args) if (isErr(a)) {
          // aggregates surface the first error; that matches spreadsheet behaviour
          if (!WANTS_NODES.has(node.name)) return a;
        }
        args.__nodes = node.args;
        return fn(args, ctx, lazy);
      }
      default: return ERR.PARSE();
    }
  }
  return ev(ast);
}

// Collect every cell address a formula depends on — drives recalculation order.
export function dependencies(ast, out = new Set()) {
  if (!ast || typeof ast !== 'object') return out;
  if (ast.k === 'ref') out.add(ast.v.replace(/\$/g, '').toUpperCase());
  if (ast.k === 'range') {
    const [a, b] = ast.v.split(':').map(s => parseAddr(s.replace(/\$/g, '')));
    if (a && b) {
      for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++)
        for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++)
          out.add(addr(r, c));
    }
  }
  for (const k of ['a', 'b']) if (ast[k]) dependencies(ast[k], out);
  for (const n of ast.args || []) dependencies(n, out);
  for (const n of ast.items || []) dependencies(n, out);
  return out;
}

export const FUNC_NAMES = Object.keys(FUNCS).sort();
