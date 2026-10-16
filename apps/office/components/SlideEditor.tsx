"use client";

// SynergyDocs presentations — collaborative, de-branded slide editor with rich
// text, free-floating text boxes, pictures, shapes and tables, PowerPoint
// (.pptx) import and export, themes/layouts, and Slide Show / Presenter View.
//  - The deck lives in a Yjs document (Y.Array of Y.Maps) synced over Hocuspocus,
//    so add/remove/reorder and per-slide edits merge across editors and persist.
//    Deck settings (size, theme, font) live in the "meta" map.
//  - Each slide's body is rich HTML edited with a TipTap editor rendered *on* the
//    slide (WYSIWYG). Other objects are stored per element under `el:<id>` keys
//    of the slide map (see lib/slides/model.ts), so edits to different boxes
//    merge; an element itself is last-writer-wins, like every other field.
//  - The slide is laid out at its real size (96 px per inch) and scaled to fit,
//    so the editor, thumbnails, slideshow and the exported file agree.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import { FontSize } from "./tiptap-ext";
import { ParagraphSpacing, Subscript, Superscript } from "./slides/text-ext";
import { safeHref } from "@/lib/slides/text";
import { countInHtml, countInText, findRegex, replaceInElement, replaceInHtml, replaceInText, type FindHit } from "@/lib/slides/find";
import FindReplace from "./slides/FindReplace";
import CommentsPane from "./slides/CommentsPane";
import { anchorFor, decodeAnchor, encodeAnchor, pptxComments, threadsBySlide, type Anchor, type CommentThread } from "@/lib/slides/comments";
import type { ImportedComment } from "@/lib/slides/pptx-import";
import AppTitleBar from "./AppTitleBar";
import { type Menu, type MenuItem } from "./MenuBar";
import ElementFrame from "./slides/ElementFrame";
import SlideToolbar, { type ToolbarActions } from "./slides/SlideToolbar";
import { TableEditor } from "./slides/TableEditor";
import { TableTools } from "./slides/TableTools";
import { insertRow, type CellRect } from "@/lib/slides/table";
import { DEFAULT_TABLE_STYLE } from "@/lib/slides/table-style";
import { scaleElementFonts, scaleSlideFonts } from "@/lib/slides/resize";
import { IconPicker, MathDialog, DiagramDialog } from "./slides/InsertDialogs";
import { iconGeom, iconStroke } from "@/lib/slides/icons";
import { buildDiagram, outlineText, parseOutline, syncShapeText, type DiagramKind } from "@/lib/slides/smartart";
import { paintFormat, paintSelection, pickFormat, selectionFmt, type ObjFmt } from "@/lib/slides/painter";
import { customShowSlides, fmtTime, type CustomShow, type ShowSettings } from "@/lib/slides/show";
import { CustomShowsDialog, SetUpShowDialog } from "./slides/ShowDialogs";
import { polygonToFreeform, strokeToFreeform } from "@/lib/slides/freeform";
import { geomToPath, linesToPath, pathOrigin, pathSvgD, pathToGeom, scribbleToPath } from "@/lib/slides/motion";
import AnimPanel from "./slides/AnimPanel";
import MultiSelectionBar from "./slides/MultiSelectionBar";
import Slideshow, { type ShowResult } from "./slides/Slideshow";
import { DeckSlides, ElementContent, FooterLayer, ScaledSlide, ShrinkFit, SlideBackground, TEXT_PAD, UnderLayer, bodyCss, justify, titleCss, type DeckLook } from "./slides/SlideView";
import {
  CHART_TYPES,
  DEFAULT_H,
  DEFAULT_W,
  LAYOUTS,
  isCustomKey,
  isAddedMaster,
  isMasterKey,
  masterFor,
  masterKeyOf,
  layoutKeys,
  layoutKeyOf,
  SLIDE_SIZES,
  applyMaster,
  bodyBox,
  masterLayout,
  prepareSlides,
  sectionsOf,
  elementJson,
  genId,
  htmlText,
  animTargets,
  effectsOf,
  buildSteps,
  animStateAt,
  type AnimState,
  readSlide,
  resizeTransform,
  slideFields,
  titleBox,
  toHtml,
  type Anim,
  type Gradient,
  type BodyStyle,
  type Box,
  type HeaderFooter,
  type MasterKey,
  type Masters,
  type TitleStyle,
  type Transition,
  type ChartEl,
  type MathEl,
  type ZoomEl,
  type Model3dEl,
  type ShapeEl,
  type Slide,
  type NewElement,
  type SlideElement,
  type SlideLayout,
  type TableCell,
  type AnimSound,
  animKind,
  footerBoxes,
  formatDate,
  pathEnd,
  titleText,
  richTitle,
  titleHtml,
  SLOT_KINDS,
  type SlotKind,
} from "@/lib/slides/model";
import { THEMES, effectiveTheme, themeColors, type ThemeColors } from "@/lib/slides/themes";
import { HeaderFooterDialog, MasterPanel, SlideSizeDialog, ThemeDialog, type ResizeMode } from "./slides/DeckDialogs";
import { isLineShape, shapePath } from "@/lib/slides/shapes";
import { normalizePath } from "@/lib/slides/svgpath";
import { PointEditor } from "./slides/PointEditor";
import { CanvasPlayer } from "./slides/MediaView";
import { ModelTurnHandle, modelLoads, modelPoster } from "./slides/ModelView";
import { GLB_MIME, glbInfo, gltfToGlb, isGlb, normDeg, type Turn } from "@/lib/slides/model3d";
import { alignedPositions, boundsOf, distributedPositions, dragBounds, groupPath, groupedPatch, resizedBoxes, ungroupedPatch, groupZ, inMarquee, withGroups, type Align, type Axis } from "@/lib/slides/selection";
import { downloadPptx, buildPptx, htmlToPptxRuns } from "@/lib/slides/pptx-export";
import type { PdfOptions } from "@/lib/slides/pdf-export";
import { fitScales, renderOffscreen, seekAnimations } from "./slides/offscreen";
import { ZoomDialog, type ZoomMode } from "./slides/ZoomDialog";
import { VideoDialog, type VideoOptions } from "./slides/VideoDialog";
import { DesignerPane, DraftDialog } from "./slides/DesignerPane";
import { ReviewPane, type ReviewActions } from "./slides/ReviewPane";
import { summaryZoom } from "@/lib/slides/morph";
import { PdfDialog } from "./slides/PdfDialog";
import { takePendingImport } from "@/lib/slides/pending-import";
import { encodeSnapshot, readMasters, restoreSnapshot, takeSnapshot, type DeckSnapshot } from "@/lib/slides/versions";
import { VersionPanel } from "./slides/VersionPanel";
import { parseHf, parseJsonSafe, readDeckMeta, type DeckMeta, type LiveState } from "@/lib/slides/live";
import { extForMime, mediaMime, probeVideo, uploadMedia } from "@/lib/slides/media-client";

export { htmlToPptxRuns };

const PALETTE = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];
function colorFor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Empty-looking body HTML (what an untouched placeholder holds). */
const EMPTY_LIST = "<ul><li><p></p></li></ul>";
const isBlank = (html: string) => !html || html === "<p></p>" || html === EMPTY_LIST;

const textExtensions = (placeholder: string) => [
  StarterKit.configure({ heading: false }),
  Underline,
  TextStyle,
  Color,
  FontFamily,
  FontSize,
  TextAlign.configure({ types: ["paragraph"] }),
  Highlight.configure({ multicolor: true }),
  Link.configure({ openOnClick: false, autolink: true, protocols: ["mailto", "tel"], validate: (href) => !!safeHref(href) }),
  Subscript,
  Superscript,
  ParagraphSpacing,
  Placeholder.configure({ placeholder, includeChildren: true }),
];

const isEditableTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
};

/** Read an image file, scaling very large pictures down so decks stay light to sync. */
async function imageFromFile(file: File): Promise<{ src: string; w: number; h: number }> {
  const src = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("Unsupported image"));
    i.src = src;
  });
  const MAX = 1920;
  let w = img.naturalWidth || 400, h = img.naturalHeight || 300;
  if ((w > MAX || h > MAX || file.size > 1.5e6) && file.type !== "image/svg+xml" && file.type !== "image/gif") {
    const k = Math.min(1, MAX / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
    const keepPng = file.type === "image/png" && file.size < 4e6;
    return { src: c.toDataURL(keepPng ? "image/png" : "image/jpeg", 0.88), w: c.width, h: c.height };
  }
  return { src, w, h };
}

/** What the master's content placeholder shows in Slide Master view. */
const MASTER_SAMPLE = "<ul><li><p>Click to edit Master text styles</p><ul><li><p>Second level</p><ul><li><p>Third level</p></li></ul></li></ul></li></ul>";

const isPptx = (f: File) =>
  /\.(pptx|odp|ppt)$/i.test(f.name) ||
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/vnd.oasis.opendocument.presentation", "application/vnd.ms-powerpoint"].includes(f.type);
/** Read a presentation file: PowerPoint (.pptx), OpenDocument (.odp) or legacy PowerPoint 97-2003 (.ppt: text, shapes, pictures, tables and notes). */
async function readDeckFile(file: File) {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 8));
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
    const { importPpt } = await import("@/lib/slides/ppt-import");
    return importPpt(buf);
  }
  if (/\.odp$/i.test(file.name) || file.type === "application/vnd.oasis.opendocument.presentation") {
    const { importOdp } = await import("@/lib/slides/odp-import");
    return importOdp(buf);
  }
  const { importPptx } = await import("@/lib/slides/pptx-import");
  return importPptx(buf);
}

export default function SlideEditor({
  docId,
  initialName = "Untitled presentation",
  user,
  collabUrl = "",
  canEdit = true,
  role = "owner",
  starred = false,
}: {
  docId?: string;
  initialName?: string;
  user?: { name: string; email: string };
  collabUrl?: string;
  canEdit?: boolean;
  role?: "viewer" | "commenter" | "editor" | "owner";
  starred?: boolean;
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const { ydoc, provider, yslides, ymeta, ylayouts } = useMemo(() => {
    const ydoc = new Y.Doc();
    let provider: HocuspocusProvider | null = null;
    if (docId) {
      const url =
        collabUrl ||
        (typeof window !== "undefined"
          ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/collab`
          : "");
      provider = new HocuspocusProvider({ url, name: docId, document: ydoc });
      if (user) provider.setAwarenessField("user", { name: user.name, email: user.email, color: colorFor(user.email) });
    }
    return { ydoc, provider, yslides: ydoc.getArray<Y.Map<string>>("slides"), ymeta: ydoc.getMap<string>("meta"), ylayouts: ydoc.getMap<Y.Map<string>>("layouts") };
  }, [docId, collabUrl, user]);

  const [slides, setSlides] = useState<Slide[]>([]);
  const [meta, setMeta] = useState<DeckMeta>({ w: DEFAULT_W, h: DEFAULT_H, theme: "synergy", font: "" });
  const [masters, setMasters] = useState<Masters>({});
  const [masterKey, setMasterKey] = useState<MasterKey | null>(null); // Slide Master view
  const masterRef = useRef(masterKey);
  masterRef.current = masterKey;
  const [diagramEdit, setDiagramEdit] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "theme" | "hf" | "size" | "math" | "icon" | "diagram" | "setup" | "shows" | "pdf" | "zoom-summary" | "zoom-section" | "zoom-slide" | "video" | "draft">(null);
  const [mathEdit, setMathEdit] = useState<string | null>(null); // equation being edited in the dialog
  const [painter, setPainter] = useState<{ fmt: ObjFmt; sticky: boolean } | null>(null); // format painter
  const textEdRef = useRef<Editor | null>(null); // the rich-text editor in use (for painting text selections)
  const editingRef = useRef(false);
  // a text format being painted: it goes onto the next text selected with the mouse
  useEffect(() => {
    if (!painter?.fmt.sel || !painter.fmt.text) return;
    const fmt = painter.fmt.text;
    const src = textEdRef.current?.state.selection;
    const up = () =>
      setTimeout(() => {
        const ed = textEdRef.current;
        if (!ed || ed.state.selection.empty || !ed.isFocused) return;
        // not the text the format was copied from
        if (src && ed.state.selection.from === src.from && ed.state.selection.to === src.to) return;
        paintSelection(ed, fmt);
        if (!painter.sticky) setPainter(null);
      }, 0);
    document.addEventListener("mouseup", up);
    return () => document.removeEventListener("mouseup", up);
  }, [painter]);
  // ---- comments (suite comment threads, anchored on slides) ----
  const canComment = !!docId && (canEdit || role === "commenter");
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState<Anchor | null>(null);
  const [focusThread, setFocusThread] = useState<string | null>(null);
  const [people, setPeople] = useState<string[]>([]);
  const cmtSeen = useRef(0);
  const loadComments = useCallback(async () => {
    if (!docId) return;
    const res = await fetch(`/api/docs/${docId}/comments`).catch(() => null);
    if (res?.ok) setThreads(((await res.json()).threads ?? []) as CommentThread[]);
  }, [docId]);
  const loadCommentsRef = useRef(loadComments);
  loadCommentsRef.current = loadComments;
  const threadsRef = useRef<CommentThread[]>([]);
  threadsRef.current = threads;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()); // collapsed sections (by first slide id)
  const [sel, setSel] = useState(0);
  const [selection, setSelection] = useState<string[]>([]); // object IDs, or one placeholder ID
  const selEl = selection[selection.length - 1] || null;
  const setSelEl = (id: string | null) => setSelection(id ? [id] : []);
  const [editing, setEditing] = useState<string | null>(null); // element id whose text is being edited
  const [elEditor, setElEditor] = useState<Editor | null>(null);
  const [name, setName] = useState(initialName);
  const [titleKey, setTitleKey] = useState(0);
  const [status, setStatus] = useState<"connecting" | "connected" | "offline" | "local">(docId ? "connecting" : "local");
  const [peers, setPeers] = useState(1);
  const [followers, setFollowers] = useState(0); // audience views open
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string[] | null>(null);
  const [show, setShow] = useState<{ mode: "show" | "presenter"; start: number; custom?: string; rehearse?: boolean; record?: boolean } | null>(null);
  const [sorter, setSorter] = useState(false);
  const [animPanel, setAnimPanel] = useState(false);
  const [designerOpen, setDesignerOpen] = useState(false);
  const [review, setReview] = useState<null | "a11y" | "spell">(null);
  const [pointsEl, setPointsEl] = useState<string | null>(null);
  // custom motion paths: one being drawn (straight lines from the object's centre, or a scribble), or one whose points are being edited
  const [motion, setMotion] = useState<{ key: string; idx: number; mode: "lines" | "scribble"; pts: { x: number; y: number }[]; hover?: { x: number; y: number } } | null>(null);
  const [pathEdit, setPathEdit] = useState<{ key: string; idx: number } | null>(null);
  useEffect(() => {
    if (pathEdit && selEl !== pathEdit.key) setPathEdit(null);
    if (motion && selEl !== motion.key) setMotion(null);
  }, [selEl, pathEdit, motion]);
  // Edit Points ends with the selection (or Esc)
  useEffect(() => {
    if (pointsEl && selEl !== pointsEl) setPointsEl(null);
  }, [selEl, pointsEl]);
  useEffect(() => {
    if (!pointsEl) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setPointsEl(null);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [pointsEl]);
  const [zoom, setZoom] = useState<number | null>(null); // null = fit
  const [fitScale, setFitScale] = useState(0.6);
  const [dragSlide, setDragSlide] = useState<{ from: number; over: number } | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  // pen tool: each stroke on the slide becomes a freeform shape
  const [pen, setPenMode] = useState<false | "free" | "poly">(false);
  const setPen = (v: boolean | "free" | "poly" | ((p: false | "free" | "poly") => boolean | "free" | "poly")) =>
    setPenMode((p) => { const n = typeof v === "function" ? v(p) : v; return n === true ? "free" : n; });
  // polygon mode: the vertices clicked so far, and where the pointer is
  const [poly, setPoly] = useState<{ pts: { x: number; y: number }[]; hover?: { x: number; y: number } } | null>(null);
  const [cellSel, setCellSel] = useState<{ id: string; rect: CellRect } | null>(null); // table cells selected for the table tools
  const [stroke, setStroke] = useState<{ x: number; y: number }[] | null>(null);
  const [groupPreview, setGroupPreview] = useState<{ anchorId: string; dx: number; dy: number } | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localBody = useRef<string>(""); // last body HTML this client emitted, to filter echoes
  const stageRef = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const modelInput = useRef<HTMLInputElement>(null);
  const [modelTurn, setModelTurn] = useState<{ id: string; t: Turn } | null>(null); // a 3D model being turned
  const pptxInput = useRef<HTMLInputElement>(null);
  const pptxMode = useRef<"replace" | "append">("replace");
  const clipboard = useRef<SlideElement[]>([]);

  const W = meta.w, H = meta.h;
  const theme = useMemo(() => effectiveTheme(meta.theme, meta.colors), [meta.theme, meta.colors]);
  const look: DeckLook = useMemo(
    () => ({ W, H, theme, font: meta.font ? `'${meta.font}', ${theme.font}` : theme.font, headFont: meta.headFont ? `'${meta.headFont}', ${theme.font}` : undefined, hf: meta.hf }),
    [W, H, theme, meta.font, meta.headFont, meta.hf],
  );
  // ---- version history: snapshots of the shared deck state ----
  const saveVersion = useCallback(async (label?: string): Promise<string | null> => {
    if (!docId) return null;
    const res = await fetch(`/api/docs/${docId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html: encodeSnapshot(takeSnapshot(yslides, ymeta, ylayouts)), ...(label ? { label } : {}) }),
    }).catch(() => null);
    if (!res?.ok) return null;
    const out = (await res.json()) as { id?: string; skipped?: boolean };
    if (out.id) return out.id;
    if (!label) return null;
    // unchanged since the newest version: name that one
    const list = await fetch(`/api/docs/${docId}/versions`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const newest = list?.versions?.[0]?.id as string | undefined;
    if (!newest) return null;
    await fetch(`/api/docs/${docId}/versions/${newest}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label }) });
    return newest;
  }, [docId, yslides, ymeta, ylayouts]);
  useEffect(() => {
    if (!docId || !canEdit) return;
    let dirty = false;
    const onUpdate = (_u: Uint8Array, origin: unknown) => {
      if (origin !== provider) dirty = true; // our own edits (remote ones are saved by their author)
    };
    ydoc.on("update", onUpdate);
    const t = setInterval(() => {
      if (!dirty || !provider?.isSynced) return;
      dirty = false;
      saveVersion();
    }, 60_000);
    return () => {
      ydoc.off("update", onUpdate);
      clearInterval(t);
    };
  }, [docId, canEdit, ydoc, provider, saveVersion]);
  const lookFor = useCallback((m: Record<string, string>): DeckLook => {
    const th = effectiveTheme(m.theme || "synergy", themeColors(parseJsonSafe(m.colors)));
    return { W: Number(m.w) || DEFAULT_W, H: Number(m.h) || DEFAULT_H, theme: th, font: m.font ? `'${m.font}', ${th.font}` : th.font, headFont: m.headFont ? `'${m.headFont}', ${th.font}` : undefined, hf: parseHf(m.hf) };
  }, []);
  const restoreVersion = (snap: DeckSnapshot) => {
    restoreSnapshot(ydoc, yslides, ymeta, ylayouts, snap);
    setSel(0);
    setSelection([]);
    setNotice(["Restored an earlier version. The presentation as it was is kept in the version history."]);
  };

  // the audience view follows the presenter through collaboration awareness
  const followOpts = useMemo(
    () =>
      docId && provider && typeof window !== "undefined"
        ? { link: `${window.location.origin}/slides/${docId}/follow`, name: user?.name || "", followers, publish: (st: LiveState | null) => provider.setAwarenessField("live", st) }
        : undefined,
    [docId, provider, user?.name, followers],
  );
  // slides with their layout/master look resolved and numbered (for drawing)
  const view = useMemo(() => prepareSlides(slides, masters), [slides, masters]);
  const deckCtx = useMemo(() => ({ slides: view }), [view]);
  const showSlides = useMemo(() => {
    const cs = show?.custom ? meta.shows?.find((x) => x.id === show.custom) : undefined;
    return cs ? customShowSlides(view, cs) : view;
  }, [view, show?.custom, meta.shows]);

  // Dev/e2e hooks (never in production): unit-test the HTML->pptx-runs mapping
  // and fetch the exported bytes without a download dialog.
  const slidesRef = useRef<Slide[]>([]);
  slidesRef.current = slides;
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const nameRef = useRef(name);
  nameRef.current = name;
  const mastersRef = useRef(masters);
  mastersRef.current = masters;
  const viewRef = useRef<Slide[]>([]);
  viewRef.current = view;
  const lookRef = useRef(look);
  lookRef.current = look;
  const pdfBytesRef = useRef<((o: PdfOptions) => Promise<Uint8Array>) | null>(null);
  const odpBytesRef = useRef<(() => Promise<Uint8Array>) | null>(null);
  const videoBytesRef = useRef<((o: VideoOptions) => Promise<Blob>) | null>(null);
  const fitScalesRef = useRef<(() => Promise<{ fitScales: Record<string, Record<string, number>>; zoomThumbs: Record<string, string> }>) | null>(null);
  useEffect(() => {
    if (typeof window === "undefined" || process.env.NODE_ENV === "production") return;
    const w = window as unknown as Record<string, unknown>;
    w.__htmlToPptxRuns = htmlToPptxRuns;
    w.__exportPptxBytes = async () => {
      const buf = await buildPptx(slidesRef.current, { name: nameRef.current, ...metaRef.current, masters: mastersRef.current, comments: pptxComments(slidesRef.current, threadsRef.current), ...(await fitScalesRef.current!()) });
      return Array.from(new Uint8Array(buf));
    };
    w.__slides = () => slidesRef.current;
    w.__deckMeta = () => metaRef.current;
    w.__exportPdfBytes = async (o: PdfOptions) => Array.from(await pdfBytesRef.current!(o));
    w.__masters = () => mastersRef.current;
    w.__exportOdpBytes = async () => Array.from(await odpBytesRef.current!());
    w.__exportVideo = async (o: VideoOptions) => {
      const b = await videoBytesRef.current!(o);
      return { type: b.type, size: b.size, head: Array.from(new Uint8Array(await b.slice(0, 64).arrayBuffer())), url: URL.createObjectURL(b) };
    };
  }, []);

  const read = (): Slide[] => yslides.toArray().map((m) => {
    const s = readSlide(m);
    return s.id ? s : { ...s, id: genId() };
  });

  // Callbacks registered once (Yjs observers, TipTap handlers) must see the
  // current slide, not the one selected when they were created.
  const selRef = useRef(sel);
  selRef.current = sel;
  const clampedSel = () => Math.min(selRef.current, Math.max(0, yslides.length - 1));

  const scheduleTitleSave = () => {
    if (!docId) return;
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      const s = read();
      // Title is user-controlled via the title bar now; only the snippet is derived.
      fetch(`/api/docs/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snippet: `Presentation · ${s.length} slide${s.length === 1 ? "" : "s"}` }),
      }).catch(() => {});
    }, 1200);
  };

  // ---- the rich body editor (renders on the slide) ----
  const bodyEditor = useEditor({
    extensions: textExtensions("Click to add text"),
    editorProps: { attributes: { class: "slide-body slide-text slide-body-ph", "data-testid": "slide-body" } },
    immediatelyRender: false,
    editable: canEdit,
    content: "",
    onUpdate: ({ editor }) => {
      if (!canEdit || masterRef.current) return;
      // Write to Yjs immediately (not debounced) so the shared state always
      // matches the editor. If we debounced, an unrelated Yjs event during the
      // window would make sync() see the stale saved body as "remote" and revert
      // the edit. Only the title/snippet REST push is debounced.
      const html = editor.getHTML();
      localBody.current = html;
      const m = yslides.get(clampedSel());
      if (m) ydoc.transact(() => m.set("body", isBlank(html) ? "" : html));
      scheduleTitleSave();
    },
    onFocus: () => {
      setEditing(null);
      setSelEl("body");
    },
  });

  // The title: plain text in "title" (what search, the outline and thumbnails
  // read) and, when some of it is formatted (bold words, a colour...), the
  // formatted HTML in "thtml".
  const localTitle = useRef<string>("");
  const titleEditor = useEditor({
    extensions: textExtensions("Click to add title"),
    editorProps: { attributes: { class: "slide-text slide-title-ed", "data-testid": "slide-title" } },
    immediatelyRender: false,
    editable: canEdit,
    content: "",
    onUpdate: ({ editor }) => {
      if (!canEdit || masterRef.current) return;
      const html = editor.getHTML();
      localTitle.current = html;
      const m = yslides.get(clampedSel());
      if (m)
        ydoc.transact(() => {
          m.set("title", titleText(html));
          if (richTitle(html)) m.set("thtml", html);
          else if (m.has("thtml")) m.delete("thtml");
        });
      scheduleTitleSave();
    },
    onFocus: () => {
      setEditing(null);
      setSelEl("title");
    },
  });
  const titleEditorRef = useRef<Editor | null>(titleEditor);
  titleEditorRef.current = titleEditor;
  const loadTitle = (s: Pick<Slide, "title" | "thtml">) => {
    const te = titleEditorRef.current;
    if (!te) return;
    const html = titleHtml(s);
    te.commands.setContent(html || "<p></p>", false);
    localTitle.current = te.getHTML();
  };

  // The provider-lifecycle effect below must NOT depend on bodyEditor: useEditor
  // returns null then the instance (immediatelyRender:false), so listing it as a
  // dep would re-run that effect once the editor initializes — firing its cleanup
  // and destroying the collab provider mid-handshake (no sync, no persist). We
  // reach the current editor through a ref instead, keeping the provider effect
  // stable on [ydoc, provider] like the Docs editor does.
  const bodyEditorRef = useRef<Editor | null>(bodyEditor);
  bodyEditorRef.current = bodyEditor;

  // Load a slide's body into the editor without emitting an update (avoids echo).
  // An empty "Title and content" body starts as a bullet, like PowerPoint's.
  const loadBody = (html: string) => {
    const be = bodyEditorRef.current;
    if (!be) return;
    const target = toHtml(html);
    localBody.current = target;
    const layout = slidesRef.current[clampedSel()]?.layout;
    be.commands.setContent(target || (layout === "content" ? EMPTY_LIST : "<p></p>"), false);
  };

  useEffect(() => {
    const sync = () => {
      const next = read();
      setSlides(next);
      // If the selected slide's body changed remotely (not our own echo), reflect it.
      const cur = next[clampedSel()];
      const be = bodyEditorRef.current;
      if (!masterRef.current && cur && be && cur.body !== localBody.current && toHtml(cur.body) !== be.getHTML() && !(isBlank(cur.body) && isBlank(be.getHTML()))) {
        loadBody(cur.body);
      }
      // the same for the title: text changed elsewhere, or formatting changed while we're not typing in it
      const te = titleEditorRef.current;
      if (!masterRef.current && cur && te && (titleText(te.getHTML()) !== cur.title || (!te.isFocused && titleHtml(cur) !== te.getHTML() && !!(cur.thtml || richTitle(te.getHTML()))))) loadTitle(cur);
    };
    const syncMeta = () => {
      const n = ymeta.get("name") as string;
      if (n) setName(n);
      setMeta(readDeckMeta((k) => ymeta.get(k)));
    };
    const syncLayouts = () => setMasters(readMasters(ylayouts.entries()));
    yslides.observeDeep(sync);
    ymeta.observe(syncMeta);
    ylayouts.observeDeep(syncLayouts);
    sync();
    syncMeta();
    syncLayouts();

    const seed = () => {
      if (yslides.length === 0) {
        ydoc.transact(() => {
          const m = new Y.Map<string>();
          for (const [k, v] of Object.entries(slideFields({ id: genId(), title: "", body: "", notes: "", layout: "title", elements: [] }))) m.set(k, v);
          yslides.push([m]);
        });
      }
    };

    if (provider) {
      const onStatus = (e: { status: string }) =>
        setStatus(e.status === "connected" ? "connected" : e.status === "connecting" ? "connecting" : "offline");
      provider.on("status", onStatus);
      const onAware = () => {
        let watching = 0;
        provider!.awareness?.getStates().forEach((st) => (watching += (st as { following?: boolean }).following ? 1 : 0));
        setPeers(Math.max(1, (provider!.awareness?.getStates().size ?? 1) - watching));
        setFollowers(watching);
        // someone changed a comment thread: their client bumps "cmt"
        let latest = 0;
        provider!.awareness?.getStates().forEach((st, id) => {
          if (id !== provider!.awareness?.clientID) latest = Math.max(latest, Number((st as { cmt?: number }).cmt) || 0);
        });
        if (latest > cmtSeen.current) {
          cmtSeen.current = latest;
          loadCommentsRef.current();
        }
      };
      provider.awareness?.on("change", onAware);
      provider.on("synced", seed);
      // The socket can finish connecting/syncing before this effect runs (a
      // fast local server); catch up on events we would otherwise miss.
      onStatus({ status: provider.status });
      if (provider.isSynced) seed();
      return () => {
        provider.off("status", onStatus);
        provider.off("synced", seed);
        provider.awareness?.off("change", onAware);
        yslides.unobserveDeep(sync);
        ymeta.unobserve(syncMeta);
        ylayouts.unobserveDeep(syncLayouts);
        provider.destroy();
        ydoc.destroy();
      };
    }
    seed();
    return () => {
      yslides.unobserveDeep(sync);
      ymeta.unobserve(syncMeta);
      ylayouts.unobserveDeep(syncLayouts);
      ydoc.destroy();
    };
    // NOTE: bodyEditor is intentionally NOT a dependency — see bodyEditorRef above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ydoc, provider]);

  // On slide switch, load that slide's body into the editor and drop selection.
  const selIdx = clampedSel();
  /** The master or a layout as an editable slide (Slide Master view). */
  const masterSlide = (k: MasterKey): Slide => ({
    ...(masters[k] || { id: "", title: "", body: "", notes: "", bg: "", bgImg: "", elements: [] }),
    id: `master-${k}`,
    layout: masterLayout(k, masters),
    title: "Click to edit Master title style",
    body: MASTER_SAMPLE,
    notes: "",
  });
  const cur = masterKey ? masterSlide(masterKey) : slides[selIdx];
  // what the canvas draws: the slide with its layout/master look (a layout shows the master's objects)
  const masterView = (k: MasterKey): Slide => {
    const m = masterSlide(k);
    const M = masterFor(k, masters);
    return isMasterKey(k) || !M ? m : applyMaster(m, { master: { ...M, layout: m.layout } });
  };
  const curView = !cur ? undefined : masterKey ? masterView(masterKey) : view[selIdx] || cur;
  const selectedIds = selection.filter((id) => cur?.elements.some((el) => el.id === id));
  const selectedElements = cur?.elements.filter((el) => selectedIds.includes(el.id)) || [];
  // a SmartArt graphic: everything selected is in one group whose first shape carries the data model
  const selGroup = selectedElements.length && selectedElements.every((e) => e.group && e.group === selectedElements[0].group) ? selectedElements[0].group : undefined;
  const selDiagram = selGroup ? cur?.elements.find((e) => e.group === selGroup && e.type === "shape" && !!e.dgm) : undefined;
  const groupBounds = selectedElements.length > 1 ? boundsOf(selectedElements) : null;
  const pendingSel = useRef<string | null>(null); // what to select once a slide switch lands (find)
  useEffect(() => {
    if (cur) {
      loadBody(cur.body);
      loadTitle(cur);
    }
    setSelEl(pendingSel.current);
    pendingSel.current = null;
    setEditing(null);
    setMarquee(null);
    setGroupPreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.id, cur?.layout, bodyEditor, titleEditor]);
  useEffect(() => {
    bodyEditor?.setEditable(canEdit && !masterKey, false);
  }, [bodyEditor, canEdit, masterKey]);

  // Fit the slide to the stage.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setFitScale(Math.max(0.1, Math.min((el.clientWidth - 64) / W, (el.clientHeight - 48) / H)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H, sorter]);
  const scale = zoom ?? fitScale;

  // ---- collab write helpers ----
  /** The Y.Map of the master or a layout, created on first write. */
  const layoutMap = (k: MasterKey) => {
    let m = ylayouts.get(k);
    if (!m) {
      m = new Y.Map<string>();
      const fresh = m;
      ydoc.transact(() => ylayouts.set(k, fresh));
    }
    return m;
  };
  const curMap = () => (masterKey ? layoutMap(masterKey) : yslides.get(selIdx));
  const setField = (k: string, v: string | null, i = selIdx) => {
    const m = masterKey && i === selIdx ? layoutMap(masterKey) : yslides.get(i);
    if (!m) return;
    ydoc.transact(() => (v === null ? m.delete(k) : m.set(k, v)));
  };
  const readEl = (id: string): SlideElement | null => {
    const v = curMap()?.get(`el:${id}`);
    if (typeof v !== "string") return null;
    try {
      return { ...(JSON.parse(v) as SlideElement), id };
    } catch {
      return null;
    }
  };
  const writeEl = (el: SlideElement) => {
    const m = curMap();
    if (!m || !canEdit) return;
    ydoc.transact(() => m.set(`el:${el.id}`, elementJson(el)));
  };
  const patchEl = (id: string, patch: Partial<SlideElement>) => {
    const el = readEl(id);
    if (el) writeEl({ ...el, ...patch } as SlideElement);
  };
  const maxZ = () => Math.max(0, ...(cur?.elements.map((e) => e.z) || [0]));
  // a layout placeholder slot clicked on this slide: what is inserted next goes into it
  const slotRef = useRef<{ slide: string; id: string; box: Box } | null>(null);
  const takeSlot = () => {
    const sl = slotRef.current;
    slotRef.current = null;
    return sl && cur && !masterRef.current && sl.slide === cur.id ? sl : null;
  };
  /** An object placed in a slot: the slot's box (pictures and video keep their shape, centred in it). */
  const inSlot = (el: NewElement, sl: { id: string; box: Box }): NewElement => {
    const b = sl.box;
    if (el.type === "image" || el.type === "media" || el.type === "model3d") {
      const k = Math.min(b.w / Math.max(1, el.w), b.h / Math.max(1, el.h));
      const w = Math.round(el.w * k), h = Math.round(el.h * k);
      return { ...el, x: Math.round(b.x + (b.w - w) / 2), y: Math.round(b.y + (b.h - h) / 2), w, h, ph: sl.id } as NewElement;
    }
    return { ...el, ...b, ph: sl.id } as NewElement;
  };
  const addEl = (el0: NewElement, edit = false) => {
    const sl = takeSlot();
    const el = sl ? inSlot(el0, sl) : el0;
    const full = { ...el, id: el.id || genId("e"), z: maxZ() + 1 } as SlideElement;
    writeEl(full);
    setSelEl(full.id);
    setEditing(edit ? full.id : null);
    return full;
  };
  const deleteEl = (id: string) => {
    const m = curMap();
    if (!m) return;
    ydoc.transact(() => m.delete(`el:${id}`));
    setSelection((current) => current.filter((item) => item !== id));
    setEditing(null);
  };
  /** Typed text: into the element, and for a SmartArt shape also into its diagram's data model. */
  const editText = (id: string, html: string) => {
    const el = readEl(id);
    if (!el) return;
    const lead = el.type === "shape" && el.dpt?.length && el.group ? cur?.elements.find((e) => e.type === "shape" && e.group === el.group && e.dgm) : undefined;
    if (!lead || lead.type !== "shape" || !lead.dgm) return patchEl(id, { html } as Partial<SlideElement>);
    const dgm = syncShapeText(lead.dgm, el.type === "shape" ? el.dpt : undefined, html);
    if (lead.id === id) return patchEl(id, { html, dgm } as Partial<SlideElement>);
    patchEls([{ id, patch: { html } as Partial<SlideElement> }, { id: lead.id, patch: { dgm } as Partial<SlideElement> }]);
  };
  /** Write several elements in one collaborative change. */
  const patchEls = (patches: { id: string; patch: Partial<SlideElement> }[]) => {
    const m = curMap();
    if (!m || !canEdit) return;
    ydoc.transact(() => {
      for (const { id, patch } of patches) {
        const el = readEl(id);
        if (el) m.set(`el:${id}`, elementJson({ ...el, ...patch } as SlideElement));
      }
    });
  };
  const writePositions = (positions: Map<string, { x: number; y: number }>) =>
    patchEls([...positions].map(([id, p]) => ({ id, patch: { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 } })));
  const moveSelected = (dx: number, dy: number) => {
    writePositions(new Map(selectedIds.map((id) => {
      const el = readEl(id);
      return [id, { x: (el?.x || 0) + dx, y: (el?.y || 0) + dy }];
    })));
  };
  /** Resize several objects at once: the selection's bounds `from` become `to`. */
  const resizeSelected = (from: Box, to: Box) => {
    const els = selectedIds.map((id) => readEl(id)).filter((e): e is SlideElement => !!e);
    patchEls([...resizedBoxes(els, from, to)].map(([id, b]) => ({ id, patch: b })));
  };
  const [groupResize, setGroupResize] = useState<Box | null>(null);
  const startGroupResize = (handle: string) => (e: React.PointerEvent) => {
    if (e.button !== 0 || !groupBounds || !canEdit) return;
    e.preventDefault();
    e.stopPropagation();
    const from = groupBounds, x0 = e.clientX, y0 = e.clientY;
    let last = from;
    const move = (ev: PointerEvent) => {
      last = dragBounds(from, handle, (ev.clientX - x0) / scale, (ev.clientY - y0) / scale, ev.shiftKey);
      setGroupResize(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setGroupResize(null);
      if (last !== from) resizeSelected(from, last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  const deleteSelected = () => {
    const m = curMap();
    if (!m || !canEdit) return;
    ydoc.transact(() => selectedIds.forEach((id) => m.delete(`el:${id}`)));
    setSelection([]);
    setEditing(null);
  };
  /** Copies of objects (offset), keeping grouped copies together under new group ids. */
  const duplicateSelected = (source = selectedElements, offset = 16) => {
    if (!canEdit || !source.length) return [];
    const m = curMap();
    if (!m) return [];
    const regroup = new Map<string, string>();
    let z = maxZ();
    const copies = [...source].sort((p, q) => p.z - q.z).map((src) => {
      for (const g of groupPath(src)) if (!regroup.has(g)) regroup.set(g, genId("g"));
      const { anim: _anim, fx: _fx, ...rest } = src;
      void _anim;
      void _fx;
      return { ...rest, id: genId("e"), z: ++z, x: src.x + offset, y: src.y + offset, group: src.group ? regroup.get(src.group) : undefined, sub: src.sub?.map((g) => regroup.get(g)!) } as SlideElement;
    });
    ydoc.transact(() => copies.forEach((el) => m.set(`el:${el.id}`, elementJson(el))));
    setSelection(copies.map((el) => el.id));
    setEditing(null);
    return copies;
  };
  const selectAllObjects = () => { setSelection(cur?.elements.map((el) => el.id) || []); setEditing(null); };

  const copyMapInto = (src: Y.Map<string>, override: Record<string, string> = {}) => {
    const m = new Y.Map<string>();
    src.forEach((v, k) => m.set(k, v));
    for (const [k, v] of Object.entries(override)) m.set(k, v);
    return m;
  };

  const setTitle = (v: string) => {
    // plain text replaces formatted runs that no longer match it
    const m = curMap();
    ydoc.transact(() => {
      setField("title", v);
      const th = m?.get("thtml");
      if (typeof th === "string" && titleText(th) !== v) m?.delete("thtml");
    });
    scheduleTitleSave();
  };
  const setNotes = (v: string) => setField("notes", v);

  /** New slide after the current one; `key` is a built-in layout or a custom layout ("c:<id>"). */
  const add = (key: MasterKey = "content") => {
    if (masterRef.current) return; // slide-only commands do nothing in Slide Master view
    const custom = isCustomKey(key) && masters[key] ? key.slice(2) : undefined;
    const layout: SlideLayout = custom ? masterLayout(key, masters) : isCustomKey(key) ? "content" : masterLayout(key);
    ydoc.transact(() => {
      const m = new Y.Map<string>();
      for (const [k, v] of Object.entries(slideFields({ id: genId(), title: "", body: "", notes: "", layout, elements: [], ...(custom ? { clayout: custom } : {}) }))) m.set(k, v);
      yslides.insert(selIdx + 1, [m]);
    });
    setSel(selIdx + 1);
    scheduleTitleSave();
  };
  const remove = (i: number) => {
    if (masterRef.current) return; // slide-only commands do nothing in Slide Master view
    if (yslides.length <= 1) return;
    ydoc.transact(() => yslides.delete(i, 1));
    setSel((s) => Math.max(0, s > i ? s - 1 : s === i ? Math.min(i, yslides.length - 1) : s));
    scheduleTitleSave();
  };
  const moveTo = (from: number, to: number) => {
    if (masterRef.current) return; // slide-only commands do nothing in Slide Master view
    if (from === to || from < 0 || to < 0 || from >= yslides.length || to >= yslides.length) return;
    const src = yslides.get(from);
    ydoc.transact(() => {
      const m = copyMapInto(src);
      yslides.delete(from, 1);
      yslides.insert(to, [m]);
    });
    setSel(to);
    scheduleTitleSave();
  };
  const move = (i: number, dir: -1 | 1) => moveTo(i, i + dir);
  const duplicate = (i = selIdx) => {
    if (masterRef.current) return; // slide-only commands do nothing in Slide Master view
    const src = yslides.get(i);
    if (!src || !canEdit) return;
    ydoc.transact(() => {
      // fresh element ids so later edits to the copy stay independent
      const m = new Y.Map<string>();
      src.forEach((v, k) => m.set(k.startsWith("el:") ? `el:${genId("e")}` : k, v));
      m.set("id", genId());
      yslides.insert(i + 1, [m]);
    });
    setSel(i + 1);
    scheduleTitleSave();
  };
  // ---- transitions & animations ----
  /** Effect `idx` of a target (idx = current count appends; null removes it). Reads the live slide so batched calls compose. */
  const setAnim = (key: string, a: Anim | null, idx = 0) => {
    const m = curMap();
    if (!m || !canEdit) return;
    const list = effectsOf(readSlide(m), key);
    if (a) list[Math.min(idx, list.length)] = a;
    else list.splice(idx, 1);
    if (key === "title" || key === "body") {
      ydoc.transact(() => {
        setField(key === "title" ? "tanim" : "banim", list[0] ? JSON.stringify(list[0]) : null);
        setField(key === "title" ? "tfx" : "bfx", list.length > 1 ? JSON.stringify(list.slice(1)) : null);
      });
      return;
    }
    const el = readEl(key);
    if (!el) return;
    const next = { ...el } as SlideElement;
    delete next.anim;
    delete next.fx;
    if (list[0]) next.anim = list[0];
    if (list.length > 1) next.fx = list.slice(1);
    writeEl(next);
  };
  const setTrans = (t: Transition | null) => setField("trans", t ? JSON.stringify(t) : null);
  const applyTransAll = () => {
    if (masterRef.current) return; // slide-only commands do nothing in Slide Master view
    const v = curMap()?.get("trans");
    ydoc.transact(() => yslides.forEach((m) => (typeof v === "string" ? m.set("trans", v) : m.delete("trans"))));
  };
  const reorderAnim = (key: string, idx: number, dir: -1 | 1) => {
    if (!cur) return;
    const list = animTargets(cur);
    const i = list.findIndex((x) => x.key === key && x.idx === idx);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const a = list[i], b = list[j];
    ydoc.transact(() => {
      setAnim(a.key, { ...a.anim, order: b.anim.order === a.anim.order ? a.anim.order + dir : b.anim.order }, a.idx);
      setAnim(b.key, { ...b.anim, order: a.anim.order }, b.idx);
    });
  };
  // step number badges shown on the canvas while the animation pane is open
  const animBadges = useMemo(() => {
    const m = new Map<string, number>();
    if (!cur || !animPanel) return m;
    const steps = buildSteps(cur);
    const auto = !!steps[0]?.auto; // an automatic first step is numbered 0, as in PowerPoint
    steps.forEach((st, k) => st.items.forEach((it) => {
      const key = it.key.startsWith("body#") ? "body" : it.key;
      if (!m.has(key)) m.set(key, auto ? k : k + 1);
    }));
    return m;
  }, [cur, animPanel]);

  const toggleHidden = (i = selIdx) => {
    if (masterRef.current) return; // slide-only commands do nothing in Slide Master view
    const s = slides[i];
    if (s) setField("hidden", s.hidden ? null : "1", i);
  };
  const setLayout = (key: MasterKey) => {
    if (masterRef.current) return; // slide-only commands do nothing in Slide Master view
    const m = curMap();
    if (!m || isMasterKey(key)) return;
    const custom = isCustomKey(key) && masters[key] ? key.slice(2) : undefined;
    if (isCustomKey(key) && !custom) return;
    ydoc.transact(() => {
      m.set("layout", custom ? masterLayout(key, masters) : key);
      if (custom) m.set("clayout", custom);
      else m.delete("clayout");
      // a layout change resets placeholder positions, as in PowerPoint
      m.delete("tbox");
      m.delete("bbox");
    });
  };
  const setBg = (hex: string | null) => {
    const m = curMap();
    if (!m) return;
    ydoc.transact(() => {
      m.set("bg", hex || "");
      m.delete("bgGrad");
      if (!hex) m.set("bgImg", "");
    });
  };
  const setBgGrad = (g: Gradient | null) => {
    const m = curMap();
    if (!m) return;
    ydoc.transact(() => {
      if (g) {
        m.set("bgGrad", JSON.stringify(g));
        m.set("bg", g.stops[0].color);
        m.set("bgImg", "");
      } else m.delete("bgGrad");
    });
  };
  const applyBgToAll = () => {
    if (masterRef.current) return; // slide-only commands do nothing in Slide Master view
    const s = cur;
    if (!s) return;
    ydoc.transact(() => yslides.forEach((m) => { m.set("bg", s.bg); m.set("bgImg", s.bgImg); if (s.bgGrad) m.set("bgGrad", JSON.stringify(s.bgGrad)); else m.delete("bgGrad"); }));
  };
  const setMetaField = (k: string, v: string) => ydoc.transact(() => ymeta.set(k, v));
  const setSlideSize = (w: number, h: number, mode: ResizeMode = "scale") => {
    if (w === W && h === H) return;
    const t = resizeTransform(W, H, w, h, mode);
    const scaleBox = (b: Box) => t(b);
    // "Ensure fit" scales text with its boxes; stretching scales it by the smaller factor
    const k = mode === "none" ? 1 : Math.min(w / W, h / H);
    const ms = mastersRef.current;
    ydoc.transact(() => {
      ymeta.set("w", String(w));
      ymeta.set("h", String(h));
      const scaleMap = (m: Y.Map<string>, key?: string) => {
        const s = readSlide(m);
        if (s.tbox) m.set("tbox", JSON.stringify(scaleBox(s.tbox)));
        if (s.bbox) m.set("bbox", JSON.stringify(scaleBox(s.bbox)));
        for (const e of s.elements) m.set(`el:${e.id}`, elementJson({ ...scaleElementFonts(e, k), ...scaleBox(e) } as SlideElement));
        const f = scaleSlideFonts(s, k, ms, key);
        if (f.tstyle) m.set("tstyle", JSON.stringify(f.tstyle));
        if (f.bstyle) m.set("bstyle", JSON.stringify(f.bstyle));
        if (f.body !== undefined && f.body !== s.body) m.set("body", f.body);
      };
      yslides.forEach((m) => scaleMap(m));
      ylayouts.forEach((m, key) => scaleMap(m, key));
    });
  };

  // ---- theme, header & footer, slide master, sections ----
  const applyTheme = (v: { colors?: ThemeColors; font: string; headFont: string }) =>
    ydoc.transact(() => {
      if (v.colors) ymeta.set("colors", JSON.stringify(v.colors));
      else ymeta.delete("colors");
      ymeta.set("font", v.font);
      if (v.headFont) ymeta.set("headFont", v.headFont);
      else ymeta.delete("headFont");
    });
  const setShowSettings = (v: ShowSettings) => ydoc.transact(() => (Object.keys(v).length ? ymeta.set("showSet", JSON.stringify(v)) : ymeta.delete("showSet")));
  const setCustomShows = (v: CustomShow[]) =>
    ydoc.transact(() => {
      if (v.length) ymeta.set("shows", JSON.stringify(v));
      else ymeta.delete("shows");
      // the set-up show must still exist
      if (meta.show?.show && !v.some((x) => x.id === meta.show?.show)) setShowSettings({ ...meta.show, show: undefined });
    });
  /** F5: the set-up custom show when there is one, else every slide. */
  const startShow = (start: number, mode: "show" | "presenter" = "show") => {
    const custom = meta.show?.show && meta.shows?.some((x) => x.id === meta.show?.show) ? meta.show.show : undefined;
    setShow({ mode, start: custom ? 0 : start, ...(custom ? { custom } : {}) });
  };
  /** After a show: keep rehearsed timings and ink when asked. */
  const finishShow = (shownIds: string[], result?: ShowResult) => {
    if (!result || !canEdit) return;
    const times = result.times;
    if (times && Object.keys(times).length) {
      const total = Object.values(times).reduce((a, b) => a + b, 0);
      if (confirm(`The total time for the slide show was ${fmtTime(total)}. Keep the new slide timings?`)) {
        ydoc.transact(() => {
          yslides.toArray().forEach((m, i) => {
            const s = slides[i];
            const ms = s ? times[s.id] : undefined;
            if (s && ms !== undefined) m.set("trans", JSON.stringify({ ...(s.trans || { type: "none", dur: 500 }), advAfter: Math.max(100, Math.round(ms / 100) * 100) }));
          });
          setShowSettings({ ...(meta.show || {}), useTimings: undefined });
        });
      }
    }
    const strokes = Object.entries(result.ink).filter(([, l]) => l.length);
    if (strokes.length && confirm("Keep your ink annotations on the slides?")) {
      ydoc.transact(() => {
        for (const [id, list] of strokes) {
          const i = slides.findIndex((s) => s.id === id);
          const m = yslides.get(i);
          if (!m) continue;
          let z = Math.max(0, ...slides[i].elements.map((e) => e.z));
          for (const k of list) {
            const f = strokeToFreeform(k.pts, 0);
            if (!f) continue;
            const w = k.tool === "hl" ? 22 : 4;
            const el = { id: genId("e"), z: ++z, type: "shape", shape: "freeform", geom: f.geom, fill: null, line: k.color, lineW: w, ink: k.tool === "hl" ? "hl" : "pen", ...(k.tool === "hl" ? { lineA: 0.4 } : {}), ...f.box } as SlideElement;
            m.set(`el:${el.id}`, elementJson(el));
          }
        }
      });
    }
    if (result.audio && Object.keys(result.audio).length && confirm(`Keep the narration recorded on ${Object.keys(result.audio).length} slide(s)? It replaces earlier narration there.`)) void keepNarrations(result.audio);
    void shownIds;
  };
  /** Recorded narration: one audio object per slide (bottom right, plays by itself), replacing an earlier one. */
  const keepNarrations = async (clips: Record<string, Blob>) => {
    setBusy("Saving narration…");
    try {
      const { narrationForPowerPoint } = await import("@/lib/slides/narration");
      for (const [id, raw] of Object.entries(clips)) {
        // AAC in MP4, which every PowerPoint plays, where the browser can encode it
        const blob = await narrationForPowerPoint(raw);
        const mime = blob.type || "audio/webm";
        const src = docId ? (await uploadMedia(docId, blob, `Narration.${extForMime(mime)}`, mime)).url : await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(blob); });
        const i = slidesRef.current.findIndex((x) => x.id === id);
        const m = yslides.get(i);
        if (!m) continue;
        const sl = slidesRef.current[i];
        ydoc.transact(() => {
          for (const e of sl.elements) if (e.type === "media" && e.narration) m.delete(`el:${e.id}`);
          const z = Math.max(0, ...sl.elements.map((e) => e.z)) + 1;
          const el: SlideElement = { id: genId("e"), z, type: "media", kind: "audio", src, mime, name: "Narration", narration: true, autoplay: true, x: W - 72, y: H - 72, w: 48, h: 48 };
          m.set(`el:${el.id}`, elementJson(el));
        });
      }
    } catch (e) {
      alert("Could not save the narration: " + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const clearNarrations = () => {
    if (!confirm("Remove the recorded narration from every slide?")) return;
    ydoc.transact(() => slidesRef.current.forEach((sl, i) => {
      const m = yslides.get(i);
      for (const e of sl.elements) if (e.type === "media" && e.narration) m?.delete(`el:${e.id}`);
    }));
  };
  const setHf = (v: HeaderFooter | null) => ydoc.transact(() => (v ? ymeta.set("hf", JSON.stringify(v)) : ymeta.delete("hf")));
  const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined && x !== "")) as T;
  const setMasterStyle = (key: "tstyle" | "bstyle", patch: Partial<TitleStyle> | Partial<BodyStyle>) => {
    if (!masterKey) return;
    const next = clean({ ...(masters[masterKey]?.[key] || {}), ...patch });
    setField(key, Object.keys(next).length ? JSON.stringify(next) : null);
  };
  const resetLayout = () => {
    if (!masterKey || isMasterKey(masterKey)) return;
    const m = layoutMap(masterKey);
    ydoc.transact(() => ["tbox", "bbox", "tstyle", "bstyle", "bg", "bgImg"].forEach((k) => m.delete(k)));
  };
  /** Slide Master view: a new custom layout copied from the selected layout (or Title and Content). */
  const newLayout = () => {
    if (!canEdit) return;
    const name = window.prompt("Layout name", "Custom Layout");
    if (name === null) return;
    const from: MasterKey = masterKey && !isMasterKey(masterKey) ? masterKey : "content";
    const src = ylayouts.get(from);
    const id = genId("L").replace(/[^\w-]/g, "").slice(0, 24);
    const key: MasterKey = `c:${id}`;
    // the new layout belongs to the master being looked at
    const mk = masterKey ? masterKeyOf(masterKey, masters) : "master";
    ydoc.transact(() => {
      const m = new Y.Map<string>();
      // a copy of the source layout, with fresh object ids
      src?.forEach((v, k) => m.set(k.startsWith("el:") ? `el:${genId("e")}` : k, v));
      m.set("layout", masterLayout(from, masters));
      m.set("lname", name.trim() || "Custom Layout");
      if (isAddedMaster(mk)) m.set("pm", mk.slice(2));
      else m.delete("pm");
      ylayouts.set(key, m);
    });
    openMaster(key);
  };
  /** Slide Master view: another slide master, with a Title and Content layout of its own. */
  const newMaster = () => {
    if (!canEdit) return;
    const n = layoutKeys(masters).filter((k) => k.master).length + 1;
    const name = window.prompt("Slide master name", `Slide Master ${n}`);
    if (name === null) return;
    const id = genId("M").replace(/[^\w-]/g, "").slice(0, 24);
    const lid = genId("L").replace(/[^\w-]/g, "").slice(0, 24);
    const src = ylayouts.get("master");
    ydoc.transact(() => {
      // a copy of the first master's look to start from (fresh object ids)
      const m = new Y.Map<string>();
      src?.forEach((v, k) => m.set(k.startsWith("el:") ? `el:${genId("e")}` : k, v));
      m.set("layout", "content");
      m.set("lname", name.trim() || `Slide Master ${n}`);
      ylayouts.set(`m:${id}`, m);
      const l = new Y.Map<string>();
      for (const [k, v] of Object.entries(slideFields({ id: "", title: "", body: "", notes: "", layout: "content", bg: "", bgImg: "", elements: [], lname: "Title and Content", pm: id }))) l.set(k, v);
      ylayouts.set(`c:${lid}`, l);
    });
    openMaster(`m:${id}`);
  };
  const renameLayout = () => {
    if (!masterKey || !(isCustomKey(masterKey) || isAddedMaster(masterKey))) return;
    const name = window.prompt(isAddedMaster(masterKey) ? "Rename slide master" : "Rename layout", masters[masterKey]?.lname || "");
    if (name !== null && name.trim()) setField("lname", name.trim());
  };
  const deleteLayout = () => {
    if (masterKey && isAddedMaster(masterKey)) {
      // an added master goes with its layouts; their slides switch to the built-in layouts
      const pm = masterKey.slice(2);
      const ids = Object.entries(masters).filter(([k, v]) => isCustomKey(k) && v?.pm === pm).map(([k]) => k.slice(2));
      const n = slides.filter((x) => x.clayout && ids.includes(x.clayout)).length;
      if (!confirm(n ? `Delete this slide master and its layouts? ${n} slide${n === 1 ? "" : "s"} using them will switch to built-in layouts.` : "Delete this slide master and its layouts?")) return;
      ydoc.transact(() => {
        yslides.forEach((m) => ids.includes(String(m.get("clayout") || "")) && m.delete("clayout"));
        ids.forEach((id) => ylayouts.delete(`c:${id}`));
        ylayouts.delete(masterKey);
      });
      return openMaster("master");
    }
    if (!masterKey || !isCustomKey(masterKey)) return;
    const id = masterKey.slice(2);
    const n = slides.filter((x) => x.clayout === id).length;
    if (!confirm(n ? `Delete this layout? ${n} slide${n === 1 ? "" : "s"} using it will switch to its built-in layout.` : "Delete this layout?")) return;
    ydoc.transact(() => {
      yslides.forEach((m) => m.get("clayout") === id && m.delete("clayout"));
      ylayouts.delete(masterKey);
    });
    openMaster("master");
  };
  const openMaster = (k: MasterKey | null) => {
    setMasterKey(k);
    setSelection([]);
    setEditing(null);
    if (k) setAnimPanel(false);
  };
  const sections = sectionsOf(slides);
  const sectionAt = (i: number) => sections.find((x) => i >= x.start && i < x.end);
  const addSection = () => {
    if (!canEdit || masterKey) return;
    const name = window.prompt("Section name", "Untitled Section");
    if (name === null) return;
    ydoc.transact(() => {
      if (!sections.length && selIdx > 0) yslides.get(0)?.set("sec", "Default Section");
      yslides.get(selIdx)?.set("sec", name.trim() || "Untitled Section");
    });
  };
  const renameSection = (start = sectionAt(selIdx)?.start) => {
    if (!canEdit || start === undefined) return;
    const old = sectionAt(start)?.name || "";
    const name = window.prompt("Rename section", old);
    if (name !== null) setField("sec", name.trim() || old, start);
  };
  const removeSection = (start = sectionAt(selIdx)?.start) => {
    if (!canEdit || start === undefined) return;
    ydoc.transact(() => {
      yslides.get(start)?.delete("sec");
      // a lone "Default Section" left behind goes too
      const rest = sectionsOf(read());
      if (rest.length === 1 && rest[0].name === "Default Section") yslides.get(0)?.delete("sec");
    });
  };

  const renameDeck = (v: string) => {
    setName(v);
    ydoc.transact(() => ymeta.set("name", v));
    setTitleKey((k) => k + 1);
    if (docId) fetch(`/api/docs/${docId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: v }) }).catch(() => {});
  };

  // ---- comments ----
  useEffect(() => {
    if (!docId) return;
    loadComments();
    const t = setInterval(() => document.visibilityState === "visible" && loadComments(), 30000);
    const onFocus = () => loadComments();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [docId, loadComments]);
  // people to @mention: the deck's collaborators, everyone it is shared with, and past commenters
  useEffect(() => {
    if (!commentsOpen || !docId) return;
    const found = new Set<string>();
    threads.forEach((t) => t.messages.forEach((m) => m.author_email && found.add(m.author_email.toLowerCase())));
    provider?.awareness?.getStates().forEach((st) => {
      const e = (st as { user?: { email?: string } }).user?.email;
      if (e) found.add(e.toLowerCase());
    });
    const done = () => setPeople([...found].filter((e) => e !== (user?.email || "").toLowerCase()).sort());
    if (!canEdit) return done();
    fetch(`/api/docs/${docId}/share`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { owner_email?: string; grants?: { email: string }[] } | null) => {
        if (j?.owner_email) found.add(j.owner_email.toLowerCase());
        j?.grants?.forEach((g) => found.add(g.email.toLowerCase()));
      })
      .catch(() => {})
      .finally(done);
  }, [commentsOpen, docId, threads, provider, canEdit, user?.email]);
  /** Tell the other open copies of the deck to reload the comments. */
  const pingComments = () => provider?.setAwarenessField("cmt", Date.now());
  const commentApi = async (path: string, method: string, body?: unknown) => {
    const res = await fetch(`/api/docs/${docId}/comments${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
    if (!res?.ok) {
      alert(res?.status === 403 ? "You don’t have permission to do that." : "Could not save the comment. Please try again.");
      return null;
    }
    await loadComments();
    pingComments();
    return res.json().catch(() => ({}));
  };
  /** Comments read from a .pptx become threads here, posted by the person importing (the original author leads the text). */
  const postImportedComments = async (list: ImportedComment[], imported: Slide[], sx: number, sy: number) => {
    let n = 0;
    const me = (user?.name || "").trim().toLowerCase();
    const text = (m: ImportedComment["messages"][number]) => (m.author && m.author.trim().toLowerCase() !== me ? `${m.author}: ${m.text}` : m.text);
    for (const c of list) {
      const s = imported[c.slide];
      if (!s || !c.messages.length) continue;
      const quote = encodeAnchor({ slideId: s.id, x: c.x * sx, y: c.y * sy, label: "From PowerPoint" });
      const res = await fetch(`/api/docs/${docId}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quote, body: text(c.messages[0]) }) }).catch(() => null);
      if (!res?.ok) break;
      const { threadId } = (await res.json()) as { threadId: string };
      for (const m of c.messages.slice(1))
        await fetch(`/api/docs/${docId}/comments/${threadId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: text(m) }) }).catch(() => null);
      n++;
    }
    if (n) {
      await loadComments();
      pingComments();
    }
    return n;
  };
  const newComment = () => {
    if (!canComment || !cur || masterKey) return;
    const one = selectedIds.length === 1 ? selectedIds[0] : null;
    const a = anchorFor(cur, one, W);
    const el = one ? cur.elements.find((e) => e.id === one) : undefined;
    const kind = el ? ({ text: "Text box", image: "Picture", shape: "Shape", table: "Table", chart: "Chart", math: "Equation", zoom: "Zoom", model3d: "3D model", media: el.type === "media" && el.kind === "audio" ? "Audio" : "Video" } as const)[el.type] : "";
    const elText = el && "html" in el && el.html ? htmlText(el.html) : el?.type === "chart" ? el.title || "" : el?.type === "image" ? el.alt || "" : "";
    const label = (el ? (elText ? `${kind}: ${elText}` : kind) : cur.title || `Slide ${selIdx + 1}`).slice(0, 80);
    setCommentDraft({ ...a, label });
    setFocusThread(null);
    setCommentsOpen(true);
  };
  const postComment = async (body: string) => {
    if (!commentDraft) return false;
    const r = (await commentApi("", "POST", { quote: encodeAnchor(commentDraft), body })) as { threadId?: string } | null;
    if (!r) return false;
    setCommentDraft(null);
    if (r.threadId) setFocusThread(r.threadId);
    return true;
  };
  const replyComment = async (threadId: string, body: string) => !!(await commentApi(`/${threadId}`, "POST", { body }));
  const resolveComment = (t: CommentThread) => commentApi(`/${t.id}`, "PATCH", { resolved: !t.resolved });
  const deleteComment = (threadId: string) => {
    if (confirm("Delete this comment thread?")) commentApi(`/${threadId}`, "DELETE");
  };
  const commentsBySlide = useMemo(() => threadsBySlide(threads), [threads]);
  const openComments = (slideCount = 0) => commentsBySlide.get(slides[slideCount]?.id || "")?.filter((x) => !x.t.resolved).length || 0;
  const goToThread = (i: number, threadId: string) => {
    setFocusThread(threadId);
    if (i !== selIdx) setSel(i);
    const a = threads.find((t) => t.id === threadId);
    const el = a ? decodeAnchor(a.quote)?.el : undefined;
    if (el) {
      if (i !== selIdx) pendingSel.current = el;
      else setSelEl(el);
    }
  };

  /** Fill a layout slot on this slide: text at once, or the picker for what goes in it. */
  const fillSlot = (sl: SlideElement, kind: SlotKind) => {
    if (!cur || !canEdit) return;
    slotRef.current = { slide: cur.id, id: sl.id, box: { x: sl.x, y: sl.y, w: sl.w, h: sl.h } };
    if (kind === "text") addEl({ type: "text", html: "", x: sl.x, y: sl.y, w: sl.w, h: sl.h }, true);
    else if (kind === "pic") imageInput.current?.click();
    else if (kind === "media") mediaInput.current?.click();
    else if (kind === "tbl") insertTable(3, 3);
    else if (kind === "chart") insertChart("bar");
    else if (kind === "dgm") { setDiagramEdit(null); setDialog("diagram"); }
  };

  // ---- insert ----
  const centerBox = (w: number, h: number): Box => ({ x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h });
  // new text boxes grow with their text, as in PowerPoint
  const insertText = () => addEl({ type: "text", html: "", autofit: "resize", ...centerBox(W * 0.4, H * 0.12) }, true);

  // "Resize shape to fit text": keep the edited / selected box as tall as its text
  useLayoutEffect(() => {
    if (!canEdit || !cur) return;
    const id = editing || (selectedIds.length === 1 ? selectedIds[0] : null);
    const el = id ? cur.elements.find((e) => e.id === id) : undefined;
    if (!el || (el.type !== "text" && el.type !== "shape") || el.autofit !== "resize") return;
    const text = document.querySelector<HTMLElement>(`[data-el-id="${CSS.escape(el.id)}"] .slide-text`);
    const layer = text?.parentElement?.closest<HTMLElement>("[data-text-layer]");
    if (!text || !layer) return;
    const cs = getComputedStyle(layer);
    const need = Math.ceil(text.offsetHeight + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom));
    if (need > 0 && Math.abs(need - el.h) > 1) patchEl(el.id, { h: need });
  });
  const insertShape = (shape: string) => {
    const line = isLineShape(shape);
    addEl({
      type: "shape",
      shape,
      fill: line ? null : theme.accent,
      line: line ? "1F2430" : null,
      lineW: line ? 2 : undefined,
      ...(line ? { ...centerBox(W * 0.25, 1) } : centerBox(Math.round(W * 0.18), Math.round(W * 0.18 * (shape === "rect" || shape === "roundRect" ? 0.6 : 1)))),
    });
  };
  const insertTable = (r: number, c: number) => {
    if (masterRef.current) return; // slide-only commands do nothing in Slide Master view
    const rows: TableCell[][] = Array.from({ length: r }, (_, ri) =>
      Array.from({ length: c }, () => ({ text: "" })),
    );
    // as PowerPoint inserts one: its default style with a header row and banded rows
    addEl({ type: "table", rows, fontSize: 14, tstyle: { id: DEFAULT_TABLE_STYLE, first: true, bandRow: true }, ...centerBox(Math.min(W * 0.8, c * 160), Math.min(H * 0.7, r * 40)) });
  };
  /** Insert an equation, or update the one being edited. */
  const applyMath = (v: { latex: string; size: number; color?: string }) => {
    if (mathEdit) {
      const el = readEl(mathEdit);
      if (el?.type === "math") writeEl({ ...el, latex: v.latex, size: v.size, color: v.color } as SlideElement);
      setMathEdit(null);
      return;
    }
    const h = Math.round(v.size * 1.333 * 3);
    addEl({ type: "math", latex: v.latex, size: v.size, ...(v.color ? { color: v.color } : {}), ...centerBox(Math.round(W * 0.5), h) });
  };
  const editMath = (id: string) => {
    setMathEdit(id);
    setDialog("math");
  };
  /** An icon as a vector shape, outlined in the theme accent. */
  const insertIcon = (_name: string, svg: string) => {
    const size = Math.round(Math.min(W, H) * 0.15);
    addEl({ type: "shape", shape: "freeform", geom: iconGeom(svg), fill: null, line: theme.accent, lineW: iconStroke(size), ...centerBox(size, size) });
  };
  /** A SmartArt-style diagram: one group of shapes, selected as a whole. */
  const insertDiagram = (kind: DiagramKind, text: string) => {
    const m = curMap();
    if (!m || !canEdit) return;
    const gid = genId("g");
    const sl = takeSlot();
    const els = buildDiagram(kind, parseOutline(text), sl?.box || { x: Math.round(W * 0.08), y: Math.round(H * 0.2), w: Math.round(W * 0.84), h: Math.round(H * 0.7) }, theme.accent, gid);
    const z0 = maxZ();
    const full = els.map((e, i) => ({ ...e, id: genId("e"), z: z0 + i + 1, ...(sl && i === 0 ? { ph: sl.id } : {}) }) as SlideElement);
    ydoc.transact(() => full.forEach((e) => m.set(`el:${e.id}`, elementJson(e))));
    setSelection(full.map((e) => e.id));
    setEditing(null);
  };
  /**
   * The Text Pane's outline goes into the diagram's data model, and the
   * graphic is laid out again in its place (same group, same box).
   */
  const relayDiagram = (leadId: string, kind: DiagramKind, text: string) => {
    const m = curMap();
    const lead = readEl(leadId);
    if (!m || !canEdit || !lead || lead.type !== "shape" || !lead.dgm || !lead.group) return;
    const gid = lead.group;
    const members = (cur?.elements || []).filter((e) => e.group === gid);
    const box = { x: Math.min(...members.map((e) => e.x)), y: Math.min(...members.map((e) => e.y)) };
    const area = { ...box, w: Math.max(...members.map((e) => e.x + e.w)) - box.x, h: Math.max(...members.map((e) => e.y + e.h)) - box.y };
    const items = parseOutline(text);
    if (!items.length) return;
    const els = buildDiagram(kind, items, area, lead.dgm.accent || theme.accent, gid, lead.dgm.src);
    const z0 = Math.min(...members.map((e) => e.z));
    const full = els.map((e, i) => ({ ...e, id: i < members.length ? members[i].id : genId("e"), z: z0 + i }) as SlideElement);
    ydoc.transact(() => {
      members.forEach((e) => m.delete(`el:${e.id}`));
      full.forEach((e) => m.set(`el:${e.id}`, elementJson(e)));
    });
    setSelection(full.map((e) => e.id));
    setEditing(null);
  };
  /** Insert > Zoom: slide and section zooms on this slide, or a summary slide of section zooms. */
  const insertZoom = (mode: ZoomMode, ids: string[]) => {
    if (!canEdit || masterRef.current) return;
    if (mode === "summary") {
      const r = summaryZoom(slidesRef.current, ids, W, H, genId);
      if (!r) return;
      ydoc.transact(() => {
        const hadSections = slidesRef.current.some((x) => x.sec !== undefined);
        for (const sct of r.sections) yslides.get(sct.index)?.set("sec", sct.name);
        if (!hadSections && r.at > 0) yslides.get(0)?.set("sec", "Default Section");
        const m = new Y.Map<string>();
        for (const [k, v] of Object.entries(slideFields(r.slide))) m.set(k, v);
        yslides.insert(r.at, [m]);
        // the summary slide sits in its own section in front of the first one
        m.set("sec", "Summary");
      });
      setSel(r.at);
      scheduleTitleSave();
      return;
    }
    const m = curMap();
    if (!m) return;
    const z0 = maxZ();
    const w = Math.round(W * 0.24), h = Math.round(H * 0.24);
    const full: SlideElement[] = ids.map((target, k) => ({ id: genId("e"), z: z0 + k + 1, type: "zoom", kind: mode, target, ...(mode === "section" ? { ret: true } : {}), x: Math.round(W * 0.08 + (k % 3) * (w + W * 0.04)), y: Math.round(H * 0.3 + Math.floor(k / 3) * (h + H * 0.04)) % Math.round(H - h), w, h }));
    ydoc.transact(() => full.forEach((e) => m.set(`el:${e.id}`, elementJson(e))));
    setSelection(full.map((e) => e.id));
    setEditing(null);
  };
  /** What the Review pane changes: objects, title/body colours and words, on any slide. */
  const reviewActs: ReviewActions = {
    go: (i, target) => {
      const el = target && target !== "title" && target !== "body" ? target : null;
      if (i !== selIdx) {
        pendingSel.current = el;
        setSel(i);
      } else {
        setSelEl(el);
        setEditing(null);
      }
    },
    patchEl: (i, id, patch) => reviewActs.patchEls(i, [{ id, patch }]),
    patchEls: (i, patches) => {
      const m = yslides.get(i);
      if (!m || !canEdit) return;
      ydoc.transact(() => {
        for (const { id, patch } of patches) {
          const e = slides[i]?.elements.find((x) => x.id === id);
          if (e) m.set(`el:${id}`, elementJson({ ...e, ...patch } as SlideElement));
        }
      });
    },
    setStyleColor: (i, which, color) => {
      const sl = slides[i];
      if (!sl || !canEdit) return;
      setField(which, JSON.stringify({ ...(sl[which] || {}), color }), i);
    },
    replaceWord: (word, by, at) => {
      const re = findRegex(word, { matchCase: true, wholeWord: true });
      if (!re || !canEdit) return 0;
      if (!at) return replaceAll(re, by);
      const m = yslides.get(at.slide);
      let n = 0;
      if (m) ydoc.transact(() => (n = replaceIn(m, slides[at.slide], at.key, re, by)));
      return n;
    },
  };
  /** Designer: make the current slide this one (same id, its fields and objects replaced). */
  const applyDesign = (next: Slide) => {
    const m = yslides.get(selIdx);
    if (!m || !canEdit || masterRef.current) return;
    const want = slideFields({ ...next, id: slides[selIdx]?.id ?? next.id });
    ydoc.transact(() => {
      for (const k of [...m.keys()]) if (!(k in want)) m.delete(k);
      for (const [k, v] of Object.entries(want)) if (m.get(k) !== v) m.set(k, v);
    });
    setSelection([]);
    setEditing(null);
  };
  /** Drafted slides go after the current one (or replace a deck that is one empty slide). */
  const insertDraft = (list: Slide[]) => {
    if (!canEdit || masterRef.current || !list.length) return;
    const blank = slides.length === 1 && !slides[0].title && !slides[0].body && !slides[0].elements.length;
    ydoc.transact(() => {
      const maps = list.map((sl) => {
        const m = new Y.Map<string>();
        for (const [k, v] of Object.entries(slideFields(sl))) m.set(k, v);
        return m;
      });
      if (blank) {
        yslides.delete(0, yslides.length);
        yslides.insert(0, maps);
      } else yslides.insert(selIdx + 1, maps);
    });
    setSel(blank ? 0 : selIdx + 1);
    scheduleTitleSave();
  };
  /** Format painter: copy the selected object's format (double-click keeps it on). */
  const startPainter = (sticky: boolean) => {
    if (painter) return setPainter(sticky ? { ...painter, sticky: true } : null);
    // selected text: copy its character format, to paint onto the next text selected
    const ed = textEdRef.current;
    if (ed && !ed.state.selection.empty && (editingRef.current || !selEl || selEl === "body")) return setPainter({ fmt: { from: "text", sel: true, text: selectionFmt(ed) }, sticky });
    const el = selEl ? readEl(selEl) : null;
    if (el) setPainter({ fmt: pickFormat(el), sticky });
  };
  const paintOnto = (id: string) => {
    if (!painter) return false;
    // text being edited takes a copied text format on the text selected in it
    if (painter.fmt.sel && editingRef.current && editing === id) return false;
    const el = readEl(id);
    if (!el) return false;
    const patch = paintFormat(el, painter.fmt);
    if (Object.keys(patch).length) writeEl({ ...el, ...patch } as SlideElement);
    if (!painter.sticky) setPainter(null);
    return true;
  };

  /** New chart with PowerPoint-style sample data, ready to edit. */
  const insertChart = (chartType: ChartEl["chartType"]) => {
    if (masterRef.current) return; // slide-only commands do nothing in Slide Master view
    const round = chartType === "pie" || chartType === "doughnut";
    const scatter = chartType === "scatter";
    addEl({
      type: "chart", chartType, title: round ? "Sales" : scatter ? "Measurements" : "Sales by quarter",
      categories: scatter ? ["0.7", "1.8", "2.6", "3.4", "4.5"] : ["Q1", "Q2", "Q3", "Q4"],
      series: round
        ? [{ name: "Sales", values: [8.2, 3.2, 1.4, 1.2] }]
        : scatter
          ? [{ name: "Y values", values: [2.7, 3.2, 0.8, 2.1, 3.9] }]
          : [{ name: "Series 1", values: [4.3, 2.5, 3.5, 4.5] }, { name: "Series 2", values: [2.4, 4.4, 1.8, 2.8] }, { name: "Series 3", values: [2, 2, 3, 5] }],
      showLegend: true, ...centerBox(Math.min(W * 0.65, 650), Math.min(H * 0.55, 390)),
    });
  };
  const insertImageFile = async (file: File) => {
    try {
      const img = await imageFromFile(file);
      const k = Math.min(1, (W * 0.6) / img.w, (H * 0.6) / img.h);
      addEl({ type: "image", src: img.src, alt: file.name.replace(/\.[^.]+$/, ""), ...centerBox(Math.round(img.w * k), Math.round(img.h * k)) });
    } catch (e) {
      alert("Could not insert picture: " + (e as Error).message);
    }
  };

  const insertMediaFile = async (file: File) => {
    if (!docId) return;
    const mime = mediaMime(file.type, file.name);
    const kind = mime.startsWith("audio/") ? "audio" : mime.startsWith("video/") ? "video" : null;
    if (!kind) return alert("Choose an audio or video file.");
    setBusy(kind === "video" ? "Uploading video…" : "Uploading audio…");
    try {
      const probe = kind === "video" ? await probeVideo(file) : null;
      const up = await uploadMedia(docId, file, file.name, mime);
      const name = file.name.replace(/\.[^.]+$/, "");
      if (kind === "video") {
        const vw = probe?.w || 1280, vh = probe?.h || 720;
        const k = Math.min(1, (W * 0.6) / vw, (H * 0.6) / vh);
        addEl({ type: "media", kind, src: up.url, mime: up.mime, name, ...(probe?.poster ? { poster: probe.poster } : {}), ...centerBox(Math.round(vw * k), Math.round(vh * k)) });
      } else addEl({ type: "media", kind, src: up.url, mime: up.mime, name, ...centerBox(96, 96) });
    } catch (e) {
      alert("Could not insert media: " + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // ---- 3D models ----
  /** A new poster (the picture exports use) for a model just turned or inserted, written wherever the model now is. */
  const refreshPoster = async (el: Model3dEl) => {
    const poster = await modelPoster(el);
    if (!poster) return;
    for (const m of [...yslides.toArray(), ...ylayouts.values()]) {
      const v = m.get(`el:${el.id}`);
      if (typeof v !== "string") continue;
      try {
        const now = { ...(JSON.parse(v) as Model3dEl), id: el.id };
        // only when it still shows what was drawn
        if (now.src === el.src && (now.rx || 0) === (el.rx || 0) && (now.ry || 0) === (el.ry || 0) && (now.rz || 0) === (el.rz || 0) && now.w === el.w && now.h === el.h)
          ydoc.transact(() => m.set(`el:${el.id}`, elementJson({ ...now, poster })));
      } catch {
        /* not ours to fix */
      }
      return;
    }
  };
  const turnModel = (id: string, t: Partial<Turn>) => {
    const el = readEl(id);
    if (el?.type !== "model3d") return;
    const next = { ...el, rx: normDeg(t.rx ?? el.rx ?? 0), ry: normDeg(t.ry ?? el.ry ?? 0), rz: normDeg(t.rz ?? el.rz ?? 0) };
    writeEl(next);
    void refreshPoster(next);
  };
  const insertModelFile = async (file: File) => {
    try {
      const raw = new Uint8Array(await file.arrayBuffer());
      const glb = isGlb(raw) ? raw : /\.gltf$/i.test(file.name) ? gltfToGlb(new TextDecoder().decode(raw)) : null;
      if (!glb) throw new Error("choose a glTF model (.glb or .gltf)");
      const info = glbInfo(glb);
      if (!info?.meshes) throw new Error("the file has no 3D shapes in it");
      setBusy("Uploading 3D model…");
      const name = (info.name || file.name.replace(/\.[^.]+$/, "")).slice(0, 120);
      const blob = new Blob([glb as BlobPart], { type: GLB_MIME });
      const src = docId
        ? (await uploadMedia(docId, blob, `${name}.glb`, GLB_MIME)).url
        : await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(blob); });
      if (!(await modelLoads(src))) throw new Error(info.extensionsRequired.length ? `it needs ${info.extensionsRequired.join(", ")}, which is not supported here` : "the model could not be read");
      const s = Math.round(Math.min(W, H) * 0.55);
      const el = addEl({ type: "model3d", src, name, alt: name, rx: 10, ry: -20, ...centerBox(s, s) }) as Model3dEl;
      void refreshPoster(el);
    } catch (e) {
      alert("Could not insert the 3D model: " + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // ---- arrange ----
  const arrange = (op: "front" | "back" | "forward" | "backward") => {
    if (!cur || !selEl) return;
    const els = [...cur.elements].sort((a, b) => a.z - b.z);
    const i = els.findIndex((e) => e.id === selEl);
    if (i < 0) return;
    const [it] = els.splice(i, 1);
    const j = op === "front" ? els.length : op === "back" ? 0 : op === "forward" ? Math.min(els.length, i + 1) : Math.max(0, i - 1);
    els.splice(j, 0, it);
    const m = curMap();
    if (!m) return;
    // reuse the existing z values so objects behind the placeholders (z < 0) stay there
    const zs = cur.elements.map((e) => e.z).sort((a, b) => a - b);
    ydoc.transact(() => els.forEach((e, k) => e.z !== zs[k] && m.set(`el:${e.id}`, elementJson({ ...e, z: zs[k] }))));
  };
  const rotate = (op: "right" | "left" | "flipH" | "flipV") => {
    if (!selEl) return;
    const el = readEl(selEl);
    if (!el) return;
    if (op === "flipH") patchEl(el.id, { flipH: !el.flipH });
    else if (op === "flipV") patchEl(el.id, { flipV: !el.flipV });
    else patchEl(el.id, { rot: (((el.rot || 0) + (op === "right" ? 90 : -90)) % 360 + 360) % 360 });
  };
  // ---- find & replace ----
  const [findOpen, setFindOpen] = useState<null | "find" | "replace">(null);
  const goToHit = (h: FindHit) => {
    const key = h.key === "notes" ? null : h.key.split(":")[0];
    if (h.slide !== selIdx) {
      pendingSel.current = key;
      setSel(h.slide);
    } else {
      setSelEl(key);
      setEditing(null);
    }
  };
  /** Replace inside one slide field / object (one table cell for a cell hit). Returns the number replaced. */
  const replaceIn = (m: Y.Map<string>, s: Slide, key: string, re: RegExp, by: string): number => {
    if (key === "title" || key === "notes") {
      const n = countInText(s[key], re);
      if (n) m.set(key, replaceInText(s[key], re, by));
      return n;
    }
    if (key === "body") {
      const n = countInHtml(s.body, re);
      if (n) m.set("body", replaceInHtml(s.body, re, by));
      return n;
    }
    const [id, r, c] = key.split(":");
    const e = s.elements.find((x) => x.id === id);
    if (!e) return 0;
    const cell: [number, number] | undefined = r !== undefined ? [Number(r), Number(c)] : undefined;
    const n = e.type === "table" ? e.rows.flatMap((row, ri) => row.map((cl, ci) => (!cell || (cell[0] === ri && cell[1] === ci) ? countInText(cl.text, re) : 0))).reduce((a, b) => a + b, 0) : countInHtml(("html" in e && e.html) || "", re);
    const next = n ? replaceInElement(e, re, by, cell) : null;
    if (next) m.set(`el:${id}`, elementJson(next));
    return next ? n : 0;
  };
  const replaceHit = (h: FindHit, re: RegExp, by: string) => {
    const m = yslides.get(h.slide);
    if (!m || !canEdit) return;
    ydoc.transact(() => replaceIn(m, slides[h.slide], h.key, re, by));
  };
  const replaceAll = (re: RegExp, by: string) => {
    if (!canEdit) return 0;
    let n = 0;
    ydoc.transact(() =>
      slides.forEach((s, i) => {
        const m = yslides.get(i);
        if (!m) return;
        for (const key of ["title", "body", "notes"]) n += replaceIn(m, s, key, re, by);
        for (const e of s.elements) n += replaceIn(m, s, e.id, re, by);
      }),
    );
    return n;
  };

  // ---- multi-object: align, distribute, group ----
  const SLIDE_BOX = { x: 0, y: 0, w: W, h: H };
  /** Several objects align to each other; a single object aligns to the slide. */
  const alignSel = (op: Align) => {
    if (selectedElements.length) writePositions(alignedPositions(selectedElements, op, selectedElements.length > 1 ? undefined : SLIDE_BOX));
  };
  /** Three or more objects spread between the outer ones; fewer spread across the slide. */
  const distributeSel = (axis: Axis) => {
    if (selectedElements.length) writePositions(distributedPositions(selectedElements, axis, selectedElements.length < 3 ? SLIDE_BOX : undefined));
  };
  const groupSel = () => {
    if (!cur || selectedElements.length < 2) return;
    const g = genId("g");
    const zs = groupZ(cur.elements, new Set(selectedIds));
    // groups among the selection go inside the new group
    patchEls(cur.elements.filter((e) => selectedIds.includes(e.id) || zs.has(e.id)).map((e) => ({ id: e.id, patch: { ...(selectedIds.includes(e.id) ? groupedPatch(e, g) : {}), ...(zs.has(e.id) ? { z: zs.get(e.id)! } : {}) } })));
    // an object taken out of another group leaves it; a group of one dissolves
    const left = new Map<string, string[]>();
    for (const e of cur.elements) if (e.group && !selectedIds.includes(e.id)) left.set(e.group, [...(left.get(e.group) || []), e.id]);
    const lone = [...left.values()].filter((ids) => ids.length === 1).flat();
    if (lone.length) patchEls(lone.map((id) => ({ id, patch: ungroupedPatch(cur.elements.find((e) => e.id === id) || {}) })));
  };
  /** Click on an object: grouped objects select together; Shift/Ctrl adds or removes; a plain click inside the selection keeps it for dragging. */
  const clickSelect = (id: string, additive: boolean) =>
    setSelection((current) => {
      const live = current.filter((x) => cur?.elements.some((item) => item.id === x));
      const members = cur ? withGroups(cur.elements, [id]) : [id];
      const rest = live.filter((x) => !members.includes(x));
      if (additive) return live.includes(id) ? rest : [...rest, ...members.filter((m) => m !== id), id];
      if (live.includes(id) && live.length > 1) return live;
      return [...members.filter((m) => m !== id), id];
    });
  const ungroupSel = () => {
    // the outer group goes; groups that were inside it stay
    const grouped = selectedElements.filter((e) => e.group);
    if (grouped.length) patchEls(grouped.map((e) => ({ id: e.id, patch: ungroupedPatch(e) })));
  };


  // ---- snapping (slide edges and centre lines) ----
  const snap = useCallback(
    (b: Box, moving: boolean): Box => {
      const T = 6 / scale;
      const out = { ...b };
      if (moving) {
        const xs: [number, number][] = [[0, 0], [W / 2, b.w / 2], [W, b.w]];
        for (const [line, off] of xs) if (Math.abs(b.x + off - line) < T) out.x = line - off;
        const ys: [number, number][] = [[0, 0], [H / 2, b.h / 2], [H, b.h]];
        for (const [line, off] of ys) if (Math.abs(b.y + off - line) < T) out.y = line - off;
      }
      return out;
    },
    [W, H, scale],
  );

  const startMarquee = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !cur) return;
    e.preventDefault();
    e.stopPropagation();
    setEditing(null);
    const rect = e.currentTarget.getBoundingClientRect();
    const point = (ev: PointerEvent | React.PointerEvent) => ({
      x: Math.max(0, Math.min(W, (ev.clientX - rect.left) / scale)),
      y: Math.max(0, Math.min(H, (ev.clientY - rect.top) / scale)),
    });
    const start = point(e);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const base = additive ? selectedIds : [];
    if (!additive) setSelection([]);
    let moved = false;
    const move = (ev: PointerEvent) => {
      const p = point(ev);
      if (!moved && Math.abs(p.x - start.x) + Math.abs(p.y - start.y) < 3 / scale) return;
      moved = true;
      setMarquee({ x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (moved) {
        const p = point(ev);
        const area = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
        setSelection([...new Set([...base, ...withGroups(cur.elements, inMarquee(cur.elements, area))])]);
      }
      setMarquee(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  /** Polygon mode: the clicked shape so far becomes a straight-line freeform. */
  const finishPoly = (closed: boolean, pts = poly?.pts || []) => {
    setPoly(null);
    const f = polygonToFreeform(pts, closed);
    if (!f || f.box.w + f.box.h < 4) return;
    addEl({ type: "shape", shape: "freeform", geom: f.geom, fill: f.closed ? look.theme.accent : null, line: look.theme.text, lineW: 3, ...f.box });
  };
  const slidePoint = (e: { clientX: number; clientY: number; currentTarget: EventTarget & HTMLDivElement }) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: Math.round(Math.max(0, Math.min(W, (e.clientX - rect.left) / scale)) * 10) / 10, y: Math.round(Math.max(0, Math.min(H, (e.clientY - rect.top) / scale)) * 10) / 10 };
  };
  const polyDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !canEdit) return;
    e.preventDefault();
    e.stopPropagation();
    const p = slidePoint(e);
    const pts = poly?.pts || [];
    // a click on the first vertex closes the shape; a double click ends it open
    if (pts.length > 2 && Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= 8 / scale) return finishPoly(true, pts);
    setPoly({ pts: [...pts, p], hover: p });
  };
  const startStroke = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pen === "poly") return polyDown(e);
    if (e.button !== 0 || !canEdit) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const point = (ev: PointerEvent | React.PointerEvent) => ({
      x: Math.round(Math.max(0, Math.min(W, (ev.clientX - rect.left) / scale)) * 10) / 10,
      y: Math.round(Math.max(0, Math.min(H, (ev.clientY - rect.top) / scale)) * 10) / 10,
    });
    const pts = [point(e)];
    setStroke([...pts]);
    const move = (ev: PointerEvent) => {
      const p = point(ev);
      const last = pts[pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < 1.5) return;
      pts.push(p);
      setStroke([...pts]);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setStroke(null);
      const f = strokeToFreeform(pts);
      if (!f || f.box.w + f.box.h < 4) return;
      addEl({ type: "shape", shape: "freeform", geom: f.geom, fill: f.closed ? look.theme.accent : null, line: look.theme.text, lineW: 3, ...f.box });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  // ---- import / export ----
  /** The deck as PDF bytes: slides are rendered off screen and drawn as vectors. */
  const pdfBytes = async (opts: PdfOptions): Promise<Uint8Array> => {
    const { buildPdf } = await import("@/lib/slides/pdf-export");
    const cur = viewRef.current;
    const r = await renderOffscreen(cur, lookRef.current);
    try {
      return await buildPdf(cur.map((s, i) => ({ root: r.roots[i], notes: s.notes, hidden: !!s.hidden, num: i + 1 })), lookRef.current.W, lookRef.current.H, nameRef.current || "Presentation", opts);
    } finally {
      r.dispose();
    }
  };
  pdfBytesRef.current = pdfBytes;
  const exportPdf = async (opts: PdfOptions) => {
    setBusy("Creating PDF…");
    try {
      const bytes = await pdfBytes(opts);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(name || "presentation").replace(/[\\/:*?"<>|]+/g, " ").trim() || "presentation"}${opts.layout === "notes" ? " (notes)" : opts.layout === "handouts" ? " (handouts)" : ""}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      alert("Could not create the PDF: " + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /** How far each shrink-on-overflow text box is shrunk right now (laid out off screen). */
  /** Laid out off screen for .pptx: the shrink-on-overflow scales, and pictures of the slides zooms lead to. */
  const pptxExtras = async (): Promise<{ fitScales: Record<string, Record<string, number>>; zoomThumbs: Record<string, string> }> => {
    const cur = viewRef.current;
    const fits = cur.some((s) => (s.body && s.bodyFit !== "none") || s.elements.some((e) => (e.type === "text" || e.type === "shape") && e.autofit === "shrink"));
    const zooms = cur.flatMap((s) => s.elements.filter((e): e is ZoomEl => e.type === "zoom"));
    if (!fits && !zooms.length) return { fitScales: {}, zoomThumbs: {} };
    const r = await renderOffscreen(cur, lookRef.current);
    try {
      const zoomThumbs: Record<string, string> = {};
      if (zooms.length) {
        const { rasterize } = await import("@/lib/slides/raster");
        const L = lookRef.current, tw = 640, th = Math.round((640 * L.H) / L.W);
        const pics = new Map<string, string>();
        for (const z of zooms) {
          const i = cur.findIndex((s) => s.id === z.target);
          if (i < 0) continue;
          if (!pics.has(z.target)) pics.set(z.target, await rasterize(r.roots[i], L.W, L.H, tw, th).then((c) => c.toDataURL("image/png")).catch(() => ""));
          if (pics.get(z.target)) zoomThumbs[z.id] = pics.get(z.target)!;
        }
      }
      return { fitScales: fits ? fitScales(cur, r.roots) : {}, zoomThumbs };
    } finally {
      r.dispose();
    }
  };
  fitScalesRef.current = pptxExtras;
  const exportPptx = async () => {
    setBusy("Exporting…");
    try {
      await downloadPptx(slides, { name: name || "presentation", ...meta, font: meta.font || undefined, masters, comments: pptxComments(slides, threads), ...(await pptxExtras()) });
    } catch (e) {
      alert("Could not export: " + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /** The deck as a video file (see lib/slides/video.ts). */
  const videoAbort = useRef<AbortController | null>(null);
  const [videoProgress, setVideoProgress] = useState<number | null>(null);
  const videoBlob = async (o: VideoOptions, signal?: AbortSignal, onProgress?: (p: number) => void): Promise<Blob> => {
    const { videoPlan, loadNarrations, mixTrack, encodeVideo } = await import("@/lib/slides/video");
    const { rasterize } = await import("@/lib/slides/raster");
    const cur = viewRef.current;
    const L = lookRef.current;
    const height = o.height, width = Math.round((height * L.W) / L.H / 2) * 2;
    const clips = o.recorded ? await loadNarrations(cur) : new Map<string, AudioBuffer>();
    const narration = Object.fromEntries([...clips].map(([id, b]) => [id, b.duration * 1000]));
    const timed = o.recorded ? cur : cur.map((x) => (x.trans?.advAfter ? { ...x, trans: { ...x.trans, advAfter: undefined } } : x));
    const { items, total } = videoPlan(timed, { secs: o.secs, narration, transitions: o.transitions, animations: o.animations });
    // every picture to lay out: each slide as it comes in and, when it animates,
    // once its animations are done and while each step plays
    const views: { slide: Slide; anim?: AnimState }[] = [];
    const at = items.map((it) => {
      const slide = cur[it.index];
      const start = views.push({ slide }) - 1;
      if (!it.steps?.length) return { start };
      const steps = buildSteps(slide);
      views[start].anim = animStateAt(steps, 0, false);
      const end = views.push({ slide, anim: animStateAt(steps, steps.length, false) }) - 1;
      const play = steps.map((_, k) => views.push({ slide, anim: animStateAt(steps, k + 1, true) }) - 1);
      return { start, end, play };
    });
    const r = await renderOffscreen(views.map((v) => v.slide), L, cur, views.map((v) => v.anim));
    try {
      const cache = new Map<string, Promise<string | null>>();
      const still = (i: number) => {
        seekAnimations(r.roots[i], 0);
        return rasterize(r.roots[i], L.W, L.H, width, height, cache);
      };
      const frames: HTMLCanvasElement[] = [];
      const ends: HTMLCanvasElement[] = [];
      for (const [k, a] of at.entries()) {
        frames.push(await still(a.start));
        ends.push(a.end !== undefined ? await still(a.end) : frames[k]);
        onProgress?.(((k + 1) / at.length) * 0.25);
      }
      const animFrame = (k: number, step: number, ms: number) => {
        const root = r.roots[at[k].play![step]];
        seekAnimations(root, ms);
        return rasterize(root, L.W, L.H, width, height, cache);
      };
      const audio = clips.size ? mixTrack(items, cur, clips, total) : undefined;
      return await encodeVideo({ format: o.format, width, height, fps: 30, frames, ends, animFrame, plan: items, total, slides: cur, audio, signal, onProgress: (p) => onProgress?.(0.25 + p * 0.75) });
    } finally {
      r.dispose();
    }
  };
  videoBytesRef.current = async (o: VideoOptions) => videoBlob(o);
  const exportVideo = async (o: VideoOptions) => {
    const ac = new AbortController();
    videoAbort.current = ac;
    setVideoProgress(0);
    try {
      const blob = await videoBlob(o, ac.signal, setVideoProgress);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(nameRef.current || "presentation").replace(/[\\/:*?"<>|]+/g, " ").trim() || "presentation"}.${o.format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setDialog(null);
    } catch (e) {
      if ((e as Error).name !== "AbortError") alert("Could not export the video: " + (e as Error).message);
    } finally {
      videoAbort.current = null;
      setVideoProgress(null);
    }
  };

  const odpDeck = () => ({ name: nameRef.current || "presentation", ...metaRef.current, font: metaRef.current.font || undefined, masters: mastersRef.current });
  const exportOdp = async () => {
    setBusy("Exporting…");
    try {
      const { buildOdp, ODP_MIME } = await import("@/lib/slides/odp-export");
      const { data, warnings } = await buildOdp(slidesRef.current, odpDeck());
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: ODP_MIME }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(name || "presentation").replace(/[\\/:*?"<>|]+/g, " ").trim() || "presentation"}.odp`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      if (warnings.length) setNotice(["Saved as OpenDocument.", ...warnings]);
    } catch (e) {
      alert("Could not export: " + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  odpBytesRef.current = async () => (await (await import("@/lib/slides/odp-export")).buildOdp(slidesRef.current, odpDeck())).data;

  const importFile = async (file: File, mode: "replace" | "append") => {
    setBusy("Importing…");
    try {
      const deck = await readDeckFile(file);
      const isEmpty = slides.length <= 1 && !slides[0]?.title && !slides[0]?.body && !slides[0]?.elements.length;
      const replace = mode === "replace";
      if (replace && !isEmpty && !confirm(`Replace the ${slides.length} slide${slides.length === 1 ? "" : "s"} in this presentation with “${file.name}”?`)) return;
      // embedded audio/video goes to the media store; the slides keep its URL
      let mediaLost = 0;
      const soundUps = new Map<string, string>();
      for (const sl of deck.slides) {
        const keep: SlideElement[] = [];
        for (const e of sl.elements) {
          if (e.type === "media" && e.src.startsWith("data:")) {
            try {
              if (!docId) throw new Error("no document");
              setBusy(`Uploading ${e.kind}…`);
              const blob = await (await fetch(e.src)).blob();
              const up = await uploadMedia(docId, blob, e.name || e.kind, e.mime || blob.type);
              keep.push({ ...e, src: up.url, mime: up.mime });
            } catch {
              mediaLost++;
              if (e.poster) keep.push({ id: e.id, z: e.z, x: e.x, y: e.y, w: e.w, h: e.h, type: "image", src: e.poster, ...(e.name ? { alt: e.name } : {}), ...(e.anim ? { anim: e.anim } : {}) });
            }
          } else if (e.type === "model3d" && e.src.startsWith("data:") && docId) {
            try {
              setBusy("Uploading 3D model…");
              const blob = await (await fetch(e.src)).blob();
              const up = await uploadMedia(docId, new Blob([blob], { type: GLB_MIME }), `${e.name || "model"}.glb`, GLB_MIME);
              keep.push({ ...e, src: up.url });
            } catch {
              mediaLost++;
              if (e.poster) keep.push({ id: e.id, z: e.z, x: e.x, y: e.y, w: e.w, h: e.h, type: "image", src: e.poster, ...(e.name ? { alt: e.name } : {}), ...(e.anim ? { anim: e.anim } : {}) });
            }
          } else keep.push(e);
        }
        sl.elements = keep;
        // animation sounds embedded in the deck go to the media store too (kept inline without one)
        if (docId)
          for (const a of [sl.tanim, ...(sl.tfx || []), sl.banim, ...(sl.bfx || []), ...sl.elements.flatMap((e) => [e.anim, ...(e.fx || [])])]) {
            if (!a?.sound?.src.startsWith("data:")) continue;
            try {
              let url = soundUps.get(a.sound.src);
              if (!url) {
                const blob = await (await fetch(a.sound.src)).blob();
                url = (await uploadMedia(docId, blob, `${a.sound.name || "Sound"}.wav`, blob.type || "audio/wav")).url;
                soundUps.set(a.sound.src, url);
              }
              a.sound = { ...a.sound, src: url };
            } catch {
              /* stays inline */
            }
          }
      }
      if (mediaLost) deck.warnings.push(`${mediaLost} audio, video or 3D model file${mediaLost === 1 ? "" : "s"} could not be uploaded and became pictures.`);
      setBusy("Importing…");
      const sx = replace ? 1 : W / deck.w, sy = replace ? 1 : H / deck.h;
      const fit = (b: Box) => ({ x: b.x * sx, y: b.y * sy, w: b.w * sx, h: b.h * sy });
      ydoc.transact(() => {
        if (replace) {
          yslides.delete(0, yslides.length);
          ymeta.set("w", String(deck.w));
          ymeta.set("h", String(deck.h));
          ymeta.set("theme", deck.theme);
          ymeta.set("font", deck.font || "");
          for (const [k, v] of [["headFont", deck.headFont], ["colors", deck.colors && JSON.stringify(deck.colors)], ["hf", deck.hf && JSON.stringify(deck.hf)], ["showSet", deck.show && JSON.stringify(deck.show)], ["shows", deck.shows && JSON.stringify(deck.shows)]] as const)
            if (v) ymeta.set(k, v);
            else ymeta.delete(k);
          // the imported deck's slide master and layouts replace ours
          for (const k of [...ylayouts.keys()]) ylayouts.delete(k);
          for (const [k, m] of Object.entries(deck.masters || {})) {
            if (!m) continue;
            const ym = new Y.Map<string>();
            for (const [f, v] of Object.entries(slideFields({ ...m, id: undefined, title: undefined, body: undefined, notes: undefined, layout: isCustomKey(k) ? m.layout : undefined }))) ym.set(f, v);
            ylayouts.set(k, ym);
          }
        }
        const at = replace ? 0 : selIdx + 1;
        // added to another deck, slides keep the look of their own master: its objects and background come along
        const own = replace ? deck.slides : deck.slides.map((s) => {
          const v = applyMaster(s, deck.masters);
          const under = (v.under || []).map((e, k) => ({ ...e, id: genId("e"), z: k + 1 - 20000 }) as SlideElement);
          return { ...s, clayout: undefined, hideUnder: undefined, tbox: v.tbox, bbox: v.bbox, tstyle: v.tstyle, bstyle: v.bstyle, bg: v.bg, bgImg: v.bgImg, bgGrad: v.bgGrad, elements: [...under, ...s.elements] };
        });
        const maps = own.map((s) => {
          const scaled: Slide = sx === 1 && sy === 1 ? s : { ...s, tbox: s.tbox && fit(s.tbox), bbox: s.bbox && fit(s.bbox), elements: s.elements.map((e) => ({ ...e, ...fit(e) }) as SlideElement) };
          const m = new Y.Map<string>();
          for (const [k, v] of Object.entries(slideFields(scaled))) m.set(k, v);
          return m;
        });
        yslides.insert(at, maps);
      });
      setSel(replace ? 0 : selIdx + 1);
      if (replace && (!name || name === "Untitled presentation")) renameDeck(file.name.replace(/\.(pptx|odp|ppt)$/i, ""));
      const nComments = deck.comments?.length && docId && canComment ? await postImportedComments(deck.comments, deck.slides, sx, sy) : 0;
      setNotice([`Imported ${deck.slides.length} slide${deck.slides.length === 1 ? "" : "s"} from “${file.name}”${nComments ? ` with ${nComments} comment thread${nComments === 1 ? "" : "s"}` : ""}.`, ...deck.warnings]);
      scheduleTitleSave();
    } catch (e) {
      alert("Could not open this presentation file: " + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  // A file picked on the documents list ("Open presentation file…") is imported
  // once this new deck has synced.
  const importRef = useRef(importFile);
  importRef.current = importFile;
  useEffect(() => {
    if (!docId || !canEdit) return;
    const run = () => {
      const f = takePendingImport(docId);
      if (f) importRef.current(f, "replace");
    };
    if (!provider || provider.isSynced) {
      const t = setTimeout(run, 0);
      return () => clearTimeout(t);
    }
    provider.on("synced", run);
    return () => {
      provider.off("synced", run);
    };
  }, [docId, canEdit, provider]);

  const openPptx = (mode: "replace" | "append") => {
    pptxMode.current = mode;
    pptxInput.current?.click();
  };

  const onDropFiles = (files: FileList | null) => {
    if (!files || !canEdit) return;
    for (const f of Array.from(files)) {
      if (isPptx(f)) importFile(f, "append");
      else if (f.type.startsWith("image/")) insertImageFile(f);
    }
  };

  // ---- keyboard & clipboard ----
  const selectedEl = selectedElements.length === 1 ? selectedElements[0] : null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (show) return;
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "f" || e.key.toLowerCase() === "h")) {
        e.preventDefault();
        setFindOpen(e.key.toLowerCase() === "h" && canEdit ? "replace" : "find");
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        newComment();
        return;
      }
      if (e.key === "F7") {
        e.preventDefault();
        setReview("spell");
        return;
      }
      if (e.key === "F5") {
        e.preventDefault();
        if (e.shiftKey) setShow({ mode: "show", start: selIdx });
        else startShow(0);
        return;
      }
      if (isEditableTarget(e.target)) {
        if (e.key === "Escape" && editing) {
          setEditing(null);
          (e.target as HTMLElement).blur();
        }
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (motion) {
        if (e.key === "Enter" || e.key === "Escape" || e.key === "Backspace") e.preventDefault();
        if (e.key === "Enter") finishMotion(motion);
        else if (e.key === "Escape") setMotion(null);
        else if (e.key === "Backspace" && motion.mode === "lines") setMotion({ ...motion, pts: motion.pts.length > 1 ? motion.pts.slice(0, -1) : motion.pts });
        return;
      }
      if (pathEdit && e.key === "Escape") {
        setPathEdit(null);
        return;
      }
      if (pen === "poly" && poly && e.key === "Enter") {
        e.preventDefault();
        finishPoly(false);
        return;
      }
      if (pen === "poly" && poly && e.key === "Backspace") {
        e.preventDefault();
        setPoly(poly.pts.length > 1 ? { ...poly, pts: poly.pts.slice(0, -1) } : null);
        return;
      }
      if (e.key === "Escape") {
        if (pen === "poly" && poly) {
          finishPoly(false);
          return;
        }
        setPen(false);
        setPainter(null);
        setSelEl(null);
        setEditing(null);
        return;
      }
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectAllObjects();
        return;
      }
      if (!canEdit) return;
      if (mod && e.key.toLowerCase() === "v" && clipboard.current.length) {
        e.preventDefault();
        duplicateSelected(clipboard.current);
        clipboard.current = clipboard.current.map((el) => ({ ...el, x: el.x + 16, y: el.y + 16 }));
        return;
      }
      if (selectedElements.length) {
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          deleteSelected();
        } else if (e.key.startsWith("Arrow")) {
          e.preventDefault();
          const d = e.shiftKey ? 10 : 1;
          const dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0;
          const dy = e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0;
          moveSelected(dx, dy);
        } else if (mod && (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "x")) {
          e.preventDefault();
          clipboard.current = selectedElements.map((el) => ({ ...el }));
          if (e.key.toLowerCase() === "x") deleteSelected();
        } else if (mod && e.key.toLowerCase() === "d") {
          e.preventDefault();
          duplicateSelected();
        } else if (mod && e.key.toLowerCase() === "g") {
          e.preventDefault();
          if (e.shiftKey) ungroupSel();
          else groupSel();
        } else if (e.key === "Enter" && selectedEl && (selectedEl.type === "text" || selectedEl.type === "shape")) {
          e.preventDefault();
          setEditing(selectedEl.id);
        }
      } else if (e.key === "PageDown" || (e.key === "ArrowDown" && !selEl)) {
        setSel((s) => Math.min(slides.length - 1, s + 1));
      } else if (e.key === "PageUp" || (e.key === "ArrowUp" && !selEl)) {
        setSel((s) => Math.max(0, s - 1));
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      if (show || !canEdit) return;
      const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        e.preventDefault();
        files.forEach((f) => insertImageFile(f));
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  });

  const newDoc = async (kind: "doc" | "sheet" | "slide") => {
    const r = await fetch("/api/docs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
    const { id } = await r.json();
    window.open(kind === "doc" ? `/doc/${id}` : kind === "sheet" ? `/sheet/${id}` : `/slides/${id}`, "_blank");
  };
  /** File > Make a copy: a new presentation of the viewer's own, media included (after the latest edits are saved). */
  const makeCopy = async () => {
    if (!docId) return;
    setBusy("Making a copy…");
    try {
      await new Promise((r) => setTimeout(r, 2500)); // the collab server saves edits a moment after they are made
      const r = await fetch(`/api/docs/${docId}/copy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { id } = await r.json();
      window.open(`/slides/${id}`, "_blank");
    } catch (e) {
      alert("Could not make a copy: " + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  // Title bar owns the presentation name; keep the collab deck name in sync.
  const onBarTitle = (t: string) => {
    setName(t);
    if (canEdit) ydoc.transact(() => ymeta.set("name", t));
  };

  const activeEditor: Editor | null = editing ? elEditor : selEl === "title" && !masterKey ? titleEditor : bodyEditor;
  textEdRef.current = activeEditor;
  editingRef.current = !!editing;
  const be = () => activeEditor;
  // Autofit (PowerPoint's Format Shape > Text Box): for the selected text box or
  // shape, else for the body placeholder.
  const autofitItems = (): MenuItem[] => {
    const one = selectedElements.length === 1 ? selectedElements[0] : null;
    const el = one && (one.type === "text" || one.type === "shape") ? one : null;
    if (!el && !cur) return [];
    const mode = el ? el.autofit || "none" : cur?.bodyFit === "none" ? "none" : "shrink";
    const set = (m: "none" | "shrink" | "resize") => {
      if (el) patchEl(el.id, { autofit: m === "none" ? undefined : m });
      else setField("bodyFit", m === "none" ? "none" : null);
    };
    return [
      { label: "Autofit: Do not autofit", checked: mode === "none", onClick: () => set("none"), disabled: !canEdit },
      { label: "Autofit: Shrink text on overflow", checked: mode === "shrink", onClick: () => set("shrink"), disabled: !canEdit },
      ...(el ? [{ label: "Autofit: Resize shape to fit text", checked: mode === "resize", onClick: () => set("resize"), disabled: !canEdit }] : []),
    ];
  };
  const slideMenus: Menu[] = [
    {
      label: "File",
      items: [
        { label: "New presentation", onClick: () => newDoc("slide") },
        { label: "New document", onClick: () => newDoc("doc") },
        { label: "New spreadsheet", onClick: () => newDoc("sheet") },
        { divider: true },
        { label: "Open presentation file (.pptx, .odp, .ppt)…", onClick: () => openPptx("replace"), disabled: !canEdit },
        { label: "Insert slides from a file…", onClick: () => openPptx("append"), disabled: !canEdit },
        { divider: true },
        { label: "Download as PowerPoint (.pptx)", onClick: exportPptx },
        { label: "Download as OpenDocument (.odp)", onClick: exportOdp },
        { label: "New slides from an outline or AI…", onClick: () => setDialog("draft"), disabled: !canEdit || !!masterKey },
        { divider: true },
        { label: "Download as PDF…", onClick: () => setDialog("pdf") },
        { label: "Export as video (WebM, MP4)…", onClick: () => setDialog("video") },
        { divider: true },
        { label: "Make a copy", onClick: () => void makeCopy(), disabled: !docId },
        { label: "Version history", onClick: () => { setVersionsOpen(true); setCommentsOpen(false); }, disabled: !docId },
        { label: "Share…", onClick: () => setShareOpen(true), disabled: !canEdit },
        { label: "Print / Save as PDF", onClick: () => window.print(), shortcut: "Ctrl+P" },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", onClick: () => be()?.chain().focus().undo().run(), shortcut: "Ctrl+Z", disabled: !canEdit },
        { label: "Redo", onClick: () => be()?.chain().focus().redo().run(), shortcut: "Ctrl+Y", disabled: !canEdit },
        { divider: true },
        { label: "Select all text", onClick: () => be()?.chain().focus().selectAll().run(), disabled: !canEdit },
        { label: "Find…", onClick: () => setFindOpen("find"), shortcut: "Ctrl+F" },
        { label: "Replace…", onClick: () => setFindOpen("replace"), shortcut: "Ctrl+H", disabled: !canEdit },
        { divider: true },
        { label: "Select all objects", onClick: selectAllObjects, shortcut: "Ctrl+A", disabled: !cur?.elements.length },
        { label: selectedElements.length > 1 ? "Duplicate objects" : "Duplicate object", onClick: () => duplicateSelected(), shortcut: "Ctrl+D", disabled: !canEdit || !selectedElements.length },
        { label: selectedElements.length > 1 ? "Delete objects" : "Delete object", onClick: deleteSelected, shortcut: "Del", disabled: !canEdit || !selectedElements.length },
      ],
    },
    {
      label: "Arrange",
      items: [
        { label: "Bring to front", onClick: () => arrange("front"), disabled: !canEdit || !selectedEl },
        { label: "Bring forward", onClick: () => arrange("forward"), disabled: !canEdit || !selectedEl },
        { label: "Send backward", onClick: () => arrange("backward"), disabled: !canEdit || !selectedEl },
        { label: "Send to back", onClick: () => arrange("back"), disabled: !canEdit || !selectedEl },
        { divider: true },
        { label: "Group", onClick: groupSel, shortcut: "Ctrl+G", disabled: !canEdit || selectedIds.length < 2 },
        { label: "Ungroup", onClick: ungroupSel, shortcut: "Ctrl+Shift+G", disabled: !canEdit || !selectedElements.some((e) => e.group) },
        { divider: true },
        ...([["left", "Align left"], ["center", "Align center"], ["right", "Align right"], ["top", "Align top"], ["middle", "Align middle"], ["bottom", "Align bottom"]] as const).map(([k, l]) => ({ label: l, onClick: () => alignSel(k), disabled: !canEdit || !selectedElements.length })),
        { label: "Distribute horizontally", onClick: () => distributeSel("horizontal"), disabled: !canEdit || !selectedElements.length },
        { label: "Distribute vertically", onClick: () => distributeSel("vertical"), disabled: !canEdit || !selectedElements.length },
        { divider: true },
        { label: "Rotate right 90°", onClick: () => rotate("right"), disabled: !canEdit || !selectedEl },
        { label: "Rotate left 90°", onClick: () => rotate("left"), disabled: !canEdit || !selectedEl },
        { label: "Flip horizontal", onClick: () => rotate("flipH"), disabled: !canEdit || !selectedEl },
        { label: "Flip vertical", onClick: () => rotate("flipV"), disabled: !canEdit || !selectedEl },
      ],
    },
    {
      label: "Insert",
      items: [
        { label: "New slide", onClick: () => add(), shortcut: "Ctrl+M", disabled: !canEdit },
        { label: "Duplicate slide", onClick: () => duplicate(), disabled: !canEdit },
        { divider: true },
        { label: "Text box", onClick: insertText, disabled: !canEdit },
        { label: "Picture…", onClick: () => imageInput.current?.click(), disabled: !canEdit },
        { label: "Video or audio…", onClick: () => mediaInput.current?.click(), disabled: !canEdit || !!masterKey },
        { label: "3D model…", onClick: () => modelInput.current?.click(), disabled: !canEdit || !!masterKey },
        { label: "Rectangle", onClick: () => insertShape("rect"), disabled: !canEdit },
        { label: "Oval", onClick: () => insertShape("ellipse"), disabled: !canEdit },
        { label: "Arrow", onClick: () => insertShape("rightArrow"), disabled: !canEdit },
        { label: "Line", onClick: () => insertShape("line"), disabled: !canEdit },
        { label: "Table (3 × 3)", onClick: () => insertTable(3, 3), disabled: !canEdit || !!masterKey },
        { label: "Icon…", onClick: () => setDialog("icon"), disabled: !canEdit },
        { label: "SmartArt graphic…", onClick: () => setDialog("diagram"), disabled: !canEdit || !!masterKey },
        { label: "Equation…", onClick: () => { setMathEdit(null); setDialog("math"); }, disabled: !canEdit },
        { label: "Summary zoom…", onClick: () => setDialog("zoom-summary"), disabled: !canEdit || !!masterKey },
        { label: "Section zoom…", onClick: () => setDialog("zoom-section"), disabled: !canEdit || !!masterKey },
        { label: "Slide zoom…", onClick: () => setDialog("zoom-slide"), disabled: !canEdit || !!masterKey },
        ...CHART_TYPES.map((t) => ({ label: `Chart: ${t.label.replace(/ \(.*\)$/, "")}`, onClick: () => insertChart(t.id), disabled: !canEdit || !!masterKey })),
        { divider: true },
        { label: "Header & footer…", onClick: () => setDialog("hf"), disabled: !canEdit },
        { label: "Comment", onClick: newComment, shortcut: "Ctrl+Alt+M", disabled: !canComment || !!masterKey },
        { divider: true },
        { label: "Bulleted list", onClick: () => be()?.chain().focus().toggleBulletList().run(), disabled: !canEdit },
        { label: "Numbered list", onClick: () => be()?.chain().focus().toggleOrderedList().run(), disabled: !canEdit },
      ],
    },
    {
      label: "Format",
      items: [
        { label: "Bold", onClick: () => be()?.chain().focus().toggleBold().run(), shortcut: "Ctrl+B", disabled: !canEdit },
        { label: "Italic", onClick: () => be()?.chain().focus().toggleItalic().run(), shortcut: "Ctrl+I", disabled: !canEdit },
        { label: "Underline", onClick: () => be()?.chain().focus().toggleUnderline().run(), shortcut: "Ctrl+U", disabled: !canEdit },
        { label: "Strikethrough", onClick: () => be()?.chain().focus().toggleStrike().run(), disabled: !canEdit },
        { divider: true },
        { label: "Align left", onClick: () => be()?.chain().focus().setTextAlign("left").run(), disabled: !canEdit },
        { label: "Align center", onClick: () => be()?.chain().focus().setTextAlign("center").run(), disabled: !canEdit },
        { label: "Align right", onClick: () => be()?.chain().focus().setTextAlign("right").run(), disabled: !canEdit },
        { divider: true },
        { label: "Clear formatting", onClick: () => be()?.chain().focus().unsetAllMarks().run(), disabled: !canEdit },
        { label: "Format painter", checked: !!painter, onClick: () => startPainter(false), disabled: !canEdit || (!painter && !selectedEl && !!activeEditor?.state.selection.empty) },
        { divider: true },
        ...autofitItems(),
      ],
    },
    {
      label: "Slide",
      items: [
        { label: "New slide", onClick: () => add(), disabled: !canEdit },
        { label: "Duplicate slide", onClick: () => duplicate(), disabled: !canEdit },
        { label: "Delete slide", onClick: () => remove(selIdx), disabled: !canEdit },
        { label: cur?.hidden ? "Show slide" : "Hide slide", onClick: () => toggleHidden(), disabled: !canEdit },
        { divider: true },
        { label: "Move slide up", onClick: () => move(selIdx, -1), disabled: !canEdit },
        { label: "Move slide down", onClick: () => move(selIdx, 1), disabled: !canEdit },
        { divider: true },
        ...layoutKeys(masters).filter((k) => !k.master).map((l) => ({ label: `Layout: ${l.group ? `${l.group} · ` : ""}${l.label}`, checked: !!cur && layoutKeyOf(cur, masters) === l.id, onClick: () => setLayout(l.id), disabled: !canEdit })),
        { divider: true },
        { label: "Reset background", onClick: () => setBg(null), disabled: !canEdit },
        { label: "Apply background to all slides", onClick: applyBgToAll, disabled: !canEdit || !!masterKey },
        { divider: true },
        { label: "Add section", onClick: addSection, disabled: !canEdit || !!masterKey },
        { label: "Rename section", onClick: () => renameSection(), disabled: !canEdit || !sectionAt(selIdx) || !!masterKey },
        { label: "Remove section", onClick: () => removeSection(), disabled: !canEdit || !sectionAt(selIdx) || !!masterKey },
      ],
    },
    {
      label: "Design",
      items: [
        ...THEMES.map((t) => ({ label: `Theme: ${t.name}`, checked: meta.theme === t.id, onClick: () => setMetaField("theme", t.id), disabled: !canEdit })),
        { divider: true },
        { label: "Customize theme colours and fonts…", onClick: () => setDialog("theme"), disabled: !canEdit },
        { divider: true },
        ...SLIDE_SIZES.map((s) => ({ label: `Slide size: ${s.label}`, checked: s.w === W && s.h === H, onClick: () => setSlideSize(s.w, s.h), disabled: !canEdit })),
        { label: "Hide background graphics", checked: !!cur?.hideUnder, onClick: () => setField("hideUnder", cur?.hideUnder ? null : "1"), disabled: !canEdit || !!masterKey },
        { label: "Custom slide size…", checked: !SLIDE_SIZES.some((s) => s.w === W && s.h === H), onClick: () => setDialog("size"), disabled: !canEdit },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Slide show from beginning", onClick: () => startShow(0), shortcut: "F5" },
        { label: "Slide show from current slide", onClick: () => setShow({ mode: "show", start: selIdx }), shortcut: "Shift+F5" },
        { label: "Presenter view", onClick: () => startShow(selIdx, "presenter") },
        { divider: true },
        { label: "Slide master", checked: !!masterKey, onClick: () => openMaster(masterKey ? null : "master"), disabled: !canEdit },
        { label: "Comments", checked: commentsOpen, onClick: () => setCommentsOpen((v) => !v), disabled: !docId },
        { divider: true },
        { label: "Normal", checked: !sorter, onClick: () => setSorter(false) },
        { label: "Slide sorter", checked: sorter, onClick: () => setSorter(true) },
        { label: "Transitions & animations pane", checked: animPanel, onClick: () => setAnimPanel((v) => !v) },
        { label: "Designer pane", checked: designerOpen, onClick: () => setDesignerOpen((v) => !v) },
        { divider: true },
        { label: "Zoom to fit", checked: zoom === null, onClick: () => setZoom(null) },
        { label: "Zoom 100%", checked: zoom === 1, onClick: () => setZoom(1) },
        { label: "Full screen", onClick: () => document.documentElement.requestFullscreen?.() },
      ],
    },
    {
      label: "Slide Show",
      items: [
        { label: "From beginning", onClick: () => startShow(0), shortcut: "F5" },
        { label: "From current slide", onClick: () => setShow({ mode: "show", start: selIdx }), shortcut: "Shift+F5" },
        { label: "Presenter view", onClick: () => startShow(selIdx, "presenter") },
        ...(meta.shows || []).map((x) => ({ label: `Custom show: ${x.name}`, onClick: () => setShow({ mode: "show" as const, start: 0, custom: x.id }) })),
        { label: "Custom shows…", onClick: () => setDialog("shows"), disabled: !canEdit },
        { label: "Set up slide show…", onClick: () => setDialog("setup"), disabled: !canEdit },
        { label: "Rehearse timings", onClick: () => setShow({ mode: "show", start: 0, rehearse: true }), disabled: !canEdit },
        { label: "Record slide show (narration and ink)…", onClick: () => setShow({ mode: "show", start: 0, rehearse: true, record: true }), disabled: !canEdit },
        { label: "Clear narrations", onClick: clearNarrations, disabled: !canEdit || !slides.some((x) => x.elements.some((e) => e.type === "media" && e.narration)) },
        { label: "Loop until Esc", checked: !!meta.show?.loop, onClick: () => setShowSettings({ ...(meta.show || {}), loop: meta.show?.loop ? undefined : true }), disabled: !canEdit },
        { label: "Use timings", checked: meta.show?.useTimings !== false, onClick: () => setShowSettings({ ...(meta.show || {}), useTimings: meta.show?.useTimings === false ? undefined : false }), disabled: !canEdit },
      ],
    },
    {
      label: "Review",
      items: [
        { label: "Check accessibility", checked: review === "a11y", onClick: () => setReview((v) => (v === "a11y" ? null : "a11y")) },
        { label: "Spelling…", checked: review === "spell", onClick: () => setReview((v) => (v === "spell" ? null : "spell")), shortcut: "F7" },
        { divider: true },
        { label: "Comments", checked: commentsOpen, onClick: () => setCommentsOpen((v) => !v), disabled: !docId },
      ],
    },
    { label: "Help", items: [{ label: "About SynergyDocs", onClick: () => alert("SynergyDocs — presentations on the Synergy platform.") }] },
  ];

  const toolbarActions: ToolbarActions = {
    addSlide: add,
    setLayout,
    layouts: layoutKeys(masters).filter((k) => !k.master),
    layoutKey: cur && !masterKey ? layoutKeyOf(cur, masters) : "content",
    insertText,
    insertImage: () => imageInput.current?.click(),
    insertMedia: () => mediaInput.current?.click(),
    insertModel: () => modelInput.current?.click(),
    turnModel: (t) => selEl && turnModel(selEl, t),
    insertShape,
    insertTable,
    insertChart,
    setBg,
    setBgGrad,
    patchEl: (p) => selEl && patchEl(selEl, p),
    arrange,
    rotate,
    align: alignSel,
    distribute: distributeSel,
    group: groupSel,
    ungroup: ungroupSel,
    selCount: selectedIds.length,
    selGrouped: selectedElements.some((e) => e.group),
    deleteEl: () => (selectedIds.length ? deleteSelected() : selEl && deleteEl(selEl)),
    selectAllObjects,
    showFrom: (current) => setShow({ mode: "show", start: current ? selIdx : 0 }),
    toggleAnim: () => setAnimPanel((v) => !v),
    toggleDesigner: () => setDesignerOpen((v) => !v),
    pointsOn: !!pointsEl && pointsEl === selEl,
    editPoints: () => {
      const e = selEl ? readEl(selEl) : null;
      if (!e || e.type !== "shape" || !canEdit) return;
      if (pointsEl === e.id) return setPointsEl(null);
      // a preset shape becomes a freeform of its outline first
      if (e.shape !== "freeform" || !e.geom) {
        const w = Math.max(1, e.w), h = Math.max(1, e.h);
        writeEl({ ...e, shape: "freeform", geom: { w, h, d: normalizePath(shapePath(e.shape, w, h)) } });
      }
      setEditing(null);
      setPointsEl(e.id);
    },
    pen,
    togglePen: (mode?: "free" | "poly") => { setPoly(null); setPen((v) => (mode ? (v === mode ? false : mode) : !v)); setEditing(null); },
    painter: !!painter,
    startPainter,
    insertIcon: () => setDialog("icon"),
    insertDiagram: () => { setDiagramEdit(null); setDialog("diagram"); },
    diagramSel: !!selDiagram,
    editDiagram: () => {
      if (!selDiagram || !canEdit) return;
      setDiagramEdit(selDiagram.id);
      setDialog("diagram");
    },
    insertMath: () => { setMathEdit(null); setDialog("math"); },
  };

  const tb = curView ? titleBox(curView, W, H) : undefined;
  const bb = curView ? bodyBox(curView, W, H) : undefined;
  /** Where an animated target sits (motion paths start at its centre). */
  const animBox = (key: string): Box | undefined => (key === "title" ? tb : key === "body" ? bb : cur?.elements.find((e) => e.id === key));
  /** The motion path effects of a target, each starting where the one before left it. */
  const motionPaths = (key: string) => {
    const b = animBox(key);
    if (!b || !cur) return [];
    let o = pathOrigin(b);
    return effectsOf(cur, key).flatMap((a, idx) => {
      if (animKind(a) !== "path" || !a.path) return [];
      const at = o;
      const end = pathEnd(a.path);
      o = { x: o.x + end.x * W, y: o.y + end.y * H };
      return [{ idx, a, origin: at }];
    });
  };
  const finishMotion = (m: NonNullable<typeof motion>, closed = false) => {
    setMotion(null);
    const path = m.mode === "lines" ? linesToPath(m.pts, W, H, closed) : scribbleToPath(m.pts, W, H);
    const a = cur ? effectsOf(cur, m.key)[m.idx] : undefined;
    if (path && a) setAnim(m.key, { ...a, path }, m.idx);
  };
  const motionDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !motion) return;
    e.preventDefault();
    e.stopPropagation();
    const p = slidePoint(e);
    if (motion.mode === "lines") {
      // a click on the start closes the path
      if (motion.pts.length > 2 && Math.hypot(p.x - motion.pts[0].x, p.y - motion.pts[0].y) <= 8 / scale) return finishMotion(motion, true);
      setMotion({ ...motion, pts: [...motion.pts, p], hover: p });
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const pts = [p];
    const m0 = motion;
    const move = (ev: PointerEvent) => {
      const q = { x: Math.round(((ev.clientX - rect.left) / scale) * 10) / 10, y: Math.round(((ev.clientY - rect.top) / scale) * 10) / 10 };
      const last = pts[pts.length - 1];
      if (Math.hypot(q.x - last.x, q.y - last.y) < 1.5) return;
      pts.push(q);
      setMotion({ ...m0, pts: [...pts] });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      finishMotion({ ...m0, pts });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  /** An uploaded animation sound: in the document's media store (a data URL without one). */
  const uploadSound = async (f: File): Promise<AnimSound | null> => {
    const name = f.name.replace(/\.\w+$/, "") || "Sound";
    try {
      if (docId) return { src: (await uploadMedia(docId, f, f.name, mediaMime(f.type, f.name))).url, name };
      return { src: await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(f); }), name };
    } catch (err) {
      alert("Could not add the sound: " + (err as Error).message);
      return null;
    }
  };

  const rail = masterKey ? (
    <aside className="w-52 border-r border-slate-200 bg-slate-50 overflow-y-auto p-3 space-y-3 shrink-0 no-print" data-testid="master-rail">
      {layoutKeys(masters).map((k) => (
        <button key={k.id} data-testid="master-thumb" data-key={k.id} onClick={() => openMaster(k.id)} className={`block text-left ${k.master ? (k.id === "master" ? "" : "pt-3 border-t border-slate-200") : "pl-5"}`}>
          <div className="text-[11px] text-slate-500 mb-0.5 truncate max-w-[9.5rem]">{k.label}{isCustomKey(k.id) ? <span className="text-slate-400"> · custom</span> : null}</div>
          <div className={`rounded border bg-white overflow-hidden ${k.id === masterKey ? "border-indigo-500 ring-2 ring-indigo-200" : "border-slate-200 hover:border-slate-300"}`}>
            <ScaledSlide slide={masterView(k.id)} look={look} width={k.master ? 164 : 144} />
          </div>
        </button>
      ))}
      {canEdit && (
        <div className="pl-5 flex flex-wrap gap-1 text-xs">
          <button data-testid="layout-new" className="rounded border border-slate-300 bg-white px-2 py-1 hover:bg-slate-100" onClick={newLayout}>＋ New layout</button>
          <button data-testid="master-new" className="rounded border border-slate-300 bg-white px-2 py-1 hover:bg-slate-100" onClick={newMaster}>＋ New master</button>
          {masterKey && !isMasterKey(masterKey) && (
            <select
              data-testid="layout-placeholder"
              aria-label="Insert placeholder"
              className="rounded border border-slate-300 bg-white px-1 py-1"
              value=""
              onChange={(e) => {
                const k = e.target.value as SlotKind;
                if (k) addEl({ type: "text", html: "", slot: k, ...centerBox(Math.round(W * 0.4), Math.round(H * 0.4)) });
              }}
            >
              <option value="">＋ Placeholder…</option>
              {SLOT_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          )}
          {masterKey && (isCustomKey(masterKey) || isAddedMaster(masterKey)) && (
            <>
              <button data-testid="layout-rename" className="rounded border border-slate-300 bg-white px-2 py-1 hover:bg-slate-100" onClick={renameLayout}>Rename</button>
              <button data-testid="layout-delete" className="rounded border border-slate-300 bg-white px-2 py-1 hover:bg-red-50 hover:text-red-700" onClick={deleteLayout}>Delete</button>
            </>
          )}
        </div>
      )}
    </aside>
  ) : (
    <aside className="w-52 border-r border-slate-200 bg-slate-50 overflow-y-auto p-3 space-y-2 shrink-0 no-print" data-testid="slide-rail">
      {slides.map((s, i) => {
        const sec = sections.find((x) => x.start === i);
        const owner = sectionAt(i);
        const folded = !!owner && collapsed.has(slides[owner.start]?.id);
        return (
          <Fragment key={s.id}>
            {sec && (
              <div className="group flex items-center gap-1 pt-1 text-xs text-slate-600" data-testid="section-header">
                <button
                  data-testid="section-toggle"
                  className="w-4 text-slate-400 hover:text-slate-700"
                  title={collapsed.has(s.id) ? "Expand section" : "Collapse section"}
                  onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })}
                >
                  {collapsed.has(s.id) ? "▸" : "▾"}
                </button>
                <span data-testid="section-name" className="font-medium truncate" onDoubleClick={() => renameSection(i)} title="Double-click to rename">{sec.name}</span>
                <span className="text-slate-400">({sec.end - sec.start})</span>
                {canEdit && <button data-testid="section-remove" title="Remove section (keeps the slides)" className="ml-auto hidden group-hover:block text-slate-400 hover:text-red-500" onClick={() => removeSection(i)}>✕</button>}
              </div>
            )}
            {!folded && (
          <div
            key={s.id}
            data-testid="slide-thumb"
            draggable={canEdit}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/x-slide", String(i));
              setDragSlide({ from: i, over: i });
            }}
            onDragOver={(e) => {
              if (!dragSlide) return;
              e.preventDefault();
              if (dragSlide.over !== i) setDragSlide({ ...dragSlide, over: i });
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragSlide) moveTo(dragSlide.from, i);
              setDragSlide(null);
            }}
            onDragEnd={() => setDragSlide(null)}
            onClick={() => setSel(i)}
            className={`group relative flex gap-1.5 cursor-pointer ${dragSlide && dragSlide.over === i && dragSlide.from !== i ? (dragSlide.from < i ? "pb-2 border-b-2 border-indigo-500" : "pt-2 border-t-2 border-indigo-500") : ""}`}
          >
            <span className="text-[11px] text-slate-400 w-4 shrink-0 text-right pt-0.5">{i + 1}</span>
            <div className={`relative rounded border bg-white overflow-hidden ${i === selIdx ? "border-indigo-500 ring-2 ring-indigo-200" : "border-slate-200 hover:border-slate-300"} ${s.hidden ? "opacity-50" : ""}`}>
              <ScaledSlide slide={view[i] || s} look={look} width={164} />
              {s.hidden && <span className="absolute bottom-0.5 right-1 text-[10px] text-slate-600 bg-white/80 rounded px-1">hidden</span>}
            {openComments(i) > 0 && <span data-testid="thumb-comments" title="Comments" className="absolute top-0.5 right-1 text-[10px] text-amber-900 bg-amber-200 rounded px-1">💬 {openComments(i)}</span>}
            </div>
            {canEdit && (
              <div className="absolute top-1 right-1 hidden group-hover:flex gap-0.5 bg-white/90 rounded shadow-sm">
                <button title="Move up" onClick={(e) => { e.stopPropagation(); move(i, -1); }} className="text-[10px] text-slate-500 hover:text-slate-800 px-1">↑</button>
                <button title="Move down" onClick={(e) => { e.stopPropagation(); move(i, 1); }} className="text-[10px] text-slate-500 hover:text-slate-800 px-1">↓</button>
                <button title="Duplicate" onClick={(e) => { e.stopPropagation(); duplicate(i); }} className="text-[10px] text-slate-500 hover:text-slate-800 px-1">⧉</button>
                <button title="Delete" onClick={(e) => { e.stopPropagation(); remove(i); }} className="text-[10px] text-slate-500 hover:text-red-500 px-1">✕</button>
              </div>
            )}
          </div>
            )}
          </Fragment>
        );
      })}
      {canEdit && <button onClick={() => add()} className="w-full text-sm text-indigo-600 hover:bg-indigo-50 rounded-lg py-2 border border-dashed border-indigo-200">+ Add slide</button>}
    </aside>
  );

  const titleRows = Math.max(1, (cur?.title || "").split("\n").length);

  return (
    <DeckSlides.Provider value={deckCtx}>
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-slate-200 no-print">
        <AppTitleBar
          key={titleKey}
          docId={docId || ""}
          icon="▭"
          initialTitle={name || initialName}
          initialStarred={starred}
          role={role}
          meEmail={user?.email || ""}
          menus={slideMenus}
          status={status === "local" ? null : status}
          peers={peers}
          onTitle={onBarTitle}
          shareOpen={shareOpen}
          onShareOpen={setShareOpen}
          rightExtra={
            <>
              {docId && (
                <button onClick={() => setCommentsOpen((v) => !v)} data-testid="btn-comments" title="Comments" className={`text-[13px] rounded-lg px-3 py-1.5 ${commentsOpen ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 hover:bg-slate-200 text-slate-700"}`}>
                  💬 {threads.filter((t) => !t.resolved && decodeAnchor(t.quote)).length || ""}
                </button>
              )}
              <button onClick={() => setShow({ mode: "show", start: 0 })} className="text-[13px] rounded-lg px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700" data-testid="btn-slideshow">
                ▶ Slide show
              </button>
              <button onClick={exportPptx} disabled={!!busy} className="text-[13px] rounded-lg px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-50">
                {busy || "Save as .pptx"}
              </button>
            </>
          }
        />
      </div>

      {canEdit && !sorter && (
        <div className="no-print">
          <SlideToolbar editor={activeEditor} el={selectedEl} layout={cur?.layout || "content"} bg={cur?.bg || ""} bgGrad={cur?.bgGrad} a={toolbarActions}
            tableTools={selectedEl?.type === "table" ? (
              <TableTools
                el={selectedEl}
                sel={cellSel?.id === selectedEl.id ? cellSel.rect : null}
                onSel={(rect) => setCellSel(rect ? { id: selectedEl.id, rect } : null)}
                onPatch={(p) => patchEl(selectedEl.id, p as Partial<SlideElement>)}
                theme={theme}
              />
            ) : undefined}
          />
          {selectedElements.length > 1 && <MultiSelectionBar
            count={selectedElements.length}
            onAlign={alignSel}
            onDistribute={distributeSel}
            onGroup={groupSel}
            onDuplicate={() => duplicateSelected()}
            onDelete={deleteSelected}
            onClear={() => setSelEl(null)}
          />}
        </div>
      )}
      {!canEdit && <div className="bg-white border-b border-slate-200 px-4 py-1.5 text-xs text-slate-400 no-print">View only — you don’t have permission to edit this presentation.</div>}
      {notice && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-1.5 text-xs text-amber-800 flex items-start gap-2 no-print" data-testid="import-notice">
          <div className="flex-1 space-y-0.5">
            {notice.map((n, i) => (
              <div key={i}>{n}</div>
            ))}
          </div>
          <button onClick={() => setNotice(null)} className="text-amber-700 hover:text-amber-900">✕</button>
        </div>
      )}

      <input ref={imageInput} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) insertImageFile(f); e.target.value = ""; }} />
      <input ref={modelInput} data-testid="model-input" type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) insertModelFile(f); e.target.value = ""; }} />
      <input ref={mediaInput} data-testid="media-input" type="file" accept="video/*,audio/*,.mp4,.m4v,.mov,.webm,.mp3,.m4a,.wav,.ogg" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) insertMediaFile(f); e.target.value = ""; }} />
      <input ref={pptxInput} type="file" accept=".pptx,.odp,.ppt,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.oasis.opendocument.presentation,application/vnd.ms-powerpoint" className="hidden" data-testid="pptx-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f, pptxMode.current); e.target.value = ""; }} />

      {sorter ? (
        <div className="flex-1 min-h-0 overflow-y-auto bg-slate-100 p-6 no-print">
          <div className="flex flex-wrap gap-5">
            {slides.map((s, i) => (
              <div
                key={s.id}
                draggable={canEdit}
                onDragStart={() => setDragSlide({ from: i, over: i })}
                onDragOver={(e) => { e.preventDefault(); if (dragSlide && dragSlide.over !== i) setDragSlide({ ...dragSlide, over: i }); }}
                onDrop={(e) => { e.preventDefault(); if (dragSlide) moveTo(dragSlide.from, i); setDragSlide(null); }}
                onDoubleClick={() => { setSel(i); setSorter(false); }}
                onClick={() => setSel(i)}
                className="cursor-pointer"
              >
                <div className={`rounded border bg-white overflow-hidden ${i === selIdx ? "ring-2 ring-indigo-400 border-indigo-500" : "border-slate-300"} ${s.hidden ? "opacity-50" : ""}`}>
                  <ScaledSlide slide={view[i] || s} look={look} width={240} />
                </div>
                <div className="text-xs text-slate-500 mt-1">{i + 1}{s.hidden ? " · hidden" : ""}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex no-print">
          {rail}

          {/* the editable slide (WYSIWYG at real size, scaled to fit) */}
          <main className="relative flex-1 min-w-0 flex flex-col bg-slate-100">
            {findOpen && (
              <FindReplace
                slides={slides}
                current={selIdx}
                canEdit={canEdit}
                replaceMode={findOpen === "replace"}
                onGo={goToHit}
                onReplace={replaceHit}
                onReplaceAll={replaceAll}
                onClose={() => setFindOpen(null)}
              />
            )}
            <div
              ref={stageRef}
              className="flex-1 min-h-0 overflow-auto"
              onPointerDown={() => { setSelEl(null); setEditing(null); }}
              onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
              onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); onDropFiles(e.dataTransfer.files); } }}
            >
              {cur && (
                <div className="relative mx-auto my-6 shadow-md bg-white" style={{ width: W * scale, height: H * scale }} data-testid="slide-canvas">
                  <div onPointerDown={startMarquee} style={{ position: "absolute", left: 0, top: 0, width: W, height: H, transform: `scale(${scale})`, transformOrigin: "0 0", isolation: "isolate" }}>
                    <SlideBackground slide={curView || cur} look={look} />
                    <UnderLayer slide={curView || cur} look={look} />
                    {!masterKey && <FooterLayer slide={curView || cur} look={look} />}
                    {!masterKey && canEdit && (curView?.slots || []).map((sl) => (
                      <SlotPrompt key={`slot-${sl.id}`} el={sl} scale={scale} onFill={(kind) => fillSlot(sl, kind)} />
                    ))}
                    {pointsEl && pointsEl === selEl && (() => {
                      const pe = cur.elements.find((x) => x.id === pointsEl);
                      return pe?.type === "shape" && pe.geom ? <PointEditor el={pe as ShapeEl & { geom: NonNullable<ShapeEl["geom"]> }} scale={scale} onChange={({ geom, box }) => patchEl(pe.id, { geom, ...box } as Partial<SlideElement>)} /> : null;
                    })()}
                    {cur.elements.map((el) => {
                      const isSel = selectedIds.includes(el.id);
                      const isEditing = editing === el.id;
                      const textual = el.type === "text" || (el.type === "shape" && !isLineShape(el.shape));
                      const preview = groupPreview && isSel && groupPreview.anchorId !== el.id ? groupPreview : null;
                      return (
                        <ElementFrame
                          key={el.id}
                          testId={`el-${el.type}`}
                          elId={el.id}
                          onRotate={(deg) => patchEl(el.id, { rot: deg || undefined })}
                          box={preview ? { ...el, x: el.x + preview.dx, y: el.y + preview.dy } : el}
                          z={el.z}
                          rot={el.rot}
                          scale={scale}
                          selected={isSel}
                          showHandles={selectedElements.length <= 1}
                          canEdit={canEdit}
                          movableFromBody={!isEditing}
                          lockAspect={el.type === "image"}
                          minH={isLineShape(el.type === "shape" ? el.shape : "") ? 1 : 8}
                          snap={(box, moving) => {
                            if (moving && groupBounds && isSel) {
                              const moved = { ...groupBounds, x: groupBounds.x + box.x - el.x, y: groupBounds.y + box.y - el.y };
                              const snapped = snap(moved, true);
                              return { ...box, x: el.x + snapped.x - groupBounds.x, y: el.y + snapped.y - groupBounds.y };
                            }
                            return snap(box, moving);
                          }}
                          onSelect={(e) => {
                            if (painter && canEdit && paintOnto(el.id)) return;
                            clickSelect(el.id, e.shiftKey || e.ctrlKey || e.metaKey);
                            if (editing && editing !== el.id) setEditing(null);
                          }}
                          onPreview={(box) => {
                            if (selectedElements.length > 1 && isSel) setGroupPreview(box ? { anchorId: el.id, dx: box.x - el.x, dy: box.y - el.y } : null);
                          }}
                          onCommit={(box) => {
                            if (selectedElements.length > 1 && isSel) moveSelected(box.x - el.x, box.y - el.y);
                            else patchEl(el.id, box);
                          }}
                          onDoubleClick={() => { if (canEdit && el.type === "math") { setSelEl(el.id); editMath(el.id); } else if (canEdit && (textual || el.type === "table")) { setSelEl(el.id); setEditing(el.id); } }}
                        >
                          {isEditing && textual ? (
                            <ElementContent el={el} look={look}>
                              <RichBox
                                html={el.type === "text" ? el.html : el.html || ""}
                                onChange={(html) => editText(el.id, html)}
                                onReady={setElEditor}
                              />
                            </ElementContent>
                          ) : isEditing && el.type === "table" ? (
                            <TableEditor
                              el={el}
                              look={look}
                              sel={cellSel?.id === el.id ? cellSel.rect : null}
                              onSel={(rect) => setCellSel({ id: el.id, rect })}
                              onChange={(rows) => patchEl(el.id, { rows } as Partial<SlideElement>)}
                              onAppendRow={() => patchEl(el.id, insertRow(el, el.rows.length) as Partial<SlideElement>)}
                              onResize={canEdit ? (p) => patchEl(el.id, p as Partial<SlideElement>) : undefined}
                            />
                          ) : (
                            <ElementContent el={modelTurn?.id === el.id && el.type === "model3d" ? { ...el, ...modelTurn.t } : el} look={look} />
                          )}
                          {el.type === "media" && isSel && selectedElements.length <= 1 && <CanvasPlayer el={el} scale={scale} />}
                          {el.type === "model3d" && isSel && canEdit && selectedElements.length <= 1 && (
                            <ModelTurnHandle el={el} scale={scale} onLive={(t) => setModelTurn(t ? { id: el.id, t } : null)} onDone={(t) => turnModel(el.id, t)} />
                          )}
                        </ElementFrame>
                      );
                    })}
                    {[...animBadges].map(([key, n]) => {
                      const b = key === "title" ? tb : key === "body" ? bb : cur.elements.find((e) => e.id === key);
                      return b ? (
                        <div key={`badge-${key}`} data-testid="anim-badge" style={{ position: "absolute", left: b.x - 22 / scale, top: b.y, zIndex: 100000, transform: `scale(${1 / scale})`, transformOrigin: "100% 0" }} className="pointer-events-none bg-slate-700 text-white text-[11px] leading-none rounded px-1 py-0.5 tabular-nums">
                          {n}
                        </div>
                      ) : null;
                    })}
                    {!masterKey && commentsBySlide.get(cur.id)?.filter((x) => !x.t.resolved).map(({ t, a }) => (
                      <button
                        key={`pin-${t.id}`}
                        data-testid="comment-pin"
                        title={`${t.messages[0]?.author_name || ""}: ${t.messages[0]?.body || ""}`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => { setCommentsOpen(true); setFocusThread(t.id); }}
                        style={{ position: "absolute", left: a.x, top: a.y, zIndex: 100001, transform: `scale(${1 / scale})`, transformOrigin: "0 0" }}
                        className={`grid h-7 min-w-7 place-items-center rounded-full rounded-bl-none px-1.5 text-[11px] font-semibold text-white shadow ${focusThread === t.id ? "ring-2 ring-indigo-300" : ""}`}
                      >
                        <span className="pointer-events-none rounded-full rounded-bl-none px-1.5 py-1 leading-none" style={{ background: "#f59e0b" }}>{t.messages.length > 1 ? `💬${t.messages.length}` : "💬"}</span>
                      </button>
                    ))}
                    {groupBounds && (() => {
                      const gb = groupResize || { ...groupBounds, x: groupBounds.x + (groupPreview?.dx || 0), y: groupBounds.y + (groupPreview?.dy || 0) };
                      const hs = 9 / scale;
                      const spots: [string, number, number][] = [["nw", 0, 0], ["n", 0.5, 0], ["ne", 1, 0], ["e", 1, 0.5], ["se", 1, 1], ["s", 0.5, 1], ["sw", 0, 1], ["w", 0, 0.5]];
                      return (
                        <div data-testid="group-bounds" style={{ position: "absolute", left: gb.x, top: gb.y, width: gb.w, height: gb.h, zIndex: Math.max(1000, maxZ() + 1), border: `${1.5 / scale}px dashed #4f46e5`, pointerEvents: "none" }}>
                          {canEdit && !groupPreview && spots.map(([h, fx, fy]) => (
                            <div
                              key={h}
                              data-testid={`group-handle-${h}`}
                              onPointerDown={startGroupResize(h)}
                              style={{ position: "absolute", left: fx * gb.w - hs / 2, top: fy * gb.h - hs / 2, width: hs, height: hs, background: "#fff", border: `${1.5 / scale}px solid #4f46e5`, borderRadius: 2 / scale, pointerEvents: "auto", cursor: `${h}-resize` }}
                            />
                          ))}
                        </div>
                      );
                    })()}
                    {pen && (
                      <div data-testid="pen-layer" data-mode={pen} onPointerDown={startStroke} onDoubleClick={() => pen === "poly" && poly && finishPoly(false)} onPointerMove={(e) => pen === "poly" && poly && setPoly({ ...poly, hover: slidePoint(e) })} style={{ position: "absolute", inset: 0, zIndex: 100002, cursor: "crosshair", touchAction: "none" }}>
                        {pen === "poly" && poly && (
                          <svg width={W} height={H} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                            <polyline data-testid="poly-preview" points={[...poly.pts, ...(poly.hover ? [poly.hover] : [])].map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={`#${look.theme.text}`} strokeWidth={3} strokeLinejoin="round" />
                            {poly.pts.map((p, i) => <rect key={i} x={p.x - 3 / scale} y={p.y - 3 / scale} width={6 / scale} height={6 / scale} fill="#fff" stroke="#4f46e5" strokeWidth={1 / scale} />)}
                          </svg>
                        )}
                        {stroke && stroke.length > 1 && (
                          <svg width={W} height={H} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                            <polyline points={stroke.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={`#${look.theme.text}`} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
                          </svg>
                        )}
                      </div>
                    )}
                    {animPanel && selEl && !motion && motionPaths(selEl).map(({ idx, a, origin }) => {
                      const d = pathSvgD(a.path!, origin, W, H);
                      const end = pathEnd(a.path!);
                      return (
                        <svg key={`mp-${idx}`} data-testid="motion-path" data-idx={idx} width={W} height={H} style={{ position: "absolute", inset: 0, zIndex: 100001, pointerEvents: "none", overflow: "visible" }}>
                          <path d={d} fill="none" stroke="#64748b" strokeWidth={1.5 / scale} strokeDasharray={`${5 / scale} ${4 / scale}`} />
                          <circle cx={origin.x} cy={origin.y} r={5 / scale} fill="#22c55e" stroke="#fff" strokeWidth={1 / scale} />
                          <circle cx={origin.x + end.x * W} cy={origin.y + end.y * H} r={5 / scale} fill="#ef4444" stroke="#fff" strokeWidth={1 / scale} />
                        </svg>
                      );
                    })}
                    {pathEdit && !motion && (() => {
                      const mp = motionPaths(pathEdit.key).find((x) => x.idx === pathEdit.idx);
                      const g = mp && pathToGeom(mp.a.path!, mp.origin, W, H);
                      if (!mp || !g) return null;
                      const fake = { id: "motion-path", type: "shape", shape: "freeform", fill: null, line: "64748B", z: 0, geom: g.geom, ...g.box } as ShapeEl & { geom: NonNullable<ShapeEl["geom"]> };
                      return <PointEditor el={fake} scale={scale} onChange={({ geom, box }) => { const path = geomToPath(geom, box, mp.origin, W, H, g.closed); if (path) setAnim(pathEdit.key, { ...mp.a, path }, pathEdit.idx); }} />;
                    })()}
                    {motion && (
                      <div data-testid="motion-layer" data-mode={motion.mode} onPointerDown={motionDown} onDoubleClick={() => motion.mode === "lines" && finishMotion(motion)} onPointerMove={(e) => motion.mode === "lines" && setMotion({ ...motion, hover: slidePoint(e) })} style={{ position: "absolute", inset: 0, zIndex: 100003, cursor: "crosshair", touchAction: "none" }}>
                        <svg width={W} height={H} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                          <polyline data-testid="motion-preview" points={[...motion.pts, ...(motion.mode === "lines" && motion.hover ? [motion.hover] : [])].map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#0ea5e9" strokeWidth={2 / scale} strokeDasharray={`${6 / scale} ${4 / scale}`} />
                          {motion.mode === "lines" && motion.pts[0] && <circle cx={motion.pts[0].x} cy={motion.pts[0].y} r={5 / scale} fill="#22c55e" />}
                        </svg>
                      </div>
                    )}
                    {marquee && <div data-testid="slide-marquee" style={{ position: "absolute", ...marquee, zIndex: Math.max(1001, maxZ() + 2), border: `${1 / scale}px solid #4f46e5`, background: "rgba(79,70,229,0.12)", pointerEvents: "none" }} />}
                    {tb && (
                      <ElementFrame
                        box={tb}
                        z={0}
                        scale={scale}
                        selected={selEl === "title"}
                        canEdit={canEdit}
                        movableFromBody={false}
                        snap={snap}
                        onSelect={() => { setSelEl("title"); setEditing(null); }}
                        onCommit={(b) => setField("tbox", JSON.stringify(b))}
                        testId="ph-title"
                      >
                        <div style={{ position: "absolute", inset: 0, padding: TEXT_PAD, display: "flex", flexDirection: "column", justifyContent: cur.layout === "title" ? "flex-end" : "center" }}>
                          {!masterKey ? (
                            <div style={titleCss(curView || cur, look)} onPointerDown={(e) => e.stopPropagation()}>
                              <EditorContent editor={titleEditor} />
                            </div>
                          ) : (
                          <textarea
                            data-testid="slide-title"
                            value={cur.title}
                            onChange={(e) => setTitle(e.target.value)}
                            readOnly={!canEdit || !!masterKey}
                            rows={titleRows}
                            placeholder={canEdit ? "Click to add title" : ""}
                            className="bg-transparent outline-none resize-none w-full overflow-hidden placeholder:text-slate-300 placeholder:font-normal"
                            style={{ ...titleCss(curView || cur, look), fieldSizing: "content" } as React.CSSProperties}
                          />
                          )}
                        </div>
                      </ElementFrame>
                    )}
                    {masterKey === "master" && (["date", "footer", "num"] as const).map((k) => {
                      // the footer placeholders sit where the master puts them, for every slide
                      const fb = footerBoxes(W, H, meta.hf)[k];
                      const label = k === "date" ? (meta.hf?.dateAuto ? formatDate(meta.hf.dateAuto) : meta.hf?.date || "Date") : k === "footer" ? meta.hf?.footer || "Footer" : "‹#›";
                      return (
                        <ElementFrame
                          key={`ftr-${k}`}
                          box={fb}
                          z={0}
                          scale={scale}
                          selected={selEl === `ftr-${k}`}
                          canEdit={canEdit}
                          movableFromBody
                          snap={snap}
                          onSelect={() => { setSelEl(`ftr-${k}`); setEditing(null); }}
                          onCommit={(b) => setHf({ ...(meta.hf || {}), boxes: { ...(meta.hf?.boxes || {}), [k]: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) } } })}
                          testId={`ph-ftr-${k}`}
                        >
                          <div style={{ position: "absolute", inset: 0, padding: TEXT_PAD, display: "flex", alignItems: "center", justifyContent: k === "date" ? "flex-start" : k === "num" ? "flex-end" : "center", fontSize: "12pt", color: `#${look.theme.text}`, opacity: 0.6, fontFamily: look.font, whiteSpace: "nowrap", overflow: "hidden", border: `${1 / scale}px dashed #94a3b8` }}>{label}</div>
                        </ElementFrame>
                      );
                    })}
                    {bb && (
                      <ElementFrame
                        box={bb}
                        z={0}
                        scale={scale}
                        selected={selEl === "body"}
                        canEdit={canEdit}
                        movableFromBody={false}
                        snap={snap}
                        onSelect={() => { setSelEl("body"); setEditing(null); }}
                        onCommit={(b) => setField("bbox", JSON.stringify(b))}
                        testId="ph-body"
                      >
                        <ShrinkFit on={cur.bodyFit !== "none"}>
                          <div style={{ position: "absolute", inset: 0, padding: TEXT_PAD, display: "flex", flexDirection: "column", justifyContent: justify(cur.bodyValign), overflow: "visible", ...bodyCss(curView || cur, look) }}>
                            <EditorContent editor={bodyEditor} />
                          </div>
                        </ShrinkFit>
                      </ElementFrame>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* speaker notes */}
            <div className={`shrink-0 border-t border-slate-200 bg-white px-4 py-2 ${masterKey ? "hidden" : ""}`}>
              <textarea
                data-testid="slide-notes"
                value={cur?.notes ?? ""}
                onChange={(e) => setNotes(e.target.value)}
                readOnly={!canEdit}
                placeholder="Click to add speaker notes"
                rows={3}
                className="w-full text-sm border-0 bg-transparent focus:outline-none resize-y text-slate-700"
              />
              <div className="flex items-center gap-3 text-[11px] text-slate-400">
                <span>Slide {selIdx + 1} of {slides.length}</span>
                <span className="ml-auto flex items-center gap-1">
                  <button className="px-1.5 hover:text-slate-700" onClick={() => setZoom(Math.max(0.1, Math.round((scale - 0.1) * 10) / 10))}>−</button>
                  <span className="tabular-nums w-10 text-center">{Math.round(scale * 100)}%</span>
                  <button className="px-1.5 hover:text-slate-700" onClick={() => setZoom(Math.min(3, Math.round((scale + 0.1) * 10) / 10))}>+</button>
                  <button className={`px-1.5 hover:text-slate-700 ${zoom === null ? "text-indigo-600" : ""}`} onClick={() => setZoom(null)}>Fit</button>
                </span>
              </div>
            </div>
          </main>
          {versionsOpen && docId && (
            <VersionPanel docId={docId} canEdit={canEdit} save={saveVersion} lookFor={lookFor} onRestore={restoreVersion} onClose={() => setVersionsOpen(false)} />
          )}
          {commentsOpen && docId && !masterKey && (
            <CommentsPane
              threads={threads}
              slides={slides}
              current={selIdx}
              me={{ name: user?.name || "Me", email: user?.email || "" }}
              canComment={canComment}
              canDelete={canEdit}
              draft={commentDraft}
              focusId={focusThread}
              people={people}
              onPost={postComment}
              onReply={replyComment}
              onResolve={resolveComment}
              onDelete={deleteComment}
              onCancelDraft={() => setCommentDraft(null)}
              onNew={newComment}
              onGo={goToThread}
              onClose={() => { setCommentsOpen(false); setCommentDraft(null); }}
            />
          )}
          {masterKey && cur && (
            <MasterPanel
              masterKey={masterKey}
              slide={masters[masterKey] || cur}
              canEdit={canEdit}
              onTitleStyle={(p) => setMasterStyle("tstyle", p)}
              onBodyStyle={(p) => setMasterStyle("bstyle", p)}
              onBg={setBg}
              onReset={resetLayout}
              onClose={() => openMaster(null)}
            />
          )}
          {review && !masterKey && (
            <ReviewPane tab={review} onTab={setReview} slides={slides} theme={theme} masters={masters} W={W} H={H} act={reviewActs} onClose={() => setReview(null)} />
          )}
          {designerOpen && cur && !masterKey && (
            <DesignerPane slide={cur} look={look} accent={theme.accent} canEdit={canEdit} preview={(x) => applyMaster(x, masters, selIdx + 1)} onApply={applyDesign} onClose={() => setDesignerOpen(false)} />
          )}
          {animPanel && cur && !masterKey && (
            <AnimPanel
              slide={cur}
              selKey={selEl}
              canEdit={canEdit}
              setAnim={setAnim}
              setTrans={setTrans}
              applyTransAll={applyTransAll}
              reorder={reorderAnim}
              select={(k) => { setSelEl(k); setEditing(null); }}
              preview={() => setShow({ mode: "show", start: selIdx })}
              onClose={() => setAnimPanel(false)}
              drawPath={(idx, mode) => {
                const b = selEl ? animBox(selEl) : undefined;
                if (!selEl || !b) return;
                setPathEdit(null);
                setEditing(null);
                // straight lines start at the object's centre; a scribble starts where the drag does
                setMotion({ key: selEl, idx, mode, pts: mode === "lines" ? [pathOrigin(b)] : [] });
              }}
              editPath={(idx) => selEl && setPathEdit((p) => (p && p.key === selEl && p.idx === idx ? null : { key: selEl, idx }))}
              uploadSound={uploadSound}
            />
          )}
        </div>
      )}

      {/* print: one slide per page */}
      <div className="print-deck" aria-hidden>
        {view.filter((s) => !s.hidden).map((s) => (
          <div key={s.id} className="print-slide">
            <ScaledSlide slide={s} look={look} width={1000} />
          </div>
        ))}
      </div>

      {dialog === "theme" && (
        <ThemeDialog themeId={meta.theme} colors={meta.colors} font={meta.font} headFont={meta.headFont || ""} onApply={applyTheme} onClose={() => setDialog(null)} />
      )}
      {dialog === "size" && <SlideSizeDialog w={W} h={H} onApply={setSlideSize} onClose={() => setDialog(null)} />}
      {dialog === "math" && <MathDialog value={mathEdit ? (readEl(mathEdit) as MathEl | null) || undefined : undefined} onApply={applyMath} onClose={() => { setDialog(null); setMathEdit(null); }} />}
      {(dialog === "zoom-summary" || dialog === "zoom-section" || dialog === "zoom-slide") && <ZoomDialog mode={dialog.slice(5) as ZoomMode} view={view} look={look} current={selIdx} onInsert={(ids) => insertZoom(dialog.slice(5) as ZoomMode, ids)} onClose={() => setDialog(null)} />}
      {dialog === "video" && <VideoDialog aspect={W / H} progress={videoProgress} onExport={exportVideo} onCancel={() => videoAbort.current?.abort()} onClose={() => setDialog(null)} />}
      {dialog === "draft" && <DraftDialog onInsert={insertDraft} onClose={() => setDialog(null)} />}
      {dialog === "icon" && <IconPicker onPick={insertIcon} onClose={() => setDialog(null)} />}
      {dialog === "diagram" && (() => {
        const lead = diagramEdit ? cur?.elements.find((e) => e.id === diagramEdit) : undefined;
        const d = lead?.type === "shape" ? lead.dgm : undefined;
        return <DiagramDialog look={look} accent={d?.accent || theme.accent} initial={d ? { kind: d.kind, text: outlineText(d.items) } : undefined} onInsert={d && lead ? (kind, text) => relayDiagram(lead.id, kind, text) : insertDiagram} onClose={() => { setDialog(null); setDiagramEdit(null); }} />;
      })()}
      {dialog === "pdf" && <PdfDialog hasHidden={slides.some((s) => s.hidden)} onExport={exportPdf} onClose={() => setDialog(null)} />}
      {dialog === "setup" && <SetUpShowDialog value={meta.show || {}} shows={meta.shows || []} onApply={setShowSettings} onClose={() => setDialog(null)} />}
      {dialog === "shows" && <CustomShowsDialog slides={slides} shows={meta.shows || []} onSave={setCustomShows} onStart={(id) => setShow({ mode: "show", start: 0, custom: id })} onClose={() => setDialog(null)} newId={() => genId("cs")} />}
      {dialog === "hf" && <HeaderFooterDialog value={meta.hf} onApply={setHf} onClose={() => setDialog(null)} />}

      {show && slides.length > 0 && (
        <Slideshow
          slides={showSlides}
          deck={view}
          look={look}
          start={show.start}
          mode={show.rehearse ? "show" : show.mode}
          loop={!!meta.show?.loop && !show.rehearse}
          useTimings={meta.show?.useTimings !== false}
          rehearse={!!show.rehearse}
          record={!!show.record}
          follow={followOpts}
          onExit={(i, result) => {
            const id = showSlides[i]?.id;
            setShow(null);
            const at = slides.findIndex((s) => s.id === id);
            if (at >= 0) setSel(at);
            finishShow(showSlides.map((s) => s.id), result);
          }}
        />
      )}
    </div>
    </DeckSlides.Provider>
  );
}

// ---- rich text editor for one text box / shape (mounted while editing) ----
function RichBox({ html, onChange, onReady }: { html: string; onChange: (html: string) => void; onReady: (e: Editor | null) => void }) {
  const last = useRef(html);
  const editor = useEditor({
    extensions: textExtensions("Type here"),
    editorProps: { attributes: { class: "slide-text outline-none", "data-testid": "el-editor" } },
    immediatelyRender: false,
    content: html || "<p></p>",
    autofocus: "end",
    onUpdate: ({ editor }) => {
      const h = editor.getHTML();
      last.current = h;
      onChange(h === "<p></p>" ? "" : h);
    },
  });
  useEffect(() => {
    onReady(editor);
    if (editor && !editor.isFocused) editor.commands.focus("end");
    return () => onReady(null);
  }, [editor, onReady]);
  // remote edits to the same box while we're typing in it
  useEffect(() => {
    if (editor && html !== last.current && html !== editor.getHTML() && !(html === "" && editor.isEmpty)) {
      last.current = html;
      editor.commands.setContent(html || "<p></p>", false);
    }
  }, [html, editor]);
  return (
    <div onPointerDown={(e) => e.stopPropagation()} style={{ cursor: "text" }}>
      <EditorContent editor={editor} />
    </div>
  );
}


/**
 * An empty layout placeholder on a slide: its prompt in a dashed frame, as
 * PowerPoint shows one. A content slot offers each kind of object; the others
 * insert their own kind when clicked.
 */
function SlotPrompt({ el, scale, onFill }: { el: SlideElement; scale: number; onFill: (kind: SlotKind) => void }) {
  const kind = el.slot || "obj";
  const prompt = (el.type === "text" && htmlText(el.html).trim()) || SLOT_KINDS.find((k) => k.id === kind)?.prompt || "";
  const choices: { k: SlotKind; icon: string; label: string }[] = [
    { k: "tbl", icon: "▦", label: "Insert table" },
    { k: "chart", icon: "▮", label: "Insert chart" },
    { k: "dgm", icon: "⧉", label: "Insert SmartArt graphic" },
    { k: "pic", icon: "🖼", label: "Insert picture" },
    { k: "media", icon: "▶", label: "Insert video or audio" },
  ];
  return (
    <div
      data-testid={`slot-${kind}`}
      data-slot-id={el.id}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => onFill(kind === "obj" ? "text" : kind)}
      style={{ position: "absolute", left: el.x, top: el.y, width: el.w, height: el.h, border: `${1.5 / scale}px dashed #94a3b8`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "#64748b", fontSize: "18pt", cursor: "text", zIndex: 0 }}
    >
      <div>{prompt}</div>
      {kind === "obj" && (
        <div style={{ display: "flex", gap: 8 }}>
          {choices.map((c) => (
            <button key={c.k} type="button" title={c.label} aria-label={c.label} data-testid={`slot-insert-${c.k}`} onClick={(e) => { e.stopPropagation(); onFill(c.k); }} style={{ fontSize: "20pt", width: 44, height: 44, borderRadius: 6, border: "1px solid #cbd5e1", background: "rgba(255,255,255,0.8)", cursor: "pointer" }}>
              {c.icon}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
