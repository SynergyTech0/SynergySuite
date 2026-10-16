"use client";

// Tools > AI: rewrite or fix the grammar of the selection, summarise it (or
// the whole document), or draft new text from a prompt. The answer is shown
// first; it then replaces the selection or goes in below it.
import { useEffect, useState } from "react";
import { Modal, btnCls, inputCls, Field } from "./WordDialogs";
import { TONES, type AiTask, type Tone } from "@/lib/docs/ai";

const TITLES: Record<AiTask, string> = { rewrite: "Rewrite with AI", summarize: "Summarise with AI", draft: "Draft with AI", grammar: "Fix grammar with AI" };

export function AiDialog({ task, text, context, source, canReplace, onInsert, onClose }: { task: AiTask; text: string; context: string; source: string; canReplace: boolean; onInsert: (markdown: string, replace: boolean) => void; onClose: () => void }) {
  const [tone, setTone] = useState<Tone>("clearer");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/docs/ai")
      .then((r) => r.json())
      .then((j) => setConfigured(!!j.configured))
      .catch(() => setConfigured(false));
  }, []);
  const run = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/docs/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task, text, tone, prompt, context }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `The request failed (${r.status}).`);
      setAnswer(String(j.markdown || ""));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const replace = canReplace && task !== "summarize" && task !== "draft";
  const primary = "bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50";
  return (
    <Modal
      title={TITLES[task]}
      onClose={onClose}
      wide
      footer={
        <>
          <button onClick={onClose} className={`${btnCls} text-slate-600 hover:bg-slate-100 mr-auto`}>Cancel</button>
          {answer ? (
            <>
              <button onClick={run} disabled={busy} className={`${btnCls} text-slate-600 hover:bg-slate-100`} data-testid="ai-again">Try again</button>
              <button onClick={() => onInsert(answer, false)} className={`${btnCls} ${replace ? "text-indigo-700 hover:bg-indigo-50" : primary}`} data-testid="ai-insert">Insert below</button>
              {replace && <button onClick={() => onInsert(answer, true)} className={`${btnCls} ${primary}`} data-testid="ai-replace">Replace</button>}
            </>
          ) : (
            <button onClick={run} disabled={busy || configured === false || (task === "draft" ? !prompt.trim() : !text.trim())} className={`${btnCls} ${primary}`} data-testid="ai-run">
              {busy ? "Working…" : task === "draft" ? "Draft" : task === "summarize" ? "Summarise" : task === "grammar" ? "Fix" : "Rewrite"}
            </button>
          )}
        </>
      }
    >
      {configured === false && (
        <div className="mb-3 rounded-md bg-amber-50 text-amber-800 px-3 py-2 text-xs" data-testid="ai-off">No AI model is configured for this suite. An administrator can set AI_MODEL with AI_API_KEY or AI_BASE_URL (or DOCS_AI_* for Docs only).</div>
      )}
      {task === "draft" ? (
        <Field label="What should it write?">
          <textarea className={`${inputCls} h-24 py-1.5`} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. An introduction for a project proposal about a community garden" autoFocus data-testid="ai-prompt" />
        </Field>
      ) : (
        <>
          {task === "rewrite" && (
            <div className="mb-3">
              <Field label="Make it">
                <select className={inputCls} value={tone} onChange={(e) => setTone(e.target.value as Tone)} data-testid="ai-tone">
                  {TONES.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </Field>
            </div>
          )}
          <div className="text-xs text-slate-500 mb-1">{source}</div>
          <div className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600" data-testid="ai-source">{text || "(empty)"}</div>
        </>
      )}
      {error && <div className="mt-3 rounded-md bg-rose-50 text-rose-700 px-3 py-2 text-xs" data-testid="ai-error">{error}</div>}
      {answer && (
        <>
          <div className="text-xs text-slate-500 mt-4 mb-1">Result</div>
          <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border border-indigo-200 bg-indigo-50/40 px-3 py-2 text-sm text-slate-800" data-testid="ai-result">{answer}</div>
          <div className="text-[11px] text-slate-400 mt-1">AI can make mistakes. Check the result before you use it.</div>
        </>
      )}
    </Modal>
  );
}
