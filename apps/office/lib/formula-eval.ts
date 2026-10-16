// Formulas > Evaluate Formula: a formula worked out one step at a time, the
// way Excel's dialog shows it. The formula is parsed here; each step works out
// the next innermost part (a reference, an operation or a function) with the
// sheet's own formula engine (the `calc` callback), and the formula is shown
// again with that part replaced by its value. IF and IFERROR only work out
// the branch they take. LET and LAMBDA are worked out whole (their names mean
// nothing outside them).

export type EvalValue =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "error"; value: string }
  | { kind: "array"; value: EvalValue[][] }
  | { kind: "empty" };

type NodeKind = "literal" | "ref" | "name" | "func" | "binary" | "unary" | "percent" | "paren" | "spill";
export type FNode = {
  kind: NodeKind;
  /** Source text: the operator, function name, reference or literal. */
  text: string;
  children: FNode[];
  /** Worked out: its value (shown) and how it is written into a formula. */
  value?: EvalValue;
  literal?: string;
  /** A branch IF or IFERROR does not take. */
  skipped?: boolean;
};

// ---- Tokens ------------------------------------------------------------------------

type Tok = { t: "num" | "str" | "bool" | "err" | "array" | "ref" | "name" | "func" | "op" | "(" | ")" | "," | "%" | "#"; v: string };

const CELL = String.raw`\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?\d+:\$?\d+`;
const SHEET = String.raw`(?:'(?:[^']|'')+'|[A-Za-z_\u00c0-\uffff][\w.\u00c0-\uffff]*(?::[A-Za-z_\u00c0-\uffff][\w.\u00c0-\uffff]*)?)!`;
const REF_RE = new RegExp(String.raw`^(?:\[[^\]]+\])?(?:${SHEET})?(?:${CELL})(?![\w(])`);
const STRUCT_RE = /^[A-Za-z_\u00c0-\uffff][\w.\u00c0-\uffff]*\[(?:[^[\]]|\[[^\]]*\])*\]/;
const ERR_RE = /^#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|GETTING_DATA|SPILL!|CALC!)/i;

export function tokenize(formula: string): Tok[] {
  const src = formula.replace(/^=/, "");
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < src.length && !(src[j] === '"' && src[j + 1] !== '"')) j += src[j] === '"' ? 2 : 1;
      out.push({ t: "str", v: src.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (ch === "{") {
      let j = i + 1;
      let inStr = false;
      while (j < src.length && (inStr || src[j] !== "}")) {
        if (src[j] === '"') inStr = !inStr;
        j++;
      }
      out.push({ t: "array", v: src.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    const err = ERR_RE.exec(rest);
    if (err) {
      out.push({ t: "err", v: err[0].toUpperCase() });
      i += err[0].length;
      continue;
    }
    const ref = REF_RE.exec(rest) || (/^'/.test(rest) ? null : null);
    if (ref) {
      out.push({ t: "ref", v: ref[0] });
      i += ref[0].length;
      continue;
    }
    const st = STRUCT_RE.exec(rest);
    if (st) {
      out.push({ t: "ref", v: st[0] });
      i += st[0].length;
      continue;
    }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (num) {
      out.push({ t: "num", v: num[0] });
      i += num[0].length;
      continue;
    }
    const word = /^[A-Za-z_\u00c0-\uffff][\w.\u00c0-\uffff]*/.exec(rest);
    if (word) {
      const after = src.slice(i + word[0].length).trimStart();
      if (after.startsWith("(")) out.push({ t: "func", v: word[0].toUpperCase() });
      else if (/^(TRUE|FALSE)$/i.test(word[0])) out.push({ t: "bool", v: word[0].toUpperCase() });
      else out.push({ t: "name", v: word[0] });
      i += word[0].length;
      continue;
    }
    const op = /^(?:<>|<=|>=|[-+*/^&=<>])/.exec(rest);
    if (op) {
      out.push({ t: "op", v: op[0] });
      i += op[0].length;
      continue;
    }
    if ("(),%#".includes(ch)) {
      out.push({ t: ch as Tok["t"], v: ch });
      i++;
      continue;
    }
    throw new Error(`Can't read "${rest.slice(0, 12)}"`);
  }
  return out;
}

// ---- Parsing -----------------------------------------------------------------------

const PREC: Record<string, number> = { "=": 1, "<>": 1, "<": 1, ">": 1, "<=": 1, ">=": 1, "&": 2, "+": 3, "-": 3, "*": 4, "/": 4, "^": 5 };

export function parseFormula(formula: string): FNode {
  const toks = tokenize(formula);
  let p = 0;
  const peek = () => toks[p];
  const take = () => toks[p++];
  const expr = (min: number): FNode => {
    let left = unary();
    for (;;) {
      const t = peek();
      if (!t || t.t !== "op" || PREC[t.v] == null || PREC[t.v] < min) return left;
      take();
      // ^ is left-associative in Excel, like the rest.
      const right = expr(PREC[t.v] + 1);
      left = { kind: "binary", text: t.v, children: [left, right] };
    }
  };
  const unary = (): FNode => {
    const t = peek();
    if (t?.t === "op" && (t.v === "-" || t.v === "+")) {
      take();
      return { kind: "unary", text: t.v, children: [unary()] };
    }
    return postfix(primary());
  };
  const postfix = (n: FNode): FNode => {
    let node = n;
    while (peek()?.t === "%" || peek()?.t === "#") {
      const t = take();
      node = t.t === "%" ? { kind: "percent", text: "%", children: [node] } : { kind: "spill", text: `${node.text}#`, children: [] };
    }
    return node;
  };
  const primary = (): FNode => {
    const t = take();
    if (!t) throw new Error("The formula ends too soon");
    switch (t.t) {
      case "num":
        return lit(t.v, { kind: "number", value: Number(t.v) });
      case "str":
        return lit(t.v, { kind: "string", value: t.v.slice(1, -1).replace(/""/g, '"') });
      case "bool":
        return lit(t.v, { kind: "bool", value: t.v === "TRUE" });
      case "err":
        return lit(t.v, { kind: "error", value: t.v });
      case "array":
        return lit(t.v, parseArrayConstant(t.v));
      case "ref":
        return { kind: "ref", text: t.v, children: [] };
      case "name":
        return { kind: "name", text: t.v, children: [] };
      case "(": {
        const inner = expr(0);
        if (take()?.t !== ")") throw new Error("A bracket is missing");
        return { kind: "paren", text: "()", children: [inner] };
      }
      case "func": {
        if (take()?.t !== "(") throw new Error("A bracket is missing");
        const args: FNode[] = [];
        if (peek()?.t === ")") take();
        else
          for (;;) {
            // An empty argument (SUM(A1,,B1)) is a blank.
            if (peek()?.t === "," || peek()?.t === ")") args.push(lit("", { kind: "empty" }));
            else args.push(expr(0));
            const sep = take();
            if (sep?.t === ")") break;
            if (sep?.t !== ",") throw new Error("A comma or bracket is missing");
          }
        return { kind: "func", text: t.v, children: args };
      }
      default:
        throw new Error(`Unexpected "${t.v}"`);
    }
  };
  const node = expr(0);
  if (p < toks.length) throw new Error(`Unexpected "${toks[p].v}"`);
  return node;
}

const lit = (text: string, value: EvalValue): FNode => ({ kind: "literal", text, children: [], value, literal: text });

function parseArrayConstant(text: string): EvalValue {
  const rows = text
    .slice(1, -1)
    .split(";")
    .map((row) =>
      (row.match(/"(?:[^"]|"")*"|[^,]+/g) || []).map((cell): EvalValue => {
        const c = cell.trim();
        if (/^"/.test(c)) return { kind: "string", value: c.slice(1, -1).replace(/""/g, '"') };
        if (/^(TRUE|FALSE)$/i.test(c)) return { kind: "bool", value: /^TRUE$/i.test(c) };
        if (/^#/.test(c)) return { kind: "error", value: c.toUpperCase() };
        return { kind: "number", value: Number(c) };
      }),
    );
  return { kind: "array", value: rows };
}

// ---- Values as text ----------------------------------------------------------------

/** How Excel's dialog shows a value: text in quotes, arrays in braces. */
export function showValue(v: EvalValue): string {
  switch (v.kind) {
    case "number":
      return String(Math.round(v.value * 1e12) / 1e12);
    case "string":
      return `"${v.value.replace(/"/g, '""')}"`;
    case "bool":
      return v.value ? "TRUE" : "FALSE";
    case "error":
      return v.value;
    case "empty":
      return "0";
    case "array": {
      const rows = v.value.slice(0, 20).map((r) => r.slice(0, 20).map(showValue).join(","));
      return `{${rows.join(";")}${v.value.length > 20 ? ";\u2026" : ""}}`;
    }
  }
}

/** A value written into a formula (for working out the part around it). */
function literalOf(v: EvalValue): string {
  if (v.kind === "number") return String(v.value);
  if (v.kind === "empty") return '""';
  if (v.kind === "array") return `{${v.value.map((r) => r.map(literalOf).join(",")).join(";")}}`;
  return showValue(v);
}

// ---- Steps -------------------------------------------------------------------------

const done = (n: FNode): boolean => !!n.value || !!n.skipped;
/** Worked out whole: LET and LAMBDA bind names that mean nothing outside them. */
const WHOLE = new Set(["LET", "LAMBDA"]);

/** The next part to work out, in Excel's order (left to right, innermost first), or null when finished. */
export function nextNode(n: FNode): FNode | null {
  if (done(n)) return null;
  if (n.kind === "func" && WHOLE.has(n.text)) return n;
  if (n.kind === "paren") return nextNode(n.children[0]);
  for (const c of n.children) {
    const x = nextNode(c);
    if (x) return x;
    // IF takes one branch: once its test is known, the other is not worked out.
    if (n.kind === "func" && c === n.children[0] && c.value) skipBranches(n);
  }
  return n;
}

function skipBranches(n: FNode) {
  const test = n.children[0].value!;
  if (n.text === "IF" && n.children.length >= 2) {
    const truthy = test.kind === "bool" ? test.value : test.kind === "number" ? test.value !== 0 : test.kind === "error" ? null : null;
    if (truthy === true && n.children[2]) n.children[2].skipped = true;
    if (truthy === false) n.children[1].skipped = true;
    if (test.kind === "error") n.children.slice(1).forEach((c) => (c.skipped = true));
  }
  if (n.text === "IFERROR" && n.children[1] && test.kind !== "error") n.children[1].skipped = true;
}

/** The expression a node stands for, with worked-out parts as their values (`show`) or literals (to calculate). */
function write(n: FNode, show: boolean, mark?: FNode): string {
  let s: string;
  if (n.value && n.kind !== "literal") s = show ? showValue(n.value) : n.kind === "ref" || n.kind === "name" || n.kind === "spill" ? n.text : n.literal!;
  else if (n.kind === "literal") s = n.text;
  else if (n.kind === "ref" || n.kind === "name" || n.kind === "spill") s = n.text;
  else if (n.kind === "paren") s = `(${write(n.children[0], show, mark)})`;
  else if (n.kind === "unary") s = `${n.text}${write(n.children[0], show, mark)}`;
  else if (n.kind === "percent") s = `${write(n.children[0], show, mark)}%`;
  else if (n.kind === "binary") s = `${write(n.children[0], show, mark)}${n.text}${write(n.children[1], show, mark)}`;
  else s = `${n.text}(${n.children.map((c) => write(c, show, mark)).join(",")})`;
  return mark === n ? `\u0001${s}\u0002` : s;
}

export type EvalStep = {
  /** The formula as it now stands. */
  text: string;
  /** Where the next part to work out is in `text` (start, and end exclusive; underlined in the dialog), or null at the end. */
  next: { start: number; end: number } | null;
  /** The final value, once worked out. */
  result: EvalValue | null;
};

/** Evaluate Formula: one formula, worked out a step at a time. */
export class FormulaStepper {
  root: FNode;
  constructor(
    formula: string,
    private calc: (formula: string) => Promise<EvalValue>,
  ) {
    this.root = parseFormula(formula);
  }
  state(): EvalStep {
    const next = nextNode(this.root);
    const marked = `=${write(this.root, true, next || undefined)}`;
    const start = marked.indexOf("\u0001");
    const end = marked.indexOf("\u0002");
    return {
      text: marked.replace(/[\u0001\u0002]/g, ""),
      next: start >= 0 ? { start, end: end - 1 } : null,
      result: next ? null : (this.root.kind === "paren" ? this.root.children[0].value : this.root.value) || null,
    };
  }
  /** Works out the next part. */
  async step(): Promise<EvalStep> {
    const n = nextNode(this.root);
    if (!n) return this.state();
    const v = await this.calc(`=${write(n, false)}`);
    n.value = v;
    n.literal = n.kind === "ref" || n.kind === "name" || n.kind === "spill" ? n.text : literalOf(v);
    // A bracket around a worked-out part is worked out too.
    const settle = (x: FNode) => {
      for (const c of x.children) settle(c);
      if (x.kind === "paren" && x.children[0].value && !x.value) {
        x.value = x.children[0].value;
        x.literal = `(${x.children[0].literal})`;
      }
    };
    settle(this.root);
    return this.state();
  }
}

/** A value from the formula engine (its value objects) as an EvalValue. */
export function fromEngine(v: any): EvalValue {
  if (v == null) return { kind: "empty" };
  try {
    if (v.isReferenceObject?.()) v = v.toArrayValueObject();
    if (v.isArray?.()) {
      const rows = (v.toValue?.() as unknown[][]) || [];
      if (rows.length === 1 && rows[0].length === 1) return plain(rows[0][0]);
      return { kind: "array", value: rows.map((r) => r.map(plain)) };
    }
    if (v.isError?.()) return { kind: "error", value: String(v.getErrorType?.() ?? v.getValue?.()) };
    if (v.isNull?.()) return { kind: "empty" };
    if (v.isBoolean?.()) return { kind: "bool", value: !!v.getValue() };
    if (v.isNumber?.()) return { kind: "number", value: Number(v.getValue()) };
    if (v.isString?.()) return { kind: "string", value: String(v.getValue()) };
    return plain(v.getValue?.());
  } catch {
    return { kind: "error", value: "#VALUE!" };
  }
}

function plain(x: unknown): EvalValue {
  if (x == null || x === "") return { kind: "empty" };
  if (typeof x === "number") return { kind: "number", value: x };
  if (typeof x === "boolean") return { kind: "bool", value: x };
  const s = String(x);
  if (ERR_RE.test(s) && ERR_RE.exec(s)![0].length === s.length) return { kind: "error", value: s.toUpperCase() };
  return { kind: "string", value: s };
}
