"use client";

// File > Sensitivity in Docs, Sheets and Slides: the organization's labels from the Admin center
// (GET /api/labels), the dialog that picks one, and the chip each editor shows. A file's own
// label that isn't one of the organization's (from another company) stays offered as a choice.
import { useEffect, useState } from "react";
import { Modal } from "./SheetDialogs";
import { DEFAULT_LABELS, type SensitivityLabel } from "@/lib/sensitivity";
import { DEFAULT_LABELS as SUITE_LABELS, knownLabel, type FileLabel, type LabelList, type SensitivityLabel as OrgLabel } from "@/lib/labels";

const button = "text-sm rounded-full px-4 py-1.5";

const FALLBACK: LabelList = { labels: SUITE_LABELS, defaultLabelId: null };
let listPromise: Promise<LabelList> | null = null;

/** The organization's labels, fetched once per page; null until they arrive (the usual four if they can't). */
export function useLabelList(initial?: LabelList | null): LabelList | null {
  const [list, setList] = useState<LabelList | null>(initial ?? null);
  useEffect(() => {
    if (initial) return;
    listPromise ??= fetch("/api/labels")
      .then((r) => (r.ok ? (r.json() as Promise<LabelList>) : Promise.reject(new Error(`labels ${r.status}`))))
      .catch(() => {
        listPromise = null;
        return FALLBACK;
      });
    let live = true;
    void listPromise.then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, [initial]);
  return list;
}

const asChoice = (l: OrgLabel): SensitivityLabel => ({ id: l.id, name: l.name, color: l.color });

/** The labels to choose from: the file's own (if not one of the organization's) and the organization's. */
export const labelChoices = (current?: SensitivityLabel | null, list?: LabelList | null): SensitivityLabel[] => {
  const org = (list ?? FALLBACK).labels.map(asChoice);
  return current && !org.some((l) => l.id.toLowerCase() === current.id.toLowerCase()) ? [current, ...org] : org;
};

/** The organization's label behind a file label, matched by id or name. */
export const orgLabelOf = (l: FileLabel | null | undefined, list?: LabelList | null): OrgLabel | null => knownLabel({ labels: (list ?? FALLBACK).labels }, l);

export const labelColor = (l: SensitivityLabel, list?: LabelList | null) =>
  l.color || orgLabelOf(l, list)?.color || DEFAULT_LABELS.find((d) => d.id === l.id || d.name.toLowerCase() === l.name.toLowerCase())?.color || "#475569";

/** The chip's tooltip: the label, the marking it asks for and its description. */
export const labelTooltip = (l: SensitivityLabel, list?: LabelList | null) => {
  const org = orgLabelOf(l, list);
  return [`Sensitivity: ${l.name}`, org?.protection.marking && `Marked ${org.protection.marking}`, org?.protection.blockExternal && "Can't be shared outside the organization", org?.description].filter(Boolean).join("\n");
};

/** The label chip in an editor's title bar; opens the dialog. */
export function LabelChip({ label, list, onClick }: { label: SensitivityLabel; list?: LabelList | null; onClick: () => void }) {
  const marking = orgLabelOf(label, list)?.protection.marking;
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50" title={labelTooltip(label, list)} data-testid="sensitivity-label">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: labelColor(label, list) }} />
      {label.name}
      {marking && <span className="text-[10px] font-semibold tracking-wide text-slate-500">· {marking}</span>}
    </button>
  );
}

export function SensitivityDialog({
  current,
  canEdit,
  onSave,
  onClose,
  app = "Excel",
}: {
  current?: SensitivityLabel | null;
  canEdit: boolean;
  onSave: (label: SensitivityLabel | null) => Promise<void>;
  onClose: () => void;
  /** Which Office application reads the saved file, for the explanation. */
  app?: string;
}) {
  const list = useLabelList();
  const [pick, setPick] = useState<string>(current?.id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choices = labelChoices(current, list);
  const isPick = (id: string) => pick.toLowerCase() === id.toLowerCase();
  return (
    <Modal title="Sensitivity" onClose={onClose}>
      <div className="w-[min(26rem,85vw)] space-y-2 text-sm text-slate-700">
        <p className="text-slate-500">The label is saved in the file the way Office records it, so {app} and other tools see it. It marks the file only: encryption a label may add in Microsoft 365 is not applied here.</p>
        <div role="radiogroup" aria-label="Sensitivity label" className="space-y-1">
          {[{ id: "", name: "No label" } as SensitivityLabel, ...choices].map((l) => {
            const org = l.id ? orgLabelOf(l, list) : null;
            return (
              <label key={l.id || "none"} className="flex items-start gap-2">
                <input type="radio" name="sensitivity" className="mt-1" checked={isPick(l.id)} disabled={!canEdit} onChange={() => setPick(l.id)} />
                <span>
                  <span className="flex items-center gap-2">
                    {l.id && <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: labelColor(l, list) }} />}
                    {l.name}
                    {org?.protection.marking && <span className="text-[11px] font-semibold tracking-wide text-slate-400">{org.protection.marking}</span>}
                  </span>
                  {org?.description && <span className="block text-xs text-slate-500">{org.description}</span>}
                  {l.id && !org && <span className="block text-xs text-slate-500">This file's own label, from outside your organization.</span>}
                </span>
              </label>
            );
          })}
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
          disabled={!canEdit || busy || isPick(current?.id || "")}
          onClick={() => {
            setBusy(true);
            const chosen = choices.find((l) => isPick(l.id));
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

/** Changes a document's label (documents.label_id). Returns the label id now stored. */
export async function putDocLabel(docId: string, body: { labelId: string | null } | { fromFile: FileLabel; clearIfUnknown?: boolean }): Promise<string | null> {
  const r = await fetch(`/api/docs/${docId}/label`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as { labelId?: string | null; error?: string };
  if (!r.ok) throw new Error(j.error || "Couldn't change the label.");
  return j.labelId ?? null;
}

/**
 * A Docs or Slides document's label: the organization's label stored on the document, else the
 * file's own label (`fileLabel`, from an opened file's properties).
 */
export function useDocLabel(docId: string | undefined, initialLabelId: string | null | undefined, fileLabel?: FileLabel | null) {
  const list = useLabelList();
  const [labelId, setLabelId] = useState<string | null>(initialLabelId ?? null);
  const org = labelId ? (list?.labels.find((l) => l.id.toLowerCase() === labelId.toLowerCase()) ?? null) : null;
  const current: SensitivityLabel | null = org ? asChoice(org) : labelId && !list ? null : fileLabel ? { id: fileLabel.id, name: fileLabel.name } : null;
  const save = async (body: Parameters<typeof putDocLabel>[1]) => {
    if (!docId) return labelId;
    const id = await putDocLabel(docId, body);
    setLabelId(id);
    return id;
  };
  return {
    list,
    labelId,
    /** The organization's label, if the document has one. */
    org,
    /** What the chip shows. */
    current,
    /** The label an export writes into the file; undefined keeps the file's own properties. */
    exportLabel: org ? ({ id: org.id, name: org.name } as FileLabel) : undefined,
    choose: (l: SensitivityLabel | null) => save(l && orgLabelOf(l, list) ? { labelId: orgLabelOf(l, list)!.id } : { labelId: null }),
    fromFile: (f: FileLabel, clearIfUnknown = false) => save({ fromFile: f, clearIfUnknown }),
  };
}
