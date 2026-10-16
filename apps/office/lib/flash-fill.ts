// Flash Fill: from a few typed examples, work out how a column is made from
// the cells next to it (pieces of their words, in a different case, with
// fixed text in between) and fill in the rest of the column the same way.
//
// A program is a list of pieces. A piece is fixed text, or the text of one
// input cell from one word to another (words are runs of letters and digits,
// counted from the start or from the end), possibly in another case, or a
// word's first letter. The search looks for the program that explains every
// example with the least fixed text, and uses it on the other rows.

export type Transform = "same" | "upper" | "lower" | "proper" | "initial" | "initialUpper";
export type WordRef = { fromEnd: boolean; k: number };
export type Piece = { kind: "text"; text: string } | { kind: "words"; column: number; from: WordRef; to: WordRef; transform: Transform };
export type FlashProgram = Piece[];

type Word = { start: number; end: number };

const wordCache = new Map<string, Word[]>();

export function wordsOf(s: string): Word[] {
  const hit = wordCache.get(s);
  if (hit) return hit;
  if (wordCache.size > 5000) wordCache.clear();
  const out: Word[] = [];
  wordCache.set(s, out);
  const re = /[\p{L}\p{N}]+/gu;
  for (let m: RegExpExecArray | null; (m = re.exec(s)); ) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

const resolve = (ref: WordRef, n: number) => (ref.fromEnd ? n - 1 - ref.k : ref.k);

function transform(text: string, t: Transform): string {
  switch (t) {
    case "upper":
      return text.toUpperCase();
    case "lower":
      return text.toLowerCase();
    case "proper":
      return text.toLowerCase().replace(/(^|[^\p{L}\p{N}'])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
    case "initial":
      return text.slice(0, 1);
    case "initialUpper":
      return text.slice(0, 1).toUpperCase();
    default:
      return text;
  }
}

/** One piece's text for a row, or null when the row doesn't have those words. */
export function pieceText(p: Piece, inputs: string[]): string | null {
  if (p.kind === "text") return p.text;
  const s = inputs[p.column] ?? "";
  const words = wordsOf(s);
  const a = resolve(p.from, words.length);
  const b = resolve(p.to, words.length);
  if (a < 0 || b < 0 || a >= words.length || b >= words.length || a > b) return null;
  return transform(s.slice(words[a].start, words[b].end), p.transform);
}

export function runProgram(program: FlashProgram, inputs: string[]): string | null {
  let out = "";
  for (const p of program) {
    const t = pieceText(p, inputs);
    if (t == null) return null;
    out += t;
  }
  return out;
}

const TRANSFORMS: Transform[] = ["same", "proper", "upper", "lower", "initialUpper", "initial"];

/**
 * Every way of naming the same word span in all examples: by position from
 * the start or from the end. The one Excel users expect comes first: from
 * the end when the span reaches the last word in every example, else from
 * the start.
 */
function refsFor(i: number, n: number): WordRef[] {
  return [
    { fromEnd: false, k: i },
    { fromEnd: true, k: n - 1 - i },
  ];
}

type Example = { inputs: string[]; output: string };

/**
 * Finds a program that turns each example's inputs into its output. Returns
 * null when there is none (or the examples disagree).
 */
export function learnProgram(examples: Example[], limit = 20000): FlashProgram | null {
  if (!examples.length || examples.some((e) => !e.output)) return null;
  const words = examples.map((e) => e.inputs.map((s) => wordsOf(s ?? "")));
  const columns = Math.max(...examples.map((e) => e.inputs.length));
  // Candidate word pieces, from the first example: every span of every input.
  const candidates: Piece[] = [];
  for (let c = 0; c < columns; c++) {
    const n = words[0][c]?.length || 0;
    for (let a = 0; a < n; a++)
      for (let b = a; b < n; b++)
        for (const t of TRANSFORMS) {
          if ((t === "initial" || t === "initialUpper") && a !== b) continue;
          for (const from of refsFor(a, n)) for (const to of refsFor(b, n)) candidates.push({ kind: "words", column: c, from, to, transform: t });
        }
  }
  // Best-first search over "how far into each example's output we are".
  type State = { pos: number[]; cost: number; program: Piece[] };
  const key = (pos: number[]) => pos.join(",");
  const best = new Map<string, number>();
  const queue: State[] = [{ pos: examples.map(() => 0), cost: 0, program: [] }];
  let explored = 0;
  while (queue.length && explored++ < limit) {
    queue.sort((x, y) => x.cost - y.cost);
    const st = queue.shift()!;
    if (st.pos.every((p, i) => p === examples[i].output.length)) return st.program;
    const k = key(st.pos);
    if ((best.get(k) ?? Infinity) < st.cost) continue;
    const push = (pos: number[], cost: number, program: Piece[]) => {
      const kk = key(pos);
      if ((best.get(kk) ?? Infinity) <= cost) return;
      best.set(kk, cost);
      queue.push({ pos, cost, program });
    };
    // A word piece that fits every example here. Pieces giving the same
    // text everywhere are the same move: keep the first (preferred) one.
    const seen = new Set<string>();
    for (const p of candidates) {
      const texts = examples.map((e) => pieceText(p, e.inputs));
      if (texts.some((t, i) => t == null || !t || !examples[i].output.startsWith(t, st.pos[i]))) continue;
      const sig = texts.join("\u0000");
      if (seen.has(sig)) continue;
      seen.add(sig);
      push(
        st.pos.map((q, i) => q + texts[i]!.length),
        st.cost + 1,
        [...st.program, p],
      );
    }
    // Fixed text: one character, the same in every example.
    const ch = examples[0].output[st.pos[0]];
    if (ch !== undefined && examples.every((e, i) => e.output[st.pos[i]] === ch)) {
      const last = st.program[st.program.length - 1];
      const program = last?.kind === "text" ? [...st.program.slice(0, -1), { kind: "text" as const, text: last.text + ch }] : [...st.program, { kind: "text" as const, text: ch }];
      // Fixed text costs more than a piece of an input, so inputs explain as much as they can.
      push(
        st.pos.map((q) => q + 1),
        st.cost + (last?.kind === "text" ? 3 : 4),
        program,
      );
    }
  }
  return null;
}

/** Re-expresses word positions the way that generalizes best (see refsFor). */
function preferRefs(program: FlashProgram, examples: Example[]): FlashProgram {
  return program.map((p) => {
    if (p.kind !== "words") return p;
    const lastEverywhere = (ref: WordRef) =>
      examples.every((e) => {
        const n = wordsOf(e.inputs[p.column] ?? "").length;
        return resolve(ref, n) === n - 1;
      });
    const flip = (ref: WordRef, n: number): WordRef => ({ fromEnd: !ref.fromEnd, k: n - 1 - ref.k });
    const n0 = wordsOf(examples[0].inputs[p.column] ?? "").length;
    const choose = (ref: WordRef) => {
      const fromEnd = lastEverywhere(ref);
      if (ref.fromEnd === fromEnd) return ref;
      const other = flip(ref, n0);
      // Only switch when both name the same word in every example.
      const same = examples.every((e) => {
        const n = wordsOf(e.inputs[p.column] ?? "").length;
        return resolve(ref, n) === resolve(other, n);
      });
      return same ? other : ref;
    };
    return { ...p, from: choose(p.from), to: choose(p.to) };
  });
}

export type FlashRow = { inputs: string[]; output: string | null };

/**
 * Flash Fill for a column: rows with an output are the examples; the others
 * get the program's result (null where it doesn't apply). Returns null when no
 * program explains the examples.
 */
export function flashFill(rows: FlashRow[]): { program: FlashProgram; outputs: (string | null)[] } | null {
  const examples = rows.filter((r) => r.output != null && r.output !== "").map((r) => ({ inputs: r.inputs, output: r.output as string }));
  if (!examples.length) return null;
  const learned = learnProgram(examples);
  if (!learned) return null;
  const program = preferRefs(learned, examples);
  const outputs = rows.map((r) => (r.output != null && r.output !== "" ? r.output : r.inputs.some((s) => s) ? runProgram(program, r.inputs) : null));
  return { program, outputs };
}
