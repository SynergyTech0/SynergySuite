"use client";

// View > Split: a second pane on the same spreadsheet, scrolled and edited on
// its own, like Excel's split panes. It is a second editor on the shared
// workbook (through the same live collaboration as another person's tab), so
// an edit in either pane shows in both at once.
import { useEffect, useRef } from "react";
import { connectSheetCollab, type SheetCollabHandle } from "@/lib/univer-collab";

export default function SheetSplitPane({
  docId,
  collabUrl,
  user,
  sheetId,
  row,
  column,
  onRejected,
}: {
  docId: string;
  collabUrl: string;
  user?: { name: string; email: string };
  /** Where the pane opens. */
  sheetId: string;
  row: number;
  column: number;
  onRejected: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const start = useRef({ sheetId, row, column });
  const rejected = useRef(onRejected);
  rejected.current = onRejected;

  useEffect(() => {
    let disposed = false;
    let univerRef: { dispose(): void } | null = null;
    let collab: SheetCollabHandle | null = null;
    (async () => {
      const { LocaleType, merge } = await import("@univerjs/core");
      const { defaultTheme } = await import("@univerjs/themes");
      const { createUniver } = await import("@/lib/univer-create");
      const sheetsCore = await import("@univerjs/preset-sheets-core");
      const enUS = (await import("@univerjs/preset-sheets-core/locales/en-US")).default;
      // The same open-source presets as the main pane (comments stay in the main pane).
      const features = await Promise.all([
        import("@univerjs/preset-sheets-sort"),
        import("@univerjs/preset-sheets-filter"),
        import("@univerjs/preset-sheets-conditional-formatting"),
        import("@univerjs/preset-sheets-data-validation"),
        import("@univerjs/preset-sheets-hyper-link"),
        import("@univerjs/preset-sheets-note"),
        import("@univerjs/preset-sheets-drawing"),
        import("@univerjs/preset-sheets-table"),
      ]);
      const locales = await Promise.all([
        import("@univerjs/preset-sheets-sort/locales/en-US"),
        import("@univerjs/preset-sheets-filter/locales/en-US"),
        import("@univerjs/preset-sheets-conditional-formatting/locales/en-US"),
        import("@univerjs/preset-sheets-data-validation/locales/en-US"),
        import("@univerjs/preset-sheets-hyper-link/locales/en-US"),
        import("@univerjs/preset-sheets-note/locales/en-US"),
        import("@univerjs/preset-sheets-drawing/locales/en-US"),
        import("@univerjs/preset-sheets-table/locales/en-US"),
      ]);
      if (disposed || !host.current) return;
      const [sort, filter, cf, dv, link, note, drawing, table] = features;
      const { univer, univerAPI } = createUniver({
        locale: LocaleType.EN_US,
        locales: { [LocaleType.EN_US]: merge({}, enUS, ...locales.map((m) => m.default)) },
        theme: defaultTheme,
        presets: [
          sheetsCore.UniverSheetsCorePreset({ container: host.current, header: false, toolbar: false, formulaBar: false, disableAutoFocus: true }),
          sort.UniverSheetsSortPreset(),
          filter.UniverSheetsFilterPreset(),
          cf.UniverSheetsConditionalFormattingPreset(),
          dv.UniverSheetsDataValidationPreset(),
          link.UniverSheetsHyperLinkPreset(),
          note.UniverSheetsNotePreset(),
          drawing.UniverSheetsDrawingPreset(),
          table.UniverSheetsTablePreset(),
        ],
      });
      univerRef = univer;
      // Dev/e2e hook (never in production), like the main pane's.
      if (process.env.NODE_ENV !== "production") (window as unknown as { __univerSplit?: unknown }).__univerSplit = univerAPI;
      collab = connectSheetCollab({
        url: collabUrl || `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/collab`,
        docId,
        univerAPI: univerAPI as never,
        initialSnapshot: null,
        user,
        onWorkbookReady: () => {
          const wb = univerAPI.getActiveWorkbook();
          const s = start.current;
          try {
            const sheet = wb?.getSheetBySheetId(s.sheetId);
            sheet?.activate();
            sheet?.scrollToCell(s.row, s.column);
            sheet?.getRange(s.row, s.column).activate();
          } catch {
            /* opens at the top */
          }
        },
        onRejected: () => rejected.current(),
      });
    })();
    return () => {
      disposed = true;
      if (process.env.NODE_ENV !== "production") delete (window as unknown as { __univerSplit?: unknown }).__univerSplit;
      collab?.destroy();
      try {
        univerRef?.dispose();
      } catch {
        /* already gone */
      }
    };
  }, [docId, collabUrl, user]);

  return <div ref={host} className="h-full w-full" data-testid="sheet-split-pane" />;
}
