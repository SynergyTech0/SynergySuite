"use client";

// Insert slicers (one per chosen field) or a timeline, for a table or a pivot table.
import { useState } from "react";
import { Modal } from "./SheetDialogs";
import type { FieldSource } from "@/lib/sheet-slicers";

const button = "text-sm rounded-full px-4 py-1.5";
const primary = `${button} bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40`;
const plain = `${button} hover:bg-slate-100 text-slate-700`;

export function InsertSlicerDialog({
  kind,
  sources,
  initial,
  dateFields,
  onInsert,
  onClose,
}: {
  kind: "slicer" | "timeline";
  sources: FieldSource[];
  /** The source the selection sits in, if any. */
  initial?: string;
  /** Fields that hold dates, per source key (for timelines). */
  dateFields: (s: FieldSource) => string[];
  onInsert: (source: FieldSource, fields: string[]) => void;
  onClose: () => void;
}) {
  const key = (s: FieldSource) => `${s.kind}:${s.id}`;
  const [sourceKey, setSourceKey] = useState(initial && sources.some((s) => key(s) === initial) ? initial : sources[0] ? key(sources[0]) : "");
  const [fields, setFields] = useState<string[]>([]);
  const source = sources.find((s) => key(s) === sourceKey);
  const choices = source ? (kind === "timeline" ? dateFields(source) : source.fields) : [];
  const title = kind === "timeline" ? "Insert timeline" : "Insert slicers";
  return (
    <Modal title={title} onClose={onClose}>
      {!sources.length ? (
        <p className="text-sm text-slate-600">Slicers filter a table or a pivot table. Format a range as a table, or insert a pivot table, first.</p>
      ) : (
        <div className="space-y-3 w-[min(24rem,80vw)]">
          <label className="block text-sm text-slate-700">
            For
            <select
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={sourceKey}
              onChange={(e) => {
                setSourceKey(e.target.value);
                setFields([]);
              }}
              aria-label="Table or pivot table"
            >
              {sources.map((s) => (
                <option key={key(s)} value={key(s)}>
                  {s.kind === "table" ? "Table" : "Pivot table"}: {s.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="text-sm text-slate-700">
            <legend className="mb-1">{kind === "timeline" ? "Date field" : "Fields"}</legend>
            {choices.length === 0 && <p className="text-slate-500">{kind === "timeline" ? "No field holds dates." : "No fields."}</p>}
            <div className="max-h-48 overflow-auto space-y-1">
              {choices.map((f) => (
                <label key={f} className="flex items-center gap-2">
                  <input
                    type={kind === "timeline" ? "radio" : "checkbox"}
                    name="slicer-field"
                    checked={fields.includes(f)}
                    onChange={(e) => setFields(kind === "timeline" ? [f] : e.target.checked ? [...fields, f] : fields.filter((x) => x !== f))}
                    aria-label={`Field ${f}`}
                  />
                  {f}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button className={plain} onClick={onClose}>
          Cancel
        </button>
        <button
          className={primary}
          disabled={!source || !fields.length}
          onClick={() => {
            onInsert(source!, fields);
            onClose();
          }}
        >
          OK
        </button>
      </div>
    </Modal>
  );
}
