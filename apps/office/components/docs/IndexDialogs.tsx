"use client";

// References › Mark entry (an XE field after the selection, or after every
// occurrence of the text) and Insert index (columns, letter headings, page
// numbers aligned right).
import { useState } from "react";
import type { IndexEntryAttrs, IndexOptions } from "@/lib/docs/word-index";
import { Modal, btnCls, inputCls, Field } from "./WordDialogs";

export function MarkEntryDialog({ selected, onMark, onClose }: { selected: string; onMark: (a: IndexEntryAttrs, all: string | null) => void; onClose: () => void }) {
  const [main, setMain] = useState(selected.trim().slice(0, 120));
  const [sub, setSub] = useState("");
  const [see, setSee] = useState("");
  const [crossRef, setCrossRef] = useState(false);
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const attrs: IndexEntryAttrs = { entry: [main.trim(), sub.trim()].filter(Boolean).join(":"), ...(bold ? { bold } : {}), ...(italic ? { italic } : {}), ...(crossRef && see.trim() ? { see: see.trim() } : {}) };
  return (
    <Modal
      title="Mark index entry"
      onClose={onClose}
      footer={
        <>
          <button className={`${btnCls} text-slate-600 hover:bg-slate-100`} onClick={onClose}>Close</button>
          <button className={`${btnCls} border border-slate-300 hover:bg-slate-50`} data-testid="xe-mark-all" disabled={!main.trim() || !selected.trim()} onClick={() => onMark(attrs, selected.trim())}>Mark all</button>
          <button className={`${btnCls} bg-indigo-600 text-white hover:bg-indigo-700`} data-testid="xe-mark" disabled={!main.trim()} onClick={() => onMark(attrs, null)}>Mark</button>
        </>
      }
    >
      <div className="space-y-2">
        <Field label="Main entry">
          <input aria-label="Main entry" className={inputCls} value={main} onChange={(e) => setMain(e.target.value)} autoFocus />
        </Field>
        <Field label="Subentry">
          <input aria-label="Subentry" className={inputCls} value={sub} onChange={(e) => setSub(e.target.value)} />
        </Field>
        <div className="text-xs text-slate-500 pt-1">Options</div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={crossRef} onChange={(e) => setCrossRef(e.target.checked)} /> Cross-reference: See
          <input aria-label="See also" className={`${inputCls} flex-1`} disabled={!crossRef} value={see} onChange={(e) => setSee(e.target.value)} />
        </label>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1"><input type="checkbox" checked={bold} onChange={(e) => setBold(e.target.checked)} /> Bold page number</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={italic} onChange={(e) => setItalic(e.target.checked)} /> Italic page number</label>
        </div>
        <p className="text-[11px] text-slate-500">Entries are hidden in the text; View › Formatting marks shows them. Mark all marks every occurrence of the selected text.</p>
      </div>
    </Modal>
  );
}

export function IndexDialog({ initial, onOk, onClose }: { initial?: Partial<IndexOptions>; onOk: (o: IndexOptions) => void; onClose: () => void }) {
  const [columns, setColumns] = useState(initial?.columns ?? 2);
  const [rightAlign, setRightAlign] = useState(!!initial?.rightAlign);
  const [headings, setHeadings] = useState(initial?.headings ?? true);
  return (
    <Modal
      title="Index"
      onClose={onClose}
      footer={
        <>
          <button className={`${btnCls} text-slate-600 hover:bg-slate-100`} onClick={onClose}>Cancel</button>
          <button className={`${btnCls} bg-indigo-600 text-white hover:bg-indigo-700`} data-testid="index-ok" onClick={() => onOk({ columns, rightAlign, headings })}>OK</button>
        </>
      }
    >
      <div className="space-y-2">
        <Field label="Columns">
          <input type="number" min={1} max={4} aria-label="Index columns" className={inputCls} value={columns} onChange={(e) => setColumns(Math.max(1, Math.min(4, Number(e.target.value) || 1)))} />
        </Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rightAlign} onChange={(e) => setRightAlign(e.target.checked)} /> Right align page numbers</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={headings} onChange={(e) => setHeadings(e.target.checked)} /> Letter headings</label>
      </div>
    </Modal>
  );
}
