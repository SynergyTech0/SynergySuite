// More of Word's formatting: paragraph borders and shading, tab stops (with
// alignment and leaders), drop caps, widow/orphan control and page break
// before; caps, small caps and character spacing; change case (Shift+F3);
// and the format painter.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Mark as PMMark, Node as PMNodeT } from "@tiptap/pm/model";
import { bordersCss, changeCase, nextCase, parseJson, tabWidth, type CaseMode, type ParaBorders, type TabStop } from "@/lib/docs/para-format";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    wordFormat: {
      /** change the case of the selected text (Shift+F3 cycles when no mode is given) */
      changeCase: (mode?: CaseMode) => ReturnType;
      /** set character attributes on the textStyle mark (caps, smallCaps, charSpacing…) */
      setRunFormat: (attrs: Record<string, unknown>) => ReturnType;
      /** pick up the formatting at the selection; the next selection made gets it */
      copyFormat: (sticky?: boolean) => ReturnType;
      cancelFormatPainter: () => ReturnType;
    };
  }
}

const PARA_TYPES = ["paragraph", "heading"];
const KEEP_MARKS = new Set(["link", "comment", "insertion", "deletion"]);
const PARA_COPY = ["styleId", "textAlign", "spaceBefore", "spaceAfter", "indLeft", "indRight", "indFirst", "lineHeight", "borders", "shading", "tabs"];

type Painter = { marks: PMMark[]; para: Record<string, unknown> | null; heading: number | null; sticky: boolean };
export const painterKey = new PluginKey<Painter | null>("wordFormatPainter");
export const tabKey = new PluginKey<{ widths: Map<number, { w: number; leader?: string }>; deco: DecorationSet }>("wordTabStops");

const jsonAttr = (name: string, data: string) => ({
  default: null,
  keepOnSplit: true,
  parseHTML: (el: HTMLElement) => parseJson(el.getAttribute(data)),
  renderHTML: (a: Record<string, unknown>) => (a[name] ? { [data]: JSON.stringify(a[name]) } : {}),
});

export const WordFormat = Extension.create<{ onFontDialog: () => void }>({
  name: "wordFormat",
  addOptions() {
    return { onFontDialog: () => {} };
  },
  addGlobalAttributes() {
    return [
      {
        types: PARA_TYPES,
        attributes: {
          borders: {
            ...jsonAttr("borders", "data-borders"),
            renderHTML: (a) => (a.borders ? { "data-borders": JSON.stringify(a.borders), style: bordersCss(a.borders as ParaBorders) } : {}),
          },
          shading: {
            default: null,
            keepOnSplit: true,
            parseHTML: (el) => el.getAttribute("data-shading"),
            renderHTML: (a) => (a.shading ? { "data-shading": a.shading, style: `background-color: ${a.shading}` } : {}),
          },
          tabs: jsonAttr("tabs", "data-tabs"),
          dropCap: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => el.getAttribute("data-dropcap"),
            // "drop:3" or "margin:3"
            renderHTML: (a) => {
              const m = /^(drop|margin):(\d+)$/.exec(String(a.dropCap || ""));
              return m ? { "data-dropcap": a.dropCap, "data-dropcap-kind": m[1], style: `--dc-lines: ${m[2]}` } : {};
            },
          },
          widowControl: {
            default: null,
            parseHTML: (el) => (el.hasAttribute("data-no-widow") ? false : null),
            renderHTML: (a) => (a.widowControl === false ? { "data-no-widow": "" } : {}),
          },
          pageBreakBefore: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => (el.hasAttribute("data-break-before") ? true : null),
            renderHTML: (a) => (a.pageBreakBefore ? { "data-break-before": "" } : {}),
          },
        },
      },
      {
        types: ["textStyle"],
        attributes: {
          caps: {
            default: null,
            parseHTML: (el) => (el.hasAttribute("data-caps") ? true : null),
            renderHTML: (a) => (a.caps ? { "data-caps": "", style: "text-transform: uppercase" } : {}),
          },
          smallCaps: {
            default: null,
            parseHTML: (el) => (el.hasAttribute("data-small-caps") ? true : null),
            renderHTML: (a) => (a.smallCaps ? { "data-small-caps": "", style: "font-variant: small-caps" } : {}),
          },
          charSpacing: {
            default: null,
            parseHTML: (el) => (el.getAttribute("data-spacing") ? Number(el.getAttribute("data-spacing")) : null),
            renderHTML: (a) => (typeof a.charSpacing === "number" && a.charSpacing ? { "data-spacing": String(a.charSpacing), style: `letter-spacing: ${a.charSpacing}pt` } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      changeCase:
        (mode) =>
        ({ state, tr, dispatch }) => {
          let { from, to } = state.selection;
          if (from === to) {
            // the word at the cursor
            const $p = state.selection.$from;
            const text = $p.parent.textContent;
            const off = $p.parentOffset;
            let a = off;
            let b = off;
            while (a > 0 && /[\p{L}\p{N}'’]/u.test(text[a - 1])) a--;
            while (b < text.length && /[\p{L}\p{N}'’]/u.test(text[b])) b++;
            if (a === b) return false;
            from = $p.start() + a;
            to = $p.start() + b;
          }
          const all = state.doc.textBetween(from, to, "\n", "\n");
          const m = mode || nextCase(all);
          const before = state.doc.textBetween(Math.max(state.selection.$from.start(), from - 3), from, " ", " ");
          let atStart = !before.trim() || /[.!?]\s*$/.test(before);
          state.doc.nodesBetween(from, to, (n, pos) => {
            if (!n.isText) return true;
            const a = Math.max(from, pos);
            const b = Math.min(to, pos + n.nodeSize);
            const t = n.text!.slice(a - pos, b - pos);
            const c = changeCase(t, m, atStart);
            atStart = /[.!?]\s*$/.test(t) || (atStart && !/\p{L}/u.test(t));
            if (c !== t) tr.replaceWith(tr.mapping.map(a), tr.mapping.map(b), state.schema.text(c, n.marks));
            return false;
          });
          tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(from, -1), tr.mapping.map(to)));
          if (dispatch) dispatch(tr);
          return true;
        },
      setRunFormat:
        (attrs) =>
        ({ chain }) =>
          chain().setMark("textStyle", attrs).removeEmptyTextStyle().run(),
      copyFormat:
        (sticky = false) =>
        ({ state, tr, dispatch }) => {
          const $f = state.selection.$from;
          const marks = (state.selection.empty ? state.storedMarks || $f.marks() : (state.doc.nodeAt(state.selection.from)?.marks ?? $f.marks())).filter((m) => !KEEP_MARKS.has(m.type.name));
          const parent = $f.parent;
          const para = PARA_TYPES.includes(parent.type.name) ? Object.fromEntries(PARA_COPY.map((k) => [k, parent.attrs[k] ?? null])) : null;
          const p: Painter = { marks: [...marks], para, heading: parent.type.name === "heading" ? Number(parent.attrs.level) : null, sticky };
          if (dispatch) dispatch(tr.setMeta(painterKey, p));
          return true;
        },
      cancelFormatPainter:
        () =>
        ({ tr, dispatch, state }) => {
          if (!painterKey.getState(state)) return false;
          if (dispatch) dispatch(tr.setMeta(painterKey, null));
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    return {
      "Shift-F3": () => this.editor.commands.changeCase(),
      "Mod-d": () => (this.options.onFontDialog(), true),
      Escape: () => this.editor.commands.cancelFormatPainter(),
      "Mod-Shift-c": () => this.editor.commands.copyFormat(),
      "Mod-Shift-k": () => {
        const on = !this.editor.getAttributes("textStyle").smallCaps;
        return this.editor.commands.setRunFormat({ smallCaps: on || null });
      },
      "Mod-Shift-a": () => {
        const on = !this.editor.getAttributes("textStyle").caps;
        return this.editor.commands.setRunFormat({ caps: on || null });
      },
    };
  },
  addProseMirrorPlugins() {
    const painter = new Plugin<Painter | null>({
      key: painterKey,
      state: {
        init: () => null,
        apply: (tr, v) => (tr.getMeta(painterKey) !== undefined ? (tr.getMeta(painterKey) as Painter | null) : v),
      },
      props: {
        attributes: (state): Record<string, string> => (painterKey.getState(state) ? { class: "fmt-painter" } : {}),
        handleDOMEvents: {
          mouseup: (view) => {
            if (!painterKey.getState(view.state)) return false;
            // after the browser has finished the selection
            setTimeout(() => paintSelection(view), 0);
            return false;
          },
        },
      },
    });
    const tabs = new Plugin({
      key: tabKey,
      state: {
        init: () => ({ widths: new Map<number, { w: number; leader?: string }>(), deco: DecorationSet.empty }),
        apply(tr, old, _o, next) {
          const m = tr.getMeta(tabKey) as Map<number, { w: number; leader?: string }> | undefined;
          if (m) return { widths: m, deco: tabDecos(next.doc, m) };
          if (!tr.docChanged) return old;
          const widths = new Map<number, { w: number; leader?: string }>();
          old.widths.forEach((v, k) => {
            const r = tr.mapping.mapResult(k, 1);
            if (!r.deleted) widths.set(r.pos, v);
          });
          return { widths, deco: tabDecos(next.doc, widths) };
        },
      },
      props: { decorations: (state) => tabKey.getState(state)?.deco },
      view: (view) => {
        let frame = 0;
        let rounds = 0;
        const measure = () => {
          frame = 0;
          if (view.isDestroyed) return;
          const next = measureTabs(view);
          if (next) {
            if (++rounds > 6) return; // settle: lines moving can flip widths back and forth
            view.dispatch(view.state.tr.setMeta(tabKey, next).setMeta("addToHistory", false));
          } else rounds = 0;
        };
        const schedule = () => {
          if (!frame) frame = requestAnimationFrame(measure);
        };
        schedule();
        return {
          update: (v, prev) => {
            if (v.state.doc !== prev.doc || tabKey.getState(v.state) !== tabKey.getState(prev)) {
              if (v.state.doc !== prev.doc) rounds = 0;
              schedule();
            }
          },
          destroy: () => frame && cancelAnimationFrame(frame),
        };
      },
    });
    return [painter, tabs];
  },
});

function paintSelection(view: EditorView) {
  const p = painterKey.getState(view.state);
  const { from, to, empty } = view.state.selection;
  if (!p || empty) return;
  const tr = view.state.tr;
  const schema = view.state.schema;
  view.state.doc.nodesBetween(from, to, (n, pos) => {
    if (n.isText) {
      const a = Math.max(from, pos);
      const b = Math.min(to, pos + n.nodeSize);
      for (const m of n.marks) if (!KEEP_MARKS.has(m.type.name)) tr.removeMark(a, b, m.type);
      for (const m of p.marks) tr.addMark(a, b, m);
      return false;
    }
    if (p.para && PARA_TYPES.includes(n.type.name)) {
      const type = p.heading ? schema.nodes.heading : schema.nodes.paragraph;
      const attrs: Record<string, unknown> = { ...n.attrs, ...p.para };
      if (p.heading) attrs.level = p.heading;
      else delete attrs.level;
      tr.setNodeMarkup(pos, type, Object.fromEntries(Object.keys(type.spec.attrs || {}).map((k) => [k, attrs[k] ?? null])));
    }
    return true;
  });
  if (!p.sticky) tr.setMeta(painterKey, null);
  view.dispatch(tr);
}

function tabDecos(doc: PMNodeT, widths: Map<number, { w: number; leader?: string }>): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((n, pos) => {
    if (!n.isText || !n.text!.includes("\t")) return true;
    for (let i = n.text!.indexOf("\t"); i >= 0; i = n.text!.indexOf("\t", i + 1)) {
      const at = pos + i;
      const w = widths.get(at);
      decos.push(Decoration.inline(at, at + 1, { class: `word-tab${w?.leader ? ` word-tab-${w.leader}` : ""}`, style: w ? `width: ${w.w.toFixed(2)}px` : "" }));
    }
    return false;
  });
  return DecorationSet.create(doc, decos);
}

/** New tab widths when they differ from the drawn ones, else null. */
function measureTabs(view: EditorView): Map<number, { w: number; leader?: string }> | null {
  const old = tabKey.getState(view.state)?.widths || new Map();
  const next = new Map<number, { w: number; leader?: string }>();
  let changed = false;
  view.state.doc.descendants((block, bpos) => {
    if (!block.isTextblock) return true;
    if (!block.textContent.includes("\t")) return false;
    const dom = view.nodeDOM(bpos) as HTMLElement | null;
    if (!dom || !dom.getBoundingClientRect) return false;
    const rect = dom.getBoundingClientRect();
    const scale = dom.offsetWidth ? rect.width / dom.offsetWidth : 1;
    const ptPx = (4 / 3) * scale;
    const stops = (parseJson<TabStop[]>(block.attrs.tabs) || []) as TabStop[];
    // tab characters of the paragraph, in order, and the text after each one
    const tabsAt: number[] = [];
    const text = block.textContent;
    block.forEach((c, o) => {
      if (c.isText) for (let i = c.text!.indexOf("\t"); i >= 0; i = c.text!.indexOf("\t", i + 1)) tabsAt.push(bpos + 1 + o + i);
    });
    let shift = 0;
    let lineTop = -1;
    tabsAt.forEach((at, k) => {
      let c0: { left: number; top: number };
      let c1: { left: number };
      try {
        c0 = view.coordsAtPos(at, 1);
        c1 = view.coordsAtPos(at + 1, -1);
      } catch {
        return;
      }
      if (Math.abs(c0.top - lineTop) > 2) {
        shift = 0;
        lineTop = c0.top;
      }
      // the drawn width (the tab character inside its box can measure wider than the box)
      const cur = old.get(at)?.w ?? (c1.left - c0.left) / scale;
      c1 = { left: c0.left + cur * scale };
      const x = (c0.left + shift - rect.left) / ptPx;
      const segEnd = k + 1 < tabsAt.length ? tabsAt[k + 1] : bpos + block.nodeSize - 1;
      let after = 0;
      let beforeDot = 0;
      try {
        after = (view.coordsAtPos(segEnd, -1).left - c1.left) / ptPx;
        const seg = text.slice(at - bpos - 1 + 1, segEnd - bpos - 1);
        const dot = seg.search(/[.,]\d/);
        beforeDot = dot >= 0 ? (view.coordsAtPos(at + 1 + dot, -1).left - c1.left) / ptPx : after;
      } catch {
        /* keep 0 */
      }
      const t = tabWidth(Math.max(0, x), stops, Math.max(0, after), Math.max(0, beforeDot));
      const w = Math.max(1, t.width * ptPx) / scale;
      next.set(at, { w, leader: t.leader });
      if (Math.abs(w - cur) > 0.75 || old.get(at)?.leader !== t.leader) changed = true;
      shift += w * scale - cur * scale;
    });
    return false;
  });
  if (!changed && next.size === old.size) return null;
  return next;
}

export const formatPainterOn = (state: EditorState) => !!painterKey.getState(state);
