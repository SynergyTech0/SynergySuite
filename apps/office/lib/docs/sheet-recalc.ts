// Formula results for a Sheet's live state. Formula results are not in the
// collaboration log (each client's engine works them out), so after a merge
// source is replayed (sheet-live.ts) its formulas are calculated again here
// with Univer's own formula engine, headless: the workbook model from
// @univerjs/core and @univerjs/engine-formula, no grid or UI. Defined names
// come from the workbook's resources.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LiveBook } from "./sheet-live";

type CellData = Record<number, Record<number, Record<string, unknown>>>;

/** Whether any sheet has a formula (otherwise there is nothing to work out). */
export function hasFormulas(book: LiveBook): boolean {
  for (const s of Object.values(book.sheets || {}))
    for (const row of Object.values((s?.cellData || {}) as CellData)) for (const c of Object.values(row || {})) if (c && (c.f || c.si)) return true;
  return false;
}

/**
 * The book with every formula's value worked out again (a copy; the book is
 * returned unchanged when it has no formulas or the engine fails). Gives up
 * after `timeoutMs`.
 */
export async function recalcBook(book: LiveBook, timeoutMs = 8000): Promise<LiveBook> {
  if (!hasFormulas(book)) return book;
  const [core, engine] = await Promise.all([import("@univerjs/core"), import("@univerjs/engine-formula")]);
  const { Univer, UniverInstanceType, LocaleType, ICommandService } = core as any;
  const EF = engine as any;
  const univer = new Univer({ locale: LocaleType.EN_US });
  try {
    univer.registerPlugin(EF.UniverFormulaEnginePlugin, { notExecuteFormula: false });
    const unitId = String((book as any).id || "merge-source");
    const snap = JSON.parse(JSON.stringify({ ...book, id: unitId }));
    // resources are loaded by plugins that are not here; defined names are registered below
    delete snap.resources;
    univer.createUnit(UniverInstanceType.UNIVER_SHEET, snap);
    const injector = (univer as any)._injector;
    const names = ((book.resources as { name: string; data: string }[] | undefined) || []).find((r) => r?.name === "SHEET_DEFINED_NAME_PLUGIN");
    if (names?.data) {
      try {
        injector.get(EF.IDefinedNamesService).registerDefinedNames(unitId, JSON.parse(names.data));
      } catch {
        /* names that can't be read: formulas using them show #NAME? */
      }
    }
    // older engines need the formula data read in; this one reads it from the workbook itself
    injector.get(EF.FormulaDataModel).initFormulaData?.();
    const cmd = injector.get(ICommandService);
    const result = new Promise<any>((resolve) => {
      const d = cmd.onCommandExecuted((c: any) => {
        if (c.id === EF.SetFormulaCalculationResultMutation.id) {
          d.dispose?.();
          resolve(c.params);
        }
      });
    });
    await cmd.executeCommand(EF.SetFormulaCalculationStartMutation.id, { commands: [], forceCalculation: true }, { onlyLocal: true });
    const params = await Promise.race([result, new Promise((r) => setTimeout(() => r(null), timeoutMs))]);
    const unitData = params?.unitData?.[unitId];
    if (!unitData) return book;
    const out = JSON.parse(JSON.stringify(book)) as LiveBook;
    for (const [sheetId, rows] of Object.entries(unitData as Record<string, CellData>)) {
      const sheet = out.sheets[sheetId];
      if (!sheet) continue;
      const data = (sheet.cellData ??= {}) as CellData;
      for (const [rk, row] of Object.entries(rows || {}))
        for (const [ck, v] of Object.entries(row || {})) {
          if (!v) continue;
          const r = Number(rk);
          const c = Number(ck);
          const cell = (data[r] ??= {})[c] || {};
          // a spilled array's cells have no formula of their own: their values come from the result too
          data[r][c] = { ...cell, v: v.v ?? null, ...(v.t !== undefined ? { t: v.t } : {}) };
        }
    }
    return out;
  } catch {
    return book;
  } finally {
    try {
      univer.dispose();
    } catch {
      /* already gone */
    }
  }
}
