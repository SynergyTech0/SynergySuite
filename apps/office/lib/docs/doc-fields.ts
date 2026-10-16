// Word's document fields: DATE, TIME, CREATEDATE, SAVEDATE, PRINTDATE,
// FILENAME, AUTHOR, TITLE, SUBJECT, USERNAME, NUMPAGES, PAGE, SECTIONPAGES,
// NUMWORDS, NUMCHARS and table formulas (= SUM(ABOVE) …), with their date
// (\@), number (\#) and text (\*) format switches.

export const FIELD_KINDS = ["DATE", "TIME", "CREATEDATE", "SAVEDATE", "PRINTDATE", "FILENAME", "AUTHOR", "TITLE", "SUBJECT", "USERNAME", "NUMPAGES", "PAGE", "SECTIONPAGES", "NUMWORDS", "NUMCHARS", "="] as const;
/** A field's keyword (upper case), or "=" for a formula. */
export type FieldKind = string;

/** Fields that have nodes of their own (links, TOC, index, captions, cross-references, merge fields, citations, form fields). */
const OWN_NODES = new Set(["HYPERLINK", "TOC", "TC", "INDEX", "XE", "TA", "TOA", "RD", "SEQ", "REF", "PAGEREF", "MERGEFIELD", "CITATION", "BIBLIOGRAPHY", "FORMTEXT", "FORMCHECKBOX", "FORMDROPDOWN"]);

/**
 * Fields whose result is more than a run of text (pictures, embedded or linked
 * content, equations, AutoText, mail-merge blocks, list numbers, buttons): their
 * result stays in the document as it is, rather than becoming an evaluated field.
 */
const RICH_RESULTS = new Set(["INCLUDEPICTURE", "INCLUDETEXT", "EMBED", "LINK", "EQ", "SHAPE", "DISPLAYBARCODE", "MERGEBARCODE", "BARCODE", "ADDIN", "AUTOTEXT", "AUTOTEXTLIST", "GLOSSARY", "DDE", "DDEAUTO", "IMPORT", "DATABASE", "PRIVATE", "ADDRESSBLOCK", "GREETINGLINE", "NEXT", "NEXTIF", "SKIPIF", "MERGEREC", "MERGESEQ", "LISTNUM", "AUTONUM", "AUTONUMLGL", "AUTONUMOUT", "MACROBUTTON", "GOTOBUTTON", "ADVANCE", "PRINT", "CONTROL", "OCX", "FORMCHECKBOX"]);

export type FieldContext = {
  now: Date;
  created?: Date | null;
  saved?: Date | null;
  printed?: Date | null;
  title?: string;
  subject?: string;
  author?: string;
  user?: string;
  filename?: string;
  page?: string | number | null;
  pages?: number | null;
  sectionPages?: number | null;
  section?: number | null;
  words?: number;
  chars?: number;
  /** for a formula in a table: the grid of cell texts and where the field sits */
  table?: { cells: string[][]; row: number; col: number };
  /** document properties (core, app and custom), by name */
  properties?: Record<string, string>;
  /** the text of a bookmark (REF in IF and formulas, bookmarks in formulas) */
  bookmark?: (name: string) => string | null;
  /** STYLEREF: the text of the nearest paragraph in that style */
  styleRef?: (style: string, fromBottom: boolean) => string | null;
  /** NOTEREF: the number of the note a bookmark marks */
  noteRef?: (name: string) => string | null;
  /** values set by SET fields before this one */
  sets?: Record<string, string>;
};

/** The kind of field an instruction is: its keyword, "=" for a formula, or null for a field with a node of its own. */
export function fieldKind(instr: string): FieldKind | null {
  const t = instr.trim();
  if (t.startsWith("=")) return "=";
  const k = t.split(/\s+/)[0]?.toUpperCase() || "";
  if (!/^[A-Z][A-Z0-9]*$/.test(k) || OWN_NODES.has(k) || RICH_RESULTS.has(k) || /^_REF\d+$/.test(k)) return null;
  return k;
}

/** Field arguments: words and quoted strings (quotes removed), switches kept as words. */
export function fieldArgs(instr: string): string[] {
  const out: string[] = [];
  for (const m of instr.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)) out.push(m[1] !== undefined ? m[1].replace(/\\(["\\])/g, "$1") : m[2]);
  return out;
}

/** Built-in document properties by Word's names (DOCPROPERTY and INFO). */
function property(name: string, ctx: FieldContext): string | null {
  const n = name.toLowerCase();
  const p = ctx.properties || {};
  for (const [k, v] of Object.entries(p)) if (k.toLowerCase() === n) return v;
  const date = (d: Date | null | undefined) => (d ? formatDate(d, "M/d/yyyy h:mm:ss am/pm") : "");
  switch (n) {
    case "title":
      return ctx.title ?? "";
    case "subject":
      return ctx.subject ?? "";
    case "author":
      return ctx.author ?? "";
    case "lastsavedby":
      return ctx.user ?? ctx.author ?? "";
    case "createtime":
    case "createdate":
      return date(ctx.created ?? ctx.now);
    case "lastsavedtime":
    case "savedate":
      return date(ctx.saved ?? ctx.now);
    case "lastprinted":
    case "printdate":
      return date(ctx.printed);
    case "pages":
    case "numpages":
      return String(ctx.pages ?? 1);
    case "words":
    case "numwords":
      return String(ctx.words ?? 0);
    case "characters":
    case "numchars":
      return String(ctx.chars ?? 0);
    case "filename":
      return ctx.filename ?? "";
    case "keywords":
    case "comments":
    case "company":
    case "manager":
    case "category":
    case "template":
    case "revisionnumber":
    case "revnum":
      return "";
  }
  return null;
}

/** Compare two operands as Word's IF and COMPARE do: as numbers when both are, else as text (= and <> allow * and ? wildcards). */
export function compareValues(a: string, op: string, b: string): boolean {
  const x = num(a);
  const y = num(b);
  if (x !== null && y !== null) return op === "=" ? x === y : op === "<>" ? x !== y : op === "<" ? x < y : op === ">" ? x > y : op === "<=" ? x <= y : x >= y;
  if (op === "=" || op === "<>") {
    const re = new RegExp(`^${b.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "s");
    return op === "=" ? re.test(a) : !re.test(a);
  }
  const c = a.localeCompare(b);
  return op === "<" ? c < 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : c >= 0;
}

/** Replace nested fields ({ ... } in an instruction) by their results, innermost first. */
export function resolveNested(instr: string, ctx: FieldContext): string {
  let s = instr;
  const nested = (inner: string): string => {
    const v = fieldValue(inner, ctx);
    if (v !== null) return v;
    // REF (or a bare bookmark name) and SET values
    const a = fieldArgs(inner);
    const name = /^REF$/i.test(a[0] || "") ? a[1] : a.length === 1 ? a[0] : undefined;
    if (name) return ctx.sets?.[name] ?? ctx.bookmark?.(name) ?? "";
    return "";
  };
  for (let guard = 0; guard < 50 && /\{[^{}]*\}/.test(s); guard++)
    s = s.replace(/\{([^{}]*)\}/g, (_m, inner: string, at: number, whole: string) => {
      const v = nested(inner);
      // a result with spaces stays one operand, unless the field sits inside quotes already
      const inQuotes = (whole.slice(0, at).match(/"/g) || []).length % 2 === 1;
      return !inQuotes && /\s/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
    });
  return s;
}

const switchArg = (instr: string, sw: string): string | null => {
  const m = new RegExp(`\\\\${sw}\\s+(?:"([^"]*)"|(\\S+))`).exec(instr);
  return m ? (m[1] ?? m[2]) : null;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** A date in a Word date picture (\@ "dddd, MMMM d, yyyy"). */
export function formatDate(d: Date, picture: string): string {
  let out = "";
  const re = /'([^']*)'|dddd|ddd|dd|d|MMMM|MMM|MM|M|yyyy|yy|HH|H|hh|h|mm|m|ss|s|AM\/PM|am\/pm|./g;
  const pad = (n: number) => String(n).padStart(2, "0");
  const h12 = (h: number) => (h % 12 === 0 ? 12 : h % 12);
  for (const m of picture.matchAll(re)) {
    const t = m[0];
    if (m[1] !== undefined) out += m[1];
    else if (t === "dddd") out += DAYS[d.getDay()];
    else if (t === "ddd") out += DAYS[d.getDay()].slice(0, 3);
    else if (t === "dd") out += pad(d.getDate());
    else if (t === "d") out += d.getDate();
    else if (t === "MMMM") out += MONTHS[d.getMonth()];
    else if (t === "MMM") out += MONTHS[d.getMonth()].slice(0, 3);
    else if (t === "MM") out += pad(d.getMonth() + 1);
    else if (t === "M") out += d.getMonth() + 1;
    else if (t === "yyyy") out += d.getFullYear();
    else if (t === "yy") out += pad(d.getFullYear() % 100);
    else if (t === "HH") out += pad(d.getHours());
    else if (t === "H") out += d.getHours();
    else if (t === "hh") out += pad(h12(d.getHours()));
    else if (t === "h") out += h12(d.getHours());
    else if (t === "mm") out += pad(d.getMinutes());
    else if (t === "m") out += d.getMinutes();
    else if (t === "ss") out += pad(d.getSeconds());
    else if (t === "s") out += d.getSeconds();
    else if (t === "AM/PM") out += d.getHours() < 12 ? "AM" : "PM";
    else if (t === "am/pm") out += d.getHours() < 12 ? "am" : "pm";
    else out += t;
  }
  return out;
}

/** A number in a Word numeric picture (\# "#,##0.00", "0%", "$#,##0"). */
export function formatNumber(n: number, picture: string): string {
  const pic = picture.split(";")[n < 0 && picture.includes(";") ? 1 : 0] || picture;
  const m = /([#0,]+)(?:\.([#0]+))?/.exec(pic);
  if (!m) return String(n);
  const pct = pic.includes("%");
  let v = Math.abs(pct ? n * 100 : n);
  const decimals = m[2]?.length || 0;
  const minDecimals = (m[2]?.match(/0/g) || []).length;
  v = Math.round(v * 10 ** decimals) / 10 ** decimals;
  let [int, frac = ""] = v.toFixed(decimals).split(".");
  frac = frac.replace(new RegExp(`0{0,${decimals - minDecimals}}$`), "");
  const minInt = (m[1].match(/0/g) || []).length;
  int = int.padStart(minInt, "0");
  if (m[1].includes(",")) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (int === "" && !frac) int = "0";
  const body = int + (frac ? `.${frac}` : "");
  const sign = n < 0 && !picture.includes(";") ? "-" : "";
  return pic.slice(0, m.index).replace(/[#0]/g, "") + sign + body + pic.slice(m.index + m[0].length);
}

function toRoman(n: number): string {
  const map: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, s] of map) while (n >= v) (out += s), (n -= v);
  return out;
}

/** Apply \* text switches. */
/** Apply a field's \\* text-format switches (Upper, Lower, FirstCap, Caps, roman, alphabetic). */
export function textSwitch(v: string, instr: string): string {
  const fmts = [...instr.matchAll(/\\\*\s+(\w+)/g)].map((m) => m[1].toLowerCase());
  for (const f of fmts) {
    if (f === "upper") v = v.toUpperCase();
    else if (f === "lower") v = v.toLowerCase();
    else if (f === "firstcap") v = v.charAt(0).toUpperCase() + v.slice(1);
    else if (f === "caps") v = v.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
    else if (f === "roman" && /^\d+$/.test(v)) v = /\\\*\s+roman/.test(instr) ? toRoman(Number(v)).toLowerCase() : toRoman(Number(v));
    else if (f === "alphabetic" && /^\d+$/.test(v)) v = String.fromCharCode(96 + ((Number(v) - 1) % 26) + 1);
  }
  return v;
}

// ---- formulas ----

const colIndex = (s: string) => [...s.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const t = s.replace(/[$,%\s]/g, "");
  if (!/^[-+(]?\d*\.?\d+(?:[eE][-+]?\d+)?\)?$/.test(t)) return null;
  const v = parseFloat(t.replace(/[()]/g, ""));
  return /^\(.*\)$/.test(t) ? -v : v;
};

/** Evaluate a formula (without the leading "="). Throws on a syntax error. */
export function evalFormula(expr: string, table?: FieldContext["table"], bookmark?: FieldContext["bookmark"]): number {
  const toks = expr.match(/\s*(\d*\.\d+|\d+|[A-Za-z_][A-Za-z_0-9]*(?::[A-Za-z]+\d+)?|<=|>=|<>|[-+*/^%(),<>=])/g)?.map((t) => t.trim()) || [];
  let i = 0;
  const peek = () => toks[i];
  const take = (t?: string) => {
    const v = toks[i++];
    if (t && v !== t) throw new Error(`expected ${t}`);
    return v;
  };
  const cell = (ref: string): number | null => {
    const m = /^([A-Za-z]+)(\d+)$/.exec(ref);
    if (!m || !table) return null;
    return num(table.cells[Number(m[2]) - 1]?.[colIndex(m[1])]);
  };
  const range = (a: string): number[] => {
    if (!table) return [];
    const up = a.toUpperCase();
    const { cells, row, col } = table;
    const pick = (r: number, c: number) => num(cells[r]?.[c]);
    const vals: (number | null)[] = [];
    if (up === "ABOVE") for (let r = row - 1; r >= 0; r--) vals.push(pick(r, col));
    else if (up === "BELOW") for (let r = row + 1; r < cells.length; r++) vals.push(pick(r, col));
    else if (up === "LEFT") for (let c = col - 1; c >= 0; c--) vals.push(pick(row, c));
    else if (up === "RIGHT") for (let c = col + 1; c < (cells[row]?.length || 0); c++) vals.push(pick(row, c));
    else {
      const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(up);
      if (m) {
        const [r1, r2] = [Number(m[2]) - 1, Number(m[4]) - 1].sort((x, y) => x - y);
        const [c1, c2] = [colIndex(m[1]), colIndex(m[3])].sort((x, y) => x - y);
        for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) vals.push(pick(r, c));
      } else vals.push(cell(up));
    }
    // ABOVE/LEFT stop at the first non-number after numbers, as Word does
    if (["ABOVE", "LEFT", "BELOW", "RIGHT"].includes(up)) {
      const out: number[] = [];
      for (const v of vals) {
        if (v === null) {
          if (out.length) break;
          continue;
        }
        out.push(v);
      }
      return out;
    }
    return vals.filter((v): v is number => v !== null);
  };
  const FN: Record<string, (args: number[][]) => number> = {
    SUM: (a) => a.flat().reduce((s, v) => s + v, 0),
    AVERAGE: (a) => (a.flat().length ? a.flat().reduce((s, v) => s + v, 0) / a.flat().length : 0),
    MIN: (a) => Math.min(...a.flat()),
    MAX: (a) => Math.max(...a.flat()),
    COUNT: (a) => a.flat().length,
    PRODUCT: (a) => a.flat().reduce((s, v) => s * v, 1),
    ABS: (a) => Math.abs(a[0]?.[0] ?? 0),
    INT: (a) => Math.floor(a[0]?.[0] ?? 0),
    ROUND: (a) => {
      const f = 10 ** (a[1]?.[0] ?? 0);
      return Math.round((a[0]?.[0] ?? 0) * f) / f;
    },
    MOD: (a) => (a[0]?.[0] ?? 0) % (a[1]?.[0] ?? 1),
    SIGN: (a) => Math.sign(a[0]?.[0] ?? 0),
    IF: (a) => ((a[0]?.[0] ?? 0) ? (a[1]?.[0] ?? 0) : (a[2]?.[0] ?? 0)),
    AND: (a) => (a.every((x) => x[0]) ? 1 : 0),
    OR: (a) => (a.some((x) => x[0]) ? 1 : 0),
    NOT: (a) => (a[0]?.[0] ? 0 : 1),
    TRUE: () => 1,
    FALSE: () => 0,
  };
  const args = (): number[][] => {
    const out: number[][] = [];
    take("(");
    if (peek() === ")") return take(")"), out;
    for (;;) {
      const t = peek();
      if (t && /^(ABOVE|BELOW|LEFT|RIGHT|[A-Za-z]+\d+:[A-Za-z]+\d+)$/i.test(t)) {
        i++;
        out.push(range(t));
      } else out.push([cmp()]);
      if (peek() === ",") i++;
      else break;
    }
    take(")");
    return out;
  };
  const atom = (): number => {
    const t = take();
    if (t === undefined) throw new Error("unexpected end");
    if (t === "(") {
      const v = cmp();
      take(")");
      return v;
    }
    if (t === "-") return -pow();
    if (t === "+") return pow();
    if (/^\d|^\./.test(t)) return parseFloat(t);
    const up = t.toUpperCase();
    if (FN[up]) return FN[up](peek() === "(" ? args() : []);
    const v = cell(up);
    if (v !== null) return v;
    // a bookmark's number
    const bm = bookmark?.(t);
    if (bm != null && num(bm) !== null) return num(bm)!;
    throw new Error(`unknown ${t}`);
  };
  const pct = (): number => {
    let v = atom();
    while (peek() === "%") (i++, (v /= 100));
    return v;
  };
  const pow = (): number => {
    const b = pct();
    if (peek() === "^") {
      i++;
      return b ** pow();
    }
    return b;
  };
  const mul = (): number => {
    let v = pow();
    while (peek() === "*" || peek() === "/") v = take() === "*" ? v * pow() : v / pow();
    return v;
  };
  const add = (): number => {
    let v = mul();
    while (peek() === "+" || peek() === "-") v = take() === "+" ? v + mul() : v - mul();
    return v;
  };
  const cmp = (): number => {
    const v = add();
    const op = peek();
    if (op && ["<", ">", "=", "<=", ">=", "<>"].includes(op)) {
      i++;
      const w = add();
      return (op === "<" ? v < w : op === ">" ? v > w : op === "=" ? v === w : op === "<=" ? v <= w : op === ">=" ? v >= w : v !== w) ? 1 : 0;
    }
    return v;
  };
  const v = cmp();
  if (i < toks.length) throw new Error("syntax");
  return v;
}

/** The text a field shows, or (for fields we don't evaluate) its stored result. */
export function fieldResult(instr: string, ctx: FieldContext, stored = ""): string {
  return fieldValue(instr, ctx) ?? stored;
}

/** The text a field shows, or null when we don't evaluate this kind of field. */
export function fieldValue(rawInstr: string, ctx: FieldContext): string | null {
  const instr = resolveNested(rawInstr, ctx);
  const kind = fieldKind(instr);
  const datePic = switchArg(instr, "@");
  const numPic = switchArg(instr, "#");
  const date = (d: Date | null | undefined, def: string) => (d ? formatDate(d, datePic || def) : formatDate(new Date(0), datePic || def));
  let v: string;
  switch (kind) {
    case "DATE":
      v = formatDate(ctx.now, datePic || "M/d/yyyy");
      break;
    case "TIME":
      v = formatDate(ctx.now, datePic || "h:mm am/pm");
      break;
    case "CREATEDATE":
      v = date(ctx.created ?? ctx.now, "M/d/yyyy h:mm:ss am/pm");
      break;
    case "SAVEDATE":
      v = date(ctx.saved ?? ctx.now, "M/d/yyyy h:mm:ss am/pm");
      break;
    case "PRINTDATE":
      v = date(ctx.now, "M/d/yyyy h:mm:ss am/pm");
      break;
    case "FILENAME":
      v = ctx.filename || "Document";
      if (!/\\p/.test(instr) && !/\.\w+$/.test(v)) v += ".docx";
      break;
    case "AUTHOR":
      v = ctx.author || "";
      break;
    case "USERNAME":
      v = ctx.user || ctx.author || "";
      break;
    case "TITLE":
      v = ctx.title || "";
      break;
    case "SUBJECT":
      v = ctx.subject || "";
      break;
    case "NUMPAGES":
      v = String(ctx.pages ?? 1);
      break;
    case "SECTIONPAGES":
      v = String(ctx.sectionPages ?? ctx.pages ?? 1);
      break;
    case "PAGE":
      v = String(ctx.page ?? 1);
      break;
    case "NUMWORDS":
      v = String(ctx.words ?? 0);
      break;
    case "NUMCHARS":
      v = String(ctx.chars ?? 0);
      break;
    case "=": {
      const expr = instr.trim().slice(1).replace(/\\[#*@]\s+(?:"[^"]*"|\S+)/g, "").trim();
      try {
        const n = evalFormula(expr, ctx.table, ctx.bookmark);
        v = numPic ? formatNumber(n, numPic) : Number.isInteger(n) ? String(n) : String(Math.round(n * 1e10) / 1e10);
      } catch {
        v = "!Syntax Error";
      }
      return textSwitch(v, instr);
    }
    case "DOCPROPERTY":
    case "INFO": {
      const a = fieldArgs(instr);
      v = property(a[1] || "", ctx) ?? (kind === "DOCPROPERTY" ? "Error! Unknown document property name." : "");
      break;
    }
    case "KEYWORDS":
    case "COMMENTS":
    case "LASTSAVEDBY":
    case "TEMPLATE":
    case "REVNUM":
      v = property(kind === "REVNUM" ? "revisionnumber" : kind, ctx) ?? "";
      if (kind === "TEMPLATE" && !v) v = "Normal.dotm";
      break;
    case "SECTION":
      v = String(ctx.section ?? 1);
      break;
    case "QUOTE":
      v = fieldArgs(instr).slice(1).filter((x) => !x.startsWith("\\")).join(" ");
      break;
    case "SYMBOL": {
      const code = fieldArgs(instr)[1] || "";
      const n = /^0x/i.test(code) ? parseInt(code, 16) : Number(code);
      v = Number.isFinite(n) && n > 0 ? String.fromCodePoint(n >= 0xf000 && n <= 0xf0ff ? n - 0xf000 : n) : "";
      break;
    }
    case "IF":
    case "COMPARE": {
      const a = fieldArgs(instr.replace(/\\\*\s+\w+|\\#\s+(?:"[^"]*"|\S+)|\\@\s+(?:"[^"]*"|\S+)/g, ""));
      // IF a op b "then" "else"; an operand may be a bookmark name
      const operand = (x: string) => (x === undefined ? "" : (ctx.sets?.[x] ?? ctx.bookmark?.(x) ?? x));
      const ops = ["=", "<>", "<", ">", "<=", ">="];
      let i = 1;
      let left = a[i++] ?? "";
      let op = a[i++] ?? "=";
      // "a=b" written without spaces
      const glued = /^(.*?)(<>|<=|>=|=|<|>)(.*)$/.exec(left);
      if (!ops.includes(op) && glued) {
        left = glued[1];
        i--;
        op = glued[2];
        a.splice(i, 0, glued[3]);
      }
      const right = a[i++] ?? "";
      const yes = compareValues(operand(left), op, operand(right));
      if (kind === "COMPARE") v = yes ? "1" : "0";
      else v = (yes ? a[i] : a[i + 1]) ?? "";
      break;
    }
    case "STYLEREF": {
      const a = fieldArgs(instr);
      v = ctx.styleRef?.(a[1] || "", /\\l\b/.test(instr)) ?? "Error! No text of specified style in document.";
      break;
    }
    case "NOTEREF":
      v = ctx.noteRef?.(fieldArgs(instr)[1] || "") ?? "Error! Reference source not found.";
      break;
    case "SET":
      // SET name "value" shows nothing; REF and IF read the value
      v = "";
      break;
    case "FILLIN":
    case "ASK": {
      // asked when merged in Word; here the default answer
      if (kind === "ASK") return "";
      const d = /\\d\s+(?:"([^"]*)"|(\S+))/.exec(instr);
      if (!d) return null;
      v = d[1] ?? d[2];
      break;
    }
    default:
      return null;
  }
  if (numPic && /^-?\d+(\.\d+)?$/.test(v)) v = formatNumber(Number(v), numPic);
  return textSwitch(v, instr);
}

/** Common fields for the Insert > Field dialog, with an example instruction each. */
export const FIELD_CHOICES: { kind: FieldKind; label: string; instr: string; formats?: string[] }[] = [
  { kind: "DATE", label: "Date", instr: 'DATE \\@ "MMMM d, yyyy"', formats: ["M/d/yyyy", "dddd, MMMM d, yyyy", "MMMM d, yyyy", "d MMMM yyyy", "yyyy-MM-dd", "MMM. d, yy", "dd/MM/yyyy"] },
  { kind: "TIME", label: "Time", instr: 'TIME \\@ "h:mm am/pm"', formats: ["h:mm am/pm", "h:mm:ss am/pm", "HH:mm", "HH:mm:ss"] },
  { kind: "CREATEDATE", label: "Create date", instr: 'CREATEDATE \\@ "M/d/yyyy"' },
  { kind: "SAVEDATE", label: "Save date", instr: 'SAVEDATE \\@ "M/d/yyyy"' },
  { kind: "FILENAME", label: "File name", instr: "FILENAME" },
  { kind: "AUTHOR", label: "Author", instr: "AUTHOR" },
  { kind: "TITLE", label: "Title", instr: "TITLE" },
  { kind: "USERNAME", label: "User name", instr: "USERNAME" },
  { kind: "PAGE", label: "Page number", instr: "PAGE" },
  { kind: "NUMPAGES", label: "Number of pages", instr: "NUMPAGES" },
  { kind: "NUMWORDS", label: "Number of words", instr: "NUMWORDS" },
  { kind: "NUMCHARS", label: "Number of characters", instr: "NUMCHARS" },
  { kind: "=", label: "Formula", instr: "=SUM(ABOVE)" },
  { kind: "DOCPROPERTY", label: "Document property", instr: "DOCPROPERTY Company" },
  { kind: "IF", label: "If…then…else", instr: 'IF 1 = 1 "Yes" "No"' },
  { kind: "COMPARE", label: "Compare", instr: "COMPARE 1 = 1" },
  { kind: "SUBJECT", label: "Subject", instr: "SUBJECT" },
  { kind: "KEYWORDS", label: "Keywords", instr: "KEYWORDS" },
  { kind: "COMMENTS", label: "Comments", instr: "COMMENTS" },
  { kind: "LASTSAVEDBY", label: "Last saved by", instr: "LASTSAVEDBY" },
  { kind: "SECTION", label: "Section number", instr: "SECTION" },
  { kind: "SECTIONPAGES", label: "Pages in section", instr: "SECTIONPAGES" },
  { kind: "STYLEREF", label: "Style reference", instr: 'STYLEREF "Heading 1"' },
  { kind: "QUOTE", label: "Quote", instr: 'QUOTE "Text"' },
  { kind: "SYMBOL", label: "Symbol", instr: "SYMBOL 169" },
  { kind: "SET", label: "Set bookmark", instr: 'SET Name "Value"' },
  { kind: "FILLIN", label: "Fill-in", instr: 'FILLIN "Prompt" \\d "Default"' },
];
