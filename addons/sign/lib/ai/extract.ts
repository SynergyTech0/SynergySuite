/**
 * PDF text extraction WITH GEOMETRY.
 *
 * Field detection is only as good as the coordinates you can give the model. Plain text extraction
 * (pdf-parse) throws the layout away, which is precisely why the old code could not place a field
 * and fell back to hardcoding (100,600). Here we keep every text run's position, so the model can
 * say "the signature line is at x=72,y=612 on page 2" and we can put a field exactly there.
 *
 * Coordinate convention: TOP-LEFT origin, PDF points — matching what DocumentField stores and what
 * PdfFieldOverlay renders. pdf.js reports a bottom-left baseline origin, so we convert.
 *
 * Only VISIBLE text is kept: text a reader cannot see (invisible render mode, white-on-white, covered,
 * microscopic, off-page, hidden layers, invisible Unicode) never enters the layout. See visible-text.ts.
 */
import {
  addPageToReport, checkPixels, emptyHiddenReport, filterItems, walkGlyphs, PIXEL_SCALE,
  type GlyphWalk, type Pixels,
} from "./visible-text";

export interface TextRun {
  text: string;
  x: number;      // left edge, top-left origin
  y: number;      // top edge, top-left origin
  width: number;
  height: number;
}

export interface PageLayout {
  pageNumber: number;   // 1-based
  width: number;
  height: number;
  runs: TextRun[];
  /** Painted horizontal segments and rectangles (see geometry.ts), top-left points. */
  graphics?: { segs: { x0: number; x1: number; y: number }[]; rects: { x: number; y: number; w: number; h: number; filled: boolean }[] };
}

export interface DocumentLayout {
  pages: PageLayout[];
  text: string;         // full plain text, for classification/summary — VISIBLE text only
  /** Text in the PDF that a reader cannot see, removed from everything above. Never prompt with it. */
  hidden: import("./visible-text").HiddenTextReport;
  /** Pages rendered for the pixel check (non-enumerable; reused for the page images). */
  rendered?: Map<number, { canvas: any; scale: number }>;
}

/** Pages beyond this get the operator checks only. */
const MAX_PIXEL_PAGES = 40;
/** How many rendered pages to keep for reuse (collectAnchors shows the model at most 20). */
const KEEP_RENDERS = 20;

/**
 * A real place to sign — the underscore rule on a "Signature: ______" line, with its TRUE bounding
 * box taken from the PDF, not guessed by a model.
 *
 * This exists because a language model eyeballing coordinates is good enough to find the right line
 * and hopeless at landing on it: it would put a signature ~35pt above the rule. So the model's job
 * is only to say WHICH rule is what (and whose), and the geometry below decides exactly where the
 * field sits.
 */
export interface FieldAnchor {
  id: string;           // e.g. "A3"
  /** rule = typed underscores; line = drawn line; box = outlined box to write in; checkbox = small square. */
  kind?: "rule" | "line" | "box" | "checkbox";
  pageNumber: number;
  label: string;        // the text before the rule, e.g. "Signature:"
  lineText: string;     // the whole line, for the model's benefit
  x: number;            // left edge of the RULE itself
  y: number;            // top of the rule's text box (top-left origin)
  width: number;        // width of the rule
  height: number;       // line height
  baseline: number;     // y of the rule's baseline — where a signature should visually rest
}

const RULE = /_{3,}/;

/**
 * Find every fill-in rule on the page.
 *
 * pdf.js hands back "Signature: ______" as ONE run, so the rule's own x/width must be derived from
 * the run: we take the character offset of the underscores and scale by the run's width. That is an
 * approximation of glyph advance, but it is a far better one than a model's guess, and it is exact
 * in the axis that matters most (y/baseline).
 */
export function detectAnchors(layout: DocumentLayout): FieldAnchor[] {
  const anchors: FieldAnchor[] = [];

  for (const page of layout.pages) {
    let n = 0;
    for (const run of page.runs) {
      const m = RULE.exec(run.text);
      if (!m || run.text.length === 0) continue;

      const start = m.index;
      const end = start + m[0].length;
      const perChar = run.width / run.text.length;

      const x = run.x + start * perChar;
      const width = Math.max(40, (end - start) * perChar);

      anchors.push({
        id: `p${page.pageNumber}-r${++n}`,
        kind: "rule",
        pageNumber: page.pageNumber,
        label: run.text.slice(0, start).trim() || "(unlabelled)",
        lineText: run.text.trim(),
        x: round(x),
        y: round(run.y),
        width: round(Math.min(width, page.width - x)),
        height: round(run.height),
        baseline: round(run.y + run.height),
      });
    }
  }
  return anchors;
}

export async function extractLayout(pdf: Buffer): Promise<DocumentLayout> {
  // Legacy build: runs in Node with pdf.js's built-in fake worker. Do NOT touch
  // GlobalWorkerOptions.workerSrc here — assigning it a non-string throws "Invalid workerSrc type".
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdf),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise;

  const pages: PageLayout[] = [];
  const allText: string[] = [];

  // Only text a person can see goes into the layout, and from there into every prompt, anchor label
  // and party check (see visible-text.ts). What was removed is counted, never passed on.
  const hidden = emptyHiddenReport();
  const rendered = new Map<number, { canvas: any; scale: number }>();
  let ocConfig: any = null;
  try { ocConfig = await doc.getOptionalContentConfig(); } catch { ocConfig = null; }
  let renderer: Awaited<ReturnType<typeof import("./geometry").openRenderer>> | null = null;
  try {
    const { openRenderer } = await import("./geometry");
    renderer = await openRenderer(pdf);
  } catch { renderer = null; }

  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = (content.items as any[]).filter((it) => typeof it.str === "string");

      let walk: GlyphWalk | null = null;
      try { walk = await walkGlyphs(page, pdfjs.OPS, ocConfig, pdfjs.normalizeUnicode); }
      catch { hidden.checks.operators = false; }

      // The pixel check needs the page as drawn. A page with no text items has nothing to check.
      // Past MAX_PIXEL_PAGES only the operator checks run (rendering costs ~0.5s a page).
      let img: Pixels | null = null;
      if (items.some((it) => it.str.trim())) {
        try {
          const canvas = renderer && n <= MAX_PIXEL_PAGES ? await renderer.render(n, PIXEL_SCALE) : null;
          if (canvas) {
            img = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
            // Keep the first pages' renders for the Set-of-Mark images (collectAnchors), so a page is
            // not rendered twice.
            if (rendered.size < KEEP_RENDERS) rendered.set(n, { canvas, scale: PIXEL_SCALE });
          }
        } catch { img = null; }
        if (!img) hidden.checks.pixels = false;
      }
      if (walk && img && !checkPixels(walk.glyphs, img, PIXEL_SCALE)) { img = null; hidden.checks.pixels = false; }
      else if (walk && !img) checkPixels(walk.glyphs, null);

      // Pixels judge characters only once the operator walk has vouched for the rendering; without a
      // walk, a page is checked for invisible Unicode, size and position only (checks.operators=false).
      const vis = filterItems(items, walk?.glyphs ?? null, viewport, walk ? img : null, PIXEL_SCALE);
      addPageToReport(hidden, n, vis, !!walk?.hasImage);

      const runs: TextRun[] = [];
      for (const segs of vis.segments) {
        for (const s of segs) {
          if (!s.text.trim()) continue;
          // Segment geometry is the text item's: e/f = BASELINE (bottom-left origin), already
          // converted to the run's top edge, top-left origin.
          runs.push({ text: s.text, x: round(s.x), y: round(s.y), width: round(s.width), height: round(s.height) });
        }
      }

      // Reading order: top-to-bottom, then left-to-right.
      runs.sort((a, b) => (Math.abs(a.y - b.y) > 3 ? a.y - b.y : a.x - b.x));

      // Drawn lines and boxes, for anchors the text layer cannot show. Best effort: a page whose
      // drawing operations cannot be read still has its text.
      let graphics: PageLayout["graphics"];
      try {
        const { extractGraphics } = await import("./geometry");
        graphics = await extractGraphics(page, pdfjs.OPS);
      } catch { graphics = undefined; }

      pages.push({
        pageNumber: n,
        width: round(viewport.width),
        height: round(viewport.height),
        runs,
        graphics,
      });
      allText.push(runs.map((r) => r.text).join(" "));
    }
  } finally {
    await renderer?.destroy();
  }

  await doc.destroy?.();

  const layout: DocumentLayout = { pages, text: allText.join("\n\n"), hidden };
  // Not enumerable: canvases must never be serialised along with the layout.
  Object.defineProperty(layout, "rendered", { value: rendered, enumerable: false });
  return layout;
}

const round = (v: number) => Math.round(v * 10) / 10;

/**
 * Render the layout as compact positioned text for the model. Coordinates are included inline so the
 * model can reason about *where* things are, not just what they say.
 */
export function layoutToPrompt(layout: DocumentLayout, maxCharsPerPage = 6000): string {
  return layout.pages
    .map((p) => {
      const lines = groupIntoLines(p.runs).map(
        (l) => `[x=${l.x} y=${l.y} w=${l.width} h=${l.height}] ${l.text}`,
      );
      let body = lines.join("\n");
      if (body.length > maxCharsPerPage) body = body.slice(0, maxCharsPerPage) + "\n…(truncated)";
      return `--- PAGE ${p.pageNumber} (width=${p.width} height=${p.height}) ---\n${body}`;
    })
    .join("\n\n");
}

/** Merge runs that sit on the same baseline into one line, so the model sees readable lines. */
function groupIntoLines(runs: TextRun[]): TextRun[] {
  const lines: TextRun[] = [];
  for (const r of runs) {
    const line = lines.find((l) => Math.abs(l.y - r.y) <= 3);
    if (!line) {
      lines.push({ ...r });
      continue;
    }
    const right = Math.max(line.x + line.width, r.x + r.width);
    line.text += (r.x - (line.x + line.width) > 2 ? " " : "") + r.text;
    line.x = Math.min(line.x, r.x);
    line.width = round(right - line.x);
    line.height = Math.max(line.height, r.height);
  }
  return lines;
}
