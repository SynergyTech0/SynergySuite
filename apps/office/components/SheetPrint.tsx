"use client";

// File > Page setup… and File > Print… for spreadsheets.
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_MARGINS, PAPER, areaText, colName, parseArea, parseSpan, printSheet, printWorkbook, type HeaderFooter, type PageModel, type PageSetup, type Range } from "@/lib/sheet-print";
import { pagesToHtml } from "@/lib/print-html";
import type { UniverWorkbook } from "@/lib/xlsx";

/* eslint-disable @typescript-eslint/no-explicit-any */

const panel = "bg-white rounded-2xl shadow-xl w-full p-5 max-h-[90vh] overflow-y-auto";
const button = "text-sm rounded-full px-4 py-1.5";
const input = "border border-slate-300 rounded px-2 py-1 text-sm";
const label = "text-xs font-medium text-slate-500 uppercase tracking-wide";

function Modal({ title, wide, onClose, children }: { title: string; wide?: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`${panel} ${wide ? "max-w-4xl" : "max-w-xl"}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <h2 className="text-base font-medium text-slate-800 mb-3">{title}</h2>
        {children}
      </div>
    </div>
  );
}

// ---- Header/footer sections -------------------------------------------------------

/** "&LLeft&CCenter&RRight" -> raw sections (codes like &P kept). */
export function splitSections(code: string | undefined): { left: string; center: string; right: string } {
  const out = { left: "", center: "", right: "" };
  let section: keyof typeof out = "center";
  const s = code || "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "&" && /[LCR]/i.test(s[i + 1] || "")) {
      section = s[i + 1].toUpperCase() === "L" ? "left" : s[i + 1].toUpperCase() === "R" ? "right" : "center";
      i++;
      continue;
    }
    out[section] += s[i];
  }
  return out;
}
export const joinSections = (t: { left: string; center: string; right: string }) =>
  (t.left ? `&L${t.left}` : "") + (t.center ? `&C${t.center}` : "") + (t.right ? `&R${t.right}` : "");

// ---- Page setup ---------------------------------------------------------------------

const MARGIN_PRESETS: Record<string, typeof DEFAULT_MARGINS> = {
  normal: DEFAULT_MARGINS,
  narrow: { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
  wide: { left: 1, right: 1, top: 1, bottom: 1, header: 0.5, footer: 0.5 },
};
const presetOf = (m?: PageSetup["margins"]) => Object.entries(MARGIN_PRESETS).find(([, p]) => JSON.stringify(p) === JSON.stringify({ ...DEFAULT_MARGINS, ...(m || {}) }))?.[0] || "custom";

export function PageSetupDialog({
  initial,
  initialHeaderFooter,
  selection,
  canEdit,
  onSave,
  onClose,
}: {
  initial: PageSetup;
  initialHeaderFooter: HeaderFooter;
  selection: () => Range | null;
  canEdit: boolean;
  onSave: (setup: PageSetup, hf: HeaderFooter) => void;
  onClose: () => void;
}) {
  const [ps, setPs] = useState<PageSetup>(initial);
  const [preset, setPreset] = useState(presetOf(initial.margins));
  const [header, setHeader] = useState(splitSections(initialHeaderFooter.oddHeader));
  const [footer, setFooter] = useState(splitSections(initialHeaderFooter.oddFooter));
  const [error, setError] = useState("");
  const margins = { ...DEFAULT_MARGINS, ...(ps.margins || {}) };
  const set = (patch: Partial<PageSetup>) => setPs((p) => ({ ...p, ...patch }));

  const save = () => {
    if (ps.printArea && ps.printArea.split(",").some((a) => !parseArea(a))) return setError("Print area must look like A1:F40.");
    if (ps.printTitlesRow && !parseSpan(ps.printTitlesRow, "rows")) return setError("Rows to repeat must look like 1:2.");
    if (ps.printTitlesColumn && !parseSpan(ps.printTitlesColumn, "cols")) return setError("Columns to repeat must look like A:B.");
    const out: PageSetup = { ...ps };
    if (!out.fitToPage) {
      delete out.fitToWidth;
      delete out.fitToHeight;
    }
    if (preset === "normal") delete out.margins;
    onSave(out, { oddHeader: joinSections(header), oddFooter: joinSections(footer) });
  };

  const hfRow = (name: string, value: typeof header, change: (v: typeof header) => void) => (
    <div className="grid grid-cols-[70px_1fr_1fr_1fr] gap-2 items-center">
      <span className="text-sm text-slate-600">{name}</span>
      {(["left", "center", "right"] as const).map((k) => (
        <input key={k} aria-label={`${name} ${k}`} placeholder={k} value={value[k]} onChange={(e) => change({ ...value, [k]: e.target.value })} className={input} disabled={!canEdit} />
      ))}
    </div>
  );

  return (
    <Modal title="Page setup" onClose={onClose}>
      <div className="space-y-4 text-sm text-slate-700">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className={label}>Orientation</div>
            {(["portrait", "landscape"] as const).map((o) => (
              <label key={o} className="flex items-center gap-2 capitalize">
                <input type="radio" name="orientation" checked={(ps.orientation || "portrait") === o} onChange={() => set({ orientation: o })} disabled={!canEdit} />
                {o}
              </label>
            ))}
          </div>
          <div className="space-y-1">
            <div className={label}>Paper size</div>
            <select aria-label="Paper size" value={ps.paperSize || 1} onChange={(e) => set({ paperSize: Number(e.target.value) })} className={input} disabled={!canEdit}>
              {Object.entries(PAPER).map(([k, p]) => (
                <option key={k} value={k}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <div className={label}>Scaling</div>
          <label className="flex items-center gap-2">
            <input type="radio" name="scaling" checked={!ps.fitToPage} onChange={() => set({ fitToPage: false })} disabled={!canEdit} />
            Adjust to
            <input aria-label="Scale percent" type="number" min={10} max={400} value={ps.scale || 100} onChange={(e) => set({ scale: Number(e.target.value) || 100 })} className={`${input} w-20`} disabled={!canEdit || !!ps.fitToPage} />% of normal size
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="scaling" checked={!!ps.fitToPage} onChange={() => set({ fitToPage: true, fitToWidth: ps.fitToWidth ?? 1, fitToHeight: ps.fitToHeight ?? 0 })} disabled={!canEdit} />
            Fit to
            <input aria-label="Pages wide" type="number" min={0} value={ps.fitToWidth ?? 1} onChange={(e) => set({ fitToWidth: Math.max(0, Number(e.target.value) || 0) })} className={`${input} w-16`} disabled={!canEdit || !ps.fitToPage} />
            page(s) wide by
            <input aria-label="Pages tall" type="number" min={0} value={ps.fitToHeight ?? 0} onChange={(e) => set({ fitToHeight: Math.max(0, Number(e.target.value) || 0) })} className={`${input} w-16`} disabled={!canEdit || !ps.fitToPage} />
            tall <span className="text-xs text-slate-400">(0 = as many as needed)</span>
          </label>
        </div>

        <div className="space-y-1">
          <div className={label}>Margins (inches)</div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              aria-label="Margins"
              value={preset}
              onChange={(e) => {
                setPreset(e.target.value);
                if (MARGIN_PRESETS[e.target.value]) set({ margins: MARGIN_PRESETS[e.target.value] });
              }}
              className={input}
              disabled={!canEdit}
            >
              <option value="normal">Normal</option>
              <option value="narrow">Narrow</option>
              <option value="wide">Wide</option>
              <option value="custom">Custom</option>
            </select>
            {preset === "custom" &&
              (["top", "bottom", "left", "right", "header", "footer"] as const).map((k) => (
                <label key={k} className="flex items-center gap-1 text-xs capitalize">
                  {k}
                  <input aria-label={`${k} margin`} type="number" step={0.05} min={0} value={margins[k]} onChange={(e) => set({ margins: { ...margins, [k]: Math.max(0, Number(e.target.value) || 0) } })} className={`${input} w-16`} disabled={!canEdit} />
                </label>
              ))}
          </div>
          <div className="flex gap-4 pt-1">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!ps.horizontalCentered} onChange={(e) => set({ horizontalCentered: e.target.checked })} disabled={!canEdit} />
              Center horizontally
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!ps.verticalCentered} onChange={(e) => set({ verticalCentered: e.target.checked })} disabled={!canEdit} />
              Center vertically
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <div className={label}>Sheet</div>
          <div className="grid grid-cols-[150px_1fr_auto] gap-2 items-center">
            <span>Print area</span>
            <input aria-label="Print area" placeholder="Whole sheet" value={ps.printArea || ""} onChange={(e) => set({ printArea: e.target.value.toUpperCase() || undefined })} className={input} disabled={!canEdit} />
            <button type="button" className="text-xs text-indigo-600 hover:underline disabled:opacity-40" disabled={!canEdit} onClick={() => { const g = selection(); if (g) set({ printArea: areaText(g) }); }}>
              Use selection
            </button>
            <span>Rows to repeat at top</span>
            <input aria-label="Rows to repeat" placeholder="e.g. 1:1" value={ps.printTitlesRow || ""} onChange={(e) => set({ printTitlesRow: e.target.value || undefined })} className={input} disabled={!canEdit} />
            <button type="button" className="text-xs text-indigo-600 hover:underline disabled:opacity-40" disabled={!canEdit} onClick={() => { const g = selection(); if (g) set({ printTitlesRow: `${g.startRow + 1}:${g.endRow + 1}` }); }}>
              Use selection
            </button>
            <span>Columns to repeat at left</span>
            <input aria-label="Columns to repeat" placeholder="e.g. A:A" value={ps.printTitlesColumn || ""} onChange={(e) => set({ printTitlesColumn: e.target.value.toUpperCase() || undefined })} className={input} disabled={!canEdit} />
            <button type="button" className="text-xs text-indigo-600 hover:underline disabled:opacity-40" disabled={!canEdit} onClick={() => { const g = selection(); if (g) set({ printTitlesColumn: `${colName(g.startColumn)}:${colName(g.endColumn)}` }); }}>
              Use selection
            </button>
          </div>
          <div className="flex gap-4 flex-wrap">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!ps.showGridLines} onChange={(e) => set({ showGridLines: e.target.checked })} disabled={!canEdit} />
              Gridlines
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!ps.showRowColHeaders} onChange={(e) => set({ showRowColHeaders: e.target.checked })} disabled={!canEdit} />
              Row and column headings
            </label>
            <label className="flex items-center gap-2">
              Page order
              <select aria-label="Page order" value={ps.pageOrder || "downThenOver"} onChange={(e) => set({ pageOrder: e.target.value as PageSetup["pageOrder"] })} className={input} disabled={!canEdit}>
                <option value="downThenOver">Down, then over</option>
                <option value="overThenDown">Over, then down</option>
              </select>
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <div className={label}>Header and footer</div>
          {hfRow("Header", header, setHeader)}
          {hfRow("Footer", footer, setFooter)}
          <p className="text-xs text-slate-400">&amp;P page number, &amp;N number of pages, &amp;D date, &amp;T time, &amp;A sheet name, &amp;F file name</p>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className={`${button} hover:bg-slate-100 text-slate-700`} onClick={onClose}>
            Cancel
          </button>
          <button className={`${button} bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40`} disabled={!canEdit} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---- Print / PDF ------------------------------------------------------------------

export type PrintWhat = "sheet" | "selection" | "workbook";

export function buildPages(book: UniverWorkbook, sheetId: string, what: PrintWhat, selection: Range | null, title: string): PageModel[] {
  if (what === "workbook") return printWorkbook(book, { file: title });
  return printSheet(book, sheetId, { file: title, ...(what === "selection" && selection ? { area: selection } : {}) });
}

/** Prints pages through a hidden frame, so only the pages reach the printer. */
export function printPages(pages: PageModel[], title: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(pagesToHtml(pages, title));
  doc.close();
  const go = () => {
    const win = frame.contentWindow!;
    win.focus();
    win.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  // Pictures must load before the print snapshot.
  const imgs = [...doc.images].filter((i) => !i.complete);
  if (!imgs.length) setTimeout(go, 50);
  else Promise.all(imgs.map((i) => new Promise((r) => { i.onload = i.onerror = r; }))).then(go);
}

export function PrintDialog({
  book,
  sheetId,
  selection,
  title,
  onPdf,
  onPageSetup,
  onClose,
}: {
  book: UniverWorkbook;
  sheetId: string;
  selection: Range | null;
  title: string;
  onPdf: (pages: PageModel[]) => Promise<void>;
  onPageSetup: () => void;
  onClose: () => void;
}) {
  const [what, setWhat] = useState<PrintWhat>("sheet");
  const [busy, setBusy] = useState(false);
  const pages = useMemo(() => buildPages(book, sheetId, what, selection, title), [book, sheetId, what, selection, title]);
  const html = useMemo(
    () =>
      pagesToHtml(pages.slice(0, 20), title).replace(
        "</style>",
        "@media screen{body{background:#e2e8f0;padding:16px}.sheet-page{margin:0 auto 16px;box-shadow:0 1px 4px rgba(15,23,42,.25);zoom:.62}}</style>",
      ),
    [pages, title],
  );
  const sheetName = book.sheets[sheetId]?.name || "";
  const setup = book.sheets[sheetId]?.custom?.xlsx?.pageSetup as PageSetup | undefined;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <Modal title="Print" wide onClose={onClose}>
      <div className="grid grid-cols-[1fr_230px] gap-4">
        <iframe title="Print preview" srcDoc={html} className="w-full h-[62vh] rounded-lg border border-slate-200 bg-slate-200" />
        <div className="space-y-4 text-sm text-slate-700">
          <div className="space-y-1">
            <div className={label}>Print</div>
            <label className="flex items-center gap-2">
              <input type="radio" name="what" checked={what === "sheet"} onChange={() => setWhat("sheet")} />
              Current sheet ({sheetName})
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="what" checked={what === "selection"} disabled={!selection} onChange={() => setWhat("selection")} />
              Selection{selection ? ` (${areaText(selection)})` : ""}
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="what" checked={what === "workbook"} onChange={() => setWhat("workbook")} />
              Whole workbook
            </label>
          </div>
          <p className="text-slate-500" aria-live="polite">
            {pages.length ? `${pages.length} page${pages.length === 1 ? "" : "s"}` : "Nothing to print"}
            {setup?.printArea && what === "sheet" ? ` · print area ${setup.printArea}` : ""}
          </p>
          <button type="button" className="text-indigo-600 hover:underline text-sm" onClick={onPageSetup}>
            Page setup…
          </button>
          <div className="flex flex-col gap-2 pt-2">
            <button className={`${button} bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40`} disabled={!pages.length} onClick={() => printPages(pages, title)}>
              Print
            </button>
            <button
              className={`${button} border border-slate-300 hover:bg-slate-50 text-slate-700 disabled:opacity-40`}
              disabled={!pages.length || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onPdf(pages);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Making PDF…" : "Download PDF"}
            </button>
            <button className={`${button} hover:bg-slate-100 text-slate-700`} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
