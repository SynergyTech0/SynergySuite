"use client";

// Find / Replace panel (Ctrl+F, Ctrl+H), searching every slide's title, body,
// text boxes, shape text, table cells and speaker notes.
import { useEffect, useMemo, useRef, useState } from "react";
import { findAll, findRegex, type FindHit, type FindOpts } from "@/lib/slides/find";
import type { Slide } from "@/lib/slides/model";

export default function FindReplace({
  slides,
  current,
  canEdit,
  replaceMode,
  onGo,
  onReplace,
  onReplaceAll,
  onClose,
}: {
  slides: Slide[];
  current: number;
  canEdit: boolean;
  replaceMode: boolean;
  onGo: (hit: FindHit) => void;
  onReplace: (hit: FindHit, re: RegExp, by: string) => void;
  onReplaceAll: (re: RegExp, by: string) => number;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [by, setBy] = useState("");
  const [opts, setOpts] = useState<FindOpts>({});
  const [showReplace, setShowReplace] = useState(replaceMode);
  const [at, setAt] = useState(-1);
  const [msg, setMsg] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setShowReplace((v) => v || replaceMode), [replaceMode]);
  useEffect(() => input.current?.focus(), []);

  const hits = useMemo(() => findAll(slides, query, opts), [slides, query, opts]);
  const total = hits.reduce((n, h) => n + h.count, 0);
  useEffect(() => setAt(-1), [query, opts]);

  const next = (dir: 1 | -1 = 1) => {
    if (!hits.length) {
      setMsg(query ? "No matches" : "");
      return;
    }
    // first time: start from the current slide
    let i = at < 0 ? hits.findIndex((h) => h.slide >= current) : at + dir;
    if (at < 0 && dir < 0) i = (i < 0 ? hits.length : i) - 1;
    if (i < 0) i = hits.length - 1;
    if (i >= hits.length) i = 0;
    setAt(i);
    setMsg("");
    onGo(hits[i]);
  };
  const re = () => findRegex(query, opts);

  return (
    <div
      className="absolute right-4 top-2 z-[200] w-80 rounded-lg border border-slate-200 bg-white p-3 shadow-lg text-sm space-y-2 no-print"
      data-testid="find-panel"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="flex items-center gap-2">
        <span className="font-semibold text-slate-800">{showReplace ? "Replace" : "Find"}</span>
        {!showReplace && canEdit && <button className="text-xs text-indigo-600 hover:underline" onClick={() => setShowReplace(true)}>Replace…</button>}
        <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700" aria-label="Close">✕</button>
      </div>
      <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); next(1); }}>
        <input ref={input} data-testid="find-input" className="flex-1 h-8 rounded border border-slate-300 px-2" placeholder="Find what" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="button" title="Previous" className="px-2 rounded hover:bg-slate-100" onClick={() => next(-1)}>↑</button>
        <button type="submit" title="Find next" data-testid="find-next" className="px-2 rounded hover:bg-slate-100">↓</button>
      </form>
      {showReplace && (
        <input data-testid="replace-input" className="w-full h-8 rounded border border-slate-300 px-2" placeholder="Replace with" value={by} onChange={(e) => setBy(e.target.value)} />
      )}
      <div className="flex items-center gap-3 text-xs text-slate-600">
        <label className="flex items-center gap-1"><input type="checkbox" checked={!!opts.matchCase} onChange={(e) => setOpts({ ...opts, matchCase: e.target.checked })} /> Match case</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={!!opts.wholeWord} onChange={(e) => setOpts({ ...opts, wholeWord: e.target.checked })} /> Whole words</label>
      </div>
      {showReplace && (
        <div className="flex gap-2">
          <button
            className="rounded border border-slate-200 px-3 py-1 hover:bg-slate-50 disabled:opacity-40"
            data-testid="replace-one"
            disabled={!canEdit || !hits.length}
            onClick={() => {
              const r = re();
              if (!r) return;
              // replace where we are (or the next match), then move on
              const h = at >= 0 && hits[at] ? hits[at] : hits.find((x) => x.slide >= current) || hits[0];
              onReplace(h, r, by);
              setAt((i) => Math.max(-1, i - 1));
            }}
          >
            Replace
          </button>
          <button
            className="rounded bg-indigo-600 px-3 py-1 text-white hover:bg-indigo-700 disabled:opacity-40"
            data-testid="replace-all"
            disabled={!canEdit || !hits.length}
            onClick={() => {
              const r = re();
              if (r) setMsg(`Replaced ${onReplaceAll(r, by)} occurrence(s).`);
            }}
          >
            Replace all
          </button>
        </div>
      )}
      <div className="text-xs text-slate-500" data-testid="find-status">
        {msg || (query ? `${total} match${total === 1 ? "" : "es"}${at >= 0 && hits[at] ? ` · slide ${hits[at].slide + 1}` : ""}` : "")}
      </div>
    </div>
  );
}
