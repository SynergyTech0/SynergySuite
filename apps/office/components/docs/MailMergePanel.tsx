"use client";

// Mailings: pick a Sheet as the recipient list, insert its fields, preview
// each recipient's copy, then merge to a new document or a .docx download.
import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import { mergeFieldsIn, sourceKey, type MergeSource, type MergeTable } from "@/lib/docs/mail-merge";
import type { PMNode } from "@/lib/docs/model";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { liveBookFrom } from "@/lib/docs/sheet-live";

type SheetDoc = { id: string; title: string };

function collabUrlFor(collabUrl?: string): string {
  return collabUrl || `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/collab`;
}

/**
 * Follow a Sheet's live state (its collaboration document: base workbook plus
 * the changes since) and call back with its recipients whenever it changes.
 * Calls back with null when the Sheet has no live state (never opened since
 * collaboration started); the saved copy is right then.
 */
export function watchMergeTable(source: MergeSource, onTable: (t: (MergeTable & { tabs: { id: string; name: string }[] }) | null) => void, collabUrl?: string): () => void {
  const ydoc = new Y.Doc();
  const provider = new HocuspocusProvider({ url: collabUrlFor(collabUrl), name: source.docId, document: ydoc });
  const meta = ydoc.getMap<string>("meta");
  const ops = ydoc.getArray<string>("ops");
  let timer: ReturnType<typeof setTimeout> | null = null;
  let done = false;
  const emit = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      const live = liveBookFrom(meta.get("base"), ops.toArray());
      if (done) return;
      if (!live) return onTable(null);
      const [{ cellDisplayText }, { sheetTable }, { recalcBook }] = await Promise.all([import("@/lib/xlsx"), import("@/lib/docs/mail-merge"), import("@/lib/docs/sheet-recalc")]);
      if (done) return;
      // formula results don't travel with the edits: work them out again
      const book = await recalcBook(live.book);
      if (done) return;
      const tabs = book.sheetOrder.filter((id) => book.sheets[id]).map((id) => ({ id, name: String(book.sheets[id].name || id) }));
      onTable({ ...sheetTable(book as never, source.sheetId, (c) => cellDisplayText(book as never, c as never)), live: true, unsupported: live.unsupported, source: sourceKey(source), tabs });
    }, 120);
  };
  provider.on("synced", emit);
  ops.observe(emit);
  meta.observe(emit);
  return () => {
    done = true;
    if (timer) clearTimeout(timer);
    ops.unobserve(emit);
    meta.unobserve(emit);
    provider.destroy();
    ydoc.destroy();
  };
}

/** The recipients of a source: the Sheet's saved contents, its first row naming the fields. */
export async function loadMergeTable(source: MergeSource): Promise<{ table: MergeTable; tabs: { id: string; name: string }[] }> {
  const r = await fetch(`/api/docs/${source.docId}`);
  if (!r.ok) throw new Error(r.status === 404 ? "That Sheet is gone or no longer shared with you." : "The Sheet could not be read.");
  const { document } = await r.json();
  const book = document?.snapshot;
  if (!book?.sheets || !book.sheetOrder) return { table: { fields: [], records: [] }, tabs: [] };
  const [{ cellDisplayText }, { sheetTable }] = await Promise.all([import("@/lib/xlsx"), import("@/lib/docs/mail-merge")]);
  const tabs = (book.sheetOrder as string[]).map((id) => ({ id, name: String(book.sheets[id]?.name || id) }));
  return { table: { ...sheetTable(book, source.sheetId, (c) => cellDisplayText(book, c as never)), source: sourceKey(source) }, tabs };
}

export function MailMergePanel({
  editor,
  source,
  table,
  editable,
  preview,
  onSource,
  onTable,
  onPreview,
  onMergeNew,
  onMergeDownload,
  onClose,
}: {
  editor: Editor;
  source: MergeSource | undefined;
  table: MergeTable | null;
  editable: boolean;
  preview: number | null;
  onSource: (s: MergeSource | undefined) => void;
  onTable: (t: MergeTable | null) => void;
  onPreview: (i: number | null) => void;
  onMergeNew: () => void;
  onMergeDownload: () => void;
  onClose: () => void;
}) {
  const [sheets, setSheets] = useState<SheetDoc[] | null>(null);
  const [tabs, setTabs] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    fetch("/api/docs")
      .then((r) => r.json())
      .then((j) => setSheets((j.documents || []).filter((d: { kind: string }) => d.kind === "sheet").map((d: SheetDoc) => ({ id: d.id, title: d.title }))))
      .catch(() => setSheets([]));
  }, []);
  const load = async (s: MergeSource | undefined) => {
    setError("");
    if (!s) {
      onTable(null);
      setTabs([]);
      return;
    }
    setLoading(true);
    try {
      const r = await loadMergeTable(s);
      onTable(r.table);
      setTabs(r.tabs);
    } catch (e) {
      onTable(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (source && !table) load(source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.docId, source?.sheetId]);
  const used = mergeFieldsIn((editor.getJSON().content || []) as PMNode[]);
  const missing = table ? used.filter((f) => !table.fields.some((x) => x.toLowerCase().replace(/[\s_]+/g, "") === f.toLowerCase().replace(/[\s_]+/g, ""))) : [];
  const n = table?.records.length || 0;
  const step = "text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5";
  const btn = "text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40";
  return (
    <aside className="w-80 border-l border-slate-200 bg-white flex flex-col no-print" data-testid="merge-pane">
      <div className="flex items-center justify-between px-4 h-11 border-b border-slate-100">
        <div className="text-sm font-semibold text-slate-700">Mail merge</div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-sm">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-5 text-sm">
        <section>
          <div className={step}>1 · Recipients</div>
          <select
            className="h-8 border border-slate-300 rounded-md px-2 text-sm w-full"
            value={source?.docId || ""}
            disabled={!editable}
            data-testid="merge-sheet"
            onChange={(e) => {
              const d = sheets?.find((x) => x.id === e.target.value);
              const s = d ? { docId: d.id, title: d.title } : undefined;
              onPreview(null);
              onSource(s);
              load(s);
            }}
          >
            <option value="">{sheets === null ? "Loading…" : sheets.length ? "Choose a Sheet…" : "No Sheets yet"}</option>
            {sheets?.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
          {source && tabs.length > 1 && (
            <select
              className="mt-2 h-8 border border-slate-300 rounded-md px-2 text-sm w-full"
              value={source.sheetId || tabs[0].id}
              disabled={!editable}
              data-testid="merge-tab"
              onChange={(e) => {
                const s = { ...source, sheetId: e.target.value, sheetName: tabs.find((t) => t.id === e.target.value)?.name };
                onPreview(null);
                onSource(s);
                load(s);
              }}
            >
              {tabs.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
          <div className="text-xs text-slate-500 mt-1.5" data-testid="merge-count">
            {loading ? "Reading the Sheet…" : error ? <span className="text-rose-600">{error}</span> : table ? `${n} recipient${n === 1 ? "" : "s"} · the first row names the fields` : "The Sheet's first row names the fields; each row after it is a recipient."}
          </div>
          {table?.live && (
            <div className="text-[11px] text-emerald-700 mt-1 flex items-center gap-1" data-testid="merge-live">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Live: changes in the Sheet show up here as they are made
            </div>
          )}
          {table?.unsupported && table.unsupported.length > 0 && <div className="text-[11px] text-amber-700 mt-1">Some recent changes in the Sheet could not be read live; they appear once the Sheet saves.</div>}
          {source && <button className="text-xs text-indigo-600 hover:underline mt-1" onClick={() => load(source)}>Refresh</button>}
        </section>
        {table && (
          <section>
            <div className={step}>2 · Insert fields</div>
            <div className="flex flex-wrap gap-1">
              {table.fields.map((f) => (
                <button key={f} className={btn} disabled={!editable} data-testid="merge-field-btn" onClick={() => editor.chain().focus().insertMergeField(f).run()}>
                  «{f}»
                </button>
              ))}
            </div>
            {missing.length > 0 && <div className="text-xs text-amber-700 mt-2">Not in the Sheet: {missing.map((m) => `«${m}»`).join(", ")}</div>}
          </section>
        )}
        {table && n > 0 && (
          <section>
            <div className={step}>3 · Preview</div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={preview !== null} onChange={(e) => onPreview(e.target.checked ? 0 : null)} data-testid="merge-preview" /> Preview results
            </label>
            {preview !== null && (
              <div className="flex items-center gap-2 mt-2">
                <button className={btn} disabled={preview <= 0} onClick={() => onPreview(preview - 1)} data-testid="merge-prev">◀</button>
                <span className="text-xs text-slate-600" data-testid="merge-at">Recipient {preview + 1} of {n}</span>
                <button className={btn} disabled={preview >= n - 1} onClick={() => onPreview(preview + 1)} data-testid="merge-next">▶</button>
              </div>
            )}
          </section>
        )}
        {table && n > 0 && (
          <section>
            <div className={step}>4 · Finish and merge</div>
            <div className="flex flex-col gap-2">
              <button className="h-8 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-40" disabled={!used.length} onClick={onMergeNew} data-testid="merge-new">Merge to a new document</button>
              <button className="h-8 rounded-md border border-slate-300 text-sm hover:bg-slate-50 disabled:opacity-40" disabled={!used.length} onClick={onMergeDownload} data-testid="merge-download">Download merged .docx</button>
              {!used.length && <div className="text-xs text-slate-500">Insert at least one field first.</div>}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}
