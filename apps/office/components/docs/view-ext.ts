// View aids drawn as decorations (never stored in the document):
// formatting marks (¶ at paragraph ends, · for spaces, → for tabs, ↵ for line
// breaks) and the Navigation pane's search hits.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNodeT } from "@tiptap/pm/model";
import { searchDocument, type NavOptions } from "@/lib/docs/navigation";

type ViewState = { marks: boolean; query: string; opts: NavOptions; current: number; deco: DecorationSet };
export const viewKey = new PluginKey<ViewState>("wordView");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    wordView: {
      setFormattingMarks: (on: boolean) => ReturnType;
      setNavHighlight: (query: string, opts?: NavOptions, current?: number) => ReturnType;
    };
  }
}

function pilcrow(): HTMLElement {
  const s = document.createElement("span");
  s.className = "fm-para";
  s.setAttribute("contenteditable", "false");
  s.textContent = "¶";
  return s;
}

export function marksDecorations(doc: PMNodeT): Decoration[] {
  const out: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      node.descendants((n, p) => {
        const at = pos + 1 + p;
        if (n.isText) {
          const t = n.text!;
          for (let i = 0; i < t.length; i++) {
            const ch = t[i];
            if (ch === " " || ch === " ") out.push(Decoration.inline(at + i, at + i + 1, { class: ch === " " ? "fm-space" : "fm-nbsp" }));
            else if (ch === "\t") out.push(Decoration.inline(at + i, at + i + 1, { class: "fm-tab" }));
          }
        } else if (n.type.name === "hardBreak") out.push(Decoration.node(at, at + n.nodeSize, { class: "fm-br" }));
        return true;
      });
      out.push(Decoration.widget(pos + node.nodeSize - 1, pilcrow, { side: 1, key: "fm-para", ignoreSelection: true }));
      return false;
    }
    return true;
  });
  return out;
}

function build(state: EditorState, v: Omit<ViewState, "deco">): DecorationSet {
  const decos: Decoration[] = [];
  if (v.marks) decos.push(...marksDecorations(state.doc));
  if (v.query) {
    searchDocument(state.doc, v.query, v.opts).forEach((r, i) => decos.push(Decoration.inline(r.from, r.to, { class: i === v.current ? "nav-hit nav-hit-current" : "nav-hit" })));
  }
  return decos.length ? DecorationSet.create(state.doc, decos) : DecorationSet.empty;
}

export const WordView = Extension.create({
  name: "wordView",
  addCommands() {
    const set =
      (patch: Partial<Omit<ViewState, "deco">>) =>
      ({ tr, dispatch }: { tr: import("@tiptap/pm/state").Transaction; dispatch?: (tr: import("@tiptap/pm/state").Transaction) => void }) => {
        if (dispatch) dispatch(tr.setMeta(viewKey, patch));
        return true;
      };
    return {
      setFormattingMarks: (on) => set({ marks: on }),
      setNavHighlight: (query, opts = {}, current = -1) => set({ query, opts, current }),
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<ViewState>({
        key: viewKey,
        state: {
          init: () => ({ marks: false, query: "", opts: {}, current: -1, deco: DecorationSet.empty }),
          apply(tr, old, _o, state) {
            const patch = tr.getMeta(viewKey) as Partial<ViewState> | undefined;
            if (!patch && !tr.docChanged) return old;
            const next = { ...old, ...(patch || {}) };
            if (!next.marks && !next.query) return { ...next, deco: DecorationSet.empty };
            return { ...next, deco: build(state, next) };
          },
        },
        props: {
          decorations: (state) => viewKey.getState(state)?.deco,
          attributes: (state): Record<string, string> => (viewKey.getState(state)?.marks ? { "data-formatting-marks": "" } : {}),
        },
      }),
    ];
  },
});
