/**
 * How a table shows in the Lists views: gallery cards, a board with a column per choice, and a
 * month calendar. What's saved names fields by id; resolveViews fills in sensible fields for
 * anything not chosen and drops fields that no longer fit. Pure, so the browser and tests share it.
 */
import type { Field } from "./fields";

export type ListViewSettings = {
  gallery: { title?: string; fields?: string[] };
  board: { group?: string; title?: string; fields?: string[] };
  calendar: { date?: string; title?: string };
};

export type ResolvedViews = {
  gallery: { title: Field | null; fields: Field[] };
  board: { group: Field | null; title: Field | null; fields: Field[] };
  calendar: { date: Field | null; title: Field | null };
};

/** Fields shown on a card at most. */
export const MAX_CARD_FIELDS = 6;

const TITLE_TYPES: Field["type"][] = ["text", "email", "phone", "hyperlink", "choice", "number", "lookup", "date", "autonumber"];
const isTitle = (f: Field) => TITLE_TYPES.includes(f.type);
const isGroup = (f: Field) => f.type === "choice";
const isDate = (f: Field) => f.type === "date" || f.type === "datetime";

const id = (v: unknown) => (typeof v === "string" && v.length <= 64 ? v : undefined);
const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length <= 64))].slice(0, MAX_CARD_FIELDS) : undefined);

/** Keeps the known parts of settings from the browser. */
export function cleanListViews(raw: unknown): ListViewSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const g = r.gallery ?? {};
  const b = r.board ?? {};
  const c = r.calendar ?? {};
  return {
    gallery: { title: id(g.title), fields: ids(g.fields) },
    board: { group: id(b.group), title: id(b.title), fields: ids(b.fields) },
    calendar: { date: id(c.date), title: id(c.title) },
  };
}

/** The first text-like field, as Lists uses the Title column. */
export function defaultTitle(fields: Field[]): Field | null {
  return fields.find((f) => f.type === "text") ?? fields.find(isTitle) ?? null;
}

function pick(fields: Field[], want: string | undefined, ok: (f: Field) => boolean, fallback: Field | null): Field | null {
  const f = want ? fields.find((x) => x.id === want) : undefined;
  return f && ok(f) ? f : fallback;
}

function cardFields(fields: Field[], want: string[] | undefined, exclude: (Field | null)[]): Field[] {
  const skip = new Set(exclude.filter(Boolean).map((f) => f!.id));
  if (want) return want.map((w) => fields.find((f) => f.id === w)).filter((f): f is Field => !!f && !skip.has(f.id));
  return fields.filter((f) => f.type !== "autonumber" && f.type !== "longtext" && !skip.has(f.id)).slice(0, 3);
}

/** The fields each view uses: what was saved where it still fits, otherwise the defaults. */
export function resolveViews(fields: Field[], settings: ListViewSettings): ResolvedViews {
  const title = defaultTitle(fields);
  const gTitle = pick(fields, settings.gallery.title, isTitle, title);
  const group = pick(fields, settings.board.group, isGroup, fields.find(isGroup) ?? null);
  const bTitle = pick(fields, settings.board.title, isTitle, title);
  const date = pick(fields, settings.calendar.date, isDate, fields.find(isDate) ?? null);
  return {
    gallery: { title: gTitle, fields: cardFields(fields, settings.gallery.fields, [gTitle]) },
    board: { group, title: bTitle, fields: cardFields(fields, settings.board.fields, [bTitle, group]) },
    calendar: { date, title: pick(fields, settings.calendar.title, isTitle, title) },
  };
}

export const canTitle = isTitle;
export const canGroup = isGroup;
export const canDate = isDate;

/** The days a month calendar shows: whole weeks, Sunday first, as YYYY-MM-DD. */
export function monthGrid(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  const last = new Date(Date.UTC(year, month + 1, 0));
  const end = new Date(last);
  end.setUTCDate(last.getUTCDate() + (6 - last.getUTCDay()));
  const out: string[] = [];
  for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) out.push(d.toISOString().slice(0, 10));
  return out;
}
