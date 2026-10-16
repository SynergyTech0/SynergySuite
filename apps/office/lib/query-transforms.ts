// Get data's applied steps, in the manner of Power Query's editor: each step
// takes the table the last one made (column names and rows) and makes a new
// one. They are kept with the query, so Refresh runs them again on the new
// data. They are our own steps, not Power Query's M language: Excel keeps M
// in a binary package (DataMashup) we don't write, so in .xlsx the steps ride
// along in the connection's extension list and Excel sees the loaded data.

export type Cell = string | number | boolean | null;
export type Table = { names: string[]; rows: Cell[][] };

export type FilterOp = "=" | "<>" | ">" | ">=" | "<" | "<=" | "contains" | "not contains" | "begins with" | "ends with" | "is empty" | "is not empty";
export type Aggregate = "sum" | "count" | "average" | "min" | "max" | "count distinct";
export type Transform =
  | { kind: "filter"; column: string; op: FilterOp; value?: string }
  | { kind: "sort"; column: string; descending?: boolean }
  | { kind: "rename"; column: string; to: string }
  | { kind: "remove"; column: string }
  | { kind: "type"; column: string; to: "number" | "text" | "date" | "logical" }
  | { kind: "replace"; column: string; find: string; with: string }
  | { kind: "text"; column: string; op: "trim" | "upper" | "lower" | "proper" }
  | { kind: "split"; column: string; delimiter: string }
  | { kind: "merge"; columns: string[]; separator: string; as: string }
  | { kind: "custom"; as: string; expression: string }
  | { kind: "fill down"; column: string }
  | { kind: "distinct"; columns?: string[] }
  | { kind: "top"; count: number }
  | { kind: "group"; by: string[]; column?: string; aggregate: Aggregate; as: string }
  | { kind: "unpivot"; keep: string[] };

const idx = (t: Table, name: string) => {
  const i = t.names.findIndex((n) => n.toLowerCase() === name.toLowerCase());
  if (i < 0) throw new Error(`There is no column "${name}" at this step.`);
  return i;
};
const isBlank = (v: Cell) => v === null || v === "";
const num = (v: Cell): number | null => {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v == null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
};
const text = (v: Cell) => (v == null ? "" : String(v));
const compare = (a: Cell, b: Cell) => {
  if (isBlank(a) && isBlank(b)) return 0;
  if (isBlank(a)) return 1; // blanks last, as Power Query puts nulls
  if (isBlank(b)) return -1;
  const x = num(a);
  const y = num(b);
  if (x != null && y != null) return x - y;
  return text(a).localeCompare(text(b), undefined, { sensitivity: "base", numeric: true });
};
const unique = (names: string[], name: string) => {
  let out = name || "Column";
  for (let k = 2; names.some((n) => n.toLowerCase() === out.toLowerCase()); k++) out = `${name}.${k}`;
  return out;
};

function test(v: Cell, op: FilterOp, value = ""): boolean {
  const s = text(v).toLowerCase();
  const w = value.toLowerCase();
  switch (op) {
    case "is empty":
      return isBlank(v);
    case "is not empty":
      return !isBlank(v);
    case "contains":
      return s.includes(w);
    case "not contains":
      return !s.includes(w);
    case "begins with":
      return s.startsWith(w);
    case "ends with":
      return s.endsWith(w);
  }
  const c = compare(v, value === "" ? null : value);
  if (op === "=") return num(v) != null && num(value) != null ? num(v) === num(value) : s === w;
  if (op === "<>") return num(v) != null && num(value) != null ? num(v) !== num(value) : s !== w;
  if (isBlank(v)) return false;
  return op === ">" ? c > 0 : op === ">=" ? c >= 0 : op === "<" ? c < 0 : c <= 0;
}

const proper = (s: string) => s.toLowerCase().replace(/(^|[^\p{L}\p{N}'])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

function toType(v: Cell, to: "number" | "text" | "date" | "logical"): Cell {
  if (isBlank(v)) return null;
  if (to === "text") return text(v);
  if (to === "number") return num(v);
  if (to === "logical") {
    if (typeof v === "boolean") return v;
    const s = text(v).trim().toLowerCase();
    return s === "true" || s === "yes" || s === "1" ? true : s === "false" || s === "no" || s === "0" ? false : null;
  }
  // A date as the ISO day (the sheet shows it as a date).
  if (typeof v === "number") return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  const d = new Date(text(v));
  return Number.isNaN(d.getTime()) ? null : new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
}

// ---- Custom columns: a small, safe formula language ----
// [Column] references, numbers, "text", + - * / & and comparisons,
// parentheses, and a few functions (IF, ROUND, UPPER, LOWER, LEN, LEFT,
// RIGHT, TRIM, ABS, CONCAT). Nothing is passed to eval.
type Tok = { t: "num" | "str" | "col" | "id" | "op" | "(" | ")" | ","; v: string };
function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "[") {
      const j = src.indexOf("]", i);
      if (j < 0) throw new Error("A column name is missing its ].");
      out.push({ t: "col", v: src.slice(i + 1, j) });
      i = j + 1;
    } else if (c === '"') {
      let s = "";
      i++;
      while (i < src.length && !(src[i] === '"' && src[i + 1] !== '"')) {
        if (src[i] === '"') i++;
        s += src[i++];
      }
      if (i >= src.length) throw new Error("Some text is missing its closing quote.");
      i++;
      out.push({ t: "str", v: s });
    } else if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?/.exec(src.slice(i))![0];
      out.push({ t: "num", v: m });
      i += m.length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i))![0];
      out.push({ t: "id", v: m.toUpperCase() });
      i += m.length;
    } else if ("()".includes(c)) {
      out.push({ t: c as "(" | ")", v: c });
      i++;
    } else if (c === ",") {
      out.push({ t: ",", v: c });
      i++;
    } else {
      const m = /^(<>|<=|>=|[-+*/&=<>^])/.exec(src.slice(i))?.[0];
      if (!m) throw new Error(`"${c}" can't be used in a custom column.`);
      out.push({ t: "op", v: m });
      i += m.length;
    }
  }
  return out;
}
type Node = { k: "lit"; v: Cell } | { k: "col"; name: string } | { k: "bin"; op: string; a: Node; b: Node } | { k: "neg"; a: Node } | { k: "fn"; name: string; args: Node[] };
const LEVELS = [["=", "<>", "<", "<=", ">", ">="], ["&"], ["+", "-"], ["*", "/"], ["^"]];
function parse(src: string): Node {
  const toks = lex(src);
  let p = 0;
  const peek = () => toks[p];
  const level = (n: number): Node => {
    if (n === LEVELS.length) return unary();
    let a = level(n + 1);
    while (peek()?.t === "op" && LEVELS[n].includes(peek().v)) {
      const op = toks[p++].v;
      a = { k: "bin", op, a, b: level(n + 1) };
    }
    return a;
  };
  const unary = (): Node => {
    if (peek()?.t === "op" && (peek().v === "-" || peek().v === "+")) return toks[p++].v === "-" ? { k: "neg", a: unary() } : unary();
    return atom();
  };
  const atom = (): Node => {
    const t = toks[p++];
    if (!t) throw new Error("The formula ends too soon.");
    if (t.t === "num") return { k: "lit", v: Number(t.v) };
    if (t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "col") return { k: "col", name: t.v };
    if (t.t === "(") {
      const e = level(0);
      if (toks[p++]?.t !== ")") throw new Error("A ( is missing its ).");
      return e;
    }
    if (t.t === "id") {
      if (t.v === "TRUE" || t.v === "FALSE") return { k: "lit", v: t.v === "TRUE" };
      if (t.v === "NULL") return { k: "lit", v: null };
      if (!FUNCS[t.v]) throw new Error(`${t.v} isn't a function custom columns know.`);
      if (toks[p++]?.t !== "(") throw new Error(`${t.v} needs (…).`);
      const args: Node[] = [];
      if (peek()?.t !== ")") {
        args.push(level(0));
        while (peek()?.t === ",") {
          p++;
          args.push(level(0));
        }
      }
      if (toks[p++]?.t !== ")") throw new Error(`${t.v}( is missing its ).`);
      return { k: "fn", name: t.v, args };
    }
    throw new Error(`Unexpected "${t.v}".`);
  };
  const e = level(0);
  if (p < toks.length) throw new Error(`Unexpected "${toks[p].v}".`);
  return e;
}
const FUNCS: Record<string, (a: Cell[]) => Cell> = {
  IF: (a) => (a[0] && a[0] !== "" && a[0] !== 0 ? (a[1] ?? null) : (a[2] ?? null)),
  ROUND: (a) => {
    const f = 10 ** (num(a[1]) || 0);
    const n = num(a[0]);
    return n == null ? null : Math.round(n * f) / f;
  },
  ABS: (a) => (num(a[0]) == null ? null : Math.abs(num(a[0])!)),
  UPPER: (a) => text(a[0]).toUpperCase(),
  LOWER: (a) => text(a[0]).toLowerCase(),
  TRIM: (a) => text(a[0]).trim(),
  LEN: (a) => text(a[0]).length,
  LEFT: (a) => text(a[0]).slice(0, num(a[1]) ?? 1),
  RIGHT: (a) => {
    const s = text(a[0]);
    return s.slice(Math.max(0, s.length - (num(a[1]) ?? 1)));
  },
  CONCAT: (a) => a.map(text).join(""),
};
function evalNode(n: Node, row: (name: string) => Cell): Cell {
  if (n.k === "lit") return n.v;
  if (n.k === "col") return row(n.name);
  if (n.k === "neg") {
    const v = num(evalNode(n.a, row));
    return v == null ? null : -v;
  }
  if (n.k === "fn") return FUNCS[n.name](n.args.map((a) => evalNode(a, row)));
  const a = evalNode(n.a, row);
  const b = evalNode(n.b, row);
  if (n.op === "&") return text(a) + text(b);
  if (["=", "<>", "<", "<=", ">", ">="].includes(n.op)) {
    const c = compare(a, b);
    return n.op === "=" ? c === 0 : n.op === "<>" ? c !== 0 : n.op === "<" ? c < 0 : n.op === "<=" ? c <= 0 : n.op === ">" ? c > 0 : c >= 0;
  }
  const x = num(a);
  const y = num(b);
  if (x == null || y == null) return null; // null in, null out, as in Power Query
  if (n.op === "+") return x + y;
  if (n.op === "-") return x - y;
  if (n.op === "*") return x * y;
  if (n.op === "^") return x ** y;
  return y === 0 ? null : x / y;
}
/** Checks a custom column's formula; returns the problem, or null. */
export function checkExpression(expression: string, names: string[]): string | null {
  try {
    const walk = (n: Node): void => {
      if (n.k === "col" && !names.some((x) => x.toLowerCase() === n.name.toLowerCase())) throw new Error(`There is no column "${n.name}" at this step.`);
      if (n.k === "bin") (walk(n.a), walk(n.b));
      if (n.k === "neg") walk(n.a);
      if (n.k === "fn") n.args.forEach(walk);
    };
    walk(parse(expression));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

function aggregate(values: Cell[], how: Aggregate): Cell {
  if (how === "count") return values.length;
  if (how === "count distinct") return new Set(values.map((v) => text(v).toLowerCase())).size;
  const nums = values.map(num).filter((n): n is number => n != null);
  if (!nums.length) return null;
  if (how === "sum") return nums.reduce((s, n) => s + n, 0);
  if (how === "average") return nums.reduce((s, n) => s + n, 0) / nums.length;
  return how === "min" ? Math.min(...nums) : Math.max(...nums);
}

/** One step. */
export function applyTransform(t: Table, x: Transform): Table {
  switch (x.kind) {
    case "filter": {
      const i = idx(t, x.column);
      return { names: t.names, rows: t.rows.filter((r) => test(r[i], x.op, x.value)) };
    }
    case "sort": {
      const i = idx(t, x.column);
      return { names: t.names, rows: [...t.rows].sort((a, b) => compare(a[i], b[i]) * (x.descending && !isBlank(a[i]) && !isBlank(b[i]) ? -1 : 1)) };
    }
    case "rename": {
      const i = idx(t, x.column);
      const to = x.to.trim();
      if (!to) throw new Error("A column needs a name.");
      if (t.names.some((n, j) => j !== i && n.toLowerCase() === to.toLowerCase())) throw new Error(`There is already a column "${to}".`);
      return { names: t.names.map((n, j) => (j === i ? to : n)), rows: t.rows };
    }
    case "remove": {
      const i = idx(t, x.column);
      return { names: t.names.filter((_, j) => j !== i), rows: t.rows.map((r) => r.filter((_, j) => j !== i)) };
    }
    case "type": {
      const i = idx(t, x.column);
      return { names: t.names, rows: t.rows.map((r) => r.map((v, j) => (j === i ? toType(v, x.to) : v))) };
    }
    case "replace": {
      const i = idx(t, x.column);
      return {
        names: t.names,
        rows: t.rows.map((r) =>
          r.map((v, j) => {
            if (j !== i) return v;
            if (x.find === "") return isBlank(v) ? (x.with === "" ? null : x.with) : v;
            if (typeof v === "string") return v.split(x.find).join(x.with);
            return text(v) === x.find ? (num(x.with) ?? x.with) : v;
          }),
        ),
      };
    }
    case "text": {
      const i = idx(t, x.column);
      const f = { trim: (s: string) => s.trim(), upper: (s: string) => s.toUpperCase(), lower: (s: string) => s.toLowerCase(), proper }[x.op];
      return { names: t.names, rows: t.rows.map((r) => r.map((v, j) => (j === i && typeof v === "string" ? f(v) : v))) };
    }
    case "split": {
      const i = idx(t, x.column);
      if (!x.delimiter) throw new Error("Split needs a delimiter.");
      const parts = t.rows.map((r) => (isBlank(r[i]) ? [] : text(r[i]).split(x.delimiter)));
      const n = Math.max(1, ...parts.map((p) => p.length));
      const added: string[] = [];
      const names = t.names.filter((_, j) => j !== i);
      for (let k = 1; k <= n; k++) added.push(unique([...names, ...added], `${t.names[i]}.${k}`));
      return {
        names: [...t.names.slice(0, i), ...added, ...t.names.slice(i + 1)],
        rows: t.rows.map((r, ri) => [...r.slice(0, i), ...added.map((_, k) => (parts[ri][k] == null ? null : typedText(parts[ri][k]))), ...r.slice(i + 1)]),
      };
    }
    case "merge": {
      const is = x.columns.map((c) => idx(t, c));
      if (is.length < 2) throw new Error("Merge needs two columns or more.");
      const keep = t.names.map((_, j) => j).filter((j) => !is.includes(j));
      const at = Math.min(...is);
      const before = keep.filter((j) => j < at);
      const after = keep.filter((j) => j > at);
      const name = unique(keep.map((j) => t.names[j]), x.as || "Merged");
      return {
        names: [...before.map((j) => t.names[j]), name, ...after.map((j) => t.names[j])],
        rows: t.rows.map((r) => [...before.map((j) => r[j]), is.map((j) => text(r[j])).join(x.separator), ...after.map((j) => r[j])]),
      };
    }
    case "custom": {
      const tree = parse(x.expression);
      const name = unique(t.names, x.as || "Custom");
      return { names: [...t.names, name], rows: t.rows.map((r) => [...r, evalNode(tree, (c) => r[idx(t, c)] ?? null)]) };
    }
    case "fill down": {
      const i = idx(t, x.column);
      let last: Cell = null;
      return {
        names: t.names,
        rows: t.rows.map((r) => {
          if (!isBlank(r[i])) last = r[i];
          return r.map((v, j) => (j === i && isBlank(v) ? last : v));
        }),
      };
    }
    case "distinct": {
      const is = x.columns?.length ? x.columns.map((c) => idx(t, c)) : t.names.map((_, j) => j);
      const seen = new Set<string>();
      return {
        names: t.names,
        rows: t.rows.filter((r) => {
          const key = JSON.stringify(is.map((j) => text(r[j]).toLowerCase()));
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      };
    }
    case "top":
      return { names: t.names, rows: t.rows.slice(0, Math.max(0, Math.floor(x.count))) };
    case "group": {
      const by = x.by.map((c) => idx(t, c));
      const of = x.aggregate === "count" ? -1 : idx(t, x.column || "");
      const groups = new Map<string, { key: Cell[]; values: Cell[] }>();
      for (const r of t.rows) {
        const key = by.map((j) => r[j]);
        const k = JSON.stringify(key.map((v) => text(v).toLowerCase()));
        const g = groups.get(k) || groups.set(k, { key, values: [] }).get(k)!;
        g.values.push(of < 0 ? 1 : r[of]);
      }
      const names = by.map((j) => t.names[j]);
      return { names: [...names, unique(names, x.as || "Count")], rows: [...groups.values()].map((g) => [...g.key, aggregate(g.values, x.aggregate)]) };
    }
    case "unpivot": {
      const keep = x.keep.map((c) => idx(t, c));
      const others = t.names.map((_, j) => j).filter((j) => !keep.includes(j));
      const names = keep.map((j) => t.names[j]);
      const rows: Cell[][] = [];
      for (const r of t.rows) for (const j of others) if (!isBlank(r[j])) rows.push([...keep.map((k) => r[k]), t.names[j], r[j]]);
      return { names: [...names, unique(names, "Attribute"), unique([...names, "Attribute"], "Value")], rows };
    }
  }
}

const typedText = (s: string): Cell => {
  const v = s.trim();
  if (v !== "" && /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(v)) return Number(v);
  return s;
};

/** Runs the steps on a grid (with its header row when `headers`); the result keeps the same shape. */
export function applyTransforms(grid: Cell[][], headers: boolean, steps: Transform[] | undefined): Cell[][] {
  if (!steps?.length) return grid;
  const width = Math.max(0, ...grid.map((r) => r.length));
  let t: Table = headers
    ? { names: (grid[0] || []).map((v, j) => text(v) || `Column${j + 1}`), rows: grid.slice(1) }
    : { names: Array.from({ length: width }, (_, j) => `Column${j + 1}`), rows: grid };
  steps.forEach((s, n) => {
    try {
      t = applyTransform(t, s);
    } catch (e) {
      throw new Error(`Step ${n + 1} (${describeTransform(s)}): ${(e as Error).message}`);
    }
  });
  return headers ? [t.names, ...t.rows] : t.rows;
}

/** The step as a line in the Applied steps list. */
export function describeTransform(x: Transform): string {
  switch (x.kind) {
    case "filter":
      return `Filter ${x.column} ${x.op}${x.op.startsWith("is ") ? "" : ` "${x.value ?? ""}"`}`;
    case "sort":
      return `Sort by ${x.column}${x.descending ? " (descending)" : ""}`;
    case "rename":
      return `Rename ${x.column} to ${x.to}`;
    case "remove":
      return `Remove ${x.column}`;
    case "type":
      return `Change ${x.column} to ${x.to}`;
    case "replace":
      return `Replace "${x.find}" with "${x.with}" in ${x.column}`;
    case "text":
      return `${{ trim: "Trim", upper: "Uppercase", lower: "Lowercase", proper: "Capitalize each word" }[x.op]} ${x.column}`;
    case "split":
      return `Split ${x.column} by "${x.delimiter}"`;
    case "merge":
      return `Merge ${x.columns.join(", ")} into ${x.as}`;
    case "custom":
      return `Add ${x.as} = ${x.expression}`;
    case "fill down":
      return `Fill down ${x.column}`;
    case "distinct":
      return x.columns?.length ? `Remove duplicates of ${x.columns.join(", ")}` : "Remove duplicate rows";
    case "top":
      return `Keep the first ${x.count} rows`;
    case "group":
      return `Group by ${x.by.join(", ")}: ${x.as} = ${x.aggregate}${x.aggregate === "count" ? "" : ` of ${x.column}`}`;
    case "unpivot":
      return `Unpivot all but ${x.keep.join(", ")}`;
  }
}
