"use client";

// View › Split: a second pane on the same document, scrolled on its own (the
// way Word splits its window). The pane is a second ProseMirror view of the
// editor's document. It keeps in step with the editor by taking each of the
// editor's changes, and what is typed in it goes to the editor as the same
// steps, so collaboration, track changes, protection and undo all apply as if
// it had been typed above. It shows the document as one continuous page (Web
// layout); pictures, charts and other objects show as the editor writes them
// out.
import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/core";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { keymap } from "@tiptap/pm/keymap";
import { baseKeymap, toggleMark } from "@tiptap/pm/commands";

const FROM_EDITOR = "splitFromEditor";

export function SplitPane({ editor, editable, height, onResize, onClose, className }: { editor: Editor; editable: boolean; height: number; onResize: (h: number) => void; onClose: () => void; className: string }) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const editableRef = useRef(editable);
  editableRef.current = editable;

  useEffect(() => {
    if (!host.current) return;
    const schema = editor.schema;
    const forward = (tr: Transaction) => {
      // the editor applies the steps (and may refuse them, e.g. under protection); its change comes back below
      const main = editor.state.tr;
      for (const step of tr.steps) if (main.maybeStep(step).failed) return;
      if (tr.getMeta("uiEvent")) main.setMeta("uiEvent", tr.getMeta("uiEvent"));
      editor.view.dispatch(main);
    };
    const run = (name: "undo" | "redo") => () => {
      editor.commands[name]();
      return true;
    };
    const markKey = (mark: string) => (state: EditorState, dispatch?: (tr: Transaction) => void) => (schema.marks[mark] ? toggleMark(schema.marks[mark])(state, dispatch) : false);
    const view = new EditorView(host.current, {
      state: EditorState.create({
        doc: editor.state.doc,
        plugins: [keymap({ "Mod-z": run("undo"), "Mod-y": run("redo"), "Shift-Mod-z": run("redo"), "Mod-b": markKey("bold"), "Mod-i": markKey("italic"), "Mod-u": markKey("underline") }), keymap(baseKeymap)],
      }),
      editable: () => editableRef.current,
      attributes: { class: "ProseMirror", "data-testid": "split-pane-editor", spellcheck: "false" },
      dispatchTransaction(tr) {
        if (tr.getMeta(FROM_EDITOR)) {
          view.updateState(view.state.apply(tr));
          return;
        }
        if (tr.docChanged) {
          // keep where the cursor will be once the editor's change comes back
          const sel = tr.selection;
          forward(tr);
          if (view.state.doc.eq(tr.doc)) {
            try {
              view.updateState(view.state.apply(view.state.tr.setSelection(TextSelection.create(view.state.doc, sel.from, sel.to)).setMeta(FROM_EDITOR, true)));
            } catch {
              /* the selection's place no longer exists */
            }
          }
          return;
        }
        view.updateState(view.state.apply(tr));
      },
    });
    viewRef.current = view;
    // the editor's changes, from here, from the editor or from collaborators
    const onTr = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.docChanged) return;
      const v = viewRef.current;
      if (!v) return;
      if (!v.state.doc.eq(transaction.before)) {
        // out of step: start again from the editor's document
        v.updateState(EditorState.create({ doc: editor.state.doc, plugins: v.state.plugins }));
        return;
      }
      const tr = v.state.tr.setMeta(FROM_EDITOR, true).setMeta("addToHistory", false);
      for (const step of transaction.steps) tr.step(step);
      v.dispatch(tr);
      // changes the editor's plugins appended (protection, track changes) arrive after this one: catch up with them
      queueMicrotask(() => {
        const w = viewRef.current;
        if (!w || w.state.doc.eq(editor.state.doc)) return;
        const { from, to } = w.state.selection;
        const size = editor.state.doc.content.size;
        let st = EditorState.create({ doc: editor.state.doc, plugins: w.state.plugins });
        try {
          st = st.apply(st.tr.setSelection(TextSelection.create(st.doc, Math.min(from, size), Math.min(to, size))));
        } catch {
          /* keep the start */
        }
        w.updateState(st);
      });
    };
    editor.on("transaction", onTr);
    return () => {
      editor.off("transaction", onTr);
      view.destroy();
      viewRef.current = null;
    };
  }, [editor]);

  useEffect(() => {
    viewRef.current?.setProps({ editable: () => editable });
  }, [editable]);

  const drag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const start = height;
    const move = (ev: MouseEvent) => onResize(Math.max(80, Math.min(window.innerHeight - 160, start - (ev.clientY - startY))));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div className="flex flex-col border-t border-slate-300 bg-slate-100 no-print" style={{ height }} data-testid="split-pane">
      <div className="h-2 cursor-row-resize bg-slate-300 hover:bg-indigo-300 relative" onMouseDown={drag} onDoubleClick={onClose} title="Drag to resize; double-click to remove the split" data-testid="split-divider">
        <button className="absolute right-2 -top-2.5 text-[10px] bg-white border border-slate-300 rounded px-1.5 text-slate-600 hover:bg-slate-50" onMouseDown={(e) => e.stopPropagation()} onClick={onClose} data-testid="split-close">
          Remove split
        </button>
      </div>
      <div className="flex-1 overflow-auto py-4 px-4">
        <div className={`relative word-doc web-layout ${className}`} lang="en">
          <div className="paper">
            <div ref={host} />
          </div>
        </div>
      </div>
    </div>
  );
}
