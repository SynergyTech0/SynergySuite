// Slide show settings (Set Up Slide Show) and custom shows, kept in the deck
// metadata and written to .pptx as PowerPoint's showPr and custShowLst.
import type { Slide } from "./model";

export type ShowSettings = {
  /** start again after the last slide until Esc */
  loop?: boolean;
  /** false: ignore the slides' "advance after" timings (advance by click only) */
  useTimings?: boolean;
  /** present this custom show instead of every slide */
  show?: string;
};
export type CustomShow = { id: string; name: string; slides: string[] };

const obj = (v: unknown): Record<string, unknown> | undefined => {
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return undefined;
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
};

export function parseShowSettings(v: unknown): ShowSettings {
  const o = obj(v);
  if (!o) return {};
  const s: ShowSettings = {};
  if (o.loop === true) s.loop = true;
  if (o.useTimings === false) s.useTimings = false;
  if (typeof o.show === "string" && o.show) s.show = o.show.slice(0, 64);
  return s;
}

export function parseCustomShows(v: unknown): CustomShow[] {
  let a: unknown = v;
  if (typeof v === "string") {
    try {
      a = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(a)) return [];
  const out: CustomShow[] = [];
  for (const x of a.slice(0, 100)) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.name !== "string" || !Array.isArray(r.slides)) continue;
    out.push({ id: r.id.slice(0, 64), name: r.name.slice(0, 200), slides: r.slides.filter((s): s is string => typeof s === "string").slice(0, 2000) });
  }
  return out;
}

/** The slides a custom show presents, in its order (slides deleted since are skipped; hidden ones are shown, as listed). */
export function customShowSlides<T extends Pick<Slide, "id" | "hidden">>(slides: T[], show: CustomShow): T[] {
  const byId = new Map(slides.map((s) => [s.id, s]));
  return show.slides.map((id) => byId.get(id)).filter((s): s is T => !!s).map((s) => ({ ...s, hidden: false }));
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** <p:showPr> for presProps.xml. */
export function showPrXml(s: ShowSettings, shows: CustomShow[]): string {
  const k = s.show ? shows.findIndex((x) => x.id === s.show) : -1;
  const attrs = [s.loop ? ' loop="1"' : "", ' showNarration="1"', s.useTimings === false ? ' useTimings="0"' : ""].join("");
  return `<p:showPr${attrs}>${k >= 0 ? `<p:custShow id="${k}"/>` : "<p:sldAll/>"}</p:showPr>`;
}

/** <p:custShowLst>; `rid` gives a slide's relationship id in presentation.xml. */
export function custShowLstXml(shows: CustomShow[], rid: (slideId: string) => string | undefined): string {
  if (!shows.length) return "";
  const list = shows
    .map((sh, k) => `<p:custShow name="${esc(sh.name)}" id="${k}"><p:sldLst>${sh.slides.map(rid).filter(Boolean).map((r) => `<p:sld r:id="${r}"/>`).join("")}</p:sldLst></p:custShow>`)
    .join("");
  return `<p:custShowLst>${list}</p:custShowLst>`;
}

/** "m:ss" for a rehearsal time. */
export function fmtTime(ms: number): string {
  const t = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(sec).padStart(2, "0")}`;
}
