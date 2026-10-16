"use client";

// Version history for a spreadsheet: named and automatic versions, a preview
// of any version's sheets, rename, and restore (the spreadsheet as it is now is
// saved as a version first, so a restore can itself be undone from here).
import { useCallback, useEffect, useMemo, useState } from "react";
import { columnName, decodeWorkbook, previewGrid, versionDiff } from "@/lib/sheet-versions";
import type { UniverWorkbook } from "@/lib/xlsx";

type Version = { id: string; author_name: string; label: string | null; created_ms: string };

const when = (ms: string) => new Date(Number(ms)).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function SheetVersions({
  docId,
  canEdit,
  save,
  current,
  onRestore,
  onClose,
}: {
  docId: string;
  canEdit: boolean;
  /** Saves the spreadsheet as it is now as a version; resolves to its id (null when unchanged). */
  save: (label?: string) => Promise<string | null>;
  /** The workbook as it is now, to compare a version with. */
  current: () => UniverWorkbook | null;
  onRestore: (book: UniverWorkbook) => Promise<boolean>;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [namedOnly, setNamedOnly] = useState(false);
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState<{ id: string; book: UniverWorkbook; sheetId: string } | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/docs/${docId}/versions`).catch(() => null);
    if (res?.ok) setVersions((await res.json()).versions ?? []);
    setLoading(false);
  }, [docId]);
  useEffect(() => {
    void load();
  }, [load]);

  const open = async (id: string) => {
    setError("");
    const res = await fetch(`/api/docs/${docId}/versions/${id}`).catch(() => null);
    const book = res?.ok ? decodeWorkbook((await res.json()).version?.html) : null;
    if (!book) {
      setError("This version could not be read.");
      return;
    }
    setPreview({ id, book, sheetId: book.sheetOrder.find((s) => book.sheets[s]) || book.sheetOrder[0] });
  };
  const saveNow = async () => {
    const id = await save(draft.trim() || undefined);
    setDraft("");
    await load();
    setError(id ? "" : "No changes since the last version.");
  };
  const rename = async (v: Version) => {
    const label = window.prompt("Version name", v.label || "");
    if (label === null) return;
    await fetch(`/api/docs/${docId}/versions/${v.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label }) });
    await load();
  };
  const restore = async () => {
    if (!preview) return;
    if (!window.confirm("Restore this version? The spreadsheet as it is now is saved as a version first.")) return;
    await save("Before restore");
    if (await onRestore(preview.book)) {
      setPreview(null);
      await load();
    }
  };

  const grid = useMemo(() => (preview ? previewGrid(preview.book, preview.sheetId) : null), [preview]);
  const diff = useMemo(() => {
    const now = preview ? current() : null;
    return preview && now ? versionDiff(preview.book, now) : null;
  }, [preview, current]);
  const shown = namedOnly ? versions.filter((v) => v.label) : versions;
  const meta = preview ? versions.find((v) => v.id === preview.id) : undefined;

  return (
    <aside className="w-[26rem] shrink-0 border-l border-slate-200 bg-white flex flex-col min-h-0 no-print" data-testid="sheet-versions">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
        <h2 className="text-sm font-semibold text-slate-800">Version history</h2>
        <button type="button" className="ml-auto text-slate-400 hover:text-slate-700" aria-label="Close version history" onClick={onClose}>✕</button>
      </div>
      {preview && grid ? (
        <div className="flex-1 min-h-0 flex flex-col" data-testid="sheet-version-preview">
          <div className="px-4 py-2 border-b border-slate-100 text-xs text-slate-600 flex items-center gap-2">
            <button type="button" className="text-indigo-700 hover:underline" onClick={() => setPreview(null)}>← All versions</button>
            <span className="truncate">{meta?.label || (meta ? when(meta.created_ms) : "")}</span>
          </div>
          {diff && (
            <p className="px-4 py-1.5 text-xs text-slate-500 border-b border-slate-100" data-testid="sheet-version-diff">
              {diff.cellsChanged ? `${diff.cellsChanged} cell${diff.cellsChanged === 1 ? "" : "s"} differ from now` : "Same cells as now"}
              {diff.sheetsAdded.length ? ` · since then: ${diff.sheetsAdded.join(", ")} added` : ""}
              {diff.sheetsRemoved.length ? ` · since then: ${diff.sheetsRemoved.join(", ")} removed` : ""}
            </p>
          )}
          <div className="flex gap-1 px-3 pt-2 overflow-x-auto">
            {preview.book.sheetOrder.filter((id) => preview.book.sheets[id]).map((id) => (
              <button
                key={id}
                type="button"
                className={`text-xs rounded-t px-2 py-1 border-b-2 ${id === preview.sheetId ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
                onClick={() => setPreview({ ...preview, sheetId: id })}
              >
                {preview.book.sheets[id].name}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-auto bg-slate-50 p-2">
            <table className="border-collapse text-[11px] bg-white" data-testid="sheet-version-grid">
              <thead>
                <tr>
                  <th className="sticky top-0 bg-slate-100 border border-slate-200 w-8" />
                  {grid.columns.map((c) => (
                    <th key={c} className="sticky top-0 bg-slate-100 border border-slate-200 px-1 font-normal text-slate-500 min-w-[4rem]">{columnName(c)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((r, i) => (
                  <tr key={r}>
                    <td className="bg-slate-100 border border-slate-200 px-1 text-right text-slate-500">{r + 1}</td>
                    {grid.cells[i].map((text, j) => (
                      <td key={j} className="border border-slate-200 px-1 max-w-[8rem] truncate text-slate-800">{text}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {(grid.more.rows || grid.more.columns) && <p className="text-[11px] text-slate-400 mt-1">Showing the top left of the sheet.</p>}
          </div>
          {canEdit && (
            <div className="p-3 border-t border-slate-200">
              <button type="button" className="w-full rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700" data-testid="sheet-version-restore" onClick={restore}>Restore this version</button>
            </div>
          )}
        </div>
      ) : (
        <>
          {canEdit && (
            <div className="p-3 border-b border-slate-100 flex gap-2">
              <input className="flex-1 min-w-0 h-8 rounded border border-slate-300 px-2 text-sm" placeholder="Name this version (optional)" data-testid="sheet-version-name" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") void saveNow(); }} />
              <button type="button" className="rounded bg-slate-100 px-3 text-sm text-slate-700 hover:bg-slate-200" data-testid="sheet-version-save" onClick={() => void saveNow()}>Save</button>
            </div>
          )}
          <label className="flex items-center gap-2 px-4 py-2 text-xs text-slate-600 border-b border-slate-100">
            <input type="checkbox" checked={namedOnly} onChange={(e) => setNamedOnly(e.target.checked)} />Only named versions
          </label>
          {error && <p className="px-4 py-2 text-xs text-amber-700" data-testid="sheet-version-error">{error}</p>}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {loading ? (
              <p className="text-xs text-slate-400 p-4 text-center">Loading…</p>
            ) : shown.length === 0 ? (
              <p className="text-xs text-slate-400 p-4 text-center">{namedOnly ? "No named versions." : "No saved versions yet. They're captured automatically as you edit."}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {shown.map((v) => (
                  <li key={v.id} className="group flex items-start gap-2 px-4 py-2 hover:bg-slate-50" data-testid="sheet-version-item" data-label={v.label || ""}>
                    <button type="button" className="flex-1 min-w-0 text-left" onClick={() => void open(v.id)}>
                      <div className="text-sm text-slate-800 truncate">{v.label || when(v.created_ms)}</div>
                      <div className="text-xs text-slate-500 truncate">{v.label ? `${when(v.created_ms)} · ` : ""}{v.author_name}</div>
                    </button>
                    {canEdit && <button type="button" className="text-xs text-slate-400 hover:text-indigo-700 opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => void rename(v)}>Rename</button>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
