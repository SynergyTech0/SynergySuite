// Print layout: which page and column each top-level block of the document
// falls on, from the blocks' measured heights and the sections' page setup.
// Pure (no DOM), so the editor plugin and the tests share it. A paragraph,
// list or table that does not fit is split between lines (or table rows),
// keeping at least two lines on each page (Word's widow and orphan
// control); a table's header rows repeat on the next page. Footnotes take
// room at the foot of the page that holds their reference. A block that
// cannot be split and is taller than a page makes that page taller.
import { type DocSettings, type PMNode, type Section, contentHeight, contentWidth, formatPageNumber, parseSection, ptToPx } from "./model";

/** A line (or table row) of a block: its top and bottom from the block's top, in px. */
export type Line = { top: number; bottom: number };

/** A footnote: its id, height (px) and where its reference sits (px from the block's top). */
export type NoteBox = { id: number; h: number; y: number };

export type BlockBox = {
  h: number;
  kind: "block" | "pageBreak" | "sectionBreak" | "float";
  keepNext?: boolean;
  /** never split this block (Word's keep lines together) */
  keepLines?: boolean;
  /** false: Word's widow/orphan control is off for this paragraph */
  widows?: boolean;
  /** start the block on a new page (Word's page break before) */
  breakBefore?: boolean;
  /** where the block may be split: its lines, or its rows for a table (measured on demand) */
  lines?: Line[] | (() => Line[] | undefined);
  /** height of the header rows a table repeats after a split (may be set when the lines are measured) */
  header?: number;
  notes?: NoteBox[];
};

export type Region = { top: number; bottom: number; left: number; colWidth: number; gap: number; cols: number; separator: boolean };

export type PageBox = {
  index: number;
  top: number;
  left: number;
  width: number;
  height: number;
  section: number;
  number: number;
  label: string;
  firstOfSection: boolean;
  /** which header/footer this page shows */
  hf: "default" | "first" | "even";
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  headerDist: number;
  footerDist: number;
  regions: Region[];
  /** footnotes shown at the foot of this page */
  notes: number[];
  /** height of the footnote area (separator included) */
  notesHeight: number;
};

/** Where a block goes: its top margin in the flow, left edge, width, page and top (flow y). */
export type Placement = { marginTop: number; left: number; width: number; page: number; y: number };

/** A block continues on the next page or column: before `line`, a gap of `gap` px (then the repeated header rows). */
/**
 * Where a block is split: before line `line`, with `gap` px of room pushing the
 * rest down to the next page. `from`/`to`: where the part before the split
 * starts and ends (px into the block). `shift`: how far the rest moves sideways
 * from where the block starts (mirror margins swap the margins of even pages).
 */
export type Split = { block: number; line: number; gap: number; header: number; page: number; from?: number; to?: number; shift?: number; h?: number };

export type Layout = { pages: PageBox[]; place: Placement[]; splits: Split[]; flowWidth: number; padBottom: number };

export const PAGE_GAP = 24;
/** space taken by the footnote separator line */
export const NOTE_SEPARATOR = 16;

/** The sections of a document in order, and which section each top-level block belongs to. */
export function sectionsOf(doc: PMNode | { forEach: (f: (n: { type: { name: string }; attrs: Record<string, unknown> }) => void) => void }, body: Section): { sections: Section[]; blockSection: number[] } {
  const sections: Section[] = [];
  const blockSection: number[] = [];
  const visit = (type: string, attrs: Record<string, unknown> | undefined) => {
    blockSection.push(sections.length);
    if (type === "sectionBreak") sections.push(parseSectionCached(attrs?.section));
  };
  if ("forEach" in doc && typeof doc.forEach === "function") doc.forEach((n) => visit(n.type.name, n.attrs));
  else for (const n of (doc as PMNode).content || []) visit(n.type, n.attrs);
  sections.push(body);
  return { sections, blockSection };
}

const cache = new Map<string, Section>();
export function parseSectionCached(v: unknown): Section {
  if (typeof v !== "string") return parseSection(v);
  let s = cache.get(v);
  if (!s) {
    if (cache.size > 200) cache.clear();
    cache.set(v, (s = parseSection(v)));
  }
  return s;
}

export type HFKind = "headers" | "footers";
export type HFType = "default" | "first" | "even";

/** The header or footer a page shows: its own section's, else the nearest earlier section's (Word's link to previous). */
export function headerFooterFor(sections: Section[], si: number, kind: HFKind, type: HFType): { doc: PMNode | undefined; from: number } {
  for (let k = si; k >= 0; k--) {
    const set = sections[k]?.[kind];
    if (set && set[type]) return { doc: set[type], from: k };
  }
  return { doc: undefined, from: -1 };
}

/** Page geometry of a section in a flow `flowWidth` px wide. */
export function geometry(s: Section, flowWidth: number) {
  const pageW = ptToPx(s.pageWidth);
  const pageLeft = (flowWidth - pageW) / 2;
  const left = pageLeft + ptToPx(s.margins.left + (s.margins.gutter || 0));
  const cw = ptToPx(contentWidth(s));
  const n = s.columns && s.columns.count > 1 ? s.columns.count : 1;
  const gap = n > 1 ? ptToPx(s.columns!.space) : 0;
  const colWidth = n > 1 ? Math.max(24, (cw - gap * (n - 1)) / n) : cw;
  return { pageW, pageLeft, left, cw, n, gap, colWidth };
}

export const flowWidthOf = (sections: Section[]) => Math.ceil(Math.max(...sections.map((s) => ptToPx(s.pageWidth))));

/** Lines kept together at a page or column break (Word's widow/orphan control). */
const MIN_LINES = 2;

export type PaginateOptions = {
  pageGap?: number;
  /** measured height (px) of the header or footer content a page shows (0 when empty) */
  hfHeight?: (section: number, kind: HFKind, type: HFType) => number;
};

export function paginate(blocks: BlockBox[], blockSection: number[], sections: Section[], settings: DocSettings = {}, opts: PaginateOptions = {}): Layout {
  const pageGap = opts.pageGap ?? PAGE_GAP;
  const flowWidth = flowWidthOf(sections);
  const pages: PageBox[] = [];
  const place: Placement[] = [];
  const splits: Split[] = [];
  let domY = 0;
  let contentBottom = 0;
  let regionTop = 0;
  let region: Region | null = null;
  let col = 0;
  let colY = 0;
  let colH: number[] = [];

  const page = () => pages[pages.length - 1];
  const newPage = (si: number) => {
    const s = sections[si];
    const g = geometry(s, flowWidth);
    const prev = page();
    const top = prev ? prev.top + prev.height + pageGap : 0;
    const first = !prev || prev.section !== si;
    const number = first && s.pageNumberStart ? s.pageNumberStart : prev ? prev.number + 1 : 1;
    const evenOdd = !!settings.evenAndOddHeaders;
    const hf: HFType = first && s.titlePage ? "first" : evenOdd && number % 2 === 0 ? "even" : "default";
    // mirror margins: even pages have the inside (and gutter) on the right
    const mirrored = !!settings.mirrorMargins && number % 2 === 0;
    const inside = s.margins.left + (s.margins.gutter || 0);
    const mTop = ptToPx(s.margins.top);
    const mBottom = ptToPx(s.margins.bottom);
    const hDist = ptToPx(s.margins.header);
    const fDist = ptToPx(s.margins.footer);
    // a tall header or footer pushes the text away (Word grows the margin)
    const hh = opts.hfHeight ? opts.hfHeight(si, "headers", hf) : 0;
    const fh = opts.hfHeight ? opts.hfHeight(si, "footers", hf) : 0;
    const p: PageBox = {
      index: pages.length,
      top,
      left: g.pageLeft,
      width: g.pageW,
      height: ptToPx(s.pageHeight),
      section: si,
      number,
      label: formatPageNumber(number, s.pageNumberFormat),
      firstOfSection: first,
      hf,
      marginTop: hh > 0 ? Math.max(mTop, hDist + hh + 4) : mTop,
      marginBottom: fh > 0 ? Math.max(mBottom, fDist + fh + 4) : mBottom,
      marginLeft: ptToPx(mirrored ? s.margins.right : inside),
      marginRight: ptToPx(mirrored ? inside : s.margins.right),
      headerDist: ptToPx(s.margins.header),
      footerDist: ptToPx(s.margins.footer),
      regions: [],
      notes: [],
      notesHeight: 0,
    };
    pages.push(p);
    contentBottom = top + p.height - p.marginBottom;
    startRegion(si, top + p.marginTop);
  };
  let regionPage = 0;
  let regionBlocks: number[] = [];
  let regionPlain = true; // no splits, floats or footnotes: the region's columns can be balanced
  let regionDomY = 0;
  const startRegion = (si: number, y: number) => {
    const g = geometry(sections[si], flowWidth);
    regionTop = y;
    col = 0;
    colY = 0;
    colH = [];
    region = { top: y, bottom: y, left: page().left + page().marginLeft, colWidth: g.colWidth, gap: g.gap, cols: g.n, separator: !!sections[si].columns?.separator };
    page().regions.push(region);
    regionPage = pages.length - 1;
    regionBlocks = [];
    regionPlain = true;
    regionDomY = domY;
  };
  /** Word balances the columns of a section that ends in a continuous break: spread its blocks evenly. */
  const balance = () => {
    const r = region as Region | null;
    if (!r || r.cols < 2 || !regionPlain || pages.length - 1 !== regionPage || regionBlocks.length < 2) return;
    const hs = regionBlocks.map((i) => blocks[i].h);
    const fits = (H: number) => {
      let c = 0;
      let y = 0;
      for (const h of hs) {
        if (y > 0 && y + h > H + 0.5) {
          c++;
          y = 0;
        }
        y += h;
      }
      return c < r.cols;
    };
    let lo = Math.max(...hs);
    let hi = hs.reduce((a, b) => a + b, 0);
    if (fits(lo)) hi = lo;
    for (let k = 0; k < 30 && hi - lo > 0.5; k++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    let c = 0;
    let y = 0;
    let dy = regionDomY;
    const heights: number[] = [];
    for (let k = 0; k < regionBlocks.length; k++) {
      const h = hs[k];
      if (y > 0 && y + h > hi + 0.5) {
        heights[c] = y;
        c++;
        y = 0;
      }
      const target = regionTop + y;
      const pl = place[regionBlocks[k]];
      pl.marginTop = target - dy;
      pl.left = r.left + c * (r.colWidth + r.gap);
      pl.y = target;
      dy = target + h;
      y += h;
    }
    heights[c] = y;
    colH = heights;
    col = c;
    colY = y;
    domY = dy;
    r.bottom = regionBottom();
  };
  const regionBottom = () => regionTop + Math.max(0, ...colH);
  /** room left in the current column, above the footnotes */
  const avail = () => contentBottom - page().notesHeight - regionTop - colY;
  /** extra footnote room `notes` would take on this page */
  const noteCost = (notes: NoteBox[]) => {
    const h = notes.reduce((s, n) => s + n.h, 0);
    return h ? h + (page().notesHeight ? 0 : NOTE_SEPARATOR) : 0;
  };
  const addNotes = (notes: NoteBox[]) => {
    if (!notes.length) return;
    const p = page();
    p.notesHeight += noteCost(notes);
    p.notes.push(...notes.map((n) => n.id));
  };
  const advance = (si: number, g: ReturnType<typeof geometry>) => {
    regionPlain = false;
    colH[col] = colY;
    if (region) (region as Region).bottom = regionBottom();
    if (col + 1 < g.n) {
      col++;
      colY = 0;
    } else newPage(si);
  };

  let pending: BlockBox["kind"] | null = null;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const si = Math.min(blockSection[i] ?? sections.length - 1, sections.length - 1);
    const s = sections[si];
    const g = geometry(s, flowWidth);
    if (i === 0) newPage(si);
    else if (pending === "pageBreak" || (b.breakBefore && pending !== "sectionBreak" && colY > 0)) newPage(si);
    else if (pending === "sectionBreak") {
      const prevSec = sections[blockSection[i - 1]];
      const same = prevSec && Math.abs(prevSec.pageWidth - s.pageWidth) < 1 && Math.abs(prevSec.pageHeight - s.pageHeight) < 1;
      if (s.type === "continuous" && same) {
        colH[col] = colY;
        balance();
        // continue on this page, below the previous section's text
        startRegion(si, regionBottom());
      } else {
        const wouldBe = s.pageNumberStart ?? page().number + 1;
        // a blank page (of the previous section) keeps the parity Word asks for
        if ((s.type === "evenPage" && wouldBe % 2 === 1) || (s.type === "oddPage" && wouldBe % 2 === 0)) newPage(blockSection[i - 1]);
        newPage(si);
      }
    }
    pending = b.kind === "block" || b.kind === "float" ? null : b.kind;
    const width = g.n > 1 ? g.colWidth : g.cw;
    const leftOf = () => page().left + page().marginLeft + col * (g.colWidth + g.gap);

    if (b.kind === "float") {
      // floating objects take no room in the flow: they sit where the next line starts
      // (a float's top margin does not move the text after it)
      const target = regionTop + colY;
      place.push({ marginTop: target - domY, left: leftOf(), width, page: pages.length - 1, y: target });
      regionPlain = false;
      continue;
    }
    if (b.notes?.length) regionPlain = false;

    const notes = b.notes || [];
    let measured: Line[] | null | undefined;
    const getLines = (): Line[] | null => {
      if (measured === undefined) {
        const v = typeof b.lines === "function" ? b.lines() : b.lines;
        measured = !b.keepLines && v && v.length > 1 ? v : null;
      }
      return measured;
    };
    let lines: Line[] | null = null;
    const lineOf = (n: NoteBox) => {
      if (!lines) return 0;
      let k = 0;
      while (k + 1 < lines.length && lines[k + 1].top <= n.y) k++;
      return k;
    };
    const notesFrom = (a: number, z: number) => notes.filter((n) => lineOf(n) >= a && lineOf(n) <= z);
    /** the last line (from `first`, starting `start` px into the block) that fits in `room`, honouring widow/orphan control */
    const lastFitting = (first: number, start: number, room: number, fresh: boolean): number => {
      if (!lines) return -1;
      let last = first - 1;
      for (let k = first; k < lines.length; k++) {
        if (lines[k].bottom - start + noteCost(notesFrom(first, k)) <= room + 0.5) last = k;
        else break;
      }
      const rest = lines.length - 1 - last;
      if (rest === 0) return last;
      const min = b.widows === false ? 1 : MIN_LINES;
      if (rest < min && last - first + 1 > min) last -= min - rest; // no widow
      else if (rest < min && !fresh) return first - 1;
      if (last - first + 1 < min && !fresh) return first - 1; // no orphan
      if (last < first && fresh) return first; // at least one line on a fresh page
      return last;
    };

    const fitsWhole = () => b.h + noteCost(notes) <= avail() + 0.5;
    const next = blocks[i + 1];
    const keep = b.keepNext && next && next.kind === "block" && blockSection[i + 1] === si ? next.h : 0;
    if (colY > 0) {
      const whole = fitsWhole();
      const kept = !keep || b.h + keep + noteCost(notes) <= avail() + 0.5 || b.h + keep > contentBottom - regionTop;
      if (!whole || !kept) {
        lines = whole ? null : getLines();
        const canSplit = !!lines && lastFitting(0, 0, avail(), false) >= 0;
        if (!canSplit) advance(si, g);
      }
    }
    if (colY === 0 && b.h + noteCost(notes) > avail() && col === 0 && !(lines = getLines())) {
      // too tall for any page: this page grows to hold it
      const extra = b.h + noteCost(notes) - avail();
      page().height += extra;
      contentBottom += extra;
    }
    let target = regionTop + colY;
    place.push({ marginTop: target - domY, left: leftOf(), width, page: pages.length - 1, y: target });
    if (b.kind === "block") regionBlocks.push(i);
    // flow the block, splitting it at lines while it does not fit
    let start = 0;
    let first = 0;
    for (let guard = 0; guard < 1000; guard++) {
      const rest = notesFrom(first, Infinity);
      if (b.h - start + noteCost(rest) > avail() + 0.5 && !lines) lines = getLines();
      if (!lines || b.h - start + noteCost(rest) <= avail() + 0.5) {
        addNotes(rest);
        colY += b.h - start;
        domY = target + b.h - start;
        break;
      }
      const header = b.header || 0;
      const last = lastFitting(first, start, avail(), colY === 0 || (first > 0 && colY <= header + 0.5));
      if (last >= lines.length - 1) {
        // only the block's bottom padding overflows
        addNotes(rest);
        colY += b.h - start;
        domY = target + b.h - start;
        break;
      }
      addNotes(notesFrom(first, last));
      const s1 = last + 1;
      colY += lines[s1].top - start;
      advance(si, g);
      const gap = regionTop - (target + lines[s1].top - start);
      const shift = leftOf() - place[i].left;
      splits.push({ block: i, line: s1, gap, header, page: pages.length - 1, ...(settings.mirrorMargins ? { shift: Math.round(shift * 100) / 100, from: start, to: lines[s1].top, h: b.h } : {}) });
      regionPlain = false;
      start = lines[s1].top;
      first = s1;
      colY = header;
      target = regionTop + header;
    }
    colH[col] = colY;
    if (region) (region as Region).bottom = regionBottom();
  }
  if (!pages.length) newPage(sections.length - 1);
  // vertical alignment: centre (or bottom-align) the text of pages that hold whole blocks only
  for (const pg of pages) {
    const va = sections[pg.section]?.vAlign;
    if (va !== "center" && va !== "bottom") continue;
    if (splits.some((sp) => sp.page === pg.index || place[sp.block]?.page === pg.index)) continue;
    const on = place.map((pl, i) => ({ pl, i })).filter((x) => x.pl.page === pg.index && blocks[x.i]?.kind === "block");
    if (!on.length || on.some((x) => (blockSection[x.i] ?? 0) !== pg.section) || pg.regions.length > 1) continue;
    const bottom = Math.max(...on.map((x) => x.pl.y + blocks[x.i].h));
    const free = pg.top + pg.height - pg.marginBottom - pg.notesHeight - bottom;
    if (free <= 1) continue;
    const shift = va === "center" ? free / 2 : free;
    on[0].pl.marginTop += shift;
    for (const x of on) x.pl.y += shift;
    const after = place.findIndex((pl, i) => i > on[on.length - 1].i && pl.page > pg.index);
    if (after >= 0) place[after].marginTop -= shift;
    else domY += shift;
    for (const r of pg.regions) {
      r.top += shift;
      r.bottom += shift;
    }
  }
  const last = page();
  return { pages, place, splits, flowWidth, padBottom: Math.max(0, last.top + last.height - domY) };
}

/** Content box height of a section's page in px (for tests and the editor). */
export const contentHeightPx = (s: Section) => ptToPx(contentHeight(s));
