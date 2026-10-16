// Shapes and text boxes: a block with its own paragraphs, drawn over an SVG
// preset shape, sized by its corner handle and placed by its wrap setting
// (square and tight float beside the text; behind and in front sit at an
// offset and can be dragged by their grip).
import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as PMNodeT } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import { shapeSvg, textInset } from "@/lib/docs/drawing";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    shapes: {
      insertShape: (attrs: Record<string, unknown>) => ReturnType;
    };
  }
}

const num = (v: string | null) => (v && Number.isFinite(Number(v)) ? Number(v) : null);

/** Placement attributes shared by pictures and shapes. */
export const placementAttrs = {
  wrap: { default: "inline", parseHTML: (el: HTMLElement) => el.getAttribute("data-wrap") || "inline", renderHTML: (a: Record<string, unknown>) => (a.wrap && a.wrap !== "inline" ? { "data-wrap": a.wrap } : {}) },
  offsetX: { default: null, parseHTML: (el: HTMLElement) => num(el.getAttribute("data-x")), renderHTML: (a: Record<string, unknown>) => (a.offsetX ? { "data-x": a.offsetX } : {}) },
  offsetY: { default: null, parseHTML: (el: HTMLElement) => num(el.getAttribute("data-y")), renderHTML: (a: Record<string, unknown>) => (a.offsetY ? { "data-y": a.offsetY } : {}) },
};

/** Drag a free-floating (behind / in front) object by a grip: updates offsetX/offsetY. */
export function dragToMove(grip: HTMLElement, opts: { editable: () => boolean; get: () => PMNodeT; pos: () => number | undefined; box: HTMLElement; dispatch: (pos: number, attrs: Record<string, unknown>) => void; select: (pos: number) => void }) {
  grip.addEventListener("pointerdown", (e) => {
    const n = opts.get();
    const p = opts.pos();
    if (p === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    opts.select(p);
    if (!opts.editable() || (n.attrs.wrap !== "behind" && n.attrs.wrap !== "front")) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const ox = Number(n.attrs.offsetX) || 0;
    const oy = Number(n.attrs.offsetY) || 0;
    const zoom = opts.box.getBoundingClientRect().width / (opts.box.offsetWidth || 1) || 1;
    let dx = 0;
    let dy = 0;
    const move = (ev: PointerEvent) => {
      dx = (ev.clientX - x0) / zoom;
      dy = (ev.clientY - y0) / zoom;
      opts.box.style.translate = `${dx}px ${dy}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      opts.box.style.translate = "";
      const q = opts.pos();
      if (q !== undefined && (dx || dy)) opts.dispatch(q, { ...opts.get().attrs, offsetX: Math.round(ox + dx), offsetY: Math.round(oy + dy) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}

export const Shape = Node.create<{ onOpen: (pos: number) => void }>({
  name: "shape",
  group: "block",
  content: "block+",
  isolating: true,
  defining: true,
  draggable: false,
  addOptions() {
    return { onOpen: () => {} };
  },
  addAttributes() {
    return {
      kind: { default: "rect", parseHTML: (el) => el.getAttribute("data-shape") || "rect", renderHTML: (a) => ({ "data-shape": a.kind }) },
      width: { default: 192, parseHTML: (el) => num(el.getAttribute("data-w")) ?? 192, renderHTML: (a) => ({ "data-w": a.width }) },
      height: { default: 96, parseHTML: (el) => num(el.getAttribute("data-h")) ?? 96, renderHTML: (a) => ({ "data-h": a.height }) },
      fill: { default: "#4472c4", parseHTML: (el) => el.getAttribute("data-fill") || "#4472c4", renderHTML: (a) => ({ "data-fill": a.fill }) },
      stroke: { default: "#2f528f", parseHTML: (el) => el.getAttribute("data-stroke") || "none", renderHTML: (a) => ({ "data-stroke": a.stroke }) },
      strokeWidth: { default: 1, parseHTML: (el) => num(el.getAttribute("data-sw")) ?? 1, renderHTML: (a) => ({ "data-sw": a.strokeWidth }) },
      color: { default: null, parseHTML: (el) => el.getAttribute("data-color"), renderHTML: (a) => (a.color ? { "data-color": a.color } : {}) },
      valign: { default: "middle", parseHTML: (el) => el.getAttribute("data-valign") || "middle", renderHTML: (a) => ({ "data-valign": a.valign }) },
      textBox: { default: false, parseHTML: (el) => el.hasAttribute("data-textbox"), renderHTML: (a) => (a.textBox ? { "data-textbox": "" } : {}) },
      align: { default: null, parseHTML: (el) => el.getAttribute("data-align"), renderHTML: (a) => (a.align ? { "data-align": a.align } : {}) },
      ...placementAttrs,
    };
  },
  parseHTML: () => [{ tag: "div[data-shape]", contentElement: ".word-shape-text" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: "word-shape-wrap" }), ["div", { class: "word-shape-text" }, 0]],
  addCommands() {
    return {
      insertShape:
        (attrs) =>
        ({ chain }) =>
          chain().insertContent({ type: "shape", attrs, content: [{ type: "paragraph" }] }).run(),
    };
  },
  addNodeView() {
    const opts = this.options;
    return ({ node, getPos, editor }) => {
      const wrap = document.createElement("div");
      wrap.className = "word-shape-wrap";
      const box = document.createElement("div");
      box.className = "word-shape";
      const art = document.createElement("div");
      art.className = "word-shape-art";
      art.contentEditable = "false";
      const text = document.createElement("div");
      text.className = "word-shape-text";
      const grip = document.createElement("span");
      grip.className = "word-shape-grip";
      grip.contentEditable = "false";
      grip.title = "Select (double-click for layout); drag to move when behind or in front of text";
      const handle = document.createElement("span");
      handle.className = "word-image-handle word-shape-handle";
      handle.contentEditable = "false";
      box.append(art, text, grip, handle);
      wrap.append(box);
      let cur = node;
      const pos = () => (getPos as () => number | undefined)();
      const paint = (n: PMNodeT, w = Number(n.attrs.width) || 192, h = Number(n.attrs.height) || 96) => {
        box.style.width = `${w}px`;
        box.style.height = `${h}px`;
        const sw = n.attrs.stroke && n.attrs.stroke !== "none" ? (Number(n.attrs.strokeWidth) || 1) * (4 / 3) : 0;
        art.innerHTML = shapeSvg(String(n.attrs.kind), w, h, String(n.attrs.fill || "none"), String(n.attrs.stroke || "none"), sw);
        const ins = textInset(String(n.attrs.kind));
        text.style.left = `${ins.l * 100}%`;
        text.style.right = `${ins.r * 100}%`;
        text.style.top = `${ins.t * 100}%`;
        text.style.bottom = `${ins.b * 100}%`;
        text.style.justifyContent = n.attrs.valign === "top" ? "flex-start" : n.attrs.valign === "bottom" ? "flex-end" : "center";
        text.style.color = n.attrs.color || "";
        wrap.setAttribute("data-wrap", String(n.attrs.wrap || "inline"));
        wrap.style.textAlign = n.attrs.align === "center" ? "center" : n.attrs.align === "right" ? "right" : "";
        box.classList.toggle("word-shape-line", n.attrs.kind === "line");
      };
      paint(node);
      const select = (p: number) => editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, p)));
      grip.addEventListener("dblclick", (e) => {
        e.preventDefault();
        const p = pos();
        if (p !== undefined) opts.onOpen(p);
      });
      dragToMove(grip, { editable: () => editor.isEditable, get: () => cur, pos, box, select, dispatch: (p, attrs) => editor.view.dispatch(editor.state.tr.setNodeMarkup(p, undefined, attrs)) });
      handle.addEventListener("pointerdown", (e) => {
        if (!editor.isEditable) return;
        e.preventDefault();
        e.stopPropagation();
        const x0 = e.clientX;
        const y0 = e.clientY;
        const zoom = box.getBoundingClientRect().width / (box.offsetWidth || 1) || 1;
        const w0 = Number(cur.attrs.width) || 192;
        const h0 = Number(cur.attrs.height) || 96;
        let w = w0;
        let h = h0;
        const move = (ev: PointerEvent) => {
          w = Math.max(8, Math.round(w0 + (ev.clientX - x0) / zoom));
          h = Math.max(cur.attrs.kind === "line" ? 0 : 8, Math.round(h0 + (ev.clientY - y0) / zoom));
          paint(cur, w, h);
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          const p = pos();
          if (p !== undefined) editor.view.dispatch(editor.state.tr.setNodeMarkup(p, undefined, { ...cur.attrs, width: w, height: h }));
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      });
      return {
        dom: wrap,
        contentDOM: text,
        update: (n) => {
          if (n.type !== cur.type) return false;
          cur = n;
          paint(n);
          return true;
        },
        selectNode: () => wrap.classList.add("ProseMirror-selectednode"),
        deselectNode: () => wrap.classList.remove("ProseMirror-selectednode"),
        ignoreMutation: (m) => !text.contains(m.target as globalThis.Node),
      };
    };
  },
});
