"use client";

// Univer spreadsheet engine (Apache-2.0, self-branded — no third-party logos),
// plus our own free .xlsx open/save (lib/xlsx.ts, ExcelJS + SheetJS for legacy formats). Univer is canvas + DOM, so
// it runs browser-only: dynamic-imported inside an effect, never server-rendered.
//
// Persistence: a spreadsheet's model is command-based, not a CRDT, so we save the
// whole Univer workbook as a JSON snapshot (debounced) to the documents row and
// reload it on open — the doc survives and reopens exactly where it was left.
import { useEffect, useMemo, useRef, useState } from "react";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-sort/lib/index.css";
import "@univerjs/preset-sheets-filter/lib/index.css";
import "@univerjs/preset-sheets-find-replace/lib/index.css";
import "@univerjs/preset-sheets-conditional-formatting/lib/index.css";
import "@univerjs/preset-sheets-data-validation/lib/index.css";
import "@univerjs/preset-sheets-hyper-link/lib/index.css";
import "@univerjs/preset-sheets-note/lib/index.css";
import "@univerjs/preset-sheets-drawing/lib/index.css";
import "@univerjs/preset-sheets-table/lib/index.css";
import "@univerjs/preset-sheets-thread-comment/lib/index.css";
import { xlsxToUniver, univerToXlsx, legacyToUniver, univerSheetToCsv, shiftFormula, isMacroEnabled } from "@/lib/xlsx";
import SheetScripts from "./SheetScripts";
import { applyOps, createRecorder, registerKeptParts, registerScripts, saveScripts, runScriptLive, type ScriptStore } from "@/lib/sheet-scripts";
import type { Script } from "@/lib/xlsx-kept";
import type { SheetThread } from "@/lib/xlsx-threads";
import { currentRegion, rowsToKeep } from "@/lib/sheet-tools";
import { RemoveDuplicatesDialog, SplitTextDialog, type DedupeRequest } from "./SheetDialogs";
import { createWorkbookFromSnapshot } from "@/lib/univer-workbook";
import { connectSheetComments, type SheetCommentsHandle } from "@/lib/sheet-comments";
import { pivotChartSeries, chartData, chartFromSelection, chartResource, SHEET_CHART_RESOURCE, type ChartType, type SheetChart, type SheetChartResource } from "@/lib/sheet-charts";
import { connectSheetCollab, type SheetCollabHandle, type Participant } from "@/lib/univer-collab";
import AppTitleBar, { type Role } from "./AppTitleBar";
import { type Menu } from "./MenuBar";
import SheetCharts, { ChartPreview } from "./SheetCharts";
import { EvaluateFormulaDialog, liveCalc, PasswordDialog, WatchWindow } from "./SheetFormulaTools";
import { hashPassword, hasPassword, verifyPassword } from "@/lib/excel-password";
import type { EvalValue } from "@/lib/formula-eval";
import SheetPivot from "./SheetPivot";
import { PageSetupDialog, PrintDialog } from "./SheetPrint";
import { readPageSetup, registerPageSetup, writePageSetup } from "@/lib/sheet-page-setup";
import { areaText, printRenderers, printSheet, type PageModel, type Range as PrintRange } from "@/lib/sheet-print";
import { renderToStaticMarkup } from "react-dom/server";
import { nextPivotName, pivotsOf, registerPivots, savePivots, writePivot, type PivotStore } from "@/lib/sheet-pivots";
import type { PivotDef } from "@/lib/pivot";
import SheetOutline, { adoptInsertedIntoGroups, groupSelection, toggleGroupAtSelection } from "./SheetOutline";
import SheetProtection from "./SheetProtection";
import { canEditProtection, protectionsIn, registerProtections, saveProtections, sheetPassword, type Protection, type ProtectionStore } from "@/lib/sheet-protection";
import { withProtections, protectionsOf } from "@/lib/protection-rules.mjs";
import { groupAt, registerSparklines, saveSparklines, sparklinesIn, withoutSparklinesIn, type SparklineStore } from "@/lib/sheet-sparklines";
import { SPARK_DEFAULTS, sparklinesFor, type SparkType, type SparklineGroup } from "@/lib/sparkline";
import { NO_TRACE, redraw, registerScenarios, registerShowFormulas, runGoalSeek, runScenarioSummary, saveScenarios, showScenario, traceMore, type ScenarioStore, type TraceState } from "@/lib/sheet-what-if";
import { parseCellList, type Scenario } from "@/lib/scenarios";
import { CUSTOM_VIEWS_RESOURCE, foldCustomViews, SET_CUSTOM_VIEWS_MUTATION, type CustomView } from "@/lib/custom-views";
import { applyCustomView, currentView, CustomViewsDialog } from "./SheetCustomViews";
import { registerDocProps, registerStructureGuard, saveDocProps, type DocPropsStore } from "@/lib/sheet-doc-props";
import type { SensitivityLabel } from "@/lib/sensitivity";
import { LabelChip, orgLabelOf, putDocLabel, SensitivityDialog, useLabelList } from "./SheetSensitivity";
import { AccessibilityPanel } from "./SheetAccessibility";
import { QuickAnalysisDialog, type QuickAction } from "./SheetQuickAnalysis";
import { hasHeader, totalCells } from "@/lib/quick-analysis";
import { checkAccessibility, type A11yIssue, type A11yTarget } from "@/lib/sheet-a11y";
import { checkDataTable, keepSolution, registerDataTables, registerListResource, registerSolver, runSolver, saveDataTables, saveList, saveSolverModels, type DataTableStore, type SolverOutcome, type SolverStore } from "@/lib/sheet-analysis";
import { newModel, areaRef, type SolverModel } from "@/lib/solver";
import type { DataTableDef } from "@/lib/data-table";
import { DataTableDialog, SolverDialog } from "./SheetAnalysis";
import { fetchWeb, registerQueries, runQuery, saveQueries, writeQuery, type QueryStore } from "@/lib/sheet-queries";
import { gridFor, type QueryDef } from "@/lib/data-import";
import { GetDataDialog, QueriesDialog, type GetDataResult } from "./SheetGetData";
import { GoalSeekDialog, parseSheetRef, ScenarioDialog, ShapeDialog, sheetRefText, SparklineDialog, type GoalSeekRequest, type SparklineRequest } from "./SheetWhatIf";
import SheetTraceArrows from "./SheetTraceArrows";
import SheetShape, { shapeEvents } from "./SheetShape";
import SheetSlicer from "./SheetSlicer";
import SheetFormControl, { FormControlDialog } from "./SheetFormControl";
import { defaultControlSize, FORM_CONTROL_COMPONENT, formControlBus, splitRef, type FormControlData } from "@/lib/form-controls";
import { InsertSlicerDialog } from "./SheetSlicerDialog";
import { applySlicer, fieldValues, registerSlicerTicks, slicerBus, slicerSources, type FieldSource } from "@/lib/sheet-slicers";
import { asDate, SLICER_COMPONENT, type SlicerData } from "@/lib/slicers";
import { DRAWING_DOM, newShape, SHAPE_COMPONENT, type ShapeData, type ShapeKind } from "@/lib/sheet-shapes";
import { liveSpills, registerCalc, setCalcSettings } from "@/lib/sheet-calc";
import { DEFAULT_CALC, type CalcSettings } from "@/lib/xlsx-calc";
import { CalcOptionsDialog } from "./SheetCalc";
import SheetVersions from "./SheetVersions";
import { encodeWorkbook } from "@/lib/sheet-versions";
import { flashFill } from "@/lib/flash-fill";
import { applyCellStyle, changeTheme, registerTheme, themeOf } from "@/lib/sheet-styles";
import type { WorkbookTheme } from "@/lib/sheet-themes";
import { CellStylesDialog, ThemeDialog } from "./SheetStyles";
import SheetSplitPane from "./SheetSplitPane";
import { LinksDialog } from "./SheetLinks";
import { AnalyzeDataDialog, FormulaHelperDialog, type FormulaRequestContext } from "./SheetAnalyze";
import { analyzeTable, describeTable, type Analysis, type Suggestion } from "@/lib/analyze-data";
import { columnName } from "@/lib/sheet-versions";
import { addLink, breakLink, linkableSheets, linkNewNames, linksOf, registerLinks, updateLinks, type LinkStore } from "@/lib/sheet-links";

type SaveState = "idle" | "saving" | "saved";
type LiveStatus = "connecting" | "connected" | "offline" | "local";

export default function UniverSheet({
  docId,
  title = "Untitled spreadsheet",
  initialSnapshot = null,
  canEdit = true,
  role = "owner",
  starred = false,
  meEmail = "",
  meName = "",
  collabUrl = "",
  initialLabelId = null,
}: {
  docId?: string;
  title?: string;
  initialSnapshot?: unknown;
  canEdit?: boolean;
  role?: Role;
  starred?: boolean;
  meEmail?: string;
  meName?: string;
  collabUrl?: string;
  /** The document's sensitivity label (documents.label_id). */
  initialLabelId?: string | null;
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const apiRef = useRef<any>(null);
  const disposeRef = useRef<(() => void) | null>(null);
  const collabRef = useRef<SheetCollabHandle | null>(null);
  const commentsRef = useRef<SheetCommentsHandle | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(title);
  const [busy, setBusy] = useState<string | null>(null);
  const [dedupe, setDedupe] = useState<(DedupeRequest & { range: any }) | null>(null);
  const [splitRange, setSplitRange] = useState<any>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const [status, setStatus] = useState<LiveStatus>(docId ? "connecting" : "local");
  const [peers, setPeers] = useState(1);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const chartStore = useRef(new Map<string, SheetChartResource>());
  const [docVersion, refreshCharts] = useState(0);
  const pivotStore = useRef<PivotStore>(new Map());
  const [pivotOpen, setPivotOpen] = useState(false);
  const [printJob, setPrintJob] = useState<{ book: any; sheetId: string; selection: PrintRange | null } | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [activePivotId, setActivePivotId] = useState<string | null>(null);
  const [chartsOpen, setChartsOpen] = useState(false);
  const [sheetApi, setSheetApi] = useState<any>(null);
  const [outlineHost, setOutlineHost] = useState<HTMLDivElement | null>(null);
  const protectionStore = useRef<ProtectionStore>(new Map());
  const [protectOpen, setProtectOpen] = useState(false);
  // Password-protected sheets and ranges unlocked in this session (see lib/sheet-protection).
  const unlockedRef = useRef<Set<string>>(new Set());
  const [unlocking, setUnlocking] = useState<"sheet" | "range" | null>(null);
  const [protectStart, setProtectStart] = useState<{ kind: "range" | "sheet"; n: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sparklineStore = useRef<SparklineStore>(new Map());
  const [sparkRequest, setSparkRequest] = useState<SparklineRequest | null>(null);
  const [goalSeekRequest, setGoalSeekRequest] = useState<GoalSeekRequest | null>(null);
  const [showFormulas, setShowFormulas] = useState(false);
  const showFormulasRef = useRef<{ set: (on: boolean) => void } | null>(null);
  const [trace, setTrace] = useState<TraceState>(NO_TRACE);
  const [shapeEdit, setShapeEdit] = useState<{ data: ShapeData; drawing?: { unitId: string; subUnitId: string; drawingId: string } } | null>(null);
  const drawingManagerRef = useRef<any>(null);
  const scenarioStore = useRef<ScenarioStore>(new Map());
  const [scenariosOpen, setScenariosOpen] = useState(false);
  const dataTableStore = useRef<DataTableStore>(new Map());
  const customViewStore = useRef<Map<string, CustomView[]>>(new Map());
  const [customViewsOpen, setCustomViewsOpen] = useState(false);
  const docPropsStore = useRef<DocPropsStore>(new Map());
  const [sensitivityOpen, setSensitivityOpen] = useState(false);
  const [workbookLock, setWorkbookLock] = useState<"protect" | "unprotect" | null>(null);
  const [a11yOpen, setA11yOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState<string | null>(null);
  const [formControlOpen, setFormControlOpen] = useState(false);
  const dataTablesRef = useRef<{ refresh: (only?: DataTableDef[]) => Promise<number> } | null>(null);
  const [dataTableRange, setDataTableRange] = useState<{ sheetId: string; rect: PrintRange; text: string } | null>(null);
  const solverStore = useRef<SolverStore>(new Map());
  const [solverOpen, setSolverOpen] = useState<SolverModel | null>(null);
  const solverOutcome = useRef<SolverOutcome | null>(null);
  const queryStore = useRef<QueryStore>(new Map());
  const scriptStore = useRef<ScriptStore>(new Map());
  const recorderRef = useRef<ReturnType<typeof createRecorder> | null>(null);
  const [scriptsOpen, setScriptsOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState<{ code: string; n: number } | null>(null);
  const [slicerInsert, setSlicerInsert] = useState<{ kind: "slicer" | "timeline"; sources: FieldSource[]; initial?: string } | null>(null);
  const [getDataOpen, setGetDataOpen] = useState<string | null>(null);
  const [queriesOpen, setQueriesOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  // This person changed the workbook since the last automatic version.
  const versionDirty = useRef(false);
  // View > Split: a second pane on the same workbook, below or beside this one.
  const [split, setSplit] = useState<{ dir: "rows" | "columns"; size: number; sheetId: string; row: number; column: number } | null>(null);
  const splitBox = useRef<HTMLDivElement>(null);
  const splitUser = useMemo(() => (meEmail ? { name: meEmail.split("@")[0], email: meEmail } : undefined), [meEmail]);
  const linkStore = useRef<LinkStore>(new Map());
  const [linksOpen, setLinksOpen] = useState(false);
  const [analyzeOpen, setAnalyzeOpen] = useState<{ analysis: Analysis; range: string; table: string; sheetId: string; startRow: number; startColumn: number; endRow: number; endColumn: number } | null>(null);
  const [formulaHelp, setFormulaHelp] = useState<(FormulaRequestContext & { sheetId: string; row: number; column: number }) | null>(null);
  const themeStore = useRef(new Map<string, WorkbookTheme>());
  const [stylesOpen, setStylesOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const calcStore = useRef(new Map<string, CalcSettings>());
  const [calcOpen, setCalcOpen] = useState(false);
  const [watchOpen, setWatchOpen] = useState(false);
  const [evaluating, setEvaluating] = useState<{ where: string; formula: string; calc: (f: string) => Promise<EvalValue> } | null>(null);
  // The engine pieces export needs (spills of dynamic-array formulas).
  const engineRef = useRef<{ injector: any; engine: any } | null>(null);
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotice = (text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  };
  const showNoticeRef = useRef(showNotice);
  showNoticeRef.current = showNotice;
  const actor = { email: meEmail, role };
  const isOwner = role === "owner";

  // Autosave plumbing (only used when this sheet has a docId to persist to).
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string>("");
  const nameRef = useRef(name);
  nameRef.current = name;

  const snapshotOf = (): any | null => {
    const wb = apiRef.current?.getActiveWorkbook?.();
    if (!wb) return null;
    return wb.save ? wb.save() : wb.getSnapshot?.() ?? null;
  };

  const persist = () => {
    if (!docId || !canEdit) return;
    const snap = snapshotOf();
    if (!snap) return;
    const json = JSON.stringify(snap);
    if (json === lastSaved.current) return; // nothing actually changed
    lastSaved.current = json;
    setSave("saving");
    const title = (snap.name as string) || nameRef.current || "Untitled spreadsheet";
    fetch(`/api/docs/${docId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, snippet: `Spreadsheet · ${title}`, snapshot: snap }),
    })
      .then(() => setSave("saved"))
      .catch(() => setSave("idle"));
  };

  const scheduleSave = () => {
    if (!docId || !canEdit) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persist, 1200);
  };

  useEffect(() => {
    let disposed = false;
    (async () => {
      const { LocaleType, merge } = await import("@univerjs/core");
      const { defaultTheme } = await import("@univerjs/themes");
      const { createUniver } = await import("@/lib/univer-create");
      const sheetsCore = await import("@univerjs/preset-sheets-core");
      const { UniverSheetsCorePreset } = sheetsCore;
      const enUS = (await import("@univerjs/preset-sheets-core/locales/en-US")).default;
      // Feature presets: only the open-source (Apache-2.0) ones. Never add
      // preset-sheets-advanced or preset-sheets-collaboration, which need
      // Univer's commercial @univerjs-pro packages.
      const features = await Promise.all([
        import("@univerjs/preset-sheets-sort"),
        import("@univerjs/preset-sheets-filter"),
        import("@univerjs/preset-sheets-find-replace"),
        import("@univerjs/preset-sheets-conditional-formatting"),
        import("@univerjs/preset-sheets-data-validation"),
        import("@univerjs/preset-sheets-hyper-link"),
        import("@univerjs/preset-sheets-note"),
        import("@univerjs/preset-sheets-drawing"),
        import("@univerjs/preset-sheets-table"),
        import("@univerjs/preset-sheets-thread-comment"),
      ]);
      const featureLocales = await Promise.all([
        import("@univerjs/preset-sheets-sort/locales/en-US"),
        import("@univerjs/preset-sheets-filter/locales/en-US"),
        import("@univerjs/preset-sheets-find-replace/locales/en-US"),
        import("@univerjs/preset-sheets-conditional-formatting/locales/en-US"),
        import("@univerjs/preset-sheets-data-validation/locales/en-US"),
        import("@univerjs/preset-sheets-hyper-link/locales/en-US"),
        import("@univerjs/preset-sheets-note/locales/en-US"),
        import("@univerjs/preset-sheets-drawing/locales/en-US"),
        import("@univerjs/preset-sheets-table/locales/en-US"),
        import("@univerjs/preset-sheets-thread-comment/locales/en-US"),
      ]);
      const { CommandType, CustomCommandExecutionError, IConfigService, ICommandService, InterceptorEffectEnum, IResourceManagerService, IUndoRedoService, IUniverInstanceService, UniverInstanceType } = await import("@univerjs/core");
      const engineFormula = await import("@univerjs/engine-formula");
      if (disposed || !container.current) return;
      const [sort, filter, findReplace, cf, dv, link, note, drawing, table, comments] = features;

      const { univer, univerAPI } = createUniver({
        locale: LocaleType.EN_US,
        locales: { [LocaleType.EN_US]: merge({}, enUS, ...featureLocales.map((m) => m.default)) },
        theme: defaultTheme,
        presets: [
          UniverSheetsCorePreset({ container: container.current }),
          sort.UniverSheetsSortPreset(),
          filter.UniverSheetsFilterPreset(),
          findReplace.UniverSheetsFindReplacePreset(),
          cf.UniverSheetsConditionalFormattingPreset(),
          dv.UniverSheetsDataValidationPreset(),
          link.UniverSheetsHyperLinkPreset(),
          note.UniverSheetsNotePreset(),
          drawing.UniverSheetsDrawingPreset(),
          table.UniverSheetsTablePreset(),
          comments.UniverSheetsThreadCommentPreset(),
        ],
      });
      const injector = univer.__getInjector();
      // Shapes and text boxes are floating DOM drawings drawn by SheetShape.
      univerAPI.registerComponent(SHAPE_COMPONENT, SheetShape as any);
      univerAPI.registerComponent(SLICER_COMPONENT, SheetSlicer as any);
      univerAPI.registerComponent(FORM_CONTROL_COMPONENT, SheetFormControl as any);
      try {
        drawingManagerRef.current = injector.get(drawing.IDrawingManagerService);
      } catch {
        /* drawing plugin not loaded */
      }
      const resourceRegistration = injector.get(IResourceManagerService).registerPluginResource<SheetChartResource>({
        pluginName: SHEET_CHART_RESOURCE,
        businesses: [UniverInstanceType.UNIVER_SHEET],
        onLoad: (unitId, resource) => {
          chartStore.current.set(unitId, resource);
          if (Object.values(resource.sheets).some((charts) => charts.length)) setChartsOpen(true);
          refreshCharts((version) => version + 1);
        },
        onUnLoad: (unitId) => {
          chartStore.current.delete(unitId);
          refreshCharts((version) => version + 1);
        },
        toJson: (unitId) => JSON.stringify(chartStore.current.get(unitId) || { sheets: {} }),
        parseJson: (bytes) => JSON.parse(bytes) as SheetChartResource,
      });
      const mutationRegistration = injector.get(ICommandService).registerCommand({
        id: "sheet.mutation.set-sheet-charts",
        type: CommandType.MUTATION,
        handler: (_accessor, params?: { unitId: string; sheetId: string; value: SheetChart[]; chartSheet?: boolean }) => {
          if (!params?.unitId || !params.sheetId || !Array.isArray(params.value)) return false;
          const resource = chartStore.current.get(params.unitId) || { sheets: {} };
          // A chart sheet stays one while it has its chart.
          let chartSheets = (resource.chartSheets || []).filter((id) => id !== params.sheetId || params.value.length);
          if (params.chartSheet && !chartSheets.includes(params.sheetId)) chartSheets = [...chartSheets, params.sheetId];
          chartStore.current.set(params.unitId, { sheets: { ...resource.sheets, [params.sheetId]: params.value }, ...(chartSheets.length ? { chartSheets } : {}) });
          refreshCharts((version) => version + 1);
          return true;
        },
      });
      const disposePivots = registerPivots(injector, { CommandType, ICommandService, IResourceManagerService, UniverInstanceType }, pivotStore.current, () => refreshCharts((v) => v + 1));
      const disposeProtections = registerProtections(
        injector,
        { CommandType, CustomCommandExecutionError, ICommandService, IResourceManagerService, UniverInstanceType },
        protectionStore.current,
        () => ({ email: meEmail, role }),
        () => refreshCharts((v) => v + 1),
        (message) => showNoticeRef.current(message),
        unlockedRef.current,
      );
      const disposeSparklines = registerSparklines(
        injector,
        { CommandType, ICommandService, InterceptorEffectEnum, IResourceManagerService, IUniverInstanceService, UniverInstanceType },
        sheetsCore,
        sparklineStore.current,
        () => {
          refreshCharts((v) => v + 1);
          redraw(univerAPI);
        },
      );
      const disposeCustomViews = registerListResource<CustomView>(injector, { CommandType, ICommandService, IResourceManagerService, UniverInstanceType }, {
        resource: CUSTOM_VIEWS_RESOURCE,
        mutation: SET_CUSTOM_VIEWS_MUTATION,
        field: "views",
        store: customViewStore.current,
        onChange: () => refreshCharts((v) => v + 1),
        fold: foldCustomViews,
      });
      const disposeDocProps = registerDocProps(injector, { CommandType, ICommandService, IResourceManagerService, UniverInstanceType }, docPropsStore.current, () => refreshCharts((v) => v + 1));
      const disposeStructureGuard = registerStructureGuard(injector, { ICommandService, CustomCommandExecutionError }, docPropsStore.current, (m) => showNoticeRef.current(m));
      const disposeScenarios = registerScenarios(injector, { CommandType, ICommandService, IResourceManagerService, UniverInstanceType }, scenarioStore.current, () => refreshCharts((v) => v + 1));
      const dataTables = registerDataTables(
        injector,
        { CommandType, ICommandService, IResourceManagerService, UniverInstanceType },
        () => apiRef.current,
        dataTableStore.current,
        () => refreshCharts((v) => v + 1),
        () => canEditRef.current,
      );
      dataTablesRef.current = dataTables;
      const disposeSolver = registerSolver(injector, { CommandType, ICommandService, IResourceManagerService, UniverInstanceType }, solverStore.current, () => refreshCharts((v) => v + 1));
      const disposeSlicerTicks = registerSlicerTicks(injector, { ICommandService });
      const disposeScripts = registerScripts(injector, { CommandType, ICommandService, IResourceManagerService, UniverInstanceType }, scriptStore.current, () => refreshCharts((v) => v + 1));
      recorderRef.current = createRecorder(injector, { ICommandService }, () => apiRef.current);
      const disposeKept = registerKeptParts(injector, { IResourceManagerService, UniverInstanceType });
      const disposeQueries = registerQueries(injector, { CommandType, ICommandService, IResourceManagerService, UniverInstanceType }, queryStore.current, () => refreshCharts((v) => v + 1));
      const showFormulasHandle = registerShowFormulas(injector, { InterceptorEffectEnum, IUniverInstanceService, UniverInstanceType }, sheetsCore);
      showFormulasRef.current = showFormulasHandle;
      let circularShown = 0;
      const disposeCalc = registerCalc(injector, { CommandType, IConfigService, ICommandService, IResourceManagerService, IUniverInstanceService, UniverInstanceType }, engineFormula, {
        store: calcStore.current,
        onChange: () => refreshCharts((v) => v + 1),
        onCircular: () => {
          if (Date.now() - circularShown < 15000) return;
          circularShown = Date.now();
          showNoticeRef.current("There's a circular reference: a formula refers to its own cell. Turn on iterative calculation in Formulas > Calculation options to work it out.");
        },
      });
      engineRef.current = { injector, engine: engineFormula };
      const disposeLinks = registerLinks(injector, { CommandType, ICommandService, IResourceManagerService, IUniverInstanceService, UniverInstanceType }, () => apiRef.current, linkStore.current, () => refreshCharts((v) => v + 1));
      const disposeTheme = registerTheme(injector, { CommandType, ICommandService, IResourceManagerService, UniverInstanceType }, themeStore.current, () => refreshCharts((v) => v + 1));
      const disposePageSetup = registerPageSetup(injector, { CommandType, ICommandService, IUniverInstanceService, IUndoRedoService });
      apiRef.current = univerAPI;
      slicerBus.api = univerAPI;
      setSheetApi(univerAPI);
      // Dev/e2e hook (never in production): drive the sheet without canvas clicks.
      if (typeof window !== "undefined" && process.env.NODE_ENV !== "production")
        (window as unknown as { __univer?: unknown }).__univer = univerAPI;

      // Called once the workbook exists (seeded from the shared collab base, or
      // the REST snapshot in the standalone/offline path). Sync the title and
      // baseline the diff-check so the first REST autosave isn't spurious.
      const onWorkbookReady = (snap: any) => {
        if (snap?.name) setName(snap.name);
        // Linked spreadsheets' values as they are now (only changes are saved).
        setTimeout(() => {
          const api = apiRef.current;
          if (api && canEditRef.current && linksOf(linkStore.current, api.getActiveWorkbook?.()?.getId?.()).some((l) => l.docId)) void updateLinks(api, linkStore.current).catch(() => {});
        }, 1500);
        lastSaved.current = JSON.stringify(snap ?? {});
        void commentsRef.current?.refresh(); // a new workbook unit starts without comments
      };

      // Comment threads come from the database, with Synergy users as authors.
      if (docId && meEmail) {
        commentsRef.current = connectSheetComments({
          docId,
          univer,
          univerAPI,
          me: { email: meEmail, name: meName || meEmail.split("@")[0] },
          notify: () => collabRef.current?.notifyComments(),
          onError: (message) => alert(message),
        });
      }

      if (docId) {
        // Real-time collaboration: the collab layer creates the workbook from
        // the shared base once the Yjs doc syncs, then relays every mutation.
        const url =
          collabUrl ||
          `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/collab`;
        collabRef.current = connectSheetCollab({
          url,
          docId,
          univerAPI,
          initialSnapshot,
          user: meEmail ? { name: meEmail.split("@")[0], email: meEmail } : undefined,
          onWorkbookReady,
          onStatus: setStatus,
          onPeers: setPeers,
          onParticipants: setParticipants,
          onRemoteApplied: () => scheduleSave(),
          onCommentsChanged: () => void commentsRef.current?.refresh(),
          // While anything is protected only the owner may replace the shared
          // workbook (the server refuses it from anyone else).
          mayReplace: () => role === "owner" || !protectionsIn(protectionStore.current, docId).length,
          onRejected: () => {
            alert("Your last change touched a protected range and was not saved. The spreadsheet will reload.");
            window.location.reload();
          },
        });
      } else {
        // Standalone (no docId): a plain local workbook, no live sync.
        if (initialSnapshot && typeof initialSnapshot === "object") {
          const snap = initialSnapshot as any;
          if (!snap.name) snap.name = title;
          createWorkbookFromSnapshot(univerAPI, snap);
        } else {
          univerAPI.createWorkbook({ name: title });
        }
        onWorkbookReady(snapshotOf());
      }

      // Any edit schedules a debounced REST snapshot save (keeps the doc-list
      // preview + .xlsx export + offline fallback current). The diff-check in
      // persist() filters out non-mutating noise (selection moves, etc.).
      try {
        univerAPI.onCommandExecuted?.((command: { id?: string; params?: any }, options?: { fromCollab?: boolean; onlyLocal?: boolean }) => {
          // A collaborator renamed the spreadsheet: show the new title.
          if (command?.id === "sheet.mutation.set-workbook-name" && command.params?.name) setName(command.params.name);
          if (!options?.fromCollab && !options?.onlyLocal) adoptInsertedIntoGroups(univerAPI, command);
          if (!options?.fromCollab && !options?.onlyLocal && /^sheets?\.mutation\./.test(command?.id || "")) versionDirty.current = true;
          // A formula naming another spreadsheet ([Budget]Plan!A1) links it.
          if (command?.id === "sheet.command.set-range-values" && !options?.fromCollab && canEditRef.current) {
            const v = command.params?.value;
            const fs: string[] = [];
            const take = (cell: any) => typeof cell?.f === "string" && cell.f.includes("[") && fs.push(cell.f);
            if (v && typeof v === "object") {
              if ("f" in v) take(v);
              else for (const row of Object.values(v)) if (row && typeof row === "object") for (const cell of Object.values(row as object)) take(cell);
            }
            if (fs.length)
              void linkNewNames(univerAPI, linkStore.current, fs, docId).then((names) => {
                if (names.length) showNoticeRef.current(`Linked to ${names.map((n) => `"${n}"`).join(", ")}.`);
              });
          }
          scheduleSave();
          refreshCharts((version) => version + 1);
        });
      } catch {
        /* facade shape differs across versions — persistence degrades to manual save */
      }

      disposeRef.current = () => {
        mutationRegistration.dispose();
        resourceRegistration.dispose();
        disposePivots();
        disposePageSetup();
        disposeCalc();
        disposeTheme();
        disposeLinks();
        engineRef.current = null;
        disposeProtections();
        disposeSparklines();
        disposeScenarios();
        disposeCustomViews();
        disposeDocProps();
        disposeStructureGuard();
        dataTables.dispose();
        dataTablesRef.current = null;
        disposeSolver();
        disposeQueries();
        disposeSlicerTicks();
        disposeScripts();
        disposeKept();
        recorderRef.current?.dispose();
        recorderRef.current = null;
        slicerBus.api = null;
        showFormulasHandle.dispose();
        showFormulasRef.current = null;
        setSheetApi(null);
        univer.dispose();
      };
    })();
    return () => {
      disposed = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      persist(); // flush on unmount so nothing is lost on navigate-away
      collabRef.current?.destroy();
      collabRef.current = null;
      commentsRef.current?.dispose();
      commentsRef.current = null;
      disposeRef.current?.();
      disposeRef.current = null;
      chartStore.current.clear();
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  // ---- Version history: whole-workbook snapshots on the shared versions API ----
  const saveVersion = async (label?: string): Promise<string | null> => {
    const snap = snapshotOf();
    if (!docId || !snap) return null;
    const res = await fetch(`/api/docs/${docId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html: encodeWorkbook(snap), ...(label ? { label } : {}) }),
    }).catch(() => null);
    if (!res?.ok) return null;
    const out = (await res.json()) as { id?: string };
    if (out.id) return out.id;
    if (!label) return null;
    // Unchanged since the newest version: name that one.
    const list = await fetch(`/api/docs/${docId}/versions`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const newest = list?.versions?.[0]?.id as string | undefined;
    if (!newest) return null;
    await fetch(`/api/docs/${docId}/versions/${newest}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label }) });
    return newest;
  };
  const saveVersionRef = useRef(saveVersion);
  saveVersionRef.current = saveVersion;
  useEffect(() => {
    if (!docId || !canEdit) return;
    // An automatic version a minute after this person's edits.
    const t = setInterval(() => {
      if (!versionDirty.current) return;
      versionDirty.current = false;
      void saveVersionRef.current();
    }, 60_000);
    return () => clearInterval(t);
  }, [docId, canEdit]);

  /** Puts a whole workbook in place of the current one, for everyone in the spreadsheet. */
  const replaceWorkbook = (snapshot: any): boolean => {
    const api = apiRef.current;
    if (!api) return false;
    if (!isOwner && protectionsIn(protectionStore.current, api.getActiveWorkbook?.()?.getId?.()).length) {
      alert("This spreadsheet has protected sheets or ranges, so only its owner can replace it.");
      return false;
    }
    if (!isOwner && protectionsOf(snapshot).length) {
      snapshot = withProtections(snapshot, []);
      alert("Sheet protection was not kept: only the spreadsheet's owner can protect sheets and ranges.");
    }
    if (collabRef.current) {
      // Replaces the shared workbook for every collaborator, not just this tab.
      collabRef.current.replaceWorkbook(snapshot);
    } else {
      const prevId = api.getActiveWorkbook?.()?.getId?.();
      if (prevId) {
        try {
          api.disposeUnit?.(prevId);
        } catch {
          /* old unit already gone */
        }
      }
      createWorkbookFromSnapshot(api, snapshot, { replaced: true });
    }
    if (snapshot?.name) setName(snapshot.name);
    lastSaved.current = ""; // the new workbook must be saved even if it looks like the baseline
    scheduleSave();
    return true;
  };
  const restoreVersion = async (book: any): Promise<boolean> => {
    const ok = replaceWorkbook(JSON.parse(JSON.stringify(book)));
    if (ok) showNotice("Restored an earlier version. The spreadsheet as it was is kept in the version history.");
    return ok;
  };

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !apiRef.current) return;
    setBusy("Opening…");
    try {
      const ab = await file.arrayBuffer();
      const base = file.name.replace(/\.[^.]+$/, "");
      const snapshot = /\.xls[xm]$/i.test(file.name) ? await xlsxToUniver(ab, base) : legacyToUniver(ab, base);
      if (!replaceWorkbook(snapshot)) return;
      // A file saved with a split window opens split.
      const splitSheet = snapshot.sheetOrder.find((id) => snapshot.sheets[id]?.custom?.xlsx?.split);
      const sv = splitSheet ? snapshot.sheets[splitSheet].custom?.xlsx?.split : undefined;
      if (docId && splitSheet && sv) setSplit({ dir: sv.ySplit ? "rows" : "columns", size: 0.5, sheetId: splitSheet, row: 0, column: 0 });
      // Excel threaded comments join the spreadsheet's comment list.
      if (docId && /\.xls[xm]$/i.test(file.name)) {
        try {
          const { readThreadedComments } = await import("@/lib/xlsx-threads");
          const threads = [...(await readThreadedComments(new Uint8Array(ab))).entries()].flatMap(([i, list]) =>
            list.map((t) => ({ ...t, sheetId: snapshot.sheetOrder[i] })),
          );
          if (threads.length) {
            await fetch(`/api/docs/${docId}/comments/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threads }) });
            await commentsRef.current?.refresh();
            collabRef.current?.notifyComments();
          }
        } catch {
          /* the cells opened; only the comments are missing */
        }
      }
      if (Object.values(chartResource(snapshot.resources).sheets).some((charts) => charts.length)) setChartsOpen(true);
      lastSaved.current = ""; // the new workbook must be saved even if it looks like the baseline
      scheduleSave();
    } catch (err) {
      alert("Could not open that file: " + (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // The title bar renames the document; the workbook carries the same name so
  // autosave and collaborators keep it.
  const onRename = (t: string) => {
    setName(t);
    try {
      apiRef.current?.getActiveWorkbook?.()?.setName?.(t);
    } catch {
      /* workbook not ready yet */
    }
  };

  // ---- Data > Remove duplicates / Split text to columns ----
  // A single selected cell means "the table around it", as in Excel.
  const selectedBlock = () => {
    const sheet = apiRef.current?.getActiveWorkbook?.()?.getActiveSheet?.();
    const range = sheet?.getActiveRange?.();
    if (!sheet || !range) return null;
    const one = range.getHeight?.() === 1 && range.getWidth?.() === 1;
    if (!one) return range;
    const ws = sheet.getSheet();
    const g = currentRegion((r, c) => { const cell = ws.getCellRaw(r, c); return cell?.v ?? (cell?.p || cell?.f ? "x" : null); }, range.getRow(), range.getColumn());
    return sheet.getRange(g.startRow, g.startColumn, g.endRow - g.startRow + 1, g.endColumn - g.startColumn + 1);
  };

  // ---- Data > Flash Fill: the column worked out from the examples typed in it ----
  const runFlashFill = () => {
    const api = apiRef.current;
    const sheet = api?.getActiveWorkbook?.()?.getActiveSheet?.();
    const range = sheet?.getActiveRange?.();
    if (!sheet || !range || !canEdit) return;
    const ws = sheet.getSheet();
    const row = range.getRow();
    const col = range.getColumn();
    const g = currentRegion((r, c) => { const cell = ws.getCellRaw(r, c); return cell?.v ?? (cell?.p || cell?.f ? "x" : null); }, row, col);
    const block = sheet.getRange(g.startRow, g.startColumn, g.endRow - g.startRow + 1, g.endColumn - g.startColumn + 1);
    const texts: string[][] = (block.getDisplayValues?.() ?? block.getValues()).map((r: unknown[]) => r.map((v) => (v == null ? "" : String(v))));
    const ci = col - g.startColumn;
    const rows = texts.map((r) => ({ inputs: r.filter((_, j) => j !== ci), output: r[ci] ? r[ci] : null }));
    // A heading at the top of the column is not an example.
    let skip = 0;
    let result = rows.length > 1 ? flashFill(rows) : null;
    if (!result && rows[0]?.output) {
      skip = 1;
      result = flashFill(rows.slice(1));
    }
    if (!result || g.endColumn === g.startColumn) {
      showNotice("Flash Fill needs an example: type the result you want next to your data, in the first cell or two of the column, then try again.");
      return;
    }
    const value: Record<number, Record<number, unknown>> = {};
    let n = 0;
    result.outputs.forEach((text, i) => {
      const r = g.startRow + skip + i;
      if (text == null || rows[skip + i].output != null) return;
      (value[r] ||= {})[col] = { v: text, t: 1 };
      n++;
    });
    if (!n) {
      showNotice("Flash Fill found nothing to fill in this column.");
      return;
    }
    void api.executeCommand("sheet.command.set-range-values", { unitId: api.getActiveWorkbook().getId(), subUnitId: sheet.getSheetId(), value });
    showNotice(`Flash Fill changed ${n} cell${n === 1 ? "" : "s"}.`);
  };
  const linkableSheetsFor = useMemo(() => () => linkableSheets(docId), [docId]);
  const openSplit = (dir: "rows" | "columns") => {
    const sheet = apiRef.current?.getActiveWorkbook?.()?.getActiveSheet?.();
    const range = sheet?.getActiveRange?.();
    if (!sheet) return;
    setSplit({ dir, size: 0.5, sheetId: sheet.getSheetId(), row: range?.getRow?.() ?? 0, column: range?.getColumn?.() ?? 0 });
  };
  const dragSplit = (e: React.PointerEvent) => {
    const box = splitBox.current?.getBoundingClientRect();
    if (!box || !split) return;
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const f = split.dir === "rows" ? (ev.clientY - box.top) / box.height : (ev.clientX - box.left) / box.width;
      setSplit((s) => (s ? { ...s, size: Math.min(0.85, Math.max(0.15, f)) } : s));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const runFlashFillRef = useRef(runFlashFill);
  runFlashFillRef.current = runFlashFill;

  const openRemoveDuplicates = () => {
    const range = selectedBlock();
    const values: unknown[][] = range?.getValues?.() || [];
    if (!range || values.length < 2) return alert("Select the rows to check for duplicates.");
    const first = values[0] || [];
    const looksLikeHeader = first.every((v) => typeof v === "string" && v.trim() !== "") && values.slice(1).some((r) => r.some((v, i) => typeof v !== typeof first[i]));
    setDedupe({ range, rows: values.length, headers: first.map((v) => (v == null ? "" : String(v))), firstRowLooksLikeHeader: looksLikeHeader });
  };

  const applyRemoveDuplicates = (columns: number[], hasHeader: boolean) => {
    const req = dedupe;
    setDedupe(null);
    if (!req) return;
    const { range } = req;
    const values: unknown[][] = range.getValues();
    const cells: any[][] = range.getCellDatas();
    const keep = rowsToKeep(values, columns, hasHeader);
    const removed = values.length - keep.length;
    if (!removed) return alert("No duplicate rows found.");
    // Kept rows move up inside the selection; formulas follow their row.
    const moved = keep.map((from, to) =>
      cells[from].map((c) => {
        if (!c) return {};
        const { si: _si, ...rest } = c;
        void _si;
        return rest.f && from !== to ? { ...rest, f: shiftFormula(rest.f, to - from, 0) } : rest;
      }),
    );
    const sheet = apiRef.current.getActiveWorkbook().getActiveSheet();
    const top = range.getRow();
    const left = range.getColumn();
    const width = range.getWidth();
    sheet.getRange(top, left, keep.length, width).setValues(moved);
    sheet.getRange(top + keep.length, left, removed, width).clear();
    alert(`Removed ${removed} duplicate row${removed === 1 ? "" : "s"}; ${keep.length - (hasHeader ? 1 : 0)} unique row${keep.length - (hasHeader ? 1 : 0) === 1 ? "" : "s"} remain.`);
  };

  const openSplitText = () => {
    const range = apiRef.current?.getActiveWorkbook?.()?.getActiveSheet?.()?.getActiveRange?.();
    if (!range || range.getWidth() !== 1) return alert("Select cells in one column to split.");
    setSplitRange(range);
  };

  const applySplitText = (o: { delimiter?: number; customDelimiter?: string; treatMultipleDelimitersAsOne: boolean }) => {
    const range = splitRange;
    setSplitRange(null);
    if (!range) return;
    const wb = apiRef.current.getActiveWorkbook();
    cmd("sheet.command.split-text-to-columns", {
      unitId: wb.getId(),
      subUnitId: wb.getActiveSheet().getSheetId(),
      range: range.getRange(),
      ...o,
    });
  };

  const download = (blob: Blob, filename: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const onExport = async () => {
    const api = apiRef.current;
    const wb = api?.getActiveWorkbook?.();
    if (!wb) return;
    setBusy("Saving…");
    try {
      const snap = wb.save ? wb.save() : wb.getSnapshot?.();
      const eng = engineRef.current;
      const spills = eng ? liveSpills(eng.injector, eng.engine, wb.getId()) : undefined;
      // An open split goes in the file as Excel's split window, at the bar's place.
      const box = outlineHost?.getBoundingClientRect();
      const splitView =
        split && box ? { [split.sheetId]: split.dir === "rows" ? { xSplit: 0, ySplit: Math.round(box.height * 15) } : { xSplit: Math.round(box.width * 15), ySplit: 0 } } : undefined;
      const bytes = await univerToXlsx(snap, { threads: await commentThreads(), spills, split: splitView });
      // A workbook with VBA macros stays macro-enabled (.xlsm); its macros are kept, never run.
      const macro = isMacroEnabled(snap);
      download(new Blob([bytes as BlobPart], { type: macro ? "application/vnd.ms-excel.sheet.macroEnabled.12" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${name || "spreadsheet"}.${macro ? "xlsm" : "xlsx"}`);
    } catch (err) {
      alert("Could not save: " + (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // The spreadsheet's comment threads, for Excel's threaded comments.
  const commentThreads = async (): Promise<SheetThread[]> => {
    if (!docId) return [];
    try {
      const r = await fetch(`/api/docs/${docId}/comments`);
      if (!r.ok) return [];
      const { threads } = (await r.json()) as { threads: { id: string; anchor: string; resolved: boolean; messages: { author_name: string; author_email: string; body: string; created_ms: string }[] }[] };
      return threads.flatMap((t) => {
        try {
          const a = JSON.parse(t.anchor || "null");
          if (!a?.sheetId || !a?.ref) return [];
          const ref = String(a.ref).split(":")[0];
          return [{ id: t.id, sheetId: a.sheetId, ref, resolved: !!t.resolved, messages: t.messages.map((m) => ({ ...m, created_ms: Number(m.created_ms) })) }];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    }
  };

  // CSV holds one sheet: the one on screen.
  const onExportCsv = () => {
    const wb = apiRef.current?.getActiveWorkbook?.();
    if (!wb) return;
    const snap = wb.save ? wb.save() : wb.getSnapshot?.();
    const sheet = wb.getActiveSheet?.();
    const sheetId = sheet?.getSheetId?.() || snap.sheetOrder[0];
    const sheetName = snap.sheets?.[sheetId]?.name;
    const base = name || "spreadsheet";
    const filename = snap.sheetOrder.length > 1 && sheetName ? `${base} - ${sheetName}.csv` : `${base}.csv`;
    // The byte-order mark makes Excel read the file as UTF-8.
    download(new Blob(["\uFEFF" + univerSheetToCsv(snap, sheetId)], { type: "text/csv;charset=utf-8" }), filename);
  };

  const newDoc = async (kind: "doc" | "sheet" | "slide") => {
    const r = await fetch("/api/docs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
    const { id } = await r.json();
    window.open(kind === "doc" ? `/doc/${id}` : kind === "sheet" ? `/sheet/${id}` : `/slides/${id}`, "_blank");
  };
  // Menu actions operate on the Univer facade (probed to exist in this version):
  // undo/redo on the API; formatting/insert on the active sheet & selection.
  const sheetOp = (fn: (sheet: any) => void) => {
    const sh = apiRef.current?.getActiveWorkbook?.()?.getActiveSheet?.();
    if (!sh || !canEdit) return;
    try {
      fn(sh);
    } catch {
      /* facade shape differs across Univer versions */
    }
    scheduleSave();
  };
  const fmt = (fn: (range: any) => void) => sheetOp((sh) => { const r = sh.getActiveRange?.(); if (r) fn(r); });
  const activeChartSheet = () => {
    const wb = apiRef.current?.getActiveWorkbook?.();
    const sh = wb?.getActiveSheet?.();
    const unitId = wb?.getId?.();
    const sheetId = sh?.getSheetId?.();
    if (!unitId || !sheetId) return null;
    return { wb, sh, unitId, sheetId, charts: chartStore.current.get(unitId)?.sheets[sheetId] || [] };
  };
  const selectedChartRange = (sh: any) => {
    const range = sh.getSelection?.()?.getActiveRange?.()?.getRange?.();
    if (!range) throw new Error("Select a labeled data range first.");
    return range as { startRow: number; endRow: number; startColumn: number; endColumn: number };
  };
  const setSheetCharts = async (charts: SheetChart[]) => {
    const active = activeChartSheet();
    if (!active || !canEdit) return;
    const result = await apiRef.current.executeCommand("sheet.mutation.set-sheet-charts", { unitId: active.unitId, sheetId: active.sheetId, value: charts });
    if (result === false) throw new Error("Could not update the chart.");
    scheduleSave();
  };
  const addChart = (type: ChartType) => {
    try {
      const active = activeChartSheet();
      if (!active) return;
      const chart = chartFromSelection(active.sheetId, selectedChartRange(active.sh), type, crypto.randomUUID());
      const data = chartData(active.wb.save(), chart);
      if (!data.some((series) => series.values.some((value) => value !== null))) throw new Error("The selected range needs numeric values.");
      void setSheetCharts([...active.charts, chart]).catch((error) => alert((error as Error).message));
      setChartsOpen(true);
    } catch (error) {
      alert((error as Error).message);
    }
  };
  const updateChart = (chart: SheetChart) => {
    const active = activeChartSheet();
    if (active) void setSheetCharts(active.charts.map((item) => item.id === chart.id ? chart : item)).catch((error) => alert((error as Error).message));
  };
  const removeChart = (id: string) => {
    const active = activeChartSheet();
    if (active) void setSheetCharts(active.charts.filter((chart) => chart.id !== id)).catch((error) => alert((error as Error).message));
  };
  // Move chart: onto a sheet of its own (Excel's chart sheet).
  const moveChartToSheet = async (id: string) => {
    const active = activeChartSheet();
    const chart = active?.charts.find((c) => c.id === id);
    if (!active || !chart || !canEdit) return;
    const api = apiRef.current;
    const names = new Set((active.wb.getSheets() as any[]).map((x) => x.getSheetName().toLowerCase()));
    let n = 1;
    while (names.has(`chart${n}`)) n++;
    const sheet = active.wb.insertSheet(`Chart${n}`);
    const newId = sheet.getSheetId();
    await api.executeCommand("sheet.mutation.set-sheet-charts", { unitId: active.unitId, sheetId: active.sheetId, value: active.charts.filter((c) => c.id !== id) });
    await api.executeCommand("sheet.mutation.set-sheet-charts", { unitId: active.unitId, sheetId: newId, value: [{ ...chart, anchor: { row: 0, column: 0 } }], chartSheet: true });
    sheet.activate();
    scheduleSave();
  };
  const chartUseSelection = (id: string) => {
    try {
      const active = activeChartSheet();
      const current = active?.charts.find((chart) => chart.id === id);
      if (!active || !current) return;
      const selected = chartFromSelection(active.sheetId, selectedChartRange(active.sh), current.type, id);
      updateChart({ ...current, series: selected.series });
    } catch (error) {
      alert((error as Error).message);
    }
  };
  // Univer commands/operations by id (sort, filter, find, panels): the same
  // actions as the ribbon, exposed in the familiar menus too.
  const cmd = (id: string, params?: unknown) => {
    try {
      void apiRef.current?.executeCommand?.(id, params);
    } catch {
      /* command not registered in this build */
    }
  };

  // ---- Insert > Analyze Data, Formulas > Write a formula ----
  const rangeName = (g: { startRow: number; endRow: number; startColumn: number; endColumn: number }) => `${columnName(g.startColumn)}${g.startRow + 1}:${columnName(g.endColumn)}${g.endRow + 1}`;
  const openAnalyze = () => {
    const range = selectedBlock();
    const g = range?.getRange?.();
    const sheet = apiRef.current?.getActiveWorkbook?.()?.getActiveSheet?.();
    if (!range || !g || !sheet) return;
    const table = (range.getValues() as unknown[][]).map((r) => r.map((v) => (v == null ? null : (v as string | number | boolean))));
    setAnalyzeOpen({ analysis: analyzeTable(table), range: rangeName(g), table: describeTable(table), sheetId: sheet.getSheetId(), startRow: g.startRow, startColumn: g.startColumn, endRow: g.endRow, endColumn: g.endColumn });
  };
  const insertSuggestion = async (s: Suggestion) => {
    const at = analyzeOpen;
    const api = apiRef.current;
    const wb = api?.getActiveWorkbook?.();
    if (!at || !wb || !canEdit) return;
    const unitId = wb.getId();
    if (s.kind === "chart") {
      const { sheetId, startRow, endRow, startColumn, endColumn } = at;
      const column = (k: number) => startColumn + k;
      const chart: SheetChart = {
        id: crypto.randomUUID(),
        type: s.chartType,
        title: s.title,
        anchor: { row: startRow, column: endColumn + 2 },
        series: s.values.slice(0, 12).map((v, k) => ({
          name: `Series ${k + 1}`,
          nameCell: { sheetId, row: startRow, column: column(v) },
          categories: { sheetId, startRow: startRow + 1, endRow, startColumn: column(s.category), endColumn: column(s.category) },
          values: { sheetId, startRow: startRow + 1, endRow, startColumn: column(v), endColumn: column(v) },
        })),
      };
      const current = chartStore.current.get(unitId)?.sheets[sheetId] || [];
      if ((await api.executeCommand("sheet.mutation.set-sheet-charts", { unitId, sheetId, value: [...current, chart] })) === false) throw new Error("Could not add the chart.");
      scheduleSave();
      setChartsOpen(true);
      return;
    }
    if (s.kind !== "pivot") return;
    const pivots = workbookPivots();
    const name = nextPivotName(api, pivots);
    const sheet = wb.insertSheet(name);
    const def: PivotDef = {
      id: crypto.randomUUID(),
      name,
      source: { sheetId: at.sheetId, range: { startRow: at.startRow, endRow: at.endRow, startColumn: at.startColumn, endColumn: at.endColumn } },
      target: { sheetId: sheet.getSheetId(), row: 0, column: 0 },
      rows: s.rows,
      columns: [],
      values: s.values,
      filters: [],
    };
    const written = writePivot(api, def, () => true);
    if (!written) return;
    await storePivots([...pivots, written]);
    if (s.chart) {
      const chart: SheetChart = { id: crypto.randomUUID(), type: s.chart, title: s.title, anchor: { row: 0, column: (written.lastSize?.columns || 1) + 1 }, series: pivotChartSeries(written), pivotId: written.id };
      await api.executeCommand("sheet.mutation.set-sheet-charts", { unitId, sheetId: written.target.sheetId, value: [...(chartStore.current.get(unitId)?.sheets[written.target.sheetId] || []), chart] });
      scheduleSave();
      setChartsOpen(true);
    }
    sheet.activate?.();
  };
  const openEvaluate = () => {
    const api = apiRef.current;
    const sh = api?.getActiveWorkbook?.()?.getActiveSheet?.();
    const r = sh?.getActiveRange?.();
    const g = r?.getRange?.();
    if (!sh || !g) return;
    const cell = sh.getRange(g.startRow, g.startColumn);
    const formula = cell.getFormula?.() || "";
    if (!formula) return showNotice("Select a cell with a formula to evaluate.");
    setEvaluating({ where: `${sh.getSheetName()}!${cell.getA1Notation?.() || ""}`, formula, calc: liveCalc(engineRef.current, api, sh.getSheetId(), g.startRow, g.startColumn) });
  };
  const openFormulaHelper = () => {
    const sheet = apiRef.current?.getActiveWorkbook?.()?.getActiveSheet?.();
    const cell = sheet?.getActiveRange?.();
    if (!sheet || !cell) return;
    const row = cell.getRow();
    const column = cell.getColumn();
    // The table next to the cell (or the sheet's data when the cell stands alone).
    const ws = sheet.getSheet();
    let g = currentRegion((r, c) => { const v = ws.getCellRaw(r, c); return r === row && c === column ? null : v?.v ?? (v?.p || v?.f ? "x" : null); }, row, column);
    if (g.endRow === g.startRow && g.endColumn === g.startColumn) {
      const last = { r: sheet.getLastRow?.() ?? -1, c: sheet.getLastColumn?.() ?? -1 };
      g = last.r >= 0 && last.c >= 0 ? { startRow: 0, startColumn: 0, endRow: last.r, endColumn: last.c } : g;
    }
    const values = sheet.getRange(g.startRow, g.startColumn, Math.min(6, g.endRow - g.startRow + 1), g.endColumn - g.startColumn + 1).getValues() as unknown[][];
    const columns = (values[0] || []).flatMap((h, k) => (h == null || h === "" ? [] : [{ column: columnName(g.startColumn + k), name: String(h) }]));
    setFormulaHelp({
      sheetId: sheet.getSheetId(),
      row,
      column,
      sheet: sheet.getSheetName?.(),
      cell: `${columnName(column)}${row + 1}`,
      range: g.endRow > g.startRow ? rangeName(g) : undefined,
      columns,
      sample: values.slice(1).map((r) => r.map((v) => String(v ?? "")).join(" | ")).join("\n"),
    });
  };
  const insertHelperFormula = (formula: string) => {
    const at = formulaHelp;
    const wb = apiRef.current?.getActiveWorkbook?.();
    const sheet = at && wb?.getSheetBySheetId?.(at.sheetId);
    if (!at || !sheet) return;
    sheet.getRange(at.row, at.column).setFormula(formula);
    setFormulaHelp(null);
    showNotice(`Inserted ${formula} in ${at.cell}.`);
    scheduleSave();
  };

  // ---- Pivot tables ----
  const workbookPivots = (): PivotDef[] => pivotsOf(pivotStore.current, apiRef.current?.getActiveWorkbook?.()?.getId?.());
  const storePivots = async (pivots: PivotDef[]) => {
    const unitId = apiRef.current?.getActiveWorkbook?.()?.getId?.();
    if (unitId) await savePivots(apiRef.current, unitId, pivots);
    if (unitId) await syncPivotCharts(unitId, pivots);
    scheduleSave();
  };
  /** Pivot charts follow their pivot table's output. */
  const syncPivotCharts = async (unitId: string, pivots: PivotDef[]) => {
    const model = chartStore.current.get(unitId);
    if (!model) return;
    for (const [sheetId, charts] of Object.entries(model.sheets)) {
      let changed = false;
      const next = charts.map((c) => {
        const p = c.pivotId && pivots.find((x) => x.id === c.pivotId);
        if (!p) return c;
        try {
          const series = pivotChartSeries(p);
          if (JSON.stringify(series.map((x) => [x.categories, x.values, x.nameCell])) === JSON.stringify(c.series.map((x) => [x.categories, x.values, x.nameCell]))) return c;
          changed = true;
          return { ...c, series };
        } catch {
          return c;
        }
      });
      if (changed) await apiRef.current.executeCommand("sheet.mutation.set-sheet-charts", { unitId, sheetId, value: next });
    }
  };
  const addPivotChart = async () => {
    const at = activeCell();
    const pivots = workbookPivots();
    const inside = at && pivots.find((p) => p.target.sheetId === at.sheetId && p.lastSize && at.row >= p.target.row && at.row < p.target.row + p.lastSize.rows && at.column >= p.target.column && at.column < p.target.column + p.lastSize.columns);
    const p = inside || pivots.find((x) => x.id === shownPivotId);
    if (!p) return showNotice("Select a cell of a pivot table first.");
    const unitId = apiRef.current?.getActiveWorkbook?.()?.getId?.();
    try {
      const series = pivotChartSeries(p);
      const chart: SheetChart = { id: crypto.randomUUID(), type: "column", title: p.name, anchor: { row: p.target.row, column: p.target.column + (p.lastSize?.columns || 1) + 1 }, series, pivotId: p.id };
      const current = chartStore.current.get(unitId)?.sheets[p.target.sheetId] || [];
      await apiRef.current.executeCommand("sheet.mutation.set-sheet-charts", { unitId, sheetId: p.target.sheetId, value: [...current, chart] });
      scheduleSave();
      setChartsOpen(true);
    } catch (e) {
      showNotice((e as Error).message);
    }
  };
  const pivotError = (e: unknown) => alert((e as Error).message || "The pivot table could not be updated.");
  /** Rewrites a pivot table's cells and stores its definition. */
  const applyPivot = async (def: PivotDef) => {
    try {
      const written = writePivot(apiRef.current, def, (msg) => confirm(msg));
      if (!written) return;
      await storePivots(workbookPivots().map((p) => (p.id === def.id ? written : p)));
    } catch (e) {
      pivotError(e);
    }
  };
  const createPivot = async () => {
    try {
      const wb = apiRef.current?.getActiveWorkbook?.();
      const range = selectedBlock();
      const g = range?.getRange?.();
      if (!wb || !g || g.endRow <= g.startRow) return alert("Select a data range with a header row first.");
      const sourceSheetId = wb.getActiveSheet().getSheetId();
      const pivots = workbookPivots();
      const name = nextPivotName(apiRef.current, pivots);
      const sheet = wb.insertSheet(name);
      const def: PivotDef = {
        id: crypto.randomUUID(),
        name,
        source: { sheetId: sourceSheetId, range: { startRow: g.startRow, endRow: g.endRow, startColumn: g.startColumn, endColumn: g.endColumn } },
        target: { sheetId: sheet.getSheetId(), row: 0, column: 0 },
        rows: [],
        columns: [],
        values: [],
        filters: [],
      };
      await storePivots([...pivots, def]);
      sheet.activate?.();
      setActivePivotId(def.id);
      setPivotOpen(true);
    } catch (e) {
      pivotError(e);
    }
  };
  const refreshPivots = async (only?: string) => {
    try {
      const next: PivotDef[] = [];
      for (const p of workbookPivots()) next.push(only && p.id !== only ? p : writePivot(apiRef.current, p, () => true) || p);
      await storePivots(next);
    } catch (e) {
      pivotError(e);
    }
  };
  const deletePivot = async (id: string) => {
    const def = workbookPivots().find((p) => p.id === id);
    if (!def || !confirm(`Delete ${def.name}? Its cells are cleared.`)) return;
    try {
      writePivot(apiRef.current, { ...def, rows: [], columns: [], values: [] }, () => true);
    } catch {
      /* its sheet is gone; drop the definition anyway */
    }
    await storePivots(workbookPivots().filter((p) => p.id !== id));
  };
  const pivotFromSelection = (id: string) => {
    const def = workbookPivots().find((p) => p.id === id);
    const g = selectedBlock()?.getRange?.();
    const sheetId = apiRef.current?.getActiveWorkbook?.()?.getActiveSheet?.()?.getSheetId?.();
    if (!def || !g || !sheetId || g.endRow <= g.startRow) return alert("Select a data range with a header row first.");
    void applyPivot({ ...def, source: { sheetId, range: { startRow: g.startRow, endRow: g.endRow, startColumn: g.startColumn, endColumn: g.endColumn } } });
  };
  const pivotsNow = workbookPivots();
  const activeSheetIdNow = apiRef.current?.getActiveWorkbook?.()?.getActiveSheet?.()?.getSheetId?.();
  const shownPivotId = pivotsNow.some((p) => p.id === activePivotId) ? activePivotId : pivotsNow.find((p) => p.target.sheetId === activeSheetIdNow)?.id || pivotsNow[0]?.id || null;

  // ---- Page setup, printing and PDF ----
  const selectionRange = (): PrintRange | null => {
    const g = apiRef.current?.getActiveWorkbook?.()?.getActiveSheet?.()?.getActiveRange?.()?.getRange?.();
    return g ? { startRow: g.startRow, endRow: g.endRow, startColumn: g.startColumn, endColumn: g.endColumn } : null;
  };
  const downloadPdf = async (pages: PageModel[]) => {
    try {
      const { pagesToPdf } = await import("@/lib/print-pdf");
      const bytes = await pagesToPdf(pages, name || "Spreadsheet");
      download(new Blob([bytes as BlobPart], { type: "application/pdf" }), `${(name || "spreadsheet").replace(/[\\/:*?"<>|]+/g, "_")}.pdf`);
    } catch (e) {
      alert("Could not make the PDF: " + (e as Error).message);
    }
  };
  const pdfOfSheet = () => {
    const book = snapshotOf();
    const sheetId = apiRef.current?.getActiveWorkbook?.()?.getActiveSheet?.()?.getSheetId?.();
    if (!book || !sheetId) return;
    const pages = printSheet(book, sheetId, { file: name });
    if (!pages.length) return alert("This sheet is empty.");
    void downloadPdf(pages);
  };
  const setPrintArea = async (clear: boolean) => {
    const cur = readPageSetup(apiRef.current);
    const g = selectionRange();
    if (!cur || (!clear && !g)) return;
    const pageSetup = { ...cur.pageSetup };
    if (clear) delete pageSetup.printArea;
    else pageSetup.printArea = areaText(g!);
    await writePageSetup(apiRef.current, pageSetup);
  };
  const openPrintRef = useRef(() => {});
  openPrintRef.current = () => openPrint();
  const openQuickRef = useRef(() => {});
  openQuickRef.current = () => {
    if (canEditRef.current) openQuick();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        e.stopPropagation();
        openPrintRef.current();
      }
      // Ctrl+Q: Quick Analysis for the selection.
      if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "q") {
        e.preventDefault();
        e.stopPropagation();
        openQuickRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const openPrint = () => {
    const book = snapshotOf();
    const sheetId = apiRef.current?.getActiveWorkbook?.()?.getActiveSheet?.()?.getSheetId?.();
    if (book && sheetId) setPrintJob({ book, sheetId, selection: selectionRange() });
  };
  const pageSetupNow = setupOpen ? readPageSetup(apiRef.current) : null;

  // Whole columns selected → the column outline; anything else → rows.
  const selectionAxis = (): "rows" | "cols" => (apiRef.current?.getActiveWorkbook?.()?.getActiveSheet?.()?.getActiveRange?.()?.getRange?.()?.rangeType === 2 ? "cols" : "rows");

  // Excel's grouping shortcuts.
  useEffect(() => {
    if (!canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      if (!container.current?.contains(document.activeElement) && document.activeElement !== document.body) return;
      e.preventDefault();
      e.stopPropagation();
      void groupSelection(apiRef.current, selectionAxis(), e.key === "ArrowRight" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);

  // ---- Protected sheets and ranges ----
  const unitIdNow = apiRef.current?.getActiveWorkbook?.()?.getId?.();
  const protectionsNow = protectionsIn(protectionStore.current, unitIdNow);
  const sheetsNow: { id: string; name: string }[] = (apiRef.current?.getActiveWorkbook?.()?.getSheets?.() || []).map((sh: any) => ({ id: sh.getSheetId(), name: sh.getSheetName() }));
  const sheetLockedForMe = protectionsNow.some((p) => p.sheetId === activeSheetIdNow && !p.range && !canEditProtection(p, actor));
  const storeProtections = async (list: Protection[]) => {
    if (!unitIdNow) return;
    await saveProtections(apiRef.current, unitIdNow, list);
    scheduleSave();
  };
  /** The password protection the unlock dialog is about: the active sheet's, or the exception range at the selection. */
  const unlockTarget = (kind: "sheet" | "range") => {
    const api = apiRef.current;
    const wb = api?.getActiveWorkbook?.();
    const sh = wb?.getActiveSheet?.();
    const p = protectionsIn(protectionStore.current, wb?.getId?.()).find((x) => x.sheetId === sh?.getSheetId?.() && !x.range);
    if (!p) return null;
    if (kind === "sheet") return hasPassword(sheetPassword(p)) ? { key: p.id, hash: sheetPassword(p)! } : null;
    const g = sh.getActiveRange?.()?.getRange?.();
    const i = (p.except || []).findIndex((x, n) => g && hasPassword(p.exceptPasswords?.[n]) && g.startRow >= x.startRow && g.startRow <= x.endRow && g.startColumn >= x.startColumn && g.startColumn <= x.endColumn);
    return i >= 0 ? { key: `${p.id}#${i}`, hash: p.exceptPasswords![i]! } : null;
  };
  const unlockWith = (kind: "sheet" | "range", password: string): string | null => {
    const t = unlockTarget(kind);
    if (!t) return kind === "sheet" ? "This sheet has no password." : "The selected cell isn't in a range with a password.";
    if (!verifyPassword(password, t.hash)) return "The password you supplied is not correct.";
    unlockedRef.current.add(t.key);
    setUnlocking(null);
    showNotice(kind === "sheet" ? "Sheet unprotected for you until you leave this page." : "Range unlocked for you until you leave this page.");
    return null;
  };
  const openProtect = (kind?: "range" | "sheet") => {
    setProtectOpen(true);
    if (kind) setProtectStart({ kind, n: Date.now() });
  };
  const selectProtection = (p: Protection) => {
    const wb = apiRef.current?.getActiveWorkbook?.();
    const sheet = wb?.getSheetBySheetId?.(p.sheetId);
    if (!sheet) return;
    sheet.activate?.();
    if (p.range) sheet.getRange(p.range.startRow, p.range.startColumn, p.range.endRow - p.range.startRow + 1, p.range.endColumn - p.range.startColumn + 1).activate?.();
  };
  // Protected ranges on the sheet on screen get an outline: amber where this
  // person can't edit, grey where they can.
  const protectionMarks = useRef<{ key: string; ids: string[]; svc: any }>({ key: "", ids: [], svc: null });
  const marksKey = JSON.stringify([activeSheetIdNow, protectionsNow.filter((p) => p.sheetId === activeSheetIdNow && p.range).map((p) => [p.range, canEditProtection(p, actor)])]);
  useEffect(() => {
    const api = sheetApi;
    if (!api) return;
    let cancelled = false;
    (async () => {
      const state = protectionMarks.current;
      if (state.key === marksKey) return;
      if (!state.svc) {
        try {
          const mod = await import("@univerjs/sheets-ui");
          state.svc = (api as any)._injector?.get(mod.IMarkSelectionService);
        } catch {
          return;
        }
      }
      if (cancelled || !state.svc) return;
      for (const id of state.ids) {
        try {
          state.svc.removeShape(id);
        } catch {
          /* gone with its sheet */
        }
      }
      state.ids = [];
      state.key = marksKey;
      const [, ranges] = JSON.parse(marksKey) as [string, [any, boolean][]];
      for (const [g, mine] of ranges) {
        const color = mine ? "#94a3b8" : "#f59e0b";
        const range = { ...g, rangeType: 0 };
        try {
          const id = state.svc.addShape(
            {
              range,
              primary: { actualRow: g.startRow, actualColumn: g.startColumn, ...range },
              style: { strokeWidth: 1.5, stroke: color, strokeDash: 4, fill: mine ? "rgba(148,163,184,0.06)" : "rgba(245,158,11,0.08)", widgets: {}, widgetSize: 0, widgetStrokeWidth: 0, widgetStroke: color, autofillSize: 0, autofillStrokeWidth: 0, autofillStroke: color, hasRowHeader: false, hasColumnHeader: false, expandCornerSize: 0 },
            },
            [],
            9000,
          );
          if (id) state.ids.push(id);
        } catch {
          /* marks are cosmetic */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sheetApi, marksKey]);

  // ---- Sparklines ----
  const sparklinesNow = sparklinesIn(sparklineStore.current, unitIdNow);
  const openSparklines = (type: SparkType) => {
    const g = selectionRange();
    const sheetId = activeSheetIdNow;
    if (!g || !sheetId) return;
    const editing = groupAt(sparklinesNow, sheetId, g.startRow, g.startColumn);
    if (editing) {
      const first = editing.items[0].source;
      const last = editing.items[editing.items.length - 1].source;
      const all = { sheetId: first.sheetId, rect: { startRow: Math.min(first.startRow, last.startRow), endRow: Math.max(first.endRow, last.endRow), startColumn: Math.min(first.startColumn, last.startColumn), endColumn: Math.max(first.endColumn, last.endColumn) } };
      setSparkRequest({ group: editing, type: editing.type, data: sheetRefText(all, sheetsNow, sheetId), location: "" });
      return;
    }
    // Data selected: suggest the column to its right (one sparkline per row).
    const data = { sheetId, rect: g };
    const location = g.endColumn > g.startColumn ? { startRow: g.startRow, endRow: g.endRow, startColumn: g.endColumn + 1, endColumn: g.endColumn + 1 } : null;
    setSparkRequest({ type, data: g.endColumn > g.startColumn || g.endRow > g.startRow ? sheetRefText(data, sheetsNow, sheetId) : "", location: location ? sheetRefText({ sheetId, rect: location }, sheetsNow, sheetId) : "" });
  };
  const applySparklines = async (v: { data: string; location: string; style: Omit<SparklineGroup, "id" | "sheetId" | "items"> }) => {
    const sheetId = activeSheetIdNow;
    const req = sparkRequest;
    if (!sheetId || !unitIdNow || !req) return;
    const data = parseSheetRef(v.data, sheetsNow, sheetId);
    if (!data) return alert("The data range isn't a valid reference.");
    try {
      let groups: SparklineGroup[];
      if (req.group) {
        const old = req.group;
        // Same cells; the data range is spread over them again.
        const rows = old.items.map((it) => it.row);
        const cols = old.items.map((it) => it.column);
        const items = sparklinesFor({ sheetId: data.sheetId, ...data.rect }, { startRow: Math.min(...rows), endRow: Math.max(...rows), startColumn: Math.min(...cols), endColumn: Math.max(...cols) });
        groups = sparklinesNow.map((x) => (x.id === old.id ? { ...v.style, id: old.id, sheetId: old.sheetId, items } : x));
      } else {
        const loc = parseSheetRef(v.location, sheetsNow, sheetId);
        if (!loc || loc.sheetId !== sheetId) return alert("The location range must be on this sheet.");
        if (loc.rect.startRow !== loc.rect.endRow && loc.rect.startColumn !== loc.rect.endColumn) return alert("The location must be a single row or column of cells.");
        const items = sparklinesFor({ sheetId: data.sheetId, ...data.rect }, loc.rect);
        // New sparklines replace any already in those cells.
        groups = [...withoutSparklinesIn(sparklinesNow, sheetId, loc.rect), { ...v.style, id: crypto.randomUUID(), sheetId, items }];
      }
      await saveSparklines(apiRef.current, unitIdNow, groups);
      setSparkRequest(null);
      scheduleSave();
    } catch (e) {
      alert((e as Error).message);
    }
  };
  const clearSparklines = async () => {
    const req = sparkRequest;
    const g = selectionRange();
    if (!unitIdNow || !activeSheetIdNow) return;
    const groups = req?.group ? sparklinesNow.filter((x) => x.id !== req.group!.id) : g ? withoutSparklinesIn(sparklinesNow, activeSheetIdNow, g) : sparklinesNow;
    await saveSparklines(apiRef.current, unitIdNow, groups);
    setSparkRequest(null);
    scheduleSave();
  };

  // ---- Formula auditing and Goal Seek ----
  const activeCell = () => {
    const g = selectionRange();
    return g && activeSheetIdNow ? { sheetId: activeSheetIdNow, row: g.startRow, column: g.startColumn } : null;
  };
  const traceArrows = (direction: "precedents" | "dependents") => {
    const at = activeCell();
    const book = snapshotOf();
    if (!at || !book) return;
    // A new cell starts a new trace.
    const startKey = `${at.sheetId}:${at.row}:${at.column}`;
    const base = traceStart.current === startKey ? trace : NO_TRACE;
    traceStart.current = startKey;
    const { state, added } = traceMore(book, base, at, direction);
    if (!added) showNotice(direction === "precedents" ? "No more cells feed into this formula." : "No more formulas use this cell.");
    setTrace(state);
  };
  const traceStart = useRef("");
  const toggleShowFormulas = () => {
    const on = !showFormulas;
    showFormulasRef.current?.set(on);
    setShowFormulas(on);
    redraw(apiRef.current);
  };
  const toggleShowFormulasRef = useRef(toggleShowFormulas);
  toggleShowFormulasRef.current = toggleShowFormulas;
  useEffect(() => {
    // Ctrl+` switches Show formulas, as in Excel.
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "`" || e.code === "Backquote")) {
        e.preventDefault();
        e.stopPropagation();
        toggleShowFormulasRef.current();
      }
      // Ctrl+E is Flash Fill, as in Excel (not while typing in a cell or a box).
      const t = e.target as HTMLElement | null;
      const inGrid = !!t && !!container.current?.contains(t);
      const typing =
        (!!t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !inGrid) ||
        (!!t?.isContentEditable && !inGrid) ||
        !!apiRef.current?.getActiveWorkbook?.()?.isCellEditing?.();
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "e" || e.key === "E") && !typing) {
        e.preventDefault();
        e.stopPropagation();
        runFlashFillRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const a1 = (c: { sheetId: string; row: number; column: number }) => sheetRefText({ sheetId: c.sheetId, rect: { startRow: c.row, endRow: c.row, startColumn: c.column, endColumn: c.column } }, sheetsNow, activeSheetIdNow || "");
  const openGoalSeek = () => {
    const at = activeCell();
    if (!at) return;
    setGoalSeekRequest({ setCell: a1(at), byChanging: "" });
  };
  const doGoalSeek = async (v: { setCell: string; toValue: number; byChanging: string }) => {
    const sheetId = activeSheetIdNow || "";
    const set = parseSheetRef(v.setCell, sheetsNow, sheetId);
    const by = parseSheetRef(v.byChanging, sheetsNow, sheetId);
    const one = (r: typeof set) => r && r.rect.startRow === r.rect.endRow && r.rect.startColumn === r.rect.endColumn;
    if (!one(set)) throw new Error("Set cell must be a single cell.");
    if (!one(by)) throw new Error("By changing cell must be a single cell.");
    const out = await runGoalSeek(apiRef.current, { sheetId: set!.sheetId, row: set!.rect.startRow, column: set!.rect.startColumn }, v.toValue, { sheetId: by!.sheetId, row: by!.rect.startRow, column: by!.rect.startColumn }, { set: v.setCell.trim().toUpperCase() });
    scheduleSave();
    return { message: out.message, changed: true };
  };

  // ---- Shapes and text boxes ----
  const focusedShape = () => {
    const d = (drawingManagerRef.current?.getFocusDrawings?.() || []).find((x: any) => x.drawingType === DRAWING_DOM && x.componentKey === SHAPE_COMPONENT);
    if (!d) return null;
    const full = drawingManagerRef.current.getDrawingByParam({ unitId: d.unitId, subUnitId: d.subUnitId, drawingId: d.drawingId }) || d;
    return full;
  };
  const editShape = (drawingId?: string) => {
    const unitId = unitIdNow;
    const subUnitId = activeSheetIdNow;
    const d = drawingId && unitId && subUnitId ? drawingManagerRef.current?.getDrawingByParam?.({ unitId, subUnitId, drawingId }) : focusedShape();
    if (!d?.data) return showNotice("Select a shape or text box first.");
    setShapeEdit({ data: d.data, drawing: { unitId: d.unitId, subUnitId: d.subUnitId, drawingId: d.drawingId } });
  };
  const editShapeRef = useRef(editShape);
  editShapeRef.current = editShape;
  useEffect(() => {
    shapeEvents.edit = canEdit ? (id) => editShapeRef.current(id) : null;
    return () => {
      shapeEvents.edit = null;
    };
  }, [canEdit]);
  // Charts print (and go into PDFs) as the chart view draws them.
  useEffect(() => {
    printRenderers.chartSvg = (chart, book, size) => {
      const inner = renderToStaticMarkup(<ChartPreview chart={chart} book={book} />);
      if (!inner.startsWith("<svg")) return null;
      const viewBox = /viewBox="([^"]+)"/.exec(inner)?.[1] || "0 0 360 220";
      const body = inner.replace(/^<svg\b[^>]*>/, "").replace(/<\/svg>$/, "");
      const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const titleH = chart.title ? 30 : 0;
      const title = chart.title ? `<text x="${size.w / 2}" y="21" text-anchor="middle" font-family="Calibri, Carlito, Arial, sans-serif" font-size="15" fill="#1e293b">${esc(chart.title)}</text>` : "";
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size.w}" height="${size.h}" viewBox="0 0 ${size.w} ${size.h}"><rect x="0.5" y="0.5" width="${size.w - 1}" height="${size.h - 1}" fill="#ffffff" stroke="#cbd5e1"/>${title}<svg x="8" y="${titleH + 4}" width="${size.w - 16}" height="${size.h - titleH - 12}" viewBox="${viewBox}">${body}</svg></svg>`;
    };
    return () => {
      printRenderers.chartSvg = null;
    };
  }, []);
  const applyShape = async (data: ShapeData) => {
    const target = shapeEdit?.drawing;
    setShapeEdit(null);
    const api = apiRef.current;
    if (!api) return;
    try {
      if (target) {
        await api.executeCommand("sheet.command.set-sheet-image", { unitId: target.unitId, drawings: [{ ...target, data }] });
      } else {
        // A new shape at the selected cell.
        const fs = api.getActiveWorkbook().getActiveSheet();
        const g = selectionRange() || { startRow: 0, startColumn: 0 };
        const sk = fs.getSkeleton?.();
        const rowTop = (r: number) => (r <= 0 ? 0 : sk?.rowHeightAccumulation?.[r - 1] ?? r * 24);
        const colLeft = (c: number) => (c <= 0 ? 0 : sk?.columnWidthAccumulation?.[c - 1] ?? c * 88);
        const x = colLeft(g.startColumn) + 4;
        const y = rowTop(g.startRow) + 4;
        const size = data.kind === "line" ? { w: 160, h: 60 } : data.kind === "textbox" ? { w: 180, h: 60 } : { w: 160, h: 90 };
        fs.addFloatDomToPosition({ componentKey: SHAPE_COMPONENT, initPosition: { startX: x, startY: y, endX: x + size.w, endY: y + size.h }, data, allowTransform: true }, `shape-${crypto.randomUUID().slice(0, 8)}`);
      }
      scheduleSave();
    } catch (e) {
      alert((e as Error).message || "The shape could not be changed.");
    }
  };
  const deleteShape = async () => {
    const target = shapeEdit?.drawing;
    setShapeEdit(null);
    const d = target && drawingManagerRef.current?.getDrawingByParam?.(target);
    if (!d) return;
    await apiRef.current?.executeCommand("sheet.command.remove-sheet-image", { unitId: d.unitId, drawings: [d] });
    scheduleSave();
  };
  const insertShape = (kind: ShapeKind) => setShapeEdit({ data: newShape(kind) });
  // Format > Group shapes: the selected shapes become one group, which moves and resizes as one.
  const focusedShapes = () =>
    ((drawingManagerRef.current?.getFocusDrawings?.() || []) as any[])
      .filter((x) => x.drawingType === DRAWING_DOM && x.componentKey === SHAPE_COMPONENT)
      .map((d) => drawingManagerRef.current.getDrawingByParam({ unitId: d.unitId, subUnitId: d.subUnitId, drawingId: d.drawingId }) || d)
      .filter((d: any) => d?.data && d.transform);
  const groupSelectedShapes = async () => {
    const list = focusedShapes();
    if (list.length < 2) return showNotice("Select two or more shapes to group (Shift+click).");
    const api = apiRef.current;
    const box = list.reduce(
      (b: any, d: any) => ({ l: Math.min(b.l, d.transform.left), t: Math.min(b.t, d.transform.top), r: Math.max(b.r, d.transform.left + d.transform.width), b: Math.max(b.b, d.transform.top + d.transform.height) }),
      { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity },
    );
    const W = Math.max(1, box.r - box.l);
    const H = Math.max(1, box.b - box.t);
    const data: ShapeData = { ...newShape("group"), fill: null, line: null, children: list.map((d: any) => ({ data: d.data, x: (d.transform.left - box.l) / W, y: (d.transform.top - box.t) / H, w: d.transform.width / W, h: d.transform.height / H })) };
    await api.executeCommand("sheet.command.remove-sheet-image", { unitId: list[0].unitId, drawings: list });
    api.getActiveWorkbook().getActiveSheet().addFloatDomToPosition({ componentKey: SHAPE_COMPONENT, initPosition: { startX: box.l, startY: box.t, endX: box.r, endY: box.b }, data, allowTransform: true }, `shape-${crypto.randomUUID().slice(0, 8)}`);
    scheduleSave();
  };
  const ungroupSelectedShape = async () => {
    const g = focusedShapes().find((d: any) => d.data.kind === "group");
    if (!g) return showNotice("Select a group of shapes first.");
    const api = apiRef.current;
    const t = g.transform;
    await api.executeCommand("sheet.command.remove-sheet-image", { unitId: g.unitId, drawings: [g] });
    const fs = api.getActiveWorkbook().getActiveSheet();
    for (const c of (g.data as ShapeData).children || []) {
      const x = t.left + c.x * t.width;
      const y = t.top + c.y * t.height;
      fs.addFloatDomToPosition({ componentKey: SHAPE_COMPONENT, initPosition: { startX: x, startY: y, endX: x + c.w * t.width, endY: y + c.h * t.height }, data: c.data, allowTransform: true }, `shape-${crypto.randomUUID().slice(0, 8)}`);
    }
    scheduleSave();
  };

  // ---- Scenario Manager ----
  const scenariosNow: Scenario[] = (unitIdNow && scenarioStore.current.get(unitIdNow)) || [];
  const selectionText = () => {
    const g = selectionRange();
    return g ? sheetRefText({ sheetId: activeSheetIdNow || "", rect: g }, sheetsNow, activeSheetIdNow || "") : "";
  };
  const valuesOf = (cells: { row: number; column: number }[]) => {
    const ws = apiRef.current?.getActiveWorkbook?.()?.getActiveSheet?.()?.getSheet?.();
    return cells.map((c) => (ws?.getCellRaw(c.row, c.column)?.v ?? null) as any);
  };
  const customViewsNow: CustomView[] = (unitIdNow && customViewStore.current.get(unitIdNow)) || [];
  const storeCustomViews = async (list: CustomView[]) => {
    if (!unitIdNow) return;
    await saveList(apiRef.current, SET_CUSTOM_VIEWS_MUTATION, unitIdNow, list);
    scheduleSave();
  };
  const docPropsNow = (unitIdNow && docPropsStore.current.get(unitIdNow)) || { custom: [] };
  const lockWorkbook = (password: string): string | null => {
    if (!unitIdNow) return "The workbook isn't open.";
    const props = { ...docPropsNow, workbook: { lockStructure: true, ...(password ? { password: hashPassword(password) } : {}) } };
    void saveDocProps(apiRef.current, unitIdNow, props).then(scheduleSave);
    setWorkbookLock(null);
    showNotice("The workbook's structure is protected.");
    return null;
  };
  const unlockWorkbook = (password: string): string | null => {
    const p = docPropsNow.workbook;
    if (!unitIdNow || !p) return null;
    if (p.password && hasPassword(p.password) && !verifyPassword(password, p.password)) return "The password you supplied is not correct.";
    void saveDocProps(apiRef.current, unitIdNow, { ...docPropsNow, workbook: null }).then(scheduleSave);
    setWorkbookLock(null);
    showNotice("The workbook's structure is no longer protected.");
    return null;
  };
  // The label lives in the workbook (written into .xlsx) and on the document (label_id, for the
  // list and search): the organization's label behind the file's, or none for another company's.
  const labelList = useLabelList();
  const [labelId, setLabelId] = useState<string | null>(initialLabelId);
  const storeLabelId = async (label: SensitivityLabel | null) => {
    if (!docId || !canEdit) return;
    setLabelId(await putDocLabel(docId, label ? { fromFile: { id: label.id, name: label.name }, clearIfUnknown: true } : { labelId: null }));
  };
  const storeLabel = async (label: SensitivityLabel | null) => {
    if (!unitIdNow) return;
    await storeLabelId(label);
    await saveDocProps(apiRef.current, unitIdNow, { ...docPropsNow, label });
    scheduleSave();
  };
  const docLabel = labelId ? labelList?.labels.find((l) => l.id.toLowerCase() === labelId.toLowerCase()) : undefined;
  const shownLabel: SensitivityLabel | null = docPropsNow.label || (docLabel ? { id: docLabel.id, name: docLabel.name, color: docLabel.color } : null);
  const fileLabelId = docPropsNow.label?.id ?? null;
  const labelSynced = useRef(false);
  useEffect(() => {
    if (!docId || !canEdit || !unitIdNow || !labelList) return;
    const first = !labelSynced.current;
    labelSynced.current = true;
    const file = docPropsNow.label;
    if (file) {
      // A label the workbook brought (an opened .xlsx, a co-editor's change) reaches the document.
      const want = orgLabelOf(file, labelList)?.id ?? null;
      if (want !== labelId) void storeLabelId(file).catch(() => {});
    } else if (docLabel && first) {
      // A workbook opened without a label takes the document's (a new one: the organization's default).
      void saveDocProps(apiRef.current, unitIdNow, { ...docPropsNow, label: { id: docLabel.id, name: docLabel.name, method: "Standard", setDate: new Date().toISOString().replace(/\.\d+Z$/, "Z") } }).then(scheduleSave);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, canEdit, unitIdNow, labelList, fileLabelId, labelId]);
  // ---- Form controls ----
  /** The sheet a floating drawing is on. */
  const drawingSheet = (drawingId: string) => {
    const wb = apiRef.current?.getActiveWorkbook?.();
    const unitId = wb?.getId?.();
    if (!wb || !unitId) return null;
    const subUnitId = (wb.getSheets() as any[]).map((x) => x.getSheetId()).find((sid: string) => drawingManagerRef.current?.getDrawingByParam?.({ unitId, subUnitId: sid, drawingId }));
    return subUnitId ? { wb, unitId, subUnitId, sheet: wb.getSheetBySheetId(subUnitId) } : null;
  };
  const refRange = (drawingId: string, ref: string) => {
    const at = drawingSheet(drawingId);
    const sp = splitRef(ref);
    if (!at || !sp) return null;
    const sh = sp.sheet ? at.wb.getSheetByName(sp.sheet) : at.sheet;
    return sh ? sh.getRange(sp.a1) : null;
  };
  formControlBus.canEdit = canEdit;
  formControlBus.read = (drawingId, ref) => {
    try {
      return refRange(drawingId, ref)?.getValues?.() ?? null;
    } catch {
      return null;
    }
  };
  formControlBus.set = (drawingId, data, cell) => {
    const at = drawingSheet(drawingId);
    if (!at) return;
    void (async () => {
      // A check box writes TRUE or FALSE (a logical cell), as in Excel.
      if (data.link) refRange(drawingId, data.link)?.setValue(typeof cell === "boolean" ? { v: cell ? 1 : 0, t: 3 } : cell);
      await apiRef.current.executeCommand("sheet.command.set-sheet-image", { unitId: at.unitId, drawings: [{ unitId: at.unitId, subUnitId: at.subUnitId, drawingId, data }] });
      scheduleSave();
    })().catch((e) => showNotice((e as Error).message));
  };
  formControlBus.pickOption = (drawingId) => {
    const at = drawingSheet(drawingId);
    if (!at) return;
    const me = drawingManagerRef.current.getDrawingByParam({ unitId: at.unitId, subUnitId: at.subUnitId, drawingId });
    const all = Object.values((drawingManagerRef.current.getDrawingData?.(at.unitId, at.subUnitId) || {}) as Record<string, any>).filter((d) => d.componentKey === FORM_CONTROL_COMPONENT && d.data?.kind === "option");
    // Option buttons sharing a cell link (or none) are one group; the cell gets the picked one's number.
    const group = all.filter((d) => (d.data.link || "") === (me?.data?.link || ""));
    const n = group.findIndex((d) => d.drawingId === drawingId) + 1;
    void (async () => {
      if (me?.data?.link) refRange(drawingId, me.data.link)?.setValue(n);
      await apiRef.current.executeCommand("sheet.command.set-sheet-image", { unitId: at.unitId, drawings: group.map((d) => ({ unitId: at.unitId, subUnitId: at.subUnitId, drawingId: d.drawingId, data: { ...d.data, checked: d.drawingId === drawingId } })) });
      scheduleSave();
    })().catch((e) => showNotice((e as Error).message));
  };
  formControlBus.press = (data) => showNotice(data.macro ? `In Excel this button runs the macro ${data.macro}. Macros don't run here.` : "This button has no macro.");
  const insertFormControl = (data: FormControlData) => {
    setFormControlOpen(false);
    const fs = apiRef.current?.getActiveWorkbook?.()?.getActiveSheet?.();
    if (!fs) return;
    const g = selectionRange() || { startRow: 0, startColumn: 0 };
    const sk = fs.getSkeleton?.();
    const x = (g.startColumn <= 0 ? 0 : sk?.columnWidthAccumulation?.[g.startColumn - 1] ?? g.startColumn * 88) + 2;
    const y = (g.startRow <= 0 ? 0 : sk?.rowHeightAccumulation?.[g.startRow - 1] ?? g.startRow * 24) + 2;
    const size = defaultControlSize(data.kind);
    // Option buttons: the first of its group is marked as Excel marks it.
    const first = data.kind === "option" && !Object.values((drawingManagerRef.current?.getDrawingData?.(unitIdNow, activeSheetIdNow) || {}) as Record<string, any>).some((d) => d.componentKey === FORM_CONTROL_COMPONENT && d.data?.kind === "option" && (d.data.link || "") === (data.link || ""));
    fs.addFloatDomToPosition({ componentKey: FORM_CONTROL_COMPONENT, initPosition: { startX: x, startY: y, endX: x + size.w, endY: y + size.h }, data: first ? { ...data, firstButton: true } : data, allowTransform: true }, `control-${crypto.randomUUID().slice(0, 8)}`);
    scheduleSave();
  };

  // ---- Quick Analysis ----
  const openQuick = () => {
    const g = selectionRange();
    if (!g || (g.startRow === g.endRow && g.startColumn === g.endColumn)) return showNotice("Select the data to analyze first.");
    const ref = apiRef.current?.getActiveWorkbook?.()?.getActiveSheet?.()?.getRange?.(g.startRow, g.startColumn, g.endRow - g.startRow + 1, g.endColumn - g.startColumn + 1)?.getA1Notation?.();
    setQuickOpen(ref || "the selection");
  };
  const runQuick = async (a: QuickAction) => {
    const api = apiRef.current;
    const g = selectionRange();
    const sh = api?.getActiveWorkbook?.()?.getActiveSheet?.();
    if (!api || !g || !sh || !unitIdNow || !activeSheetIdNow) throw new Error("Select the data to analyze first.");
    const values = sh.getRange(g.startRow, g.startColumn, g.endRow - g.startRow + 1, g.endColumn - g.startColumn + 1).getValues() as unknown[][];
    const header = hasHeader(values);
    // The numbers, without the header row.
    const body = header ? { ...g, startRow: g.startRow + 1 } : g;
    if (a.tab === "formatting") {
      if (a.kind === "clear") {
        const overlaps = (r: any) => r.startRow <= g.endRow && r.endRow >= g.startRow && r.startColumn <= g.endColumn && r.endColumn >= g.startColumn;
        for (const rule of sh.getConditionalFormattingRules() as any[]) if ((rule.ranges || []).some(overlaps)) sh.deleteConditionalFormattingRule(rule.cfId);
      } else {
        const E = api.Enum;
        const b = sh.newConditionalFormattingRule();
        const rule =
          a.kind === "dataBar"
            ? b.setDataBar({ min: { type: "min" }, max: { type: "max" }, positiveColor: "#638EC6", nativeColor: "#FF0000", isGradient: true, isShowValue: true })
            : a.kind === "colorScale"
              ? b.setColorScale([
                  { index: 0, color: "#F8696B", value: { type: "min" } },
                  { index: 1, color: "#FFEB84", value: { type: "percentile", value: 50 } },
                  { index: 2, color: "#63BE7B", value: { type: "max" } },
                ])
              : a.kind === "iconSet"
                ? b.setIconSet({
                    isShowValue: true,
                    iconConfigs: [
                      { iconType: E.ConditionFormatIconSetTypeEnum.threeArrows, iconId: "0", operator: E.ConditionFormatNumberOperatorEnum.greaterThanOrEqual, value: { type: E.ConditionFormatValueTypeEnum.percent, value: 67 } },
                      { iconType: E.ConditionFormatIconSetTypeEnum.threeArrows, iconId: "1", operator: E.ConditionFormatNumberOperatorEnum.greaterThanOrEqual, value: { type: E.ConditionFormatValueTypeEnum.percent, value: 33 } },
                      { iconType: E.ConditionFormatIconSetTypeEnum.threeArrows, iconId: "2", operator: E.ConditionFormatNumberOperatorEnum.lessThan, value: { type: E.ConditionFormatValueTypeEnum.percent, value: 33 } },
                    ],
                  })
                : a.kind === "greaterThan"
                  ? b.setAverage("greaterThan").setBackground("#FFC7CE").setFontColor("#9C0006")
                  : b.setRank({ isBottom: false, isPercent: true, value: 10 }).setBackground("#FFC7CE").setFontColor("#9C0006");
        sh.addConditionalFormattingRule(rule.setRanges([body]).build());
      }
    } else if (a.tab === "charts") addChart(a.kind);
    else if (a.tab === "totals") {
      for (const c of totalCells(g, a.kind, a.dir, header)) {
        const r = sh.getRange(c.row, c.column);
        if (c.formula) r.setFormula(c.formula);
        else r.setValue(c.value ?? "");
        if (c.bold) r.setFontWeight("bold");
        if (c.percent) r.setNumberFormat("0.0%");
      }
    } else if (a.tab === "tables") {
      if (a.kind === "pivot") await createPivot();
      else {
        const wb = api.getActiveWorkbook();
        const taken = new Set(((wb.getTableList?.() || []) as any[]).map((t) => String(t.name).toLowerCase()));
        let n = 1;
        while (taken.has(`table${n}`)) n++;
        const id = await wb.addTable(activeSheetIdNow, `Table${n}`, g, undefined, { showHeader: true });
        if (!id) throw new Error("A table can't go there (it may overlap another table).");
      }
    } else {
      // One sparkline per row, in the column to the right.
      if (g.endColumn === g.startColumn) throw new Error("Select at least two columns of numbers for sparklines.");
      const loc = { startRow: body.startRow, endRow: body.endRow, startColumn: g.endColumn + 1, endColumn: g.endColumn + 1 };
      const items = sparklinesFor({ sheetId: activeSheetIdNow, ...body }, loc);
      const group: SparklineGroup = { id: crypto.randomUUID(), sheetId: activeSheetIdNow, type: a.kind, ...SPARK_DEFAULTS, items };
      await saveSparklines(api, unitIdNow, [...withoutSparklinesIn(sparklinesNow, activeSheetIdNow, loc), group]);
    }
    scheduleSave();
  };

  // ---- Accessibility ----
  const a11ySnapshot = a11yOpen ? snapshotOf() : null;
  const a11yIssues: A11yIssue[] = a11ySnapshot ? checkAccessibility(a11ySnapshot) : [];
  const goToIssue = (i: A11yIssue) => {
    const wb = apiRef.current?.getActiveWorkbook?.();
    const sh = wb?.getSheetBySheetId?.(i.sheetId);
    if (!sh) return;
    sh.activate?.();
    if (i.ref) sh.getRange(i.ref).activate?.();
    else if (i.target?.kind === "chart") setChartsOpen(true);
  };
  const saveAlt = async (t: A11yTarget, alt: string, decorative: boolean) => {
    const api = apiRef.current;
    const unitId = unitIdNow;
    if (!api || !unitId) return;
    if (t.kind === "chart") {
      const list = chartStore.current.get(unitId)?.sheets[t.sheetId] || [];
      await api.executeCommand("sheet.mutation.set-sheet-charts", { unitId, sheetId: t.sheetId, value: list.map((c) => (c.id === t.id ? { ...c, alt, ...(decorative ? { decorative: true } : { decorative: undefined }) } : c)) });
    } else {
      const d = drawingManagerRef.current?.getDrawingByParam?.({ unitId, subUnitId: t.sheetId, drawingId: t.id });
      if (!d) return;
      const change = t.kind === "shape" ? { data: { ...d.data, alt, decorative: decorative || undefined } } : { description: alt, decorative: decorative || undefined };
      await api.executeCommand("sheet.command.set-sheet-image", { unitId, drawings: [{ unitId, subUnitId: t.sheetId, drawingId: t.id, ...change }] });
    }
    scheduleSave();
    refreshCharts((v) => v + 1);
  };
  const storeScenarios = async (list: Scenario[]) => {
    if (!unitIdNow) return;
    await saveScenarios(apiRef.current, unitIdNow, list);
    scheduleSave();
  };
  const scenarioSummary = async (resultText: string) => {
    const results = resultText.trim() ? parseCellList(resultText.replace(/^.*!/, ""), 256) : [];
    if (!results) throw new Error("Result cells must be cell references, such as C5,C6.");
    const name = await runScenarioSummary(apiRef.current, scenariosNow.filter((s) => s.sheetId === activeSheetIdNow), results);
    scheduleSave();
    return name;
  };

  // ---- Data tables and Solver ----
  const dataTablesNow: DataTableDef[] = (unitIdNow && dataTableStore.current.get(unitIdNow)) || [];
  const openDataTable = () => {
    const g = selectionRange();
    if (!g || !activeSheetIdNow) return;
    setDataTableRange({ sheetId: activeSheetIdNow, rect: g, text: sheetRefText({ sheetId: activeSheetIdNow, rect: g }, sheetsNow, activeSheetIdNow) });
  };
  const applyDataTable = async (v: { rowInput: string; colInput: string }) => {
    const at = dataTableRange;
    if (!at || !unitIdNow) return;
    const cell = (text: string, what: string) => {
      if (!text.trim()) return null;
      const r = parseSheetRef(text, sheetsNow, at.sheetId);
      if (!r || r.rect.startRow !== r.rect.endRow || r.rect.startColumn !== r.rect.endColumn) throw new Error(`${what} must be a single cell.`);
      if (r.sheetId !== at.sheetId) throw new Error("Input cell reference is not valid: it must be on the same sheet as the table.");
      return { row: r.rect.startRow, column: r.rect.startColumn };
    };
    const def: DataTableDef = { id: `dt-${crypto.randomUUID().slice(0, 8)}`, sheetId: at.sheetId, range: at.rect, rowInput: cell(v.rowInput, "Row input cell"), colInput: cell(v.colInput, "Column input cell") };
    checkDataTable(def);
    const g = def.range;
    const overlaps = (d: DataTableDef) => d.sheetId === def.sheetId && d.range.startRow <= g.endRow && g.startRow <= d.range.endRow && d.range.startColumn <= g.endColumn && g.startColumn <= d.range.endColumn;
    const rest = dataTablesNow.filter((d) => !overlaps(d));
    await dataTablesRef.current?.refresh([def]);
    await saveDataTables(apiRef.current, unitIdNow, [...rest, def]);
    scheduleSave();
  };
  const refreshDataTables = async () => {
    try {
      const n = (await dataTablesRef.current?.refresh()) || 0;
      showNotice(`Data tables recalculated (${n} ${n === 1 ? "pass" : "passes"}).`);
      scheduleSave();
    } catch (e) {
      showNotice((e as Error).message);
    }
  };
  const removeDataTable = async () => {
    const at = activeCell();
    if (!at || !unitIdNow) return;
    const hit = dataTablesNow.find((d) => d.sheetId === at.sheetId && at.row >= d.range.startRow && at.row <= d.range.endRow && at.column >= d.range.startColumn && at.column <= d.range.endColumn);
    if (!hit) return showNotice("Select a cell of a data table first.");
    await saveDataTables(apiRef.current, unitIdNow, dataTablesNow.filter((d) => d !== hit));
    showNotice("The data table's results are now plain values.");
    scheduleSave();
  };
  const solverModels: SolverModel[] = (unitIdNow && solverStore.current.get(unitIdNow)) || [];
  const openSolver = () => {
    if (!activeSheetIdNow) return;
    const m = solverModels.find((x) => x.sheetId === activeSheetIdNow);
    if (m) return setSolverOpen(m);
    const at = activeCell();
    setSolverOpen({ ...newModel(activeSheetIdNow), objective: at ? { row: at.row, column: at.column } : null });
  };
  const saveSolverModel = async (m: SolverModel) => {
    if (!unitIdNow) return;
    const old = solverModels.find((x) => x.sheetId === m.sheetId);
    if (old && JSON.stringify(old) === JSON.stringify(m)) return;
    await saveSolverModels(apiRef.current, unitIdNow, [...solverModels.filter((x) => x.sheetId !== m.sheetId), m]);
    scheduleSave();
  };
  const solve = async (m: SolverModel) => {
    const out = await runSolver(apiRef.current, m);
    solverOutcome.current = out;
    return { status: out.status, message: out.message, objective: out.objective, values: out.values.map((v) => ({ label: areaRef({ startRow: v.cell.row, endRow: v.cell.row, startColumn: v.cell.column, endColumn: v.cell.column }), value: v.value })) };
  };
  const keepSolved = async () => {
    const out = solverOutcome.current;
    if (!out || !solverOpen) return;
    await keepSolution(apiRef.current, solverOpen.sheetId, out.values);
    scheduleSave();
  };

  // ---- Get data ----
  const queriesNow: QueryDef[] = (unitIdNow && queryStore.current.get(unitIdNow)) || [];
  const openGetData = () => {
    const at = activeCell();
    setGetDataOpen(at ? a1(at) : "A1");
  };
  const storeQuery = async (q: QueryDef) => {
    if (!unitIdNow) return;
    const list = (queryStore.current.get(unitIdNow) || []).filter((x) => x.id !== q.id);
    await saveQueries(apiRef.current, unitIdNow, [...list, q]);
    scheduleSave();
  };
  const loadQuery = async (v: GetDataResult, text: string) => {
    const api = apiRef.current;
    const grid = gridFor(text, v.source.format, v.steps);
    const wb = api.getActiveWorkbook();
    let sheetId: string;
    let anchor = { row: 0, column: 0 };
    if (v.destination.kind === "new") {
      const names = new Set((wb.getSheets() as any[]).map((x) => x.getSheetName().toLowerCase()));
      let title = v.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || "Query";
      for (let n = 2; names.has(title.toLowerCase()); n++) title = `${v.name.slice(0, 26)} (${n})`;
      const sheet = wb.insertSheet(title);
      sheetId = sheet.getSheetId();
    } else {
      const ref = parseSheetRef(v.destination.text, sheetsNow, activeSheetIdNow || "");
      if (!ref) throw new Error("The destination must be a cell, such as A1.");
      sheetId = ref.sheetId;
      anchor = { row: ref.rect.startRow, column: ref.rect.startColumn };
      const clash = queriesNow.find((q) => q.sheetId === sheetId && q.size && anchor.row < q.anchor.row + q.size.rows && q.anchor.row < anchor.row + grid.length && anchor.column < q.anchor.column + q.size.columns && q.anchor.column < anchor.column + (grid[0]?.length || 1));
      if (clash) throw new Error(`That would overlap the data of ${clash.name}.`);
    }
    const q: QueryDef = { id: `q-${crypto.randomUUID().slice(0, 8)}`, name: v.name, sheetId, anchor, source: v.source, steps: v.steps };
    await storeQuery(await writeQuery(api, q, grid));
    showNotice(`${v.name}: ${Math.max(0, grid.length - (v.steps.headers ? 1 : 0))} rows loaded.`);
  };
  const refreshQuery = async (q: QueryDef, fileText?: string) => {
    await storeQuery(await runQuery(apiRef.current, q, fileText));
  };
  const refreshAllQueries = async () => {
    const web = queriesNow.filter((q) => !q.foreign && q.source.kind === "web");
    const failed: string[] = [];
    for (const q of web)
      try {
        await refreshQuery(q);
      } catch (e) {
        failed.push(`${q.name}: ${(e as Error).message}`);
      }
    const files = queriesNow.filter((q) => !q.foreign && q.source.kind === "file").length;
    showNotice(failed.length ? failed.join(" ") : `${web.length} ${web.length === 1 ? "query" : "queries"} refreshed${files ? `; refresh file queries from Queries and connections` : ""}.`);
  };
  const deleteQuery = async (q: QueryDef) => {
    if (!unitIdNow) return;
    await saveQueries(apiRef.current, unitIdNow, queriesNow.filter((x) => x.id !== q.id));
    scheduleSave();
  };

  // ---- Automate (scripts) ----
  const scriptsNow: Script[] = (unitIdNow && scriptStore.current.get(unitIdNow)) || [];
  const saveScript = async (sc: Script) => {
    if (!unitIdNow) return;
    await saveScripts(apiRef.current, unitIdNow, [...scriptsNow.filter((x) => x.id !== sc.id), sc]);
    scheduleSave();
  };
  const deleteScript = async (id: string) => {
    if (!unitIdNow) return;
    await saveScripts(apiRef.current, unitIdNow, scriptsNow.filter((x) => x.id !== id));
    scheduleSave();
  };
  const runScript = async (code: string) => {
    const api = apiRef.current;
    const result = await runScriptLive(api, code, { dataTables: (unitIdNow && dataTableStore.current.get(unitIdNow)) || [] });
    let applied = 0;
    if (result.ok) {
      applied = await applyOps(api, result.ops);
      if (applied) scheduleSave();
    }
    const message = result.ok ? `Script finished: ${applied} ${applied === 1 ? "change" : "changes"}.${result.returned !== undefined ? ` Returned ${JSON.stringify(result.returned)}.` : ""}` : `Script failed, nothing was changed. ${result.error}`;
    return { ok: result.ok, message, logs: result.logs };
  };
  const toggleRecording = () => {
    const rec = recorderRef.current;
    if (!rec) return null;
    if (rec.recording) {
      setRecording(false);
      return rec.stop();
    }
    rec.start();
    setRecording(true);
    return null;
  };

  // ---- Slicers and timelines ----
  slicerBus.canEdit = canEdit;
  slicerBus.pivots = workbookPivots;
  slicerBus.change = (drawingId, data) => void changeSlicer(drawingId, data);
  const changeSlicer = async (drawingId: string, data: SlicerData) => {
    const api = apiRef.current;
    const unitId = unitIdNow;
    const wb = api?.getActiveWorkbook?.();
    if (!api || !unitId || !wb) return;
    const subUnitId = (wb.getSheets() as any[]).map((x) => x.getSheetId()).find((sid: string) => drawingManagerRef.current?.getDrawingByParam?.({ unitId, subUnitId: sid, drawingId }));
    if (!subUnitId) return;
    try {
      await api.executeCommand("sheet.command.set-sheet-image", { unitId, drawings: [{ unitId, subUnitId, drawingId, data }] });
      await applySlicer(api, data, applyPivot);
      scheduleSave();
    } catch (e) {
      showNotice((e as Error).message);
    }
  };
  const openSlicers = (kind: "slicer" | "timeline") => {
    const sources = slicerSources(apiRef.current, workbookPivots());
    const at = activeCell();
    const ws = apiRef.current?.getActiveWorkbook?.()?.getActiveSheet?.();
    const table = at && ws?.getTableByCell?.(at.row, at.column);
    const pivot = at && workbookPivots().find((p) => p.target.sheetId === at.sheetId && p.lastSize && at.row >= p.target.row && at.row < p.target.row + p.lastSize.rows && at.column >= p.target.column && at.column < p.target.column + p.lastSize.columns);
    setSlicerInsert({ kind, sources, initial: table ? `table:${table.id}` : pivot ? `pivot:${pivot.id}` : undefined });
  };
  const dateFields = (s: FieldSource) =>
    s.fields.filter((f) => {
      const col = fieldValues(apiRef.current, s.kind === "table" ? { type: "table", tableId: s.id, name: s.name } : { type: "pivot", pivotId: s.id, name: s.name }, f);
      const vals = (col?.values || []).filter((v) => v != null && v !== "");
      return vals.length > 0 && vals.every((v) => asDate(v)) && vals.some((v) => typeof v !== "number" || v > 3000);
    });
  const insertSlicers = (kind: "slicer" | "timeline", source: FieldSource, fields: string[]) => {
    const api = apiRef.current;
    const fs = api?.getActiveWorkbook?.()?.getActiveSheet?.();
    if (!fs) return;
    const g = selectionRange() || { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 };
    const sk = fs.getSkeleton?.();
    const rowTop = (r: number) => (r <= 0 ? 0 : sk?.rowHeightAccumulation?.[r - 1] ?? r * 24);
    const colLeft = (c: number) => (c <= 0 ? 0 : sk?.columnWidthAccumulation?.[c - 1] ?? c * 88);
    let x = colLeft(g.endColumn + 1) + 16;
    const y = rowTop(g.startRow) + 4;
    for (const field of fields) {
      const data: SlicerData =
        kind === "timeline"
          ? { kind, caption: field, source: source.kind === "table" ? { type: "table", tableId: source.id, name: source.name } : { type: "pivot", pivotId: source.id, name: source.name }, field, period: null, level: "months" }
          : { kind, caption: field, source: source.kind === "table" ? { type: "table", tableId: source.id, name: source.name } : { type: "pivot", pivotId: source.id, name: source.name }, field, selected: null, columns: 1 };
      const size = kind === "timeline" ? { w: 380, h: 116 } : { w: 160, h: 200 };
      fs.addFloatDomToPosition({ componentKey: SLICER_COMPONENT, initPosition: { startX: x, startY: y, endX: x + size.w, endY: y + size.h }, data, allowTransform: true }, `slicer-${crypto.randomUUID().slice(0, 8)}`);
      x += size.w + 12;
    }
    scheduleSave();
  };

  const menus: Menu[] = [
    {
      label: "File",
      items: [
        { label: "New spreadsheet", onClick: () => newDoc("sheet") },
        { label: "New document", onClick: () => newDoc("doc") },
        { label: "New presentation", onClick: () => newDoc("slide") },
        { divider: true },
        { label: "Open (.xlsx, .xls, .csv)…", onClick: () => fileInput.current?.click(), disabled: !canEdit },
        { label: "Download as Excel (.xlsx)", onClick: onExport },
        { label: "Download as CSV (current sheet)", onClick: onExportCsv },
        { divider: true },
        { label: "Share…", onClick: () => setShareOpen(true), disabled: !canEdit },
        { label: "Version history", onClick: () => setVersionsOpen(true), disabled: !docId },
        { label: "Sensitivity…", onClick: () => setSensitivityOpen(true) },
        { label: "Download as PDF", onClick: pdfOfSheet },
        { divider: true },
        { label: "Page setup…", onClick: () => setSetupOpen(true) },
        { label: "Set print area to selection", onClick: () => void setPrintArea(false), disabled: !canEdit },
        { label: "Clear print area", onClick: () => void setPrintArea(true), disabled: !canEdit },
        { label: "Print…", onClick: () => openPrint(), shortcut: "Ctrl+P" },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", onClick: () => apiRef.current?.undo?.(), shortcut: "Ctrl+Z", disabled: !canEdit },
        { label: "Redo", onClick: () => apiRef.current?.redo?.(), shortcut: "Ctrl+Y", disabled: !canEdit },
        { divider: true },
        { label: "Find…", onClick: () => cmd("ui.operation.open-find-dialog"), shortcut: "Ctrl+F" },
        { label: "Find and replace…", onClick: () => cmd("ui.operation.open-replace-dialog"), shortcut: "Ctrl+H", disabled: !canEdit },
      ],
    },
    {
      label: "Insert",
      items: [
        { label: "Row above", onClick: () => sheetOp((s) => s.insertRows(s.getActiveRange().getRow(), 1)), disabled: !canEdit },
        { label: "Row below", onClick: () => sheetOp((s) => s.insertRowAfter(s.getActiveRange().getRow())), disabled: !canEdit },
        { label: "Column left", onClick: () => sheetOp((s) => s.insertColumns(s.getActiveRange().getColumn(), 1)), disabled: !canEdit },
        { label: "Column right", onClick: () => sheetOp((s) => s.insertColumnAfter(s.getActiveRange().getColumn())), disabled: !canEdit },
        { divider: true },
        { label: "Link…", onClick: () => cmd("sheet.operation.insert-hyper-link-toolbar"), shortcut: "Ctrl+K", disabled: !canEdit },
        { label: "Note", onClick: () => cmd("sheet.operation.add-note-popup"), disabled: !canEdit },
        { label: "Comment", onClick: () => cmd("sheet.operation.show-comment-modal"), shortcut: "Ctrl+Alt+M", disabled: !docId || role === "viewer" },
        { divider: true },
        { label: "Column chart", onClick: () => addChart("column"), disabled: !canEdit },
        { label: "Bar chart", onClick: () => addChart("bar"), disabled: !canEdit },
        { label: "Line chart", onClick: () => addChart("line"), disabled: !canEdit },
        { label: "Pie chart", onClick: () => addChart("pie"), disabled: !canEdit },
        { divider: true },
        { label: "Pivot table…", onClick: () => void createPivot(), disabled: !canEdit },
        { label: "Analyze Data…", onClick: openAnalyze },
        { label: "Quick Analysis…", onClick: openQuick, shortcut: "Ctrl+Q", disabled: !canEdit },
        { label: "Pivot chart", onClick: () => void addPivotChart(), disabled: !canEdit || !pivotsNow.length },
        { label: "Slicer…", onClick: () => openSlicers("slicer"), disabled: !canEdit },
        { label: "Timeline…", onClick: () => openSlicers("timeline"), disabled: !canEdit },
        { divider: true },
        { label: "Shape…", onClick: () => insertShape("rect"), disabled: !canEdit },
        { label: "Form control…", onClick: () => setFormControlOpen(true), disabled: !canEdit },
        { label: "Text box…", onClick: () => insertShape("textbox"), disabled: !canEdit },
        { divider: true },
        { label: "Line sparkline…", onClick: () => openSparklines("line"), disabled: !canEdit },
        { label: "Column sparkline…", onClick: () => openSparklines("column"), disabled: !canEdit },
        { label: "Win/Loss sparkline…", onClick: () => openSparklines("winloss"), disabled: !canEdit },
      ],
    },
    {
      label: "Format",
      items: [
        { label: "Bold", onClick: () => fmt((r) => r.setFontWeight("bold")), shortcut: "Ctrl+B", disabled: !canEdit },
        { label: "Italic", onClick: () => fmt((r) => r.setFontStyle("italic")), shortcut: "Ctrl+I", disabled: !canEdit },
        { label: "Underline", onClick: () => fmt((r) => r.setFontLine("underline")), shortcut: "Ctrl+U", disabled: !canEdit },
        { label: "Clear formatting", onClick: () => fmt((r) => { r.setFontWeight("normal"); r.setFontStyle("normal"); r.setFontLine("none"); }), disabled: !canEdit },
        { divider: true },
        { label: "Align left", onClick: () => fmt((r) => r.setHorizontalAlignment("left")), disabled: !canEdit },
        { label: "Align center", onClick: () => fmt((r) => r.setHorizontalAlignment("center")), disabled: !canEdit },
        { label: "Align right", onClick: () => fmt((r) => r.setHorizontalAlignment("right")), disabled: !canEdit },
        { divider: true },
        { label: "Number: Currency", onClick: () => fmt((r) => r.setNumberFormat("$#,##0.00")), disabled: !canEdit },
        { label: "Number: Percent", onClick: () => fmt((r) => r.setNumberFormat("0.00%")), disabled: !canEdit },
        { label: "Number: 1,000.00", onClick: () => fmt((r) => r.setNumberFormat("#,##0.00")), disabled: !canEdit },
        { label: "Number: Plain text", onClick: () => fmt((r) => r.setNumberFormat("@")), disabled: !canEdit },
        { divider: true },
        // value 1 = new rule for the selection, 2 = manage the sheet's rules.
        { label: "Cell styles…", onClick: () => setStylesOpen(true), disabled: !canEdit },
        { label: "Theme…", onClick: () => setThemeOpen(true) },
        { divider: true },
        { label: "Format shape…", onClick: () => editShape(), disabled: !canEdit },
        { label: "Group shapes", onClick: () => void groupSelectedShapes(), disabled: !canEdit },
        { label: "Ungroup shapes", onClick: () => void ungroupSelectedShape(), disabled: !canEdit },
        { label: "Conditional formatting…", onClick: () => cmd("sheet.operation.open.conditional.formatting.panel", { value: 2 }), disabled: !canEdit },
      ],
    },
    {
      label: "Data",
      items: [
        { label: "Get data…", onClick: openGetData, disabled: !canEdit },
        { label: "Refresh all queries", onClick: () => void refreshAllQueries(), disabled: !canEdit || !queriesNow.some((q) => !q.foreign && q.source.kind === "web") },
        { label: "Queries and connections…", onClick: () => setQueriesOpen(true) },
        { label: "Edit links…", onClick: () => setLinksOpen(true), disabled: !docId },
        { divider: true },
        { label: "Sort range A → Z", onClick: () => cmd("sheet.command.sort-range-asc"), disabled: !canEdit },
        { label: "Sort range Z → A", onClick: () => cmd("sheet.command.sort-range-desc"), disabled: !canEdit },
        { label: "Custom sort…", onClick: () => cmd("sheet.command.sort-range-custom"), disabled: !canEdit },
        { divider: true },
        { label: "Create / remove filter", onClick: () => cmd("sheet.command.smart-toggle-filter"), shortcut: "Ctrl+Shift+L", disabled: !canEdit },
        { label: "Data validation…", onClick: () => cmd("data-validation.operation.open-validation-panel", { isAdd: false }), disabled: !canEdit },
        { divider: true },
        { label: "Remove duplicates…", onClick: openRemoveDuplicates, disabled: !canEdit },
        { label: "Split text to columns…", onClick: openSplitText, disabled: !canEdit },
        { label: "Flash Fill", onClick: runFlashFill, shortcut: "Ctrl+E", disabled: !canEdit },
        { label: "Refresh pivot tables", onClick: () => void refreshPivots(), disabled: !canEdit || !pivotsNow.length },
        { divider: true },
        { label: "Group rows", onClick: () => void groupSelection(apiRef.current, "rows", 1), shortcut: "Alt+Shift+→", disabled: !canEdit },
        { label: "Ungroup rows", onClick: () => void groupSelection(apiRef.current, "rows", -1), shortcut: "Alt+Shift+←", disabled: !canEdit },
        { label: "Group columns", onClick: () => void groupSelection(apiRef.current, "cols", 1), disabled: !canEdit },
        { label: "Ungroup columns", onClick: () => void groupSelection(apiRef.current, "cols", -1), disabled: !canEdit },
        { label: "Collapse group", onClick: () => void toggleGroupAtSelection(apiRef.current, selectionAxis(), true), disabled: !canEdit },
        { label: "Expand group", onClick: () => void toggleGroupAtSelection(apiRef.current, selectionAxis(), false), disabled: !canEdit },
        { divider: true },
        { label: "Goal Seek…", onClick: openGoalSeek, disabled: !canEdit },
        { label: "Scenario Manager…", onClick: () => setScenariosOpen(true) },
        { label: "Data table…", onClick: openDataTable, disabled: !canEdit },
        { label: "Recalculate data tables", onClick: () => void refreshDataTables(), disabled: !canEdit || !dataTablesNow.length },
        { label: "Remove data table", onClick: () => void removeDataTable(), disabled: !canEdit || !dataTablesNow.length },
        { label: "Solver…", onClick: openSolver },
        { divider: true },
        { label: "Protect range…", onClick: () => openProtect("range"), disabled: !isOwner || !docId },
        { label: "Protect sheet…", onClick: () => openProtect("sheet"), disabled: !isOwner || !docId },
        { label: "Protected sheets and ranges", onClick: () => openProtect() },
        { label: "Unprotect sheet…", onClick: () => setUnlocking("sheet") },
        { label: "Unlock range…", onClick: () => setUnlocking("range") },
      ],
    },
    {
      label: "Formulas",
      items: [
        { label: "Trace precedents", onClick: () => traceArrows("precedents") },
        { label: "Trace dependents", onClick: () => traceArrows("dependents") },
        { label: "Remove arrows", onClick: () => setTrace(NO_TRACE), disabled: !trace.arrows.length },
        { divider: true },
        { label: "Show formulas", onClick: toggleShowFormulas, checked: showFormulas, shortcut: "Ctrl+`" },
        { divider: true },
        { label: "Evaluate Formula…", onClick: openEvaluate },
        { label: "Watch Window", onClick: () => setWatchOpen((open) => !open), checked: watchOpen },
        { divider: true },
        { label: "Calculation options…", onClick: () => setCalcOpen(true) },
        { divider: true },
        { label: "Write a formula…", onClick: openFormulaHelper, disabled: !canEdit },
      ],
    },
    {
      label: "Automate",
      items: [
        { label: "Scripts…", onClick: () => setScriptsOpen(true) },
        { label: recording ? "Stop recording" : "Record actions", onClick: () => {
          const code = toggleRecording();
          setScriptsOpen(true);
          if (code != null) setRecorded({ code, n: Date.now() });
        }, disabled: !canEdit },
      ],
    },
    {
      label: "Review",
      items: [
        { label: "Check Accessibility", onClick: () => setA11yOpen((open) => !open), checked: a11yOpen },
        docPropsNow.workbook?.lockStructure
          ? { label: "Unprotect Workbook…", onClick: () => setWorkbookLock("unprotect"), disabled: !canEdit }
          : { label: "Protect Workbook…", onClick: () => setWorkbookLock("protect"), disabled: !canEdit },
        { label: "Comments", onClick: () => cmd("sheet.operation.toggle-comment-panel"), disabled: !docId },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Freeze first row", onClick: () => cmd("sheet.command.set-first-row-frozen"), disabled: !canEdit },
        { label: "Freeze first column", onClick: () => cmd("sheet.command.set-first-column-frozen"), disabled: !canEdit },
        { label: "Freeze up to selected cell", onClick: () => cmd("sheet.command.set-selection-frozen"), disabled: !canEdit },
        { label: "Unfreeze", onClick: () => cmd("sheet.command.cancel-frozen"), disabled: !canEdit },
        { divider: true },
        { label: "Split top and bottom", onClick: () => openSplit("rows"), disabled: !docId, checked: split?.dir === "rows" },
        { label: "Split side by side", onClick: () => openSplit("columns"), disabled: !docId, checked: split?.dir === "columns" },
        { label: "Remove split", onClick: () => setSplit(null), disabled: !split },
        { divider: true },
        { label: "Gridlines", onClick: () => cmd("sheet.command.toggle-gridlines"), disabled: !canEdit },
        { label: "Custom Views…", onClick: () => setCustomViewsOpen(true) },
        { label: "Comments", onClick: () => cmd("sheet.operation.toggle-comment-panel"), disabled: !docId },
        { label: "Charts panel", onClick: () => setChartsOpen((open) => !open) },
        { label: "Pivot table panel", onClick: () => setPivotOpen((open) => !open) },
        { label: "Full screen", onClick: () => document.documentElement.requestFullscreen?.() },
      ],
    },
    { label: "Help", items: [{ label: "About SynergyDocs", onClick: () => alert("SynergyDocs — spreadsheets on the Synergy platform. The ribbon below has the full toolset (formulas, data, more formatting).") }] },
  ];
  const activeCharts = activeChartSheet()?.charts || [];
  const chartSheetNow = unitIdNow && activeSheetIdNow && chartStore.current.get(unitIdNow)?.chartSheets?.includes(activeSheetIdNow) ? (chartStore.current.get(unitIdNow)?.sheets[activeSheetIdNow] || [])[0] : undefined;
  const chartSnapshot = chartsOpen || chartSheetNow ? snapshotOf() : null;

  // AppTitleBar (shared Google chrome) on top; Univer's own ribbon handles
  // formatting/formulas/data below. flex-1 gives Univer a concrete height.
  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-slate-200 no-print">
        <AppTitleBar
          docId={docId || ""}
          icon="▦"
          initialTitle={title}
          title={name}
          initialStarred={starred}
          role={role}
          meEmail={meEmail}
          menus={menus}
          onTitle={onRename}
          shareOpen={shareOpen}
          onShareOpen={setShareOpen}
          rightExtra={
            <span className="flex items-center gap-2 text-xs text-slate-400">
              <button type="button" onClick={() => setChartsOpen((open) => !open)} className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100">Charts{activeCharts.length ? ` ${activeCharts.length}` : ""}</button>
              {participants.length > 1 && (
                <span className="flex items-center -space-x-1.5 mr-1">
                  {participants.slice(0, 5).map((p) => (
                    <span
                      key={p.email}
                      title={p.self ? `${p.name} (you)` : p.name}
                      className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold text-white ring-2 ring-white uppercase"
                      style={{ backgroundColor: p.color }}
                    >
                      {(p.name || p.email).trim().charAt(0)}
                    </span>
                  ))}
                  {participants.length > 5 && (
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold text-slate-600 bg-slate-200 ring-2 ring-white">
                      +{participants.length - 5}
                    </span>
                  )}
                </span>
              )}
              {docId && status !== "local" && (
                <span className="flex items-center gap-1" title={`Live collaboration: ${status}`}>
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full ${
                      status === "connected" ? "bg-emerald-500" : status === "connecting" ? "bg-amber-400" : "bg-slate-300"
                    }`}
                  />
                  {status === "connected" && peers > 1 ? `${peers} online` : status === "offline" ? "Offline" : "Live"}
                </span>
              )}
              {shownLabel && <LabelChip label={shownLabel} list={labelList} onClick={() => setSensitivityOpen(true)} />}
              {sheetLockedForMe && canEdit && (
                <button type="button" onClick={() => openProtect()} className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-amber-800" title="Only the owner and the people they chose can change this sheet">
                  Protected sheet
                </button>
              )}
              {/* The role pill beside Share already says "View only" or "Can comment". */}
              <span>{busy || (!canEdit ? "" : save === "saving" ? "Saving…" : save === "saved" ? "Saved" : "")}</span>
            </span>
          }
        />
      </div>
      <input ref={fileInput} type="file" accept=".xlsx,.xlsm,.xls,.ods,.csv" className="hidden" onChange={onImport} />
      {dedupe && <RemoveDuplicatesDialog request={dedupe} onClose={() => setDedupe(null)} onApply={applyRemoveDuplicates} />}
      {printJob && (
        <PrintDialog
          book={printJob.book}
          sheetId={printJob.sheetId}
          selection={printJob.selection}
          title={name || "Spreadsheet"}
          onPdf={downloadPdf}
          onPageSetup={() => {
            setPrintJob(null);
            setSetupOpen(true);
          }}
          onClose={() => setPrintJob(null)}
        />
      )}
      {setupOpen && pageSetupNow && (
        <PageSetupDialog
          initial={pageSetupNow.pageSetup}
          initialHeaderFooter={pageSetupNow.headerFooter}
          selection={selectionRange}
          canEdit={canEdit}
          onSave={(ps, hf) => {
            setSetupOpen(false);
            void writePageSetup(apiRef.current, ps, hf);
          }}
          onClose={() => setSetupOpen(false)}
        />
      )}
      {sparkRequest && <SparklineDialog request={sparkRequest} onClose={() => setSparkRequest(null)} onApply={(v) => void applySparklines(v)} onClear={sparkRequest.group ? () => void clearSparklines() : undefined} />}
      {shapeEdit && <ShapeDialog initial={shapeEdit.data} editing={!!shapeEdit.drawing} onClose={() => setShapeEdit(null)} onApply={(d) => void applyShape(d)} onDelete={shapeEdit.drawing ? () => void deleteShape() : undefined} />}
      {scenariosOpen && activeSheetIdNow && (
        <ScenarioDialog
          scenarios={scenariosNow}
          sheetId={activeSheetIdNow}
          canEdit={canEdit}
          selection={selectionText}
          valuesOf={valuesOf}
          onSave={storeScenarios}
          onShow={async (sc) => {
            await showScenario(apiRef.current, sc);
            scheduleSave();
          }}
          onSummary={scenarioSummary}
          onClose={() => setScenariosOpen(false)}
        />
      )}
      {slicerInsert && (
        <InsertSlicerDialog
          kind={slicerInsert.kind}
          sources={slicerInsert.sources}
          initial={slicerInsert.initial}
          dateFields={dateFields}
          onInsert={(src, fields) => insertSlicers(slicerInsert.kind, src, fields)}
          onClose={() => setSlicerInsert(null)}
        />
      )}
      {getDataOpen != null && <GetDataDialog anchor={getDataOpen} canEdit={canEdit} onFetch={fetchWeb} onLoad={loadQuery} onClose={() => setGetDataOpen(null)} />}
      {analyzeOpen && <AnalyzeDataDialog analysis={analyzeOpen.analysis} range={analyzeOpen.range} table={analyzeOpen.table} canEdit={canEdit} onInsert={insertSuggestion} onClose={() => setAnalyzeOpen(null)} />}
      {formulaHelp && <FormulaHelperDialog context={{ sheet: formulaHelp.sheet, cell: formulaHelp.cell, range: formulaHelp.range, columns: formulaHelp.columns, sample: formulaHelp.sample }} canEdit={canEdit} onInsert={insertHelperFormula} onClose={() => setFormulaHelp(null)} />}
      {linksOpen && (
        <LinksDialog
          links={linksOf(linkStore.current, apiRef.current?.getActiveWorkbook?.()?.getId?.())}
          canEdit={canEdit}
          sheets={linkableSheetsFor}
          onAdd={(doc) => addLink(apiRef.current, linkStore.current, doc).finally(() => scheduleSave())}
          onUpdate={(names) => updateLinks(apiRef.current, linkStore.current, names).finally(() => scheduleSave())}
          onChangeSource={async (name, doc) => {
            await addLink(apiRef.current, linkStore.current, doc, name);
            scheduleSave();
          }}
          onBreak={async (name) => {
            await breakLink(apiRef.current, linkStore.current, name);
            scheduleSave();
          }}
          onClose={() => setLinksOpen(false)}
        />
      )}
      {stylesOpen && (
        <CellStylesDialog
          theme={themeOf(themeStore.current, apiRef.current?.getActiveWorkbook?.()?.getId?.())}
          onClose={() => setStylesOpen(false)}
          onPick={(def) => {
            setStylesOpen(false);
            const api = apiRef.current;
            applyCellStyle(api, def.style(themeOf(themeStore.current, api?.getActiveWorkbook?.()?.getId?.())))
              .then(() => scheduleSave())
              .catch((e) => showNotice((e as Error).message));
          }}
        />
      )}
      {themeOpen && (
        <ThemeDialog
          current={themeOf(themeStore.current, apiRef.current?.getActiveWorkbook?.()?.getId?.())}
          canEdit={canEdit}
          onClose={() => setThemeOpen(false)}
          onPick={(t) => {
            setThemeOpen(false);
            const api = apiRef.current;
            const from = themeOf(themeStore.current, api?.getActiveWorkbook?.()?.getId?.());
            changeTheme(api, from, t)
              .then((n) => {
                scheduleSave();
                showNotice(`Theme changed to ${t.name}${n ? `; ${n} cell${n === 1 ? "" : "s"} recolored` : ""}.`);
              })
              .catch((e) => showNotice((e as Error).message));
          }}
        />
      )}
      {calcOpen && (
        <CalcOptionsDialog
          value={calcStore.current.get(apiRef.current?.getActiveWorkbook?.()?.getId?.()) || DEFAULT_CALC}
          canEdit={canEdit}
          onClose={() => setCalcOpen(false)}
          onSave={(v) => {
            setCalcSettings(apiRef.current, v);
            setCalcOpen(false);
            scheduleSave();
          }}
        />
      )}
      {unlocking && <PasswordDialog title={unlocking === "sheet" ? "Unprotect sheet" : "Unlock range"} onSubmit={(pw) => unlockWith(unlocking, pw)} onClose={() => setUnlocking(null)} />}
      {watchOpen && apiRef.current && <WatchWindow api={apiRef.current} docId={docId || ""} onClose={() => setWatchOpen(false)} />}
      {evaluating && <EvaluateFormulaDialog where={evaluating.where} formula={evaluating.formula} calc={evaluating.calc} onClose={() => setEvaluating(null)} />}
      {queriesOpen && (
        <QueriesDialog
          queries={queriesNow}
          canEdit={canEdit}
          sheetName={(id) => sheetsNow.find((x) => x.id === id)?.name || "?"}
          onRefresh={refreshQuery}
          onDelete={deleteQuery}
          onClose={() => setQueriesOpen(false)}
        />
      )}
      {dataTableRange && <DataTableDialog range={dataTableRange.text} onClose={() => setDataTableRange(null)} onApply={applyDataTable} />}
      {solverOpen && (
        <SolverDialog
          model={solverOpen}
          canEdit={canEdit}
          onSave={saveSolverModel}
          onSolve={solve}
          onKeep={keepSolved}
          onClose={() => {
            setSolverOpen(null);
            solverOutcome.current = null;
          }}
        />
      )}
      {goalSeekRequest && <GoalSeekDialog request={goalSeekRequest} onClose={() => setGoalSeekRequest(null)} onRun={doGoalSeek} />}
      {splitRange && <SplitTextDialog onClose={() => setSplitRange(null)} onApply={applySplitText} />}
      <div className="flex flex-1 min-h-0 w-full">
        <div ref={splitBox} className={`flex flex-1 min-w-0 min-h-0 ${split?.dir === "columns" ? "flex-row" : "flex-col"}`}>
        <div ref={setOutlineHost} className="relative min-w-0 min-h-0" style={{ flex: split ? `${split.size} 1 0` : "1 1 0" }}>
          <div ref={container} className="absolute inset-0" />
          <SheetOutline api={sheetApi} host={outlineHost} canEdit={canEdit} ready={0} />
          <SheetTraceArrows api={sheetApi} host={outlineHost} arrows={trace.arrows} />
          {chartSheetNow && chartSnapshot && (
            <section aria-label={`Chart sheet: ${chartSheetNow.title}`} data-testid="chart-sheet" className="absolute inset-x-0 top-0 bottom-10 z-20 flex flex-col items-center justify-center bg-white p-6">
              <h2 className="mb-2 text-base font-semibold text-slate-700">{chartSheetNow.title}</h2>
              <div className="w-full max-w-5xl">
                <ChartPreview chart={chartSheetNow} book={chartSnapshot} />
              </div>
            </section>
          )}
          {notice && (
            <div role="status" className="pointer-events-none absolute left-1/2 top-3 z-50 -translate-x-1/2 rounded bg-slate-800 px-3 py-2 text-xs text-white shadow-lg">
              {notice}
            </div>
          )}
        </div>
        {split && docId && (
          <>
            <div
              role="separator"
              aria-label="Split bar"
              aria-orientation={split.dir === "rows" ? "horizontal" : "vertical"}
              className={`shrink-0 bg-slate-300 hover:bg-indigo-400 ${split.dir === "rows" ? "h-1.5 cursor-row-resize" : "w-1.5 cursor-col-resize"}`}
              onPointerDown={dragSplit}
              onDoubleClick={() => setSplit(null)}
            />
            <div className="relative min-w-0 min-h-0" style={{ flex: `${1 - split.size} 1 0` }}>
              <SheetSplitPane
                key={`${docId}-${split.dir}`}
                docId={docId}
                collabUrl={collabUrl}
                user={splitUser}
                sheetId={split.sheetId}
                row={split.row}
                column={split.column}
                onRejected={() => {
                  setSplit(null);
                  showNotice("That change touched a protected range and was not saved.");
                }}
              />
            </div>
          </>
        )}
        </div>
        {pivotOpen && (
          <SheetPivot
            api={sheetApi}
            pivots={pivotsNow}
            activeId={shownPivotId}
            canEdit={canEdit}
            version={docVersion}
            onSelect={setActivePivotId}
            onChange={(def) => void applyPivot(def)}
            onRefresh={(id) => void refreshPivots(id)}
            onDelete={(id) => void deletePivot(id)}
            onUseSelection={pivotFromSelection}
            onClose={() => setPivotOpen(false)}
          />
        )}
        {protectOpen && (
          <SheetProtection
            protections={protectionsNow}
            sheets={sheetsNow}
            activeSheetId={activeSheetIdNow}
            selection={selectionRange}
            actor={actor}
            isOwner={isOwner}
            docId={docId}
            startNew={protectStart}
            onSave={storeProtections}
            onSelect={selectProtection}
            onClose={() => setProtectOpen(false)}
          />
        )}
        {versionsOpen && docId && (
          <SheetVersions docId={docId} canEdit={canEdit} save={saveVersion} current={snapshotOf} onRestore={restoreVersion} onClose={() => setVersionsOpen(false)} />
        )}
        {workbookLock && (
          <PasswordDialog
            title={workbookLock === "protect" ? "Protect Workbook (password optional)" : "Unprotect Workbook"}
            onSubmit={(pw) => (workbookLock === "protect" ? lockWorkbook(pw) : unlockWorkbook(pw))}
            onClose={() => setWorkbookLock(null)}
          />
        )}
        {sensitivityOpen && <SensitivityDialog current={shownLabel} canEdit={canEdit} onSave={storeLabel} onClose={() => setSensitivityOpen(false)} />}
        {customViewsOpen && (
          <CustomViewsDialog
            views={customViewsNow}
            canEdit={canEdit}
            onAdd={(name) => storeCustomViews([...customViewsNow, currentView(apiRef.current, name)])}
            onShow={(v) => {
              applyCustomView(apiRef.current, v);
              setCustomViewsOpen(false);
            }}
            onDelete={(v) => storeCustomViews(customViewsNow.filter((x) => x.id !== v.id))}
            onClose={() => setCustomViewsOpen(false)}
          />
        )}
        {scriptsOpen && <SheetScripts key={unitIdNow || "none"} scripts={scriptsNow} canEdit={canEdit} recording={recording} recorded={recorded} onSave={saveScript} onDelete={deleteScript} onRun={runScript} onRecord={toggleRecording} onClose={() => setScriptsOpen(false)} />}
        {formControlOpen && <FormControlDialog onInsert={insertFormControl} onClose={() => setFormControlOpen(false)} />}
        {quickOpen && <QuickAnalysisDialog selection={quickOpen} onRun={runQuick} onClose={() => setQuickOpen(null)} />}
        {a11yOpen && <AccessibilityPanel issues={a11yIssues} canEdit={canEdit} onGo={goToIssue} onSaveAlt={saveAlt} onClose={() => setA11yOpen(false)} />}
        {chartsOpen && chartSnapshot && <SheetCharts charts={activeCharts} book={chartSnapshot} canEdit={canEdit} onUpdate={updateChart} onRemove={removeChart} onUseSelection={chartUseSelection} onMoveToSheet={(id) => void moveChartToSheet(id)} onClose={() => setChartsOpen(false)} />}
      </div>
    </div>
  );
}
