"use client";

// Review panes: the thesaurus (Shift+F7), the accessibility checker, and the
// read-aloud bar (browser speech synthesis, highlighting what it reads).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { lookup, fitReplacement, type ThesaurusData } from "@/lib/docs/thesaurus";
import { checkAccessibility, ISSUE_INFO, type Issue } from "@/lib/docs/accessibility";
import type { PMNode } from "@/lib/docs/model";
import { posOfPath, readAloudKey, readingBlocks } from "./review-ext";
import { TextSelection, NodeSelection } from "@tiptap/pm/state";

let thesaurusData: Promise<ThesaurusData> | null = null;
const loadThesaurus = () => (thesaurusData ||= fetch("/thesaurus-en.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})));

/** The word at the cursor (or the selected text) and its range. */
export function wordAt(editor: Editor): { text: string; from: number; to: number } | null {
  const { from, to, empty } = editor.state.selection;
  if (!empty) {
    const t = editor.state.doc.textBetween(from, to, " ").trim();
    return t && t.length < 40 ? { text: t, from, to } : null;
  }
  const $p = editor.state.selection.$from;
  if (!$p.parent.isTextblock) return null;
  const text = $p.parent.textBetween(0, $p.parent.content.size, "\u0000", "\u0000");
  const at = $p.parentOffset;
  let a = at;
  let b = at;
  while (a > 0 && /[\p{L}'’-]/u.test(text[a - 1])) a--;
  while (b < text.length && /[\p{L}'’-]/u.test(text[b])) b++;
  if (a === b) return null;
  return { text: text.slice(a, b), from: $p.start() + a, to: $p.start() + b };
}

const aside = "w-72 shrink-0 border-l border-slate-200 bg-white overflow-y-auto no-print";
const head = "flex items-center justify-between px-4 h-11 border-b border-slate-100";

export function ThesaurusPane({ editor, editable, onClose }: { editor: Editor; editable: boolean; onClose: () => void }) {
  const [target, setTarget] = useState(() => wordAt(editor));
  const [query, setQuery] = useState(target?.text || "");
  const [data, setData] = useState<ThesaurusData | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    loadThesaurus().then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, []);
  // follow the cursor while the pane is open
  useEffect(() => {
    const on = () => {
      const w = wordAt(editor);
      if (w && w.text !== target?.text) {
        setTarget(w);
        setQuery(w.text);
      }
    };
    editor.on("selectionUpdate", on);
    return () => {
      editor.off("selectionUpdate", on);
    };
  }, [editor, target]);
  const result = useMemo(() => (data && query.trim() ? lookup(data, query) : null), [data, query]);
  const go = (w: string) => {
    setHistory((h) => [...h, query]);
    setQuery(w);
  };
  const insert = (syn: string) => {
    if (!target || !editable) return;
    const base = result?.word || target.text.toLowerCase();
    const text = target.text.toLowerCase() === query.toLowerCase() ? fitReplacement(target.text, base, syn) : fitReplacement(target.text, target.text.toLowerCase(), syn);
    editor.chain().focus().insertContentAt({ from: target.from, to: target.to }, text).run();
    setTarget({ text, from: target.from, to: target.from + text.length });
  };
  return (
    <aside className={aside} data-testid="thesaurus-pane">
      <div className={head}>
        <div className="text-sm font-semibold text-slate-700">Thesaurus</div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-sm">✕</button>
      </div>
      <div className="px-4 py-3 flex gap-1">
        <button className="text-sm px-2 rounded hover:bg-slate-100 disabled:opacity-30" disabled={!history.length} title="Back" onClick={() => { setQuery(history[history.length - 1]); setHistory((h) => h.slice(0, -1)); }}>←</button>
        <input aria-label="Thesaurus search" className="flex-1 h-8 border border-slate-300 rounded-md px-2 text-sm" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {!data ? (
        <div className="px-4 text-sm text-slate-400">Loading…</div>
      ) : !result ? (
        <div className="px-4 text-sm text-slate-500" data-testid="thesaurus-none">{query.trim() ? "No results found." : "Select a word to look it up."}</div>
      ) : (
        <div className="px-2 pb-4" data-testid="thesaurus-results">
          {result.senses.map((s, i) => (
            <div key={i} className="mb-3">
              <div className="px-2 py-1 text-xs font-semibold text-slate-700 bg-slate-50 rounded">
                {s.meaning} <span className="font-normal text-slate-400">({s.pos})</span>
              </div>
              {s.synonyms.map((w) => (
                <div key={w} className="group flex items-center px-2 py-0.5 text-sm hover:bg-indigo-50 rounded">
                  <button className="flex-1 text-left text-slate-800" data-synonym={w} onClick={() => go(w)}>{w}</button>
                  {editable && target && (
                    <button className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-[11px] text-indigo-600 px-1" data-insert={w} onClick={() => insert(w)}>Insert</button>
                  )}
                </div>
              ))}
              {s.antonyms.length > 0 && (
                <div className="px-2 pt-1 text-xs text-slate-500">
                  Antonyms:{" "}
                  {s.antonyms.map((w, k) => (
                    <button key={w} className="text-slate-700 hover:underline" onClick={() => go(w)}>{k ? `, ${w}` : w}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="px-4 py-2 text-[10px] text-slate-400 border-t border-slate-100">From WordNet, Princeton University.</div>
    </aside>
  );
}

export function AccessibilityPane({ editor, title, pageColor, editable, onClose }: { editor: Editor; title: string; pageColor?: string; editable: boolean; onClose: () => void }) {
  const [issues, setIssues] = useState<Issue[]>(() => checkAccessibility(editor.getJSON() as PMNode, { title, pageColor }));
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const on = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => setIssues(checkAccessibility(editor.getJSON() as PMNode, { title, pageColor })), 400);
    };
    on();
    editor.on("update", on);
    return () => {
      editor.off("update", on);
      if (t) clearTimeout(t);
    };
  }, [editor, title, pageColor]);
  const nodeAt = (path: number[]) => {
    const pos = posOfPath(editor.state.doc, path);
    return { pos, node: editor.state.doc.nodeAt(pos) };
  };
  const goTo = (i: Issue) => {
    if (!i.path.length) return;
    const { pos, node } = nodeAt(i.path);
    const tr = editor.state.tr;
    if (node && (node.isAtom || node.type.name === "image")) tr.setSelection(NodeSelection.create(editor.state.doc, pos));
    else tr.setSelection(TextSelection.near(editor.state.doc.resolve(Math.min(pos + 1, editor.state.doc.content.size))));
    editor.view.dispatch(tr.scrollIntoView());
    editor.commands.focus();
  };
  const fix = (i: Issue) => {
    const { pos, node } = nodeAt(i.path);
    if (!node) return;
    if (i.kind === "missingAltText") {
      const alt = window.prompt("Describe this for someone who cannot see it (alt text):", "");
      if (alt === null) return;
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, alt: alt.trim() || null, ...(alt.trim() ? {} : { decorative: true }) }));
    } else if (i.kind === "tableNoHeader") {
      editor.chain().focus().setTextSelection(pos + 3).toggleHeaderRow().run();
    } else if (i.kind === "floatingObject") {
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, wrap: "inline" }));
    } else if (i.kind === "headingSkipped") {
      const m = /Use heading (\d)/.exec(i.fix);
      if (m) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, level: Number(m[1]) }));
    } else if (i.kind === "blankLines") {
      // remove this run of empty paragraphs but one
      const tr = editor.state.tr;
      let start = i.path[0];
      const doc = editor.state.doc;
      while (start > 0 && doc.child(start - 1).type.name === "paragraph" && !doc.child(start - 1).textContent.trim() && doc.child(start - 1).childCount === 0) start--;
      let end = i.path[0];
      while (end + 1 < doc.childCount && doc.child(end + 1).type.name === "paragraph" && !doc.child(end + 1).textContent.trim() && doc.child(end + 1).childCount === 0) end++;
      const from = posOfPath(doc, [start + 1]);
      const to = posOfPath(doc, [end]) + doc.child(end).nodeSize;
      if (to > from) editor.view.dispatch(tr.delete(from, to));
    } else if (i.kind === "repeatedSpaces") {
      const tr = editor.state.tr;
      node.descendants((c, off) => {
        if (!c.isText) return true;
        const re = / {4,}/g;
        let m: RegExpExecArray | null;
        const hits: [number, number][] = [];
        while ((m = re.exec(c.text || ""))) hits.push([m.index, m[0].length]);
        for (const [at, len] of hits.reverse()) tr.insertText(" ", pos + 1 + off + at, pos + 1 + off + at + len);
        return false;
      });
      editor.view.dispatch(tr);
    }
  };
  const FIXABLE = new Set(["missingAltText", "tableNoHeader", "floatingObject", "headingSkipped", "blankLines", "repeatedSpaces"]);
  const groups: Issue["severity"][] = ["error", "warning", "tip"];
  const label = { error: "Errors", warning: "Warnings", tip: "Tips" };
  return (
    <aside className={aside} data-testid="accessibility-pane">
      <div className={head}>
        <div className="text-sm font-semibold text-slate-700">Accessibility</div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-sm">✕</button>
      </div>
      {!issues.length ? (
        <div className="px-4 py-6 text-sm text-emerald-700" data-testid="a11y-clean">No accessibility issues found. People with disabilities should not have difficulty reading this document.</div>
      ) : (
        groups.map((g) => {
          const list = issues.map((x, idx) => ({ x, idx })).filter((y) => y.x.severity === g);
          if (!list.length) return null;
          return (
            <div key={g} className="px-2 py-2 border-b border-slate-100">
              <div className="px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">{label[g]} ({list.length})</div>
              {list.map(({ x, idx }) => (
                <div key={idx} className="px-2 py-1 rounded hover:bg-slate-50" data-issue={x.kind}>
                  <button className="w-full text-left text-sm text-slate-800" onClick={() => { setOpen(open === idx ? null : idx); goTo(x); }}>
                    {ISSUE_INFO[x.kind].title}
                    <div className="text-xs text-slate-500">{x.message}</div>
                  </button>
                  {open === idx && (
                    <div className="mt-1 text-xs text-slate-600 space-y-1">
                      <div>{ISSUE_INFO[x.kind].why}</div>
                      <div className="text-slate-500">{x.fix}</div>
                      {editable && FIXABLE.has(x.kind) && x.path.length > 0 && (
                        <button className="px-2 py-0.5 rounded bg-indigo-600 text-white" data-testid="a11y-fix" onClick={() => fix(x)}>Fix</button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })
      )}
    </aside>
  );
}

const RATES = [0.75, 1, 1.25, 1.5, 2];

export function ReadAloudBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voice, setVoice] = useState<string>("");
  const [rate, setRate] = useState(1);
  const [state, setState] = useState<"playing" | "paused" | "stopped">("stopped");
  const [index, setIndex] = useState(0);
  const blocks = useRef(readingBlocks(editor.state, editor.state.selection.from));
  const run = useRef(0);
  const mark = useCallback((v: { from: number; to: number; word?: { from: number; to: number } } | null) => {
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(readAloudKey, v).setMeta("addToHistory", false));
  }, [editor]);
  useEffect(() => {
    if (!synth) return;
    const load = () => setVoices(synth.getVoices().filter((v) => v.lang.startsWith("en") || !v.lang));
    load();
    synth.addEventListener?.("voiceschanged", load);
    return () => synth.removeEventListener?.("voiceschanged", load);
  }, [synth]);
  const speak = useCallback(
    (i: number) => {
      if (!synth) return;
      const b = blocks.current[i];
      const id = ++run.current;
      synth.cancel();
      if (!b) {
        setState("stopped");
        mark(null);
        return;
      }
      setIndex(i);
      setState("playing");
      mark({ from: b.from, to: b.to });
      const u = new SpeechSynthesisUtterance(b.text);
      u.rate = rate;
      const v = voices.find((x) => x.name === voice);
      if (v) u.voice = v;
      u.lang = v?.lang || "en-US";
      u.onboundary = (e) => {
        if (id !== run.current || e.name !== "word") return;
        const len = e.charLength || /^[\p{L}\p{N}'’-]+/u.exec(b.text.slice(e.charIndex))?.[0].length || 0;
        mark({ from: b.from, to: b.to, word: { from: b.posAt(e.charIndex), to: b.posAt(e.charIndex + len) } });
      };
      u.onend = () => {
        if (id === run.current) speak(i + 1);
      };
      u.onerror = () => {
        if (id === run.current) setState("stopped");
      };
      synth.speak(u);
    },
    [synth, rate, voice, voices, mark],
  );
  useEffect(() => {
    speak(0);
    return () => {
      run.current++;
      synth?.cancel();
      mark(null);
    };
    // start once, from the cursor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!synth) return <div className="px-3 py-2 text-sm bg-amber-50 border-b border-amber-200">This browser cannot read aloud.</div>;
  const btn = "h-7 px-2 rounded hover:bg-slate-200 text-sm";
  return (
    <div className="flex items-center gap-1 px-3 py-1 bg-slate-100 border-b border-slate-200 no-print" data-testid="read-aloud" data-state={state} data-index={index}>
      <span className="text-xs text-slate-500 mr-2">Read aloud</span>
      <button className={btn} title="Previous paragraph" onClick={() => speak(Math.max(0, index - 1))}>⏮</button>
      {state === "playing" ? (
        <button className={btn} title="Pause" data-testid="read-aloud-pause" onClick={() => { synth.pause(); setState("paused"); }}>⏸</button>
      ) : (
        <button className={btn} title="Play" data-testid="read-aloud-play" onClick={() => { if (state === "paused") { synth.resume(); setState("playing"); } else speak(index); }}>▶</button>
      )}
      <button className={btn} title="Next paragraph" data-testid="read-aloud-next" onClick={() => speak(index + 1)}>⏭</button>
      <select aria-label="Reading speed" className="h-7 text-xs border border-slate-300 rounded ml-2" value={rate} onChange={(e) => setRate(Number(e.target.value))}>
        {RATES.map((r) => (
          <option key={r} value={r}>{r}×</option>
        ))}
      </select>
      {voices.length > 0 && (
        <select aria-label="Voice" className="h-7 text-xs border border-slate-300 rounded max-w-48" value={voice} onChange={(e) => setVoice(e.target.value)}>
          <option value="">Default voice</option>
          {voices.map((v) => (
            <option key={v.name} value={v.name}>{v.name}</option>
          ))}
        </select>
      )}
      <button className={`${btn} ml-auto`} title="Stop" data-testid="read-aloud-stop" onClick={onClose}>✕</button>
    </div>
  );
}
