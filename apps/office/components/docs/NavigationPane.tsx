"use client";

// The Navigation pane: the document's headings, and a search box whose
// matches are listed with their context and highlighted in the document.
import { useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/core";
import { searchDocument } from "@/lib/docs/navigation";

export function NavigationPane({
  editor,
  outline,
  onHeading,
  onClose,
  focusSearch,
}: {
  editor: Editor | null;
  outline: { level: number; text: string; pos: number }[];
  onHeading: (pos: number) => void;
  onClose: () => void;
  /** bumped to put the cursor in the search box (Ctrl+F) */
  focusSearch?: number;
}) {
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [current, setCurrent] = useState(-1);
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<"headings" | "results">("headings");

  useEffect(() => {
    if (!editor) return;
    const bump = ({ transaction }: { transaction: { docChanged: boolean } }) => transaction.docChanged && setVersion((v) => v + 1);
    editor.on("transaction", bump);
    return () => {
      editor.off("transaction", bump);
    };
  }, [editor]);

  const results = useMemo(
    () => (editor && query ? searchDocument(editor.state.doc, query, { matchCase, wholeWord }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, query, matchCase, wholeWord, version],
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.setNavHighlight(query, { matchCase, wholeWord }, current);
  }, [editor, query, matchCase, wholeWord, current]);
  useEffect(
    () => () => {
      if (editor && !editor.isDestroyed) editor.commands.setNavHighlight("");
    },
    [editor],
  );
  useEffect(() => {
    if (focusSearch) document.querySelector<HTMLInputElement>("[data-testid=nav-search]")?.focus();
  }, [focusSearch]);

  const go = (i: number) => {
    if (!editor || !results.length) return;
    const n = ((i % results.length) + results.length) % results.length;
    setCurrent(n);
    const r = results[n];
    editor.chain().setTextSelection({ from: r.from, to: r.to }).scrollIntoView().run();
    try {
      const dom = editor.view.domAtPos(r.from).node as Node;
      (dom.nodeType === 1 ? (dom as HTMLElement) : dom.parentElement)?.scrollIntoView({ block: "center" });
    } catch {
      /* off screen */
    }
  };

  return (
    <aside className="w-64 shrink-0 border-r border-slate-200 bg-white overflow-y-auto no-print py-3 px-2" data-testid="navigation-pane">
      <div className="flex items-center px-2 mb-2">
        <span className="text-xs font-semibold text-slate-700">Navigation</span>
        <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700 text-xs" aria-label="Close navigation">✕</button>
      </div>
      <div className="px-1">
        <input
          data-testid="nav-search"
          aria-label="Search document"
          placeholder="Search document"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCurrent(-1);
            setTab(e.target.value ? "results" : "headings");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") go(e.shiftKey ? current - 1 : current + 1);
            if (e.key === "Escape") {
              setQuery("");
              setTab("headings");
            }
          }}
          className="w-full h-8 border border-slate-300 rounded-md px-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-500">
          <label className="flex items-center gap-1"><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> Whole words</label>
        </div>
        <div className="flex gap-1 mt-2 border-b border-slate-100 text-xs">
          {(["headings", "results"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`px-2 py-1 -mb-px border-b-2 ${tab === t ? "border-indigo-500 text-indigo-700" : "border-transparent text-slate-500"}`}>
              {t === "headings" ? "Headings" : "Results"}
            </button>
          ))}
          {query && (
            <span className="ml-auto flex items-center gap-1 text-slate-500" data-testid="nav-count">
              {results.length ? `${current >= 0 ? current + 1 : 0} of ${results.length}` : "No results"}
              <button className="px-1 hover:text-slate-800" title="Previous result" onClick={() => go(current - 1)}>▲</button>
              <button className="px-1 hover:text-slate-800" title="Next result" onClick={() => go(current + 1)}>▼</button>
            </span>
          )}
        </div>
      </div>
      {tab === "headings" ? (
        outline.length === 0 ? (
          <p className="text-[11px] text-slate-400 px-2 mt-2">Headings you add to the document will appear here.</p>
        ) : (
          <div className="mt-1">
            {outline.map((h, i) => {
              const hits = query ? results.filter((r) => r.from > h.pos && r.from < (outline[i + 1]?.pos ?? Infinity)).length : 0;
              return (
                <button key={i} onClick={() => onHeading(h.pos)} className={`w-full text-left text-[13px] rounded px-2 py-1 truncate hover:bg-slate-50 ${hits ? "bg-amber-50 text-amber-900" : "text-slate-600 hover:text-indigo-700"}`} style={{ paddingLeft: 8 + (h.level - 1) * 12 }}>
                  {h.text || "Heading"}
                </button>
              );
            })}
          </div>
        )
      ) : (
        <div className="mt-1 space-y-0.5" data-testid="nav-results">
          {results.slice(0, 500).map((r, i) => (
            <button key={i} data-nav-result={i} onClick={() => go(i)} className={`w-full text-left text-[12px] rounded px-2 py-1.5 hover:bg-slate-50 ${i === current ? "bg-indigo-50" : ""}`}>
              {r.heading && <div className="text-[10px] text-slate-400 truncate">{r.heading}</div>}
              <div className="text-slate-600 break-words">
                {r.before}
                <b className="text-slate-900 bg-amber-100">{r.match}</b>
                {r.after}
              </div>
            </button>
          ))}
          {query && !results.length && <p className="text-[11px] text-slate-400 px-2 mt-2">No results for “{query}”.</p>}
        </div>
      )}
    </aside>
  );
}
