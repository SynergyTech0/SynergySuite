"use client";

// Deck-level dialogs and panels: Design > Customize theme, Insert > Header &
// footer, and the Slide Master view's properties panel.
import { useState, type ReactNode } from "react";
import { BODY_LEVELS, DATE_FORMATS, MASTER_KEYS, formatDate, isMasterKey, levelLook, mergeLevels, type BodyStyle, type LevelLook, type HeaderFooter, type MasterKey, type Slide, type TitleStyle } from "@/lib/slides/model";
import { themeById, type ThemeColors } from "@/lib/slides/themes";

export const FONT_CHOICES = ["Calibri", "Arial", "Helvetica", "Verdana", "Tahoma", "Trebuchet MS", "Segoe UI", "Inter", "Georgia", "Times New Roman", "Garamond", "Courier New", "Consolas"];

export function Modal({ title, testId, onClose, children, wide }: { title: string; testId: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/30 no-print" onPointerDown={onClose} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onClose(); }}>
      <div className={`${wide ? "w-[40rem]" : "w-[26rem]"} max-w-[calc(100vw-32px)] max-h-[calc(100vh-32px)] overflow-y-auto rounded-xl bg-white p-5 shadow-xl text-sm space-y-4`} data-testid={testId} onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex items-center">
          <h2 className="font-semibold text-slate-800">{title}</h2>
          <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700" aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const hex = (v: string) => v.replace(/^#/, "").toUpperCase();

function ColorRow({ label, value, onChange, testId }: { label: string; value: string; onChange: (v: string) => void; testId: string }) {
  return (
    <label className="flex items-center gap-3">
      <span className="w-28 text-slate-600">{label}</span>
      <input type="color" data-testid={testId} value={`#${value}`} onChange={(e) => onChange(hex(e.target.value))} className="h-8 w-12 rounded border border-slate-300" />
      <span className="font-mono text-xs text-slate-500">#{value}</span>
    </label>
  );
}

function FontInput({ value, onChange, testId, placeholder }: { value: string; onChange: (v: string) => void; testId: string; placeholder: string }) {
  return (
    <>
      <input list="deck-fonts" data-testid={testId} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="flex-1 min-w-0 h-8 rounded border border-slate-300 px-2" />
      <datalist id="deck-fonts">{FONT_CHOICES.map((f) => <option key={f} value={f} />)}</datalist>
    </>
  );
}

/** Theme colours and fonts for the whole deck (PowerPoint's Design > Variants > Colors / Fonts). */
export function ThemeDialog({ themeId, colors, font, headFont, onApply, onClose }: {
  themeId: string;
  colors?: ThemeColors;
  font: string;
  headFont: string;
  onApply: (v: { colors?: ThemeColors; font: string; headFont: string }) => void;
  onClose: () => void;
}) {
  const base = themeById(themeId);
  const [c, setC] = useState({ bg: base.bg, title: base.title, text: base.text, accent: base.accent, bar: base.bar, ...colors });
  const [f, setF] = useState(font);
  const [hf, setHf] = useState(headFont);
  const changed = (): ThemeColors | undefined => {
    const out: ThemeColors = {};
    for (const k of ["bg", "title", "text", "accent"] as const) if (c[k] !== base[k]) out[k] = c[k];
    if (c.bar !== base.bar) out.bar = c.bar;
    return Object.keys(out).length ? out : undefined;
  };
  return (
    <Modal title={`Customize theme — ${base.name}`} testId="theme-dialog" onClose={onClose}>
      <div className="space-y-2 min-w-0">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Colours</div>
        <ColorRow label="Background" value={c.bg} onChange={(v) => setC({ ...c, bg: v })} testId="theme-bg" />
        <ColorRow label="Titles" value={c.title} onChange={(v) => setC({ ...c, title: v })} testId="theme-title" />
        <ColorRow label="Text" value={c.text} onChange={(v) => setC({ ...c, text: v })} testId="theme-text" />
        <ColorRow label="Accent" value={c.accent} onChange={(v) => setC({ ...c, accent: v })} testId="theme-accent" />
        <label className="flex items-center gap-2 text-slate-600">
          <input type="checkbox" data-testid="theme-bar" checked={c.bar} onChange={(e) => setC({ ...c, bar: e.target.checked })} /> Accent bar across the top
        </label>
      </div>
      <div className="space-y-2 min-w-0">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fonts</div>
        <label className="flex items-center gap-3"><span className="w-28 text-slate-600">Headings</span><FontInput testId="theme-head-font" value={hf} onChange={setHf} placeholder="Same as body" /></label>
        <label className="flex items-center gap-3"><span className="w-28 text-slate-600">Body</span><FontInput testId="theme-body-font" value={f} onChange={setF} placeholder={base.font.split(",")[0].replace(/'/g, "")} /></label>
      </div>
      <div className="flex gap-2 pt-1">
        <button className="rounded px-3 py-1.5 hover:bg-slate-100" onClick={() => { setC({ bg: base.bg, title: base.title, text: base.text, accent: base.accent, bar: base.bar }); setF(""); setHf(""); }}>Reset</button>
        <button className="ml-auto rounded px-3 py-1.5 hover:bg-slate-100" onClick={onClose}>Cancel</button>
        <button data-testid="theme-apply" className="rounded bg-indigo-600 px-4 py-1.5 text-white hover:bg-indigo-700" onClick={() => { onApply({ colors: changed(), font: f.trim(), headFont: hf.trim() }); onClose(); }}>Apply</button>
      </div>
    </Modal>
  );
}

const today = () => new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

/** Insert > Header & footer: date, slide number and footer text on every slide. */
export function HeaderFooterDialog({ value, onApply, onClose }: { value?: HeaderFooter; onApply: (v: HeaderFooter | null) => void; onClose: () => void }) {
  const [num, setNum] = useState(!!value?.num);
  const [useDate, setUseDate] = useState(!!value?.date || !!value?.dateAuto);
  const [date, setDate] = useState(value?.date || today());
  const [auto, setAuto] = useState(value?.dateAuto || "");
  const [fmt, setFmt] = useState(value?.dateAuto || "datetime4");
  const [useFooter, setUseFooter] = useState(!!value?.footer);
  const [footer, setFooter] = useState(value?.footer || "");
  const [skip, setSkip] = useState(!!value?.skipTitle);
  const apply = () => {
    const dateV = !useDate ? {} : auto ? { dateAuto: fmt } : date.trim() ? { date: date.trim() } : {};
    const v: HeaderFooter = { ...(num ? { num } : {}), ...dateV, ...(useFooter && footer.trim() ? { footer: footer.trim() } : {}), ...(skip ? { skipTitle: true } : {}), ...(value?.boxes ? { boxes: value.boxes } : {}) };
    onApply(v.num || v.date || v.dateAuto || v.footer || v.boxes ? v : null);
    onClose();
  };
  return (
    <Modal title="Header & footer" testId="hf-dialog" onClose={onClose}>
      <div className="space-y-3">
        <label className="flex items-center gap-2"><input type="checkbox" data-testid="hf-date" checked={useDate} onChange={(e) => setUseDate(e.target.checked)} /> Date</label>
        {useDate && (
          <div className="ml-6 space-y-1.5 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="hf-date-kind" data-testid="hf-date-auto" checked={!!auto} onChange={() => setAuto(fmt)} /> Update automatically</label>
            {!!auto && (
              <select data-testid="hf-date-format" value={fmt} onChange={(e) => { setFmt(e.target.value); setAuto(e.target.value); }} className="ml-6 w-[calc(100%-1.5rem)] h-8 rounded border border-slate-300 px-1">
                {DATE_FORMATS.map((f) => <option key={f.id} value={f.id}>{formatDate(f.id)}</option>)}
              </select>
            )}
            <label className="flex items-center gap-2"><input type="radio" name="hf-date-kind" data-testid="hf-date-fixed" checked={!auto} onChange={() => setAuto("")} /> Fixed</label>
            {!auto && <input data-testid="hf-date-text" value={date} onChange={(e) => setDate(e.target.value)} className="ml-6 w-[calc(100%-1.5rem)] h-8 rounded border border-slate-300 px-2" />}
          </div>
        )}
        <label className="flex items-center gap-2"><input type="checkbox" data-testid="hf-num" checked={num} onChange={(e) => setNum(e.target.checked)} /> Slide number</label>
        <label className="flex items-center gap-2"><input type="checkbox" data-testid="hf-footer" checked={useFooter} onChange={(e) => setUseFooter(e.target.checked)} /> Footer</label>
        {useFooter && <input data-testid="hf-footer-text" value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="Footer text" className="ml-6 w-[calc(100%-1.5rem)] h-8 rounded border border-slate-300 px-2" />}
        <label className="flex items-center gap-2"><input type="checkbox" data-testid="hf-skip-title" checked={skip} onChange={(e) => setSkip(e.target.checked)} /> Don’t show on title slides</label>
      </div>
      <div className="flex gap-2 pt-1">
        <button className="ml-auto rounded px-3 py-1.5 hover:bg-slate-100" onClick={onClose}>Cancel</button>
        <button data-testid="hf-apply" className="rounded bg-indigo-600 px-4 py-1.5 text-white hover:bg-indigo-700" onClick={apply}>Apply to all</button>
      </div>
    </Modal>
  );
}

/** Properties of the master or layout being edited in Slide Master view. */
export function MasterPanel({ masterKey, slide, canEdit, onTitleStyle, onBodyStyle, onBg, onReset, onClose }: {
  masterKey: MasterKey;
  slide: Slide;
  canEdit: boolean;
  onTitleStyle: (patch: Partial<TitleStyle>) => void;
  onBodyStyle: (patch: Partial<BodyStyle>) => void;
  onBg: (hex: string | null) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const label = MASTER_KEYS.find((k) => k.id === masterKey)?.label || slide.lname || masterKey;
  const ts = slide.tstyle || {};
  const bs = slide.bstyle || {};
  const [lvl, setLvl] = useState(1);
  // level 1 is the body style itself; deeper levels are kept in bs.lv
  const cur: LevelLook = lvl === 1 ? { size: bs.size, color: bs.color, font: bs.font } : bs.lv?.[lvl - 2] || {};
  const above = levelLook(bs, lvl - 1);
  const setBody = (patch: LevelLook) => {
    if (lvl === 1) return onBodyStyle(patch);
    const lv = [...(bs.lv || [])];
    while (lv.length < lvl - 1) lv.push(null);
    const next = Object.fromEntries(Object.entries({ ...(lv[lvl - 2] || {}), ...patch }).filter(([, x]) => x !== undefined && x !== "")) as LevelLook;
    lv[lvl - 2] = Object.keys(next).length ? next : null;
    onBodyStyle({ lv: mergeLevels({ lv }) });
  };
  const num = (v: string) => (v.trim() === "" ? undefined : Math.max(6, Math.min(200, Number(v) || 0)) || undefined);
  const row = "flex items-center gap-2";
  return (
    <aside className="w-64 shrink-0 border-l border-slate-200 bg-white p-3 text-sm space-y-4 overflow-y-auto no-print" data-testid="master-panel">
      <div className="flex items-center">
        <span className="font-semibold text-slate-800">{label}</span>
        <button className="ml-auto text-xs rounded bg-indigo-600 px-2 py-1 text-white hover:bg-indigo-700" data-testid="master-close" onClick={onClose}>Close master view</button>
      </div>
      <p className="text-xs text-slate-500">
        {masterKey === "master" ? "Changes here apply to every layout and slide that follow this master." : isMasterKey(masterKey) ? "Changes here apply to this master's layouts and their slides." : "Changes here apply to slides using this layout."} Drag the placeholders to move them; insert pictures, shapes and text boxes to show them on every slide.
      </p>
      <fieldset disabled={!canEdit} className="space-y-2 min-w-0">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Title style</div>
        <label className={row}>Size (pt)<input type="number" data-testid="master-title-size" className="ml-auto w-20 h-7 rounded border border-slate-300 px-1" defaultValue={ts.size ?? ""} key={`ts-${masterKey}-${ts.size}`} onBlur={(e) => onTitleStyle({ size: num(e.target.value) })} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} /></label>
        <label className={row}>Colour<input type="color" data-testid="master-title-color" className="ml-auto h-7 w-12 rounded border border-slate-300" value={`#${ts.color || "000000"}`} onChange={(e) => onTitleStyle({ color: hex(e.target.value) })} /></label>
        <label className={row}><input type="checkbox" data-testid="master-title-bold" checked={ts.bold !== false} onChange={(e) => onTitleStyle({ bold: e.target.checked ? undefined : false })} /> Bold</label>
        <label className={row}>Font<FontInput testId="master-title-font" value={ts.font || ""} onChange={(v) => onTitleStyle({ font: v.trim() || undefined })} placeholder="Theme heading font" /></label>
      </fieldset>
      {slide.layout !== "titleOnly" && slide.layout !== "blank" && (
        <fieldset disabled={!canEdit} className="space-y-2 min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Body text style</div>
          <label className={row}>Level<select data-testid="master-body-level" className="ml-auto h-7 rounded border border-slate-300 px-1" value={lvl} onChange={(e) => setLvl(Number(e.target.value))}>
            {Array.from({ length: BODY_LEVELS }, (_, k) => <option key={k} value={k + 1}>{k === 0 ? "First level" : `Level ${k + 1}`}</option>)}
          </select></label>
          <label className={row}>Size (pt)<input type="number" data-testid="master-body-size" className="ml-auto w-20 h-7 rounded border border-slate-300 px-1" defaultValue={cur.size ?? ""} placeholder={lvl > 1 ? String(above.size ?? bs.size ?? "") : undefined} key={`bs-${masterKey}-${lvl}-${cur.size}`} onBlur={(e) => setBody({ size: num(e.target.value) })} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} /></label>
          <label className={row}>Colour<input type="color" data-testid="master-body-color" className="ml-auto h-7 w-12 rounded border border-slate-300" value={`#${cur.color || above.color || bs.color || "000000"}`} onChange={(e) => setBody({ color: hex(e.target.value) })} /></label>
          <label className={row}>Font<FontInput testId="master-body-font" value={cur.font || ""} onChange={(v) => setBody({ font: v.trim() || undefined })} placeholder={lvl > 1 ? "As the level above" : "Theme body font"} /></label>
          {lvl > 1 && Object.keys(cur).length > 0 && <button type="button" className="text-xs text-indigo-600 hover:underline" data-testid="master-level-clear" onClick={() => setBody({ size: undefined, color: undefined, font: undefined })}>Same as the level above</button>}
        </fieldset>
      )}
      <fieldset disabled={!canEdit} className="space-y-2 min-w-0">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Background</div>
        <label className={row}>Colour<input type="color" data-testid="master-bg" className="ml-auto h-7 w-12 rounded border border-slate-300" value={`#${slide.bg || "FFFFFF"}`} onChange={(e) => onBg(hex(e.target.value))} /></label>
        {slide.bg && <button className="text-xs text-indigo-600 hover:underline" onClick={() => onBg(null)}>{isMasterKey(masterKey) ? "Use the theme background" : "Use the master background"}</button>}
      </fieldset>
      {!isMasterKey(masterKey) && canEdit && (
        <button className="text-xs text-slate-600 hover:text-red-600" data-testid="master-reset" onClick={onReset}>Reset this layout to the master</button>
      )}
    </aside>
  );
}

const PAPER: { id: string; label: string; w: number; h: number }[] = [
  { id: "16:9", label: "Widescreen (13.33 × 7.5 in)", w: 13.333, h: 7.5 },
  { id: "4:3", label: "Standard 4:3 (10 × 7.5 in)", w: 10, h: 7.5 },
  { id: "16:10", label: "16:10 (12 × 7.5 in)", w: 12, h: 7.5 },
  { id: "A4", label: "A4 paper (10.83 × 7.5 in)", w: 10.833, h: 7.5 },
  { id: "letter", label: "Letter paper (10 × 7.5 in)", w: 10, h: 7.5 },
  { id: "banner", label: "Banner (8 × 1 in)", w: 8, h: 1 },
  { id: "a4p", label: "A4 portrait (7.5 × 10.83 in)", w: 7.5, h: 10.833 },
];

export type ResizeMode = "scale" | "fit" | "none";

/** Design > Slide size > Custom slide size: width/height in inches and how to adapt existing content. */
export function SlideSizeDialog({ w, h, onApply, onClose }: { w: number; h: number; onApply: (w: number, h: number, mode: ResizeMode) => void; onClose: () => void }) {
  const inch = (px: number) => String(Math.round((px / 96) * 100) / 100);
  const [wi, setWi] = useState(inch(w));
  const [hi, setHi] = useState(inch(h));
  const [mode, setMode] = useState<ResizeMode>("fit");
  const pw = Math.round(Number(wi) * 96), ph = Math.round(Number(hi) * 96);
  const ok = pw >= 96 && ph >= 96 && pw <= 5376 && ph <= 5376; // 1 to 56 inches, PowerPoint's limits
  return (
    <Modal title="Slide size" testId="size-dialog" onClose={onClose}>
      <select className="w-full h-8 rounded border border-slate-300 px-2" data-testid="size-preset" value={PAPER.find((p) => inch(p.w * 96) === wi && inch(p.h * 96) === hi)?.id || ""} onChange={(e) => { const p = PAPER.find((x) => x.id === e.target.value); if (p) { setWi(inch(p.w * 96)); setHi(inch(p.h * 96)); } }}>
        <option value="">Custom</option>
        {PAPER.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <div className="flex gap-3">
        <label className="flex-1">Width (in)<input type="number" min={1} max={56} step={0.01} data-testid="size-w" className="mt-1 w-full h-8 rounded border border-slate-300 px-2" value={wi} onChange={(e) => setWi(e.target.value)} /></label>
        <label className="flex-1">Height (in)<input type="number" min={1} max={56} step={0.01} data-testid="size-h" className="mt-1 w-full h-8 rounded border border-slate-300 px-2" value={hi} onChange={(e) => setHi(e.target.value)} /></label>
        <button type="button" title="Swap orientation" className="self-end h-8 px-2 rounded border border-slate-300 hover:bg-slate-50" data-testid="size-swap" onClick={() => { setWi(hi); setHi(wi); }}>⇄</button>
      </div>
      <div className="space-y-1 text-slate-700">
        <label className="flex items-center gap-2"><input type="radio" name="size-mode" data-testid="size-fit" checked={mode === "fit"} onChange={() => setMode("fit")} />Ensure fit (scale content evenly and centre it)</label>
        <label className="flex items-center gap-2"><input type="radio" name="size-mode" data-testid="size-scale" checked={mode === "scale"} onChange={() => setMode("scale")} />Stretch content to the new size</label>
        <label className="flex items-center gap-2"><input type="radio" name="size-mode" data-testid="size-none" checked={mode === "none"} onChange={() => setMode("none")} />Don&apos;t scale content</label>
      </div>
      {!ok && <div className="text-xs text-red-600">Width and height must be between 1 and 56 inches.</div>}
      <div className="flex justify-end gap-2">
        <button type="button" className="rounded px-3 py-1.5 hover:bg-slate-100" onClick={onClose}>Cancel</button>
        <button type="button" disabled={!ok} className="rounded bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-700 disabled:opacity-40" data-testid="size-apply" onClick={() => { onApply(pw, ph, mode); onClose(); }}>Apply</button>
      </div>
    </Modal>
  );
}
