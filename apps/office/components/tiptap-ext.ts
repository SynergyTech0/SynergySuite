// Small in-house TipTap extensions for the rich toolbar. TipTap ships no
// official font-size, indent, or comment extension, so we add minimal,
// de-branded ones.
import { Extension, Mark, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
    indent: {
      indent: () => ReturnType;
      outdent: () => ReturnType;
    };
    comment: {
      setComment: (threadId: string) => ReturnType;
      removeCommentThread: (threadId: string) => ReturnType;
    };
  }
}

// A comment is a mark carrying a thread id; the thread's messages live in
// Postgres. The mark highlights the commented span and lets us scroll to /
// remove a thread. It rides the CRDT, so highlights sync across editors.
export const CommentMark = Mark.create({
  name: "comment",
  inclusive: false,
  addAttributes() {
    return {
      threadId: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-thread-id"),
        renderHTML: (attrs) => (attrs.threadId ? { "data-thread-id": attrs.threadId } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-thread-id]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ class: "comment-mark" }, HTMLAttributes), 0];
  },
  addCommands() {
    return {
      setComment:
        (threadId) =>
        ({ commands }) =>
          commands.setMark(this.name, { threadId }),
      removeCommentThread:
        (threadId) =>
        ({ state, dispatch }) => {
          const { tr } = state;
          const type = this.type;
          let found = false;
          state.doc.descendants((node, pos) => {
            if (!node.isText) return;
            const m = node.marks.find((mk) => mk.type === type && mk.attrs.threadId === threadId);
            if (m) {
              tr.removeMark(pos, pos + node.nodeSize, type);
              found = true;
            }
          });
          if (found && dispatch) dispatch(tr);
          return found;
        },
    };
  },
});

// Font size rides on TextStyle (a <span style="font-size:…">).
export const FontSize = Extension.create({
  name: "fontSize",
  addOptions() {
    return { types: ["textStyle"] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el) => (el as HTMLElement).style.fontSize || null,
            renderHTML: (attrs) => (attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontSize:
        (size) =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

// Block indent stored as a numeric level, rendered as left padding. Tab / Shift-Tab
// nudge it (unless inside a list, where TipTap's own list indent takes over).
const INDENT_TYPES = ["paragraph", "heading"];
const MAX_INDENT = 8;

export const Indent = Extension.create({
  name: "indent",
  addGlobalAttributes() {
    return [
      {
        types: INDENT_TYPES,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => Number((el as HTMLElement).getAttribute("data-indent")) || 0,
            renderHTML: (attrs) =>
              attrs.indent ? { "data-indent": attrs.indent, style: `padding-left: ${attrs.indent * 2.5}em` } : {},
          },
        },
      },
    ];
  },
  addCommands() {
    const shift =
      (delta: number) =>
      ({ state, dispatch }: { state: import("@tiptap/pm/state").EditorState; dispatch?: (tr: import("@tiptap/pm/state").Transaction) => void }) => {
        const { from, to } = state.selection;
        let tr = state.tr;
        let changed = false;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (INDENT_TYPES.includes(node.type.name)) {
            const cur = (node.attrs.indent as number) || 0;
            const next = Math.min(MAX_INDENT, Math.max(0, cur + delta));
            if (next !== cur) {
              tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
              changed = true;
            }
          }
        });
        if (changed && dispatch) dispatch(tr);
        return changed;
      };
    return { indent: () => shift(1), outdent: () => shift(-1) };
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.isActive("listItem") || this.editor.isActive("taskItem")) return false;
        return this.editor.commands.indent();
      },
      "Shift-Tab": () => {
        if (this.editor.isActive("listItem") || this.editor.isActive("taskItem")) return false;
        return this.editor.commands.outdent();
      },
    };
  },
});
