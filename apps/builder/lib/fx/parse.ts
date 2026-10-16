/**
 * Builder formulas: a parser for the subset of Power Fx that apps are written in. Formulas are
 * parsed here and run by evaluate.ts; nothing is ever passed to eval or new Function, so a
 * formula can only do what the functions in functions.ts allow.
 *
 * Precedence, lowest first: `;` chains, Or / ||, And / &&, comparisons (= <> < <= > >= in
 * exactin), `&`, + -, * /, ^, unary Not ! -, then member access `.` and calls `f(...)`.
 */

export type Node =
  | { k: "num"; v: number; at: number }
  | { k: "str"; v: string; at: number }
  | { k: "bool"; v: boolean; at: number }
  | { k: "name"; name: string; at: number }
  | { k: "member"; obj: Node; name: string; at: number }
  | { k: "call"; name: string; args: Node[]; at: number }
  | { k: "bin"; op: BinOp; l: Node; r: Node; at: number }
  | { k: "un"; op: "-" | "not"; e: Node; at: number }
  | { k: "rec"; fields: [string, Node][]; at: number }
  | { k: "table"; items: Node[]; at: number }
  | { k: "chain"; items: Node[]; at: number };

export type BinOp = "+" | "-" | "*" | "/" | "^" | "&" | "=" | "<>" | "<" | "<=" | ">" | ">=" | "and" | "or" | "in" | "exactin";

export class FxSyntaxError extends Error {
  constructor(message: string, public at: number) {
    super(message);
  }
}

type Tok =
  | { t: "num"; v: number; at: number }
  | { t: "str"; v: string; at: number }
  | { t: "id"; v: string; quoted: boolean; at: number }
  | { t: "op"; v: string; at: number }
  | { t: "end"; at: number };

const OPS = ["<>", "<=", ">=", "&&", "||", "=", "<", ">", "+", "-", "*", "/", "^", "&", "(", ")", "{", "}", "[", "]", ",", ";", ":", ".", "!"];

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    // Comments: // to the end of the line, /* ... */
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) throw new FxSyntaxError("A comment isn't closed with */", i);
      i = end + 2;
      continue;
    }
    const at = i;
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i))!;
      out.push({ t: "num", v: Number(m[0]), at });
      i += m[0].length;
      continue;
    }
    if (c === '"') {
      // Text in double quotes; "" inside is one quote.
      let s = "";
      i++;
      for (;;) {
        if (i >= src.length) throw new FxSyntaxError("Text isn't closed with a double quote", at);
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            s += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        s += src[i++];
      }
      out.push({ t: "str", v: s, at });
      continue;
    }
    if (c === "'") {
      // A name with spaces in single quotes: 'Order Date'. '' inside is one quote.
      let s = "";
      i++;
      for (;;) {
        if (i >= src.length) throw new FxSyntaxError("A quoted name isn't closed with a single quote", at);
        if (src[i] === "'") {
          if (src[i + 1] === "'") {
            s += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        s += src[i++];
      }
      out.push({ t: "id", v: s, quoted: true, at });
      continue;
    }
    if (/[A-Za-z_À-￿]/.test(c)) {
      const m = /^[A-Za-z_À-￿][A-Za-z0-9_À-￿]*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0], quoted: false, at });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new FxSyntaxError(`Unexpected character "${c}"`, i);
    out.push({ t: "op", v: op, at });
    i += op.length;
  }
  out.push({ t: "end", at: src.length });
  return out;
}

class Parser {
  i = 0;
  constructor(private toks: Tok[]) {}

  peek(): Tok {
    return this.toks[this.i];
  }
  next(): Tok {
    return this.toks[this.i++];
  }
  isOp(v: string): boolean {
    const t = this.peek();
    return t.t === "op" && t.v === v;
  }
  /** A bare word such as And, Or, Not, in (case-insensitive, unquoted). */
  isWord(w: string): boolean {
    const t = this.peek();
    return t.t === "id" && !t.quoted && t.v.toLowerCase() === w;
  }
  expect(v: string): void {
    const t = this.next();
    if (t.t !== "op" || t.v !== v) throw new FxSyntaxError(`Expected "${v}"`, t.at);
  }

  chain(): Node {
    const at = this.peek().at;
    const items = [this.or()];
    while (this.isOp(";")) {
      this.next();
      // A trailing ; is allowed, as in Power Apps.
      if (this.peek().t === "end" || this.isOp(")")) break;
      items.push(this.or());
    }
    return items.length === 1 ? items[0] : { k: "chain", items, at };
  }

  or(): Node {
    let l = this.and();
    while (this.isOp("||") || this.isWord("or")) {
      const at = this.next().at;
      l = { k: "bin", op: "or", l, r: this.and(), at };
    }
    return l;
  }

  and(): Node {
    let l = this.cmp();
    while (this.isOp("&&") || this.isWord("and")) {
      const at = this.next().at;
      l = { k: "bin", op: "and", l, r: this.cmp(), at };
    }
    return l;
  }

  cmp(): Node {
    let l = this.concat();
    for (;;) {
      const t = this.peek();
      let op: BinOp | null = null;
      if (t.t === "op" && ["=", "<>", "<", "<=", ">", ">="].includes(t.v)) op = t.v as BinOp;
      else if (this.isWord("in")) op = "in";
      else if (this.isWord("exactin")) op = "exactin";
      if (!op) return l;
      this.next();
      l = { k: "bin", op, l, r: this.concat(), at: t.at };
    }
  }

  concat(): Node {
    let l = this.add();
    while (this.isOp("&")) {
      const at = this.next().at;
      l = { k: "bin", op: "&", l, r: this.add(), at };
    }
    return l;
  }

  add(): Node {
    let l = this.mul();
    while (this.isOp("+") || this.isOp("-")) {
      const t = this.next() as { v: string; at: number };
      l = { k: "bin", op: t.v as BinOp, l, r: this.mul(), at: t.at };
    }
    return l;
  }

  mul(): Node {
    let l = this.pow();
    while (this.isOp("*") || this.isOp("/")) {
      const t = this.next() as { v: string; at: number };
      l = { k: "bin", op: t.v as BinOp, l, r: this.pow(), at: t.at };
    }
    return l;
  }

  pow(): Node {
    const l = this.unary();
    if (this.isOp("^")) {
      const at = this.next().at;
      return { k: "bin", op: "^", l, r: this.pow(), at };
    }
    return l;
  }

  unary(): Node {
    const t = this.peek();
    if (this.isOp("-")) {
      this.next();
      return { k: "un", op: "-", e: this.unary(), at: t.at };
    }
    if (this.isOp("+")) {
      this.next();
      return this.unary();
    }
    if (this.isOp("!")) {
      this.next();
      return { k: "un", op: "not", e: this.unary(), at: t.at };
    }
    // Not x (but Not(x) is the function, which means the same).
    if (this.isWord("not") && !(this.toks[this.i + 1].t === "op" && (this.toks[this.i + 1] as { v: string }).v === "(")) {
      this.next();
      return { k: "un", op: "not", e: this.unary(), at: t.at };
    }
    return this.postfix();
  }

  postfix(): Node {
    let e = this.primary();
    while (this.isOp(".")) {
      this.next();
      const t = this.next();
      if (t.t !== "id") throw new FxSyntaxError("Expected a name after the dot", t.at);
      e = { k: "member", obj: e, name: t.v, at: t.at };
    }
    return e;
  }

  args(): Node[] {
    this.expect("(");
    const out: Node[] = [];
    if (this.isOp(")")) {
      this.next();
      return out;
    }
    for (;;) {
      out.push(this.chain());
      if (this.isOp(",")) {
        this.next();
        continue;
      }
      this.expect(")");
      return out;
    }
  }

  primary(): Node {
    const t = this.next();
    switch (t.t) {
      case "num":
        return { k: "num", v: t.v, at: t.at };
      case "str":
        return { k: "str", v: t.v, at: t.at };
      case "id": {
        if (!t.quoted && this.isOp("(")) return { k: "call", name: t.v, args: this.args(), at: t.at };
        if (!t.quoted && (t.v === "true" || t.v === "false")) return { k: "bool", v: t.v === "true", at: t.at };
        return { k: "name", name: t.v, at: t.at };
      }
      case "op":
        if (t.v === "(") {
          const e = this.chain();
          this.expect(")");
          return e;
        }
        if (t.v === "{") {
          const fields: [string, Node][] = [];
          if (this.isOp("}")) {
            this.next();
            return { k: "rec", fields, at: t.at };
          }
          for (;;) {
            const key = this.next();
            if (key.t !== "id" && key.t !== "str") throw new FxSyntaxError("Expected a field name", key.at);
            this.expect(":");
            fields.push([String(key.v), this.or()]);
            if (this.isOp(",")) {
              this.next();
              continue;
            }
            this.expect("}");
            return { k: "rec", fields, at: t.at };
          }
        }
        if (t.v === "[") {
          const items: Node[] = [];
          if (this.isOp("]")) {
            this.next();
            return { k: "table", items, at: t.at };
          }
          for (;;) {
            items.push(this.or());
            if (this.isOp(",")) {
              this.next();
              continue;
            }
            this.expect("]");
            return { k: "table", items, at: t.at };
          }
        }
        throw new FxSyntaxError(`Unexpected "${t.v}"`, t.at);
      case "end":
        throw new FxSyntaxError("The formula ends too soon", t.at);
    }
  }
}

/** Parses a formula. An empty formula is Blank(). Throws FxSyntaxError with the position. */
export function parse(src: string): Node {
  if (!src.trim()) return { k: "call", name: "Blank", args: [], at: 0 };
  const p = new Parser(tokenize(src));
  const node = p.chain();
  const t = p.peek();
  if (t.t !== "end") throw new FxSyntaxError(`Unexpected ${t.t === "op" ? `"${t.v}"` : "text"} here`, t.at);
  return node;
}

const cache = new Map<string, Node | FxSyntaxError>();

/** parse() with a small cache, since the same formulas run on every render. */
export function parseCached(src: string): Node {
  let hit = cache.get(src);
  if (!hit) {
    try {
      hit = parse(src);
    } catch (e) {
      if (!(e instanceof FxSyntaxError)) throw e;
      hit = e;
    }
    if (cache.size > 5000) cache.clear();
    cache.set(src, hit);
  }
  if (hit instanceof FxSyntaxError) throw hit;
  return hit;
}

/** Every name a formula refers to (not function names); the studio uses it to rename controls. */
export function namesIn(node: Node, out = new Set<string>()): Set<string> {
  switch (node.k) {
    case "name":
      out.add(node.name);
      break;
    case "member":
      namesIn(node.obj, out);
      break;
    case "call":
      node.args.forEach((a) => namesIn(a, out));
      break;
    case "bin":
      namesIn(node.l, out);
      namesIn(node.r, out);
      break;
    case "un":
      namesIn(node.e, out);
      break;
    case "rec":
      node.fields.forEach(([, v]) => namesIn(v, out));
      break;
    case "table":
    case "chain":
      node.items.forEach((a) => namesIn(a, out));
      break;
  }
  return out;
}

/**
 * Variables and collections a formula creates: Set(x, ...), UpdateContext({y: ...}),
 * Collect(Z, ...). Power Fx knows these before anything runs, so reading x before it is set
 * gives Blank instead of an unknown-name error.
 */
export function declaredIn(node: Node, out = { globals: new Set<string>(), contexts: new Set<string>(), collections: new Set<string>() }) {
  const walk = (n: Node) => {
    if (n.k === "call") {
      const fn = n.name.toLowerCase();
      const first = n.args[0];
      if (fn === "set" && first?.k === "name") out.globals.add(first.name);
      if ((fn === "collect" || fn === "clearcollect" || fn === "clear") && first?.k === "name") out.collections.add(first.name);
      if (fn === "updatecontext" && first?.k === "rec") for (const [k] of first.fields) out.contexts.add(k);
      if (fn === "navigate" && n.args[2]?.k === "rec") for (const [k] of (n.args[2] as Extract<Node, { k: "rec" }>).fields) out.contexts.add(k);
      n.args.forEach(walk);
    } else if (n.k === "member") walk(n.obj);
    else if (n.k === "bin") {
      walk(n.l);
      walk(n.r);
    } else if (n.k === "un") walk(n.e);
    else if (n.k === "rec") n.fields.forEach(([, v]) => walk(v));
    else if (n.k === "table" || n.k === "chain") n.items.forEach(walk);
  };
  walk(node);
  return out;
}
