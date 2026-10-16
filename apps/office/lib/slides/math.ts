// Equations. An equation is stored as LaTeX (a practical subset: fractions,
// roots, scripts, big operators, fences, accents, matrices, Greek letters
// and the usual symbols), parsed into a small tree that renders as MathML
// (drawn natively by the browser), exports as Office Math (OMML) and is read
// back from OMML.
import { attr, child, type XEl } from "./xml";

export type M =
  | { k: "row"; c: M[] }
  | { k: "i" | "n" | "o" | "t" | "fn"; v: string }
  | { k: "frac"; a: M; b: M; noBar?: boolean }
  | { k: "sqrt"; a: M; deg?: M }
  | { k: "script"; base: M; sub?: M; sup?: M }
  | { k: "nary"; op: string; sub?: M; sup?: M; body: M }
  | { k: "fence"; l: string; r: string; a: M }
  | { k: "acc"; acc: string; a: M }
  | { k: "mat"; rows: M[][] };

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  infty: "∞", partial: "∂", nabla: "∇", ell: "ℓ", hbar: "ℏ", emptyset: "∅", Re: "ℜ", Im: "ℑ", aleph: "ℵ",
};
const OPS: Record<string, string> = {
  times: "×", cdot: "⋅", div: "÷", pm: "±", mp: "∓", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈", equiv: "≡", sim: "∼", simeq: "≃",
  propto: "∝", to: "→", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔", leftrightarrow: "↔", mapsto: "↦", in: "∈", notin: "∉",
  ni: "∋", subset: "⊂", supset: "⊃", subseteq: "⊆", supseteq: "⊇", cup: "∪", cap: "∩", forall: "∀", exists: "∃", ldots: "…", cdots: "⋯", vdots: "⋮", ddots: "⋱",
  prime: "′", angle: "∠", circ: "∘", degree: "°", perp: "⊥", parallel: "∥", neg: "¬", lnot: "¬", wedge: "∧", land: "∧", vee: "∨", lor: "∨", oplus: "⊕", otimes: "⊗",
  ll: "≪", gg: "≫", star: "⋆", ast: "∗", bullet: "∙", setminus: "∖", mid: "∣", langle: "⟨", rangle: "⟩", lfloor: "⌊", rfloor: "⌋", lceil: "⌈", rceil: "⌉",
  "{": "{", "}": "}", "|": "‖", "%": "%", "#": "#", "&": "&", "$": "$", "_": "_",
};
const NARY: Record<string, string> = { sum: "∑", prod: "∏", coprod: "∐", int: "∫", iint: "∬", iiint: "∭", oint: "∮", bigcup: "⋃", bigcap: "⋂", bigvee: "⋁", bigwedge: "⋀", bigoplus: "⨁", bigotimes: "⨂" };
const FUNCS = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "log", "ln", "lg", "exp", "lim", "max", "min", "det", "sinh", "cosh", "tanh", "arcsin", "arccos", "arctan", "gcd", "sup", "inf", "mod", "arg", "deg", "dim", "ker", "Pr", "liminf", "limsup"]);
/** functions whose limits go under them in display */
const UNDER = new Set(["lim", "max", "min", "sup", "inf", "liminf", "limsup", "det", "gcd", "Pr"]);
const ACCENTS: Record<string, string> = { hat: "̂", widehat: "̂", tilde: "̃", widetilde: "̃", bar: "̅", overline: "̅", vec: "⃗", dot: "̇", ddot: "̈", check: "̌", breve: "̆", acute: "́", grave: "̀" };
const MATRIX_FENCE: Record<string, [string, string]> = { matrix: ["", ""], pmatrix: ["(", ")"], bmatrix: ["[", "]"], Bmatrix: ["{", "}"], vmatrix: ["|", "|"], Vmatrix: ["‖", "‖"], cases: ["{", ""] };
const SPACES = new Set([",", ";", ":", "!", "quad", "qquad", " ", "enspace", "thinspace"]);

// ---------------------------------------------------------------- LaTeX -> tree

const TEXT_CMDS = new Set(["text", "mathrm", "textrm", "operatorname", "mbox", "textbf", "textit"]);
const RAW = "\u0001";

function tokenize(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      const m = /^\\([a-zA-Z]+|.)/.exec(src.slice(i));
      if (!m) break;
      out.push(m[0]);
      i += m[0].length;
      // text arguments keep their spaces: read them raw, up to the matching brace
      if (TEXT_CMDS.has(m[1])) {
        const open = /^\s*\{/.exec(src.slice(i));
        if (open) {
          let depth = 0, j = i + open[0].length;
          for (; j < src.length; j++) {
            if (src[j] === "\\") { j++; continue; }
            if (src[j] === "{") depth++;
            else if (src[j] === "}") {
              if (!depth) break;
              depth--;
            }
          }
          out.push(RAW + src.slice(i + open[0].length, j).replace(/\\([{}\\ ])/g, "$1"));
          i = j + 1;
        }
      }
    } else if (/\s/.test(c)) i++;
    else if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+|^[0-9]+\.?/.exec(src.slice(i))!;
      out.push(m[0]);
      i += m[0].length;
    } else {
      // keep surrogate pairs together
      const cp = src.codePointAt(i)!;
      const ch = String.fromCodePoint(cp);
      out.push(ch);
      i += ch.length;
    }
  }
  return out;
}

const row = (c: M[]): M => (c.length === 1 ? c[0] : { k: "row", c });

export function parseLatex(src: string): M {
  const tok = tokenize(src);
  let i = 0;
  const peek = () => tok[i];
  const group = (): M => {
    // {…} or a single atom
    if (peek() === "{") {
      i++;
      const r = seq(new Set(["}"]));
      if (peek() === "}") i++;
      return r;
    }
    const a = atom();
    return a || { k: "row", c: [] };
  };
  const textArg = (): string => {
    if (peek()?.startsWith(RAW)) return tok[i++].slice(1);
    if (peek() !== "{") return tok[i++] || "";
    // raw text up to the matching brace (spaces were dropped by the tokenizer, so rebuild from the source)
    let depth = 0, s = "";
    for (i++; i < tok.length; i++) {
      const t = tok[i];
      if (t === "{") depth++;
      if (t === "}") {
        if (!depth) { i++; break; }
        depth--;
      }
      s += t.startsWith("\\") && t.length === 2 ? t.slice(1) : t;
    }
    return s;
  };
  const delim = (): string => {
    const t = tok[i++] || "";
    if (t === ".") return "";
    if (t.startsWith("\\")) return OPS[t.slice(1)] ?? (t === "\\{" ? "{" : t === "\\}" ? "}" : t === "\\|" ? "‖" : t.slice(1));
    return t;
  };
  const atom = (): M | null => {
    const t = tok[i];
    if (t === undefined) return null;
    if (t === "{") return group();
    i++;
    if (!t.startsWith("\\")) {
      if (/^[0-9.]+$/.test(t)) return { k: "n", v: t };
      if (/^\p{L}$/u.test(t)) return { k: "i", v: t };
      return { k: "o", v: t === "-" ? "−" : t === "*" ? "∗" : t === "'" ? "′" : t };
    }
    const name = t.slice(1);
    if (name === "frac" || name === "dfrac" || name === "tfrac") return { k: "frac", a: group(), b: group() };
    if (name === "binom") return { k: "fence", l: "(", r: ")", a: { k: "frac", a: group(), b: group(), noBar: true } };
    if (name === "sqrt") {
      let deg: M | undefined;
      if (peek() === "[") {
        i++;
        deg = seq(new Set(["]"]));
        if (peek() === "]") i++;
      }
      return { k: "sqrt", a: group(), ...(deg ? { deg } : {}) };
    }
    if (TEXT_CMDS.has(name)) {
      const s = textArg();
      return name === "operatorname" ? { k: "fn", v: s } : { k: "t", v: s };
    }
    if (name === "mathbf" || name === "mathit" || name === "boldsymbol" || name === "mathbb" || name === "mathcal") return group();
    if (name === "left") {
      const l = delim();
      const a = seq(new Set(["\\right"]));
      let r = "";
      if (peek() === "\\right") {
        i++;
        r = delim();
      }
      return { k: "fence", l, r, a };
    }
    if (name === "begin") {
      const env = textArg();
      const rows: M[][] = [[]];
      for (;;) {
        const cell = seq(new Set(["&", "\\\\", "\\end"]));
        rows[rows.length - 1].push(cell);
        const t2 = tok[i++];
        if (t2 === "&") continue;
        if (t2 === "\\\\") {
          rows.push([]);
          continue;
        }
        if (t2 === "\\end") textArg();
        break;
      }
      if (rows.length > 1 && rows[rows.length - 1].every((c) => c.k === "row" && !c.c.length)) rows.pop();
      const [l, r] = MATRIX_FENCE[env] || ["", ""];
      const mat: M = { k: "mat", rows };
      return l || r ? { k: "fence", l, r, a: mat } : mat;
    }
    if (name in ACCENTS) return { k: "acc", acc: ACCENTS[name], a: group() };
    if (name in NARY) {
      let sub: M | undefined, sup: M | undefined;
      for (let k = 0; k < 2; k++) {
        if (peek() === "_") { i++; sub = group(); }
        else if (peek() === "^") { i++; sup = group(); }
      }
      if (peek() === "\\limits" || peek() === "\\nolimits") i++;
      const body = scripted(atom()) || { k: "row", c: [] };
      return { k: "nary", op: NARY[name], ...(sub ? { sub } : {}), ...(sup ? { sup } : {}), body };
    }
    if (FUNCS.has(name)) return { k: "fn", v: name };
    if (name in GREEK) return { k: "i", v: GREEK[name] };
    if (name in OPS) return { k: "o", v: OPS[name] };
    if (SPACES.has(name)) return { k: "t", v: name === "quad" || name === "qquad" ? "  " : " " };
    return { k: "t", v: name };
  };
  const scripted = (base: M | null): M | null => {
    if (!base) return null;
    let sub: M | undefined, sup: M | undefined;
    for (;;) {
      if (peek() === "_" && !sub) { i++; sub = group(); }
      else if (peek() === "^" && !sup) { i++; sup = group(); }
      else if (peek() === "'" && !sup) { i++; sup = { k: "o", v: "′" }; }
      else break;
    }
    return sub || sup ? { k: "script", base, ...(sub ? { sub } : {}), ...(sup ? { sup } : {}) } : base;
  };
  const seq = (stop: Set<string>): M => {
    const items: M[] = [];
    while (i < tok.length && !stop.has(tok[i])) {
      if (tok[i] === "}" || tok[i] === "\\right" || tok[i] === "&" || tok[i] === "\\\\" || tok[i] === "\\end") {
        i++; // stray closer
        continue;
      }
      if (tok[i] === "_" || tok[i] === "^") {
        // a script with nothing before it
        const s = scripted({ k: "row", c: [] });
        if (s) items.push(s);
        continue;
      }
      const a = scripted(atom());
      if (a) items.push(a);
    }
    return row(items);
  };
  return seq(new Set());
}

// ---------------------------------------------------------------- tree -> MathML

const xesc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const mrow = (m: M | undefined) => (m ? (m.k === "row" ? `<mrow>${m.c.map(mml).join("")}</mrow>` : mml(m)) : "<mrow></mrow>");

function mml(m: M): string {
  switch (m.k) {
    case "row": return `<mrow>${m.c.map(mml).join("")}</mrow>`;
    case "i": return `<mi>${xesc(m.v)}</mi>`;
    case "n": return `<mn>${xesc(m.v)}</mn>`;
    case "o": return `<mo>${xesc(m.v)}</mo>`;
    case "t": return `<mtext>${xesc(m.v.replace(/ /g, " "))}</mtext>`;
    case "fn": return `<mi mathvariant="normal">${xesc(m.v)}</mi><mo>&#x2061;</mo>`;
    case "frac": return `<mfrac${m.noBar ? ' linethickness="0"' : ""}>${mrow(m.a)}${mrow(m.b)}</mfrac>`;
    case "sqrt": return m.deg ? `<mroot>${mrow(m.a)}${mrow(m.deg)}</mroot>` : `<msqrt>${mrow(m.a)}</msqrt>`;
    case "script": {
      const under = m.base.k === "fn" && UNDER.has(m.base.v);
      const base = m.base.k === "fn" ? `<mi mathvariant="normal">${xesc(m.base.v)}</mi>` : mrow(m.base);
      const tail = m.base.k === "fn" ? "<mo>&#x2061;</mo>" : "";
      if (m.sub && m.sup) return `<${under ? "munderover" : "msubsup"}>${base}${mrow(m.sub)}${mrow(m.sup)}</${under ? "munderover" : "msubsup"}>${tail}`;
      if (m.sub) return `<${under ? "munder" : "msub"}>${base}${mrow(m.sub)}</${under ? "munder" : "msub"}>${tail}`;
      return `<${under ? "mover" : "msup"}>${base}${mrow(m.sup)}</${under ? "mover" : "msup"}>${tail}`;
    }
    case "nary": {
      const integral = /[∫∬∭∮]/.test(m.op);
      const op = `<mo largeop="true" movablelimits="false">${m.op}</mo>`;
      const tag = m.sub && m.sup ? (integral ? "msubsup" : "munderover") : m.sub ? (integral ? "msub" : "munder") : m.sup ? (integral ? "msup" : "mover") : "";
      const head = tag ? `<${tag}>${op}${m.sub ? mrow(m.sub) : ""}${m.sup ? mrow(m.sup) : ""}</${tag}>` : op;
      return `<mrow>${head}${mrow(m.body)}</mrow>`;
    }
    case "fence": return `<mrow>${m.l ? `<mo fence="true" stretchy="true">${xesc(m.l)}</mo>` : ""}${mrow(m.a)}${m.r ? `<mo fence="true" stretchy="true">${xesc(m.r)}</mo>` : ""}</mrow>`;
    case "acc": {
      const shown = ({ "̂": "^", "̃": "~", "̅": "‾", "⃗": "→", "̇": "˙", "̈": "¨", "̌": "ˇ", "̆": "˘", "́": "´", "̀": "`" } as Record<string, string>)[m.acc] || m.acc;
      return `<mover accent="true">${mrow(m.a)}<mo stretchy="${m.acc === "̅" ? "true" : "false"}">${xesc(shown)}</mo></mover>`;
    }
    case "mat": return `<mtable>${m.rows.map((r) => `<mtr>${r.map((c) => `<mtd>${mrow(c)}</mtd>`).join("")}</mtr>`).join("")}</mtable>`;
  }
}

/** MathML for a LaTeX equation (display style). */
export function latexToMathml(src: string, display = true): string {
  if (!display) return `<math xmlns="http://www.w3.org/1998/Math/MathML">${mrow(parseLatex(src))}</math>`;
  return `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mstyle displaystyle="true">${mrow(parseLatex(src))}</mstyle></math>`;
}

// ---------------------------------------------------------------- tree -> OMML

const run = (t: string, upright = false) => (t ? `<m:r>${upright ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : ""}<m:t${/^\s|\s$/.test(t) ? ' xml:space="preserve"' : ""}>${xesc(t)}</m:t></m:r>` : "");
const oe = (tag: string, m: M | undefined) => `<m:${tag}>${m ? omml(m) : ""}</m:${tag}>`;

function omml(m: M): string {
  switch (m.k) {
    case "row": return m.c.map(omml).join("");
    case "i": case "n": case "o": return run(m.v);
    case "t": case "fn": return run(m.v, true);
    case "frac": return `<m:f>${m.noBar ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : ""}${oe("num", m.a)}${oe("den", m.b)}</m:f>`;
    case "sqrt": return m.deg ? `<m:rad>${oe("deg", m.deg)}${oe("e", m.a)}</m:rad>` : `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>${oe("e", m.a)}</m:rad>`;
    case "script": {
      if (m.base.k === "fn" && UNDER.has(m.base.v) && m.sub && !m.sup) return `<m:limLow>${oe("e", m.base)}${oe("lim", m.sub)}</m:limLow>`;
      if (m.sub && m.sup) return `<m:sSubSup>${oe("e", m.base)}${oe("sub", m.sub)}${oe("sup", m.sup)}</m:sSubSup>`;
      if (m.sub) return `<m:sSub>${oe("e", m.base)}${oe("sub", m.sub)}</m:sSub>`;
      return `<m:sSup>${oe("e", m.base)}${oe("sup", m.sup)}</m:sSup>`;
    }
    case "nary": {
      const integral = /[∫∬∭∮]/.test(m.op);
      const pr = `<m:naryPr><m:chr m:val="${m.op}"/><m:limLoc m:val="${integral ? "subSup" : "undOvr"}"/>${m.sub ? "" : '<m:subHide m:val="1"/>'}${m.sup ? "" : '<m:supHide m:val="1"/>'}</m:naryPr>`;
      return `<m:nary>${pr}${oe("sub", m.sub)}${oe("sup", m.sup)}${oe("e", m.body)}</m:nary>`;
    }
    case "fence": return `<m:d><m:dPr><m:begChr m:val="${xesc(m.l)}"/><m:endChr m:val="${xesc(m.r)}"/></m:dPr>${oe("e", m.a)}</m:d>`;
    case "acc":
      if (m.acc === "̅") return `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr>${oe("e", m.a)}</m:bar>`;
      return `<m:acc><m:accPr><m:chr m:val="${m.acc}"/></m:accPr>${oe("e", m.a)}</m:acc>`;
    case "mat": return `<m:m>${m.rows.map((r) => `<m:mr>${r.map((c) => oe("e", c)).join("")}</m:mr>`).join("")}</m:m>`;
  }
}

export const OMML_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";

/** An <m:oMathPara> for a LaTeX equation. */
export function latexToOmml(src: string, runProps = ""): string {
  let body = omml(parseLatex(src));
  // DrawingML run properties (size, colour, font) go on every run, after its m:rPr
  if (runProps) body = body.replace(/<m:r>(<m:rPr>[\s\S]*?<\/m:rPr>)?/g, (_, pr) => `<m:r>${pr || ""}${runProps}`);
  return `<m:oMathPara xmlns:m="${OMML_NS}"><m:oMathParaPr><m:jc m:val="centerGroup"/></m:oMathParaPr><m:oMath>${body}</m:oMath></m:oMathPara>`;
}

/** An inline <m:oMath> for a LaTeX equation (the m: prefix must be declared by the part). */
export function latexToOmmlInline(src: string, runProps = ""): string {
  let body = omml(parseLatex(src));
  if (runProps) body = body.replace(/<m:r>(<m:rPr>[\s\S]*?<\/m:rPr>)?/g, (_, pr) => `<m:r>${pr || ""}${runProps}`);
  return `<m:oMath>${body}</m:oMath>`;
}

// ---------------------------------------------------------------- OMML -> LaTeX

const REV: Record<string, string> = {};
for (const [k, v] of Object.entries(GREEK)) REV[v] ??= `\\${k}`;
for (const [k, v] of Object.entries(OPS)) if (!/^[{}%#&$_|]$/.test(k)) REV[v] ??= `\\${k}`;
Object.assign(REV, { "{": "\\{", "}": "\\}", "%": "\\%", "#": "\\#", "&": "\\&", $: "\\$", _: "\\_", "−": "-", "∗": "*", "′": "'", "ϵ": "\\epsilon", "ε": "\\varepsilon", "φ": "\\varphi", "ϕ": "\\phi", "≤": "\\le", "≥": "\\ge", "≠": "\\ne", "→": "\\to" });
const NARY_REV: Record<string, string> = {};
for (const [k, v] of Object.entries(NARY)) NARY_REV[v] = `\\${k}`;
const ACC_REV: Record<string, string> = { "̂": "\\hat", "̃": "\\tilde", "̅": "\\overline", "⃗": "\\vec", "̇": "\\dot", "̈": "\\ddot", "̌": "\\check", "̆": "\\breve", "́": "\\acute", "̀": "\\grave", "^": "\\hat", "~": "\\tilde", "→": "\\vec" };
const DELIM_REV = (c: string) => (c === "" ? "." : c === "{" ? "\\{" : c === "}" ? "\\}" : c === "⟨" ? "\\langle" : c === "⟩" ? "\\rangle" : c === "‖" ? "\\|" : c === "⌊" ? "\\lfloor" : c === "⌋" ? "\\rfloor" : c === "⌈" ? "\\lceil" : c === "⌉" ? "\\rceil" : c);

const mval = (el: XEl | undefined, name: string): string | undefined => {
  const c = child(el, name);
  return c ? attr(c, "val") : undefined;
};
const on = (el: XEl | undefined, name: string) => {
  const c = child(el, name);
  if (!c) return false;
  const v = attr(c, "val");
  return v === undefined || v === "1" || v === "on" || v === "true";
};

/** Join LaTeX pieces, keeping a command name from running into a following letter. */
function cat(parts: string[]): string {
  let s = "";
  for (const p of parts) {
    if (!p) continue;
    if (/\\[a-zA-Z]+$/.test(s) && /^[a-zA-Z]/.test(p)) s += " ";
    s += p;
  }
  return s;
}
const brace = (s: string) => (s.length === 1 || /^\\[a-zA-Z]+$/.test(s) ? s : `{${s}}`);

function runText(r: XEl): string {
  const t = r.children.filter((c) => c.local === "t").map((c) => c.text).join("");
  const upright = mval(child(r, "rPr"), "sty") === "p" || on(child(r, "rPr"), "nor");
  if (upright && /^[a-zA-Z]{2,}$/.test(t)) return FUNCS.has(t) ? `\\${t}` : `\\text{${t}}`;
  if (upright && /[a-zA-Z]/.test(t) && /\s/.test(t)) return `\\text{${t}}`;
  return cat([...t].map((ch) => (/\s/.test(ch) ? "\\ " : REV[ch] || ch)));
}

function tex(el: XEl | undefined): string {
  if (!el) return "";
  return cat(el.children.map(node));
}
const arg = (el: XEl | undefined, name: string) => tex(child(el, name));

function node(n: XEl): string {
  switch (n.local) {
    case "r": return runText(n);
    case "f": return `\\frac{${arg(n, "num")}}{${arg(n, "den")}}`;
    case "rad": {
      const deg = arg(n, "deg");
      return on(child(n, "radPr"), "degHide") || !deg ? `\\sqrt{${arg(n, "e")}}` : `\\sqrt[${deg}]{${arg(n, "e")}}`;
    }
    case "sSub": return `${brace(arg(n, "e"))}_${brace(arg(n, "sub"))}`;
    case "sSup": return `${brace(arg(n, "e"))}^${brace(arg(n, "sup"))}`;
    case "sSubSup": return `${brace(arg(n, "e"))}_${brace(arg(n, "sub"))}^${brace(arg(n, "sup"))}`;
    case "sPre": return `{}_${brace(arg(n, "sub"))}^${brace(arg(n, "sup"))}${brace(arg(n, "e"))}`;
    case "nary": {
      const pr = child(n, "naryPr");
      const op = NARY_REV[mval(pr, "chr") || "∫"] || "\\int";
      const sub = on(pr, "subHide") ? "" : arg(n, "sub");
      const sup = on(pr, "supHide") ? "" : arg(n, "sup");
      return `${op}${sub ? `_${brace(sub)}` : ""}${sup ? `^${brace(sup)}` : ""}{${arg(n, "e")}}`;
    }
    case "d": {
      const pr = child(n, "dPr");
      const l = mval(pr, "begChr") ?? "(";
      const r = mval(pr, "endChr") ?? ")";
      const sep = mval(pr, "sepChr") ?? "|";
      const es = n.children.filter((c) => c.local === "e");
      const only = es.length === 1 && es[0].children.length === 1 ? es[0].children[0] : undefined;
      if (only?.local === "f" && mval(child(only, "fPr"), "type") === "noBar" && l === "(" && r === ")") return `\\binom{${arg(only, "num")}}{${arg(only, "den")}}`;
      // a matrix in brackets is a pmatrix/bmatrix/vmatrix; a brace on the left only is "cases"
      if (es.length === 1 && es[0].children.length === 1 && es[0].children[0].local === "m") {
        const env = l === "(" && r === ")" ? "pmatrix" : l === "[" && r === "]" ? "bmatrix" : l === "|" && r === "|" ? "vmatrix" : l === "{" && r === "" ? "cases" : l === "{" && r === "}" ? "Bmatrix" : "";
        if (env) return matrix(es[0].children[0], env);
      }
      if (es.length === 1 && es[0].children.length === 1 && es[0].children[0].local === "eqArr" && l === "{" && r === "") return matrix(es[0].children[0], "cases");
      return `\\left${DELIM_REV(l)}${es.map(tex).join(sep === "|" ? "\\mid " : REV[sep] || sep)}\\right${DELIM_REV(r)}`;
    }
    case "m": return matrix(n, "matrix");
    case "eqArr": return matrix(n, "matrix");
    case "acc": return `${ACC_REV[mval(child(n, "accPr"), "chr") || "̂"] || "\\hat"}{${arg(n, "e")}}`;
    case "bar": return mval(child(n, "barPr"), "pos") === "top" ? `\\overline{${arg(n, "e")}}` : `\\underline{${arg(n, "e")}}`;
    case "func": return cat([arg(n, "fName"), brace(arg(n, "e"))]);
    case "limLow": return `${brace(arg(n, "e"))}_${brace(arg(n, "lim"))}`;
    case "limUpp": return `${brace(arg(n, "e"))}^${brace(arg(n, "lim"))}`;
    case "groupChr": case "box": case "borderBox": case "phant": case "e": case "oMath": return arg(n, "e") || tex(n);
    default:
      if (/Pr$/.test(n.local) || n.local === "ctrlPr") return "";
      return tex(n);
  }
}

function matrix(m: XEl, env: string): string {
  // m:m holds m:mr rows of m:e cells; m:eqArr holds one m:e per row
  const rows = m.local === "eqArr" ? m.children.filter((c) => c.local === "e").map((e) => [tex(e)]) : m.children.filter((c) => c.local === "mr").map((r) => r.children.filter((c) => c.local === "e").map(tex));
  return `\\begin{${env}}${rows.map((r) => r.join(" & ")).join(" \\\\ ")}\\end{${env}}`;
}

/** LaTeX for an <m:oMathPara> or <m:oMath>. */
export function ommlToLatex(el: XEl): string {
  if (el.local === "oMathPara") return el.children.filter((c) => c.local === "oMath").map(tex).join(" \\\\ ");
  return tex(el);
}

/** A readable one-line form (export fallback text, accessibility). */
export function latexPlain(src: string): string {
  const walk = (m: M): string => {
    switch (m.k) {
      case "row": return m.c.map(walk).join("");
      case "i": case "n": case "o": case "t": case "fn": return m.v;
      case "frac": return `(${walk(m.a)})/(${walk(m.b)})`;
      case "sqrt": return `√(${walk(m.a)})`;
      case "script": return `${walk(m.base)}${m.sub ? `_${walk(m.sub)}` : ""}${m.sup ? `^${walk(m.sup)}` : ""}`;
      case "nary": return `${m.op}${m.sub ? `_${walk(m.sub)}` : ""}${m.sup ? `^${walk(m.sup)}` : ""} ${walk(m.body)}`;
      case "fence": return `${m.l}${walk(m.a)}${m.r}`;
      case "acc": return walk(m.a);
      case "mat": return m.rows.map((r) => r.map(walk).join(", ")).join("; ");
    }
  };
  return walk(parseLatex(src));
}

/** Quick inserts for the equation editor. */
export const MATH_SNIPPETS: { label: string; latex: string }[] = [
  { label: "a/b", latex: "\\frac{a}{b}" },
  { label: "x²", latex: "x^{2}" },
  { label: "xᵢ", latex: "x_{i}" },
  { label: "√x", latex: "\\sqrt{x}" },
  { label: "ⁿ√x", latex: "\\sqrt[n]{x}" },
  { label: "∑", latex: "\\sum_{i=1}^{n}" },
  { label: "∫", latex: "\\int_{a}^{b}" },
  { label: "lim", latex: "\\lim_{x \\to \\infty}" },
  { label: "( )", latex: "\\left( x \\right)" },
  { label: "[ ]", latex: "\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}" },
  { label: "x̂", latex: "\\hat{x}" },
  { label: "x̄", latex: "\\overline{x}" },
  { label: "α", latex: "\\alpha" },
  { label: "β", latex: "\\beta" },
  { label: "π", latex: "\\pi" },
  { label: "θ", latex: "\\theta" },
  { label: "Δ", latex: "\\Delta" },
  { label: "∞", latex: "\\infty" },
  { label: "±", latex: "\\pm" },
  { label: "×", latex: "\\times" },
  { label: "≤", latex: "\\le" },
  { label: "≠", latex: "\\ne" },
  { label: "→", latex: "\\to" },
];

export const MATH_PRESETS: { label: string; latex: string }[] = [
  { label: "Quadratic formula", latex: "x=\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}" },
  { label: "Pythagorean theorem", latex: "a^{2}+b^{2}=c^{2}" },
  { label: "Area of a circle", latex: "A=\\pi r^{2}" },
  { label: "Binomial theorem", latex: "(x+a)^{n}=\\sum_{k=0}^{n}{\\binom{n}{k}x^{k}a^{n-k}}" },
  { label: "Euler's identity", latex: "e^{i\\pi}+1=0" },
  { label: "Fourier series", latex: "f(x)=a_{0}+\\sum_{n=1}^{\\infty}{\\left(a_{n}\\cos\\frac{n\\pi x}{L}+b_{n}\\sin\\frac{n\\pi x}{L}\\right)}" },
];
