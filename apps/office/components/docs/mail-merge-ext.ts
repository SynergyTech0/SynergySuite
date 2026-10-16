// A mail-merge field («First name»): Word's MERGEFIELD. With a preview record
// set it shows that recipient's value instead.
import { Node, mergeAttributes } from "@tiptap/core";
import { liveView } from "./refs";
import { fieldValue } from "@/lib/docs/mail-merge";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mergeField: {
      insertMergeField: (name: string) => ReturnType;
    };
  }
}

type Opts = { preview: () => Record<string, string> | null };

export const MergeField = Node.create<Opts>({
  name: "mergeField",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addOptions() {
    return { preview: () => null };
  },
  addAttributes() {
    return { name: { default: "", parseHTML: (el) => el.getAttribute("data-merge") || "", renderHTML: (a) => ({ "data-merge": a.name }) } };
  },
  parseHTML: () => [{ tag: "span[data-merge]" }],
  renderHTML: ({ node, HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { class: "word-merge" }), `«${node.attrs.name}»`],
  renderText: ({ node }) => `«${node.attrs.name}»`,
  addCommands() {
    return {
      insertMergeField:
        (name) =>
        ({ chain }) =>
          chain().insertContent({ type: this.name, attrs: { name } }).run(),
    };
  },
  addNodeView() {
    const preview = this.options.preview;
    return ({ editor, node, getPos }) => {
      const view = liveView(editor, node, getPos as () => number | undefined, "word-merge", (n) => {
        const rec = preview();
        return rec ? fieldValue(rec, String(n.attrs.name)) : `«${n.attrs.name}»`;
      });
      const sync = () => view.dom.classList.toggle("word-merge-preview", !!preview());
      sync();
      editor.on("transaction", sync);
      return { ...view, destroy: () => (view.destroy(), editor.off("transaction", sync)) };
    };
  },
});
