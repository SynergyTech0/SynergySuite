"use client";

// Table dialogs: sort rows by up to three columns.
import { useState } from "react";
import { Modal, btnCls, inputCls, Field } from "./WordDialogs";
import type { SortKey } from "@/lib/docs/tables";

const ok = `${btnCls} bg-indigo-600 text-white hover:bg-indigo-700`;
const cancel = `${btnCls} text-slate-600 hover:bg-slate-100`;

export function SortDialog({ columns, header, onApply, onClose }: { columns: string[]; header: boolean; onApply: (keys: SortKey[], hasHeader: boolean) => void; onClose: () => void }) {
  const [hasHeader, setHasHeader] = useState(header);
  const [keys, setKeys] = useState<(SortKey | null)[]>([{ col: 0, type: "text" }, null, null]);
  const set = (i: number, k: SortKey | null) => setKeys((ks) => ks.map((x, j) => (j === i ? k : x)));
  const label = (i: number) => (hasHeader && columns[i] ? columns[i] : `Column ${i + 1}`);
  return (
    <Modal
      title="Sort"
      onClose={onClose}
      footer={
        <>
          <button className={cancel} onClick={onClose}>Cancel</button>
          <button className={ok} data-testid="sort-ok" onClick={() => onApply(keys.filter((k): k is SortKey => !!k), hasHeader)}>OK</button>
        </>
      }
    >
      <div className="space-y-3">
        {keys.map((k, i) => (
          <div key={i} className="grid grid-cols-3 gap-2 items-end">
            <Field label={i === 0 ? "Sort by" : "Then by"}>
              <select
                aria-label={`Sort key ${i + 1} column`}
                className={inputCls}
                value={k ? String(k.col) : ""}
                onChange={(e) => set(i, e.target.value === "" ? null : { col: Number(e.target.value), type: k?.type || "text", desc: k?.desc })}
              >
                {i > 0 && <option value="">(none)</option>}
                {columns.map((_, c) => (
                  <option key={c} value={c}>{label(c)}</option>
                ))}
              </select>
            </Field>
            <Field label="Type">
              <select aria-label={`Sort key ${i + 1} type`} className={inputCls} disabled={!k} value={k?.type || "text"} onChange={(e) => k && set(i, { ...k, type: e.target.value as SortKey["type"] })}>
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
              </select>
            </Field>
            <Field label="Order">
              <select aria-label={`Sort key ${i + 1} order`} className={inputCls} disabled={!k} value={k?.desc ? "desc" : "asc"} onChange={(e) => k && set(i, { ...k, desc: e.target.value === "desc" })}>
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </Field>
          </div>
        ))}
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" aria-label="Header row" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> My list has a header row
        </label>
      </div>
    </Modal>
  );
}
