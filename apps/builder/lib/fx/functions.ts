/**
 * The functions formulas can call, named and behaving as in Power Fx. Most take their
 * arguments evaluated (`eager`); the ones that go through a table (Filter, Sort, ForAll ...) or
 * choose what to evaluate (If, Switch, And ...) take them as formulas and evaluate them with
 * each record in scope.
 *
 * Behavior functions (Navigate, Set, Patch, SubmitForm ...) check they are in a behavior
 * formula; the ones that wait on the network yield their promise to the caller (evaluate.ts).
 */
import type { Ctx, Gen, NotifyKind, Transition } from "./evaluate";
import type { Node } from "./parse";
import {
  asRec,
  asTable,
  compare,
  copyRec,
  equals,
  field,
  formatDate,
  formatNumber,
  FxError,
  FxObject,
  isBlank,
  isRec,
  numberText,
  rowOf,
  sourceOf,
  toBool,
  toDate,
  toNumber,
  toText,
  type Rec,
  type Value,
} from "./values";

type Ev = (n: Node, ctx: Ctx) => Gen;
export type Fn = (args: Node[], ctx: Ctx, call: Extract<Node, { k: "call" }>) => Gen;

const DAY = 86_400_000;

function arity(name: string, args: Node[], min: number, max = min) {
  if (args.length < min || args.length > max) {
    const want = min === max ? `${min}` : max === Infinity ? `at least ${min}` : `${min} to ${max}`;
    throw new FxError(`${name} takes ${want} argument${want === "1" ? "" : "s"}`);
  }
}

function needBehavior(ctx: Ctx, name: string) {
  if (!ctx.behavior) throw new FxError(`${name} can only be used in a behavior property such as OnSelect`);
}

function hostFn<K extends keyof Ctx["host"]>(ctx: Ctx, key: K, name: string): NonNullable<Ctx["host"][K]> {
  needBehavior(ctx, name);
  const f = ctx.host[key];
  if (!f) throw new FxError(`${name} isn't available here`);
  return (f as Function).bind(ctx.host) as NonNullable<Ctx["host"][K]>;
}

/** The name an argument refers to, unevaluated (Set(x, ...), Collect(MyList, ...)). */
function nameArg(n: Node, fn: string): string {
  if (n.k === "name") return n.name;
  throw new FxError(`${fn} needs a name here`);
}

const clampInt = (n: number) => Math.trunc(n);

function roundTo(n: number, digits: number, mode: "round" | "up" | "down"): number {
  const f = Math.pow(10, clampInt(digits));
  const x = n * f;
  // Away from zero for .5 and for RoundUp; toward zero for RoundDown, like Excel.
  const r = mode === "round" ? Math.sign(x) * Math.round(Math.abs(x) + 1e-9) : mode === "up" ? Math.sign(x) * Math.ceil(Math.abs(x) - 1e-9) : Math.sign(x) * Math.floor(Math.abs(x) + 1e-9);
  return r / f;
}

function addUnits(d: Date, n: number, unit: string): Date {
  const out = new Date(d.getTime());
  switch (unit.toLowerCase()) {
    case "milliseconds":
      return new Date(d.getTime() + n);
    case "seconds":
      return new Date(d.getTime() + n * 1000);
    case "minutes":
      return new Date(d.getTime() + n * 60_000);
    case "hours":
      return new Date(d.getTime() + n * 3_600_000);
    case "days":
      out.setDate(out.getDate() + n);
      return out;
    case "weeks":
      out.setDate(out.getDate() + 7 * n);
      return out;
    case "months":
      out.setMonth(out.getMonth() + n);
      return out;
    case "quarters":
      out.setMonth(out.getMonth() + 3 * n);
      return out;
    case "years":
      out.setFullYear(out.getFullYear() + n);
      return out;
  }
  throw new FxError(`Unknown time unit ${unit}`);
}

function diffUnits(a: Date, b: Date, unit: string): number {
  const ms = b.getTime() - a.getTime();
  switch (unit.toLowerCase()) {
    case "milliseconds":
      return ms;
    case "seconds":
      return Math.trunc(ms / 1000);
    case "minutes":
      return Math.trunc(ms / 60_000);
    case "hours":
      return Math.trunc(ms / 3_600_000);
    case "days": {
      // Calendar days, so a daylight-saving change doesn't lose one.
      const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
      const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
      return Math.round((db - da) / DAY);
    }
    case "weeks":
      return Math.trunc(diffUnits(a, b, "days") / 7);
    case "months":
      return (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
    case "quarters":
      return Math.trunc(diffUnits(a, b, "months") / 3);
    case "years":
      return b.getFullYear() - a.getFullYear();
  }
  throw new FxError(`Unknown time unit ${unit}`);
}

function hexToRgb(c: string): [number, number, number, number] | null {
  let m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16), 1];
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), m[2] ? parseInt(m[2], 16) / 255 : 1];
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(c);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  return null;
}

const rgba = (r: number, g: number, b: number, a: number) =>
  `rgba(${Math.round(Math.min(255, Math.max(0, r)))}, ${Math.round(Math.min(255, Math.max(0, g)))}, ${Math.round(Math.min(255, Math.max(0, b)))}, ${Math.min(1, Math.max(0, a))})`;

export function makeFunctions(ev: Ev): Record<string, Fn> {
  /** A function whose arguments are all evaluated first. */
  const eager =
    (name: string, min: number, max: number, fn: (v: Value[], ctx: Ctx) => Value): Fn =>
    function* (args, ctx) {
      arity(name, args, min, max);
      const vals: Value[] = [];
      for (const a of args) vals.push(yield* ev(a, ctx));
      return fn(vals, ctx);
    };

  /** Evaluates `n` once per record of `table`, with the record in scope. */
  function* perRow(table: Rec[], n: Node, ctx: Ctx, each: (row: Rec, v: Value) => boolean | void): Generator<Promise<unknown>, void, unknown> {
    for (const row of table) {
      ctx.scopes.push(row);
      let v: Value;
      try {
        v = yield* ev(n, ctx);
      } finally {
        ctx.scopes.pop();
      }
      if (each(row, v) === false) return;
    }
  }

  function* tableArg(n: Node, ctx: Ctx, fn: string): Generator<Promise<unknown>, Rec[], unknown> {
    const v = yield* ev(n, ctx);
    return asTable(v, `a table as ${fn}'s first argument`);
  }

  /** Sum/Average/Min/Max: (table, formula) or (number, number, ...). */
  const aggregate =
    (name: string, combine: (nums: number[]) => Value): Fn =>
    function* (args, ctx) {
      arity(name, args, 1, Infinity);
      const first = yield* ev(args[0], ctx);
      const nums: number[] = [];
      if (Array.isArray(first) && args.length === 2) {
        yield* perRow(first as Rec[], args[1], ctx, (_r, v) => {
          if (!isBlank(v)) nums.push(toNumber(v));
        });
      } else {
        if (!isBlank(first)) nums.push(toNumber(first));
        for (const a of args.slice(1)) {
          const v = yield* ev(a, ctx);
          if (!isBlank(v)) nums.push(toNumber(v));
        }
      }
      return combine(nums);
    };

  const text1 = (name: string, f: (s: string) => Value): Fn => eager(name, 1, 1, ([s]) => f(toText(s)));
  const num1 = (name: string, f: (n: number) => Value): Fn => eager(name, 1, 1, ([n]) => (isBlank(n) ? null : f(toNumber(n))));
  const datePart = (name: string, f: (d: Date) => number): Fn =>
    eager(name, 1, 1, ([d]) => {
      const date = toDate(d);
      return date ? f(date) : null;
    });

  /** The source name a Patch/Remove/Collect target table carries. */
  const target = (t: Value, fn: string): string => {
    const s = sourceOf(t);
    if (!s) throw new FxError(`${fn} needs a data source or collection as its first argument`);
    return s;
  };

  const sortBy = (rows: Rec[], keys: { get: (r: Rec) => Value; desc: boolean }[]): Rec[] =>
    rows
      .map((r, i) => ({ r, i }))
      .sort((a, b) => {
        for (const k of keys) {
          const c = compare(k.get(a.r), k.get(b.r));
          if (c) return k.desc ? -c : c;
        }
        return a.i - b.i;
      })
      .map((x) => x.r);

  const isDesc = (v: Value) => {
    const s = toText(v).toLowerCase();
    if (s !== "ascending" && s !== "descending" && s !== "") throw new FxError(`Sort order must be SortOrder.Ascending or SortOrder.Descending`);
    return s === "descending";
  };

  const F: Record<string, Fn> = {
    // ---- Logic ----------------------------------------------------------------
    *if(args, ctx) {
      arity("If", args, 2, Infinity);
      let i = 0;
      for (; i + 1 < args.length; i += 2) {
        if (toBool(yield* ev(args[i], ctx))) return yield* ev(args[i + 1], ctx);
      }
      return i < args.length ? yield* ev(args[i], ctx) : null;
    },
    *switch(args, ctx) {
      arity("Switch", args, 3, Infinity);
      const v = yield* ev(args[0], ctx);
      let i = 1;
      for (; i + 1 < args.length; i += 2) {
        if (equals(v, yield* ev(args[i], ctx))) return yield* ev(args[i + 1], ctx);
      }
      return i < args.length ? yield* ev(args[i], ctx) : null;
    },
    *and(args, ctx) {
      for (const a of args) if (!toBool(yield* ev(a, ctx))) return false;
      return true;
    },
    *or(args, ctx) {
      for (const a of args) if (toBool(yield* ev(a, ctx))) return true;
      return false;
    },
    not: eager("Not", 1, 1, ([v]) => !toBool(v)),
    *coalesce(args, ctx) {
      for (const a of args) {
        const v = yield* ev(a, ctx);
        if (!isBlank(v)) return v;
      }
      return null;
    },
    *iferror(args, ctx) {
      arity("IfError", args, 2, Infinity);
      try {
        return yield* ev(args[0], ctx);
      } catch (e) {
        if (!(e instanceof FxError)) throw e;
        return yield* ev(args[1], ctx);
      }
    },
    blank: eager("Blank", 0, 0, () => null),
    isblank: eager("IsBlank", 1, 1, ([v]) => isBlank(v)),
    isempty: eager("IsEmpty", 1, 1, ([v]) => asTable(v).length === 0),
    isnumeric: eager("IsNumeric", 1, 1, ([v]) => {
      if (typeof v === "number") return true;
      if (typeof v !== "string" || !v.trim()) return false;
      return Number.isFinite(Number(v));
    }),
    istoday: eager("IsToday", 1, 1, ([v]) => {
      const d = toDate(v);
      const now = new Date();
      return !!d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    }),
    *with(args, ctx) {
      arity("With", args, 2);
      const r = asRec(yield* ev(args[0], ctx)) ?? {};
      ctx.scopes.push(r);
      try {
        return yield* ev(args[1], ctx);
      } finally {
        ctx.scopes.pop();
      }
    },

    // ---- Text -----------------------------------------------------------------
    concatenate: eager("Concatenate", 1, Infinity, (v) => v.map(toText).join("")),
    len: text1("Len", (s) => s.length),
    upper: text1("Upper", (s) => s.toUpperCase()),
    lower: text1("Lower", (s) => s.toLowerCase()),
    proper: text1("Proper", (s) => s.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase())),
    trim: text1("Trim", (s) => s.trim().replace(/\s+/g, " ")),
    trimends: text1("TrimEnds", (s) => s.trim()),
    left: eager("Left", 2, 2, ([s, n]) => toText(s).slice(0, Math.max(0, clampInt(toNumber(n))))),
    right: eager("Right", 2, 2, ([s, n]) => {
      const k = Math.max(0, clampInt(toNumber(n)));
      return k ? toText(s).slice(-k) : "";
    }),
    mid: eager("Mid", 2, 3, ([s, start, n]) => {
      const st = clampInt(toNumber(start));
      if (st < 1) throw new FxError("Mid's start must be 1 or more");
      const t = toText(s);
      return n === undefined ? t.slice(st - 1) : t.slice(st - 1, st - 1 + Math.max(0, clampInt(toNumber(n))));
    }),
    text: eager("Text", 1, 2, ([v, fmt]) => {
      if (isBlank(v)) return "";
      if (fmt === undefined || isBlank(fmt)) return toText(v);
      const f = toText(fmt).replace(/^\[\$-[^\]]*\]/, "");
      if (v instanceof Date) return formatDate(v, f);
      if (typeof v === "number") return formatNumber(v, f);
      if (typeof v === "string") {
        const n = Number(v);
        if (v.trim() && Number.isFinite(n) && /[0#]/.test(f)) return formatNumber(n, f);
        if (/^\d{4}-\d{2}-\d{2}/.test(v)) return formatDate(toDate(v)!, f);
      }
      return toText(v);
    }),
    value: eager("Value", 1, 1, ([v]) => {
      if (isBlank(v)) return null;
      const s = toText(v).trim();
      const pct = s.endsWith("%");
      const n = Number(s.replace(/[$€£,\s%]/g, ""));
      if (!Number.isFinite(n)) throw new FxError(`"${s}" isn't a number`);
      return pct ? n / 100 : n;
    }),
    startswith: eager("StartsWith", 2, 2, ([s, p]) => toText(s).toLowerCase().startsWith(toText(p).toLowerCase())),
    endswith: eager("EndsWith", 2, 2, ([s, p]) => toText(s).toLowerCase().endsWith(toText(p).toLowerCase())),
    find: eager("Find", 2, 3, ([find, within, start]) => {
      const i = toText(within).indexOf(toText(find), start === undefined ? 0 : clampInt(toNumber(start)) - 1);
      return i < 0 ? null : i + 1;
    }),
    substitute: eager("Substitute", 3, 4, ([s, old, rep, inst]) => {
      const t = toText(s);
      const o = toText(old);
      if (!o) return t;
      if (inst === undefined) return t.split(o).join(toText(rep));
      let n = clampInt(toNumber(inst));
      let i = -1;
      while (n-- > 0) {
        i = t.indexOf(o, i + 1);
        if (i < 0) return t;
      }
      return t.slice(0, i) + toText(rep) + t.slice(i + o.length);
    }),
    replace: eager("Replace", 4, 4, ([s, start, n, rep]) => {
      const t = toText(s);
      const st = clampInt(toNumber(start)) - 1;
      return t.slice(0, st) + toText(rep) + t.slice(st + clampInt(toNumber(n)));
    }),
    char: eager("Char", 1, 1, ([n]) => String.fromCharCode(clampInt(toNumber(n)))),
    split: eager("Split", 2, 2, ([s, sep]) => {
      const t = toText(s);
      const p = toText(sep);
      return (p ? t.split(p) : [...t]).map((x) => ({ Value: x }));
    }),
    *concat(args, ctx) {
      arity("Concat", args, 2, 3);
      const t = yield* tableArg(args[0], ctx, "Concat");
      const parts: string[] = [];
      yield* perRow(t, args[1], ctx, (_r, v) => {
        parts.push(toText(v));
      });
      const sep = args[2] ? toText(yield* ev(args[2], ctx)) : "";
      return parts.join(sep);
    },
    ismatch: eager("IsMatch", 2, 3, ([s, pattern, opts]) => {
      const src = toText(pattern);
      const presets: Record<string, string> = { email: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", digit: "^\\d+$", letter: "^\\p{L}+$" };
      let re: RegExp;
      try {
        re = new RegExp(presets[src.toLowerCase()] ?? `^(?:${src})$`, `u${/ignorecase/i.test(opts === undefined ? "" : toText(opts)) ? "i" : ""}`);
      } catch {
        throw new FxError("IsMatch's pattern isn't a valid regular expression");
      }
      return re.test(toText(s));
    }),
    guid: eager("GUID", 0, 1, ([s]) => (s === undefined ? crypto.randomUUID() : toText(s))),

    // ---- Math -----------------------------------------------------------------
    sum: aggregate("Sum", (n) => n.reduce((a, b) => a + b, 0)),
    average: aggregate("Average", (n) => (n.length ? n.reduce((a, b) => a + b, 0) / n.length : null)),
    min: aggregate("Min", (n) => (n.length ? Math.min(...n) : null)),
    max: aggregate("Max", (n) => (n.length ? Math.max(...n) : null)),
    round: eager("Round", 2, 2, ([n, d]) => roundTo(toNumber(n), toNumber(d), "round")),
    roundup: eager("RoundUp", 2, 2, ([n, d]) => roundTo(toNumber(n), toNumber(d), "up")),
    rounddown: eager("RoundDown", 2, 2, ([n, d]) => roundTo(toNumber(n), toNumber(d), "down")),
    abs: num1("Abs", Math.abs),
    int: num1("Int", Math.floor),
    trunc: num1("Trunc", Math.trunc),
    sqrt: num1("Sqrt", (n) => {
      if (n < 0) throw new FxError("Sqrt of a negative number");
      return Math.sqrt(n);
    }),
    power: eager("Power", 2, 2, ([a, b]) => Math.pow(toNumber(a), toNumber(b))),
    mod: eager("Mod", 2, 2, ([a, b]) => {
      const d = toNumber(b);
      if (d === 0) throw new FxError("Division by zero");
      const n = toNumber(a);
      return n - d * Math.floor(n / d);
    }),
    rand: eager("Rand", 0, 0, () => Math.random()),
    randbetween: eager("RandBetween", 2, 2, ([a, b]) => {
      const lo = Math.ceil(toNumber(a));
      const hi = Math.floor(toNumber(b));
      return lo + Math.floor(Math.random() * (hi - lo + 1));
    }),
    pi: eager("Pi", 0, 0, () => Math.PI),

    // ---- Tables ---------------------------------------------------------------
    countrows: eager("CountRows", 1, 1, ([t]) => asTable(t).length),
    *countif(args, ctx) {
      arity("CountIf", args, 2, Infinity);
      const t = yield* tableArg(args[0], ctx, "CountIf");
      let n = 0;
      for (const row of t) {
        ctx.scopes.push(row);
        try {
          let ok = true;
          for (const c of args.slice(1)) if (!toBool(yield* ev(c, ctx))) ok = false;
          if (ok) n++;
        } finally {
          ctx.scopes.pop();
        }
      }
      return n;
    },
    *filter(args, ctx) {
      arity("Filter", args, 2, Infinity);
      const t = yield* tableArg(args[0], ctx, "Filter");
      const out: Rec[] = [];
      for (const row of t) {
        ctx.scopes.push(row);
        try {
          let ok = true;
          for (const c of args.slice(1)) {
            if (!toBool(yield* ev(c, ctx))) {
              ok = false;
              break;
            }
          }
          if (ok) out.push(row);
        } finally {
          ctx.scopes.pop();
        }
      }
      return out;
    },
    *lookup(args, ctx) {
      arity("LookUp", args, 2, 3);
      const t = yield* tableArg(args[0], ctx, "LookUp");
      for (const row of t) {
        ctx.scopes.push(row);
        try {
          if (toBool(yield* ev(args[1], ctx))) return args[2] ? yield* ev(args[2], ctx) : row;
        } finally {
          ctx.scopes.pop();
        }
      }
      return null;
    },
    search: eager("Search", 3, Infinity, ([t, text, ...cols]) => {
      const rows = asTable(t);
      const q = toText(text).toLowerCase();
      if (!q) return rows;
      const names = cols.map(toText);
      return rows.filter((r) =>
        names.some((c) => {
          const v = field(r, c);
          if (v === undefined) throw new FxError(`There's no column called ${c}`);
          try {
            return toText(v).toLowerCase().includes(q);
          } catch {
            return false;
          }
        }),
      );
    }),
    sortbycolumns: eager("SortByColumns", 2, Infinity, ([t, ...rest]) => {
      const keys: { get: (r: Rec) => Value; desc: boolean }[] = [];
      for (let i = 0; i < rest.length; i++) {
        const col = toText(rest[i]);
        const next = rest[i + 1];
        const desc = typeof next === "string" && /^(ascending|descending)$/i.test(next) ? (i++, isDesc(next)) : false;
        keys.push({ get: (r) => field(r, col) ?? null, desc });
      }
      return sortBy(asTable(t), keys);
    }),
    *sort(args, ctx) {
      arity("Sort", args, 2, 3);
      const t = yield* tableArg(args[0], ctx, "Sort");
      const desc = args[2] ? isDesc(yield* ev(args[2], ctx)) : false;
      const vals = new Map<Rec, Value>();
      yield* perRow(t, args[1], ctx, (r, v) => {
        vals.set(r, v);
      });
      return sortBy(t, [{ get: (r) => vals.get(r) ?? null, desc }]);
    },
    first: eager("First", 1, 1, ([t]) => asTable(t)[0] ?? null),
    last: eager("Last", 1, 1, ([t]) => {
      const r = asTable(t);
      return r[r.length - 1] ?? null;
    }),
    firstn: eager("FirstN", 1, 2, ([t, n]) => asTable(t).slice(0, n === undefined ? 1 : Math.max(0, clampInt(toNumber(n))))),
    lastn: eager("LastN", 1, 2, ([t, n]) => {
      const k = n === undefined ? 1 : Math.max(0, clampInt(toNumber(n)));
      return k ? asTable(t).slice(-k) : [];
    }),
    index: eager("Index", 2, 2, ([t, n]) => {
      const rows = asTable(t);
      const i = clampInt(toNumber(n));
      if (i < 1 || i > rows.length) throw new FxError(`Index ${i} is outside the table (it has ${rows.length} records)`);
      return rows[i - 1];
    }),
    *distinct(args, ctx) {
      arity("Distinct", args, 2);
      const t = yield* tableArg(args[0], ctx, "Distinct");
      const out: Value[] = [];
      yield* perRow(t, args[1], ctx, (_r, v) => {
        if (!out.some((x) => equals(x, v))) out.push(v);
      });
      return out.map((v) => ({ Value: v }));
    },
    *addcolumns(args, ctx) {
      arity("AddColumns", args, 3, Infinity);
      if (args.length % 2 === 0) throw new FxError("AddColumns takes a table, then pairs of column name and formula");
      const t = yield* tableArg(args[0], ctx, "AddColumns");
      const out: Rec[] = [];
      for (const row of t) {
        const extra: Rec = {};
        ctx.scopes.push(row);
        try {
          for (let i = 1; i < args.length; i += 2) {
            const name = args[i].k === "name" ? (args[i] as { name: string }).name : toText(yield* ev(args[i], ctx));
            extra[name] = yield* ev(args[i + 1], ctx);
          }
        } finally {
          ctx.scopes.pop();
        }
        out.push(copyRec(row, extra));
      }
      return out;
    },
    *dropcolumns(args, ctx) {
      arity("DropColumns", args, 2, Infinity);
      const t = yield* tableArg(args[0], ctx, "DropColumns");
      const names = args.slice(1).map((a) => (a.k === "name" ? a.name : a.k === "str" ? a.v : ""));
      return t.map((r) => {
        const out = copyRec(r);
        for (const n of names) for (const k of Object.keys(out)) if (k.toLowerCase() === n.toLowerCase()) delete out[k];
        return out;
      });
    },
    *showcolumns(args, ctx) {
      arity("ShowColumns", args, 2, Infinity);
      const t = yield* tableArg(args[0], ctx, "ShowColumns");
      const names = args.slice(1).map((a) => (a.k === "name" ? a.name : a.k === "str" ? a.v : ""));
      return t.map((r) => {
        const out: Rec = {};
        for (const n of names) {
          const v = field(r, n);
          if (v === undefined) throw new FxError(`There's no column called ${n}`);
          out[n] = v;
        }
        return out;
      });
    },
    *renamecolumns(args, ctx) {
      arity("RenameColumns", args, 3, Infinity);
      const t = yield* tableArg(args[0], ctx, "RenameColumns");
      const pairs: [string, string][] = [];
      for (let i = 1; i + 1 < args.length; i += 2) {
        const a = args[i];
        const b = args[i + 1];
        pairs.push([a.k === "name" ? a.name : a.k === "str" ? a.v : "", b.k === "name" ? b.name : b.k === "str" ? b.v : ""]);
      }
      return t.map((r) => {
        const out = copyRec(r);
        for (const [from, to] of pairs) {
          if (from in out) {
            out[to] = out[from];
            delete out[from];
          }
        }
        return out;
      });
    },
    *forall(args, ctx) {
      arity("ForAll", args, 2);
      const t = yield* tableArg(args[0], ctx, "ForAll");
      const out: Rec[] = [];
      yield* perRow(t, args[1], ctx, (_r, v) => {
        out.push(isRec(v) ? v : { Value: v });
      });
      return out;
    },
    table: eager("Table", 0, Infinity, (v) => v.map((r) => asRec(r, "records in Table") ?? {})),
    sequence: eager("Sequence", 1, 3, ([n, start, step]) => {
      const count = Math.min(50_000, Math.max(0, clampInt(toNumber(n))));
      const s = start === undefined ? 1 : toNumber(start);
      const d = step === undefined ? 1 : toNumber(step);
      return Array.from({ length: count }, (_, i) => ({ Value: s + i * d }));
    }),
    *defaults(args, ctx) {
      arity("Defaults", args, 1);
      const src = target(yield* ev(args[0], ctx), "Defaults");
      return ctx.host.defaults?.(src) ?? {};
    },

    // ---- Dates ----------------------------------------------------------------
    now: eager("Now", 0, 0, () => new Date()),
    today: eager("Today", 0, 0, () => {
      const d = new Date();
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }),
    date: eager("Date", 3, 3, ([y, m, d]) => new Date(toNumber(y), toNumber(m) - 1, toNumber(d))),
    datetime: eager("DateTime", 5, 6, ([y, mo, d, h, mi, s]) => new Date(toNumber(y), toNumber(mo) - 1, toNumber(d), toNumber(h), toNumber(mi), s === undefined ? 0 : toNumber(s))),
    datevalue: eager("DateValue", 1, 2, ([s]) => {
      const d = toDate(s);
      return d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()) : null;
    }),
    datetimevalue: eager("DateTimeValue", 1, 2, ([s]) => toDate(s)),
    dateadd: eager("DateAdd", 2, 3, ([d, n, unit]) => {
      const date = toDate(d);
      return date ? addUnits(date, toNumber(n), unit === undefined ? "Days" : toText(unit)) : null;
    }),
    datediff: eager("DateDiff", 2, 3, ([a, b, unit]) => {
      const da = toDate(a);
      const db = toDate(b);
      return da && db ? diffUnits(da, db, unit === undefined ? "Days" : toText(unit)) : null;
    }),
    year: datePart("Year", (d) => d.getFullYear()),
    month: datePart("Month", (d) => d.getMonth() + 1),
    day: datePart("Day", (d) => d.getDate()),
    hour: datePart("Hour", (d) => d.getHours()),
    minute: datePart("Minute", (d) => d.getMinutes()),
    second: datePart("Second", (d) => d.getSeconds()),
    weekday: datePart("Weekday", (d) => d.getDay() + 1),

    // ---- Colors ---------------------------------------------------------------
    rgba: eager("RGBA", 4, 4, ([r, g, b, a]) => rgba(toNumber(r), toNumber(g), toNumber(b), toNumber(a))),
    colorvalue: eager("ColorValue", 1, 1, ([s]) => {
      const t = toText(s).trim();
      if (!hexToRgb(t) && !/^[a-z]+$/i.test(t)) throw new FxError(`"${t}" isn't a color`);
      return t;
    }),
    colorfade: eager("ColorFade", 2, 2, ([c, p]) => {
      const rgb = hexToRgb(toText(c));
      if (!rgb) return toText(c);
      const f = Math.max(-1, Math.min(1, toNumber(p)));
      const mix = (x: number) => (f >= 0 ? x + (255 - x) * f : x * (1 + f));
      return rgba(mix(rgb[0]), mix(rgb[1]), mix(rgb[2]), rgb[3]);
    }),

    // ---- People ---------------------------------------------------------------
    user: eager("User", 0, 0, (_v, ctx) => ctx.host.user?.() ?? { FullName: "", Email: "" }),

    // ---- Behavior -------------------------------------------------------------
    *navigate(args, ctx) {
      arity("Navigate", args, 1, 3);
      const screen = yield* ev(args[0], ctx);
      const transition = args[1] ? (toText(yield* ev(args[1], ctx)) as Transition) : "None";
      const context = args[2] ? asRec(yield* ev(args[2], ctx)) : null;
      hostFn(ctx, "navigate", "Navigate")(screen, transition || "None", context);
      return true;
    },
    *back(args, ctx) {
      arity("Back", args, 0, 1);
      hostFn(ctx, "back", "Back")();
      return true;
    },
    *set(args, ctx) {
      arity("Set", args, 2);
      const name = nameArg(args[0], "Set");
      const v = yield* ev(args[1], ctx);
      hostFn(ctx, "set", "Set")(name, v);
      return v;
    },
    *updatecontext(args, ctx) {
      arity("UpdateContext", args, 1);
      const r = asRec(yield* ev(args[0], ctx), "a record such as {count: 1}") ?? {};
      hostFn(ctx, "updateContext", "UpdateContext")(r);
      return r;
    },
    *collect(args, ctx) {
      return yield* collect(args, ctx, false, "Collect");
    },
    *clearcollect(args, ctx) {
      return yield* collect(args, ctx, true, "ClearCollect");
    },
    *clear(args, ctx) {
      arity("Clear", args, 1);
      hostFn(ctx, "clear", "Clear")(nameArg(args[0], "Clear"));
      return true;
    },
    *patch(args, ctx) {
      arity("Patch", args, 2, Infinity);
      const patch = hostFn(ctx, "patch", "Patch");
      const src = target(yield* ev(args[0], ctx), "Patch");
      const base = asRec(yield* ev(args[1], ctx));
      const changes: Rec = {};
      for (const a of args.slice(2)) Object.assign(changes, asRec(yield* ev(a, ctx), "a record of changes") ?? {});
      // A base record that isn't a row of the source (Defaults(Source), or a plain record as in
      // Patch(Source, {Title: "x"})) makes a new record from it and the changes.
      if (!base || !rowOf(base)) return (yield patch(src, null, { ...(base ?? {}), ...changes })) as Value;
      return (yield patch(src, base, changes)) as Value;
    },
    *remove(args, ctx) {
      arity("Remove", args, 2, Infinity);
      const remove = hostFn(ctx, "remove", "Remove");
      const src = target(yield* ev(args[0], ctx), "Remove");
      const recs: Rec[] = [];
      for (const a of args.slice(1)) {
        const v = yield* ev(a, ctx);
        if (Array.isArray(v)) recs.push(...(v as Rec[]));
        else if (v !== null) recs.push(asRec(v)!);
      }
      yield remove(src, recs);
      return true;
    },
    *removeif(args, ctx) {
      arity("RemoveIf", args, 2, Infinity);
      const remove = hostFn(ctx, "remove", "RemoveIf");
      const t = yield* ev(args[0], ctx);
      const src = target(t, "RemoveIf");
      const matches: Rec[] = [];
      for (const row of asTable(t)) {
        ctx.scopes.push(row);
        try {
          let ok = true;
          for (const c of args.slice(1)) if (!toBool(yield* ev(c, ctx))) ok = false;
          if (ok) matches.push(row);
        } finally {
          ctx.scopes.pop();
        }
      }
      if (matches.length) yield remove(src, matches);
      return true;
    },
    *refresh(args, ctx) {
      arity("Refresh", args, 1);
      const refresh = hostFn(ctx, "refresh", "Refresh");
      yield refresh(target(yield* ev(args[0], ctx), "Refresh"));
      return true;
    },
    *submitform(args, ctx) {
      return yield* formAction(args, ctx, "submit", "SubmitForm");
    },
    *resetform(args, ctx) {
      return yield* formAction(args, ctx, "reset", "ResetForm");
    },
    *newform(args, ctx) {
      return yield* formAction(args, ctx, "new", "NewForm");
    },
    *editform(args, ctx) {
      return yield* formAction(args, ctx, "edit", "EditForm");
    },
    *viewform(args, ctx) {
      return yield* formAction(args, ctx, "view", "ViewForm");
    },
    *reset(args, ctx) {
      arity("Reset", args, 1);
      const c = yield* ev(args[0], ctx);
      if (!(c instanceof FxObject)) throw new FxError("Reset needs a control");
      hostFn(ctx, "reset", "Reset")(c);
      return true;
    },
    *notify(args, ctx) {
      arity("Notify", args, 1, 3);
      const msg = toText(yield* ev(args[0], ctx));
      const kind = args[1] ? (toText(yield* ev(args[1], ctx)) as NotifyKind) : "Information";
      hostFn(ctx, "notify", "Notify")(msg, kind || "Information");
      return true;
    },
    *launch(args, ctx) {
      arity("Launch", args, 1, Infinity);
      const url = toText(yield* ev(args[0], ctx));
      hostFn(ctx, "launch", "Launch")(url);
      return true;
    },
    *runflow(args, ctx) {
      arity("RunFlow", args, 1, 2);
      const run = hostFn(ctx, "runFlow", "RunFlow");
      const flow = toText(yield* ev(args[0], ctx));
      const inputs = args[1] ? (asRec(yield* ev(args[1], ctx), "a record of inputs") ?? {}) : {};
      return (yield run(flow, inputs)) as Value;
    },
  };

  function* collect(args: Node[], ctx: Ctx, clearFirst: boolean, fn: string): Gen {
    arity(fn, args, 1, Infinity);
    const name = nameArg(args[0], fn);
    const items: Rec[] = [];
    for (const a of args.slice(1)) {
      const v = yield* ev(a, ctx);
      if (Array.isArray(v)) items.push(...(v as Value[]).map((r) => (isRec(r) ? copyRec(r) : { Value: r })));
      else if (isRec(v)) items.push(copyRec(v));
      else if (v !== null) items.push({ Value: v });
    }
    return hostFn(ctx, "collect", fn)(name, items, clearFirst);
  }

  function* formAction(args: Node[], ctx: Ctx, action: "submit" | "reset" | "new" | "edit" | "view", fn: string): Gen {
    arity(fn, args, 1);
    const form = yield* ev(args[0], ctx);
    if (!(form instanceof FxObject) || form.kind !== "form") throw new FxError(`${fn} needs a form control`);
    const r = hostFn(ctx, "form", fn)(action, form);
    if (r) yield r;
    return true;
  }

  return F;
}

export { numberText };
