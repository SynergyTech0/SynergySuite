// Restrict editing in the editor: content controls (plain and rich text,
// check box, drop-down list, combo box, date picker), editable exceptions in a
// read-only document (Word's permStart/permEnd ranges) and the enforcement of
// the document's protection: a transaction that would change what the
// protection does not allow is dropped. Changes from collaborators are never
// dropped (they were checked where they were made).
import { Extension, Mark, Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { AddMarkStep, RemoveMarkStep, AttrStep, type Step } from "@tiptap/pm/transform";
import type { Node as PMNodeT } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { CHECKED, UNCHECKED, parseItems, type ControlKind, type Protection } from "@/lib/docs/protection";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    protection: {
      insertContentControl: (kind: ControlKind, attrs?: Record<string, unknown>) => ReturnType;
      /** replace a control's content with plain text (a picked list item or date) */
      setContentControlText: (pos: number, text: string, attrs?: Record<string, unknown>) => ReturnType;
      toggleContentControlCheckbox: (pos: number) => ReturnType;
      markEditableRange: () => ReturnType;
      /** wrap the selected paragraphs in a block-level (rich text) content control */
      insertBlockControl: (attrs?: Record<string, unknown>) => ReturnType;
      /** take the paragraphs back out of the block control around the selection */
      removeBlockControl: () => ReturnType;
      clearEditableRange: () => ReturnType;
    };
  }
}

export const EditableRange = Mark.create({
  name: "editableRange",
  inclusive: true,
  excludes: "",
  addAttributes() {
    return { group: { default: "everyone", parseHTML: (el) => el.getAttribute("data-editable") || "everyone", renderHTML: (a) => ({ "data-editable": a.group }) } };
  },
  parseHTML: () => [{ tag: "span[data-editable]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { class: "editable-range" }), 0],
});

const ccAttr = (name: string, def: unknown = null) => ({
  default: def,
  parseHTML: (el: HTMLElement) => {
    const v = el.getAttribute(`data-cc-${name}`);
    return typeof def === "boolean" ? v === "true" : v ?? def;
  },
  renderHTML: (a: Record<string, unknown>) => (a[name] === null || a[name] === undefined || a[name] === false ? {} : { [`data-cc-${name}`]: String(a[name]) }),
});

export const ContentControl = Node.create<{ onPick: (pos: number) => void }>({
  name: "contentControl",
  group: "inline",
  inline: true,
  content: "text*",
  marks: "_",
  addOptions() {
    return { onPick: () => {} };
  },
  addAttributes() {
    return {
      kind: ccAttr("kind", "richText"),
      tag: ccAttr("tag"),
      title: ccAttr("title"),
      items: ccAttr("items"),
      checked: ccAttr("checked", false),
      dateFormat: ccAttr("dateFormat"),
      date: ccAttr("date"),
      placeholder: ccAttr("placeholder"),
      lockContents: ccAttr("lockContents", false),
      lockControl: ccAttr("lockControl", false),
    };
  },
  parseHTML: () => [{ tag: "span[data-cc-kind]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { class: "word-cc" }), 0],
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("span");
      dom.className = "word-cc";
      const content = document.createElement("span");
      content.className = "word-cc-content";
      dom.appendChild(content);
      let button: HTMLElement | null = null;
      let cur = node;
      const sync = () => {
        for (const [k, v] of Object.entries(cur.attrs)) {
          if (v === null || v === false || v === undefined) dom.removeAttribute(`data-cc-${k}`);
          else dom.setAttribute(`data-cc-${k}`, String(v));
        }
        if (cur.content.size === 0) {
          dom.setAttribute("data-empty", "");
          content.setAttribute("data-placeholder", String(cur.attrs.placeholder || (cur.attrs.kind === "date" ? "Click or tap to enter a date." : cur.attrs.kind === "dropdown" || cur.attrs.kind === "comboBox" ? "Choose an item." : "Click or tap here to enter text.")));
        } else dom.removeAttribute("data-empty");
        dom.title = String(cur.attrs.title || "");
        const kind = cur.attrs.kind as ControlKind;
        const wants = kind === "dropdown" || kind === "comboBox" || kind === "date";
        if (wants && !button) {
          button = document.createElement("span");
          button.className = "word-cc-button";
          button.contentEditable = "false";
          button.setAttribute("data-cc-pick", "");
          button.addEventListener("mousedown", (e) => {
            e.preventDefault();
            const pos = (getPos as () => number | undefined)();
            if (pos !== undefined) this.options.onPick(pos);
          });
          dom.appendChild(button);
        } else if (!wants && button) {
          button.remove();
          button = null;
        }
        if (button) button.textContent = kind === "date" ? "📅" : "▾";
      };
      sync();
      if (node.attrs.kind === "checkbox")
        dom.addEventListener("mousedown", (e) => {
          if (!editor.isEditable) return;
          e.preventDefault();
          const pos = (getPos as () => number | undefined)();
          if (pos !== undefined) editor.commands.toggleContentControlCheckbox(pos);
        });
      return {
        dom,
        contentDOM: content,
        update: (n: PMNodeT) => {
          if (n.type !== cur.type) return false;
          cur = n;
          sync();
          return true;
        },
        ignoreMutation: (m: MutationRecord | { type: "selection"; target: globalThis.Node }) => m.type !== "selection" && m.target !== content && !content.contains(m.target as globalThis.Node),
      };
    };
  },
  addCommands() {
    return {
      insertContentControl:
        (kind, attrs = {}) =>
        ({ state, tr, dispatch }) => {
          const type = state.schema.nodes.contentControl;
          const sel = state.doc.textBetween(state.selection.from, state.selection.to, " ");
          let text = kind === "checkbox" ? UNCHECKED : sel;
          if ((kind === "dropdown" || kind === "comboBox") && !sel) text = "";
          const node = type.create({ kind, ...attrs }, text ? state.schema.text(text) : null);
          if (dispatch) tr.replaceSelectionWith(node, false);
          return true;
        },
      setContentControlText:
        (pos, text, attrs) =>
        ({ state, tr, dispatch }) => {
          const n = state.doc.nodeAt(pos);
          if (!n || n.type.name !== "contentControl") return false;
          if (dispatch) {
            tr.replaceWith(pos + 1, pos + n.nodeSize - 1, text ? state.schema.text(text, n.firstChild?.marks) : []);
            if (attrs) tr.setNodeMarkup(pos, undefined, { ...n.attrs, ...attrs });
          }
          return true;
        },
      toggleContentControlCheckbox:
        (pos) =>
        ({ state, tr, dispatch }) => {
          const n = state.doc.nodeAt(pos);
          if (!n || n.attrs.kind !== "checkbox") return false;
          const checked = !n.attrs.checked;
          if (dispatch) {
            tr.replaceWith(pos + 1, pos + n.nodeSize - 1, state.schema.text(checked ? CHECKED : UNCHECKED, n.firstChild?.marks));
            tr.setNodeMarkup(pos, undefined, { ...n.attrs, checked });
          }
          return true;
        },
      markEditableRange:
        () =>
        ({ commands }) =>
          commands.setMark("editableRange", { group: "everyone" }),
      clearEditableRange:
        () =>
        ({ commands }) =>
          commands.unsetMark("editableRange", { extendEmptyMarkRange: true }),
    };
  },
});

/**
 * A block-level content control: paragraphs, lists and tables held together
 * (Word's rich text control around blocks, a group, or a building block such
 * as a cover page). Its title shows on a tab while the cursor is inside.
 */
export const BlockControl = Node.create({
  name: "blockControl",
  group: "block",
  content: "block+",
  defining: true,
  isolating: false,
  addAttributes() {
    return {
      kind: ccAttr("kind", "richText"),
      tag: ccAttr("tag"),
      title: ccAttr("title"),
      lockContents: ccAttr("lockContents", false),
      lockControl: ccAttr("lockControl", false),
      gallery: ccAttr("gallery"),
      category: ccAttr("category"),
    };
  },
  parseHTML: () => [{ tag: "div[data-block-cc]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-block-cc": "", class: "word-bcc" }), 0],
  addProseMirrorPlugins() {
    // the controls around the cursor show their frame and title
    return [
      new Plugin({
        props: {
          decorations: (state) => {
            const $f = state.selection.$from;
            const decos: Decoration[] = [];
            for (let d = $f.depth; d > 0; d--) if ($f.node(d).type.name === "blockControl") decos.push(Decoration.node($f.before(d), $f.after(d), { class: "word-bcc-active" }));
            return decos.length ? DecorationSet.create(state.doc, decos) : null;
          },
        },
      }),
    ];
  },
  addCommands() {
    return {
      insertBlockControl:
        (attrs = {}) =>
        ({ commands }) =>
          commands.wrapIn(this.name, { kind: "richText", ...attrs }),
      removeBlockControl:
        () =>
        ({ commands }) =>
          commands.lift(this.name),
    };
  },
});

export const protectionKey = new PluginKey("wordProtection");
const BYPASS = "protectionBypass";

const marked = (n: PMNodeT | null | undefined) => !!n && n.marks.some((m) => m.type.name === "editableRange");

/** Whether [a, b] of `doc` lies in an editable exception of a read-only document. */
export function inEditable(doc: PMNodeT, a: number, b: number): boolean {
  if (a === b) {
    const $a = doc.resolve(a);
    if (marked($a.nodeBefore) || marked($a.nodeAfter)) return true;
    // an empty paragraph just made inside an exception (Enter at its end)
    if ($a.parent.isTextblock && $a.parent.content.size === 0 && $a.depth > 0) {
      const idx = $a.index($a.depth - 1);
      const container = $a.node($a.depth - 1);
      const prev = idx > 0 ? container.child(idx - 1) : null;
      const next = idx + 1 < container.childCount ? container.child(idx + 1) : null;
      return marked(prev?.lastChild) || marked(next?.firstChild);
    }
    return false;
  }
  let leaves = 0;
  let ok = true;
  doc.nodesBetween(a, b, (n) => {
    if (!ok) return false;
    if (n.isLeaf && n.isInline) {
      leaves++;
      if (!marked(n)) ok = false;
    } else if (n.isTextblock && n.content.size === 0) {
      // deleting an empty paragraph: allowed next to an exception
    }
    return true;
  });
  if (!ok) return false;
  if (!leaves) return inEditable(doc, a, a) || inEditable(doc, b, b);
  return true;
}

/** The content control whose content holds [a, b] (with its position), if any. */
export function controlAround(doc: PMNodeT, a: number, b: number): { node: PMNodeT; pos: number } | null {
  const $a = doc.resolve(a);
  for (let d = $a.depth; d > 0; d--) {
    const n = $a.node(d);
    if (n.type.name === "contentControl" || n.type.name === "blockControl") {
      const start = $a.before(d);
      if (b <= start + n.nodeSize - 1) return { node: n, pos: start };
    }
  }
  return null;
}

function stepRanges(step: Step): [number, number][] {
  if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) return [[step.from, step.to]];
  if (step instanceof AttrStep) return [[step.pos, step.pos + 1]];
  const out: [number, number][] = [];
  step.getMap().forEach((a, b) => out.push([a, b]));
  return out;
}

/** Whether a local transaction may change the document under the protection. */
export function allowed(tr: Transaction, protection: Protection | undefined): boolean {
  if (!tr.docChanged || tr.getMeta("y-sync$") || tr.getMeta(BYPASS)) return true;
  for (let i = 0; i < tr.steps.length; i++) {
    const step = tr.steps[i];
    const doc = tr.docs[i];
    const ranges = stepRanges(step);
    for (const [a, b] of ranges) {
      // locked controls, protected or not
      const cc = controlAround(doc, a, b);
      if (cc && cc.node.attrs.lockContents && !(step instanceof AttrStep)) return false;
      let lockedGone = false;
      if (b > a)
        doc.nodesBetween(a, b, (n, pos) => {
          if ((n.type.name === "contentControl" || n.type.name === "blockControl") && n.attrs.lockControl && pos >= a && pos + n.nodeSize <= b) lockedGone = true;
          return !lockedGone;
        });
      if (lockedGone) return false;
      if (!protection?.enforced) continue;
      switch (protection.edit) {
        case "comments":
          if (!((step instanceof AddMarkStep || step instanceof RemoveMarkStep) && step.mark.type.name === "comment")) return false;
          break;
        case "readOnly":
          if (!inEditable(doc, a, b)) return false;
          break;
        case "forms":
          if (!cc) return false;
          break;
        case "trackedChanges":
          break;
      }
    }
  }
  return true;
}

export const Protect = Extension.create<{ get: () => Protection | undefined }>({
  name: "wordProtection",
  addOptions() {
    return { get: () => undefined };
  },
  addProseMirrorPlugins() {
    const get = () => this.options.get();
    return [
      new Plugin({
        key: protectionKey,
        filterTransaction: (tr) => allowed(tr, get()),
        // text typed in an exception joins the exception
        appendTransaction: (trs, _old, state: EditorState) => {
          const p = get();
          if (!p?.enforced || p.edit !== "readOnly") return null;
          const type = state.schema.marks.editableRange;
          let tr: Transaction | null = null;
          for (const t of trs) {
            if (!t.docChanged || t.getMeta("y-sync$")) continue;
            t.steps.forEach((step, i) => {
              step.getMap().forEach((_a, _b, c, d) => {
                const from = t.mapping.slice(i + 1).map(c, -1);
                const to = t.mapping.slice(i + 1).map(d, 1);
                if (to <= from) return;
                tr ||= state.tr;
                state.doc.nodesBetween(from, to, (n, pos) => {
                  if (n.isText && !marked(n)) tr!.addMark(Math.max(from, pos), Math.min(to, pos + n.nodeSize), type.create());
                });
              });
            });
          }
          return tr ? (tr as Transaction).setMeta(BYPASS, true).setMeta("addToHistory", false) : null;
        },
        props: {
          attributes: (): Record<string, string> => {
            const p = get();
            return p?.enforced ? { "data-protected": p.edit } : {};
          },
        },
      }),
    ];
  },
});

export { parseItems };
