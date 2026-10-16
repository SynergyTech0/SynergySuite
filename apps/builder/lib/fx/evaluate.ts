/**
 * Runs parsed formulas. Evaluation is a generator: functions that wait on the network (Patch,
 * SubmitForm, Refresh, RunFlow ...) yield a promise and get its result back. evalData runs a
 * formula that must answer at once (a label's Text, a gallery's Items) and refuses those
 * functions; runBehavior runs an OnSelect-style formula and waits for each step in turn, so
 * `Patch(...); Navigate(...)` only navigates once the save succeeded.
 */
import { makeFunctions } from "./functions";
import { ENUMS } from "./enums";
import { parseCached, type Node } from "./parse";
import {
  compare,
  equals,
  field,
  FxError,
  FxObject,
  isBlank,
  isRec,
  toBool,
  toDate,
  toNumber,
  toText,
  typeName,
  type Rec,
  type Value,
} from "./values";

export type Gen = Generator<Promise<unknown>, Value, unknown>;

export type Transition = "None" | "Fade" | "Cover" | "CoverRight" | "UnCover" | "UnCoverRight";
export type NotifyKind = "Success" | "Error" | "Warning" | "Information";

/**
 * What a formula can reach outside itself. resolve() answers names (controls, screens,
 * variables, collections, data sources); the rest are the behavior functions, which only
 * behavior properties may call.
 */
export interface Host {
  resolve(name: string): Value | undefined;
  navigate?(screen: Value, transition: Transition, context: Rec | null): void;
  back?(): void;
  set?(name: string, value: Value): void;
  updateContext?(values: Rec): void;
  collect?(name: string, items: Rec[], clearFirst: boolean): Rec[];
  clear?(name: string): void;
  patch?(source: string, base: Rec | null, changes: Rec): Promise<Rec>;
  remove?(source: string, records: Rec[]): Promise<void>;
  refresh?(source: string): Promise<void>;
  defaults?(source: string): Rec;
  form?(action: "submit" | "reset" | "new" | "edit" | "view", form: FxObject): Promise<void> | void;
  reset?(control: FxObject): void;
  notify?(message: string, kind: NotifyKind): void;
  launch?(url: string): void;
  runFlow?(flow: string, inputs: Rec): Promise<Value>;
  user?(): Rec;
}

export type Ctx = {
  host: Host;
  /** Records in scope, innermost last: the row inside Filter, With's record ... */
  scopes: Rec[];
  /** Names bound by where the formula sits: ThisItem, Self, Parent. */
  locals: Record<string, Value>;
  behavior: boolean;
};

const FUNCTIONS = makeFunctions(ev);

export function* ev(n: Node, ctx: Ctx): Gen {
  switch (n.k) {
    case "num":
    case "str":
    case "bool":
      return n.v;
    case "name":
      return resolveName(n.name, ctx, n.at);
    case "member": {
      const obj = yield* ev(n.obj, ctx);
      return member(obj, n.name, n.at);
    }
    case "call": {
      const fn = FUNCTIONS[n.name.toLowerCase()];
      if (!fn) throw new FxError(`${n.name} isn't a function Builder knows`, n.at);
      try {
        return yield* fn(n.args, ctx, n);
      } catch (e) {
        if (e instanceof FxError && e.at < 0) e.at = n.at;
        throw e;
      }
    }
    case "un": {
      const v = yield* ev(n.e, ctx);
      return n.op === "-" ? -toNumber(v) : !toBool(v);
    }
    case "bin":
      return yield* binary(n, ctx);
    case "rec": {
      const out: Rec = {};
      for (const [k, v] of n.fields) out[k] = yield* ev(v, ctx);
      return out;
    }
    case "table": {
      const out: Value[] = [];
      for (const item of n.items) {
        const v = yield* ev(item, ctx);
        out.push(isRec(v) ? v : { Value: v });
      }
      return out;
    }
    case "chain": {
      let last: Value = null;
      for (const item of n.items) last = yield* ev(item, ctx);
      return last;
    }
  }
}

function resolveName(name: string, ctx: Ctx, at: number): Value {
  if (name === "ThisRecord") {
    const r = ctx.scopes[ctx.scopes.length - 1];
    if (!r) throw new FxError("ThisRecord only works inside a function that goes through a table, such as Filter", at);
    return r;
  }
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const v = field(ctx.scopes[i], name);
    if (v !== undefined) return v;
  }
  if (name in ctx.locals) return ctx.locals[name];
  const v = ctx.host.resolve(name);
  if (v !== undefined) return v;
  if (name in ENUMS) return ENUMS[name];
  throw new FxError(`Nothing is called ${name}`, at);
}

export function member(obj: Value, name: string, at = -1): Value {
  if (obj === null || obj === undefined) return null;
  if (obj instanceof FxObject) return obj.get(name);
  if (Array.isArray(obj)) {
    // Customers.Name: the Name column, as a one-column table.
    return obj.map((r) => ({ Value: isRec(r) ? (field(r, name) ?? null) : null }));
  }
  if (isRec(obj)) {
    const v = field(obj, name);
    if (v === undefined) throw new FxError(`There's no field called ${name}`, at);
    return v;
  }
  throw new FxError(`A ${typeName(obj)} has no ${name}`, at);
}

const DAY = 86_400_000;

function* binary(n: Extract<Node, { k: "bin" }>, ctx: Ctx): Gen {
  if (n.op === "and") return toBool(yield* ev(n.l, ctx)) ? toBool(yield* ev(n.r, ctx)) : false;
  if (n.op === "or") return toBool(yield* ev(n.l, ctx)) ? true : toBool(yield* ev(n.r, ctx));
  const l = yield* ev(n.l, ctx);
  const r = yield* ev(n.r, ctx);
  switch (n.op) {
    case "+":
    case "-": {
      // A date plus or minus days; one date minus another is the days between them.
      if (l instanceof Date && !(r instanceof Date)) return new Date(l.getTime() + (n.op === "+" ? 1 : -1) * toNumber(r) * DAY);
      if (r instanceof Date && n.op === "+") return new Date(r.getTime() + toNumber(l) * DAY);
      if (l instanceof Date && r instanceof Date) return (l.getTime() - r.getTime()) / DAY;
      return n.op === "+" ? toNumber(l) + toNumber(r) : toNumber(l) - toNumber(r);
    }
    case "*":
      return toNumber(l) * toNumber(r);
    case "/": {
      const d = toNumber(r);
      if (d === 0) throw new FxError("Division by zero", n.at);
      return toNumber(l) / d;
    }
    case "^":
      return Math.pow(toNumber(l), toNumber(r));
    case "&":
      return toText(l) + toText(r);
    case "=":
      return equals(l, r);
    case "<>":
      return !equals(l, r);
    case "<":
    case "<=":
    case ">":
    case ">=": {
      if (isBlank(l) && isBlank(r)) return n.op === "<=" || n.op === ">=";
      const c = l instanceof Date || r instanceof Date ? toDate(l)!.getTime() - toDate(r)!.getTime() : compare(l, r);
      return n.op === "<" ? c < 0 : n.op === "<=" ? c <= 0 : n.op === ">" ? c > 0 : c >= 0;
    }
    case "in":
    case "exactin": {
      const exact = n.op === "exactin";
      if (Array.isArray(r)) {
        return r.some((row) => {
          const v = isRec(row) ? row[Object.keys(row)[0]] ?? null : row;
          return exact ? equals(l, v) : typeof v === "string" && typeof l === "string" ? v.toLowerCase() === l.toLowerCase() : equals(l, v);
        });
      }
      const hay = toText(r);
      const needle = toText(l);
      return exact ? hay.includes(needle) : hay.toLowerCase().includes(needle.toLowerCase());
    }
  }
  throw new FxError(`Unknown operator ${n.op}`, n.at);
}

/** Runs a generator that must not wait for anything. */
function runSync(g: Gen): Value {
  const step = g.next();
  if (!step.done) {
    // Leave the pending work unrun: this formula wasn't allowed to start it.
    throw new FxError("That function can only be used in a behavior property such as OnSelect");
  }
  return step.value ?? null;
}

export function newCtx(host: Host, locals: Record<string, Value> = {}, behavior = false): Ctx {
  return { host, scopes: [], locals, behavior };
}

/** A data formula's value. Throws FxSyntaxError or FxError. */
export function evalData(src: string, host: Host, locals: Record<string, Value> = {}): Value {
  return runSync(ev(parseCached(src), newCtx(host, locals, false)));
}

/** Runs a behavior formula (OnSelect, OnVisible, OnSuccess ...), waiting for each step. */
export async function runBehavior(src: string, host: Host, locals: Record<string, Value> = {}): Promise<Value> {
  if (!src.trim()) return null;
  const g = ev(parseCached(src), newCtx(host, locals, true));
  let input: unknown = undefined;
  let error: unknown = undefined;
  for (;;) {
    const step = error === undefined ? g.next(input) : g.throw(error);
    if (step.done) return step.value ?? null;
    input = undefined;
    error = undefined;
    try {
      input = await step.value;
    } catch (e) {
      error = e instanceof FxError ? e : new FxError(e instanceof Error ? e.message : String(e));
    }
  }
}
