// TipTap pieces for slide text that PowerPoint has and StarterKit lacks:
// subscript/superscript marks and paragraph line/space-before/space-after.
//
// Line spacing is stored as CSS line-height. A PowerPoint multiple m is written
// as line-height m × 1.2 (single spacing is 1.2 font heights, matching the
// slide text CSS); an exact spacing is written in points ("24pt").
import { Extension, Mark } from "@tiptap/core";
import { LINE_UNIT } from "@/lib/slides/text";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    subscript: { toggleSubscript: () => ReturnType };
    superscript: { toggleSuperscript: () => ReturnType };
    paragraphSpacing: {
      /** line spacing as a PowerPoint multiple (1, 1.5, 2…); null resets */
      setLineSpacing: (multiple: number | null) => ReturnType;
      /** space before/after a paragraph in points; null resets */
      setParagraphSpacing: (before: number | null, after: number | null) => ReturnType;
    };
  }
}

export const Subscript = Mark.create({
  name: "subscript",
  excludes: "superscript",
  parseHTML: () => [{ tag: "sub" }, { style: "vertical-align", getAttrs: (v) => (v === "sub" ? null : false) }],
  renderHTML: () => ["sub", 0],
  addCommands() {
    return { toggleSubscript: () => ({ commands }) => commands.toggleMark(this.name) };
  },
  addKeyboardShortcuts() {
    return { "Mod-=": () => this.editor.commands.toggleSubscript() };
  },
});

export const Superscript = Mark.create({
  name: "superscript",
  excludes: "subscript",
  parseHTML: () => [{ tag: "sup" }, { style: "vertical-align", getAttrs: (v) => (v === "super" ? null : false) }],
  renderHTML: () => ["sup", 0],
  addCommands() {
    return { toggleSuperscript: () => ({ commands }) => commands.toggleMark(this.name) };
  },
  addKeyboardShortcuts() {
    return { "Mod-Shift-=": () => this.editor.commands.toggleSuperscript() };
  },
});

const styleAttr = (css: string, value: (v: unknown) => string | null) => ({
  default: null,
  parseHTML: (el: HTMLElement) => el.style.getPropertyValue(css) || null,
  renderHTML: (attrs: Record<string, unknown>) => {
    const v = value(attrs);
    return v ? { style: `${css}: ${v}` } : {};
  },
});

export const ParagraphSpacing = Extension.create({
  name: "paragraphSpacing",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          lineHeight: styleAttr("line-height", (a) => ((a as { lineHeight?: string }).lineHeight || null)),
          spaceBefore: styleAttr("margin-top", (a) => ((a as { spaceBefore?: string }).spaceBefore || null)),
          spaceAfter: styleAttr("margin-bottom", (a) => ((a as { spaceAfter?: string }).spaceAfter || null)),
        },
      },
    ];
  },
  addCommands() {
    return {
      setLineSpacing:
        (m) =>
        ({ commands }) =>
          commands.updateAttributes("paragraph", { lineHeight: m ? String(Math.round(m * LINE_UNIT * 1000) / 1000) : null }),
      setParagraphSpacing:
        (before, after) =>
        ({ commands }) =>
          commands.updateAttributes("paragraph", { spaceBefore: before ? `${before}pt` : null, spaceAfter: after ? `${after}pt` : null }),
    };
  },
});
