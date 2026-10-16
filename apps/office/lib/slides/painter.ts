// Format painter: copy the look of one object (fill, outline, gradient,
// shadow, text style) and paint it onto others. Text style is taken from the
// first run of text and applied to every run of the target.
import type { Gradient, Shadow, SlideElement, TableEl } from "./model";

export type TextFmt = { b?: boolean; i?: boolean; u?: boolean; s?: boolean; color?: string; size?: string; font?: string; /** highlight colour */ hl?: string };
export type ObjFmt = {
  from: SlideElement["type"];
  /** copied from selected text: painted onto the next text selected (or onto an object's text) */
  sel?: boolean;
  fill?: string | null;
  line?: string | null;
  lineW?: number;
  grad?: Gradient;
  shadow?: Shadow;
  valign?: "top" | "middle" | "bottom";
  text?: TextFmt;
  /** tables */
  border?: string;
  fontSize?: number;
  cellFill?: string;
};

const parse = (html: string): HTMLElement | null => {
  if (typeof DOMParser === "undefined") return null;
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
};

/** The formatting of the first run of text in slide-text HTML. */
export function textFmtOf(html: string | undefined): TextFmt | undefined {
  if (!html) return undefined;
  const body = parse(html);
  if (!body) return undefined;
  const walker = body.ownerDocument.createTreeWalker(body, 4 /* SHOW_TEXT */);
  let node: Node | null = walker.nextNode();
  while (node && !(node.textContent || "").trim()) node = walker.nextNode();
  if (!node) return undefined;
  const f: TextFmt = {};
  for (let el = node.parentElement; el && el !== body; el = el.parentElement) {
    const tag = el.tagName.toLowerCase();
    if (tag === "strong" || tag === "b") f.b = true;
    if (tag === "em" || tag === "i") f.i = true;
    if (tag === "u") f.u = true;
    if (tag === "s" || tag === "strike" || tag === "del") f.s = true;
    if (tag === "p" || tag === "li") break;
    const st = el.style;
    if (st.color && !f.color) f.color = st.color;
    if (st.fontSize && !f.size) f.size = st.fontSize;
    if (st.fontFamily && !f.font) f.font = st.fontFamily;
  }
  return f;
}

const INLINE = new Set(["strong", "b", "em", "i", "u", "s", "strike", "del", "span"]);

/** Re-style every run: drop the inline formatting and wrap each paragraph's content in `f`'s. */
export function applyTextFmt(html: string, f: TextFmt): string {
  const body = parse(html);
  if (!body) return html;
  const doc = body.ownerDocument;
  // unwrap the inline formatting (links and highlights stay)
  const unwrap = (root: Element) => {
    for (const el of Array.from(root.querySelectorAll("*"))) {
      if (!INLINE.has(el.tagName.toLowerCase())) continue;
      el.replaceWith(...Array.from(el.childNodes));
    }
  };
  unwrap(body);
  const blocks = Array.from(body.querySelectorAll("p"));
  const wrapAll = (block: Element) => {
    if (!block.childNodes.length) return;
    let inner: Node[] = Array.from(block.childNodes);
    const wrap = (tag: string, style?: string) => {
      const w = doc.createElement(tag);
      if (style) w.setAttribute("style", style);
      inner.forEach((n) => w.appendChild(n));
      inner = [w];
    };
    const css = [f.color ? `color: ${f.color}` : "", f.size ? `font-size: ${f.size}` : "", f.font ? `font-family: ${f.font}` : ""].filter(Boolean).join("; ");
    if (f.s) wrap("s");
    if (f.u) wrap("u");
    if (f.i) wrap("em");
    if (f.b) wrap("strong");
    if (css) wrap("span", css);
    inner.forEach((n) => block.appendChild(n));
  };
  if (blocks.length) blocks.forEach(wrapAll);
  else wrapAll(body);
  return body.innerHTML;
}

/** Copy an object's format. */
export function pickFormat(e: SlideElement): ObjFmt {
  const f: ObjFmt = { from: e.type };
  if (e.type === "shape") {
    Object.assign(f, { fill: e.fill ?? null, line: e.line ?? null, lineW: e.lineW, grad: e.grad, shadow: e.shadow, valign: e.valign });
    f.text = textFmtOf(e.html);
  } else if (e.type === "text") {
    f.valign = e.valign;
    f.text = textFmtOf(e.html);
  } else if (e.type === "image") f.shadow = e.shadow;
  else if (e.type === "table") {
    f.border = e.border;
    f.fontSize = e.fontSize;
    const body = e.rows[1]?.[0] || e.rows[0]?.[0];
    if (body?.fill) f.cellFill = body.fill;
  }
  return f;
}

/** The changes that paint `f` onto `e` (empty when nothing applies). */
export function paintFormat(e: SlideElement, f: ObjFmt): Partial<SlideElement> {
  const out: Record<string, unknown> = {};
  if (e.type === "shape" && f.from === "shape") Object.assign(out, { fill: f.fill, line: f.line, lineW: f.lineW, grad: f.grad, shadow: f.shadow });
  else if ((e.type === "shape" || e.type === "image") && f.shadow !== undefined) out.shadow = f.shadow;
  if ((e.type === "shape" || e.type === "text") && f.valign) out.valign = f.valign;
  if ((e.type === "shape" || e.type === "text") && f.text && e.html) out.html = applyTextFmt(e.html, f.text);
  if (e.type === "table" && f.from === "table") {
    out.border = f.border;
    out.fontSize = f.fontSize;
    if (f.cellFill) out.rows = (e as TableEl).rows.map((r, ri) => (ri === 0 ? r : r.map((c) => (c.merged ? c : { ...c, fill: f.cellFill }))));
  }
  if (e.type === "table" && f.text && f.from !== "table") {
    const color = f.text.color ? cssHex(f.text.color) : undefined;
    out.rows = (e as TableEl).rows.map((r) => r.map((c) => (c.merged ? c : { ...c, bold: f.text?.b || undefined, ...(color ? { color } : {}) })));
  }
  return out as Partial<SlideElement>;
}

/** "#aabbcc" or "rgb(…)" as hex without '#'. */
function cssHex(c: string): string | undefined {
  const h = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (h) return h[1].toUpperCase();
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(c.trim());
  return m ? [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("").toUpperCase() : undefined;
}

// ---- painting between text selections ----

/** What the painter needs of a rich-text editor (a TipTap editor). */
type MarkChain = {
  focus(): MarkChain;
  unsetMark(name: string): MarkChain;
  setMark(name: string, attrs?: Record<string, unknown>): MarkChain;
  run(): boolean;
};
export type MarkEditor = {
  isActive(name: string): boolean;
  getAttributes(name: string): Record<string, unknown>;
  chain(): MarkChain;
  state: { selection: { empty: boolean } };
};

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** The character format at a text selection (where it starts). */
export function selectionFmt(ed: MarkEditor): TextFmt {
  const ts = ed.getAttributes("textStyle");
  const f: TextFmt = {};
  if (ed.isActive("bold")) f.b = true;
  if (ed.isActive("italic")) f.i = true;
  if (ed.isActive("underline")) f.u = true;
  if (ed.isActive("strike")) f.s = true;
  if (str(ts.color)) f.color = str(ts.color);
  if (str(ts.fontSize)) f.size = str(ts.fontSize);
  if (str(ts.fontFamily)) f.font = str(ts.fontFamily);
  if (ed.isActive("highlight")) f.hl = str(ed.getAttributes("highlight").color) || "#FFFF00";
  return f;
}

/** Give the selected text exactly `f`'s character format (links stay). False when nothing is selected. */
export function paintSelection(ed: MarkEditor, f: TextFmt): boolean {
  if (ed.state.selection.empty) return false;
  let c = ed.chain().focus();
  for (const m of ["bold", "italic", "underline", "strike", "textStyle", "highlight"]) c = c.unsetMark(m);
  if (f.b) c = c.setMark("bold");
  if (f.i) c = c.setMark("italic");
  if (f.u) c = c.setMark("underline");
  if (f.s) c = c.setMark("strike");
  if (f.color || f.size || f.font) c = c.setMark("textStyle", { color: f.color ?? null, fontSize: f.size ?? null, fontFamily: f.font ?? null });
  if (f.hl) c = c.setMark("highlight", { color: f.hl });
  return c.run();
}
