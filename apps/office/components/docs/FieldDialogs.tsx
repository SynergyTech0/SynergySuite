"use client";

// Insert > Field (date, time, document info, page counts, formulas) and
// Insert > Symbol (Unicode subsets, special characters, recently used).
import { useMemo, useState } from "react";
import { Modal, btnCls, inputCls, Field } from "./WordDialogs";
import { FIELD_CHOICES, fieldKind, type FieldKind } from "@/lib/docs/doc-fields";
import { BUILTIN_PROPERTIES } from "@/lib/docs/model";

const ok = `${btnCls} bg-indigo-600 text-white hover:bg-indigo-700`;
const cancel = `${btnCls} text-slate-600 hover:bg-slate-100`;

const NUMBER_PICTURES = ["", "0", "#,##0", "#,##0.00", "$#,##0.00;($#,##0.00)", "0%", "0.00%"];

/** Build an instruction from a kind, a date or number picture and the formula text. */
export function buildInstr(kind: FieldKind, picture: string, formula: string): string {
  if (kind === "=") return `=${formula.replace(/^=/, "").trim() || "SUM(ABOVE)"}${picture ? ` \\# "${picture}"` : ""}`;
  const choice = FIELD_CHOICES.find((c) => c.kind === kind);
  if (choice?.formats) return `${kind} \\@ "${picture || choice.formats[0]}"`;
  if (kind === "FILENAME" && picture === "path") return "FILENAME \\p";
  return choice?.instr || kind;
}

export function FieldDialog({
  initial,
  formulaOnly,
  preview,
  onApply,
  onClose,
}: {
  initial?: string;
  formulaOnly?: boolean;
  preview: (instr: string) => string;
  onApply: (instr: string) => void;
  onClose: () => void;
}) {
  const start = initial ? fieldKind(initial) : formulaOnly ? "=" : "DATE";
  const [kind, setKind] = useState<FieldKind>(start || "DATE");
  const dateM = initial && /\\@\s+"([^"]*)"/.exec(initial);
  const numM = initial && /\\#\s+"([^"]*)"/.exec(initial);
  const [picture, setPicture] = useState<string>(dateM ? dateM[1] : numM ? numM[1] : "");
  const [formula, setFormula] = useState(initial && kind === "=" ? initial.replace(/\\[#@*]\s+(?:"[^"]*"|\S+)/g, "").trim().replace(/^=/, "") : "SUM(ABOVE)");
  const [raw, setRaw] = useState<string | null>(null);
  const choice = FIELD_CHOICES.find((c) => c.kind === kind);
  const instr = raw ?? buildInstr(kind, picture, formula);
  const shown = useMemo(() => preview(instr), [instr, preview]);
  const choices = formulaOnly ? FIELD_CHOICES.filter((c) => c.kind === "=") : FIELD_CHOICES;
  return (
    <Modal
      title={formulaOnly ? "Formula" : "Field"}
      onClose={onClose}
      footer={
        <>
          <button className={cancel} onClick={onClose}>Cancel</button>
          <button className={ok} data-testid="field-ok" onClick={() => onApply(instr)}>OK</button>
        </>
      }
    >
      <div className="grid grid-cols-[180px_1fr] gap-4">
        {!formulaOnly && (
          <div className="border border-slate-200 rounded max-h-72 overflow-y-auto" role="listbox" aria-label="Field names">
            {choices.map((c) => (
              <button
                key={c.kind}
                role="option"
                aria-selected={c.kind === kind}
                data-field-kind={c.kind}
                className={`block w-full text-left px-2 py-1 text-sm ${c.kind === kind ? "bg-indigo-50 text-indigo-700" : "hover:bg-slate-50"}`}
                onClick={() => {
                  setKind(c.kind);
                  setPicture("");
                  setRaw(null);
                }}
              >
                {c.label} <span className="text-[10px] text-slate-400">{c.kind === "=" ? "=" : c.kind}</span>
              </button>
            ))}
          </div>
        )}
        <div className={`space-y-3 ${formulaOnly ? "col-span-2" : ""}`}>
          {kind === "=" && (
            <Field label="Formula">
              <input aria-label="Formula expression" className={inputCls} value={formula} onChange={(e) => { setFormula(e.target.value); setRaw(null); }} />
            </Field>
          )}
          {kind === "=" && (
            <Field label="Number format">
              <select aria-label="Number format" className={inputCls} value={picture} onChange={(e) => { setPicture(e.target.value); setRaw(null); }}>
                {NUMBER_PICTURES.map((p) => (
                  <option key={p} value={p}>{p || "(general)"}</option>
                ))}
              </select>
            </Field>
          )}
          {choice?.formats && (
            <Field label="Date formats">
              <select aria-label="Date format" className={inputCls} value={picture || choice.formats[0]} onChange={(e) => { setPicture(e.target.value); setRaw(null); }}>
                {choice.formats.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </Field>
          )}
          {kind === "FILENAME" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={picture === "path"} onChange={(e) => { setPicture(e.target.checked ? "path" : ""); setRaw(null); }} /> Add path to file name
            </label>
          )}
          <Field label="Field code">
            <input aria-label="Field code" className={`${inputCls} font-mono text-xs`} value={instr} onChange={(e) => setRaw(e.target.value)} />
          </Field>
          <div className="text-sm">
            <span className="text-slate-400 mr-2">Preview:</span>
            <span data-testid="field-preview" className="text-slate-800">{shown || "(empty)"}</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}

const SUBSETS: { name: string; ranges: [number, number][] }[] = [
  { name: "Latin-1 Supplement", ranges: [[0xa1, 0xff]] },
  { name: "Latin Extended-A", ranges: [[0x100, 0x17f]] },
  { name: "Greek", ranges: [[0x391, 0x3a9], [0x3b1, 0x3c9]] },
  { name: "Currency", ranges: [[0x20a0, 0x20bf]] },
  { name: "General Punctuation", ranges: [[0x2010, 0x2027], [0x2030, 0x203a]] },
  { name: "Letterlike Symbols", ranges: [[0x2100, 0x214f]] },
  { name: "Number Forms", ranges: [[0x2150, 0x218b]] },
  { name: "Arrows", ranges: [[0x2190, 0x21ff]] },
  { name: "Mathematical Operators", ranges: [[0x2200, 0x22ff]] },
  { name: "Box Drawing", ranges: [[0x2500, 0x257f]] },
  { name: "Geometric Shapes", ranges: [[0x25a0, 0x25ff]] },
  { name: "Miscellaneous Symbols", ranges: [[0x2600, 0x26ff]] },
  { name: "Dingbats", ranges: [[0x2700, 0x27bf]] },
];
export const SPECIAL_CHARS: { label: string; ch: string; shortcut?: string }[] = [
  { label: "Em dash", ch: "—", shortcut: "Alt+Ctrl+Num -" },
  { label: "En dash", ch: "–", shortcut: "Ctrl+Num -" },
  { label: "Nonbreaking hyphen", ch: "‑", shortcut: "Ctrl+Shift+_" },
  { label: "Optional hyphen", ch: "­", shortcut: "Ctrl+-" },
  { label: "Em space", ch: " " },
  { label: "En space", ch: " " },
  { label: "Nonbreaking space", ch: " ", shortcut: "Ctrl+Shift+Space" },
  { label: "Copyright", ch: "©", shortcut: "Alt+Ctrl+C" },
  { label: "Registered", ch: "®", shortcut: "Alt+Ctrl+R" },
  { label: "Trademark", ch: "™", shortcut: "Alt+Ctrl+T" },
  { label: "Section", ch: "§" },
  { label: "Paragraph", ch: "¶" },
  { label: "Ellipsis", ch: "…", shortcut: "Alt+Ctrl+." },
  { label: "Single opening quote", ch: "‘" },
  { label: "Single closing quote", ch: "’" },
  { label: "Double opening quote", ch: "“" },
  { label: "Double closing quote", ch: "”" },
  { label: "Degree", ch: "°" },
  { label: "Plus-minus", ch: "±" },
];

const RECENT_KEY = "docs.recentSymbols";
function recent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 20) : [];
  } catch {
    return [];
  }
}
function remember(ch: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([ch, ...recent().filter((x) => x !== ch)].slice(0, 20)));
  } catch {
    /* private mode */
  }
}

export function SymbolDialog({ onInsert, onClose }: { onInsert: (ch: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState<"symbols" | "special">("symbols");
  const [subset, setSubset] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recents, setRecents] = useState<string[]>(() => (typeof window === "undefined" ? [] : recent()));
  const chars = useMemo(() => {
    const out: string[] = [];
    for (const [a, b] of SUBSETS[subset].ranges) for (let c = a; c <= b; c++) if (c !== 0xad) out.push(String.fromCodePoint(c));
    return out;
  }, [subset]);
  const insert = (ch: string) => {
    remember(ch);
    setRecents(recent());
    onInsert(ch);
  };
  const fromCode = () => {
    const n = parseInt(code.replace(/^(u\+|0x)/i, ""), 16);
    if (Number.isFinite(n) && n > 0 && n <= 0x10ffff) setSel(String.fromCodePoint(n));
  };
  const cell = (ch: string, key: string) => (
    <button
      key={key}
      data-symbol={ch}
      title={`U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`}
      className={`h-8 w-8 border border-slate-100 text-base ${sel === ch ? "bg-indigo-600 text-white" : "hover:bg-slate-100"}`}
      onClick={() => setSel(ch)}
      onDoubleClick={() => insert(ch)}
    >
      {ch}
    </button>
  );
  return (
    <Modal
      title="Symbol"
      wide
      onClose={onClose}
      footer={
        <>
          <button className={cancel} onClick={onClose}>Close</button>
          <button className={ok} data-testid="symbol-insert" disabled={!sel} onClick={() => sel && insert(sel)}>Insert</button>
        </>
      }
    >
      <div className="flex gap-2 mb-3 text-sm">
        <button className={`px-2 py-1 rounded ${tab === "symbols" ? "bg-slate-200" : ""}`} onClick={() => setTab("symbols")}>Symbols</button>
        <button className={`px-2 py-1 rounded ${tab === "special" ? "bg-slate-200" : ""}`} onClick={() => setTab("special")}>Special characters</button>
      </div>
      {tab === "symbols" ? (
        <div className="space-y-3">
          <div className="flex gap-2 items-end">
            <Field label="Subset">
              <select aria-label="Subset" className={inputCls} value={subset} onChange={(e) => setSubset(Number(e.target.value))}>
                {SUBSETS.map((s, i) => (
                  <option key={s.name} value={i}>{s.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Character code (hex)">
              <input aria-label="Character code" className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} onBlur={fromCode} onKeyDown={(e) => e.key === "Enter" && fromCode()} />
            </Field>
            {sel && <div className="text-3xl w-12 text-center" data-testid="symbol-selected">{sel}</div>}
          </div>
          <div className="flex flex-wrap max-h-64 overflow-y-auto border border-slate-200 rounded">{chars.map((ch) => cell(ch, ch))}</div>
          {recents.length > 0 && (
            <div>
              <div className="text-xs text-slate-500 mb-1">Recently used symbols</div>
              <div className="flex flex-wrap">{recents.map((ch) => cell(ch, `r${ch}`))}</div>
            </div>
          )}
        </div>
      ) : (
        <div className="max-h-80 overflow-y-auto border border-slate-200 rounded">
          {SPECIAL_CHARS.map((s) => (
            <button key={s.label} data-special={s.label} className={`flex w-full text-left px-3 py-1 text-sm ${sel === s.ch ? "bg-indigo-50" : "hover:bg-slate-50"}`} onClick={() => setSel(s.ch)} onDoubleClick={() => insert(s.ch)}>
              <span className="w-8">{s.ch.trim() ? s.ch : "·"}</span>
              <span className="flex-1">{s.label}</span>
              <span className="text-xs text-slate-400">{s.shortcut || ""}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** File › Properties: Word's built-in summary properties and custom ones (what DOCPROPERTY fields show). */
export function PropertiesDialog({
  properties,
  custom,
  onApply,
  onClose,
}: {
  properties: Record<string, string>;
  custom: Record<string, string>;
  onApply: (properties: Record<string, string>, custom: Record<string, string>) => void;
  onClose: () => void;
}) {
  const [props, setProps] = useState<Record<string, string>>({ ...properties });
  const [rows, setRows] = useState<[string, string][]>(() => Object.entries(custom));
  const apply = () => {
    const p = Object.fromEntries(Object.entries(props).filter(([, v]) => v.trim()));
    const c = Object.fromEntries(rows.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v]));
    onApply(p, c);
  };
  return (
    <Modal
      title="Properties"
      onClose={onClose}
      footer={
        <>
          <button className={cancel} onClick={onClose}>Cancel</button>
          <button className={ok} data-testid="properties-ok" onClick={apply}>OK</button>
        </>
      }
    >
      <div className="space-y-2">
        {BUILTIN_PROPERTIES.filter((b) => b.name !== "RevisionNumber" && b.name !== "LastSavedBy").map((b) => (
          <Field key={b.name} label={b.name}>
            <input aria-label={b.name} className={inputCls} value={props[b.name] || ""} onChange={(e) => setProps({ ...props, [b.name]: e.target.value })} />
          </Field>
        ))}
        <div className="pt-2 text-xs font-semibold text-slate-500">Custom</div>
        {rows.map(([k, v], i) => (
          <div key={i} className="flex gap-2">
            <input aria-label={`Custom name ${i + 1}`} className={inputCls} value={k} placeholder="Name" onChange={(e) => setRows(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} />
            <input aria-label={`Custom value ${i + 1}`} className={inputCls} value={v} placeholder="Value" onChange={(e) => setRows(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} />
            <button className={cancel} aria-label={`Remove custom ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button className={cancel} data-testid="properties-add" onClick={() => setRows([...rows, ["", ""]])}>Add custom property</button>
      </div>
    </Modal>
  );
}
