/**
 * Renaming a control, screen or data source updates every formula that refers to it, as the
 * Power Apps studio does. Only whole names are replaced: not field names after a dot, record
 * keys before a colon, function names, or text inside quotes.
 */
import { tokenize } from "./fx";
import { quoteName } from "./generate";
import { allControls, type AppDef } from "./model";

/** The length of the name token at `at` as written (a 'quoted name' may contain '' escapes). */
function tokenLength(src: string, at: number, value: string): number {
  if (src[at] !== "'") return value.length;
  let i = at + 1;
  for (;;) {
    if (src[i] === "'" && src[i + 1] === "'") i += 2;
    else if (src[i] === "'") return i + 1 - at;
    else if (i >= src.length) return src.length - at;
    else i++;
  }
}

export function renameInFormula(src: string, from: string, to: string): string {
  if (!src.includes(from)) return src;
  let toks;
  try {
    toks = tokenize(src);
  } catch {
    return src;
  }
  const edits: [number, number][] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== "id" || t.v !== from) continue;
    const prev = toks[i - 1];
    const next = toks[i + 1];
    if (prev && prev.t === "op" && prev.v === ".") continue;
    if (next && next.t === "op" && (next.v === "(" || next.v === ":")) continue;
    edits.push([t.at, tokenLength(src, t.at, t.v)]);
  }
  let out = src;
  for (const [at, len] of edits.reverse()) out = out.slice(0, at) + quoteName(to) + out.slice(at + len);
  return out;
}

/** The app with every formula's references to `from` pointing at `to`. */
export function renameEverywhere(app: AppDef, from: string, to: string): AppDef {
  const next: AppDef = structuredClone(app);
  const fix = (props: Record<string, string>) => {
    for (const k of Object.keys(props)) props[k] = renameInFormula(props[k], from, to);
  };
  next.onStart = renameInFormula(next.onStart, from, to);
  for (const s of next.screens) fix(s.props);
  for (const { control } of allControls(next)) fix(control.props);
  return next;
}
