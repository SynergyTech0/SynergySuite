// Charts and SmartArt graphics in the document: inline objects drawn with the
// Slides chart view and SmartArt layouts. Double-click (or Enter on a selected
// one) to edit; drag the corner to resize.
import { Node, mergeAttributes } from "@tiptap/core";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChartView } from "@/components/slides/ChartView";
import { diagramSvg, sampleChart, type ChartData, type DiagramData } from "@/lib/docs/word-graphics";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    wordGraphics: {
      insertWordChart: (chart: ChartData, size?: { width: number; height: number }) => ReturnType;
      insertSmartArt: (diagram: DiagramData, size?: { width: number; height: number }) => ReturnType;
      updateGraphic: (pos: number, attrs: Record<string, unknown>) => ReturnType;
    };
  }
}

export function parseGraphic<T>(v: unknown): T | null {
  if (v && typeof v === "object") return v as T;
  if (typeof v !== "string" || !v) return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

type Opts = { onOpen: (pos: number, kind: "chart" | "smartArt") => void };

function resizable(dom: HTMLElement, getPos: () => number | undefined, editor: import("@tiptap/core").Editor, size: () => { w: number; h: number }) {
  const handle = document.createElement("span");
  handle.className = "word-graphic-resize";
  handle.contentEditable = "false";
  handle.title = "Drag to resize";
  handle.addEventListener("pointerdown", (e) => {
    if (!editor.isEditable) return;
    e.preventDefault();
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY, ...size() };
    const zoom = dom.getBoundingClientRect().width / Math.max(1, start.w);
    const move = (ev: PointerEvent) => {
      const w = Math.max(120, Math.round(start.w + (ev.clientX - start.x) / zoom));
      const h = Math.max(80, Math.round(start.h + (ev.clientY - start.y) / zoom));
      dom.style.width = `${w}px`;
      dom.style.height = `${h}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const pos = getPos();
      if (typeof pos === "number") editor.commands.updateGraphic(pos, { width: parseInt(dom.style.width), height: parseInt(dom.style.height) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
  dom.appendChild(handle);
}

const sizeAttrs = {
  width: { default: 480, parseHTML: (el: HTMLElement) => Number(el.getAttribute("data-w")) || 480, renderHTML: () => ({}) },
  height: { default: 288, parseHTML: (el: HTMLElement) => Number(el.getAttribute("data-h")) || 288, renderHTML: () => ({}) },
};

export const WordChart = Node.create<Opts>({
  name: "wordChart",
  inline: true,
  group: "inline",
  atom: true,
  draggable: true,
  selectable: true,
  addOptions() {
    return { onOpen: () => {} };
  },
  addAttributes() {
    return {
      chart: { default: JSON.stringify(sampleChart()), parseHTML: (el) => el.getAttribute("data-word-chart"), renderHTML: () => ({}) },
      alt: { default: null, parseHTML: (el) => el.getAttribute("aria-label"), renderHTML: () => ({}) },
      ...sizeAttrs,
    };
  },
  parseHTML() {
    return [{ tag: "span[data-word-chart]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const c = parseGraphic<ChartData>(node.attrs.chart);
    return ["span", mergeAttributes(HTMLAttributes, { "data-word-chart": node.attrs.chart, "data-w": node.attrs.width, "data-h": node.attrs.height, class: "word-graphic word-chart", role: "img", "aria-label": node.attrs.alt || (c?.title ? `Chart: ${c.title}` : "Chart"), style: `width:${node.attrs.width}px;height:${node.attrs.height}px` })];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("span");
      dom.className = "word-graphic word-chart";
      dom.setAttribute("data-word-chart", "");
      dom.contentEditable = "false";
      const host = document.createElement("span");
      host.className = "word-graphic-body";
      dom.appendChild(host);
      let root: Root | null = createRoot(host);
      let cur = node;
      const draw = () => {
        const c = parseGraphic<ChartData>(cur.attrs.chart) || sampleChart();
        const w = Number(cur.attrs.width) || 480;
        const h = Number(cur.attrs.height) || 288;
        dom.style.width = `${w}px`;
        dom.style.height = `${h}px`;
        dom.setAttribute("aria-label", String(cur.attrs.alt || (c.title ? `Chart: ${c.title}` : "Chart")));
        dom.setAttribute("role", "img");
        // ChartView draws in slide px at the element's size
        root?.render(createElement(ChartView, { el: { ...c, id: "c", type: "chart", x: 0, y: 0, w, h, z: 0 } as never, font: "Calibri, Carlito, sans-serif" }));
      };
      draw();
      resizable(dom, getPos as () => number | undefined, editor, () => ({ w: Number(cur.attrs.width) || 480, h: Number(cur.attrs.height) || 288 }));
      dom.addEventListener("dblclick", () => {
        const pos = (getPos as () => number | undefined)();
        if (typeof pos === "number" && editor.isEditable) this.options.onOpen(pos, "chart");
      });
      return {
        dom,
        update: (n) => {
          if (n.type !== cur.type) return false;
          cur = n;
          draw();
          return true;
        },
        stopEvent: (e) => (e.target as HTMLElement).classList?.contains("word-graphic-resize"),
        ignoreMutation: () => true,
        destroy: () => {
          const r = root;
          root = null;
          // unmount after React finishes the current render
          setTimeout(() => r?.unmount(), 0);
        },
      };
    };
  },
  addCommands() {
    return {
      insertWordChart:
        (chart, size) =>
        ({ commands }) =>
          commands.insertContent({ type: "wordChart", attrs: { chart: JSON.stringify(chart), width: size?.width || 480, height: size?.height || 288 } }),
      insertSmartArt:
        (diagram, size) =>
        ({ commands }) =>
          commands.insertContent({ type: "smartArt", attrs: { diagram: JSON.stringify(diagram), width: size?.width || 576, height: size?.height || 320 } }),
      updateGraphic:
        (pos, attrs) =>
        ({ tr, state, dispatch }) => {
          const n = state.doc.nodeAt(pos);
          if (!n || (n.type.name !== "wordChart" && n.type.name !== "smartArt")) return false;
          if (dispatch) dispatch(tr.setNodeMarkup(pos, undefined, { ...n.attrs, ...attrs }));
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const sel = editor.state.selection as unknown as { node?: { type: { name: string } }; from: number };
        if (sel.node && (sel.node.type.name === "wordChart" || sel.node.type.name === "smartArt")) {
          this.options.onOpen(sel.from, sel.node.type.name === "wordChart" ? "chart" : "smartArt");
          return true;
        }
        return false;
      },
    };
  },
});

export const SmartArt = Node.create<Opts>({
  name: "smartArt",
  inline: true,
  group: "inline",
  atom: true,
  draggable: true,
  selectable: true,
  addOptions() {
    return { onOpen: () => {} };
  },
  addAttributes() {
    return {
      diagram: { default: JSON.stringify({ kind: "process", items: [{ text: "Step", level: 0 }], accent: "4472C4" }), parseHTML: (el) => el.getAttribute("data-smartart"), renderHTML: () => ({}) },
      alt: { default: null, parseHTML: (el) => el.getAttribute("aria-label"), renderHTML: () => ({}) },
      width: { default: 576, parseHTML: (el: HTMLElement) => Number(el.getAttribute("data-w")) || 576, renderHTML: () => ({}) },
      height: { default: 320, parseHTML: (el: HTMLElement) => Number(el.getAttribute("data-h")) || 320, renderHTML: () => ({}) },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-smartart]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-smartart": node.attrs.diagram, "data-w": node.attrs.width, "data-h": node.attrs.height, class: "word-graphic word-smartart", role: "img", "aria-label": node.attrs.alt || "SmartArt graphic", style: `width:${node.attrs.width}px;height:${node.attrs.height}px` })];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("span");
      dom.className = "word-graphic word-smartart";
      dom.setAttribute("data-smartart", "");
      dom.contentEditable = "false";
      const host = document.createElement("span");
      host.className = "word-graphic-body";
      dom.appendChild(host);
      let cur = node;
      const draw = () => {
        const d = parseGraphic<DiagramData>(cur.attrs.diagram);
        const w = Number(cur.attrs.width) || 576;
        const h = Number(cur.attrs.height) || 320;
        dom.style.width = `${w}px`;
        dom.style.height = `${h}px`;
        dom.setAttribute("role", "img");
        dom.setAttribute("aria-label", String(cur.attrs.alt || `SmartArt: ${(d?.items || []).map((i) => i.text).join(", ")}`));
        host.innerHTML = d ? diagramSvg(d, w, h) : "";
      };
      draw();
      resizable(dom, getPos as () => number | undefined, editor, () => ({ w: Number(cur.attrs.width) || 576, h: Number(cur.attrs.height) || 320 }));
      dom.addEventListener("dblclick", () => {
        const pos = (getPos as () => number | undefined)();
        if (typeof pos === "number" && editor.isEditable) this.options.onOpen(pos, "smartArt");
      });
      return {
        dom,
        update: (n) => {
          if (n.type !== cur.type) return false;
          cur = n;
          draw();
          return true;
        },
        stopEvent: (e) => (e.target as HTMLElement).classList?.contains("word-graphic-resize"),
        ignoreMutation: () => true,
      };
    };
  },
});
