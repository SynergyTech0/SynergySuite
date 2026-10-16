"use client";

// Data > Edit links: the other workbooks this one's formulas read, with
// Update values, Change source, Break link, and adding a link.
import { useEffect, useState } from "react";
import { Modal } from "./SheetDialogs";
import type { WorkbookLink } from "@/lib/workbook-links";

const button = "text-xs rounded-full px-3 py-1";
const plain = `${button} border border-slate-300 hover:bg-slate-100 text-slate-700 disabled:opacity-40`;
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const refFor = (name: string, sheet: string) => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(sheet) ? `[${name}]${sheet}!A1` : `'[${name}]${sheet}'!A1`);

export function LinksDialog({
  links,
  canEdit,
  sheets,
  onAdd,
  onUpdate,
  onChangeSource,
  onBreak,
  onClose,
}: {
  links: WorkbookLink[];
  canEdit: boolean;
  /** The spreadsheets one may link to. */
  sheets: () => Promise<{ id: string; title: string }[]>;
  onAdd: (doc: { id: string; title: string }) => Promise<string>;
  onUpdate: (names?: string[]) => Promise<string[]>;
  onChangeSource: (name: string, doc: { id: string; title: string }) => Promise<void>;
  onBreak: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [docs, setDocs] = useState<{ id: string; title: string }[] | null>(null);
  const [pick, setPick] = useState("");
  const [changing, setChanging] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void sheets().then(setDocs);
  }, [sheets]);
  const run = async (f: () => Promise<string | void>) => {
    setBusy(true);
    setMessage("");
    try {
      const m = await f();
      if (m) setMessage(m);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const doc = docs?.find((d) => d.id === pick);
  return (
    <Modal title="Links to other workbooks" onClose={onClose}>
      {links.length === 0 ? (
        <p className="text-sm text-slate-500 mb-3">No links yet. Formulas such as <code className="text-xs bg-slate-100 px-1 rounded">=[Budget]Sheet1!B2</code> read another spreadsheet; typing one links the spreadsheet with that name.</p>
      ) : (
        <ul className="divide-y divide-slate-100 border border-slate-200 rounded mb-3 max-h-64 overflow-y-auto" aria-label="Links">
          {links.map((l) => (
            <li key={l.name} className="px-3 py-2" data-testid="workbook-link" data-name={l.name}>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium text-slate-800 truncate">[{l.name}]</span>
                <span className="text-xs text-slate-500 truncate">{l.docId ? l.title : `${l.file} (from Excel)`}</span>
              </div>
              <div className="text-[11px] text-slate-400">Values from {when(l.updated)} · e.g. {refFor(l.name, l.cache.sheets[0]?.name || "Sheet1")}</div>
              {canEdit && (
                <div className="flex gap-1.5 mt-1">
                  <button type="button" className={plain} disabled={busy || !l.docId} onClick={() => void run(async () => ((await onUpdate([l.name])).length ? `"${l.name}" could not be updated.` : `Updated "${l.name}".`))}>Update values</button>
                  <button type="button" className={plain} disabled={busy} onClick={() => setChanging(changing === l.name ? null : l.name)}>Change source</button>
                  <button type="button" className={plain} disabled={busy} onClick={() => void run(async () => { await onBreak(l.name); return `Formulas reading "${l.name}" now hold their values.`; })}>Break link</button>
                </div>
              )}
              {changing === l.name && (
                <select
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  aria-label={`New source for ${l.name}`}
                  defaultValue=""
                  onChange={(e) => {
                    const d = docs?.find((x) => x.id === e.target.value);
                    if (d) void run(async () => { await onChangeSource(l.name, d); setChanging(null); return `"${l.name}" now reads "${d.title}".`; });
                  }}
                >
                  <option value="" disabled>Choose a spreadsheet…</option>
                  {(docs || []).map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                </select>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="flex gap-2 items-center">
          <select className="flex-1 min-w-0 rounded border border-slate-300 px-2 py-1 text-sm" aria-label="Spreadsheet to link" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">{docs ? "Link a spreadsheet…" : "Loading…"}</option>
            {(docs || []).map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
          <button type="button" className={plain} disabled={busy || !doc} onClick={() => doc && void run(async () => { const name = await onAdd(doc); setPick(""); return `Linked. Use it in formulas as ${refFor(name, "Sheet1")}.`; })}>Add link</button>
        </div>
      )}
      {message && <p role="status" className="text-xs text-slate-600 mt-2">{message}</p>}
      <div className="flex justify-between mt-4">
        <button type="button" className={plain} disabled={busy || !canEdit || !links.some((l) => l.docId)} onClick={() => void run(async () => { const failed = await onUpdate(); return failed.length ? `Could not update: ${failed.join(", ")}.` : "All links updated."; })}>Update all</button>
        <button type="button" className="text-sm rounded-full px-4 py-1.5 hover:bg-slate-100 text-slate-700" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
