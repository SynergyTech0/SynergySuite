"use client";

// File > Sensitivity: the file's Microsoft Purview label, as Office records it.
import { useState } from "react";
import { Modal } from "./SheetDialogs";
import { DEFAULT_LABELS, type SensitivityLabel } from "@/lib/sensitivity";

const button = "text-sm rounded-full px-4 py-1.5";

/** The labels to choose from: the file's own (if not one of ours) and the usual set. */
export const labelChoices = (current?: SensitivityLabel | null) => (current && !DEFAULT_LABELS.some((l) => l.id === current.id) ? [current, ...DEFAULT_LABELS] : DEFAULT_LABELS);

export const labelColor = (l: SensitivityLabel) => l.color || DEFAULT_LABELS.find((d) => d.id === l.id || d.name.toLowerCase() === l.name.toLowerCase())?.color || "#475569";

export function SensitivityDialog({ current, canEdit, onSave, onClose }: { current?: SensitivityLabel | null; canEdit: boolean; onSave: (label: SensitivityLabel | null) => Promise<void>; onClose: () => void }) {
  const [pick, setPick] = useState<string>(current?.id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choices = labelChoices(current);
  return (
    <Modal title="Sensitivity" onClose={onClose}>
      <div className="w-[min(26rem,85vw)] space-y-2 text-sm text-slate-700">
        <p className="text-slate-500">The label is saved in the file the way Office records it, so Excel and other tools see it. It marks the file only: encryption a label may add in Microsoft 365 is not applied here.</p>
        <div role="radiogroup" aria-label="Sensitivity label" className="space-y-1">
          {[{ id: "", name: "No label" } as SensitivityLabel, ...choices].map((l) => (
            <label key={l.id || "none"} className="flex items-center gap-2">
              <input type="radio" name="sensitivity" checked={pick === l.id} disabled={!canEdit} onChange={() => setPick(l.id)} />
              {l.id && <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: labelColor(l) }} />}
              {l.name}
            </label>
          ))}
        </div>
        {error && (
          <p className="text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className={`${button} hover:bg-slate-100`} onClick={onClose}>
          Cancel
        </button>
        <button
          className={`${button} bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40`}
          disabled={!canEdit || busy || pick === (current?.id || "")}
          onClick={() => {
            setBusy(true);
            const chosen = choices.find((l) => l.id === pick);
            const label = chosen ? { id: chosen.id, name: chosen.name, ...(chosen.siteId ? { siteId: chosen.siteId } : {}), method: "Privileged" as const, setDate: new Date().toISOString().replace(/\.\d+Z$/, "Z") } : null;
            onSave(label)
              .then(onClose)
              .catch((e) => setError((e as Error).message))
              .finally(() => setBusy(false));
          }}
        >
          Apply
        </button>
      </div>
    </Modal>
  );
}
