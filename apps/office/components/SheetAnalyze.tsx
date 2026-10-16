"use client";

// Insert > Analyze Data: suggested charts, pivot tables and insights for the
// table around the selection; and Formulas > Write a formula: a formula from
// a plain-language request. Both word things through the suite's own AI model
// when one is set up (bring your own model); Analyze Data works without one.
import { useEffect, useState } from "react";
import { Modal } from "./SheetDialogs";
import type { Analysis, Suggestion } from "@/lib/analyze-data";

const plain = "text-xs rounded-full px-3 py-1 border border-slate-300 hover:bg-slate-100 text-slate-700 disabled:opacity-40";
const primary = "text-xs rounded-full px-3 py-1 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40";

/** Whether an AI model is set up (GET /api/sheet-ai). */
export function useSheetAi(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/sheet-ai")
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((j) => live && setOn(!!j.enabled))
      .catch(() => live && setOn(false));
    return () => {
      live = false;
    };
  }, []);
  return on;
}

export async function askSheetAi<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/sheet-ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `The AI request failed (${res.status}).`);
  return j as T;
}

const icon: Record<Suggestion["kind"], string> = { insight: "Insight", chart: "Chart", pivot: "Pivot table" };

export function AnalyzeDataDialog({
  analysis,
  range,
  table,
  canEdit,
  onInsert,
  onClose,
}: {
  analysis: Analysis;
  /** The table analyzed, e.g. A1:D8. */
  range: string;
  /** A description of the table for the model. */
  table: string;
  canEdit: boolean;
  onInsert: (s: Suggestion) => Promise<void>;
  onClose: () => void;
}) {
  const ai = useSheetAi();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [aiInsights, setAiInsights] = useState<{ title: string; text: string }[] | null>(null);
  const insert = async (s: Suggestion) => {
    setBusy(s.id);
    setMessage("");
    try {
      await onInsert(s);
      setMessage(`Inserted "${s.title}".`);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const askAi = async () => {
    setBusy("ai");
    setMessage("");
    try {
      setAiInsights((await askSheetAi<{ insights: { title: string; text: string }[] }>({ task: "insights", table })).insights);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal title="Analyze Data" onClose={onClose}>
      <p className="text-xs text-slate-500 mb-2">
        {analysis.rows} rows in {range}. Insert a suggestion to add it to the workbook.
      </p>
      {analysis.suggestions.length === 0 ? (
        <p className="text-sm text-slate-600 mb-3">Nothing to suggest yet: select a table with a header row and at least two rows of data.</p>
      ) : (
        <ul className="space-y-2 max-h-[50vh] overflow-y-auto mb-3" aria-label="Suggestions">
          {analysis.suggestions.map((s) => (
            <li key={s.id} className="border border-slate-200 rounded px-3 py-2" data-testid="analyze-suggestion" data-kind={s.kind} data-title={s.title}>
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] uppercase tracking-wide text-slate-400 shrink-0">{icon[s.kind]}</span>
                <span className="text-sm font-medium text-slate-800 flex-1 min-w-0">{s.title}</span>
                {s.kind !== "insight" && canEdit && (
                  <button type="button" className={plain} disabled={!!busy} onClick={() => void insert(s)} aria-label={`Insert ${s.title}`}>
                    Insert
                  </button>
                )}
              </div>
              {s.kind === "insight" && <p className="text-xs text-slate-600 mt-0.5">{s.text}</p>}
              {s.kind === "pivot" && <p className="text-[11px] text-slate-400 mt-0.5">On a new sheet{s.chart ? `, with a ${s.chart} chart` : ""}.</p>}
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-slate-100 pt-2">
        {ai === false && <p className="text-xs text-slate-500" data-testid="analyze-ai-off">AI is off: no AI model is set up for the suite, so insights are worked out from the numbers only.</p>}
        {ai && !aiInsights && (
          <button type="button" className={plain} disabled={!!busy} onClick={() => void askAi()}>
            {busy === "ai" ? "Asking…" : "More insights from AI"}
          </button>
        )}
        {aiInsights && (
          <ul className="space-y-1" aria-label="AI insights">
            {aiInsights.map((x, i) => (
              <li key={i} className="text-xs text-slate-600" data-testid="analyze-ai-insight">
                <span className="font-medium text-slate-800">{x.title}.</span> {x.text}
              </li>
            ))}
            {!aiInsights.length && <li className="text-xs text-slate-500">The model had nothing to add.</li>}
          </ul>
        )}
      </div>
      {message && <p role="status" className="text-xs text-slate-600 mt-2">{message}</p>}
      <div className="flex justify-end mt-3">
        <button type="button" className="text-sm rounded-full px-4 py-1.5 hover:bg-slate-100 text-slate-700" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

export type FormulaRequestContext = { sheet?: string; cell?: string; range?: string; columns?: { column: string; name: string }[]; sample?: string };

export function FormulaHelperDialog({
  context,
  canEdit,
  onInsert,
  onClose,
}: {
  context: FormulaRequestContext;
  canEdit: boolean;
  onInsert: (formula: string) => void;
  onClose: () => void;
}) {
  const ai = useSheetAi();
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState<{ formula: string; explanation: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ask = async () => {
    setBusy(true);
    setError("");
    setAnswer(null);
    try {
      setAnswer(await askSheetAi<{ formula: string; explanation: string }>({ task: "formula", prompt, context }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Write a formula" onClose={onClose}>
      {ai === false ? (
        <p className="text-sm text-slate-600 mb-3" data-testid="formula-ai-off">
          AI is off: no AI model is set up for the suite. An administrator can set one up with AI_MODEL (and AI_BASE_URL or AI_API_KEY), using any OpenAI-compatible server, Ollama or Anthropic.
        </p>
      ) : (
        <>
          <p className="text-xs text-slate-500 mb-1">
            Describe what you want{context.cell ? ` in ${context.cell}` : ""}
            {context.range ? `, using the table ${context.range}` : ""}.
          </p>
          <textarea
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm h-20"
            aria-label="Formula request"
            placeholder="e.g. total Sales where Region is North"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && prompt.trim()) void ask();
            }}
          />
          <div className="flex justify-end mt-1">
            <button type="button" className={primary} disabled={busy || !prompt.trim() || ai !== true} onClick={() => void ask()}>
              {busy ? "Writing…" : "Write formula"}
            </button>
          </div>
          {answer && (
            <div className="mt-2 border border-slate-200 rounded px-3 py-2" data-testid="formula-answer">
              <code className="block text-sm text-slate-800 break-all">{answer.formula}</code>
              {answer.explanation && <p className="text-xs text-slate-600 mt-1">{answer.explanation}</p>}
              <p className="text-[11px] text-slate-400 mt-1">Check the formula before relying on it.</p>
              <div className="flex justify-end mt-1">
                <button type="button" className={primary} disabled={!canEdit} onClick={() => onInsert(answer.formula)}>
                  Insert{context.cell ? ` in ${context.cell}` : ""}
                </button>
              </div>
            </div>
          )}
          {error && <p role="alert" className="text-xs text-red-600 mt-2">{error}</p>}
        </>
      )}
      <div className="flex justify-end mt-3">
        <button type="button" className="text-sm rounded-full px-4 py-1.5 hover:bg-slate-100 text-slate-700" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
