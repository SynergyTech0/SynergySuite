"use client";

// Spelling and grammar: the right-click menu on an underlined word, and the
// pane that lists every issue with its suggestions (Review > Spelling and
// grammar, F7).
import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { addToDictionary, ignoreIssue, proofingOf, replacementsFor, type Found, type ProofMenu } from "./proofing-ext";

function fix(editor: Editor, f: Found, text: string) {
  editor.chain().focus().insertContentAt({ from: f.pos, to: f.end }, text).run();
}

export function ProofContextMenu({ editor, menu, onClose }: { editor: Editor; menu: ProofMenu; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  const f = menu.found;
  const replacements = replacementsFor(f);
  const item = "block w-full text-left px-3 py-1.5 text-sm hover:bg-slate-100";
  return (
    <div ref={ref} className="fixed z-50 min-w-48 bg-white border border-slate-200 rounded-lg shadow-lg py-1 no-print" style={{ left: menu.x, top: menu.y }} data-testid="proof-menu">
      {f.kind === "grammar" && <div className="px-3 py-1 text-xs text-slate-500 max-w-64">{f.message}</div>}
      {replacements.length === 0 && <div className="px-3 py-1.5 text-sm text-slate-400 italic">No suggestions</div>}
      {replacements.slice(0, 6).map((r) => (
        <button
          key={r}
          className={`${item} font-medium`}
          data-testid="proof-suggestion"
          onClick={() => {
            fix(editor, f, r);
            onClose();
          }}
        >
          {r === " " ? "(one space)" : r}
        </button>
      ))}
      <div className="border-t border-slate-100 my-1" />
      <button
        className={item}
        onClick={() => {
          ignoreIssue(editor.view, f);
          editor.commands.focus();
          onClose();
        }}
      >
        {f.kind === "spelling" ? "Ignore all" : "Ignore"}
      </button>
      {f.kind === "spelling" && (
        <button
          className={item}
          data-testid="proof-add"
          onClick={() => {
            addToDictionary(editor.view, f.word);
            editor.commands.focus();
            onClose();
          }}
        >
          Add to dictionary
        </button>
      )}
    </div>
  );
}

export function ProofingPanel({ editor, enabled, editable, onClose }: { editor: Editor; enabled: boolean; editable: boolean; onClose: () => void }) {
  const st = proofingOf(editor.state);
  // dictionary suggestions are slow to work out: the first issues get them up front, the rest on request
  const [asked, setAsked] = useState<Set<string>>(new Set());
  const found = st?.found || [];
  const spelling = found.filter((f) => f.kind === "spelling").length;
  const go = (f: Found) => {
    editor.chain().focus().setTextSelection({ from: f.pos, to: f.end }).scrollIntoView().run();
  };
  const context = (f: Found) => {
    const $p = editor.state.doc.resolve(f.pos);
    const start = $p.start();
    const text = editor.state.doc.textBetween(Math.max(start, f.pos - 30), Math.min($p.end(), f.end + 30), " ", "");
    return text;
  };
  return (
    <aside className="w-80 border-l border-slate-200 bg-white flex flex-col no-print" data-testid="proof-pane">
      <div className="flex items-center justify-between px-4 h-11 border-b border-slate-100">
        <div className="text-sm font-semibold text-slate-700">Spelling and grammar</div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-sm">✕</button>
      </div>
      <div className="px-4 py-2 text-xs text-slate-500 border-b border-slate-100" data-testid="proof-summary">
        {!enabled ? "Checking is off (Review > Check spelling as you type)." : found.length === 0 ? (st?.ready ? "No spelling or grammar issues found." : "Checking…") : `${spelling} spelling, ${found.length - spelling} grammar`}
      </div>
      <div className="flex-1 overflow-y-auto">
        {enabled &&
          found.map((f, i) => (
            <div key={f.id} className="px-4 py-3 border-b border-slate-100 hover:bg-slate-50 cursor-pointer" data-testid="proof-item" data-kind={f.kind} onClick={() => go(f)}>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${f.kind === "spelling" ? "bg-rose-500" : "bg-sky-500"}`} />
                <span className="text-sm font-medium text-slate-800">{f.word.trim() ? f.word : "(spacing)"}</span>
                <span className="text-[11px] text-slate-400 ml-auto">{f.kind === "spelling" ? "Spelling" : "Grammar"}</span>
              </div>
              <div className="text-xs text-slate-500 mt-1">{f.message}</div>
              <div className="text-xs text-slate-400 mt-1 truncate">…{context(f)}…</div>
              {editable && (
                <div className="flex flex-wrap gap-1 mt-2" onClick={(e) => e.stopPropagation()}>
                  {f.kind === "spelling" && i >= 25 && !asked.has(f.id) && (
                    <button className="text-xs px-2 py-0.5 rounded text-indigo-700 hover:bg-indigo-50" onClick={() => setAsked((a) => new Set(a).add(f.id))}>
                      Suggestions…
                    </button>
                  )}
                  {(f.kind !== "spelling" || i < 25 || asked.has(f.id) ? replacementsFor(f) : []).slice(0, 4).map((r) => (
                    <button key={r} className="text-xs px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100" data-testid="proof-fix" onClick={() => fix(editor, f, r)}>
                      {r === " " ? "(one space)" : r}
                    </button>
                  ))}
                  <button className="text-xs px-2 py-0.5 rounded text-slate-600 hover:bg-slate-100" data-testid="proof-ignore" onClick={() => ignoreIssue(editor.view, f)}>
                    Ignore
                  </button>
                  {f.kind === "spelling" && (
                    <button className="text-xs px-2 py-0.5 rounded text-slate-600 hover:bg-slate-100" onClick={() => addToDictionary(editor.view, f.word)}>
                      Add to dictionary
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
      </div>
    </aside>
  );
}
