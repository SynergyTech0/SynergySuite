"use client";

// Set Up Slide Show (loop, timings, which slides) and Custom Shows.
import { useState } from "react";
import type { Slide } from "@/lib/slides/model";
import type { CustomShow, ShowSettings } from "@/lib/slides/show";
import { Modal } from "./DeckDialogs";

const btn = "rounded px-3 py-1.5 hover:bg-slate-100";
const primary = "rounded bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-700 disabled:opacity-40";
const titleOf = (s: Slide, i: number) => `${i + 1}. ${s.title.trim() || "Untitled slide"}`;

export function SetUpShowDialog({ value, shows, onApply, onClose }: { value: ShowSettings; shows: CustomShow[]; onApply: (v: ShowSettings) => void; onClose: () => void }) {
  const [loop, setLoop] = useState(!!value.loop);
  const [timings, setTimings] = useState(value.useTimings !== false);
  const [show, setShow] = useState(value.show && shows.some((x) => x.id === value.show) ? value.show : "");
  return (
    <Modal title="Set up slide show" testId="setup-dialog" onClose={onClose}>
      <fieldset className="space-y-1 text-slate-700">
        <legend className="text-xs uppercase tracking-wide text-slate-400 mb-1">Show slides</legend>
        <label className="flex items-center gap-2"><input type="radio" name="show-which" checked={!show} onChange={() => setShow("")} />All</label>
        <label className="flex items-center gap-2">
          <input type="radio" name="show-which" checked={!!show} disabled={!shows.length} onChange={() => setShow(shows[0]?.id || "")} />Custom show
          <select className="h-8 rounded border border-slate-300 px-1" data-testid="setup-custom" disabled={!shows.length} value={show} onChange={(e) => setShow(e.target.value)}>
            {!show && <option value="">{shows.length ? "Choose…" : "No custom shows"}</option>}
            {shows.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
      </fieldset>
      <fieldset className="space-y-1 text-slate-700">
        <legend className="text-xs uppercase tracking-wide text-slate-400 mb-1">Options</legend>
        <label className="flex items-center gap-2"><input type="checkbox" data-testid="setup-loop" checked={loop} onChange={(e) => setLoop(e.target.checked)} />Loop continuously until Esc</label>
      </fieldset>
      <fieldset className="space-y-1 text-slate-700">
        <legend className="text-xs uppercase tracking-wide text-slate-400 mb-1">Advance slides</legend>
        <label className="flex items-center gap-2"><input type="radio" name="show-adv" data-testid="setup-manual" checked={!timings} onChange={() => setTimings(false)} />Manually</label>
        <label className="flex items-center gap-2"><input type="radio" name="show-adv" data-testid="setup-timings" checked={timings} onChange={() => setTimings(true)} />Using timings, if present</label>
      </fieldset>
      <div className="flex justify-end gap-2">
        <button type="button" className={btn} onClick={onClose}>Cancel</button>
        <button type="button" className={primary} data-testid="setup-apply" onClick={() => { onApply({ ...(loop ? { loop: true } : {}), ...(timings ? {} : { useTimings: false }), ...(show ? { show } : {}) }); onClose(); }}>OK</button>
      </div>
    </Modal>
  );
}

/** Create, edit, delete and start custom shows. */
export function CustomShowsDialog({ slides, shows, onSave, onStart, onClose, newId }: { slides: Slide[]; shows: CustomShow[]; onSave: (v: CustomShow[]) => void; onStart: (id: string) => void; onClose: () => void; newId: () => string }) {
  const [list, setList] = useState<CustomShow[]>(shows);
  const [edit, setEdit] = useState<CustomShow | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [at, setAt] = useState(-1);
  const save = (next: CustomShow[]) => {
    setList(next);
    onSave(next);
  };
  if (edit) {
    const inShow = edit.slides.filter((id) => slides.some((s) => s.id === id));
    const move = (d: -1 | 1) => {
      if (at < 0 || at + d < 0 || at + d >= inShow.length) return;
      const n = [...inShow];
      [n[at], n[at + d]] = [n[at + d], n[at]];
      setEdit({ ...edit, slides: n });
      setAt(at + d);
    };
    return (
      <Modal title="Define custom show" testId="custom-show-edit" onClose={() => setEdit(null)} wide>
        <label className="flex items-center gap-2 text-slate-600">Name<input autoFocus data-testid="custom-show-name" className="flex-1 h-8 rounded border border-slate-300 px-2" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
        <div className="flex gap-3 items-stretch">
          <div className="flex-1 min-w-0">
            <div className="text-xs text-slate-500 mb-1">Slides in presentation</div>
            <div className="h-56 overflow-y-auto rounded border border-slate-200 p-1" data-testid="custom-show-all">
              {slides.map((s, i) => (
                <label key={s.id} className="flex items-center gap-2 px-1 py-0.5 hover:bg-slate-50 truncate">
                  <input type="checkbox" checked={pick.has(s.id)} onChange={(e) => setPick((p) => { const n = new Set(p); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n; })} />
                  <span className="truncate">{titleOf(s, i)}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-col justify-center gap-2">
            <button type="button" data-testid="custom-show-add" className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50" disabled={!pick.size} onClick={() => { setEdit({ ...edit, slides: [...inShow, ...slides.filter((s) => pick.has(s.id)).map((s) => s.id)] }); setPick(new Set()); }}>Add »</button>
            <button type="button" data-testid="custom-show-remove" className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50" disabled={at < 0} onClick={() => { setEdit({ ...edit, slides: inShow.filter((_, k) => k !== at) }); setAt(-1); }}>« Remove</button>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-slate-500 mb-1">Slides in custom show</div>
            <div className="h-56 overflow-y-auto rounded border border-slate-200 p-1" data-testid="custom-show-list">
              {inShow.map((id, k) => {
                const i = slides.findIndex((s) => s.id === id);
                return (
                  <button key={`${id}-${k}`} type="button" className={`block w-full text-left px-1 py-0.5 truncate rounded ${k === at ? "bg-indigo-100 text-indigo-800" : "hover:bg-slate-50"}`} onClick={() => setAt(k)}>
                    {k + 1}. {slides[i]?.title.trim() || "Untitled slide"} <span className="text-slate-400">(slide {i + 1})</span>
                  </button>
                );
              })}
              {!inShow.length && <div className="text-slate-400 text-xs p-2">Tick slides on the left and choose Add.</div>}
            </div>
          </div>
          <div className="flex flex-col justify-center gap-2">
            <button type="button" title="Move up" className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50" onClick={() => move(-1)}>↑</button>
            <button type="button" title="Move down" className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50" onClick={() => move(1)}>↓</button>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={btn} onClick={() => setEdit(null)}>Cancel</button>
          <button type="button" className={primary} data-testid="custom-show-ok" disabled={!edit.name.trim() || !inShow.length} onClick={() => {
            const v = { ...edit, name: edit.name.trim(), slides: inShow };
            save(list.some((x) => x.id === v.id) ? list.map((x) => (x.id === v.id ? v : x)) : [...list, v]);
            setEdit(null);
          }}>OK</button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title="Custom shows" testId="custom-shows" onClose={onClose}>
      <div className="rounded border border-slate-200 divide-y divide-slate-100" data-testid="custom-show-names">
        {list.map((x) => (
          <div key={x.id} className="flex items-center gap-2 px-2 py-1.5">
            <span className="flex-1 truncate">{x.name} <span className="text-slate-400 text-xs">({x.slides.filter((id) => slides.some((s) => s.id === id)).length} slides)</span></span>
            <button type="button" className="text-xs text-indigo-700 hover:underline" data-testid="custom-show-start" onClick={() => { onClose(); onStart(x.id); }}>Show</button>
            <button type="button" className="text-xs hover:underline" onClick={() => { setEdit(x); setAt(-1); }}>Edit</button>
            <button type="button" className="text-xs hover:underline" onClick={() => save([...list, { ...x, id: newId(), name: `Copy of ${x.name}` }])}>Copy</button>
            <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => save(list.filter((y) => y.id !== x.id))}>Remove</button>
          </div>
        ))}
        {!list.length && <div className="text-slate-400 text-xs p-3">No custom shows yet.</div>}
      </div>
      <div className="flex justify-between gap-2">
        <button type="button" className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-50" data-testid="custom-show-new" onClick={() => { setEdit({ id: newId(), name: `Custom Show ${list.length + 1}`, slides: [] }); setAt(-1); setPick(new Set()); }}>New…</button>
        <button type="button" className={btn} onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
