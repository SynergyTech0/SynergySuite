// Presentation data model shared by the editor, the static slide renderer, the
// .pptx importer and the .pptx exporter.
//
// Units: every position/size is in "slide px" — CSS pixels at 96 dpi on a slide
// rendered at its real size (a 13.33in-wide 16:9 slide is 1280px wide). Text
// sizes inside HTML are CSS lengths (pt preferred; legacy decks use px).
//
// Collab storage (Yjs): the deck is a Y.Array of Y.Map<string>. Plain slide
// fields are string keys; each free-floating element lives under its own key
// `el:<id>` as JSON, so two people editing different boxes on one slide merge
// cleanly (same element: last writer wins, like every other field).

export type SlideLayout = "content" | "title" | "titleOnly" | "blank";

export type Box = { x: number; y: number; w: number; h: number };

export type TitleStyle = { size?: number; color?: string; align?: "left" | "center" | "right"; bold?: boolean; font?: string };
/** Default look of the content placeholder's text (set on the slide master or a layout). */
export type BodyStyle = { size?: number; color?: string; font?: string; /** outline levels 2 to 5 (index 0 is level 2); unset parts follow the level above */ lv?: (LevelLook | null)[] };
/** The look of one deeper outline level of the body text. */
export type LevelLook = { size?: number; color?: string; font?: string };
export const BODY_LEVELS = 5;

/** Level styles merged in order (later wins, part by part). */
export function mergeLevels(...ls: (BodyStyle | undefined)[]): (LevelLook | null)[] | undefined {
  const out: (LevelLook | null)[] = [];
  for (let i = 0; i < BODY_LEVELS - 1; i++) {
    const v: LevelLook = {};
    for (const b of ls) for (const [k, x] of Object.entries(b?.lv?.[i] || {})) if (x !== undefined && x !== "") (v as Record<string, unknown>)[k] = x;
    out.push(Object.keys(v).length ? v : null);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out.length ? out : undefined;
}

/** What outline level `n` (1-based) of the body text looks like, following the levels above. */
export function levelLook(bs: BodyStyle | undefined, n: number): LevelLook {
  const out: LevelLook = {};
  for (let i = 0; i < Math.min(n, BODY_LEVELS) - 1; i++) Object.assign(out, Object.fromEntries(Object.entries(bs?.lv?.[i] || {}).filter(([, x]) => x !== undefined && x !== "")));
  return out;
}

/** A level style read from untrusted JSON. */
export function cleanLevels(v: unknown): (LevelLook | null)[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.slice(0, BODY_LEVELS - 1).map((x): LevelLook | null => {
    if (!x || typeof x !== "object") return null;
    const o = x as Record<string, unknown>;
    const l: LevelLook = {};
    if (typeof o.size === "number" && o.size >= 4 && o.size <= 400) l.size = o.size;
    if (typeof o.color === "string" && /^[0-9A-F]{6}$/i.test(o.color)) l.color = o.color.toUpperCase();
    if (typeof o.font === "string" && o.font.trim() && o.font.length < 100) l.font = o.font.trim();
    return Object.keys(l).length ? l : null;
  });
  return mergeLevels({ lv: out });
}

// ---- animation & transitions ----
/**
 * Effects. Entrance and exit share the effect names (an exit "fly" flies out
 * towards `dir`); emphasis effects are pulse/spin/grow/teeter; a motion path
 * moves the object along `path`.
 */
export type AnimEffect = "appear" | "fade" | "fly" | "wipe" | "zoom" | "split" | "pulse" | "spin" | "grow" | "teeter" | "path";
/** Effect class: entrance (default), exit, emphasis or motion path. */
export type AnimKind = "entr" | "exit" | "emph" | "path";
export type Anim = {
  effect: AnimEffect;
  kind?: Exclude<AnimKind, "entr">;
  dir?: "b" | "t" | "l" | "r";
  start: "click" | "with" | "after";
  dur: number; // ms
  delay: number; // ms
  order: number; // position in the slide's animation sequence
  byPara?: boolean; // body text: one paragraph per step
  /** motion path: OOXML path syntax in fractions of the slide size, relative to the object ("M 0 0 L 0.25 0 E") */
  path?: string;
  /** grow/shrink: scale factor (default 1.5) */
  amount?: number;
  /**
   * Trigger: the effect plays when this target (an element id, "title" or
   * "body") is clicked in the slide show, instead of in the slide's click
   * sequence. Effects with the same trigger form that object's own sequence.
   */
  trigger?: string;
  /** a sound played as the effect starts: a built-in ("builtin:<id>") or an uploaded file's URL */
  sound?: AnimSound;
};
export type AnimSound = { src: string; name?: string };
export const animKind = (a: Anim): AnimKind => a.kind || "entr";
export const ANIM_EFFECTS: { id: AnimEffect; label: string; dirs?: boolean }[] = [
  { id: "appear", label: "Appear" },
  { id: "fade", label: "Fade" },
  { id: "fly", label: "Fly in", dirs: true },
  { id: "wipe", label: "Wipe", dirs: true },
  { id: "zoom", label: "Zoom" },
  { id: "split", label: "Split" },
];
export const EXIT_EFFECTS: { id: AnimEffect; label: string; dirs?: boolean }[] = [
  { id: "appear", label: "Disappear" },
  { id: "fade", label: "Fade out" },
  { id: "fly", label: "Fly out", dirs: true },
  { id: "wipe", label: "Wipe out", dirs: true },
  { id: "zoom", label: "Zoom out" },
  { id: "split", label: "Split out" },
];
export const EMPH_EFFECTS: { id: AnimEffect; label: string }[] = [
  { id: "pulse", label: "Pulse" },
  { id: "spin", label: "Spin" },
  { id: "grow", label: "Grow/Shrink" },
  { id: "teeter", label: "Teeter" },
];
export const PATH_PRESETS: { id: string; label: string; path: string }[] = [
  { id: "right", label: "Line: right", path: "M 0 0 L 0.25 0 E" },
  { id: "left", label: "Line: left", path: "M 0 0 L -0.25 0 E" },
  { id: "up", label: "Line: up", path: "M 0 0 L 0 -0.25 E" },
  { id: "down", label: "Line: down", path: "M 0 0 L 0 0.25 E" },
  { id: "diag", label: "Diagonal", path: "M 0 0 L 0.2 0.25 E" },
  { id: "arc", label: "Arc", path: "M 0 0 C 0.05 -0.2 0.25 -0.2 0.3 0 E" },
  { id: "circle", label: "Circle", path: "M 0 0 C 0 -0.11 0.09 -0.2 0.2 -0.2 C 0.31 -0.2 0.4 -0.11 0.4 0 C 0.4 0.11 0.31 0.2 0.2 0.2 C 0.09 0.2 0 0.11 0 0 Z" },
];
export const effectLabel = (a: Anim): string => {
  const k = animKind(a);
  if (k === "path") return "Motion path";
  const list = k === "exit" ? EXIT_EFFECTS : k === "emph" ? EMPH_EFFECTS : ANIM_EFFECTS;
  return list.find((e) => e.id === a.effect)?.label || a.effect;
};

/** Parse an OOXML motion path into points (cubic curves are sampled). Coordinates are slide fractions. */
export function pathPoints(path: string, samples = 12): { x: number; y: number }[] {
  const tok = path.replace(/([MLCZEmlcze])/g, " $1 ").trim().split(/[\s,]+/).filter(Boolean);
  const pts: { x: number; y: number }[] = [];
  let i = 0, cx = 0, cy = 0, sx = 0, sy = 0, cmd = "M";
  const n = () => Number(tok[i++]) || 0;
  while (i < tok.length) {
    if (/^[A-Za-z]$/.test(tok[i])) cmd = tok[i++].toUpperCase();
    if (cmd === "E") break;
    if (cmd === "Z") { cx = sx; cy = sy; pts.push({ x: cx, y: cy }); cmd = "M"; continue; }
    if (i >= tok.length) break;
    if (cmd === "M") { cx = n(); cy = n(); sx = cx; sy = cy; pts.push({ x: cx, y: cy }); cmd = "L"; }
    else if (cmd === "L") { cx = n(); cy = n(); pts.push({ x: cx, y: cy }); }
    else if (cmd === "C") {
      const x1 = n(), y1 = n(), x2 = n(), y2 = n(), x = n(), y = n();
      for (let k = 1; k <= samples; k++) {
        const t = k / samples, u = 1 - t;
        pts.push({ x: u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x, y: u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y });
      }
      cx = x; cy = y;
    } else i++;
  }
  return pts.length ? pts : [{ x: 0, y: 0 }];
}

/**
 * Where a motion path leaves the object (slide fractions). Path coordinates
 * are relative to the object's place (0 0 is where it stands), as PowerPoint
 * has them; a path that starts elsewhere moves the object to its start first.
 */
export function pathEnd(path: string): { x: number; y: number } {
  const p = pathPoints(path, 1);
  return { x: p[p.length - 1].x, y: p[p.length - 1].y };
}
/** Slide transitions. `dir` follows OOXML: the direction the motion goes (l/r/u/d). */
export type TransType = "none" | "fade" | "push" | "wipe" | "split" | "cover" | "zoom" | "morph";
export type Transition = { type: TransType; dir?: "l" | "r" | "u" | "d"; dur: number; advClick?: boolean; advAfter?: number };
export const TRANSITIONS: { id: TransType; label: string; dirs?: boolean }[] = [
  { id: "none", label: "None" },
  { id: "fade", label: "Fade" },
  { id: "push", label: "Push", dirs: true },
  { id: "wipe", label: "Wipe", dirs: true },
  { id: "split", label: "Split" },
  { id: "cover", label: "Cover", dirs: true },
  { id: "zoom", label: "Zoom" },
  { id: "morph", label: "Morph" },
];

/**
 * `anim` is an object's first effect; `fx` holds any further effects
 * (emphasis, exit, motion paths...). `group` is the outermost group the object
 * is in; `sub` the groups inside it that hold the object, outer to inner
 * (ungrouping the outer group leaves them).
 */
/** `alt`: alternative text for screen readers; `deco`: decorative (screen readers skip it). */
/**
 * `slot`: on a layout, a placeholder of that kind (a text element whose text is
 * the prompt); slides using the layout show it as "Click to add ..." until
 * something fills it. `ph`: on a slide, the layout slot this object fills.
 */
type ElBase = Box & { id: string; z: number; rot?: number; flipH?: boolean; flipV?: boolean; group?: string; sub?: string[]; anim?: Anim; fx?: Anim[]; alt?: string; deco?: boolean; slot?: SlotKind; ph?: string };
/** Layout placeholder kinds beyond the title and body (PowerPoint's obj, body, pic, chart, tbl, media, dgm). */
export type SlotKind = "obj" | "text" | "pic" | "chart" | "tbl" | "media" | "dgm";
export const SLOT_KINDS: { id: SlotKind; label: string; prompt: string }[] = [
  { id: "obj", label: "Content", prompt: "Click to add content" },
  { id: "text", label: "Text", prompt: "Click to add text" },
  { id: "pic", label: "Picture", prompt: "Click to add a picture" },
  { id: "chart", label: "Chart", prompt: "Click to add a chart" },
  { id: "tbl", label: "Table", prompt: "Click to add a table" },
  { id: "media", label: "Media", prompt: "Click to add video or audio" },
  { id: "dgm", label: "SmartArt", prompt: "Click to add a SmartArt graphic" },
];
export const isSlotKind = (v: unknown): v is SlotKind => SLOT_KINDS.some((k) => k.id === v);

/** PowerPoint's text autofit: shrink text on overflow, or resize the shape to fit its text. */
export type Autofit = "shrink" | "resize";
/**
 * WordArt text effects on a text box's or shape's text: an outline, a
 * gradient fill, a shadow and a glow (PowerPoint's text effects).
 */
export type WordArt = { stroke?: { c: string; w: number }; grad?: Gradient; shadow?: Shadow; glow?: { c: string; r: number } };
/** Text in columns: `cols` columns `colGap` px apart. */
export type TextCols = { cols?: number; colGap?: number };
export type TextEl = ElBase & TextCols & { type: "text"; html: string; valign?: "top" | "middle" | "bottom"; autofit?: Autofit; wa?: WordArt; /** WordArt Transform: a PowerPoint preset text warp (lib/slides/warp.ts) */ warp?: string };
/** Gradient fill. `angle` follows OOXML (degrees clockwise, 0 = left to right); stops at 0..100 %. */
export type GradStop = { pos: number; color: string };
export type Gradient = { kind: "linear" | "radial"; angle: number; stops: GradStop[] };
/** Outer shadow: offset `dist` px in direction `dir` (degrees clockwise from +x), blur radius px, opacity 0..1. */
export type Shadow = { color: string; blur: number; dist: number; dir: number; alpha: number };
/** Picture crop: fraction of the source picture cut from each edge (0..1). */
export type Crop = { l: number; t: number; r: number; b: number };
export const WORDART_PRESETS: { id: string; label: string; wa: WordArt | null }[] = [
  { id: "none", label: "No effects", wa: null },
  { id: "outline", label: "Fill with outline", wa: { stroke: { c: "1F2430", w: 1.5 } } },
  { id: "shadow", label: "Shadow", wa: { shadow: { color: "000000", blur: 4, dist: 3, dir: 45, alpha: 0.45 } } },
  { id: "glow", label: "Glow", wa: { glow: { c: "FFC000", r: 8 } } },
  { id: "gold", label: "Gold gradient", wa: { grad: { kind: "linear", angle: 90, stops: [{ pos: 0, color: "F7D774" }, { pos: 50, color: "C9932B" }, { pos: 100, color: "8A5A12" }] }, stroke: { c: "5C3A06", w: 0.75 } } },
  { id: "ocean", label: "Ocean gradient", wa: { grad: { kind: "linear", angle: 0, stops: [{ pos: 0, color: "0EA5E9" }, { pos: 100, color: "6366F1" }] } } },
  { id: "neon", label: "Neon", wa: { stroke: { c: "FFFFFF", w: 1 }, glow: { c: "22D3EE", r: 10 } } },
];

export const SHADOW_PRESETS: { id: string; label: string; s: Shadow }[] = [
  { id: "br", label: "Offset: bottom right", s: { color: "000000", blur: 5, dist: 4, dir: 45, alpha: 0.4 } },
  { id: "b", label: "Offset: bottom", s: { color: "000000", blur: 5, dist: 4, dir: 90, alpha: 0.4 } },
  { id: "bl", label: "Offset: bottom left", s: { color: "000000", blur: 5, dist: 4, dir: 135, alpha: 0.4 } },
  { id: "soft", label: "Soft, large", s: { color: "000000", blur: 20, dist: 8, dir: 90, alpha: 0.3 } },
];
export type ImageEl = ElBase & {
  type: "image";
  src: string;
  alt?: string;
  crop?: Crop;
  shadow?: Shadow;
  /** a Windows metafile picture (EMF/WMF data URL) kept for export; `src` is its SVG drawing */
  orig?: string;
};
export type ShapeEl = ElBase & TextCols & {
  type: "shape";
  wa?: WordArt;
  /** WordArt Transform: a PowerPoint preset text warp (lib/slides/warp.ts) */
  warp?: string;
  shape: string; // OOXML preset geometry name (rect, roundRect, ellipse, triangle, line, rightArrow, ...) or "freeform"
  /** freeform outline (shape "freeform"): a path in its own w × h box, stretched to the element */
  geom?: { w: number; h: number; d: string };
  fill?: string | null; // hex without '#', null = no fill
  /** fill opacity 0..1 (1 - transparency), solid or gradient; default opaque */
  fillA?: number;
  line?: string | null; // hex without '#', null = no outline
  lineW?: number; // px
  /** outline opacity 0..1 (highlighter ink); default opaque */
  lineA?: number;
  /** gradient fill (wins over `fill`, which keeps a solid fallback colour) */
  grad?: Gradient;
  shadow?: Shadow;
  html?: string;
  valign?: "top" | "middle" | "bottom";
  autofit?: Autofit;
  /** SmartArt: the diagram's data model, kept on its first shape (the group's other shapes are its drawing) */
  dgm?: Diagram;
  /** SmartArt: which items of the data model this shape's paragraphs show, in order */
  dpt?: number[];
  /** ink drawn with the pen or highlighter (written to .pptx as PowerPoint ink) */
  ink?: "pen" | "hl";
};
/**
 * A SmartArt graphic's data model: an outline of items and the layout that
 * draws them. A graphic from another application also keeps the parts it came
 * with (layout definition, quick style and colours, and the data part as
 * read), written back to .pptx so PowerPoint lays it out with its own layout.
 */
export type Diagram = {
  kind: "process" | "cycle" | "hierarchy" | "list" | "pyramid";
  items: { text: string; level: number }[];
  accent?: string;
  src?: { data: string; layout: string; qs?: string; cs?: string; /** model id of each item in `data` */ ids: string[]; /** the items as read (texts are patched in place while the outline keeps this shape) */ items: { text: string; level: number }[] };
};
/** One side of a cell border: colour (hex) and width in px; width 0 = no line. */
export type CellBorder = { c: string; w: number };
/**
 * A table cell. Every row holds one cell per grid column: a merged range keeps
 * its content in the top-left (anchor) cell, which spans `cs` columns and `rs`
 * rows, and the cells it covers are kept as `merged` placeholders.
 */
export type TableCell = {
  /** plain text (search, and the content when there is no `html`) */
  text: string;
  /** rich text: paragraph HTML in the slide text vocabulary */
  html?: string;
  bold?: boolean;
  color?: string;
  fill?: string;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  cs?: number;
  rs?: number;
  merged?: boolean;
  /** per-side borders; a side left out uses the table's border */
  bd?: { t?: CellBorder; r?: CellBorder; b?: CellBorder; l?: CellBorder };
};
export type TableEl = ElBase & {
  type: "table";
  rows: TableCell[][];
  fontSize?: number;
  border?: string;
  /** column widths and row heights (px; scaled to the table's box) */
  colW?: number[];
  rowH?: number[];
  /** the table style and the parts it turns on (PowerPoint's Table Design) */
  tstyle?: TableStyle;
};
/** What one part of a table style gives its cells (resolved hex colours). */
export type TableLookPart = { fill?: string; color?: string; bold?: boolean; line?: string };
export type TableLook = Partial<Record<"whole" | "band1H" | "band2H" | "band1V" | "band2V" | "lastCol" | "firstCol" | "lastRow" | "firstRow", TableLookPart>>;
/**
 * A table style: its id (a built-in PowerPoint style, or a deck's own with its
 * resolved `look`) and the header row, total row, first/last column and
 * banding flags.
 */
export type TableStyle = { id: string; name?: string; look?: TableLook; first?: boolean; last?: boolean; firstCol?: boolean; lastCol?: boolean; bandRow?: boolean; bandCol?: boolean };
/** A trendline fitted to a series (PowerPoint's c:trendline). `order`: polynomial degree; `period`: moving average window. */
export type Trendline = { type: "linear" | "exp" | "log" | "poly" | "power" | "movingAvg"; order?: number; period?: number; eq?: boolean; r2?: boolean; name?: string };
/**
 * A chart series. `type`: its own chart type in a combo chart (bar, line or
 * area; otherwise the chart's); `y2`: plotted against the secondary value axis.
 */
export type ChartSeries = { name: string; values: number[]; color?: string; trend?: Trendline; type?: "bar" | "line" | "area"; y2?: boolean };
/** The chart type a series is drawn as (combo charts mix bar, line and area). */
export const seriesType = (el: Pick<ChartEl, "chartType">, s: ChartSeries): ChartType =>
  (el.chartType === "bar" || el.chartType === "line" || el.chartType === "area") && s.type && ["bar", "line", "area"].includes(s.type) ? s.type : el.chartType;
/** Is this a combo chart (series of more than one type, or a secondary axis)? */
export const isCombo = (el: Pick<ChartEl, "chartType" | "series">) => el.series.some((s) => seriesType(el, s) !== el.chartType || !!s.y2);
/** Value-axis formatting: bounds, major/minor units, Excel-style number format, gridlines and a title. */
export type ChartAxis = { min?: number; max?: number; major?: number; minor?: number; fmt?: string; grid?: boolean; minorGrid?: boolean; title?: string };
export type ChartType = "bar" | "line" | "area" | "pie" | "doughnut" | "scatter";
export const CHART_TYPES: { id: ChartType; label: string }[] = [
  { id: "bar", label: "Column / bar" },
  { id: "line", label: "Line" },
  { id: "area", label: "Area" },
  { id: "pie", label: "Pie" },
  { id: "doughnut", label: "Doughnut" },
  { id: "scatter", label: "Scatter (X values in the first column)" },
];
export const CHART_COLORS = ["4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47"];
export type ChartEl = ElBase & {
  type: "chart";
  chartType: ChartType;
  /** bar charts: vertical columns (default) or horizontal bars */
  barDir?: "col" | "bar";
  /** bar, line and area: stack the series */
  stacked?: boolean;
  /** stacked to 100%: each category's values as shares of its total */
  percent?: boolean;
  /** show each value on the chart */
  dataLabels?: boolean;
  /** legend position (default bottom) */
  legendPos?: "b" | "t" | "r" | "l";
  title?: string;
  categories: string[];
  series: ChartSeries[];
  showLegend?: boolean;
  /** the value (Y) axis; major gridlines show unless grid is false */
  valAx?: ChartAxis;
  /** the category (X) axis: title and gridlines; for scatter charts also bounds, units and format */
  catAx?: ChartAxis;
};

/**
 * Audio or video. `src` is the uploaded file (/api/docs/<doc>/media/<id>; a
 * data: URL only while an import is being uploaded); `poster` is a picture
 * shown until it plays. In the slide show it plays when its slide appears
 * with `autoplay`, else on click; `loop` repeats it.
 */
/** `narration`: recorded with Record Slide Show (replaced by a new recording, and the sound track of a video export). */
export type MediaEl = ElBase & { type: "media"; kind: "video" | "audio"; src: string; mime?: string; poster?: string; name?: string; autoplay?: boolean; loop?: boolean; narration?: boolean };

/** An equation: LaTeX (the subset in math.ts), drawn as MathML and saved to .pptx as Office Math. `size` in pt. */
export type MathEl = ElBase & { type: "math"; latex: string; size?: number; color?: string };

/**
 * Zoom (PowerPoint's slide and section zoom): a live thumbnail of another
 * slide. In the slide show a click zooms into it; a section zoom presents the
 * section that slide starts. With `ret` the show comes back to the zoom slide
 * afterwards. A summary zoom is a slide of section zooms.
 */
export type ZoomEl = ElBase & { type: "zoom"; kind: "slide" | "section"; target: string; ret?: boolean; border?: boolean };

/**
 * A 3D model (glTF binary): `src` is its URL in the document's media store (a
 * data: URL only while an import is being uploaded); `rx`/`ry`/`rz` turn it
 * (degrees: tilt, turn, roll); `poster` is a PNG of the current view, used by
 * exports and while the model loads.
 */
export type Model3dEl = ElBase & { type: "model3d"; src: string; name?: string; rx?: number; ry?: number; rz?: number; poster?: string };

export type SlideElement = TextEl | ImageEl | ShapeEl | TableEl | ChartEl | MediaEl | MathEl | ZoomEl | Model3dEl;
/** An element about to be inserted (id/z are assigned on insert). */
export type NewElement = SlideElement extends infer T ? (T extends SlideElement ? Omit<T, "id" | "z"> & { id?: string } : never) : never;

export type Slide = {
  id: string;
  /** the title as plain text (lines separated by "\n"); `thtml` its formatted runs, when any differ */
  title: string;
  thtml?: string;
  body: string;
  notes: string;
  layout: SlideLayout;
  bg: string; // hex without '#', "" = theme background
  bgImg: string; // data URL / URL, "" = none
  /** gradient background (wins over bg) */
  bgGrad?: Gradient;
  tbox?: Box; // title placeholder override
  bbox?: Box; // body placeholder override
  tstyle?: TitleStyle;
  bstyle?: BodyStyle;
  bodyValign?: "top" | "middle" | "bottom";
  /** the content placeholder shrinks overflowing text unless this is "none" */
  bodyFit?: "none";
  hidden?: boolean;
  trans?: Transition;
  tanim?: Anim; // title placeholder animation
  banim?: Anim; // body placeholder animation
  tfx?: Anim[]; // further title effects
  bfx?: Anim[]; // further body effects
  elements: SlideElement[];
  /** starts a new section with this name (PowerPoint sections) */
  sec?: string;
  /** custom layout id (masters key "c:<id>"); `layout` is still its placeholder arrangement */
  clayout?: string;
  /** don't draw the master/layout objects (PowerPoint's "Hide background graphics") */
  hideUnder?: boolean;
  /** a custom layout's or an added master's name (layout maps only) */
  lname?: string;
  /** a custom layout's slide master, when it is an added one ("m:<pm>"; layout maps only) */
  pm?: string;
  // ---- resolved at render time (never stored) ----
  /** slide master + layout objects drawn behind the slide */
  under?: SlideElement[];
  /** derived: the layout's placeholder slots nothing on the slide fills yet (prompts in the editor) */
  slots?: SlideElement[];
  /** 1-based slide number */
  num?: number;
};

export const DEFAULT_W = 1280;
export const DEFAULT_H = 720;
export const PX_PER_IN = 96;
export const EMU_PER_PX = 9525;

export const LAYOUTS: { id: SlideLayout; label: string }[] = [
  { id: "content", label: "Title and content" },
  { id: "title", label: "Title slide" },
  { id: "titleOnly", label: "Title only" },
  { id: "blank", label: "Blank" },
];

export const SLIDE_SIZES: { id: string; label: string; w: number; h: number }[] = [
  { id: "16:9", label: "Widescreen (16:9)", w: 1280, h: 720 },
  { id: "4:3", label: "Standard (4:3)", w: 960, h: 720 },
  { id: "16:10", label: "16:10", w: 1152, h: 720 },
  { id: "A4", label: "A4 paper", w: 1040, h: 720 },
];

/**
 * How boxes move when the slide size changes: "scale" stretches each axis,
 * "fit" scales evenly (the smaller factor) and centres, "none" keeps them.
 */
export function resizeTransform(W: number, H: number, w: number, h: number, mode: "scale" | "fit" | "none"): (b: Box) => Box {
  const r = (n: number) => Math.round(n * 100) / 100;
  if (mode === "none") return (b) => ({ ...b });
  if (mode === "scale") {
    const sx = w / W, sy = h / H;
    return (b) => ({ x: r(b.x * sx), y: r(b.y * sy), w: r(b.w * sx), h: r(b.h * sy) });
  }
  const k = Math.min(w / W, h / H);
  const ox = (w - W * k) / 2, oy = (h - H * k) / 2;
  return (b) => ({ x: r(ox + b.x * k), y: r(oy + b.y * k), w: r(b.w * k), h: r(b.h * k) });
}

/** Placeholder boxes for a layout on a W×H slide (overridable per slide). */
export function layoutBoxes(layout: SlideLayout, W: number, H: number): { title?: Box; body?: Box } {
  const r = (x: number, y: number, w: number, h: number): Box => ({ x: x * W, y: y * H, w: w * W, h: h * H });
  switch (layout) {
    case "title":
      return { title: r(0.08, 0.27, 0.84, 0.24), body: r(0.12, 0.54, 0.76, 0.18) };
    case "titleOnly":
      return { title: r(0.047, 0.06, 0.906, 0.15) };
    case "blank":
      return {};
    default:
      return { title: r(0.047, 0.06, 0.906, 0.15), body: r(0.064, 0.24, 0.872, 0.68) };
  }
}

export function titleBox(s: Slide, W: number, H: number): Box | undefined {
  if (s.layout === "blank") return undefined;
  return s.tbox || layoutBoxes(s.layout, W, H).title;
}
export function bodyBox(s: Slide, W: number, H: number): Box | undefined {
  if (s.layout === "blank" || s.layout === "titleOnly") return undefined;
  return s.bbox || layoutBoxes(s.layout, W, H).body;
}

/** Default title size (pt) per layout. */
export const titlePt = (s: Slide) => s.tstyle?.size ?? (s.layout === "title" ? 44 : 32);
export const BODY_PT = 18;
export const bodyPt = (s: Slide) => s.bstyle?.size ?? BODY_PT;

// ---- slide master and layouts ----
//
// Like PowerPoint's Slide Master view: the master and each layout are stored
// as slide-shaped maps (Y.Map "layouts" keyed by MasterKey) whose placeholder
// boxes, title/body text style, background and objects are inherited by the
// slides. Precedence: slide > layout > master > built-in defaults.

/**
 * "master", a built-in layout, a custom layout ("c:<id>") or an added slide
 * master ("m:<id>"). An added master owns the custom layouts whose `pm` is its
 * id; the built-in layouts and the other custom layouts follow "master".
 */
export type MasterKey = "master" | SlideLayout | `c:${string}` | `m:${string}`;
export const MASTER_KEYS: { id: MasterKey; label: string }[] = [{ id: "master", label: "Slide master" }, ...LAYOUTS];
export type Masters = Partial<Record<MasterKey, Slide>>;
export const isCustomKey = (k: string): k is `c:${string}` => /^c:[\w-]{1,40}$/.test(k);
export const isAddedMaster = (k: string): k is `m:${string}` => /^m:[\w-]{1,40}$/.test(k);
/** A slide master (the first or an added one), not a layout. */
export const isMasterKey = (k: string): boolean => k === "master" || isAddedMaster(k);

/** The slide master a layout follows. */
export function masterKeyOf(k: MasterKey, masters?: Masters): MasterKey {
  if (isMasterKey(k)) return k;
  const pm = isCustomKey(k) ? masters?.[k]?.pm : undefined;
  return pm && masters?.[`m:${pm}`] ? `m:${pm}` : "master";
}
export const masterFor = (k: MasterKey, masters?: Masters): Slide | undefined => masters?.[masterKeyOf(k, masters)];

/** The layout that a master/layout map is shown and edited as (custom layouts keep their base layout). */
export const masterLayout = (k: MasterKey, masters?: Masters): SlideLayout => (k === "master" || isAddedMaster(k) ? "content" : isCustomKey(k) ? masters?.[k]?.layout || "content" : k);

export type LayoutKeyInfo = { id: MasterKey; label: string; base: SlideLayout; master?: boolean; /** an added master's name, on its layouts */ group?: string };
/**
 * For the Slide Master rail and layout pickers: the slide master, built-in
 * layouts and its custom layouts by name, then each added master (by name)
 * followed by its layouts. `master` marks the masters.
 */
export function layoutKeys(masters: Masters | undefined): LayoutKeyInfo[] {
  const customOf = (pm: string | undefined) =>
    Object.entries(masters || {})
      .filter(([k, v]) => isCustomKey(k) && v && (masterKeyOf(k as MasterKey, masters) === (pm ? `m:${pm}` : "master")))
      .map(([k, v]) => ({ id: k as MasterKey, label: v!.lname || "Custom layout", base: v!.layout, ...(pm ? { group: masters?.[`m:${pm}`]?.lname || "Slide master" } : {}) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  const added = Object.entries(masters || {})
    .filter(([k, v]) => isAddedMaster(k) && v)
    .map(([k, v]) => ({ id: k as MasterKey, label: v!.lname || "Slide master", base: "content" as SlideLayout, master: true }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [
    ...MASTER_KEYS.map((k) => ({ ...k, base: masterLayout(k.id), ...(k.id === "master" ? { master: true } : {}) })),
    ...customOf(undefined),
    ...added.flatMap((m) => [m, ...customOf(m.id.slice(2))]),
  ];
}

/** The layout a slide uses: its custom layout when that still exists, else its built-in one. */
export const layoutKeyOf = (s: Slide, masters?: Masters): MasterKey => (s.clayout && masters?.[`c:${s.clayout}`] ? `c:${s.clayout}` : s.layout);

const defined = <T extends object>(o: T | undefined): Partial<T> =>
  Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== "")) as Partial<T>;

/**
 * A slide with what it inherits from its layout and the master filled in:
 * placeholder boxes, title/body style, background and the objects drawn
 * behind it. The master's boxes and title size apply to the layouts that
 * share its geometry (everything but the title slide).
 */
export function applyMaster(s: Slide, masters: Masters | undefined, num?: number): Slide {
  const out: Slide = num ? { ...s, num } : { ...s };
  if (!masters) return out;
  const lk = layoutKeyOf(s, masters);
  const L = masters[lk];
  const M = masterFor(lk, masters);
  const fromM = s.layout !== "title";
  if (!out.tbox) out.tbox = L?.tbox || (fromM ? M?.tbox : undefined);
  if (!out.bbox) out.bbox = L?.bbox || (fromM ? M?.bbox : undefined);
  const mt = defined(M?.tstyle);
  if (!fromM) delete mt.size;
  const ts = { ...mt, ...defined(L?.tstyle), ...defined(s.tstyle) };
  if (Object.keys(ts).length) out.tstyle = ts;
  const bs: BodyStyle = { ...defined(M?.bstyle), ...defined(L?.bstyle), ...defined(s.bstyle) };
  const lv = mergeLevels(M?.bstyle, L?.bstyle, s.bstyle);
  if (lv) bs.lv = lv;
  else delete bs.lv;
  if (Object.keys(bs).length) out.bstyle = bs;
  if (!s.bg && !s.bgImg && !s.bgGrad) {
    const src = L?.bg || L?.bgImg || L?.bgGrad ? L : M;
    out.bg = src?.bg || "";
    out.bgImg = src?.bgImg || "";
    if (src?.bgGrad) out.bgGrad = src.bgGrad;
  }
  // hideUnder on a layout hides the master's objects; on a slide, all inherited objects
  // a layout's placeholder slots are prompts, not drawn objects
  const under = s.hideUnder ? [] : [...(L?.hideUnder ? [] : M?.elements || []).filter((e) => !e.slot).map((e) => ({ ...e, z: e.z - 20000 })), ...(L?.elements || []).filter((e) => !e.slot).map((e) => ({ ...e, z: e.z - 15000 }))];
  if (under.length) out.under = under;
  const filled = new Set(s.elements.map((e) => e.ph).filter(Boolean));
  const slots = (L?.elements || []).filter((e) => e.slot && !filled.has(e.id));
  if (slots.length) out.slots = slots;
  return out;
}

/** Every slide resolved against the masters and numbered. */
export function prepareSlides(slides: Slide[], masters: Masters | undefined): Slide[] {
  return slides.map((s, i) => applyMaster(s, masters, i + 1));
}

// ---- headers & footers ----
/**
 * Date, footer and slide number on every slide. The date is fixed text
 * (`date`) or today's date in a format that updates (`dateAuto`, an OOXML
 * date field type); `boxes` are the positions set on the slide master.
 */
export type HeaderFooter = { num?: boolean; footer?: string; date?: string; dateAuto?: string; skipTitle?: boolean; boxes?: FooterBoxes };
export type FooterBoxes = { date?: Box; footer?: Box; num?: Box };
/** Date formats that update by themselves (PowerPoint's datetime fields, in the viewer's language). */
export const DATE_FORMATS: { id: string; label: string; opts: Intl.DateTimeFormatOptions }[] = [
  { id: "datetime1", label: "Short date", opts: { dateStyle: "short" } },
  { id: "datetime4", label: "Long date", opts: { dateStyle: "long" } },
  { id: "datetime2", label: "Day and date", opts: { dateStyle: "full" } },
  { id: "datetime3", label: "Medium date", opts: { dateStyle: "medium" } },
  { id: "datetime10", label: "Time", opts: { timeStyle: "short" } },
  { id: "datetime8", label: "Date and time", opts: { dateStyle: "short", timeStyle: "short" } },
];
/** Today's date (or `d`) in an updating date format. */
export function formatDate(fmt: string, d = new Date(), locale?: string): string {
  const f = DATE_FORMATS.find((x) => x.id === fmt) || DATE_FORMATS[0];
  try {
    return new Intl.DateTimeFormat(locale, f.opts).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}
/** Footer boxes (PowerPoint's default positions, or the master's) on a W×H slide. */
export function footerBoxes(W: number, H: number, hf?: HeaderFooter): { date: Box; footer: Box; num: Box } {
  const y = H * 0.927, h = H * 0.053;
  const b = hf?.boxes;
  return { date: b?.date || { x: W * 0.05, y, w: W * 0.225, h }, footer: b?.footer || { x: W * 0.333, y, w: W * 0.333, h }, num: b?.num || { x: W * 0.725, y, w: W * 0.225, h } };
}
/** What the footer shows on a slide (nothing on title slides when skipTitle). */
export function footerFor(s: Slide, hf: HeaderFooter | undefined, now?: Date): { date?: string; footer?: string; num?: string } | null {
  if (!hf || (hf.skipTitle && s.layout === "title")) return null;
  const r = { date: hf.dateAuto ? formatDate(hf.dateAuto, now) : hf.date || undefined, footer: hf.footer || undefined, num: hf.num && s.num ? String(s.num) : undefined };
  return r.date || r.footer || r.num ? r : null;
}
const okBox = (b: unknown): b is Box => !!b && typeof b === "object" && ["x", "y", "w", "h"].every((k) => Number.isFinite((b as Record<string, unknown>)[k]));
/** Header & footer settings from a document or a file, checked. */
export function cleanHf(v: unknown): HeaderFooter | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const hf: HeaderFooter = {};
  if (o.num === true) hf.num = true;
  if (typeof o.footer === "string" && o.footer) hf.footer = o.footer.slice(0, 300);
  if (typeof o.date === "string" && o.date) hf.date = o.date.slice(0, 100);
  if (typeof o.dateAuto === "string" && DATE_FORMATS.some((f) => f.id === o.dateAuto)) hf.dateAuto = o.dateAuto;
  if (o.skipTitle === true) hf.skipTitle = true;
  const b = o.boxes as Record<string, unknown> | undefined;
  if (b && typeof b === "object") {
    const boxes: FooterBoxes = {};
    for (const k of ["date", "footer", "num"] as const) if (okBox(b[k])) { const x = b[k] as Box; boxes[k] = { x: x.x, y: x.y, w: x.w, h: x.h }; }
    if (Object.keys(boxes).length) hf.boxes = boxes;
  }
  return hf.num || hf.footer || hf.date || hf.dateAuto || hf.boxes ? hf : undefined;
}

// ---- sections ----
export type Section = { name: string; start: number; end: number }; // [start, end)
export function sectionsOf(slides: Slide[]): Section[] {
  const out: Section[] = [];
  slides.forEach((s, i) => {
    if (s.sec === undefined) return;
    if (out.length) out[out.length - 1].end = i;
    else if (i > 0) out.push({ name: "Default Section", start: 0, end: i });
    out.push({ name: s.sec, start: i, end: slides.length });
  });
  return out;
}

let counter = 0;
export const genId = (p = "s") => `${p}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function parseJson<T>(v: unknown): T | undefined {
  if (typeof v !== "string" || !v) return undefined;
  try {
    return JSON.parse(v) as T;
  } catch {
    return undefined;
  }
}

/** Minimal read interface over a Y.Map<string> (keeps this file free of yjs). */
export type MapLike = { get(k: string): unknown; forEach(f: (v: unknown, k: string) => void): void };

export function readSlide(m: MapLike): Slide {
  const elements: SlideElement[] = [];
  m.forEach((v, k) => {
    if (!k.startsWith("el:")) return;
    const e = parseJson<SlideElement>(v);
    if (e && e.type) elements.push({ ...e, id: k.slice(3) });
  });
  elements.sort((a, b) => (a.z || 0) - (b.z || 0));
  const layout = (m.get("layout") as SlideLayout) || "content";
  return {
    id: (m.get("id") as string) || "",
    title: (m.get("title") as string) || "",
    ...(typeof m.get("thtml") === "string" && m.get("thtml") ? { thtml: m.get("thtml") as string } : {}),
    body: (m.get("body") as string) || "",
    notes: (m.get("notes") as string) || "",
    layout: LAYOUTS.some((l) => l.id === layout) ? layout : "content",
    bg: (m.get("bg") as string) || "",
    bgImg: (m.get("bgImg") as string) || "",
    ...(typeof m.get("bgGrad") === "string" ? { bgGrad: parseJson<Gradient>(m.get("bgGrad")) } : {}),
    tbox: parseJson<Box>(m.get("tbox")),
    bbox: parseJson<Box>(m.get("bbox")),
    tstyle: parseJson<TitleStyle>(m.get("tstyle")),
    bstyle: parseJson<BodyStyle>(m.get("bstyle")),
    bodyValign: (m.get("bodyValign") as Slide["bodyValign"]) || undefined,
    bodyFit: m.get("bodyFit") === "none" ? "none" : undefined,
    hidden: m.get("hidden") === "1",
    trans: parseJson<Transition>(m.get("trans")),
    tanim: parseJson<Anim>(m.get("tanim")),
    banim: parseJson<Anim>(m.get("banim")),
    ...(typeof m.get("tfx") === "string" ? { tfx: parseJson<Anim[]>(m.get("tfx")) } : {}),
    ...(typeof m.get("bfx") === "string" ? { bfx: parseJson<Anim[]>(m.get("bfx")) } : {}),
    elements,
    ...(typeof m.get("sec") === "string" ? { sec: m.get("sec") as string } : {}),
    ...(typeof m.get("clayout") === "string" && m.get("clayout") ? { clayout: m.get("clayout") as string } : {}),
    ...(m.get("hideUnder") === "1" ? { hideUnder: true } : {}),
    ...(typeof m.get("lname") === "string" ? { lname: m.get("lname") as string } : {}),
    ...(typeof m.get("pm") === "string" && m.get("pm") ? { pm: m.get("pm") as string } : {}),
  };
}

/** Flatten a slide into the string fields stored in its Y.Map. */
export function slideFields(s: Partial<Slide>): Record<string, string> {
  const out: Record<string, string> = {};
  if (s.id !== undefined) out.id = s.id;
  if (s.title !== undefined) out.title = s.title;
  if (s.thtml) out.thtml = s.thtml;
  if (s.body !== undefined) out.body = s.body;
  if (s.notes !== undefined) out.notes = s.notes;
  if (s.layout !== undefined) out.layout = s.layout;
  if (s.bg !== undefined) out.bg = s.bg;
  if (s.bgImg !== undefined) out.bgImg = s.bgImg;
  if (s.bgGrad) out.bgGrad = JSON.stringify(s.bgGrad);
  if (s.tbox) out.tbox = JSON.stringify(s.tbox);
  if (s.bbox) out.bbox = JSON.stringify(s.bbox);
  if (s.tstyle) out.tstyle = JSON.stringify(s.tstyle);
  if (s.bstyle) out.bstyle = JSON.stringify(s.bstyle);
  if (s.sec !== undefined) out.sec = s.sec;
  if (s.clayout) out.clayout = s.clayout;
  if (s.hideUnder) out.hideUnder = "1";
  if (s.lname !== undefined) out.lname = s.lname;
  if (s.pm) out.pm = s.pm;
  if (s.bodyValign) out.bodyValign = s.bodyValign;
  if (s.bodyFit) out.bodyFit = s.bodyFit;
  if (s.hidden) out.hidden = "1";
  if (s.trans) out.trans = JSON.stringify(s.trans);
  if (s.tanim) out.tanim = JSON.stringify(s.tanim);
  if (s.banim) out.banim = JSON.stringify(s.banim);
  if (s.tfx?.length) out.tfx = JSON.stringify(s.tfx);
  if (s.bfx?.length) out.bfx = JSON.stringify(s.bfx);
  for (const e of s.elements || []) out[`el:${e.id}`] = elementJson(e);
  return out;
}

export function elementJson(e: SlideElement): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, ...rest } = e;
  return JSON.stringify(rest);
}

export function blankSlide(layout: SlideLayout = "content"): Slide {
  return { id: genId(), title: "", body: "", notes: "", layout, bg: "", bgImg: "", elements: [] };
}

/** Plain text of an HTML fragment (for thumbnails / outline). */
/** A title's plain text from its HTML: paragraphs and line breaks become "\n". */
export function titleText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
/** Whether title HTML carries formatting of its own (bold, colour, a link...), beyond plain paragraphs. */
export function richTitle(html: string): boolean {
  return /<(strong|b|em|i|u|s|sub|sup|a|mark|code)\b|<span\b[^>]*style=/i.test(html);
}
/** The title as HTML: its formatted runs when they still match the text, else the plain text. */
export function titleHtml(s: Pick<Slide, "title" | "thtml">): string {
  if (s.thtml && titleText(s.thtml) === s.title) return s.thtml;
  return s.title ? s.title.split("\n").map((l) => `<p>${escapeHtml(l)}</p>`).join("") : "";
}

export function htmlText(html: string): string {
  return html
    .replace(/<\/(p|li|h\d)>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Old decks stored body as plain "one bullet per line" text. Render those as a
// bullet list the first time they're opened in the rich editor.
export function toHtml(body: string): string {
  if (!body) return "";
  if (/^\s*</.test(body)) return body; // already HTML
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return "";
  return `<ul>${lines.map((l) => `<li><p>${escapeHtml(l)}</p></li>`).join("")}</ul>`;
}

// ---- animation sequence ----

/** Number of paragraphs in body HTML (each <p>, including those inside list items). */
export function paragraphCount(html: string): number {
  return (toHtml(html).match(/<p[\s>]/g) || []).length;
}

/** An animated target: element id, "title", "body", or "body#<paragraph>". */
export type AnimItem = { key: string; anim: Anim; at: number };
/** Click steps; step 0 has `auto` when it plays without a click (first effect is with/after previous). */
export type AnimStep = { auto: boolean; items: AnimItem[] };

/** All effects of one target, in the order stored (first = `anim`/`tanim`/`banim`). */
export function effectsOf(s: Slide, key: string): Anim[] {
  if (key === "title") return [s.tanim, ...(s.tfx || [])].filter(Boolean) as Anim[];
  if (key === "body") return [s.banim, ...(s.bfx || [])].filter(Boolean) as Anim[];
  const e = s.elements.find((x) => x.id === key);
  return e ? ([e.anim, ...(e.fx || [])].filter(Boolean) as Anim[]) : [];
}

/** Every effect on the slide in sequence order; `idx` is the effect's position in effectsOf(key). */
export function animTargets(s: Slide): { key: string; anim: Anim; idx: number }[] {
  const t: { key: string; anim: Anim; idx: number }[] = [];
  const keys: string[] = [];
  if (s.layout !== "blank") keys.push("title");
  if (s.layout !== "blank" && s.layout !== "titleOnly") keys.push("body");
  for (const e of s.elements) keys.push(e.id);
  for (const key of keys) effectsOf(s, key).forEach((anim, idx) => t.push({ key, anim, idx }));
  return t.sort((a, b) => a.anim.order - b.anim.order);
}

/** The click steps of a list of effects (sequence order), as the slide show plays them. */
function stepsOf(s: Slide, list: { key: string; anim: Anim; idx: number }[], auto: boolean): AnimStep[] {
  const items: { key: string; anim: Anim }[] = [];
  for (const t of list) {
    const k = animKind(t.anim);
    if (t.key === "body" && t.anim.byPara && (k === "entr" || k === "exit")) {
      const n = paragraphCount(s.body);
      for (let p = 0; p < n; p++) items.push({ key: `body#${p}`, anim: p === 0 ? t.anim : { ...t.anim, start: t.anim.start === "with" ? "with" : "click", delay: 0 } });
    } else items.push(t);
  }
  const steps: AnimStep[] = [];
  let groupStart = 0; // start time of the current "with" group
  let end = 0; // end time of the latest effect in the step
  for (const it of items) {
    const d = it.anim.effect === "appear" ? 0 : it.anim.dur;
    if (!steps.length || it.anim.start === "click") {
      steps.push({ auto: auto && !steps.length && it.anim.start !== "click", items: [] });
      groupStart = 0;
      end = 0;
    } else if (it.anim.start === "after") groupStart = end;
    const at = groupStart + it.anim.delay;
    steps[steps.length - 1].items.push({ key: it.key, anim: it.anim, at });
    end = Math.max(end, at + d);
  }
  return steps;
}

/** A trigger that still exists on the slide (an element, or the title/body placeholder). */
export function triggerOk(s: Slide, key: string | undefined): key is string {
  if (!key) return false;
  if (key === "title") return s.layout !== "blank";
  if (key === "body") return s.layout !== "blank" && s.layout !== "titleOnly";
  return s.elements.some((e) => e.id === key);
}

/** The slide's main click sequence (effects without a trigger). */
export function buildSteps(s: Slide): AnimStep[] {
  return stepsOf(s, animTargets(s).filter((t) => !triggerOk(s, t.anim.trigger)), true);
}

/** Each trigger's own sequence: one click on the trigger plays its next step. */
export function triggerSteps(s: Slide): Map<string, AnimStep[]> {
  const by = new Map<string, { key: string; anim: Anim; idx: number }[]>();
  for (const t of animTargets(s)) if (triggerOk(s, t.anim.trigger)) by.set(t.anim.trigger, [...(by.get(t.anim.trigger) || []), t]);
  return new Map([...by].map(([k, list]) => [k, stepsOf(s, list, false)]));
}

/** Where and how big an object is after the effects played so far (slide fractions / factor). */
export type AnimRest = { dx: number; dy: number; scale: number };
/** What the slide show has revealed: hidden targets, effects playing now, and moved/grown objects. */
export type AnimState = { hidden: Set<string>; play: Map<string, AnimItem[]>; rest: Map<string, AnimRest> };

/**
 * The slide show state after `shown` click steps. With `fwd`, the last of
 * them is playing now (its effects animate from the state before it).
 */
export function animStateAt(steps: AnimStep[], shown: number, fwd: boolean, triggered: { steps: AnimStep[]; shown: number; play?: boolean }[] = []): AnimState {
  const hidden = new Set<string>();
  const play = new Map<string, AnimItem[]>();
  const rest = new Map<string, AnimRest>();
  // a target whose first effect (main or triggered sequence) is an entrance starts hidden
  const first = new Map<string, Anim>();
  for (const st of [...steps, ...triggered.flatMap((t) => t.steps)])
    for (const it of st.items) {
      const f = first.get(it.key);
      if (!f || it.anim.order < f.order) first.set(it.key, it.anim);
    }
  for (const [k, a] of first) if (animKind(a) === "entr") hidden.add(k);
  const apply = (it: AnimItem) => {
    const k = animKind(it.anim);
    if (k === "entr") hidden.delete(it.key);
    else if (k === "exit") hidden.add(it.key);
    else if (k === "path" || (k === "emph" && it.anim.effect === "grow")) {
      const r = rest.get(it.key) || { dx: 0, dy: 0, scale: 1 };
      if (k === "path") {
        const e = pathEnd(it.anim.path || "");
        rest.set(it.key, { ...r, dx: r.dx + e.x, dy: r.dy + e.y });
      } else rest.set(it.key, { ...r, scale: r.scale * (it.anim.amount || 1.5) });
    }
  };
  const playStep = (st: AnimStep | undefined) => {
    for (const it of st?.items || []) {
      play.set(it.key, [...(play.get(it.key) || []), it]);
      if (animKind(it.anim) === "entr") hidden.delete(it.key);
    }
  };
  const done = fwd && shown > 0 ? shown - 1 : shown;
  for (let k = 0; k < Math.min(done, steps.length); k++) steps[k].items.forEach(apply);
  for (const t of triggered) {
    const d = t.play && t.shown > 0 ? t.shown - 1 : t.shown;
    for (let k = 0; k < Math.min(d, t.steps.length); k++) t.steps[k].items.forEach(apply);
  }
  if (fwd && shown > 0) playStep(steps[shown - 1]);
  for (const t of triggered) if (t.play && t.shown > 0) playStep(t.steps[t.shown - 1]);
  return { hidden, play, rest };
}
