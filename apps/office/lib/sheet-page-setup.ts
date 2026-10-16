// Page setup lives in the worksheet's custom data (custom.xlsx, the same
// place .xlsx import puts it), changed through one mutation so it is saved,
// undoable and shared with collaborators.
import type { HeaderFooter, PageSetup } from "./sheet-print.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const SET_SHEET_XLSX_MUTATION = "sheet.mutation.set-worksheet-xlsx-meta";
export const SET_PAGE_SETUP_COMMAND = "sheet.command.set-page-setup";

type MetaParams = { unitId: string; subUnitId: string; xlsx: Record<string, unknown> | null };

export function registerPageSetup(injector: any, core: any): () => void {
  const commands = injector.get(core.ICommandService);
  const instances = injector.get(core.IUniverInstanceService);
  const sheetOf = (unitId: string, subUnitId: string) => instances.getUnit(unitId)?.getSheetBySheetId?.(subUnitId);
  const mutation = commands.registerCommand({
    id: SET_SHEET_XLSX_MUTATION,
    type: core.CommandType.MUTATION,
    handler: (_accessor: unknown, params?: MetaParams) => {
      const sheet = params && sheetOf(params.unitId, params.subUnitId);
      if (!sheet) return false;
      const custom = { ...(sheet.getCustomMetadata?.() || {}) };
      if (params!.xlsx && Object.keys(params!.xlsx).length) custom.xlsx = params!.xlsx;
      else delete custom.xlsx;
      sheet.setCustomMetadata(custom);
      return true;
    },
  });
  const command = commands.registerCommand({
    id: SET_PAGE_SETUP_COMMAND,
    type: core.CommandType.COMMAND,
    handler: (accessor: any, params?: { unitId: string; subUnitId: string; pageSetup: PageSetup; headerFooter?: HeaderFooter }) => {
      const sheet = params && sheetOf(params.unitId, params.subUnitId);
      if (!sheet) return false;
      const before = (sheet.getCustomMetadata?.()?.xlsx as Record<string, unknown>) || null;
      const after: Record<string, unknown> = { ...(before || {}) };
      const clean = (o: object | undefined) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null && v !== ""));
      const ps = clean(params!.pageSetup);
      if (Object.keys(ps).length) after.pageSetup = ps;
      else delete after.pageSetup;
      if (params!.headerFooter) {
        const hf = clean(params!.headerFooter);
        if (Object.keys(hf).length) after.headerFooter = hf;
        else delete after.headerFooter;
      }
      const redo = { unitId: params!.unitId, subUnitId: params!.subUnitId, xlsx: after };
      const undo = { unitId: params!.unitId, subUnitId: params!.subUnitId, xlsx: before };
      if (!accessor.get(core.ICommandService).syncExecuteCommand(SET_SHEET_XLSX_MUTATION, redo)) return false;
      accessor.get(core.IUndoRedoService).pushUndoRedo({
        unitID: params!.unitId,
        undoMutations: [{ id: SET_SHEET_XLSX_MUTATION, params: undo }],
        redoMutations: [{ id: SET_SHEET_XLSX_MUTATION, params: redo }],
      });
      return true;
    },
  });
  return () => {
    mutation.dispose();
    command.dispose();
  };
}

export function readPageSetup(api: any): { pageSetup: PageSetup; headerFooter: HeaderFooter; unitId: string; subUnitId: string } | null {
  const wb = api?.getActiveWorkbook?.();
  const fs = wb?.getActiveSheet?.();
  const ws = fs?.getSheet?.();
  if (!ws) return null;
  const xlsx = (ws.getCustomMetadata?.()?.xlsx || {}) as { pageSetup?: PageSetup; headerFooter?: HeaderFooter };
  return { pageSetup: { ...(xlsx.pageSetup || {}) }, headerFooter: { ...(xlsx.headerFooter || {}) }, unitId: wb.getId(), subUnitId: fs.getSheetId() };
}

export async function writePageSetup(api: any, pageSetup: PageSetup, headerFooter?: HeaderFooter) {
  const cur = readPageSetup(api);
  if (!cur) return false;
  return api.executeCommand(SET_PAGE_SETUP_COMMAND, { unitId: cur.unitId, subUnitId: cur.subUnitId, pageSetup, headerFooter });
}
