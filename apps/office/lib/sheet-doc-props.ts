// The document's custom properties and sensitivity label in the editor: a
// workbook resource that changes through one mutation, so a new label
// reaches every co-editor and the saved file.
import { DOC_PROPS_RESOURCE, SET_DOC_PROPS_MUTATION, type DocProps, type WorkbookProtection } from "./sensitivity.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type DocPropsStore = Map<string, DocProps>;

export function registerDocProps(injector: any, core: any, store: DocPropsStore, onChange: () => void): () => void {
  const resource = injector.get(core.IResourceManagerService).registerPluginResource({
    pluginName: DOC_PROPS_RESOURCE,
    businesses: [core.UniverInstanceType.UNIVER_SHEET],
    onLoad: (unitId: string, value: any) => {
      store.set(unitId, { custom: Array.isArray(value?.custom) ? value.custom : [], ...(value?.label ? { label: value.label } : {}), ...(value?.workbook ? { workbook: value.workbook } : {}) });
      onChange();
    },
    onUnLoad: (unitId: string) => {
      store.delete(unitId);
      onChange();
    },
    toJson: (unitId: string) => JSON.stringify(store.get(unitId) || { custom: [] }),
    parseJson: (json: string) => JSON.parse(json),
  });
  const mutation = injector.get(core.ICommandService).registerCommand({
    id: SET_DOC_PROPS_MUTATION,
    type: core.CommandType.MUTATION,
    handler: (_accessor: unknown, params?: { unitId: string; value: DocProps }) => {
      if (!params?.unitId || !params.value || !Array.isArray(params.value.custom)) return false;
      store.set(params.unitId, params.value);
      onChange();
      return true;
    },
  });
  return () => {
    resource.dispose();
    mutation.dispose();
  };
}

export async function saveDocProps(api: any, unitId: string, value: DocProps) {
  const ok = await api.executeCommand(SET_DOC_PROPS_MUTATION, { unitId, value });
  if (ok === false) throw new Error("Could not save the change.");
}

/** The changes a protected workbook structure refuses. */
export const STRUCTURE_MUTATIONS = new Set(["sheet.mutation.insert-sheet", "sheet.mutation.remove-sheet", "sheet.mutation.set-worksheet-name", "sheet.mutation.set-worksheet-order", "sheet.mutation.set-worksheet-hidden"]);
export const STRUCTURE_MESSAGE = "The workbook's structure is protected: sheets can't be added, deleted, renamed, moved, hidden or shown. Use Review > Unprotect Workbook.";

/** Why a change is refused under workbook protection, or null. */
export function structureViolation(p: WorkbookProtection | null | undefined, op: { id: string }): string | null {
  return p?.lockStructure && STRUCTURE_MUTATIONS.has(op.id) ? STRUCTURE_MESSAGE : null;
}

/** Stops local sheet-structure changes while the workbook is protected. Returns a disposer. */
export function registerStructureGuard(injector: any, core: any, store: DocPropsStore, onBlocked: (message: string) => void): () => void {
  const guard = injector.get(core.ICommandService).beforeCommandExecuted((info: { id: string; params?: any }, options?: any) => {
    if (options?.fromCollab || options?.onlyLocal) return;
    const why = structureViolation(info.params?.unitId ? store.get(info.params.unitId)?.workbook : null, info);
    if (why) {
      onBlocked(why);
      throw new core.CustomCommandExecutionError(why);
    }
  });
  return () => guard.dispose();
}

// ---- .xlsx: <workbookProtection> ----
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function readWorkbookProtection(workbookXml: string): WorkbookProtection | null {
  const tag = /<workbookProtection\b[^>]*>/.exec(workbookXml)?.[0];
  if (!tag) return null;
  const a = (n: string) => new RegExp(`\\b${n}="([^"]*)"`).exec(tag)?.[1];
  if (!/^(1|true)$/i.test(a("lockStructure") || "")) return null;
  const password: Record<string, string> = {};
  if (a("workbookHashValue")) {
    password.algorithmName = a("workbookAlgorithmName") || "SHA-512";
    password.hashValue = a("workbookHashValue")!;
    password.saltValue = a("workbookSaltValue") || "";
    password.spinCount = a("workbookSpinCount") || "0";
  } else if (a("workbookPassword")) password.password = a("workbookPassword")!;
  return { lockStructure: true, ...(Object.keys(password).length ? { password } : {}) };
}

export function patchWorkbookProtection(workbookXml: string, p: WorkbookProtection | null | undefined): string {
  const xml = workbookXml.replace(/<workbookProtection\b[^>]*\/>/g, "");
  if (!p?.lockStructure) return xml;
  const pw = p.password || {};
  const attrs = pw.hashValue
    ? ` workbookAlgorithmName="${esc(pw.algorithmName || "SHA-512")}" workbookHashValue="${esc(pw.hashValue)}" workbookSaltValue="${esc(pw.saltValue || "")}" workbookSpinCount="${esc(pw.spinCount || "0")}"`
    : pw.password
      ? ` workbookPassword="${esc(pw.password)}"`
      : "";
  const el = `<workbookProtection${attrs} lockStructure="1"/>`;
  const at = /<bookViews\b|<sheets\b/.exec(xml);
  return at ? xml.slice(0, at.index) + el + xml.slice(at.index) : xml;
}
