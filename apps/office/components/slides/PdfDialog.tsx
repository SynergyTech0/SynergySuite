"use client";

// Export as PDF: slides, notes pages or handouts.
import { useState } from "react";
import { HANDOUT_SIZES, type PdfOptions } from "@/lib/slides/pdf-export";
import { Modal } from "./DeckDialogs";

export function PdfDialog({ hasHidden, onExport, onClose }: { hasHidden: boolean; onExport: (o: PdfOptions) => void; onClose: () => void }) {
  const [o, setO] = useState<PdfOptions>({ layout: "slides", perPage: 6, includeHidden: false, frame: true });
  const radio = (v: PdfOptions["layout"], label: string, hint: string) => (
    <label className="flex items-start gap-2">
      <input type="radio" name="pdf-layout" className="mt-1" data-testid={`pdf-layout-${v}`} checked={o.layout === v} onChange={() => setO({ ...o, layout: v })} />
      <span><span className="text-slate-800">{label}</span><span className="block text-xs text-slate-500">{hint}</span></span>
    </label>
  );
  return (
    <Modal title="Download as PDF" testId="pdf-dialog" onClose={onClose}>
      <fieldset className="space-y-2">
        {radio("slides", "Slides", "One slide per page, at the slide's size")}
        {radio("notes", "Notes pages", "Each slide above its speaker notes")}
        {radio("handouts", "Handouts", "Several slides per page")}
      </fieldset>
      {o.layout === "handouts" && (
        <div className="flex items-center gap-3 pl-6">
          <label className="flex items-center gap-2">Slides per page
            <select className="h-8 rounded border border-slate-300 px-1" data-testid="pdf-per-page" value={o.perPage} onChange={(e) => setO({ ...o, perPage: Number(e.target.value) as PdfOptions["perPage"] })}>
              {HANDOUT_SIZES.map((n) => <option key={n} value={n}>{n}{n === 3 ? " (with lines)" : ""}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2"><input type="checkbox" data-testid="pdf-frame" checked={o.frame !== false} onChange={(e) => setO({ ...o, frame: e.target.checked })} />Frame slides</label>
        </div>
      )}
      {hasHidden && <label className="flex items-center gap-2"><input type="checkbox" data-testid="pdf-hidden" checked={!!o.includeHidden} onChange={(e) => setO({ ...o, includeHidden: e.target.checked })} />Include hidden slides</label>}
      <div className="flex justify-end gap-2">
        <button type="button" className="rounded px-3 py-1.5 hover:bg-slate-100" onClick={onClose}>Cancel</button>
        <button type="button" className="rounded bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-700" data-testid="pdf-export" onClick={() => { onClose(); onExport(o); }}>Download</button>
      </div>
    </Modal>
  );
}
