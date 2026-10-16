// Equations: an inline node holding LaTeX, drawn as MathML by the browser and
// saved to .docx as Office Math (OMML). A display equation sits on its own
// line, centred, like Word's "Display" equations; Alt+= inserts one.
import { Node, mergeAttributes } from "@tiptap/core";
import { latexToMathml, latexPlain } from "@/lib/slides/math";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    equation: {
      insertEquation: (latex: string, display: boolean) => ReturnType;
    };
  }
}

const mathml = (latex: string, display: boolean) => {
  try {
    return latexToMathml(latex, display);
  } catch {
    return "";
  }
};

export const Equation = Node.create<{ onOpen: (pos: number | null) => void }>({
  name: "equation",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addOptions() {
    return { onOpen: () => {} };
  },
  addAttributes() {
    return {
      latex: { default: "", parseHTML: (el) => el.getAttribute("data-latex") || "", renderHTML: (a) => ({ "data-latex": a.latex }) },
      display: { default: false, parseHTML: (el) => el.getAttribute("data-display") === "true", renderHTML: (a) => ({ "data-display": String(!!a.display) }) },
    };
  },
  parseHTML: () => [{ tag: "span[data-latex]" }],
  renderHTML: ({ node, HTMLAttributes }) => {
    let plain = String(node.attrs.latex);
    try {
      plain = latexPlain(plain);
    } catch {
      /* keep the source */
    }
    return ["span", mergeAttributes(HTMLAttributes, { class: `word-eq${node.attrs.display ? " word-eq-display" : ""}` }), plain];
  },
  addCommands() {
    return {
      insertEquation:
        (latex, display) =>
        ({ chain }) =>
          chain().insertContent({ type: "equation", attrs: { latex, display } }).run(),
    };
  },
  addKeyboardShortcuts() {
    return { "Alt-=": () => (this.editor.isEditable ? (this.options.onOpen(null), true) : false) };
  },
  addNodeView() {
    const opts = this.options;
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("span");
      dom.contentEditable = "false";
      let cur = node;
      const draw = () => {
        dom.className = `word-eq${cur.attrs.display ? " word-eq-display" : ""}`;
        dom.setAttribute("data-latex", String(cur.attrs.latex));
        dom.innerHTML = mathml(String(cur.attrs.latex), !!cur.attrs.display) || `<span class="word-eq-error">${String(cur.attrs.latex).replace(/</g, "&lt;")}</span>`;
      };
      draw();
      dom.title = "Double-click to edit the equation";
      dom.addEventListener("dblclick", (e) => {
        e.preventDefault();
        const p = (getPos as () => number | undefined)();
        if (p !== undefined && editor.isEditable) opts.onOpen(p);
      });
      return {
        dom,
        update: (n) => {
          if (n.type !== cur.type) return false;
          const changed = n.attrs.latex !== cur.attrs.latex || n.attrs.display !== cur.attrs.display;
          cur = n;
          if (changed) draw();
          return true;
        },
        ignoreMutation: () => true,
      };
    };
  },
});
