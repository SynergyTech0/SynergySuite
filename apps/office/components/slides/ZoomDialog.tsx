"use client";

// Insert > Zoom: summary, section and slide zooms.
import { useState } from "react";
import { sectionsOf, type Slide } from "@/lib/slides/model";
import { Modal } from "./DeckDialogs";
import { ScaledSlide, type DeckLook } from "./SlideView";

export type ZoomMode = "summary" | "section" | "slide";

const TITLES: Record<ZoomMode, string> = {
  summary: "Insert summary zoom",
  section: "Insert section zoom",
  slide: "Insert slide zoom",
};
const HELP: Record<ZoomMode, string> = {
  summary: "Pick the slides that start each part of your talk. Each becomes a section, and a summary slide with a zoom to every section is added in front of them.",
  section: "Pick the sections to zoom to. In the slide show a click presents the section and comes back here.",
  slide: "Pick the slides to zoom to. In the slide show a click zooms into the slide.",
};

/** `view`: the slides as drawn (masters applied); `onInsert` gets slide ids (for sections, the slide each starts with). */
export function ZoomDialog({ mode, view, look, current, onInsert, onClose }: { mode: ZoomMode; view: Slide[]; look: DeckLook; current: number; onInsert: (ids: string[]) => void; onClose: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const sections = sectionsOf(view);
  const items =
    mode === "section"
      ? sections.map((s) => ({ id: view[s.start].id, slide: view[s.start], label: `${s.name} (${s.end - s.start} slide${s.end - s.start === 1 ? "" : "s"})` }))
      : view.map((s, i) => ({ id: s.id, slide: s, label: `${i + 1}. ${s.title.split("\n")[0] || "Untitled"}` })).filter((_, i) => mode === "summary" || i !== current);
  return (
    <Modal title={TITLES[mode]} testId="zoom-dialog" onClose={onClose} wide>
      <p className="text-slate-600">{HELP[mode]}</p>
      {!items.length ? (
        <p className="text-slate-500" data-testid="zoom-empty">{mode === "section" ? "This presentation has no sections yet. Add sections from the slide list, or insert a summary zoom." : "There are no other slides."}</p>
      ) : (
        <div className="grid grid-cols-3 gap-3 max-h-[50vh] overflow-y-auto p-1">
          {items.map((it) => (
            <label key={it.id} data-testid="zoom-pick" data-id={it.id} className={`block cursor-pointer rounded border p-1 ${picked.includes(it.id) ? "border-indigo-500 ring-2 ring-indigo-200" : "border-slate-200 hover:border-slate-300"}`}>
              <ScaledSlide slide={it.slide} look={look} width={170} />
              <span className="mt-1 flex items-center gap-1.5 text-xs text-slate-700">
                <input type="checkbox" checked={picked.includes(it.id)} onChange={() => toggle(it.id)} />
                <span className="truncate">{it.label}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="rounded px-3 py-1.5 hover:bg-slate-100" onClick={onClose}>Cancel</button>
        <button type="button" data-testid="zoom-insert" className="rounded bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-700 disabled:opacity-40" disabled={!picked.length} onClick={() => { onInsert(picked); onClose(); }}>Insert</button>
      </div>
    </Modal>
  );
}
