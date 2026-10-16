"use client";

// Review > Check Accessibility: the checker's findings, errors first, each
// taking you to its place; pictures, shapes and charts get their alt text here.
import { useState } from "react";
import type { A11yIssue, A11yTarget } from "@/lib/sheet-a11y";

const SEVERITY = { error: "Errors", warning: "Warnings", tip: "Tips" } as const;

function AltEditor({ target, onSave }: { target: A11yTarget; onSave: (t: A11yTarget, alt: string, decorative: boolean) => Promise<void> }) {
  const [alt, setAlt] = useState("");
  const [busy, setBusy] = useState(false);
  const save = (decorative: boolean) => {
    setBusy(true);
    onSave(target, decorative ? "" : alt.trim(), decorative).finally(() => setBusy(false));
  };
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      <input className="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-0.5 text-xs" aria-label="Alt text" placeholder="Describe it in a sentence or two" value={alt} onChange={(e) => setAlt(e.target.value)} />
      <button type="button" className="rounded bg-indigo-600 px-2 py-0.5 text-xs text-white disabled:opacity-40" disabled={busy || !alt.trim()} onClick={() => save(false)}>
        Save alt text
      </button>
      <button type="button" className="rounded px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100" disabled={busy} onClick={() => save(true)}>
        Mark as decorative
      </button>
    </div>
  );
}

export function AccessibilityPanel({ issues, canEdit, onGo, onSaveAlt, onClose }: { issues: A11yIssue[]; canEdit: boolean; onGo: (i: A11yIssue) => void; onSaveAlt: (t: A11yTarget, alt: string, decorative: boolean) => Promise<void>; onClose: () => void }) {
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-white" role="complementary" aria-label="Accessibility">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h2 className="text-sm font-medium text-slate-800">Accessibility</h2>
        <button type="button" className="text-slate-500 hover:text-slate-800" aria-label="Close accessibility" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-auto p-3 text-sm">
        {issues.length === 0 ? (
          <p className="text-slate-600" data-testid="a11y-clean">
            No accessibility issues found. People with disabilities should not have difficulty reading this workbook.
          </p>
        ) : (
          (["error", "warning", "tip"] as const).map((sev) => {
            const list = issues.filter((i) => i.severity === sev);
            if (!list.length) return null;
            return (
              <section key={sev}>
                <h3 className={`mb-1 text-xs font-semibold uppercase ${sev === "error" ? "text-red-700" : sev === "warning" ? "text-amber-700" : "text-slate-500"}`}>
                  {SEVERITY[sev]} ({list.length})
                </h3>
                <ul className="space-y-1.5" aria-label={SEVERITY[sev]}>
                  {list.map((i, n) => (
                    <li key={n} className="rounded border border-slate-200 px-2 py-1" data-rule={i.rule}>
                      <button type="button" className="w-full text-left" onClick={() => onGo(i)}>
                        <div className="text-xs text-slate-500">
                          {i.rule} · {i.sheetName}
                          {i.ref ? `!${i.ref}` : ""}
                        </div>
                        <div className="text-slate-800">{i.message}</div>
                      </button>
                      {i.target && canEdit && <AltEditor target={i.target} onSave={onSaveAlt} />}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </aside>
  );
}
