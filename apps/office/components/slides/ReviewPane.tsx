"use client";

// Review pane: Check Accessibility (alt text, slide titles, contrast, reading
// order, link text, table headers) with quick fixes, and Spelling.
import { useEffect, useMemo, useState } from "react";
import { checkAccessibility, contrast, readingOrderZ, type Issue, type Severity } from "@/lib/slides/a11y";
import { htmlText, type Masters, type Slide, type SlideElement, type TableEl } from "@/lib/slides/model";
import { loadSpeller, spellIssues, type Speller } from "@/lib/slides/spell";
import type { Theme } from "@/lib/slides/themes";

export type ReviewActions = {
  go: (slide: number, target?: string) => void;
  patchEl: (slide: number, id: string, patch: Partial<SlideElement>) => void;
  patchEls: (slide: number, patches: { id: string; patch: Partial<SlideElement> }[]) => void;
  setStyleColor: (slide: number, which: "tstyle" | "bstyle", color: string) => void;
  /** replace a whole word in one place (slide field, object or table cell) or everywhere; returns how many */
  replaceWord: (word: string, by: string, at?: { slide: number; key: string }) => number;
};

const SEV: Record<Severity, { label: string; cls: string }> = {
  error: { label: "Errors", cls: "text-red-600" },
  warning: { label: "Warnings", cls: "text-amber-600" },
  tip: { label: "Tips", cls: "text-sky-600" },
};

/** The better of black and white on a background. */
const readableOn = (bg: string) => (contrast("000000", bg) >= contrast("FFFFFF", bg) ? "000000" : "FFFFFF");

/** Text colours in rich text made readable on `bg` (runs with their own colour, and the rest). */
export function fixHtmlContrast(html: string, bg: string, dflt: string): string {
  const good = readableOn(bg);
  let out = html.replace(/(color:\s*)(#[0-9a-f]{3,6}|rgba?\([^)]*\))/gi, (m, pre: string, c: string) => (contrast(c, bg) < 4.5 ? `${pre}#${good}` : m));
  if (contrast(dflt, bg) < 4.5) out = out.replace(/<p(\b[^>]*)>([\s\S]*?)<\/p>/gi, (_m, attrs: string, inner: string) => `<p${attrs}><span style="color: #${good}">${inner}</span></p>`);
  return out;
}

function AltForm({ el, onSave }: { el: SlideElement; onSave: (alt: string, deco: boolean) => void }) {
  const [alt, setAlt] = useState(el.alt || "");
  return (
    <div className="mt-1.5 space-y-1" onClick={(e) => e.stopPropagation()}>
      <textarea data-testid="a11y-alt" className="w-full h-14 rounded border border-slate-300 px-1.5 py-1 text-xs" placeholder="Describe what it shows (1–2 sentences)" value={alt} onChange={(e) => setAlt(e.target.value)} />
      <div className="flex gap-1.5">
        <button type="button" data-testid="a11y-alt-save" className="rounded bg-indigo-600 text-white text-xs px-2 py-1 disabled:opacity-40" disabled={!alt.trim()} onClick={() => onSave(alt.trim(), false)}>Save</button>
        <button type="button" data-testid="a11y-deco" className="rounded border border-slate-300 text-xs px-2 py-1 hover:bg-slate-50" onClick={() => onSave("", true)}>Mark as decorative</button>
      </div>
    </div>
  );
}

function A11yTab({ slides, theme, masters, W, H, act }: { slides: Slide[]; theme: Theme; masters: Masters; W: number; H: number; act: ReviewActions }) {
  const issues = useMemo(() => checkAccessibility(slides, theme, masters, W, H), [slides, theme, masters, W, H]);
  const [open, setOpen] = useState<string | null>(null);
  const el = (i: Issue) => slides[i.slide]?.elements.find((e) => e.id === i.target);
  const fix = (i: Issue): { label: string; run: () => void } | null => {
    const s = slides[i.slide];
    if (!s) return null;
    if (i.kind === "contrast") {
      const bg = s.bg || theme.bg;
      if (i.target === "title" || i.target === "body") return { label: `Use ${readableOn(bg) === "000000" ? "black" : "white"} text`, run: () => act.setStyleColor(i.slide, i.target === "title" ? "tstyle" : "bstyle", readableOn(bg)) };
      const e = el(i);
      if (e && (e.type === "text" || e.type === "shape") && e.html) {
        const back = e.type === "shape" && e.fill ? e.fill : bg;
        return { label: "Make the text readable", run: () => act.patchEl(i.slide, e.id, { html: fixHtmlContrast(e.html!, back, theme.text) } as Partial<SlideElement>) };
      }
    }
    if (i.kind === "order" && i.order) {
      const z = readingOrderZ(s, i.order);
      return { label: "Read in the order shown", run: () => act.patchEls(i.slide, Object.entries(z).map(([id, v]) => ({ id, patch: { z: v } }))) };
    }
    if (i.kind === "table") {
      const t = el(i) as TableEl | undefined;
      if (t) return { label: "Make the first row headings", run: () => act.patchEl(i.slide, t.id, { rows: t.rows.map((r, k) => (k ? r : r.map((c) => ({ ...c, bold: true })))) } as Partial<SlideElement>) };
    }
    return null;
  };
  if (!issues.length) return <p className="text-sm text-emerald-700" data-testid="a11y-clean">No accessibility issues found. People with disabilities should have no trouble reading this presentation.</p>;
  return (
    <div className="space-y-3" data-testid="a11y-list">
      {(["error", "warning", "tip"] as const).map((sev) => {
        const list = issues.map((x, n) => ({ x, k: `${x.kind}|${x.slide}|${x.target ?? ""}|${n}` })).filter(({ x }) => x.severity === sev);
        if (!list.length) return null;
        return (
          <div key={sev}>
            <div className={`text-xs font-semibold uppercase tracking-wide ${SEV[sev].cls}`}>{SEV[sev].label} ({list.length})</div>
            <ul className="mt-1 space-y-1">
              {list.map(({ x, k }) => {
                const f = fix(x);
                const target = x.kind === "alt" ? el(x) : undefined;
                return (
                  <li key={k} data-testid="a11y-issue" data-kind={x.kind} data-slide={x.slide} className={`rounded border px-2 py-1.5 text-xs cursor-pointer ${open === k ? "border-indigo-300 bg-indigo-50/50" : "border-slate-200 hover:bg-slate-50"}`} onClick={() => { setOpen(k); act.go(x.slide, x.target); }}>
                    <div className="text-slate-500">Slide {x.slide + 1}</div>
                    <div className="text-slate-800">{x.message}</div>
                    {open === k && target && <AltForm key={target.id} el={target} onSave={(alt, deco) => { setOpen(null); act.patchEl(x.slide, target.id, deco ? { deco: true, alt: undefined } : { alt, deco: undefined }); }} />}
                    {open === k && f && (
                      <button type="button" data-testid="a11y-fix" className="mt-1.5 rounded bg-indigo-600 text-white px-2 py-1" onClick={(e) => { e.stopPropagation(); setOpen(null); f.run(); }}>{f.label}</button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

const WHERE = (s: Slide | undefined, key: string) => (key === "title" ? "title" : key === "body" ? "text" : key === "notes" ? "speaker notes" : s?.elements.find((e) => e.id === key.split(":")[0])?.type === "table" ? "table" : "text box");

function SpellTab({ slides, act }: { slides: Slide[]; act: ReviewActions }) {
  const [sp, setSp] = useState<Speller | null>(null);
  const [err, setErr] = useState("");
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [rev, setRev] = useState(0); // added words
  const [pick, setPick] = useState("");
  useEffect(() => {
    loadSpeller().then(setSp, (e) => setErr((e as Error).message));
  }, []);
  const list = useMemo(() => (sp ? spellIssues(slides, (w) => ignored.has(w) || sp.correct(w)) : []), [sp, slides, ignored, rev]);
  const cur = list.find((m) => !skip.has(`${m.slide}|${m.key}|${m.word}`));
  const sugg = useMemo(() => (cur && sp ? sp.suggest(cur.word) : []), [cur, sp]);
  useEffect(() => setPick(sugg[0] || ""), [sugg]);
  useEffect(() => {
    if (cur) act.go(cur.slide, cur.key === "title" || cur.key === "body" || cur.key === "notes" ? undefined : cur.key.split(":")[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.slide, cur?.key, cur?.word]);
  if (err) return <p className="text-sm text-red-600">Spelling is not available: {err}</p>;
  if (!sp) return <p className="text-sm text-slate-500">Loading the dictionary…</p>;
  if (!cur) return <p className="text-sm text-emerald-700" data-testid="spell-done">The spelling check is complete. No unknown words.</p>;
  const context = (() => {
    const s = slides[cur.slide];
    const text = cur.key === "title" ? s.title : cur.key === "notes" ? s.notes : cur.key === "body" ? htmlText(s.body) : (() => {
      const [id, r, c] = cur.key.split(":");
      const e = s.elements.find((x) => x.id === id);
      return e?.type === "table" ? e.rows[Number(r)]?.[Number(c)]?.text || "" : e && "html" in e ? htmlText(e.html || "") : "";
    })();
    const at = text.indexOf(cur.word);
    return at < 0 ? cur.word : `${at > 30 ? "…" : ""}${text.slice(Math.max(0, at - 30), at)}§${text.slice(at + cur.word.length, at + cur.word.length + 30)}${text.length > at + cur.word.length + 30 ? "…" : ""}`;
  })();
  const [pre, post] = context.split("§");
  return (
    <div className="space-y-2 text-sm" data-testid="spell-panel">
      <div className="text-xs text-slate-500">Slide {cur.slide + 1}, {WHERE(slides[cur.slide], cur.key)} · {list.length} unknown word{list.length === 1 ? "" : "s"}</div>
      <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs">{pre}<span className="text-red-600 underline decoration-wavy font-semibold" data-testid="spell-word">{cur.word}</span>{post}</div>
      <div className="text-xs text-slate-600">Suggestions</div>
      <ul className="rounded border border-slate-200 max-h-32 overflow-y-auto" data-testid="spell-suggestions">
        {sugg.length ? sugg.map((w) => (
          <li key={w}><button type="button" className={`w-full text-left px-2 py-0.5 ${pick === w ? "bg-indigo-100" : "hover:bg-slate-50"}`} onClick={() => setPick(w)} onDoubleClick={() => act.replaceWord(cur.word, w, cur)}>{w}</button></li>
        )) : <li className="px-2 py-0.5 text-slate-400">(no suggestions)</li>}
      </ul>
      <div className="grid grid-cols-2 gap-1.5">
        <button type="button" data-testid="spell-change" className="rounded bg-indigo-600 text-white px-2 py-1 disabled:opacity-40" disabled={!pick} onClick={() => act.replaceWord(cur.word, pick, cur)}>Change</button>
        <button type="button" data-testid="spell-change-all" className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40" disabled={!pick} onClick={() => act.replaceWord(cur.word, pick)}>Change all</button>
        <button type="button" data-testid="spell-ignore" className="rounded border border-slate-300 px-2 py-1" onClick={() => setSkip((x) => new Set(x).add(`${cur.slide}|${cur.key}|${cur.word}`))}>Ignore</button>
        <button type="button" data-testid="spell-ignore-all" className="rounded border border-slate-300 px-2 py-1" onClick={() => setIgnored((x) => new Set(x).add(cur.word))}>Ignore all</button>
        <button type="button" data-testid="spell-add" className="col-span-2 rounded border border-slate-300 px-2 py-1" onClick={() => { sp.add(cur.word); setRev((r) => r + 1); }}>Add to dictionary</button>
      </div>
    </div>
  );
}

export function ReviewPane({ tab, onTab, slides, theme, masters, W, H, act, onClose }: { tab: "a11y" | "spell"; onTab: (t: "a11y" | "spell") => void; slides: Slide[]; theme: Theme; masters: Masters; W: number; H: number; act: ReviewActions; onClose: () => void }) {
  return (
    <aside className="w-72 border-l border-slate-200 bg-white overflow-y-auto shrink-0 no-print" data-testid="review-pane">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
        <div className="flex gap-1 text-sm">
          <button type="button" data-testid="review-a11y" className={`rounded px-2 py-0.5 ${tab === "a11y" ? "bg-indigo-100 text-indigo-700 font-semibold" : "text-slate-600 hover:bg-slate-100"}`} onClick={() => onTab("a11y")}>Accessibility</button>
          <button type="button" data-testid="review-spell" className={`rounded px-2 py-0.5 ${tab === "spell" ? "bg-indigo-100 text-indigo-700 font-semibold" : "text-slate-600 hover:bg-slate-100"}`} onClick={() => onTab("spell")}>Spelling</button>
        </div>
        <button className="text-slate-400 hover:text-slate-700" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="p-3">{tab === "a11y" ? <A11yTab slides={slides} theme={theme} masters={masters} W={W} H={H} act={act} /> : <SpellTab slides={slides} act={act} />}</div>
    </aside>
  );
}
