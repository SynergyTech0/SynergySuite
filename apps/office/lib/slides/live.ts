// Presenting live: the deck settings both the editor and the audience view
// read from the shared document, the presenter's place in the show (sent to
// followers through collaboration awareness), and live captions.
import { DEFAULT_H, DEFAULT_W, cleanHf, type Box, type HeaderFooter } from "./model";
import { effectiveTheme, themeColors, type Theme, type ThemeColors } from "./themes";
import { parseCustomShows, parseShowSettings, type CustomShow, type ShowSettings } from "./show";

export type DeckMeta = { w: number; h: number; theme: string; font: string; headFont?: string; colors?: ThemeColors; hf?: HeaderFooter; show?: ShowSettings; shows?: CustomShow[] };

export const parseJsonSafe = (v: unknown): unknown => {
  if (typeof v !== "string" || !v) return undefined;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
};

export function parseHf(v: unknown): HeaderFooter | undefined {
  return cleanHf(parseJsonSafe(v));
}

/** The deck settings kept in the shared "meta" map. */
export function readDeckMeta(get: (k: string) => unknown): DeckMeta {
  return {
    w: Number(get("w")) || DEFAULT_W,
    h: Number(get("h")) || DEFAULT_H,
    theme: (get("theme") as string) || "synergy",
    font: (get("font") as string) || "",
    headFont: (get("headFont") as string) || undefined,
    colors: themeColors(parseJsonSafe(get("colors"))),
    hf: parseHf(get("hf")),
    show: parseShowSettings(get("showSet")),
    shows: parseCustomShows(get("shows")),
  };
}

/** How slides are drawn with these settings (a DeckLook). */
export function lookOf(m: Pick<DeckMeta, "w" | "h" | "theme" | "colors" | "font" | "headFont" | "hf">): { W: number; H: number; theme: Theme; font: string; headFont?: string; hf?: HeaderFooter } {
  const theme = effectiveTheme(m.theme, m.colors);
  return { W: m.w, H: m.h, theme, font: m.font ? `'${m.font}', ${theme.font}` : theme.font, headFont: m.headFont ? `'${m.headFont}', ${theme.font}` : undefined, hf: m.hf };
}

// ---- following the presenter ----

export type LiveInk = { tool: "pen" | "hl"; color: string; pts: { x: number; y: number }[] };
/**
 * Where a presenter is, as their client publishes it: the slide (by id), how
 * many click steps are shown, black or white screen, the end screen, the zoom
 * being entered or left, the slide's ink and the current caption.
 */
export type LiveState = {
  v: 1;
  since: number;
  name: string;
  sid: string;
  step: number;
  fwd: boolean;
  blank?: "black" | "white";
  ended?: boolean;
  zoom?: { box: Box; out?: boolean };
  ink?: LiveInk[];
  cap?: string;
  seq: number;
  /** trigger sequences: steps shown per trigger, and the trigger clicked last (its step is playing) */
  trig?: Record<string, number>;
  tlast?: string;
};

const HEX = /^[0-9A-Fa-f]{6}$/;
const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);

/** A presenter state from another client, checked (null when it is not one). */
export function parseLive(v: unknown): LiveState | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.v !== 1 || typeof o.sid !== "string" || !o.sid) return null;
  const step = num(o.step, 0, 10000), since = num(o.since, 0, 1e15), seq = num(o.seq, 0, 1e12);
  if (step === null || since === null || seq === null) return null;
  const out: LiveState = { v: 1, since, seq, name: typeof o.name === "string" ? o.name.slice(0, 120) : "", sid: o.sid.slice(0, 100), step, fwd: o.fwd !== false };
  if (o.blank === "black" || o.blank === "white") out.blank = o.blank;
  if (o.ended === true) out.ended = true;
  const z = o.zoom as Record<string, unknown> | undefined;
  const zb = z?.box as Record<string, unknown> | undefined;
  if (zb && [zb.x, zb.y, zb.w, zb.h].every((n) => typeof n === "number" && Number.isFinite(n))) out.zoom = { box: { x: zb.x as number, y: zb.y as number, w: zb.w as number, h: zb.h as number }, ...(z!.out === true ? { out: true } : {}) };
  if (Array.isArray(o.ink)) {
    const ink: LiveInk[] = [];
    for (const k of o.ink.slice(0, 200)) {
      const s = k as Record<string, unknown>;
      if ((s?.tool !== "pen" && s?.tool !== "hl") || typeof s.color !== "string" || !HEX.test(s.color) || !Array.isArray(s.pts)) continue;
      const pts = (s.pts as unknown[]).slice(0, 2000).filter((p): p is { x: number; y: number } => !!p && typeof (p as { x: unknown }).x === "number" && typeof (p as { y: unknown }).y === "number");
      if (pts.length > 1) ink.push({ tool: s.tool, color: s.color, pts });
    }
    if (ink.length) out.ink = ink;
  }
  if (typeof o.cap === "string" && o.cap) out.cap = o.cap.slice(-400);
  if (o.trig && typeof o.trig === "object" && !Array.isArray(o.trig)) {
    const t: Record<string, number> = {};
    for (const [k, n] of Object.entries(o.trig as Record<string, unknown>).slice(0, 200)) {
      const v = num(n, 0, 10000);
      if (v !== null && k.length <= 100) t[k] = v;
    }
    if (Object.keys(t).length) out.trig = t;
  }
  if (typeof o.tlast === "string" && o.tlast.length <= 100) out.tlast = o.tlast;
  return out;
}

/** The presenter to follow among the clients' awareness states: the one who started presenting last. */
export function pickPresenter(states: Iterable<[number, Record<string, unknown>]>, self?: number): { client: number; live: LiveState } | null {
  let best: { client: number; live: LiveState } | null = null;
  for (const [client, st] of states) {
    if (client === self) continue;
    const live = parseLive(st?.live);
    if (live && (!best || live.since > best.live.since)) best = { client, live };
  }
  return best;
}

/** Ink as sent to followers: points rounded to a tenth of a pixel. */
export function liveInk(strokes: LiveInk[] | undefined): LiveInk[] | undefined {
  if (!strokes?.length) return undefined;
  return strokes.map((k) => ({ tool: k.tool, color: k.color, pts: k.pts.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })) }));
}

// ---- live captions ----

export const CAPTION_LANGS: { id: string; label: string }[] = [
  { id: "en-US", label: "English (United States)" },
  { id: "en-GB", label: "English (United Kingdom)" },
  { id: "en-AU", label: "English (Australia)" },
  { id: "en-IN", label: "English (India)" },
  { id: "es-ES", label: "Spanish (Spain)" },
  { id: "es-MX", label: "Spanish (Mexico)" },
  { id: "fr-FR", label: "French" },
  { id: "de-DE", label: "German" },
  { id: "it-IT", label: "Italian" },
  { id: "pt-BR", label: "Portuguese (Brazil)" },
  { id: "nl-NL", label: "Dutch" },
  { id: "pl-PL", label: "Polish" },
  { id: "ja-JP", label: "Japanese" },
  { id: "ko-KR", label: "Korean" },
  { id: "zh-CN", label: "Chinese (Simplified)" },
  { id: "hi-IN", label: "Hindi" },
  { id: "ar-SA", label: "Arabic" },
];

export type CaptionSettings = { lang: string; pos: "bottom" | "top"; size: "s" | "m" | "l" };
export const CAPTION_DEFAULTS: CaptionSettings = { lang: "en-US", pos: "bottom", size: "m" };

export function parseCaptionSettings(v: unknown): CaptionSettings {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    lang: typeof o.lang === "string" && /^[a-z]{2,3}(-[A-Z]{2})?$/.test(o.lang) ? o.lang : CAPTION_DEFAULTS.lang,
    pos: o.pos === "top" ? "top" : "bottom",
    size: o.size === "s" || o.size === "l" ? o.size : "m",
  };
}

/** The language for captions: the browser's own when it is one we list (by language when not by region). */
export function defaultCaptionLang(nav: string | undefined): string {
  if (!nav) return CAPTION_DEFAULTS.lang;
  const hit = CAPTION_LANGS.find((l) => l.id.toLowerCase() === nav.toLowerCase()) || CAPTION_LANGS.find((l) => l.id.split("-")[0] === nav.split("-")[0].toLowerCase());
  return hit?.id || CAPTION_DEFAULTS.lang;
}

/**
 * The caption on screen: the end of what was said (finished phrases, then the
 * phrase being heard), cut at a word to at most `max` characters, so two lines
 * or so stay up and older words scroll away.
 */
export function captionText(finals: string[], interim: string, max = 140): string {
  const all = [...finals, interim].map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean).join(" ");
  if (all.length <= max) return all;
  const tail = all.slice(all.length - max);
  const cut = tail.indexOf(" ");
  return cut > 0 && cut < tail.length - 1 ? tail.slice(cut + 1) : tail;
}

/** Results of a recognition event, split into finished phrases and the phrase still being heard. */
export function readResults(results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>, from: number): { finals: string[]; interim: string } {
  const finals: string[] = [];
  let interim = "";
  for (let i = from; i < results.length; i++) {
    const r = results[i];
    if (r.isFinal) finals.push(r[0].transcript);
    else interim += r[0].transcript;
  }
  return { finals, interim };
}
