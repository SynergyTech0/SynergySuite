"use client";

// Designer pane (layout ideas for the current slide, built in and from the
// suite's AI model) and the dialog that drafts slides from an outline or a prompt.
import { useEffect, useMemo, useState } from "react";
import { cleanDraft, designIdeas, draftSlides, fromAiIdea, parseDeckOutline, type Draft, type Idea } from "@/lib/slides/designer";
import { genId, type Slide } from "@/lib/slides/model";
import { Modal } from "./DeckDialogs";
import { ScaledSlide, type DeckLook } from "./SlideView";

type AiStatus = { configured: boolean; model: string | null } | null;

/** Whether the suite has an AI model for Slides (null while asking). */
export function useAiStatus(open: boolean): AiStatus {
  const [st, setSt] = useState<AiStatus>(null);
  useEffect(() => {
    if (!open || st) return;
    let live = true;
    fetch("/api/slides/ai")
      .then((r) => (r.ok ? r.json() : { configured: false, model: null }))
      .then((j) => live && setSt({ configured: !!j.configured, model: j.model || null }))
      .catch(() => live && setSt({ configured: false, model: null }));
    return () => {
      live = false;
    };
  }, [open, st]);
  return st;
}

async function postAi<T>(body: object): Promise<T> {
  const r = await fetch("/api/slides/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `request failed (${r.status})`);
  return j as T;
}

/** `slide`: the slide as stored; `preview` resolves its master look for drawing. */
export function DesignerPane({ slide, look, accent, canEdit, preview, onApply, onClose }: { slide: Slide; look: DeckLook; accent: string; canEdit: boolean; preview: (s: Slide) => Slide; onApply: (s: Slide) => void; onClose: () => void }) {
  const ai = useAiStatus(true);
  const builtIn = useMemo(() => designIdeas(slide, look.W, look.H, accent, genId), [slide, look.W, look.H, accent]);
  const [aiIdeas, setAiIdeas] = useState<Idea[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    setAiIdeas([]);
    setErr("");
  }, [slide.id]);
  const askAi = async () => {
    setBusy(true);
    setErr("");
    try {
      // pictures are described by their boxes; their data stays here
      const lean: Slide = { ...slide, bgImg: "", elements: slide.elements.map((e) => (e.type === "image" ? { ...e, src: "" } : e.type === "media" ? { ...e, src: "", poster: undefined } : e)) };
      const { ideas } = await postAi<{ ideas: unknown[] }>({ task: "design", slide: lean, w: look.W, h: look.H });
      const ok = ideas.map((x, k) => fromAiIdea(slide, x, look.W, look.H, accent, genId, k)).filter((x): x is Idea => !!x);
      if (!ok.length) setErr("The AI model had no usable ideas for this slide. Try again.");
      setAiIdeas(ok);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const ideas = [...builtIn, ...aiIdeas];
  return (
    <aside className="w-72 border-l border-slate-200 bg-white overflow-y-auto shrink-0 no-print" data-testid="designer-pane">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
        <span className="font-semibold text-sm text-slate-800">Designer</span>
        <button className="text-slate-400 hover:text-slate-700" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="p-3 space-y-3">
        {!ideas.length && <p className="text-sm text-slate-500" data-testid="designer-empty">Add a title, some bullets or a picture to get layout ideas.</p>}
        {ideas.map((idea) => (
          <button key={idea.id} type="button" disabled={!canEdit} data-testid="designer-idea" data-idea={idea.id} className="block w-full text-left rounded border border-slate-200 hover:border-indigo-400 hover:ring-2 hover:ring-indigo-100 disabled:opacity-60" onClick={() => onApply(idea.slide)} title="Apply this layout">
            <ScaledSlide slide={preview(idea.slide)} look={look} width={262} />
            <div className="px-2 py-1 text-xs text-slate-600">{idea.id.startsWith("ai-") ? "✨ " : ""}{idea.name}</div>
          </button>
        ))}
        <div className="border-t border-slate-100 pt-3 space-y-2">
          {ai === null ? (
            <p className="text-xs text-slate-400">Checking for an AI model…</p>
          ) : ai.configured ? (
            <button type="button" data-testid="designer-ai" className="w-full rounded bg-indigo-600 text-white text-sm py-1.5 hover:bg-indigo-700 disabled:opacity-50" disabled={busy || !canEdit} onClick={askAi}>
              {busy ? "Asking the AI model…" : "✨ More ideas from AI"}
            </button>
          ) : (
            <p className="text-xs text-slate-500" data-testid="designer-no-ai">AI ideas need an AI model. An administrator can connect one for the suite (AI_MODEL with AI_API_KEY or AI_BASE_URL).</p>
          )}
          {ai?.model && <p className="text-[11px] text-slate-400">Model: {ai.model}</p>}
          {err && <p className="text-xs text-red-600" data-testid="designer-error">{err}</p>}
        </div>
      </div>
    </aside>
  );
}

/** File > New slides from an outline or AI: drafts slides to add after the current one. */
export function DraftDialog({ onInsert, onClose }: { onInsert: (slides: Slide[]) => void; onClose: () => void }) {
  const ai = useAiStatus(true);
  const [mode, setMode] = useState<"outline" | "ai">("outline");
  const [text, setText] = useState("");
  const [count, setCount] = useState(6);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const outline = useMemo(() => (mode === "outline" ? parseDeckOutline(text) : null), [mode, text]);
  const create = async () => {
    setErr("");
    let d: Draft | null = outline;
    if (mode === "ai") {
      setBusy(true);
      try {
        d = cleanDraft((await postAi<{ draft: unknown }>({ task: "draft", prompt: text, slides: count })).draft);
      } catch (e) {
        setErr((e as Error).message);
        return;
      } finally {
        setBusy(false);
      }
    }
    if (!d || (!d.title && !d.slides.length)) return setErr("Nothing to make slides from yet.");
    onInsert(draftSlides(d, genId));
    onClose();
  };
  return (
    <Modal title="New slides from an outline or AI" testId="draft-dialog" onClose={onClose} wide>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1.5"><input type="radio" checked={mode === "outline"} onChange={() => setMode("outline")} data-testid="draft-outline" />From an outline</label>
        <label className={`flex items-center gap-1.5 ${ai && !ai.configured ? "opacity-50" : ""}`}><input type="radio" disabled={!ai?.configured} checked={mode === "ai"} onChange={() => setMode("ai")} data-testid="draft-ai" />Ask AI{ai && !ai.configured ? " (no AI model connected)" : ""}</label>
      </div>
      <textarea
        autoFocus
        data-testid="draft-text"
        className="w-full h-56 rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={mode === "outline" ? "Product launch\nSpring 2026\nWhy now\n  - Customers asked for it\n  - The market is ready\nPlan\n  - Beta in April\n  Notes: mention the waitlist" : "A 10-minute talk for new staff about our expense policy: what can be claimed, how to submit, and deadlines."}
      />
      {mode === "outline" ? (
        <p className="text-xs text-slate-500" data-testid="draft-summary">
          {outline && (outline.title || outline.slides.length) ? `A title slide${outline.title ? ` (“${outline.title}”)` : ""} and ${outline.slides.length} slide${outline.slides.length === 1 ? "" : "s"}. ` : ""}
          First line: the title (the next line, a subtitle). Each unindented line starts a slide; indented or “-” lines are its bullets; “Notes:” lines are speaker notes.
        </p>
      ) : (
        <label className="flex items-center gap-2 text-sm text-slate-700">About
          <input type="number" min={2} max={20} className="w-16 h-8 rounded border border-slate-300 px-2" value={count} onChange={(e) => setCount(Math.max(2, Math.min(20, Number(e.target.value) || 6)))} data-testid="draft-count" />
          slides
        </label>
      )}
      {err && <p className="text-sm text-red-600" data-testid="draft-error">{err}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="rounded px-3 py-1.5 hover:bg-slate-100" onClick={onClose}>Cancel</button>
        <button type="button" data-testid="draft-create" className="rounded bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-700 disabled:opacity-40" disabled={busy || !text.trim()} onClick={create}>{busy ? "Drafting…" : "Create slides"}</button>
      </div>
    </Modal>
  );
}
