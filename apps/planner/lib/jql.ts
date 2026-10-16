/**
 * A small JQL-style query language: `assignee = me AND status != Done ORDER BY priority DESC`.
 *
 * This file only parses text into an AST — it never touches the database, so it is cheap to test and
 * cannot leak anything. lib/jql-sql.ts turns the AST into a query, always inside the caller's
 * visible boards.
 *
 * Supported: AND / OR / NOT, parentheses, = != ~ !~ > >= < <=, IN / NOT IN, IS EMPTY / IS NOT EMPTY,
 * ORDER BY <field> [ASC|DESC]. Values may be bare words, 'quoted strings', numbers, `me`, `EMPTY`,
 * dates (2026-09-17) or relative days (-7d, 14d).
 */

export const FIELDS = [
  "text", "summary", "description", "key", "board", "status", "statusCategory", "type", "priority",
  "assignee", "reporter", "member", "label", "component", "fixVersion", "sprint", "resolution",
  "due", "created", "updated", "points", "blocked", "custom",
] as const;
export type Field = (typeof FIELDS)[number];

export type Operator = "=" | "!=" | "~" | "!~" | ">" | ">=" | "<" | "<=" | "in" | "not in" | "is empty" | "is not empty";
export type Value = { kind: "string"; value: string } | { kind: "number"; value: number } | { kind: "me" } | { kind: "empty" };

export type Condition = { type: "condition"; field: Field; op: Operator; values: Value[]; custom?: string };
export type Node =
  | Condition
  | { type: "and"; children: Node[] }
  | { type: "or"; children: Node[] }
  | { type: "not"; child: Node };

export type Query = { where: Node | null; orderBy: { field: Field; dir: "asc" | "desc" } | null };
export class JqlError extends Error {}

type Token = { t: "word" | "string" | "number" | "op" | "punct"; v: string; pos: number };

const OPERATOR_CHARS = /^(!=|>=|<=|!~|=|~|>|<)/;

function tokenize(input: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "(" || c === ")" || c === ",") { out.push({ t: "punct", v: c, pos: i }); i++; continue; }
    const op = input.slice(i).match(OPERATOR_CHARS);
    if (op) { out.push({ t: "op", v: op[1], pos: i }); i += op[1].length; continue; }
    if (c === '"' || c === "'") {
      const end = input.indexOf(c, i + 1);
      if (end < 0) throw new JqlError(`Unclosed quote at position ${i}`);
      out.push({ t: "string", v: input.slice(i + 1, end), pos: i });
      i = end + 1;
      continue;
    }
    const word = input.slice(i).match(/^[^\s(),=~<>!'"]+/);
    if (!word) throw new JqlError(`Unexpected character ${c} at position ${i}`);
    const v = word[0];
    out.push({ t: /^-?\d+(\.\d+)?$/.test(v) ? "number" : "word", v, pos: i });
    i += v.length;
  }
  return out;
}

const FIELD_ALIASES: Record<string, Field> = {
  summary: "summary", title: "summary", text: "text", description: "description", desc: "description",
  key: "key", issuekey: "key", board: "board", project: "board", status: "status", list: "status",
  statuscategory: "statusCategory", category: "statusCategory", type: "type", issuetype: "type",
  priority: "priority", assignee: "assignee", reporter: "reporter", member: "member", members: "member",
  label: "label", labels: "label", component: "component", components: "component",
  fixversion: "fixVersion", fixversions: "fixVersion", version: "fixVersion", sprint: "sprint",
  resolution: "resolution", due: "due", duedate: "due", created: "created", updated: "updated",
  points: "points", storypoints: "points", blocked: "blocked",
};

export function parseJql(input: string): Query {
  const tokens = tokenize(input);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const isKeyword = (t: Token | undefined, kw: string) => !!t && t.t === "word" && t.v.toLowerCase() === kw;

  function parseValue(): Value {
    const t = next();
    if (!t) throw new JqlError("Expected a value");
    if (t.t === "number") return { kind: "number", value: Number(t.v) };
    if (t.t === "string") return { kind: "string", value: t.v };
    const lower = t.v.toLowerCase();
    if (lower === "me" || lower === "currentuser()") return { kind: "me" };
    if (lower === "empty" || lower === "null") return { kind: "empty" };
    return { kind: "string", value: t.v };
  }

  function parseCondition(): Node {
    const nameTok = next();
    if (!nameTok || nameTok.t !== "word") throw new JqlError(`Expected a field name at position ${nameTok?.pos ?? 0}`);
    // cf[Team] names a board custom field; everything else is a built-in field or an alias of one.
    const customMatch = nameTok.v.match(/^cf\[(.+)\]$/i);
    const field = customMatch ? ("custom" as Field) : FIELD_ALIASES[nameTok.v.toLowerCase()];
    const customName = customMatch?.[1];
    if (!field) throw new JqlError(`Unknown field "${nameTok.v}". Try: ${FIELDS.slice(0, 8).join(", ")}…`);

    const opTok = next();
    if (!opTok) throw new JqlError(`Expected an operator after ${nameTok.v}`);

    if (opTok.t === "op") {
      const op = opTok.v as Operator;
      return { type: "condition", field, op, values: [parseValue()], custom: customName };
    }
    const kw = opTok.v.toLowerCase();
    if (kw === "in" || kw === "not") {
      let op: Operator = "in";
      if (kw === "not") {
        if (!isKeyword(peek(), "in")) throw new JqlError(`Expected IN after NOT at position ${opTok.pos}`);
        next();
        op = "not in";
      }
      const open = next();
      if (!open || open.v !== "(") throw new JqlError("Expected ( after IN");
      const values: Value[] = [];
      while (peek() && peek().v !== ")") {
        values.push(parseValue());
        if (peek() && peek().v === ",") next();
      }
      if (!peek()) throw new JqlError("Expected ) to close IN");
      next();
      if (!values.length) throw new JqlError("IN needs at least one value");
      return { type: "condition", field, op, values, custom: customName };
    }
    if (kw === "is") {
      let op: Operator = "is empty";
      if (isKeyword(peek(), "not")) { next(); op = "is not empty"; }
      const emptyTok = next();
      if (!emptyTok || !["empty", "null"].includes(emptyTok.v.toLowerCase())) throw new JqlError("Expected EMPTY after IS");
      return { type: "condition", field, op, values: [], custom: customName };
    }
    throw new JqlError(`Unknown operator "${opTok.v}"`);
  }

  function parsePrimary(): Node {
    if (isKeyword(peek(), "not")) { next(); return { type: "not", child: parsePrimary() }; }
    if (peek()?.v === "(") {
      next();
      const inner = parseOr();
      if (peek()?.v !== ")") throw new JqlError("Expected )");
      next();
      return inner;
    }
    return parseCondition();
  }

  function parseAnd(): Node {
    const children = [parsePrimary()];
    while (isKeyword(peek(), "and")) { next(); children.push(parsePrimary()); }
    return children.length === 1 ? children[0] : { type: "and", children };
  }

  function parseOr(): Node {
    const children = [parseAnd()];
    while (isKeyword(peek(), "or")) { next(); children.push(parseAnd()); }
    return children.length === 1 ? children[0] : { type: "or", children };
  }

  let where: Node | null = null;
  if (tokens.length && !isKeyword(peek(), "order")) where = parseOr();

  let orderBy: Query["orderBy"] = null;
  if (isKeyword(peek(), "order")) {
    next();
    if (!isKeyword(peek(), "by")) throw new JqlError("Expected BY after ORDER");
    next();
    const fieldTok = next();
    const field = fieldTok && FIELD_ALIASES[fieldTok.v.toLowerCase()];
    if (!field) throw new JqlError(`Cannot order by "${fieldTok?.v ?? ""}"`);
    let dir: "asc" | "desc" = "asc";
    if (isKeyword(peek(), "asc")) next();
    else if (isKeyword(peek(), "desc")) { next(); dir = "desc"; }
    orderBy = { field, dir };
  }

  if (pos < tokens.length) throw new JqlError(`Unexpected "${tokens[pos].v}" at position ${tokens[pos].pos}`);
  return { where, orderBy };
}

/** Dates in queries: 2026-09-17, or relative days like -7d / 14d (from `now`). */
export function jqlDate(value: Value, now = new Date()): Date | null {
  if (value.kind === "number") return new Date(now.getTime() + value.value * 86400000);
  if (value.kind !== "string") return null;
  const rel = value.value.match(/^(-?\d+)d$/i);
  if (rel) return new Date(now.getTime() + Number(rel[1]) * 86400000);
  if (/^now$/i.test(value.value)) return now;
  const d = new Date(value.value);
  return Number.isNaN(d.getTime()) ? null : d;
}
