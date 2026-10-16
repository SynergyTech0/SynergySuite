"use client";

// The Changes pane: every tracked insertion and deletion, with who made it
// and when, and buttons to accept or reject each one or all of them.
import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import { authorColor, trackedChanges, type TrackedChange } from "./track-changes";

function when(d: string | null): string {
  if (!d) return "";
  const t = Date.parse(d);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function goToRange(editor: Editor, from: number, to: number) {
  editor.chain().focus().setTextSelection({ from, to }).scrollIntoView().run();
  try {
    const dom = editor.view.domAtPos(from).node as HTMLElement;
    (dom.nodeType === 1 ? dom : dom.parentElement)?.scrollIntoView({ block: "center" });
  } catch {
    /* position not rendered */
  }
}

/** Move the selection to the next (or previous) tracked change after the cursor. */
export function stepChange(editor: Editor, dir: 1 | -1): boolean {
  const list = trackedChanges(editor.state.doc);
  if (!list.length) return false;
  const { from, to } = editor.state.selection;
  const c = dir > 0 ? list.find((x) => x.from >= to && !(x.from === from && x.to === to)) ?? list[0] : [...list].reverse().find((x) => x.to <= from) ?? list[list.length - 1];
  goToRange(editor, c.from, c.to);
  return true;
}

export function ChangesPanel({ editor, canEdit, tracking, onToggleTracking, onClose }: { editor: Editor; canEdit: boolean; tracking: boolean; onToggleTracking: () => void; onClose: () => void }) {
  const [changes, setChanges] = useState<TrackedChange[]>(() => trackedChanges(editor.state.doc));
  useEffect(() => {
    const on = () => setChanges(trackedChanges(editor.state.doc));
    editor.on("update", on);
    return () => {
      editor.off("update", on);
    };
  }, [editor]);
  return (
    <aside className="w-80 shrink-0 border-l border-slate-200 bg-white overflow-y-auto no-print" data-testid="changes-pane">
      <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-2.5 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-800">Changes</h2>
        <span className="text-xs text-slate-400">{changes.length}</span>
        <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700 text-sm">✕</button>
      </div>
      <div className="px-4 py-2 border-b border-slate-100 flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1.5 text-slate-600">
          <input type="checkbox" checked={tracking} onChange={onToggleTracking} disabled={!canEdit} data-testid="track-toggle" /> Track changes
        </label>
        <span className="ml-auto" />
        <button className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40" disabled={!canEdit || !changes.length} onClick={() => editor.chain().acceptAllChanges().run()} data-testid="accept-all">Accept all</button>
        <button className="px-2 py-1 rounded bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-40" disabled={!canEdit || !changes.length} onClick={() => editor.chain().rejectAllChanges().run()} data-testid="reject-all">Reject all</button>
      </div>
      {changes.length === 0 && <p className="text-xs text-slate-400 p-4 text-center">No tracked changes. Turn on Track changes or switch to Suggesting to record edits.</p>}
      <div className="divide-y divide-slate-100">
        {changes.map((c, i) => (
          <div key={`${c.from}-${i}`} className="p-3 hover:bg-slate-50" data-testid="change-item" data-kind={c.kind}>
            <button className="w-full text-left" onClick={() => goToRange(editor, c.from, c.to)}>
              <div className="flex items-center gap-1.5 text-xs">
                <span className="w-2 h-2 rounded-full" style={{ background: authorColor(c.author) }} />
                <span className="font-semibold text-slate-800">{c.author || "Unknown"}</span>
                <span className="text-slate-400">{when(c.date)}</span>
              </div>
              <div className="text-[13px] text-slate-700 mt-1">
                <span className="text-slate-500">{c.kind === "insertion" ? "Inserted: " : "Deleted: "}</span>
                <span className={c.kind === "insertion" ? "underline" : "line-through"}>{c.text.length > 140 ? `${c.text.slice(0, 140)}…` : c.text}</span>
              </div>
            </button>
            {canEdit && (
              <div className="flex gap-3 mt-1.5 text-[11px]">
                <button className="text-emerald-700 hover:underline" onClick={() => editor.chain().acceptChanges({ from: c.from, to: c.to }).run()} data-testid="accept-change">✓ Accept</button>
                <button className="text-rose-700 hover:underline" onClick={() => editor.chain().rejectChanges({ from: c.from, to: c.to }).run()} data-testid="reject-change">✕ Reject</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
