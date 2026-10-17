"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { useRouter } from "next/navigation";
import type { Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import TableRow from "@tiptap/extension-table-row";
import { FontSize, Indent, CommentMark } from "./tiptap-ext";
import { Subscript, Superscript } from "./slides/text-ext";
import { type Menu } from "./MenuBar";
import AppTitleBar from "./AppTitleBar";
import { LabelChip, SensitivityDialog, useDocLabel } from "./SheetSensitivity";
import { fileLabelOf, isLabelProperty } from "@/lib/labels";
import { WordParagraph, WordImage, WordTableCell, WordTableHeader, PageBreak, SectionBreak, PageField, TableOfContents } from "./docs/word-ext";
import { Pagination, paginationKey, pageLabelAt, headingPages } from "./docs/pagination";
import PrintLayer, { type HFKind, type HFType } from "./docs/PrintLayer";
import { Ruler } from "./docs/Ruler";
import { NavigationPane } from "./docs/NavigationPane";
import { WordView } from "./docs/view-ext";
import { Presence } from "./docs/presence-ext";
import { WordChart, SmartArt, parseGraphic } from "./docs/graphics-ext";
import { ChartDialog, SmartArtDialog } from "./docs/GraphicsDialogs";
import { IndexEntry, WordIndex, indexEntriesOf } from "./docs/index-ext";
import { MarkEntryDialog, IndexDialog } from "./docs/IndexDialogs";
import type { ChartData, DiagramData } from "@/lib/docs/word-graphics";
import { MentionBox, MentionText } from "./docs/MentionBox";
import { HeaderFooterDialog, PageSetupDialog, StyleDialog, StyleGallery, StylesPane, ParagraphDialog, selectionFormatting } from "./docs/WordDialogs";
import { rasterizeSvg } from "@/lib/docs/rasterize";
import { type DocSettings, type DocStyle, type PMNode, type Section, contentWidth, defaultSection, mergeStyles, parseSection, ptToPx, stylesCss } from "@/lib/docs/model";
import { sectionsOf } from "@/lib/docs/paginate";
import { Insertion, Deletion, TrackChanges, TRACK_SKIP, trackedChanges } from "./docs/track-changes";
import { ChangesPanel, stepChange } from "./docs/ReviewPanel";
import { NoteRef, notesOf, parseNote, type NoteKind } from "./docs/notes";
import { Equation } from "./docs/equation";
import { Shape } from "./docs/shapes";
import { LayoutDialog } from "./docs/LayoutDialog";
import { Proofing, type ProofMenu } from "./docs/proofing-ext";
import { ProofContextMenu, ProofingPanel } from "./docs/ProofingPanel";
import { NoteDialog, EquationDialog, BookmarkDialog, CaptionDialog, CrossRefDialog, type CaptionSpec, type XrefTarget } from "./docs/RefDialogs";
import { Bookmark, SeqField, CrossRef, indexOf, goToBookmark, bookmarkNames } from "./docs/refs";
import { refName, type RefShow } from "@/lib/docs/fields";
import { NodeSelection } from "@tiptap/pm/state";
import { Citation, Bibliography, citedTags } from "./docs/citations-ext";
import { CitationDialog, SourcesDialog } from "./docs/CitationDialogs";
import { AiDialog } from "./docs/AiDialog";
import { WordFormat, formatPainterOn } from "./docs/format-ext";
import { FontDialog, TabsDialog, BordersDialog, DropCapDialog, type FontValue } from "./docs/FormatDialogs";
import { CASE_MODES } from "@/lib/docs/para-format";
import { THEMES, themeOf, restyleForTheme, styleSets, applyStyleSet } from "@/lib/docs/design";
import { StyleInspector } from "./docs/StyleInspector";
import { NUMBER_FORMATS, BULLETS, applyNumberFormat, applyBullet, restartNumbering, continueNumbering, setNumberingValue } from "./docs/lists";
import { MergeField } from "./docs/mail-merge-ext";
import { WordTable, tableAround } from "./docs/table-ext";
import { SortDialog } from "./docs/TableDialogs";
import { ReviewTools } from "./docs/review-ext";
import { ContentControl, BlockControl, EditableRange, Protect } from "./docs/protection-ext";
import { RestrictPane, ControlPicker } from "./docs/RestrictPane";
import { CONTROL_LABELS, type ControlKind } from "@/lib/docs/protection";
import { ThesaurusPane, AccessibilityPane, ReadAloudBar } from "./docs/ReviewPanes";
import { WatermarkDialog, PageBordersDialog } from "./docs/PageDesignDialogs";
import { PAGE_COLORS, type LineNumbers } from "@/lib/docs/page-design";
import { DocField, docFieldText, docFieldResults, type FieldEnv } from "./docs/doc-field-ext";
import { FieldDialog, SymbolDialog, PropertiesDialog } from "./docs/FieldDialogs";
import { SplitPane } from "./docs/SplitPane";
import { textToDoc, docToText, markdownToDoc, docToMarkdown, asTemplate, asPlainDocument, fileKind } from "@/lib/docs/plain-formats";
import { TABLE_STYLES, lookOf, cellText as tableCellText, type TableLook } from "@/lib/docs/tables";
import { MailMergePanel, watchMergeTable } from "./docs/MailMergePanel";
import { setPendingImport } from "@/lib/slides/pending-import";
import type { MergeSource, MergeTable } from "@/lib/docs/mail-merge";
import { blocksText, mdToNodes, type AiTask } from "@/lib/docs/ai";
import { CITATION_STYLES, type Source } from "@/lib/docs/citations";
import { generateHTML, generateJSON } from "@tiptap/core";
import { IMPORTED_THREAD } from "@/lib/docs/docx-import";
import { takePendingImport } from "@/lib/slides/pending-import";

const PALETTE = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];
function colorFor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const FONTS = [
  { label: "Default", value: "" },
  { label: "Calibri", value: '"Calibri", "Carlito", sans-serif' },
  { label: "Cambria", value: '"Cambria", "Caladea", serif' },
  { label: "Aptos", value: '"Aptos", sans-serif' },
  { label: "Arial", value: '"Arial", "Liberation Sans", sans-serif' },
  { label: "Georgia", value: '"Georgia", serif' },
  { label: "Times New Roman", value: '"Times New Roman", "Liberation Serif", serif' },
  { label: "Courier New", value: '"Courier New", "Liberation Mono", monospace' },
  { label: "Verdana", value: '"Verdana", sans-serif' },
  { label: "Trebuchet MS", value: '"Trebuchet MS", sans-serif' },
];
const SIZES = ["8", "9", "10", "10.5", "11", "12", "14", "16", "18", "20", "24", "28", "36", "48", "72"];
const LINE_SPACINGS = ["1", "1.08", "1.15", "1.5", "2", "2.5", "3"];

// Starter content for the empty-doc chips / File ▸ New from template.
const TEMPLATES: Record<string, string> = {
  meeting: `<h1>Meeting notes</h1><p><strong>Date:</strong> </p><p><strong>Attendees:</strong> </p><h2>Agenda</h2><ul><li><p></p></li></ul><h2>Notes</h2><ul><li><p></p></li></ul><h2>Action items</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>`,
  email: `<h1>Email draft</h1><p><strong>To:</strong> </p><p><strong>Subject:</strong> </p><hr><p>Hi ,</p><p></p><p>Best,<br></p>`,
  brief: `<h1>Project brief</h1><h2>Overview</h2><p></p><h2>Goals</h2><ul><li><p></p></li></ul><h2>Timeline</h2><p></p><h2>Owners</h2><p></p>`,
};

/** Extensions for header/footer content (the mini editor and the print layer). */
function headerFooterExtensions(): Extensions {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] } }),
    Underline,
    Link.configure({ openOnClick: false }),
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    WordParagraph,
    WordFormat,
    Indent,
    TaskList,
    TaskItem.configure({ nested: true }),
    WordImage.configure({ inline: false, allowBase64: true }),
    // what headers and footers from Word hold besides text: shapes and text boxes, charts, SmartArt, equations, references
    Shape,
    WordChart,
    SmartArt,
    Equation,
    Bookmark,
    SeqField,
    CrossRef,
    Citation,
    MergeField,
    IndexEntry,
    WordTable,
    TableRow,
    WordTableHeader,
    WordTableCell,
    Subscript,
    Superscript,
    PageField,
    DocField,
    ContentControl,
    BlockControl,
    EditableRange,
    Insertion,
    Deletion,
  ];
}

const parseJson = <T,>(v: unknown, f: T): T => {
  if (typeof v !== "string") return f;
  try {
    return JSON.parse(v) as T;
  } catch {
    return f;
  }
};

export const OPEN_ACCEPT = ".docx,.dotx,.docm,.dotm,.odt,.rtf,.doc,.dot,.txt,.md,.markdown,.htm,.html";

function download(bytes: Uint8Array | Blob, name: string, type: string) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function DocEditor({
  docId,
  initialTitle,
  user,
  collabUrl,
  initialScope = "private",
  role = "owner",
  initialStarred = false,
  initialLabelId = null,
}: {
  docId: string;
  initialTitle: string;
  user: { name: string; email: string };
  collabUrl: string;
  initialScope?: "private" | "company";
  role?: "viewer" | "commenter" | "editor" | "owner";
  initialStarred?: boolean;
  /** The document's sensitivity label (documents.label_id). */
  initialLabelId?: string | null;
}) {
  const isOwner = role === "owner";
  const canEdit = role === "editor" || role === "owner";
  const canComment = canEdit || role === "commenter";
  const { ydoc, provider } = useMemo(() => {
    const url =
      collabUrl ||
      (typeof window !== "undefined"
        ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/collab`
        : "");
    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({ url, name: docId, document: ydoc });
    return { ydoc, provider };
  }, [docId, collabUrl]);

  const [status, setStatus] = useState<"connecting" | "connected" | "offline">("connecting");
  const [title, setTitle] = useState(initialTitle);
  const [peers, setPeers] = useState(1);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docxInput = useRef<HTMLInputElement | null>(null);
  const insertFileInput = useRef<HTMLInputElement | null>(null);
  const compareInput = useRef<HTMLInputElement | null>(null);
  const imageInput = useRef<HTMLInputElement | null>(null);
  const insertImagesRef = useRef<(files: File[], at?: number) => Promise<void>>(async () => {});
  const editingRef = useRef(false);
  const lastVersion = useRef(0);
  const [panel, setPanel] = useState<null | "comments" | "history" | "styles" | "changes" | "proofing" | "merge" | "inspector" | "thesaurus" | "accessibility" | "restrict">(null);
  const [ccPick, setCcPick] = useState<number | null>(null);
  const [readAloud, setReadAloud] = useState(false);
  const [mergeTable, setMergeTable] = useState<MergeTable | null>(null);
  const [mergePreview, setMergePreview] = useState<number | null>(null);
  const mergePreviewRef = useRef<Record<string, string> | null>(null);
  mergePreviewRef.current = mergePreview !== null && mergeTable ? mergeTable.records[mergePreview] || null : null;
  const router = useRouter();
  const [findOpen, setFindOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState<{ from: number; to: number; quote: string } | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  void initialScope;

  // Chrome: title/star, outline, ruler, zoom, mode.
  const [showOutline, setShowOutline] = useState(true);
  const [showRuler, setShowRuler] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [mode, setMode] = useState<"editing" | "suggesting" | "viewing">("editing");
  const [markup, setMarkup] = useState<"all" | "final" | "original">("all");
  const [layoutMode, setLayoutMode] = useState<"print" | "web">("print");
  const [showMarks, setShowMarks] = useState(false);
  const [viewMode, setViewMode] = useState<"normal" | "read" | "focus">("normal");
  const [readLook, setReadLook] = useState<{ width: "narrow" | "default" | "wide"; color: "none" | "sepia" | "inverse" }>({ width: "default", color: "none" });
  const [navFocus, setNavFocus] = useState(0);
  const [indexDialog, setIndexDialog] = useState<null | { kind: "mark"; selected: string } | { kind: "index"; pos: number | null }>(null);
  const [graphicEdit, setGraphicEdit] = useState<null | { kind: "chart" | "smartArt"; pos: number | null }>(null);
  // a notification links here with ?comment=<thread>: open the comments on it
  const [focusThread, setFocusThread] = useState<string | null>(null);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("comment");
    if (t) {
      setFocusThread(t);
      setPanel("comments");
    }
  }, []);
  const shownLayout = viewMode === "read" ? "web" : layoutMode;
  const [outline, setOutline] = useState<{ level: number; text: string; pos: number }[]>([]);
  const editing = canEdit && mode !== "viewing";
  editingRef.current = editing;
  const titleRef = useRef(initialTitle);
  titleRef.current = title;
  const fieldEnv = useRef<FieldEnv>({
    base: () => ({
      title: titleRef.current,
      filename: titleRef.current || "Document",
      author: user.name || user.email,
      user: user.name || user.email,
      // File › Properties and custom properties, for DOCPROPERTY and INFO
      properties: { ...setupRef.current.settings.properties, ...setupRef.current.settings.customProperties },
    }),
    pageOf: (state, pos) => pageLabelAt(state, pos),
    pages: (state) => paginationKey.getState(state)?.layout?.pages.length ?? null,
  }).current;
  const [fieldDialog, setFieldDialog] = useState<null | "field" | "formula" | "date" | { pos: number; instr: string }>(null);
  const [symbolOpen, setSymbolOpen] = useState(false);
  const [propsOpen, setPropsOpen] = useState(false);
  // View › Split: the height of the second pane, or null when the window is not split
  const [split, setSplit] = useState<number | null>(null);
  const [designDialog, setDesignDialog] = useState<null | "watermark" | "pageBorders">(null);

  // ---- Word-shaped document state shared through the collab doc ----
  // styles (id -> JSON) and the last section's page setup + document settings.
  const wordStyles = useMemo(() => ydoc.getMap<string>("wordStyles"), [ydoc]);
  const wordLayout = useMemo(() => ydoc.getMap<string>("wordLayout"), [ydoc]);
  const [ownStyles, setOwnStyles] = useState<DocStyle[]>([]);
  const [body, setBodyState] = useState<Section>(defaultSection());
  const [settings, setSettingsState] = useState<DocSettings>({});
  useEffect(() => {
    const readStyles = () => setOwnStyles([...wordStyles.values()].map((v) => parseJson<DocStyle | null>(v, null)).filter((s): s is DocStyle => !!s && typeof s.id === "string"));
    const readLayout = () => {
      setBodyState(parseSection(wordLayout.get("body") ?? null));
      setSettingsState(parseJson<DocSettings>(wordLayout.get("settings"), {}));
    };
    readStyles();
    readLayout();
    wordStyles.observe(readStyles);
    wordLayout.observe(readLayout);
    return () => {
      wordStyles.unobserve(readStyles);
      wordLayout.unobserve(readLayout);
    };
  }, [wordStyles, wordLayout]);
  const styles = useMemo(() => mergeStyles(ownStyles), [ownStyles]);
  // edits are tracked in Suggesting mode, or for everyone when Track changes is on
  const tracking = mode === "suggesting" || !!settings.trackRevisions || (!!settings.protection?.enforced && settings.protection.edit === "trackedChanges");
  const trackingRef = useRef(tracking);
  trackingRef.current = tracking;
  const styleCss = useMemo(() => stylesCss(styles, ".word-doc"), [styles]);
  const setupRef = useRef({ body, settings });
  setupRef.current = { body, settings };
  const setBody = (s: Section) => wordLayout.set("body", JSON.stringify(s));
  const setSettings = (s: DocSettings) => wordLayout.set("settings", JSON.stringify(s));
  // File › Sensitivity: the organization's label on the document, else the label an opened Word
  // file brought from another organization (kept in its custom properties).
  const docLabel = useDocLabel(docId, initialLabelId, fileLabelOf(settings.customProperties));
  const [labelOpen, setLabelOpen] = useState(false);
  const chooseLabel = async (l: Parameters<typeof docLabel.choose>[0]) => {
    await docLabel.choose(l);
    // the file's own label gives way to the one chosen here (or to none)
    const custom = settings.customProperties || {};
    if (Object.keys(custom).some(isLabelProperty)) setSettings({ ...settings, customProperties: Object.fromEntries(Object.entries(custom).filter(([k]) => !isLabelProperty(k))) });
  };
  const putStyle = (s: DocStyle) => wordStyles.set(s.id, JSON.stringify(s));

  const hfExtensions = useMemo(() => headerFooterExtensions(), []);
  const [pageSetupOpen, setPageSetupOpen] = useState(false);
  const [hfOpen, setHfOpen] = useState<null | { index: number; kind: HFKind; type: HFType }>(null);
  const [styleEdit, setStyleEdit] = useState<null | { style?: DocStyle; initial?: Parameters<typeof StyleDialog>[0]["initial"] }>(null);
  const [paraOpen, setParaOpen] = useState(false);
  const [fmtDialog, setFmtDialog] = useState<null | "font" | "tabs" | "borders" | "dropcap" | "sort">(null);
  const [noteEdit, setNoteEdit] = useState<number | null>(null);
  const [refDialog, setRefDialog] = useState<null | "caption" | "xref" | "bookmark">(null);
  const [citeDialog, setCiteDialog] = useState<null | { pos?: number }>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [eqEdit, setEqEdit] = useState<null | { pos: number | null }>(null);
  const [aiJob, setAiJob] = useState<null | { task: AiTask; text: string; context: string; source: string; from: number; to: number; canReplace: boolean }>(null);
  const [proofMenu, setProofMenu] = useState<ProofMenu | null>(null);
  const [proofOn, setProofOnState] = useState(() => {
    try {
      return typeof window === "undefined" || localStorage.getItem("syn-docs-proofing") !== "off";
    } catch {
      return true;
    }
  });
  const proofOnRef = useRef(proofOn);
  proofOnRef.current = proofOn;
  const setProofOn = (on: boolean) => {
    setProofOnState(on);
    proofOnRef.current = on;
    try {
      localStorage.setItem("syn-docs-proofing", on ? "on" : "off");
    } catch {
      /* stays for this visit */
    }
    editor?.view.dispatch(editor.state.tr);
  };
  const [layoutEdit, setLayoutEdit] = useState<null | { pos: number } | { insert: Record<string, unknown> }>(null);
  const citeSetup = () => ({ sources: setupRef.current.settings.sources || [], style: setupRef.current.settings.citationStyle || "APA" });
  const setSources = (sources: Source[]) => setSettings({ ...setupRef.current.settings, sources });
  const setMergeSource = (mergeSource: MergeSource | undefined) => {
    const next = { ...setupRef.current.settings };
    if (mergeSource) next.mergeSource = mergeSource;
    else delete next.mergeSource;
    setSettings(next);
  };
  const noteHtmlCache = useRef(new Map<string, string>());
  const noteHtml = (d: PMNode) => {
    const k = JSON.stringify(d);
    let h = noteHtmlCache.current.get(k);
    if (h === undefined) {
      try {
        h = generateHTML(d as never, hfExtensions);
      } catch {
        h = "";
      }
      if (noteHtmlCache.current.size > 500) noteHtmlCache.current.clear();
      noteHtmlCache.current.set(k, h);
    }
    return h;
  };
  const noteHtmlRef = useRef(noteHtml);
  noteHtmlRef.current = noteHtml;

  const newDoc = async (kind: "doc" | "sheet" | "slide") => {
    const r = await fetch("/api/docs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
    const { id } = await r.json();
    window.open(kind === "doc" ? `/doc/${id}` : kind === "sheet" ? `/sheet/${id}` : `/slides/${id}`, "_blank");
  };
  const wordCount = () => {
    const t = editor?.getText() || "";
    const words = (t.match(/\S+/g) || []).length;
    const pages = editor ? paginationKey.getState(editor.state)?.layout?.pages.length : undefined;
    alert(`Word count\n\n${pages ? `Pages: ${pages}\n` : ""}Words: ${words}\nCharacters: ${t.length}`);
  };
  // AI tools: the selection (or, with none, the current paragraph; the whole document to summarise)
  const openAi = (task: AiTask) => {
    if (!editor) return;
    const { state } = editor;
    const sel = state.selection;
    const textOf = (from: number, to: number) => blocksText((state.doc.slice(from, to).content.toJSON() as PMNode[]) || []);
    const context = state.doc.textBetween(0, sel.from, "\n\n", " ").slice(-6000);
    if (task === "draft") return setAiJob({ task, text: "", context, source: "", from: sel.to, to: sel.to, canReplace: false });
    if (!sel.empty) return setAiJob({ task, text: textOf(sel.from, sel.to), context, source: "Selected text", from: sel.from, to: sel.to, canReplace: true });
    if (task === "summarize") return setAiJob({ task, text: textOf(0, state.doc.content.size), context: "", source: "The whole document", from: sel.to, to: sel.to, canReplace: false });
    const $p = sel.$from;
    if (!$p.parent.isTextblock) return;
    setAiJob({ task, text: textOf($p.start(), $p.end()), context, source: "The current paragraph", from: $p.start(), to: $p.end(), canReplace: true });
  };
  const insertAi = (md: string, replace: boolean) => {
    if (!editor || !aiJob) return;
    const nodes = mdToNodes(md);
    if (!nodes.length) return setAiJob(null);
    const { from, to } = aiJob;
    if (replace) {
      const single = nodes.length === 1 && nodes[0].type === "paragraph";
      editor.chain().focus().insertContentAt({ from, to }, single ? nodes[0].content || [] : nodes).run();
    } else {
      const $to = editor.state.doc.resolve(Math.min(to, editor.state.doc.content.size));
      const at = $to.depth >= 1 ? $to.after(1) : $to.pos;
      editor.chain().focus().insertContentAt(at, nodes).run();
    }
    setAiJob(null);
  };
  const insertTemplate = (key: string) => {
    if (!editor || !editing) return;
    editor.chain().focus().insertContent(TEMPLATES[key]).run();
  };
  const goToHeading = (pos: number) => {
    editor?.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
    (editor?.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({ block: "center" });
  };
  const remove = async () => {
    if (!isOwner) return;
    if (!confirm("Move this document to trash? This cannot be undone.")) return;
    await fetch(`/api/docs/${docId}`, { method: "DELETE" }).catch(() => {});
    window.location.href = "/";
  };

  // ---- .docx ----
  const buildDocxBytes = async (docOverride?: PMNode): Promise<Uint8Array | null> => {
    if (!editor) return null;
    const { buildDocx } = await import("@/lib/docs/docx-export");
    type T = { id: string; resolved: boolean; messages: { author_name: string; body: string; created_ms: string }[] };
    const threads: T[] = await fetch(`/api/docs/${docId}/comments`)
      .then((r) => (r.ok ? r.json() : { threads: [] }))
      .then((j) => j.threads ?? [])
      .catch(() => []);
    let fdoc = docOverride || (editor.getJSON() as PMNode);
    if (!docOverride) {
      // fields carry the results they show now
      const results = docFieldResults(editor.state, fieldEnv);
      let i = 0;
      const fill = (n: PMNode): PMNode => (n.type === "docField" ? { ...n, attrs: { ...n.attrs, result: results[i++] ?? n.attrs?.result } } : n.content ? { ...n, content: n.content.map(fill) } : n);
      if (results.length) fdoc = fill(fdoc);
    }
    return buildDocx({
      doc: fdoc,
      styles: ownStyles,
      body,
      settings,
      title,
      author: user.name,
      headingPages: headingPages(editor.state),
      bookmarkPages: Object.fromEntries([...indexOf(editor.state.doc).bookmarks.values()].map((b) => [b.name, pageLabelAt(editor.state, b.pos) ?? "1"])),
      indexPages: indexEntriesOf(editor.state.doc).map((e) => pageLabelAt(editor.state, e.pos) ?? "1"),
      comments: threads.map((t) => ({ id: t.id, resolved: t.resolved, messages: t.messages.map((m) => ({ author: m.author_name, body: m.body, date: Number(m.created_ms) || undefined })) })),
      rasterize: rasterizeSvg,
      label: docLabel.exportLabel,
      loadImage: async (src) => {
        try {
          const r = await fetch(src);
          if (!r.ok) return null;
          const b = await r.blob();
          return { bytes: new Uint8Array(await b.arrayBuffer()), mime: b.type || "image/png" };
        } catch {
          return null;
        }
      },
    });
  };
  const exportConverted = async (to: "odt" | "rtf") => {
    setBusy(`Saving .${to}…`);
    try {
      const bytes = await buildDocxBytes();
      if (!bytes) return;
      const r = await fetch(`/api/docs/convert?to=${to}`, { method: "POST", body: bytes as BlobPart });
      if (!r.ok) {
        alert(r.status === 503 ? `Saving as .${to} needs LibreOffice on the server. Download as Word (.docx) instead.` : `Could not save as .${to}.`);
        return;
      }
      download(new Uint8Array(await r.arrayBuffer()), `${title || "document"}.${to}`, to === "odt" ? "application/vnd.oasis.opendocument.text" : "application/rtf");
    } finally {
      setBusy(null);
    }
  };
  const exportDocx = async () => {
    setBusy("Saving .docx…");
    try {
      const bytes = await buildDocxBytes();
      if (bytes) download(bytes, `${title || "document"}.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    } finally {
      setBusy(null);
    }
  };

  const openDocx = async (data: ArrayBuffer | Uint8Array) => {
    if (!editor) return;
    const { importDocx } = await import("@/lib/docs/docx-import");
    const r = await importDocx(data);
    // comment threads: store them, then point the imported marks at the stored ids
    let ids: Record<string, string> = {};
    if (r.comments.length) {
      const res = await fetch(`/api/docs/${docId}/comments/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threads: r.comments.map((c) => ({
            key: c.key,
            quote: c.quote,
            resolved: c.resolved,
            messages: c.messages.map((m) => ({ author_name: m.author, body: m.body, created_ms: m.date })),
          })),
        }),
      }).catch(() => null);
      if (res?.ok) ids = (await res.json()).ids ?? {};
    }
    const fix = (n: PMNode) => {
      if (n.marks) {
        n.marks = n.marks
          .map((m) => (m.type === "comment" && typeof m.attrs?.threadId === "string" && m.attrs.threadId.startsWith(IMPORTED_THREAD) ? (ids[m.attrs.threadId.slice(IMPORTED_THREAD.length)] ? { ...m, attrs: { threadId: ids[m.attrs.threadId.slice(IMPORTED_THREAD.length)] } } : null) : m))
          .filter((m): m is NonNullable<typeof m> => !!m);
      }
      n.content?.forEach(fix);
    };
    fix(r.doc);
    ydoc.transact(() => {
      for (const k of [...wordStyles.keys()]) wordStyles.delete(k);
      for (const s of r.styles) wordStyles.set(s.id, JSON.stringify(s));
      wordLayout.set("body", JSON.stringify(r.body));
      wordLayout.set("settings", JSON.stringify(r.settings));
    });
    // a labeled file labels the document: with the organization's matching label, or its own
    const fileLabel = fileLabelOf(r.settings.customProperties);
    if (fileLabel && canEdit) void docLabel.fromFile(fileLabel, true).catch(() => {});
    editor
      .chain()
      .command(({ tr }) => {
        tr.setMeta(TRACK_SKIP, true);
        return true;
      })
      .setContent(r.doc as never, true)
      .run();
    if (r.comments.length) setPanel("comments");
    else if (trackedChanges(editor.state.doc).length) setPanel("changes");
  };

  /** A Word, OpenDocument or RTF file's bytes as .docx (the others go through the server's LibreOffice). */
  const asDocx = async (data: ArrayBuffer): Promise<ArrayBuffer> => {
    const b = new Uint8Array(data.slice(0, 4));
    const zip = b[0] === 0x50 && b[1] === 0x4b;
    if (zip && !new TextDecoder().decode(new Uint8Array(data.slice(30, 90))).includes("opendocument")) return data;
    const r = await fetch("/api/docs/convert?to=docx", { method: "POST", body: data });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "convert failed");
    return r.arrayBuffer();
  };
  /** Any file the editor opens or inserts, as document JSON (and, for Word files, the full import). */
  const readAnyFile = async (name: string, data: ArrayBuffer): Promise<{ docx?: ArrayBuffer | Uint8Array; doc?: PMNode }> => {
    const kind = fileKind(name, new Uint8Array(data.slice(0, 96)));
    if (kind === "md") return { doc: markdownToDoc(new TextDecoder().decode(data)) };
    if (kind === "txt") return { doc: textToDoc(new TextDecoder().decode(data)) };
    if (kind === "html") return { doc: generateJSONFromHtml(new TextDecoder().decode(data)) };
    // templates (.dotx) open as a new document; macro-enabled files (.docm) open without their macros
    if (kind === "docx") return { docx: (await asPlainDocument(data)).bytes };
    return { docx: await asDocx(data) };
  };
  const generateJSONFromHtml = (html: string): PMNode => {
    const d = new DOMParser().parseFromString(html, "text/html");
    d.querySelectorAll("script,style,iframe,object,embed").forEach((e) => e.remove());
    return generateJSON(d.body.innerHTML, editor!.extensionManager.extensions) as PMNode;
  };
  const openAnyFile = async (name: string, data: ArrayBuffer) => {
    if (!editor) return;
    const r = await readAnyFile(name, data);
    if (r.docx) await openDocx(r.docx);
    else if (r.doc)
      editor
        .chain()
        .command(({ tr }) => {
          tr.setMeta(TRACK_SKIP, true);
          return true;
        })
        .setContent(r.doc as never, true)
        .run();
  };
  /** Insert > Text from file: another file's content at the cursor (its new styles come along). */
  const insertFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !editor) return;
    setBusy("Inserting…");
    try {
      const r = await readAnyFile(file.name, await file.arrayBuffer());
      let doc = r.doc;
      if (r.docx) {
        const { importDocx: imp } = await import("@/lib/docs/docx-import");
        const got = await imp(r.docx);
        doc = got.doc;
        ydoc.transact(() => {
          for (const st of got.styles) if (!wordStyles.has(st.id)) wordStyles.set(st.id, JSON.stringify(st));
        });
      }
      const blocks = (doc?.content || []).filter((n) => n.type !== "sectionBreak");
      if (blocks.length) editor.chain().focus().insertContent(blocks as never).run();
    } catch (err) {
      console.error(err);
      alert("Could not insert that file.");
    } finally {
      setBusy(null);
    }
  };
  const importDocx = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !editor) return;
    setBusy("Opening…");
    try {
      await openAnyFile(file.name, await file.arrayBuffer());
    } catch (err) {
      console.error(err);
      alert(err instanceof Error && /encrypted with a password/.test(err.message) ? err.message : "Could not open that file.");
    } finally {
      setBusy(null);
    }
  };
  const exportPlain = async (kind: "txt" | "md") => {
    if (!editor) return;
    const json = editor.getJSON() as PMNode;
    const text = kind === "md" ? docToMarkdown(json) : docToText(json).replace(/\n/g, "\r\n");
    download(new Blob([text], { type: kind === "md" ? "text/markdown" : "text/plain" }), `${title || "document"}.${kind}`, kind === "md" ? "text/markdown" : "text/plain");
  };
  const exportTemplate = async () => {
    setBusy("Saving .dotx…");
    try {
      const bytes = await buildDocxBytes();
      if (bytes) download(await asTemplate(bytes), `${title || "template"}.dotx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.template");
    } finally {
      setBusy(null);
    }
  };

  // Review > Compare: this document against a revised .docx, the differences as tracked changes
  const compareWith = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !editor) return;
    setBusy("Comparing…");
    try {
      const [{ importDocx }, { compareDocs }] = await Promise.all([import("@/lib/docs/docx-import"), import("@/lib/docs/compare")]);
      const r = await importDocx(await file.arrayBuffer());
      const author = file.name.replace(/\.docx$/i, "") || "Revised";
      const merged = compareDocs((editor.getJSON().content || []) as PMNode[], (r.doc.content || []) as PMNode[], author);
      const doc = editor.schema.nodeFromJSON({ type: "doc", content: merged.content });
      editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content).setMeta(TRACK_SKIP, true));
      setPanel("changes");
      if (!merged.stats.insertions && !merged.stats.deletions) alert("The documents have the same text.");
    } catch (err) {
      console.error(err);
      alert("Could not compare with that Word file.");
    } finally {
      setBusy(null);
    }
  };

  // Mail merge: one copy per recipient, separated by page breaks
  const mergedBytes = async (): Promise<Uint8Array | null> => {
    if (!editor || !mergeTable) return null;
    const { mergeAll } = await import("@/lib/docs/mail-merge");
    return buildDocxBytes({ type: "doc", content: mergeAll((editor.getJSON().content || []) as PMNode[], mergeTable.records) });
  };
  const mergeDownload = async () => {
    setBusy("Merging…");
    try {
      const bytes = await mergedBytes();
      if (bytes) download(bytes, `${title || "document"} (merged).docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    } finally {
      setBusy(null);
    }
  };
  const mergeNew = async () => {
    setBusy("Merging…");
    try {
      const bytes = await mergedBytes();
      if (!bytes) return;
      const name = `${title || "Document"} (merged)`.slice(0, 200);
      const res = await fetch("/api/docs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "doc", title: name }) });
      if (!res.ok) throw new Error(String(res.status));
      const { id } = await res.json();
      setPendingImport(id, new File([bytes as BlobPart], `${name}.docx`));
      router.push(`/doc/${id}`);
    } catch (err) {
      console.error(err);
      alert("Could not create the merged document.");
    } finally {
      setBusy(null);
    }
  };

  // Start a comment on the current selection: capture it as a draft and open
  // the comments panel with a composer (the mark is applied when submitted).
  const startComment = () => {
    if (!editor || !canComment) return;
    const { from, to } = editor.state.selection;
    if (from === to) {
      alert("Select some text to comment on.");
      return;
    }
    const quote = editor.state.doc.textBetween(from, to, " ").slice(0, 300);
    setCommentDraft({ from, to, quote });
    setPanel("comments");
  };

  /**
   * Print (Ctrl+P) the print layout page for page: the paper is the
   * document's page size with no margin of its own, and the pages are laid out
   * with no gap between them, so each sheet of the layout is one printed page.
   */
  const printDoc = async () => {
    if (!editor || shownLayout !== "print") {
      window.print();
      return;
    }
    const view = editor.view;
    const { sections } = sectionsOf(editor.state.doc, body);
    const w = Math.max(...sections.map((x) => x.pageWidth));
    const h = Math.max(...sections.map((x) => x.pageHeight));
    const style = document.createElement("style");
    style.setAttribute("data-docs-print", "");
    style.textContent = `@page { size: ${w}pt ${h}pt; margin: 0; }`;
    document.head.appendChild(style);
    document.documentElement.classList.add("docs-printing");
    view.dispatch(view.state.tr.setMeta(paginationKey, { printing: true, tick: Date.now() }).setMeta("addToHistory", false));
    // let the pages be measured and placed again without their gaps
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(() => r(null)));
    try {
      window.print();
    } finally {
      document.documentElement.classList.remove("docs-printing");
      style.remove();
      if (!editor.isDestroyed) editor.view.dispatch(editor.view.state.tr.setMeta(paginationKey, { printing: false, tick: Date.now() }).setMeta("addToHistory", false));
    }
  };
  const printRef = useRef(printDoc);
  printRef.current = printDoc;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        void printRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const exportPdf = async () => {
    if (!editor) return;
    setPdfBusy(true);
    try {
      // the PDF is made from the same .docx as "Download as Word", so styles, sections, headers, notes and fields carry over
      const bytes = await buildDocxBytes();
      if (!bytes) return;
      const res = await fetch(`/api/pdf?title=${encodeURIComponent(title || "document")}`, {
        method: "POST",
        headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
        body: new Blob([bytes as BlobPart]),
      });
      if (res.ok) download(await res.blob(), `${title || "document"}.pdf`, "application/pdf");
      else window.print(); // PDF service not configured/reachable → browser print-to-PDF.
    } catch {
      window.print();
    } finally {
      setPdfBusy(false);
    }
  };

  useEffect(() => {
    const onStatus = (e: { status: string }) =>
      setStatus(e.status === "connected" ? "connected" : e.status === "connecting" ? "connecting" : "offline");
    provider.on("status", onStatus);
    const onAware = () => setPeers(Math.max(1, provider.awareness?.getStates().size ?? 1));
    provider.awareness?.on("change", onAware);
    return () => {
      provider.off("status", onStatus);
      provider.awareness?.off("change", onAware);
      provider.destroy();
      ydoc.destroy();
    };
  }, [provider, ydoc]);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ history: false }), // Yjs owns undo/redo history
        Collaboration.configure({ document: ydoc }),
        CollaborationCursor.configure({ provider, user: { name: user.name, color: colorFor(user.email) } }),
        Presence.configure({ awareness: () => provider.awareness as never }),
        Underline,
        Link.configure({ openOnClick: false, autolink: true }),
        TaskList,
        TaskItem.configure({ nested: true }),
        TextStyle,
        Color,
        FontFamily,
        FontSize,
        Highlight.configure({ multicolor: true }),
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        Indent,
        WordParagraph,
        WordView,
        IndexEntry,
        WordIndex.configure({ pageOf: (pos: number) => (editorRef.current ? pageLabelAt(editorRef.current.state, pos) : null), onOpen: (pos: number) => editingRef.current && setIndexDialog({ kind: "index", pos }) }),
        WordChart.configure({ onOpen: (pos: number, kind: "chart" | "smartArt") => editingRef.current && setGraphicEdit({ pos, kind }) }),
        SmartArt.configure({ onOpen: (pos: number, kind: "chart" | "smartArt") => editingRef.current && setGraphicEdit({ pos, kind }) }),
        WordFormat.configure({ onFontDialog: () => editingRef.current && setFmtDialog("font") }),
        Subscript,
        Superscript,
        WordImage.configure({ inline: false, allowBase64: true, onOpen: (pos: number) => setLayoutEdit({ pos }) }),
        Shape.configure({ onOpen: (pos: number) => setLayoutEdit({ pos }) }),
        WordTable.configure({ resizable: true }),
        TableRow,
        WordTableHeader,
        WordTableCell,
        PageBreak,
        SectionBreak,
        PageField,
        TableOfContents.configure({ pageOf: (pos: number) => (editorRef.current ? pageLabelAt(editorRef.current.state, pos) : null) }),
        Pagination.configure({ getSetup: () => setupRef.current, enabled: true, noteHtml: (d: PMNode) => noteHtmlRef.current(d), onOpenNote: (pos: number) => setNoteEdit(pos) }),
        NoteRef.configure({ onOpen: (pos: number) => setNoteEdit(pos) }),
        Bookmark,
        SeqField,
        CrossRef.configure({ pageOf: (state, pos) => pageLabelAt(state, pos) }),
        Citation.configure({ setup: () => citeSetup(), onOpen: (pos: number) => setCiteDialog({ pos }) }),
        Bibliography.configure({ setup: () => citeSetup() }),
        Equation.configure({ onOpen: (pos: number | null) => setEqEdit({ pos }) }),
        MergeField.configure({ preview: () => mergePreviewRef.current }),
        ContentControl.configure({ onPick: (pos: number) => setCcPick(pos) }),
        BlockControl,
        EditableRange,
        Protect.configure({ get: () => setupRef.current.settings.protection }),
        ReviewTools.configure({ onThesaurus: () => setPanel((p) => (p === "thesaurus" ? null : "thesaurus")), onReadAloud: () => setReadAloud((v) => !v) }),
        DocField.configure({ env: fieldEnv, onEdit: (pos: number) => { const n = editorRef.current?.state.doc.nodeAt(pos); if (n && editingRef.current) setFieldDialog({ pos, instr: String(n.attrs.instr) }); } }),
        Proofing.configure({ enabled: () => proofOnRef.current, onMenu: (m: ProofMenu) => setProofMenu(m), onPane: () => setPanel("proofing") }),
        CommentMark,
        Insertion,
        Deletion,
        TrackChanges.configure({ isTracking: () => trackingRef.current, author: () => user.name || user.email }),
        Placeholder.configure({ placeholder: "Start writing…" }),
      ],
      editorProps: {
        attributes: { class: "ProseMirror" },
        // pasted or dropped picture files are uploaded and inserted as pictures
        handlePaste: (_view, event) => {
          const files = Array.from(event.clipboardData?.files || []).filter((f) => f.type.startsWith("image/"));
          if (!files.length || !editingRef.current) return false;
          event.preventDefault();
          void insertImagesRef.current(files);
          return true;
        },
        handleDrop: (view, event, _slice, moved) => {
          const files = Array.from((event as DragEvent).dataTransfer?.files || []).filter((f) => f.type.startsWith("image/"));
          if (moved || !files.length || !editingRef.current) return false;
          event.preventDefault();
          const at = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY });
          const $p = at ? view.state.doc.resolve(at.pos) : null;
          void insertImagesRef.current(files, $p && $p.depth >= 1 ? $p.after(1) : undefined);
          return true;
        },
      },
      immediatelyRender: false,
      editable: canEdit,
      onUpdate: ({ editor }) => {
        if (canEdit) scheduleSave(editor);
      },
    },
    [ydoc, provider],
  );
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  // re-lay out the pages when the page setup, settings or styles change
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    try {
      editor.view.dispatch(editor.state.tr.setMeta(paginationKey, { tick: Date.now(), enabled: shownLayout === "print" }));
    } catch {
      /* view not mounted yet */
    }
  }, [editor, body, settings, styleCss, shownLayout, markup]);

  // Keep the outline (headings) in sync and reflect view/edit mode.
  useEffect(() => {
    if (!editor) return;
    const compute = () => {
      const items: { level: number; text: string; pos: number }[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading") items.push({ level: node.attrs.level as number, text: node.textContent || "Heading", pos });
      });
      setOutline(items);
    };
    compute();
    editor.on("update", compute);
    return () => {
      editor.off("update", compute);
    };
  }, [editor]);

  useEffect(() => {
    editor?.setEditable(editing && viewMode !== "read");
  }, [editor, editing, viewMode]);

  // formatting marks are decorations
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.commands.setFormattingMarks(showMarks);
  }, [editor, showMarks]);

  // Ctrl+F searches in the Navigation pane, Ctrl+H finds and replaces, Ctrl+Shift+8 shows formatting marks, Esc leaves Read and Focus modes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setShowOutline(true);
        setNavFocus((n) => n + 1);
      } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setFindOpen(true);
      } else if (mod && e.shiftKey && (e.key === "*" || e.code === "Digit8")) {
        e.preventDefault();
        setShowMarks((v) => !v);
      } else if (e.altKey && e.shiftKey && !mod && e.code === "KeyX" && editingRef.current && editorRef.current) {
        e.preventDefault();
        const st = editorRef.current.state;
        setIndexDialog({ kind: "mark", selected: st.doc.textBetween(st.selection.from, st.selection.to, " ") });
      } else if (e.key === "Escape" && viewMode !== "normal" && !document.querySelector("[role=dialog]")) {
        setViewMode("normal");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewMode]);

  // mail merge reads the Sheet's live state while the merge pane is open or results are previewed
  const mergeLive = !!settings.mergeSource && (panel === "merge" || mergePreview !== null);
  useEffect(() => {
    const src = settings.mergeSource;
    if (!src || !mergeLive) return;
    return watchMergeTable(src, (t) => t && setMergeTable({ fields: t.fields, records: t.records, live: true, unsupported: t.unsupported, source: t.source }), collabUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.mergeSource?.docId, settings.mergeSource?.sheetId, mergeLive, collabUrl]);

  // merge fields redraw when the previewed recipient changes
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta("mergePreview", mergePreview).setMeta("addToHistory", false));
  }, [editor, mergePreview, mergeTable]);

  // A .docx picked on the documents list ("Open Word document…") is imported once synced.
  const openRef = useRef(openDocx);
  openRef.current = openDocx;
  const openAnyRef = useRef(openAnyFile);
  openAnyRef.current = openAnyFile;
  useEffect(() => {
    if (!editor || !canEdit) return;
    const run = async () => {
      const f = takePendingImport(docId);
      if (!f) return;
      setBusy("Opening .docx…");
      try {
        await openAnyRef.current(f.name, await f.arrayBuffer());
      } catch {
        alert("Could not open that Word file.");
      } finally {
        setBusy(null);
      }
    };
    if (provider.isSynced) {
      const t = setTimeout(run, 0);
      return () => clearTimeout(t);
    }
    provider.on("synced", run);
    return () => {
      provider.off("synced", run);
    };
  }, [editor, canEdit, docId, provider]);

  // hooks for the browser tests
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__docsExportBytes = async () => Array.from((await buildDocxBytes()) || []);
    w.__docsOpenBytes = async (bytes: number[]) => openDocx(new Uint8Array(bytes));
    w.__docsLayout = () => {
      const l = editor ? paginationKey.getState(editor.state)?.layout : null;
      const st = editor ? paginationKey.getState(editor.state) : null;
      return l ? { pages: l.pages.map((p) => ({ width: p.width, height: p.height, top: p.top, label: p.label, section: p.section, hf: p.hf, notes: p.notes })), splits: (st?.gaps || []).map((g) => ({ block: g.block, line: g.line, kind: g.kind, page: g.page })) } : null;
    };
    w.__docsEditor = editor;
    w.__docsState = () => ({ styles: ownStyles, body, settings, json: editor?.getJSON() });
  });

  /** The whole Word-shaped state for a version: content, styles, last section and settings. */
  const versionState = (ed: Editor) =>
    JSON.stringify({ doc: ed.getJSON(), styles: Object.fromEntries(wordStyles.entries()), body: wordLayout.get("body") ?? null, settings: wordLayout.get("settings") ?? null });
  /** Put a version back: its saved state when it has one (older versions only have HTML). */
  const restoreVersion = (ed: Editor, v: { html: string; state?: string | null }) => {
    const st = parseJson<{ doc: PMNode; styles?: Record<string, string>; body?: string | null; settings?: string | null } | null>(v.state ?? undefined, null);
    if (st?.doc) {
      ydoc.transact(() => {
        for (const k of [...wordStyles.keys()]) wordStyles.delete(k);
        for (const [k, val] of Object.entries(st.styles || {})) if (typeof val === "string") wordStyles.set(k, val);
        if (st.body) wordLayout.set("body", st.body);
        else wordLayout.delete("body");
        if (st.settings) wordLayout.set("settings", st.settings);
        else wordLayout.delete("settings");
      });
    }
    ed.chain()
      .command(({ tr }) => {
        tr.setMeta(TRACK_SKIP, true);
        return true;
      })
      .setContent((st?.doc ?? v.html) as never)
      .run();
  };

  function scheduleSave(ed: Editor) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const text = ed.getText().replace(/\n+/g, " ").trim();
      // Title is user-controlled now; only the snippet is derived from content.
      await fetch(`/api/docs/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snippet: text.slice(0, 200) }),
      }).catch(() => {});
      // Snapshot a version at most every 45s (the API also dedupes identical HTML).
      const now = Date.now();
      if (now - lastVersion.current > 45000) {
        lastVersion.current = now;
        fetch(`/api/docs/${docId}/versions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ html: ed.getHTML(), state: versionState(ed) }),
        }).catch(() => {});
      }
    }, 1200);
  }

  // ---- sections ----
  /** Section index of the cursor, and the sections in order (the last one is `body`). */
  const sectionAtCursor = useCallback(() => {
    if (!editor) return { index: 0, sections: [body] };
    const { sections, blockSection } = sectionsOf(editor.state.doc, body);
    const i = editor.state.selection.$from.index(0);
    return { index: blockSection[Math.min(i, blockSection.length - 1)] ?? sections.length - 1, sections };
  }, [editor, body]);

  /** Write one section's properties: the last section lives in the shared map, the others on their break. */
  const writeSection = (index: number, s: Section) => {
    if (!editor) return;
    const { sections } = sectionsOf(editor.state.doc, body);
    if (index >= sections.length - 1) {
      setBody(s);
      return;
    }
    let k = 0;
    let pos = -1;
    editor.state.doc.forEach((n, off) => {
      if (n.type.name === "sectionBreak") {
        if (k === index) pos = off;
        k++;
      }
    });
    if (pos >= 0) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { section: JSON.stringify(s) }));
  };

  const applyPageSetup = (s: Section, scope: "section" | "all") => {
    if (!editor) return;
    const { index, sections } = sectionAtCursor();
    if (scope === "section") writeSection(index, s);
    else {
      const page = { pageWidth: s.pageWidth, pageHeight: s.pageHeight, orientation: s.orientation, margins: s.margins, columns: s.columns };
      // breaks first (positions do not move), then the last section
      const tr = editor.state.tr;
      editor.state.doc.forEach((n, off) => {
        if (n.type.name === "sectionBreak") tr.setNodeMarkup(off, undefined, { section: JSON.stringify({ ...parseSection(n.attrs.section), ...page }) });
      });
      if (tr.docChanged) editor.view.dispatch(tr);
      setBody({ ...sections[sections.length - 1], ...page });
    }
    setPageSetupOpen(false);
  };

  const quickLayout = (patch: (s: Section) => Section) => {
    const { index, sections } = sectionAtCursor();
    writeSection(index, patch(sections[index]));
  };

  /** Insert a section break after the cursor's block; the part after it starts as `type`. */
  const insertSectionBreak = (type: NonNullable<Section["type"]>) => {
    if (!editor || !editing) return;
    const { state } = editor;
    const $from = state.selection.$from;
    const idx = $from.index(0);
    let insertAt = $from.depth === 0 ? $from.pos : $from.after(1);
    if ($from.depth > 0 && $from.parentOffset === 0 && $from.parent.content.size > 0 && $from.depth === 1) insertAt = $from.before(1);
    let termPos = -1;
    let termSection: Section | null = null;
    state.doc.forEach((n, off, i) => {
      if (termPos < 0 && i >= idx && n.type.name === "sectionBreak" && off >= insertAt) {
        termPos = off;
        termSection = parseSection(n.attrs.section);
      }
    });
    const cur: Section = termSection ?? body;
    const tr = state.tr;
    if (termPos >= 0) tr.setNodeMarkup(termPos, undefined, { section: JSON.stringify({ ...cur, type }) });
    const nodes = [state.schema.nodes.sectionBreak.create({ section: JSON.stringify(cur) })];
    const after = state.doc.resolve(insertAt).nodeAfter;
    if (!after || after.type.name === "sectionBreak") nodes.push(state.schema.nodes.paragraph.create());
    tr.insert(insertAt, nodes);
    editor.view.dispatch(tr);
    if (termPos < 0) setBody({ ...body, type });
    editor.commands.focus();
  };

  const insertPageBreakAfter = () => {
    if (!editor || !editing) return;
    editor.chain().focus().insertPageBreak().run();
  };

  const insertNote = (kind: NoteKind) => {
    if (!editor || !editing) return;
    editor.chain().focus().insertNote(kind).run();
    setNoteEdit(editor.state.selection.from - 1);
  };

  /** Insert a block (TOC, bibliography…): before the paragraph when the cursor is at its start, else after it, with an empty paragraph to type in. */
  const insertBlock = (block: PMNode) => {
    if (!editor || !editing) return;
    const $f = editor.state.selection.$from;
    if ($f.depth >= 1 && $f.parent.isTextblock && $f.parentOffset === 0 && $f.parent.content.size > 0) editor.chain().focus().insertContentAt($f.before($f.depth), block).run();
    else editor.chain().focus().insertContent([block, { type: "paragraph" }]).run();
  };

  // ---- pictures: stored as media files beside the document, not as data: URLs inside it ----
  const uploadImage = async (blob: Blob, name = ""): Promise<string | null> => {
    try {
      const r = await fetch(`/api/docs/${docId}/images?name=${encodeURIComponent(name)}`, { method: "POST", headers: { "Content-Type": blob.type || "application/octet-stream" }, body: blob });
      if (!r.ok) return null;
      return ((await r.json()) as { url: string }).url;
    } catch {
      return null;
    }
  };
  const imageSizeOf = (blob: Blob) =>
    new Promise<{ width: number; height: number } | null>((resolve) => {
      const u = URL.createObjectURL(blob);
      const im = new Image();
      im.onload = () => {
        resolve({ width: im.naturalWidth, height: im.naturalHeight });
        URL.revokeObjectURL(u);
      };
      im.onerror = () => {
        resolve(null);
        URL.revokeObjectURL(u);
      };
      im.src = u;
    });
  /** Upload picture files and insert them at `at` (or the cursor), scaled to fit the column. */
  const insertImageFiles = async (files: File[], at?: number) => {
    if (!editor || !editing) return;
    const max = ptToPx(contentWidth(body));
    for (const f of files.filter((x) => /^image\/(png|jpeg|gif|webp|bmp)$/.test(x.type))) {
      setBusy("Uploading picture…");
      const [url, size] = await Promise.all([uploadImage(f, f.name), imageSizeOf(f)]);
      setBusy(null);
      if (!url) {
        alert(`“${f.name}” could not be uploaded.`);
        continue;
      }
      const w = size ? Math.min(size.width, Math.round(max)) : null;
      const h = size && w ? Math.round((size.height * w) / size.width) : null;
      const node = { type: "image", attrs: { src: url, alt: f.name.replace(/\.[^.]+$/, ""), width: w, height: h } };
      if (at !== undefined) editor.chain().focus().insertContentAt(at, node).run();
      else editor.chain().focus().insertContent(node).run();
    }
  };

  insertImagesRef.current = insertImageFiles;
  // pictures that arrive as data: URLs (pasted web content, opened .docx files, older documents) move to media files
  useEffect(() => {
    if (!editor || !editing) return;
    const inFlight = new Set<string>();
    const failed = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = async () => {
      const srcs = new Set<string>();
      editor.state.doc.descendants((n) => {
        const src = n.attrs?.src;
        if (n.type.name === "image" && typeof src === "string" && /^data:image\/(png|jpeg|gif|webp|bmp)[;,]/.test(src) && !inFlight.has(src) && !failed.has(src)) srcs.add(src);
      });
      for (const src of srcs) {
        inFlight.add(src);
        try {
          const blob = await (await fetch(src)).blob();
          const url = await uploadImage(blob);
          if (!url) failed.add(src);
          if (!url || editor.isDestroyed) continue;
          const tr = editor.state.tr;
          editor.state.doc.descendants((n, pos) => {
            if (n.type.name === "image" && n.attrs.src === src) tr.setNodeMarkup(pos, undefined, { ...n.attrs, src: url });
          });
          if (tr.docChanged) editor.view.dispatch(tr.setMeta(TRACK_SKIP, true).setMeta("addToHistory", false));
        } catch {
          // the picture stays inline
        } finally {
          inFlight.delete(src);
        }
      }
    };
    const onUpdate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, 1200);
    };
    editor.on("update", onUpdate);
    onUpdate();
    return () => {
      editor.off("update", onUpdate);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, editing]);

  // ---- pictures, shapes and text boxes ----
  /** The picture or shape that is selected, or the shape the cursor is in. */
  const objectAt = (): number | null => {
    if (!editor) return null;
    const sel = editor.state.selection;
    if (sel instanceof NodeSelection && (sel.node.type.name === "image" || sel.node.type.name === "shape")) return sel.from;
    const $f = sel.$from;
    for (let d = $f.depth; d > 0; d--) if ($f.node(d).type.name === "shape") return $f.before(d);
    return null;
  };
  const SHAPE_DEFAULT = { kind: "rect", width: 192, height: 96, fill: "#4472c4", stroke: "#2f528f", strokeWidth: 1, color: "#ffffff", valign: "middle", wrap: "square", textBox: false };
  const TEXTBOX_DEFAULT = { kind: "rect", width: 240, height: 96, fill: "#ffffff", stroke: "#000000", strokeWidth: 0.75, color: null, valign: "top", wrap: "square", textBox: true };
  /** Insert a shape: a floating one goes before the paragraph the cursor is in (so the text wraps beside it). */
  const insertShapeNode = (attrs: Record<string, unknown>) => {
    if (!editor || !editing) return;
    const $f = editor.state.selection.$from;
    const floating = attrs.wrap !== "inline" && attrs.wrap !== "topBottom";
    const at = $f.depth >= 1 && (floating || ($f.parent.isTextblock && $f.parentOffset === 0)) ? $f.before(1) : $f.depth >= 1 ? $f.after(1) : $f.pos;
    const h = attrs.kind === "line" ? 2 : attrs.height;
    editor.chain().focus().insertContentAt(at, { type: "shape", attrs: { ...attrs, height: h }, content: [{ type: "paragraph", ...(attrs.textBox ? {} : { attrs: { textAlign: "center" } }) }] }).setTextSelection(at + 2).run();
  };

  // ---- captions, cross-references, bookmarks ----
  const captionBlock = () => {
    const sel = editor!.state.selection;
    if (sel instanceof NodeSelection && sel.node.isBlock) return { start: sel.from, end: sel.to };
    const $f = sel.$from;
    return $f.depth >= 1 ? { start: $f.before(1), end: $f.after(1) } : { start: $f.pos, end: $f.pos };
  };
  const insertCaption = (c: CaptionSpec) => {
    if (!editor || !editing) return;
    const { start, end } = captionBlock();
    const at = c.below ? end : start;
    const para: PMNode = {
      type: "paragraph",
      attrs: { styleId: "Caption" },
      content: [{ type: "bookmark", attrs: { name: refName(), span: "label" } }, { type: "text", text: `${c.label} ` }, { type: "seqField", attrs: { name: c.label } }, ...(c.text ? [{ type: "text", text: `${c.sep}${c.text}` }] : [])],
    };
    editor.chain().focus().insertContentAt(at, para).run();
    const n = editor.state.doc.nodeAt(at);
    if (n) editor.commands.setTextSelection(at + n.nodeSize - 1);
    setRefDialog(null);
  };
  const insertCrossRef = (t: XrefTarget, show: RefShow) => {
    if (!editor || !editing) return;
    editor
      .chain()
      .focus()
      .command(({ tr, state }) => {
        let name = t.kind === "bookmark" ? t.name : "";
        if (t.kind !== "bookmark") {
          const block = tr.doc.nodeAt(t.pos);
          if (!block) return false;
          const span = t.kind === "caption" && !t.whole ? "label" : "para";
          block.forEach((n) => {
            if (!name && n.type.name === "bookmark" && (n.attrs.span || "para") === span) name = String(n.attrs.name);
          });
          if (!name) {
            name = refName();
            tr.insert(t.pos + 1, state.schema.nodes.bookmark.create({ name, span }));
          }
        }
        tr.replaceSelectionWith(state.schema.nodes.crossRef.create({ target: name, show, link: true }), true);
        return true;
      })
      .run();
    setRefDialog(null);
  };
  const insertFigureTable = (label: string) => {
    if (!editor || !editing) return;
    insertBlock({ type: "tableOfContents", attrs: { levels: 1, title: null, caption: label } });
  };

  const insertToc = () => {
    if (!editor || !editing) return;
    insertBlock({ type: "tableOfContents", attrs: { levels: 3, title: "Contents" } });
  };

  const insertPageNumbers = () => {
    const { index, sections } = sectionAtCursor();
    const s = sections[index];
    const footer: PMNode = { type: "doc", content: [{ type: "paragraph", attrs: { textAlign: "center" }, content: [{ type: "pageField", attrs: { kind: "page" } }] }] };
    if (!s.footers?.default) writeSection(index, { ...s, footers: { ...(s.footers || {}), default: footer } });
    setHfOpen({ index, kind: "footers", type: "default" });
  };

  // ---- styles ----
  const currentStyle = (): string => {
    if (!editor) return "Normal";
    const p = editor.state.selection.$from.parent;
    if (p.type.name === "heading") return `Heading${p.attrs.level}`;
    return (p.attrs.styleId as string) || "Normal";
  };
  const currentChar = (): string | null => (editor?.getAttributes("textStyle").charStyle as string) || null;
  const applyStyle = (s: DocStyle) => {
    if (!editor || !editing) return;
    if (s.type === "character") editor.chain().focus().setCharStyle(currentChar() === s.id ? null : s.id).run();
    else editor.chain().focus().setParagraphStyle(s.id).run();
  };
  const stylesInUse = () => {
    const set = new Set<string>();
    editor?.state.doc.descendants((n) => {
      if (n.type.name === "heading") set.add(`Heading${n.attrs.level}`);
      if (n.attrs?.styleId) set.add(n.attrs.styleId as string);
      for (const m of n.marks) if (m.type.name === "textStyle" && m.attrs.charStyle) set.add(m.attrs.charStyle as string);
    });
    return set;
  };
  const newStyleFromSelection = () => {
    if (!editor) return;
    const f = selectionFormatting(editor);
    setStyleEdit({ initial: { type: "paragraph", run: f.run, para: f.para, basedOn: currentStyle() } });
  };
  const applyTheme = (id: string) => {
    const prev = themeOf(settings.theme);
    const next = themeOf(id);
    ydoc.transact(() => {
      restyleForTheme(styles, prev, next).forEach(putStyle);
      setSettings({ ...setupRef.current.settings, theme: id === "office" ? undefined : id });
    });
  };
  const updateStyleFromSelection = (s: DocStyle) => {
    if (!editor || !editing) return;
    const f = selectionFormatting(editor);
    putStyle({ ...s, run: { ...s.run, ...f.run }, ...(s.type === "paragraph" ? { para: { ...(s.para || {}), ...f.para } } : {}) });
  };
  const saveStyle = (s: DocStyle, isNew: boolean) => {
    putStyle(s);
    setStyleEdit(null);
    if (isNew && editor) {
      if (s.type === "paragraph") editor.chain().focus().setParagraphStyle(s.id).setParaFormat({ spaceBefore: null, spaceAfter: null, lineHeight: null, indLeft: null, indRight: null, indFirst: null, textAlign: null }).run();
      else editor.chain().focus().setCharStyle(s.id).run();
    }
  };

  const E = (fn: () => void) => () => {
    if (editing) fn();
  };
  const c = editor;
  const menus: Menu[] = c
    ? [
        {
          label: "File",
          items: [
            { label: "New document", onClick: () => newDoc("doc") },
            { label: "New spreadsheet", onClick: () => newDoc("sheet") },
            { label: "New presentation", onClick: () => newDoc("slide") },
            { divider: true },
            { label: "Open document (.docx, .dotx, .docm, .odt, .rtf, .doc, .txt, .md)…", onClick: () => docxInput.current?.click(), disabled: !editing },
            { divider: true },
            { label: "Download as Word (.docx)", onClick: exportDocx },
            { label: "Download as Word template (.dotx)", onClick: exportTemplate },
            { label: "Download as Plain text (.txt)", onClick: () => exportPlain("txt") },
            { label: "Download as Markdown (.md)", onClick: () => exportPlain("md") },
            { label: "Download as PDF (.pdf)", onClick: exportPdf },
            { label: "Download as OpenDocument (.odt)", onClick: () => exportConverted("odt") },
            { label: "Download as Rich Text (.rtf)", onClick: () => exportConverted("rtf") },
            { divider: true },
            { label: "Page setup…", onClick: () => setPageSetupOpen(true), disabled: !editing },
            { label: "Properties…", onClick: () => setPropsOpen(true), disabled: !editing },
            { label: "Sensitivity…", onClick: () => setLabelOpen(true) },
            { label: "Version history", onClick: () => setPanel("history"), shortcut: "" },
            { label: "Rename", onClick: () => (document.querySelector('input[placeholder="Untitled"]') as HTMLInputElement | null)?.select(), disabled: !canEdit },
            { label: "Move to trash", onClick: () => remove(), disabled: !isOwner },
            { divider: true },
            { label: "Share…", onClick: () => setShareOpen(true), disabled: !canEdit },
            { label: "Print", onClick: () => void printDoc(), shortcut: "Ctrl+P" },
          ],
        },
        {
          label: "Edit",
          items: [
            { label: "Undo", onClick: E(() => c.chain().focus().undo().run()), shortcut: "Ctrl+Z", disabled: !editing },
            { label: "Redo", onClick: E(() => c.chain().focus().redo().run()), shortcut: "Ctrl+Y", disabled: !editing },
            { divider: true },
            { label: "Select all", onClick: () => c.chain().focus().selectAll().run(), shortcut: "Ctrl+A" },
            { divider: true },
            { label: "Find and replace", onClick: () => setFindOpen(true), shortcut: "Ctrl+H" },
          ],
        },
        {
          label: "View",
          items: [
            { label: "Print layout", checked: layoutMode === "print", onClick: () => setLayoutMode("print") },
            { label: "Web layout", checked: layoutMode === "web", onClick: () => setLayoutMode("web") },
            { divider: true },
            { label: "Read mode", checked: viewMode === "read", onClick: () => setViewMode((v) => (v === "read" ? "normal" : "read")) },
            { label: "Focus", checked: viewMode === "focus", onClick: () => setViewMode((v) => (v === "focus" ? "normal" : "focus")) },
            { divider: true },
            { label: "Navigation pane", checked: showOutline, onClick: () => setShowOutline((v) => !v), shortcut: "Ctrl+F" },
            { label: "Formatting marks", checked: showMarks, onClick: () => setShowMarks((v) => !v), shortcut: "Ctrl+Shift+8" },
            { label: "Show ruler", checked: showRuler, onClick: () => setShowRuler((v) => !v) },
            { label: "Styles pane", checked: panel === "styles", onClick: () => setPanel((p) => (p === "styles" ? null : "styles")) },
            { label: "Split", checked: split !== null, onClick: () => setSplit((v) => (v === null ? 260 : null)) },
            { divider: true },
            { label: "Editing", checked: mode === "editing", onClick: () => setMode("editing"), disabled: !canEdit },
            { label: "Suggesting", checked: mode === "suggesting", onClick: () => setMode("suggesting"), disabled: !canEdit },
            { label: "Viewing", checked: mode === "viewing", onClick: () => setMode("viewing") },
            { divider: true },
            { label: "Full screen", onClick: () => document.documentElement.requestFullscreen?.() },
          ],
        },
        {
          label: "Insert",
          items: [
            { label: "Picture (upload)…", onClick: () => imageInput.current?.click(), disabled: !editing },
            { label: "Image (by URL)…", onClick: E(() => { const u = window.prompt("Image URL"); if (u) c.chain().focus().setImage({ src: u }).run(); }), disabled: !editing },
            { label: "Table (3×3)", onClick: E(() => c.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()), disabled: !editing },
            { label: "Link…", onClick: E(() => { const u = window.prompt("Link URL", "https://"); if (u) c.chain().focus().setLink({ href: u }).run(); }), disabled: !editing },
            { label: "Comment", onClick: startComment, disabled: !canComment },
            { label: "Drop cap…", onClick: () => setFmtDialog("dropcap"), disabled: !editing },
            { label: "Horizontal line", onClick: E(() => c.chain().focus().setHorizontalRule().run()), disabled: !editing },
            { divider: true },
            { label: "Page break", onClick: insertPageBreakAfter, shortcut: "Ctrl+Enter", disabled: !editing },
            { label: "Header and footer…", onClick: () => { const { index } = sectionAtCursor(); setHfOpen({ index, kind: "headers", type: "default" }); }, disabled: !editing },
            { label: "Page numbers", onClick: insertPageNumbers, disabled: !editing },
            { label: "Table of contents", onClick: insertToc, disabled: !editing },
            { divider: true },
            { label: "Footnote", onClick: () => insertNote("footnote"), shortcut: "Ctrl+Alt+F", disabled: !editing },
            { label: "Endnote", onClick: () => insertNote("endnote"), shortcut: "Ctrl+Alt+D", disabled: !editing },
            { label: "Text box", onClick: () => insertShapeNode(TEXTBOX_DEFAULT), disabled: !editing },
            { label: "Shape…", onClick: () => setLayoutEdit({ insert: SHAPE_DEFAULT }), disabled: !editing },
            { label: "Chart…", onClick: () => setGraphicEdit({ kind: "chart", pos: null }), disabled: !editing },
            { label: "SmartArt…", onClick: () => setGraphicEdit({ kind: "smartArt", pos: null }), disabled: !editing },
            { label: "Equation…", onClick: () => setEqEdit({ pos: null }), shortcut: "Alt+=", disabled: !editing },
            { label: "Caption…", onClick: () => setRefDialog("caption"), disabled: !editing },
            { label: "Bookmark…", onClick: () => setRefDialog("bookmark"), disabled: !editing },
            { divider: true },
            { label: "Date and time…", onClick: () => setFieldDialog("date"), disabled: !editing },
            { label: "Field…", onClick: () => setFieldDialog("field"), disabled: !editing },
            { label: "Symbol…", onClick: () => setSymbolOpen(true), disabled: !editing },
            { label: "Text from file…", onClick: () => insertFileInput.current?.click(), disabled: !editing },
            {
              label: "Content control",
              disabled: !editing,
              items: (Object.keys(CONTROL_LABELS) as ControlKind[]).map((k) => ({
                label: CONTROL_LABELS[k],
                onClick: E(() => {
                  const attrs: Record<string, unknown> = {};
                  if (k === "dropdown" || k === "comboBox") {
                    const items = window.prompt("Items, separated by commas", "Choice 1, Choice 2, Choice 3");
                    if (items === null) return;
                    attrs.items = JSON.stringify(items.split(",").map((t) => t.trim()).filter(Boolean).map((t) => ({ text: t, value: t })));
                  }
                  c.chain().focus().insertContentControl(k, attrs).run();
                }),
              })).concat([
                {
                  label: "Group the selected paragraphs (block control)",
                  onClick: E(() => {
                    const title = window.prompt("Title of the block content control", "");
                    if (title === null) return;
                    c.chain().focus().insertBlockControl(title.trim() ? { title: title.trim() } : {}).run();
                  }),
                },
                { label: "Remove the block control around the selection", onClick: E(() => c.chain().focus().removeBlockControl().run()) },
              ]),
            },
            { label: "Update fields", onClick: E(() => c.chain().focus().updateDocFields().run()), shortcut: "F9", disabled: !editing },
            { label: "Cross-reference…", onClick: () => setRefDialog("xref"), disabled: !editing },
          ],
        },
        {
          label: "Format",
          items: [
            { label: "Bold", onClick: E(() => c.chain().focus().toggleBold().run()), shortcut: "Ctrl+B", disabled: !editing },
            { label: "Italic", onClick: E(() => c.chain().focus().toggleItalic().run()), shortcut: "Ctrl+I", disabled: !editing },
            { label: "Underline", onClick: E(() => c.chain().focus().toggleUnderline().run()), shortcut: "Ctrl+U", disabled: !editing },
            { label: "Strikethrough", onClick: E(() => c.chain().focus().toggleStrike().run()), disabled: !editing },
            { label: "Superscript", onClick: E(() => c.chain().focus().toggleSuperscript().run()), shortcut: "Ctrl+Shift+=", disabled: !editing },
            { label: "Subscript", onClick: E(() => c.chain().focus().toggleSubscript().run()), shortcut: "Ctrl+=", disabled: !editing },
            { divider: true },
            { label: "Font…", onClick: () => setFmtDialog("font"), shortcut: "Ctrl+D", disabled: !editing },
            { label: "Paragraph…", onClick: () => setParaOpen(true), disabled: !editing },
            { label: "Tabs…", onClick: () => setFmtDialog("tabs"), disabled: !editing },
            { label: "Borders and shading…", onClick: () => setFmtDialog("borders"), disabled: !editing },
            { label: "Change case", disabled: !editing, items: CASE_MODES.map((m) => ({ label: m.label, onClick: E(() => c.chain().focus().changeCase(m.id).run()) })) },
            { label: "Format painter", checked: !!c && formatPainterOn(c.state), onClick: E(() => c.chain().focus().copyFormat().run()), shortcut: "Ctrl+Shift+C", disabled: !editing },
            { label: "Styles…", onClick: () => setPanel("styles") },
            { label: "New style from selection…", onClick: newStyleFromSelection, disabled: !editing },
            { label: "Style inspector", checked: panel === "inspector", onClick: () => setPanel((p) => (p === "inspector" ? null : "inspector")) },
            { divider: true },
            { label: "Bulleted list", onClick: E(() => c.chain().focus().toggleBulletList().run()), disabled: !editing },
            { label: "Numbered list", onClick: E(() => c.chain().focus().toggleOrderedList().run()), disabled: !editing },
            { label: "Checklist", onClick: E(() => c.chain().focus().toggleTaskList().run()), disabled: !editing },
            {
              label: "Bullets and numbering",
              disabled: !editing,
              items: [
                { label: "Numbering", items: NUMBER_FORMATS.map((f) => ({ label: f.label, onClick: E(() => applyNumberFormat(c, f.id)) })) },
                { label: "Bullets", items: BULLETS.map((b) => ({ label: b.label, onClick: E(() => applyBullet(c, b.id)) })) },
                { divider: true },
                { label: "Restart at 1", onClick: E(() => restartNumbering(c)) },
                { label: "Continue numbering", onClick: E(() => { if (!continueNumbering(c)) alert("There is no numbered list before this one to continue."); }) },
                { label: "Set numbering value…", onClick: E(() => { const v = window.prompt("Set value to", "1"); if (v !== null && Number(v) >= 0) setNumberingValue(c, Number(v)); }) },
              ],
            },
            { divider: true },
            { label: "Wrap text and position…", onClick: () => { const p = objectAt(); if (p !== null) setLayoutEdit({ pos: p }); }, disabled: !editing },
            { label: "Clear formatting", onClick: E(() => c.chain().focus().unsetAllMarks().clearNodes().setParaFormat({ spaceBefore: null, spaceAfter: null, lineHeight: null, indLeft: null, indRight: null, indFirst: null }).run()), disabled: !editing },
          ],
        },
        {
          label: "Design",
          items: [
            { label: "Themes", disabled: !editing, items: THEMES.map((t) => ({ label: `${t.name} (${t.major} / ${t.minor})`, checked: (settings.theme || "office") === t.id, onClick: () => applyTheme(t.id) })) },
            { label: "Style sets", disabled: !editing, items: styleSets(themeOf(settings.theme)).map((set) => ({ label: set.name, onClick: () => applyStyleSet(styles, set).forEach(putStyle) })) },
            { divider: true },
            { label: "Watermark…", onClick: () => setDesignDialog("watermark"), disabled: !editing },
            { label: "Page color", disabled: !editing, items: [{ label: "No color", checked: !settings.pageColor, onClick: () => setSettings({ ...settings, pageColor: undefined }) }, ...PAGE_COLORS.map((c) => ({ label: c, checked: settings.pageColor === c, onClick: () => setSettings({ ...settings, pageColor: c }) }))] },
            { label: "Page borders…", onClick: () => setDesignDialog("pageBorders"), disabled: !editing },
          ],
        },
        {
          label: "Layout",
          items: [
            { label: "Page setup…", onClick: () => setPageSetupOpen(true), disabled: !editing },
            { label: "Properties…", onClick: () => setPropsOpen(true), disabled: !editing },
            { divider: true },
            { label: "Orientation: Portrait", onClick: E(() => quickLayout((s) => (s.orientation === "portrait" ? s : { ...s, orientation: "portrait", pageWidth: s.pageHeight, pageHeight: s.pageWidth }))), disabled: !editing },
            { label: "Orientation: Landscape", onClick: E(() => quickLayout((s) => (s.orientation === "landscape" ? s : { ...s, orientation: "landscape", pageWidth: s.pageHeight, pageHeight: s.pageWidth }))), disabled: !editing },
            { label: "Margins: Normal", onClick: E(() => quickLayout((s) => ({ ...s, margins: { ...s.margins, top: 72, bottom: 72, left: 72, right: 72 } }))), disabled: !editing },
            { label: "Margins: Narrow", onClick: E(() => quickLayout((s) => ({ ...s, margins: { ...s.margins, top: 36, bottom: 36, left: 36, right: 36 } }))), disabled: !editing },
            { label: "Columns: One", onClick: E(() => quickLayout((s) => ({ ...s, columns: undefined }))), disabled: !editing },
            { label: "Columns: Two", onClick: E(() => quickLayout((s) => ({ ...s, columns: { count: 2, space: 36 } }))), disabled: !editing },
            { label: "Columns: Three", onClick: E(() => quickLayout((s) => ({ ...s, columns: { count: 3, space: 36 } }))), disabled: !editing },
            { divider: true },
            { label: "Break: Page", onClick: insertPageBreakAfter, disabled: !editing },
            { label: "Break: Section (next page)", onClick: () => insertSectionBreak("nextPage"), disabled: !editing },
            { label: "Break: Section (continuous)", onClick: () => insertSectionBreak("continuous"), disabled: !editing },
            { label: "Break: Section (even page)", onClick: () => insertSectionBreak("evenPage"), disabled: !editing },
            { label: "Break: Section (odd page)", onClick: () => insertSectionBreak("oddPage"), disabled: !editing },
            { divider: true },
            { label: "Headers and footers…", onClick: () => { const { index } = sectionAtCursor(); setHfOpen({ index, kind: "headers", type: "default" }); }, disabled: !editing },
            { divider: true },
            (() => {
              const cur = editing ? sectionAtCursor() : null;
              const ln = cur?.sections[cur.index]?.lineNumbers;
              const setLn = (v: LineNumbers | undefined) => quickLayout((sec) => ({ ...sec, lineNumbers: v }));
              return {
                label: "Line numbers",
                disabled: !editing,
                items: [
                  { label: "None", checked: !ln, onClick: () => setLn(undefined) },
                  { label: "Continuous", checked: ln?.restart === "continuous", onClick: () => setLn({ countBy: 1, start: 1, restart: "continuous", distance: 0 }) },
                  { label: "Restart each page", checked: ln?.restart === "newPage", onClick: () => setLn({ countBy: 1, start: 1, restart: "newPage", distance: 0 }) },
                  { label: "Restart each section", checked: ln?.restart === "newSection", onClick: () => setLn({ countBy: 1, start: 1, restart: "newSection", distance: 0 }) },
                  { label: "Count by 5", checked: ln?.countBy === 5, onClick: () => setLn({ countBy: 5, start: 1, restart: ln?.restart || "continuous", distance: 0 }) },
                ],
              };
            })(),
            { label: "Hyphenation", disabled: !editing, items: [{ label: "None", checked: !settings.autoHyphenation, onClick: () => setSettings({ ...settings, autoHyphenation: undefined }) }, { label: "Automatic", checked: !!settings.autoHyphenation, onClick: () => setSettings({ ...settings, autoHyphenation: true }) }] },
            { label: "Mirror margins", checked: !!settings.mirrorMargins, disabled: !editing, onClick: () => setSettings({ ...settings, mirrorMargins: settings.mirrorMargins ? undefined : true }) },
          ],
        },
        (() => {
          const t = c ? tableAround(c.state) : null;
          const look = lookOf(t?.node.attrs.look);
          const inT = !!t && editing;
          const lookItem = (label: string, k: keyof TableLook) => ({ label, checked: look[k], disabled: !inT || !t?.node.attrs.tableStyle, onClick: E(() => c.chain().focus().setTableLook({ [k]: !look[k] }).run()) });
          const bd = (label: string, which: string) => ({ label, disabled: !inT, onClick: E(() => c.chain().focus().setCellBorders(which).run()) });
          const conv = (sep: "tab" | "comma" | "paragraph") => E(() => c.chain().focus().convertTextToTable(sep).run());
          return {
            label: "Table",
            items: [
              { label: "Insert table (3×3)", onClick: E(() => c.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()), disabled: !editing || !!t },
              { divider: true as const },
              { label: "Table styles", disabled: !inT, items: [{ label: "No style", checked: !t?.node.attrs.tableStyle, onClick: E(() => c.chain().focus().setTableStyle(null).run()) }, ...TABLE_STYLES.map((st) => ({ label: st.name, checked: t?.node.attrs.tableStyle === st.id, onClick: E(() => c.chain().focus().setTableStyle(st.id).run()) }))] },
              { label: "Table style options", disabled: !inT, items: [lookItem("Header row", "firstRow"), lookItem("Total row", "lastRow"), lookItem("Banded rows", "bandedRows"), lookItem("First column", "firstColumn"), lookItem("Banded columns", "bandedColumns")] },
              { label: "Borders", disabled: !inT, items: [bd("All borders", "all"), bd("Outside borders", "outside"), bd("No border", "none"), bd("Top border", "top"), bd("Bottom border", "bottom"), bd("Left border", "left"), bd("Right border", "right"), bd("Inside horizontal border", "insideH"), bd("Inside vertical border", "insideV")] },
              { label: "Cell alignment", disabled: !inT, items: (["top", "middle", "bottom"] as const).map((v) => ({ label: `Align ${v === "middle" ? "center" : v}`, onClick: E(() => c.chain().focus().setCellVAlign(v).run()) })) },
              { label: "Table alignment", disabled: !inT, items: (["left", "center", "right"] as const).map((v) => ({ label: `Table ${v}`, checked: (t?.node.attrs.align || "left") === v, onClick: E(() => c.chain().focus().setTableAlign(v).run()) })) },
              { divider: true as const },
              { label: "Sort…", disabled: !inT, onClick: () => setFmtDialog("sort") },
              { label: "Formula…", disabled: !inT, onClick: () => setFieldDialog("formula") },
              { divider: true as const },
              { label: "Convert text to table", disabled: !editing || !!t, items: [{ label: "Separate at tabs", onClick: conv("tab") }, { label: "Separate at commas", onClick: conv("comma") }, { label: "One column (paragraphs)", onClick: conv("paragraph") }] },
              { label: "Convert table to text", disabled: !inT, items: [{ label: "Separate with tabs", onClick: E(() => c.chain().focus().convertTableToText("tab").run()) }, { label: "Separate with commas", onClick: E(() => c.chain().focus().convertTableToText("comma").run()) }, { label: "Paragraph marks", onClick: E(() => c.chain().focus().convertTableToText("paragraph").run()) }] },
              { divider: true as const },
              { label: "Delete table", disabled: !inT, onClick: E(() => c.chain().focus().deleteTable().run()) },
            ],
          };
        })(),
        {
          label: "References",
          items: [
            { label: "Table of contents", onClick: insertToc, disabled: !editing },
            { label: "Table of contents (2 levels)", onClick: () => insertBlock({ type: "tableOfContents", attrs: { levels: 2, title: "Contents" } }), disabled: !editing },
            { divider: true },
            { label: "Insert footnote", onClick: () => insertNote("footnote"), shortcut: "Ctrl+Alt+F", disabled: !editing },
            { label: "Insert endnote", onClick: () => insertNote("endnote"), shortcut: "Ctrl+Alt+D", disabled: !editing },
            { divider: true },
            { label: "Insert caption…", onClick: () => setRefDialog("caption"), disabled: !editing },
            { label: "Insert table of figures", onClick: () => insertFigureTable("Figure"), disabled: !editing },
            { label: "Insert list of tables", onClick: () => insertFigureTable("Table"), disabled: !editing },
            { label: "Cross-reference…", onClick: () => setRefDialog("xref"), disabled: !editing },
            { label: "Bookmark…", onClick: () => setRefDialog("bookmark"), disabled: !editing },
            { divider: true },
            { label: "Insert citation…", onClick: () => setCiteDialog({}), disabled: !editing },
            { label: "Manage sources…", onClick: () => setSourcesOpen(true), disabled: !editing },
            { label: "Insert bibliography", onClick: () => insertBlock({ type: "bibliography", attrs: { title: null } }), disabled: !editing },
            { divider: true },
            { label: "Mark entry…", onClick: () => setIndexDialog({ kind: "mark", selected: c.state.doc.textBetween(c.state.selection.from, c.state.selection.to, " ") }), shortcut: "Alt+Shift+X", disabled: !editing },
            { label: "Insert index…", onClick: () => setIndexDialog({ kind: "index", pos: null }), disabled: !editing },
            ...CITATION_STYLES.map((cs) => ({ label: `Citation style: ${cs.label}`, checked: (settings.citationStyle || "APA") === cs.id, onClick: () => setSettings({ ...settings, citationStyle: cs.id }), disabled: !editing })),
          ],
        },
        {
          label: "Review",
          items: [
            { label: "Track changes", checked: !!settings.trackRevisions, onClick: () => setSettings({ ...settings, trackRevisions: !settings.trackRevisions }), disabled: !canEdit },
            { label: "Suggesting mode", checked: mode === "suggesting", onClick: () => setMode((m) => (m === "suggesting" ? "editing" : "suggesting")), disabled: !canEdit },
            { divider: true },
            { label: "Show markup: All", checked: markup === "all", onClick: () => setMarkup("all") },
            { label: "Show markup: No markup (final)", checked: markup === "final", onClick: () => setMarkup("final") },
            { label: "Show markup: Original", checked: markup === "original", onClick: () => setMarkup("original") },
            { divider: true },
            { label: "Previous change", onClick: () => stepChange(c, -1) },
            { label: "Next change", onClick: () => stepChange(c, 1) },
            { label: "Accept change", onClick: E(() => c.chain().focus().acceptChanges().run()), disabled: !editing },
            { label: "Reject change", onClick: E(() => c.chain().focus().rejectChanges().run()), disabled: !editing },
            { label: "Accept all changes", onClick: E(() => c.chain().focus().acceptAllChanges().run()), disabled: !editing },
            { label: "Reject all changes", onClick: E(() => c.chain().focus().rejectAllChanges().run()), disabled: !editing },
            { divider: true },
            { label: "Compare with a revised version (.docx)…", onClick: () => compareInput.current?.click(), disabled: !editing },
            { label: "Changes pane", checked: panel === "changes", onClick: () => setPanel((p) => (p === "changes" ? null : "changes")) },
            { divider: true },
            { label: "Spelling and grammar", checked: panel === "proofing", onClick: () => setPanel((p) => (p === "proofing" ? null : "proofing")), shortcut: "F7" },
            { label: "Check spelling as you type", checked: proofOn, onClick: () => setProofOn(!proofOn) },
            { label: "Thesaurus", checked: panel === "thesaurus", onClick: () => setPanel((p) => (p === "thesaurus" ? null : "thesaurus")), shortcut: "Shift+F7" },
            { label: "Read aloud", checked: readAloud, onClick: () => setReadAloud((v) => !v), shortcut: "Ctrl+Alt+Space" },
            { label: "Restrict editing", checked: panel === "restrict", onClick: () => setPanel((p) => (p === "restrict" ? null : "restrict")) },
            { label: "Check accessibility", checked: panel === "accessibility", onClick: () => setPanel((p) => (p === "accessibility" ? null : "accessibility")) },
            { divider: true },
            { label: "New comment", onClick: startComment, disabled: !canComment },
          ],
        },
        {
          label: "Mailings",
          items: [
            { label: "Mail merge from a Sheet…", checked: panel === "merge", onClick: () => setPanel((p) => (p === "merge" ? null : "merge")) },
            { label: "Preview results", checked: mergePreview !== null, onClick: () => (mergeTable?.records.length ? setMergePreview((p) => (p === null ? 0 : null)) : setPanel("merge")) },
          ],
        },
        {
          label: "Tools",
          items: [
            { label: "Word count", onClick: wordCount },
            { label: "Find and replace", onClick: () => setFindOpen(true) },
            { divider: true },
            { label: "Rewrite with AI…", onClick: () => openAi("rewrite"), disabled: !editing },
            { label: "Summarise with AI…", onClick: () => openAi("summarize"), disabled: !editing },
            { label: "Draft with AI…", onClick: () => openAi("draft"), disabled: !editing },
            { label: "Fix grammar with AI…", onClick: () => openAi("grammar"), disabled: !editing },
          ],
        },
        {
          label: "Help",
          items: [
            { label: "Keyboard shortcuts", onClick: () => alert("Bold Ctrl+B · Italic Ctrl+I · Underline Ctrl+U\nHeadings Ctrl+Alt+1…6 · Page break Ctrl+Enter\nUndo Ctrl+Z · Redo Ctrl+Y\nFind & replace Ctrl+H · Print Ctrl+P") },
            { label: "About SynergyDocs", onClick: () => alert("SynergyDocs — collaborative documents on the Synergy platform.") },
          ],
        },
      ]
    : [];

  const cursorSection = editor ? sectionAtCursor() : { index: 0, sections: [body] };
  const rulerSection = cursorSection.sections[cursorSection.index] || body;

  return (
    <div className={`min-h-screen flex flex-col bg-slate-50 ${viewMode === "read" ? `read-mode read-${readLook.color} read-${readLook.width}` : viewMode === "focus" ? "focus-mode" : ""}`} data-view-mode={viewMode}>
      {viewMode !== "normal" && (
        <div className={`no-print sticky top-0 z-20 flex items-center gap-2 px-3 h-10 text-sm ${viewMode === "focus" ? "justify-end bg-transparent pointer-events-none" : "bg-white border-b border-slate-200"}`} data-testid="mode-bar">
          {viewMode === "read" && (
            <>
              <span className="font-medium text-slate-700 truncate">{initialTitle || "Untitled document"}</span>
              <span className="ml-auto text-xs text-slate-500">Column width</span>
              <select aria-label="Column width" className="h-7 border border-slate-200 rounded px-1 text-xs" value={readLook.width} onChange={(e) => setReadLook((l) => ({ ...l, width: e.target.value as typeof l.width }))}>
                <option value="narrow">Narrow</option>
                <option value="default">Default</option>
                <option value="wide">Wide</option>
              </select>
              <span className="text-xs text-slate-500">Page color</span>
              <select aria-label="Page color" className="h-7 border border-slate-200 rounded px-1 text-xs" value={readLook.color} onChange={(e) => setReadLook((l) => ({ ...l, color: e.target.value as typeof l.color }))}>
                <option value="none">None</option>
                <option value="sepia">Sepia</option>
                <option value="inverse">Inverse</option>
              </select>
              <button className="h-7 px-2 rounded text-xs text-slate-600 hover:bg-slate-100" onClick={() => setShowOutline((v) => !v)}>Navigation</button>
            </>
          )}
          <button className="pointer-events-auto h-7 px-3 rounded-md text-xs bg-slate-800/80 text-white hover:bg-slate-800" data-testid="exit-mode" onClick={() => setViewMode("normal")}>
            {viewMode === "read" ? "Edit document" : "Exit focus"} (Esc)
          </button>
        </div>
      )}
      <style>{styleCss}</style>
      <header className={`sticky top-0 z-20 bg-white border-b border-slate-200 no-print ${viewMode !== "normal" ? "hidden" : ""}`}>
        <AppTitleBar
          docId={docId}
          initialTitle={initialTitle}
          initialStarred={initialStarred}
          role={role}
          meEmail={user.email}
          menus={menus}
          status={status}
          peers={peers}
          onTitle={setTitle}
          shareOpen={shareOpen}
          onShareOpen={setShareOpen}
          badge={docLabel.current && <LabelChip label={docLabel.current} list={docLabel.list} onClick={() => setLabelOpen(true)} />}
          rightExtra={
            <button
              onClick={() => setPanel((p) => (p === "comments" ? null : "comments"))}
              title="Comments"
              className={`h-8 w-8 rounded-full grid place-items-center ${panel === "comments" ? "bg-indigo-100 text-indigo-700" : "text-slate-500 hover:bg-slate-100"}`}
            >
              💬
            </button>
          }
        />

        {/* row 2: a single toolbar strip — zoom, tools (scroll on overflow), mode */}
        <div className="flex items-center gap-1.5 px-3 pb-1.5">
          <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))} title="Zoom" className="h-8 rounded-md text-sm text-slate-700 bg-white border border-slate-200 px-1.5 shrink-0">
            {[50, 75, 90, 100, 125, 150, 200].map((z) => (
              <option key={z} value={z}>{z}%</option>
            ))}
          </select>
          <span className="w-px h-5 bg-slate-200 shrink-0" />
          <div className="flex-1 min-w-0 overflow-x-auto">
            {c && editing && (
              <Toolbar
                editor={c}
                onComment={startComment}
                styles={styles}
                currentStyle={currentStyle()}
                onApplyStyle={applyStyle}
                onStylesPane={() => setPanel((p) => (p === "styles" ? null : "styles"))}
                onUpdateStyle={updateStyleFromSelection}
                onModifyStyle={(s) => setStyleEdit({ style: s })}
              />
            )}
          </div>
          <span className="w-px h-5 bg-slate-200 shrink-0" />
          {tracking && editing && (
            <button onClick={() => setPanel("changes")} className="h-8 px-2 rounded-md text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200 shrink-0" title="Edits are being tracked" data-testid="tracking-badge">
              {mode === "suggesting" ? "Suggesting" : "Tracking changes"}
            </button>
          )}
          <select value={mode} onChange={(e) => setMode(e.target.value as "editing" | "suggesting" | "viewing")} className="h-8 rounded-md text-sm text-slate-700 bg-white border border-slate-200 px-1.5 shrink-0" title="Mode" data-testid="mode-select">
            {canEdit && <option value="editing">✏️ Editing</option>}
            {canEdit && <option value="suggesting">💡 Suggesting</option>}
            <option value="viewing">👁 Viewing</option>
          </select>
        </div>

        {showRuler && (
          <Ruler
            editor={c}
            section={rulerSection}
            zoom={zoom}
            styles={styles}
            mirrorMargins={settings.mirrorMargins}
            editable={editing && !settings.protection?.enforced}
            onMargins={(m) => writeSection(cursorSection.index, { ...rulerSection, margins: m })}
          />
        )}
        {c && !editing && canComment && (
          <div className="px-3 pb-1.5 flex items-center gap-2">
            <button onClick={startComment} className="h-8 px-3 rounded-md text-sm text-slate-600 hover:bg-slate-100">💬 Add comment</button>
            <span className="text-xs text-slate-400">Viewing — you can comment.</span>
          </div>
        )}
        {c && !canComment && <div className="px-3 pb-1.5 text-xs text-slate-400">View only.</div>}
        {findOpen && c && <FindBar editor={c} onClose={() => setFindOpen(false)} />}
        {readAloud && c && <ReadAloudBar editor={c} onClose={() => setReadAloud(false)} />}
      </header>

      <div className="flex-1 flex min-h-0">
        {/* outline / document tabs panel */}
        {showOutline && viewMode !== "focus" && (
          <NavigationPane editor={c} outline={outline} onHeading={goToHeading} onClose={() => setShowOutline(false)} focusSearch={navFocus} />
        )}

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <main className="flex-1 overflow-auto py-8 px-4 bg-slate-100">
          <div className={`relative word-doc ${shownLayout === "print" ? "print-layout" : "web-layout"} markup-${markup}${settings.autoHyphenation ? " word-hyphenate" : ""}`} lang="en" style={{ zoom: zoom / 100 }} data-testid="word-doc">
            {shownLayout === "print" && editor ? (
              <PrintLayer editor={editor} body={body} settings={settings} extensions={hfExtensions} onEditHF={(index, kind, type) => editing && setHfOpen({ index, kind, type })} onOpenNote={(pos) => setNoteEdit(pos)}>
                <EditorContent editor={editor} />
              </PrintLayer>
            ) : (
              <div className="paper">
                <EditorContent editor={editor} />
              </div>
            )}
            {editing && c && c.isEmpty && (
              <div className="absolute left-1/2 -translate-x-1/2 top-[150px] z-10 flex flex-wrap gap-2 justify-center no-print">
                <span className="text-xs text-slate-400 w-full text-center mb-1">Start with a template</span>
                <button onClick={() => insertTemplate("meeting")} className="text-sm bg-white border border-slate-200 rounded-lg px-3 py-1.5 hover:border-indigo-300 shadow-sm">📋 Meeting notes</button>
                <button onClick={() => insertTemplate("email")} className="text-sm bg-white border border-slate-200 rounded-lg px-3 py-1.5 hover:border-indigo-300 shadow-sm">✉️ Email draft</button>
                <button onClick={() => insertTemplate("brief")} className="text-sm bg-white border border-slate-200 rounded-lg px-3 py-1.5 hover:border-indigo-300 shadow-sm">🗂 Project brief</button>
              </div>
            )}
          </div>
        </main>
        {split !== null && editor && (
          <SplitPane editor={editor} editable={editing} height={split} onResize={setSplit} onClose={() => setSplit(null)} className={`markup-${markup}`} />
        )}
        </div>

        {panel === "comments" && editor && (
          <CommentsSidebar
            editor={editor}
            docId={docId}
            me={user}
            canEdit={canEdit}
            draft={commentDraft}
            onDraftDone={() => setCommentDraft(null)}
            focusThread={focusThread}
            onClose={() => {
              setPanel(null);
              setCommentDraft(null);
            }}
          />
        )}
        {panel === "history" && editor && <VersionPanel editor={editor} docId={docId} onClose={() => setPanel(null)} snapshot={versionState} onRestore={restoreVersion} />}
        {panel === "inspector" && editor && <StyleInspector editor={editor} styles={styles} editable={editing} onClose={() => setPanel(null)} />}
        {panel === "restrict" && editor && (
          <RestrictPane
            editor={editor}
            protection={settings.protection}
            canManage={canEdit}
            onChange={(p) => setSettings({ ...setupRef.current.settings, protection: p })}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === "thesaurus" && editor && <ThesaurusPane editor={editor} editable={editing} onClose={() => setPanel(null)} />}
        {panel === "accessibility" && editor && <AccessibilityPane editor={editor} title={title} pageColor={settings.pageColor} editable={editing} onClose={() => setPanel(null)} />}
        {panel === "proofing" && editor && <ProofingPanel editor={editor} enabled={proofOn} editable={editing} onClose={() => setPanel(null)} />}
        {panel === "merge" && editor && (
          <MailMergePanel
            editor={editor}
            source={settings.mergeSource}
            table={mergeTable}
            editable={editing}
            preview={mergePreview}
            onSource={setMergeSource}
            onTable={(t) => setMergeTable((cur) => (t && !t.live && cur?.live && cur.source === t.source ? cur : t))}
            onPreview={setMergePreview}
            onMergeNew={mergeNew}
            onMergeDownload={mergeDownload}
            onClose={() => {
              setMergePreview(null);
              setPanel(null);
            }}
          />
        )}
        {panel === "changes" && editor && (
          <ChangesPanel editor={editor} canEdit={editing} tracking={!!settings.trackRevisions} onToggleTracking={() => setSettings({ ...settings, trackRevisions: !settings.trackRevisions })} onClose={() => setPanel(null)} />
        )}
        {panel === "styles" && editor && (
          <StylesPane
            styles={styles}
            current={currentStyle()}
            currentChar={currentChar()}
            inUse={stylesInUse()}
            canEdit={editing}
            onApply={applyStyle}
            onModify={(s) => setStyleEdit({ style: s })}
            onNew={newStyleFromSelection}
            onUpdate={updateStyleFromSelection}
            onClose={() => setPanel(null)}
          />
        )}
      </div>

      {pageSetupOpen && editor && (
        <PageSetupDialog section={cursorSection.sections[cursorSection.index]} isLast={cursorSection.index === cursorSection.sections.length - 1} onApply={applyPageSetup} onClose={() => setPageSetupOpen(false)} />
      )}
      {hfOpen && editor && (
        <HeaderFooterDialog
          sections={cursorSection.sections}
          index={Math.min(hfOpen.index, cursorSection.sections.length - 1)}
          settings={settings}
          initialKind={hfOpen.kind}
          initialType={hfOpen.type}
          extensions={hfExtensions}
          uploadImage={(f: File) => uploadImage(f, f.name)}
          onClose={() => setHfOpen(null)}
          onSave={(s, st) => {
            writeSection(Math.min(hfOpen.index, cursorSection.sections.length - 1), s);
            if (!!st.evenAndOddHeaders !== !!settings.evenAndOddHeaders) setSettings(st);
            setHfOpen(null);
          }}
        />
      )}
      {styleEdit && (
        <StyleDialog styles={styles} style={styleEdit.style} initial={styleEdit.initial} onClose={() => setStyleEdit(null)} onSave={(s) => saveStyle(s, !styleEdit.style)} />
      )}
      {noteEdit !== null && editor && editor.state.doc.nodeAt(noteEdit)?.type.name === "noteRef" && (() => {
        const n = editor.state.doc.nodeAt(noteEdit)!;
        const info = notesOf(editor.state.doc).find((x) => x.pos === noteEdit);
        return (
          <NoteDialog
            key={noteEdit}
            kind={n.attrs.kind === "endnote" ? "endnote" : "footnote"}
            label={info?.label || ""}
            content={parseNote(n.attrs.content)}
            extensions={hfExtensions}
            onClose={() => setNoteEdit(null)}
            onDelete={() => {
              editor.chain().focus().deleteRange({ from: noteEdit, to: noteEdit + 1 }).run();
              setNoteEdit(null);
            }}
            onSave={(d) => {
              if (editing) editor.chain().setNoteContent(noteEdit, d).run();
              setNoteEdit(null);
            }}
          />
        );
      })()}
      {proofMenu && editor && <ProofContextMenu editor={editor} menu={proofMenu} onClose={() => setProofMenu(null)} />}
      {layoutEdit && editor && (() => {
        if ("insert" in layoutEdit)
          return (
            <LayoutDialog
              kind="shape"
              insert
              attrs={layoutEdit.insert}
              onClose={() => setLayoutEdit(null)}
              onApply={(a) => {
                insertShapeNode(a);
                setLayoutEdit(null);
              }}
            />
          );
        const at = layoutEdit.pos;
        const node = editor.state.doc.nodeAt(at);
        if (!node || (node.type.name !== "image" && node.type.name !== "shape")) return null;
        return (
          <LayoutDialog
            key={at}
            kind={node.type.name === "image" ? "image" : "shape"}
            attrs={node.attrs}
            onClose={() => setLayoutEdit(null)}
            onDelete={() => {
              editor.chain().focus().deleteRange({ from: at, to: at + node.nodeSize }).run();
              setLayoutEdit(null);
            }}
            onApply={(a) => {
              editor.chain().focus().command(({ tr }) => (tr.setNodeMarkup(at, undefined, { ...node.attrs, ...a }), true)).run();
              setLayoutEdit(null);
            }}
          />
        );
      })()}
      {aiJob && editor && <AiDialog task={aiJob.task} text={aiJob.text} context={aiJob.context} source={aiJob.source} canReplace={aiJob.canReplace} onInsert={insertAi} onClose={() => setAiJob(null)} />}
      {eqEdit && editor && (() => {
        const at = eqEdit.pos;
        const node = at !== null ? editor.state.doc.nodeAt(at) : null;
        const isEq = node?.type.name === "equation";
        const value = isEq ? { latex: String(node!.attrs.latex), display: !!node!.attrs.display } : { latex: "", display: editor.state.selection.$from.parent.content.size === 0 };
        return (
          <EquationDialog
            value={value}
            onClose={() => setEqEdit(null)}
            onApply={(v) => {
              if (isEq && at !== null) editor.chain().focus().command(({ tr }) => (tr.setNodeMarkup(at, undefined, v), true)).run();
              else editor.chain().focus().insertEquation(v.latex, v.display).run();
              setEqEdit(null);
            }}
          />
        );
      })()}
      {citeDialog && editor && (() => {
        const at = citeDialog.pos;
        const node = at !== undefined ? editor.state.doc.nodeAt(at) : null;
        const initial = node?.type.name === "citation" ? { tags: String(node.attrs.tags || "").split(",").filter(Boolean), pages: node.attrs.pages || "" } : undefined;
        return (
          <CitationDialog
            sources={settings.sources || []}
            style={settings.citationStyle || "APA"}
            initial={initial}
            onSaveSources={setSources}
            onClose={() => setCiteDialog(null)}
            onInsert={(tags, pages) => {
              if (initial && at !== undefined) editor.chain().focus().command(({ tr }) => (tr.setNodeMarkup(at, undefined, { tags: tags.join(","), pages: pages || null }), true)).run();
              else editor.chain().focus().insertCitation(tags, pages).run();
              setCiteDialog(null);
            }}
          />
        );
      })()}
      {sourcesOpen && editor && (
        <SourcesDialog
          sources={settings.sources || []}
          cited={citedTags(editor.state.doc)}
          onClose={() => setSourcesOpen(false)}
          onSave={(list) => {
            setSources(list);
            setSourcesOpen(false);
          }}
        />
      )}
      {refDialog === "caption" && editor && (
        <CaptionDialog
          defaultLabel={editor.isActive("table") ? "Table" : "Figure"}
          next={(label) => indexOf(editor.state.doc).captions.filter((c) => c.label === label && c.pos < captionBlock().end).length + 1}
          onInsert={insertCaption}
          onClose={() => setRefDialog(null)}
        />
      )}
      {refDialog === "xref" && editor && (
        <CrossRefDialog
          index={indexOf(editor.state.doc)}
          headings={(() => {
            const hs: { level: number; text: string; pos: number }[] = [];
            editor.state.doc.descendants((n, pos) => {
              if (n.type.name === "heading") hs.push({ level: n.attrs.level, text: n.textContent, pos });
              return !n.isTextblock;
            });
            return hs;
          })()}
          onInsert={insertCrossRef}
          onClose={() => setRefDialog(null)}
        />
      )}
      {refDialog === "bookmark" && editor && (
        <BookmarkDialog
          names={bookmarkNames(editor.state)}
          onAdd={(name) => {
            editor.chain().focus().addBookmark(name).run();
            setRefDialog(null);
          }}
          onGo={(name) => {
            goToBookmark(editor, name);
            setRefDialog(null);
          }}
          onDelete={(name) => {
            editor.chain().focus().deleteBookmark(name).run();
            setRefDialog(null);
          }}
          onClose={() => setRefDialog(null)}
        />
      )}
      {indexDialog?.kind === "mark" && editor && (
        <MarkEntryDialog
          selected={indexDialog.selected}
          onClose={() => setIndexDialog(null)}
          onMark={(a, all) => {
            editor.chain().focus().markIndexEntry(a, all ? { all } : undefined).run();
            setShowMarks(true);
            setIndexDialog(null);
          }}
        />
      )}
      {indexDialog?.kind === "index" && editor && (
        <IndexDialog
          initial={indexDialog.pos !== null ? (editor.state.doc.nodeAt(indexDialog.pos)?.attrs as never) : undefined}
          onClose={() => setIndexDialog(null)}
          onOk={(o) => {
            if (indexDialog.pos !== null) editor.chain().focus().setIndexOptions(indexDialog.pos, o).run();
            else editor.chain().focus().insertIndex(o).run();
            setIndexDialog(null);
          }}
        />
      )}
      {graphicEdit && editor && (() => {
        const n = graphicEdit.pos !== null ? editor.state.doc.nodeAt(graphicEdit.pos) : null;
        const close = () => setGraphicEdit(null);
        if (graphicEdit.kind === "chart")
          return (
            <ChartDialog
              initial={n ? parseGraphic<ChartData>(n.attrs.chart) : null}
              onClose={close}
              onOk={(c) => {
                if (graphicEdit.pos !== null) editor.chain().focus().updateGraphic(graphicEdit.pos, { chart: JSON.stringify(c) }).run();
                else editor.chain().focus().insertWordChart(c).run();
                close();
              }}
            />
          );
        return (
          <SmartArtDialog
            initial={n ? parseGraphic<DiagramData>(n.attrs.diagram) : null}
            onClose={close}
            onOk={(d) => {
              if (graphicEdit.pos !== null) editor.chain().focus().updateGraphic(graphicEdit.pos, { diagram: JSON.stringify(d) }).run();
              else editor.chain().focus().insertSmartArt(d).run();
              close();
            }}
          />
        );
      })()}
      {fieldDialog && editor && (() => {
        const edit = typeof fieldDialog === "object" ? fieldDialog : null;
        const at = edit ? edit.pos : editor.state.selection.from;
        return (
          <FieldDialog
            initial={edit ? edit.instr : fieldDialog === "formula" ? "=SUM(ABOVE)" : fieldDialog === "date" ? 'DATE \\@ "M/d/yyyy"' : undefined}
            formulaOnly={fieldDialog === "formula" || (!!edit && edit.instr.trim().startsWith("="))}
            preview={(instr) => docFieldText(editor.state, fieldEnv, instr, at)}
            onApply={(instr) => {
              if (edit) editor.chain().focus().setDocFieldInstr(edit.pos, instr).run();
              else editor.chain().focus().insertDocField(instr).run();
              setFieldDialog(null);
            }}
            onClose={() => setFieldDialog(null)}
          />
        );
      })()}
      {designDialog === "watermark" && (
        <WatermarkDialog
          value={settings.watermark}
          onApply={(w) => {
            setSettings({ ...settings, watermark: w || undefined });
            setDesignDialog(null);
          }}
          onClose={() => setDesignDialog(null)}
        />
      )}
      {designDialog === "pageBorders" && (() => {
        const { index, sections } = sectionAtCursor();
        return (
          <PageBordersDialog
            value={sections[index]?.pageBorders}
            onApply={(b) => {
              writeSection(index, { ...sections[index], pageBorders: b || undefined });
              setDesignDialog(null);
            }}
            onClose={() => setDesignDialog(null)}
          />
        );
      })()}
      {ccPick !== null && editor && <ControlPicker editor={editor} pos={ccPick} onClose={() => setCcPick(null)} />}
      {labelOpen && <SensitivityDialog app="Word" current={docLabel.current} canEdit={canEdit} onSave={chooseLabel} onClose={() => setLabelOpen(false)} />}
      {propsOpen && editor && (
        <PropertiesDialog
          properties={settings.properties || {}}
          custom={settings.customProperties || {}}
          onApply={(properties, customProperties) => {
            setSettings({ ...settings, properties, customProperties });
            setPropsOpen(false);
            // DOCPROPERTY fields show the new values
            setTimeout(() => editor.commands.updateDocFields(), 100);
          }}
          onClose={() => setPropsOpen(false)}
        />
      )}
      {symbolOpen && editor && <SymbolDialog onInsert={(ch) => editor.chain().focus().insertContent(ch).run()} onClose={() => setSymbolOpen(false)} />}
      {fmtDialog === "sort" && editor && (() => {
        const t = tableAround(editor.state);
        if (!t) return null;
        const first = t.node.firstChild;
        const columns: string[] = [];
        first?.forEach((cell) => columns.push(tableCellText(cell.toJSON())));
        return (
          <SortDialog
            columns={columns}
            header={!!first && first.childCount > 0 && first.firstChild?.type.name === "tableHeader"}
            onApply={(keys, hasHeader) => {
              editor.chain().focus().sortTableRows(keys, hasHeader).run();
              setFmtDialog(null);
            }}
            onClose={() => setFmtDialog(null)}
          />
        );
      })()}
      {fmtDialog === "font" && editor && (() => {
        const ts = editor.getAttributes("textStyle");
        const value: FontValue = {
          fontFamily: ts.fontFamily ? String(ts.fontFamily).split(",")[0].replace(/"/g, "").trim() : null,
          fontSize: (ts.fontSize as string) || null,
          color: (ts.color as string) || null,
          bold: editor.isActive("bold"),
          italic: editor.isActive("italic"),
          underline: editor.isActive("underline"),
          strike: editor.isActive("strike"),
          superscript: editor.isActive("superscript"),
          subscript: editor.isActive("subscript"),
          caps: !!ts.caps,
          smallCaps: !!ts.smallCaps,
          charSpacing: Number(ts.charSpacing) || 0,
        };
        return (
          <FontDialog
            value={value}
            onClose={() => setFmtDialog(null)}
            onApply={(v) => {
              const ch = editor.chain().focus();
              (v.fontFamily ? ch.setFontFamily(v.fontFamily) : ch.unsetFontFamily());
              (v.fontSize ? ch.setFontSize(v.fontSize) : ch.unsetFontSize());
              (v.color ? ch.setColor(v.color) : ch.unsetColor());
              (v.bold ? ch.setBold() : ch.unsetBold());
              (v.italic ? ch.setItalic() : ch.unsetItalic());
              (v.underline ? ch.setUnderline() : ch.unsetUnderline());
              (v.strike ? ch.setStrike() : ch.unsetStrike());
              (v.superscript ? ch.setMark("superscript") : ch.unsetMark("superscript"));
              (v.subscript ? ch.setMark("subscript") : ch.unsetMark("subscript"));
              ch.setRunFormat({ caps: v.caps || null, smallCaps: v.smallCaps || null, charSpacing: v.charSpacing || null }).run();
              setFmtDialog(null);
            }}
          />
        );
      })()}
      {fmtDialog === "tabs" && editor && (
        <TabsDialog
          value={editor.state.selection.$from.parent.attrs.tabs}
          onClose={() => setFmtDialog(null)}
          onApply={(tabs) => {
            editor.chain().focus().setParaFormat({ tabs }).run();
            setFmtDialog(null);
          }}
        />
      )}
      {fmtDialog === "borders" && editor && (
        <BordersDialog
          borders={editor.state.selection.$from.parent.attrs.borders}
          shading={editor.state.selection.$from.parent.attrs.shading}
          onClose={() => setFmtDialog(null)}
          onApply={(borders, shading) => {
            editor.chain().focus().setParaFormat({ borders, shading }).run();
            setFmtDialog(null);
          }}
        />
      )}
      {fmtDialog === "dropcap" && editor && (
        <DropCapDialog
          value={editor.state.selection.$from.parent.attrs.dropCap}
          onClose={() => setFmtDialog(null)}
          onApply={(dropCap) => {
            editor.chain().focus().setParaFormat({ dropCap }).run();
            setFmtDialog(null);
          }}
        />
      )}
      {paraOpen && editor && (
        <ParagraphDialog
          node={editor.state.selection.$from.parent}
          onClose={() => setParaOpen(false)}
          onApply={(attrs) => {
            editor.chain().focus().setParaFormat(attrs).run();
            setParaOpen(false);
          }}
        />
      )}
      {busy && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white text-sm rounded-lg px-4 py-2 shadow-lg no-print">{busy}</div>}
      {pdfBusy && <div className="fixed bottom-4 right-4 z-50 bg-slate-800 text-white text-sm rounded-lg px-4 py-2 shadow-lg no-print">Preparing PDF…</div>}

      <input ref={docxInput} type="file" accept={OPEN_ACCEPT} className="hidden" data-testid="docx-input" onChange={importDocx} />
      <input ref={insertFileInput} type="file" accept={OPEN_ACCEPT} className="hidden" data-testid="insert-file-input" onChange={insertFile} />
      <input ref={compareInput} type="file" accept=".docx" className="hidden" data-testid="compare-input" onChange={compareWith} />
      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
        multiple
        className="hidden"
        data-testid="image-input"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          void insertImageFiles(files);
        }}
      />
    </div>
  );
}

// A ruler for the cursor's section: page width, with the margins shaded.
// ---- The rich toolbar: grouped, scrolls on overflow ----
function Toolbar({
  editor,
  onComment,
  styles,
  currentStyle,
  onApplyStyle,
  onStylesPane,
  onUpdateStyle,
  onModifyStyle,
}: {
  editor: Editor;
  onComment: () => void;
  styles: DocStyle[];
  currentStyle: string;
  onApplyStyle: (s: DocStyle) => void;
  onStylesPane: () => void;
  onUpdateStyle: (s: DocStyle) => void;
  onModifyStyle: (s: DocStyle) => void;
}) {
  const btn = (active: boolean) =>
    `h-8 min-w-8 px-2 rounded-md text-sm flex items-center justify-center transition ${
      active ? "bg-indigo-100 text-indigo-700" : "text-slate-600 hover:bg-slate-100"
    }`;
  const Sep = () => <span className="w-px h-5 bg-slate-200 mx-0.5" />;

  const curFont = (editor.getAttributes("textStyle").fontFamily as string) || "";
  const rawSize = (editor.getAttributes("textStyle").fontSize as string) || "";
  const curSize = rawSize.endsWith("px") ? String(Math.round(parseFloat(rawSize) * 0.75 * 2) / 2) : rawSize.replace("pt", "");
  const curColor = (editor.getAttributes("textStyle").color as string) || "#1f2430";
  const curHighlight = (editor.getAttributes("highlight").color as string) || "#fde047";
  const curLine = (editor.state.selection.$from.parent.attrs.lineHeight as string) || "";
  const inTable = editor.isActive("table");

  const selectCls =
    "h-8 rounded-md text-sm text-slate-700 bg-white border border-slate-200 px-1.5 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-300";

  return (
    <div className="flex flex-nowrap items-center gap-0.5 py-0.5">
      {/* undo / redo (Yjs-backed) */}
      <button className={btn(false)} title="Undo" onClick={() => editor.chain().focus().undo().run()}>↺</button>
      <button className={btn(false)} title="Redo" onClick={() => editor.chain().focus().redo().run()}>↻</button>
      <Sep />

      {/* styles */}
      <StyleGallery styles={styles} current={currentStyle} onApply={onApplyStyle} onMore={onStylesPane} onUpdate={onUpdateStyle} onModify={onModifyStyle} />
      <Sep />

      {/* font family */}
      <select
        className={`${selectCls} max-w-[9rem]`}
        title="Font"
        value={FONTS.some((f) => f.value === curFont) ? curFont : curFont ? "__other" : ""}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__other") return;
          if (v) editor.chain().focus().setFontFamily(v).run();
          else editor.chain().focus().unsetFontFamily().run();
        }}
      >
        {FONTS.map((f) => (
          <option key={f.label} value={f.value}>{f.label}</option>
        ))}
        {curFont && !FONTS.some((f) => f.value === curFont) && <option value="__other">{curFont.split(",")[0].replace(/"/g, "")}</option>}
      </select>

      {/* font size (pt) */}
      <select className={selectCls} title="Font size" value={curSize} onChange={(e) => (e.target.value ? editor.chain().focus().setFontSize(`${e.target.value}pt`).run() : editor.chain().focus().unsetFontSize().run())}>
        <option value="">–</option>
        {[...new Set([...SIZES, ...(curSize ? [curSize] : [])])].sort((a, b) => Number(a) - Number(b)).map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <Sep />

      {/* marks */}
      <button className={btn(editor.isActive("bold"))} title="Bold" onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></button>
      <button className={btn(editor.isActive("italic"))} title="Italic" onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></button>
      <button className={btn(editor.isActive("underline"))} title="Underline" onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></button>
      <button className={btn(editor.isActive("strike"))} title="Strikethrough" onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></button>
      <button className={btn(editor.isActive("superscript"))} title="Superscript" onClick={() => editor.chain().focus().toggleSuperscript().run()}>x²</button>
      <button className={btn(editor.isActive("subscript"))} title="Subscript" onClick={() => editor.chain().focus().toggleSubscript().run()}>x₂</button>

      {/* text color */}
      <label className="h-8 w-8 rounded-md hover:bg-slate-100 flex flex-col items-center justify-center cursor-pointer" title="Text color">
        <span className="text-[13px] leading-none font-semibold" style={{ color: curColor }}>A</span>
        <span className="w-4 h-[3px] rounded-sm" style={{ background: curColor }} />
        <input type="color" value={curColor} className="sr-only" onChange={(e) => editor.chain().focus().setColor(e.target.value).run()} />
      </label>
      {/* highlight */}
      <label className="h-8 w-8 rounded-md hover:bg-slate-100 flex flex-col items-center justify-center cursor-pointer" title="Highlight">
        <span className="text-[13px] leading-none">🖍</span>
        <span className="w-4 h-[3px] rounded-sm" style={{ background: curHighlight }} />
        <input type="color" value={curHighlight} className="sr-only" onChange={(e) => editor.chain().focus().toggleHighlight({ color: e.target.value }).run()} />
      </label>
      <Sep />

      {/* alignment */}
      <button className={btn(editor.isActive({ textAlign: "left" }))} title="Align left" onClick={() => editor.chain().focus().setTextAlign("left").run()}>⯇</button>
      <button className={btn(editor.isActive({ textAlign: "center" }))} title="Center" onClick={() => editor.chain().focus().setTextAlign("center").run()}>≡</button>
      <button className={btn(editor.isActive({ textAlign: "right" }))} title="Align right" onClick={() => editor.chain().focus().setTextAlign("right").run()}>⯈</button>
      <button className={btn(editor.isActive({ textAlign: "justify" }))} title="Justify" onClick={() => editor.chain().focus().setTextAlign("justify").run()}>☰</button>
      <select className={selectCls} title="Line spacing" value={curLine} onChange={(e) => editor.chain().focus().setParaFormat({ lineHeight: e.target.value || null }).run()}>
        <option value="">↕ Line</option>
        {LINE_SPACINGS.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
      <Sep />

      {/* lists + indent */}
      <button className={btn(editor.isActive("bulletList"))} title="Bulleted list" onClick={() => editor.chain().focus().toggleBulletList().run()}>•</button>
      <button className={btn(editor.isActive("orderedList"))} title="Numbered list" onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</button>
      <button className={btn(editor.isActive("taskList"))} title="Checklist" onClick={() => editor.chain().focus().toggleTaskList().run()}>☑</button>
      <button className={btn(false)} title="Decrease indent" onClick={() => editor.chain().focus().outdent().run()}>⇤</button>
      <button className={btn(false)} title="Increase indent" onClick={() => editor.chain().focus().indent().run()}>⇥</button>
      <Sep />

      {/* insert */}
      <button
        className={btn(editor.isActive("link"))}
        title="Link"
        onClick={() => {
          const prev = editor.getAttributes("link").href as string | undefined;
          const url = window.prompt("Link URL", prev ?? "https://");
          if (url === null) return;
          if (url === "") editor.chain().focus().unsetLink().run();
          else editor.chain().focus().setLink({ href: url }).run();
        }}
      >🔗</button>
      <button
        className={btn(false)}
        title="Insert image"
        onClick={() => {
          const url = window.prompt("Image URL");
          if (url) editor.chain().focus().setImage({ src: url }).run();
        }}
      >🖼</button>
      <button
        className={btn(inTable)}
        title="Insert table"
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >▦</button>
      <button className={btn(false)} title="Page break (Ctrl+Enter)" onClick={() => editor.chain().focus().insertPageBreak().run()}>⤓</button>
      <Sep />
      <button
        className={btn(false)}
        title="Clear formatting"
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
      >⌫</button>
      <button
        className={btn(formatPainterOn(editor.state))}
        title="Format painter (double-click to keep it on)"
        data-testid="format-painter"
        onClick={() => (formatPainterOn(editor.state) ? editor.chain().focus().cancelFormatPainter().run() : editor.chain().focus().copyFormat().run())}
        onDoubleClick={() => editor.chain().focus().copyFormat(true).run()}
      >🖌</button>
      <Sep />
      <button className={btn(editor.isActive("comment"))} title="Add comment" onClick={onComment}>💬</button>

      {/* table tools (only while a table is selected) */}
      {inTable && (
        <>
          <Sep />
          <span className="text-[11px] text-slate-400 px-1">Table</span>
          <button className={btn(false)} title="Add column" onClick={() => editor.chain().focus().addColumnAfter().run()}>+col</button>
          <button className={btn(false)} title="Add row" onClick={() => editor.chain().focus().addRowAfter().run()}>+row</button>
          <button className={btn(false)} title="Delete column" onClick={() => editor.chain().focus().deleteColumn().run()}>−col</button>
          <button className={btn(false)} title="Delete row" onClick={() => editor.chain().focus().deleteRow().run()}>−row</button>
          <button className={btn(false)} title="Merge or split cells" onClick={() => editor.chain().focus().mergeOrSplit().run()}>⊞</button>
          <label className="h-8 w-8 rounded-md hover:bg-slate-100 flex items-center justify-center cursor-pointer" title="Cell shading">
            <span className="text-[13px]">▧</span>
            <input type="color" className="sr-only" onChange={(e) => editor.chain().focus().setCellAttribute("background", e.target.value).run()} />
          </label>
          <button className={btn(false)} title="Delete table" onClick={() => editor.chain().focus().deleteTable().run()}>✕</button>
        </>
      )}
    </div>
  );
}

function ago(ms: number): string {
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
}

function scrollToThread(id: string) {
  const el = document.querySelector(`[data-thread-id="${id}"]`) as HTMLElement | null;
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("comment-mark--flash");
  setTimeout(() => el.classList.remove("comment-mark--flash"), 1200);
}

// ---- Comments sidebar ----
type Msg = { id: string; author_email: string; author_name: string; body: string; created_ms: string };
type Thread = { id: string; quote: string; resolved: boolean; created_ms: string; messages: Msg[] };

function CommentsSidebar({
  editor,
  docId,
  me,
  canEdit,
  draft,
  onDraftDone,
  onClose,
  focusThread,
}: {
  editor: Editor;
  docId: string;
  me: { name: string; email: string };
  canEdit: boolean;
  draft: { from: number; to: number; quote: string } | null;
  onDraftDone: () => void;
  onClose: () => void;
  /** a thread to show (opened from a notification) */
  focusThread?: string | null;
}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [draftBody, setDraftBody] = useState("");
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [people, setPeople] = useState<{ email: string; name?: string }[]>([]);
  const [told, setTold] = useState<string[]>([]);

  // people to @mention: the owner, everyone the document is shared with, and earlier commenters
  useEffect(() => {
    const found = new Map<string, string | undefined>();
    threads.forEach((t) => t.messages.forEach((m) => m.author_email && found.set(m.author_email.toLowerCase(), m.author_name)));
    let live = true;
    fetch(`/api/docs/${docId}/share`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { owner_email?: string; grants?: { email: string }[] } | null) => {
        if (j?.owner_email && !found.has(j.owner_email.toLowerCase())) found.set(j.owner_email.toLowerCase(), undefined);
        j?.grants?.forEach((g) => !found.has(g.email.toLowerCase()) && found.set(g.email.toLowerCase(), undefined));
      })
      .catch(() => {})
      .finally(() => {
        if (live) setPeople([...found].filter(([e]) => e !== me.email.toLowerCase()).map(([email, name]) => ({ email, name })).sort((a, b) => a.email.localeCompare(b.email)));
      });
    return () => {
      live = false;
    };
  }, [threads, docId, me.email]);
  useEffect(() => {
    if (!focusThread || !threads.some((t) => t.id === focusThread)) return;
    document.querySelector(`[data-thread-card="${focusThread}"]`)?.scrollIntoView({ block: "center" });
    scrollToThread(focusThread);
  }, [focusThread, threads]);

  const load = async () => {
    const res = await fetch(`/api/docs/${docId}/comments`);
    if (res.ok) setThreads((await res.json()).threads ?? []);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const submitDraft = async () => {
    if (!draft || !draftBody.trim()) return;
    const res = await fetch(`/api/docs/${docId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote: draft.quote, body: draftBody.trim() }),
    });
    if (res.ok) {
      const { threadId, notified } = await res.json();
      setTold(notified || []);
      // The inline highlight is a change to the shared doc, so only editors paint
      // it; a commenter's thread still appears in the sidebar for everyone.
      if (canEdit) editor.chain().setTextSelection({ from: draft.from, to: draft.to }).setComment(threadId).run();
      setDraftBody("");
      onDraftDone();
      load();
    }
  };

  const reply = async (threadId: string) => {
    if (!replyBody.trim()) return;
    const res = await fetch(`/api/docs/${docId}/comments/${threadId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: replyBody.trim() }),
    });
    if (res.ok) {
      setTold((await res.json()).notified || []);
      setReplyBody("");
      setReplyFor(null);
      load();
    }
  };

  const resolve = async (t: Thread) => {
    await fetch(`/api/docs/${docId}/comments/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved: !t.resolved }),
    });
    if (!t.resolved) editor.commands.removeCommentThread(t.id);
    load();
  };

  const remove = async (threadId: string) => {
    if (!confirm("Delete this comment thread?")) return;
    await fetch(`/api/docs/${docId}/comments/${threadId}`, { method: "DELETE" });
    editor.commands.removeCommentThread(threadId);
    load();
  };

  return (
    <aside className="w-80 shrink-0 border-l border-slate-200 bg-white overflow-y-auto no-print">
      <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-2.5 flex items-center">
        <h2 className="text-sm font-semibold text-slate-800">Comments</h2>
        <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700 text-sm">✕</button>
      </div>

      {draft && (
        <div className="p-3 border-b border-slate-100 bg-indigo-50/40">
          <div className="text-[11px] text-slate-500 mb-1 line-clamp-2 border-l-2 border-indigo-300 pl-2 italic">“{draft.quote}”</div>
          <MentionBox autoFocus value={draftBody} onChange={setDraftBody} people={people} placeholder="Comment… (@ to mention someone)" testId="comment-input" onSubmit={submitDraft} />
          <div className="flex justify-end gap-2 mt-1.5">
            <button onClick={onDraftDone} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1">Cancel</button>
            <button onClick={submitDraft} disabled={!draftBody.trim()} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded px-3 py-1 disabled:opacity-50">Comment</button>
          </div>
        </div>
      )}

      {told.length > 0 && (
        <div className="px-4 py-1.5 text-[11px] text-emerald-700 bg-emerald-50 border-b border-emerald-100" data-testid="mention-told">
          Notified {told.join(", ")}
          <button className="ml-2 text-emerald-500" onClick={() => setTold([])}>✕</button>
        </div>
      )}
      {threads.length === 0 && !draft && (
        <p className="text-xs text-slate-400 p-4 text-center">No comments yet. Select text and click 💬 to add one.</p>
      )}

      <div className="divide-y divide-slate-100">
        {threads.map((t) => (
          <div key={t.id} data-thread-card={t.id} className={`p-3 ${t.resolved ? "opacity-60" : ""} ${focusThread === t.id ? "bg-amber-50/60" : ""}`}>
            <button onClick={() => scrollToThread(t.id)} className="text-[11px] text-left text-slate-500 mb-1.5 line-clamp-2 border-l-2 border-amber-300 pl-2 italic hover:text-slate-700">
              “{t.quote}”
            </button>
            <div className="space-y-2">
              {t.messages.map((m) => (
                <div key={m.id}>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xs font-semibold text-slate-800">{m.author_name}</span>
                    <span className="text-[10px] text-slate-400">{ago(Number(m.created_ms))}</span>
                  </div>
                  <p className="text-[13px] text-slate-700 whitespace-pre-wrap"><MentionText text={m.body} me={me.email} /></p>
                </div>
              ))}
            </div>
            {replyFor === t.id ? (
              <div className="mt-2">
                <MentionBox autoFocus value={replyBody} onChange={setReplyBody} people={people} placeholder="Reply… (@ to mention someone)" testId="reply-input" onSubmit={() => reply(t.id)} />
                <div className="flex justify-end gap-2 mt-1">
                  <button onClick={() => setReplyFor(null)} className="text-xs text-slate-500 px-2 py-0.5">Cancel</button>
                  <button onClick={() => reply(t.id)} className="text-xs bg-indigo-600 text-white rounded px-2.5 py-0.5">Reply</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 mt-2 text-[11px]">
                <button onClick={() => { setReplyFor(t.id); setReplyBody(""); }} className="text-indigo-600 hover:underline">Reply</button>
                <button onClick={() => resolve(t)} className="text-slate-500 hover:text-emerald-600">{t.resolved ? "Reopen" : "Resolve"}</button>
                <button onClick={() => remove(t.id)} className="text-slate-400 hover:text-red-500 ml-auto">Delete</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}

// ---- Version history panel ----
type Version = { id: string; author_name: string; label: string | null; created_ms: string };

function VersionPanel({ editor, docId, onClose, snapshot, onRestore }: { editor: Editor; docId: string; onClose: () => void; snapshot: (ed: Editor) => string; onRestore: (ed: Editor, v: { html: string; state?: string | null }) => void }) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [preview, setPreview] = useState<{ id: string; html: string; state?: string | null } | null>(null);

  const load = async () => {
    const res = await fetch(`/api/docs/${docId}/versions`);
    if (res.ok) setVersions((await res.json()).versions ?? []);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const saveNow = async () => {
    const label = window.prompt("Name this version (optional)") ?? "";
    await fetch(`/api/docs/${docId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html: editor.getHTML(), label, state: snapshot(editor) }),
    });
    load();
  };

  const open = async (id: string) => {
    const res = await fetch(`/api/docs/${docId}/versions/${id}`);
    if (res.ok) {
      const v = (await res.json()).version;
      setPreview({ id, html: v.html, state: v.state });
    }
  };

  const restore = () => {
    if (!preview) return;
    if (!confirm("Restore this version? Current content will be replaced (a new version is saved first).")) return;
    // snapshot current, then replace
    fetch(`/api/docs/${docId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html: editor.getHTML(), label: "before restore", state: snapshot(editor) }),
    }).finally(() => {
      onRestore(editor, preview);
      setPreview(null);
      load();
    });
  };

  return (
    <aside className="w-80 shrink-0 border-l border-slate-200 bg-white overflow-y-auto no-print">
      <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-2.5 flex items-center">
        <h2 className="text-sm font-semibold text-slate-800">Version history</h2>
        <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700 text-sm">✕</button>
      </div>

      {preview ? (
        <div className="p-3">
          <div className="flex gap-2 mb-2">
            <button onClick={() => setPreview(null)} className="text-xs text-slate-500 hover:text-slate-700">← Back</button>
            <button onClick={restore} className="ml-auto text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded px-3 py-1">Restore this version</button>
          </div>
          <div className="border border-slate-200 rounded-lg p-3 text-[13px] text-slate-700 max-h-[70vh] overflow-y-auto prose-preview" dangerouslySetInnerHTML={{ __html: preview.html }} />
        </div>
      ) : (
        <>
          <div className="p-3 border-b border-slate-100">
            <button onClick={saveNow} className="w-full text-xs bg-slate-100 hover:bg-slate-200 rounded-lg py-1.5 text-slate-700">Save a version now</button>
          </div>
          {versions.length === 0 ? (
            <p className="text-xs text-slate-400 p-4 text-center">No saved versions yet. They’re captured automatically as you edit.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {versions.map((v) => (
                <button key={v.id} onClick={() => open(v.id)} className="w-full text-left px-4 py-2.5 hover:bg-slate-50">
                  <div className="text-sm text-slate-800">{v.label || new Date(Number(v.created_ms)).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
                  <div className="text-[11px] text-slate-400">{v.author_name} · {ago(Number(v.created_ms))}</div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </aside>
  );
}

// ---- Find & replace ----
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function findMatches(editor: Editor, term: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  if (!term) return out;
  const re = new RegExp(escapeRegExp(term), "gi");
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(node.text))) out.push({ from: pos + m.index, to: pos + m.index + m[0].length });
  });
  return out;
}

function FindBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [term, setTerm] = useState("");
  const [replaceTerm, setReplaceTerm] = useState("");
  const [idx, setIdx] = useState(0);
  const matches = findMatches(editor, term);
  const count = matches.length;

  const go = (i: number) => {
    if (!count) return;
    const n = ((i % count) + count) % count;
    setIdx(n);
    const m = matches[n];
    editor.chain().setTextSelection({ from: m.from, to: m.to }).scrollIntoView().run();
  };

  const replaceOne = () => {
    if (!count) return;
    const m = matches[Math.min(idx, count - 1)];
    editor.chain().focus().insertContentAt({ from: m.from, to: m.to }, replaceTerm).run();
  };
  const replaceAll = () => {
    const ms = findMatches(editor, term);
    if (!ms.length) return;
    const chain = editor.chain().focus();
    // apply from last to first so earlier positions stay valid
    for (let i = ms.length - 1; i >= 0; i--) chain.insertContentAt({ from: ms[i].from, to: ms[i].to }, replaceTerm);
    chain.run();
  };

  return (
    <div className="max-w-[1180px] mx-auto px-4 pb-2 flex flex-wrap items-center gap-2 text-sm">
      <input
        autoFocus
        value={term}
        onChange={(e) => { setTerm(e.target.value); setIdx(0); }}
        onKeyDown={(e) => { if (e.key === "Enter") go(idx + 1); if (e.key === "Escape") onClose(); }}
        placeholder="Find"
        className="h-8 w-44 border border-slate-300 rounded-md px-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
      />
      <span className="text-xs text-slate-500 w-16">{count ? `${Math.min(idx + 1, count)} / ${count}` : term ? "0" : ""}</span>
      <button onClick={() => go(idx - 1)} className="h-8 px-2 rounded-md text-slate-600 hover:bg-slate-100" title="Previous">↑</button>
      <button onClick={() => go(idx + 1)} className="h-8 px-2 rounded-md text-slate-600 hover:bg-slate-100" title="Next">↓</button>
      <span className="w-px h-5 bg-slate-200" />
      <input
        value={replaceTerm}
        onChange={(e) => setReplaceTerm(e.target.value)}
        placeholder="Replace with"
        className="h-8 w-44 border border-slate-300 rounded-md px-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
      />
      <button onClick={replaceOne} className="h-8 px-2.5 rounded-md text-slate-600 hover:bg-slate-100">Replace</button>
      <button onClick={replaceAll} className="h-8 px-2.5 rounded-md text-slate-600 hover:bg-slate-100">All</button>
      <button onClick={onClose} className="ml-auto h-8 px-2 rounded-md text-slate-400 hover:bg-slate-100">✕</button>
    </div>
  );
}

