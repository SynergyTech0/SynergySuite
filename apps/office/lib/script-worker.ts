// The sandbox scripts run in (public/script-sandbox.js): a worker with an
// opaque origin (started from a data: URL), no network or storage APIs, and
// only a copy of the workbook's values. A script is Office Scripts style:
//
//   function main(workbook) {
//     const sheet = workbook.getActiveWorksheet();
//     sheet.getRange("A1").setValue("Total");
//   }
//
// It reads and changes the copy; the changes come back as a list of
// operations, which the sheet applies (see sheet-scripts.ts). Reading a
// formula after changing cells recalculates first: the run stops and the
// page works the results out (see runScriptLive in sheet-scripts.ts).
// Scripts may be written in TypeScript, as Office Scripts are; the types are
// stripped before the run.

export type Snapshot = { active: string; sheets: { name: string; values: unknown[][]; formulas: (string | null)[][] }[]; selection?: { sheet: string; box: Box } };
export type Box = { row: number; column: number; rows: number; columns: number };
export type ScriptStyle = { bold?: boolean; italic?: boolean; color?: string; fill?: string; size?: number; font?: string; underline?: boolean; strike?: boolean; align?: string; valign?: string; wrap?: boolean };
export type ScriptOp =
  | { op: "values"; sheet: string; row: number; column: number; cells: ({ v: unknown } | { f: string })[][] }
  | { op: "style"; sheet: string; box: Box; style: ScriptStyle }
  | { op: "format"; sheet: string; box: Box; pattern: string }
  | { op: "clear"; sheet: string; box: Box }
  | { op: "addSheet"; name: string }
  | { op: "activate"; sheet: string }
  | { op: "size"; sheet: string; dim: "rows" | "columns"; index: number; count: number; px: number }
  | { op: "autofit"; sheet: string; index: number; count: number }
  | { op: "merge"; sheet: string; box: Box; across: boolean }
  | { op: "unmerge"; sheet: string; box: Box }
  | { op: "hide"; sheet: string; dim: "rows" | "columns"; index: number; count: number; hidden: boolean }
  | { op: "insert"; sheet: string; dim: "rows" | "columns"; index: number; count: number }
  | { op: "delete"; sheet: string; dim: "rows" | "columns"; index: number; count: number }
  | { op: "renameSheet"; sheet: string; name: string }
  | { op: "deleteSheet"; sheet: string }
  | { op: "sheet"; sheet: string; tabColor?: string; hidden?: boolean; gridlines?: boolean }
  | { op: "freeze"; sheet: string; rows: number; columns: number }
  | { op: "addTable"; sheet: string; box: Box; headers: boolean };
export type ScriptResult =
  | { ok: true; ops: ScriptOp[]; logs: string[]; returned?: unknown }
  | { ok: false; error: string; logs: string[]; ops: ScriptOp[]; sync?: number };
/** Formula results after a script's first N changes: sheet name -> values. */
export type Oracle = Record<number, Record<string, unknown[][]>>;

/** TypeScript (Office Scripts are written in it) to plain JavaScript; plain JavaScript passes through. */
export async function toJavaScript(code: string): Promise<string> {
  const { transform } = await import("sucrase");
  try {
    return transform(code, { transforms: ["typescript"], disableESTransforms: true }).code;
  } catch (e) {
    throw new Error(`The script has a syntax error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Runs a script on a snapshot in a fresh sandboxed worker, stopped after `timeoutMs`. */
let source: Promise<string> | null = null;
export async function runInSandbox(code: string, snapshot: Snapshot, timeoutMs = 10_000, oracle: Oracle = {}): Promise<ScriptResult> {
  source ||= fetch("/script-sandbox.js").then((r) => {
    if (!r.ok) throw new Error("The script sandbox could not be loaded.");
    return r.text();
  });
  source.catch(() => (source = null));
  const worker = new Worker(`data:text/javascript;charset=utf-8,${encodeURIComponent(await source)}`);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ ok: false, error: `The script was stopped after ${timeoutMs / 1000} seconds.`, logs: [], ops: [] });
    }, timeoutMs);
    worker.onmessage = (e) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(e.data as ScriptResult);
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      resolve({ ok: false, error: e.message || "The script could not start.", logs: [], ops: [] });
    };
    worker.postMessage({ code, snapshot, oracle });
  });
}
