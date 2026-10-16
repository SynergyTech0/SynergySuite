// Sheet and range protection in the browser. The list lives in a workbook
// resource and changes through one mutation, so it travels with the snapshot,
// the collaboration log and .xlsx files. Every local mutation passes the rules
// in protection-rules.mjs before it runs; a blocked one is cancelled before it
// changes anything. The collaboration server runs the same rules again.
import {
  canEditProtection,
  foldProtections,
  PROTECTION_RESOURCE,
  SET_PROTECTIONS_MUTATION,
  violation,
  type Actor,
  type Protection,
  type Rect,
} from "./protection-rules.mjs";

import { hasPassword, passwordAttrs } from "./excel-password.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const PASSWORD_MESSAGE = "This sheet is protected with a password. Use Data > Unprotect sheet… (or Unlock range…) to edit it.";

/** The sheet's password (from Excel or set here), if it has one. */
export const sheetPassword = (p: Protection) => passwordAttrs(p.xlsx);
/** Unlocked in this session: a protection's id, or "id#n" for its n-th exception range. */
export type Unlocked = Set<string>;

/** Exceptions still open to everyone: those without a password, or unlocked. */
const openExceptions = (p: Protection, unlocked: Unlocked) => (p.except || []).filter((_, i) => !hasPassword(p.exceptPasswords?.[i]) || unlocked.has(`${p.id}#${i}`));

/**
 * Why an edit is blocked, or null: the people rules (protection-rules.mjs),
 * then passwords, which hold for everyone (the owner too) until unlocked.
 */
export function protectionViolation(list: Protection[], op: { id: string; params?: any }, who: Actor, unlocked: Unlocked): string | null {
  const withRanges = list.map((p) => (p.exceptPasswords?.some(hasPassword) ? { ...p, except: openExceptions(p, unlocked) } : p));
  const why = violation(withRanges, op, who);
  if (why || op.id === SET_PROTECTIONS_MUTATION) return why;
  const locked = list.filter((p) => hasPassword(sheetPassword(p)) && !unlocked.has(p.id)).map((p) => ({ ...p, editors: [], except: openExceptions(p, unlocked) }));
  return locked.length && violation(locked, op, { role: "editor", email: "" }) ? PASSWORD_MESSAGE : null;
}

export type { Actor, Protection, Rect };
export { canEditProtection, SET_PROTECTIONS_MUTATION };

export type ProtectionStore = Map<string, Protection[]>;

/** Registers the resource, the mutation and the guard; returns a disposer. */
export function registerProtections(
  injector: any,
  core: any,
  store: ProtectionStore,
  actor: () => Actor,
  onChange: () => void,
  onBlocked: (message: string) => void,
  unlocked: Unlocked = new Set(),
): () => void {
  const resource = injector.get(core.IResourceManagerService).registerPluginResource({
    pluginName: PROTECTION_RESOURCE,
    businesses: [core.UniverInstanceType.UNIVER_SHEET],
    onLoad: (unitId: string, value: { protections?: Protection[] }) => {
      store.set(unitId, Array.isArray(value?.protections) ? value.protections : []);
      onChange();
    },
    onUnLoad: (unitId: string) => {
      store.delete(unitId);
      onChange();
    },
    toJson: (unitId: string) => JSON.stringify({ protections: store.get(unitId) || [] }),
    parseJson: (json: string) => JSON.parse(json),
  });
  const commands = injector.get(core.ICommandService);
  const mutation = commands.registerCommand({
    id: SET_PROTECTIONS_MUTATION,
    type: core.CommandType.MUTATION,
    handler: (_accessor: unknown, params?: { unitId: string; value: Protection[] }) => {
      if (!params?.unitId || !Array.isArray(params.value)) return false;
      store.set(params.unitId, params.value);
      onChange();
      return true;
    },
  });
  // Local edits only: a peer's op was already checked on their side and by the
  // server, and formula results are computed, not typed.
  const guard = commands.beforeCommandExecuted((info: { id: string; params?: any }, options?: any) => {
    if (!info?.id?.includes(".mutation.") || options?.fromCollab || options?.onlyLocal || options?.applyFormulaCalculationResult) return;
    const unitId = info.params?.unitId;
    const list = (unitId && store.get(unitId)) || [];
    if (!list.length && info.id !== SET_PROTECTIONS_MUTATION) return;
    const why = protectionViolation(list, info, actor(), unlocked);
    if (why) {
      onBlocked(why);
      throw new core.CustomCommandExecutionError(why);
    }
  });
  // Inserted, deleted and moved rows or columns carry the ranges with them, on
  // every client in the same order (the server does the same).
  const follow = commands.onCommandExecuted((info: { id: string; params?: any }) => {
    if (!info?.id?.startsWith("sheet.mutation.") || info.id === SET_PROTECTIONS_MUTATION) return;
    const unitId = info.params?.unitId;
    const list = unitId && store.get(unitId);
    if (!list?.length) return;
    const next = foldProtections(list, info);
    if (next !== list) {
      store.set(unitId, next);
      onChange();
    }
  });
  return () => {
    resource.dispose();
    mutation.dispose();
    guard.dispose();
    follow.dispose();
  };
}

export const protectionsIn = (store: ProtectionStore, unitId: string | undefined) => (unitId && store.get(unitId)) || [];

export async function saveProtections(api: any, unitId: string, list: Protection[]) {
  const ok = await api.executeCommand(SET_PROTECTIONS_MUTATION, { unitId, value: list });
  if (ok === false) throw new Error("Could not save the protection.");
}

// ---- A1 helpers for the dialog ----
const colName = (c: number) => {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const colIndex = (s: string) => s.toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export function rectText(r: Rect): string {
  const a = `${colName(r.startColumn)}${r.startRow + 1}`;
  const b = `${colName(r.endColumn)}${r.endRow + 1}`;
  return a === b ? a : `${a}:${b}`;
}

/** "B2:D9", "B2" or "A:C" / "3:5"; null when it doesn't parse. */
export function parseRect(text: string): Rect | null {
  const t = text.trim().replace(/\$/g, "").replace(/^.*!/, "");
  let m = /^([A-Za-z]{1,3})(\d+)(?::([A-Za-z]{1,3})(\d+))?$/.exec(t);
  if (m) {
    const r1 = Number(m[2]) - 1;
    const c1 = colIndex(m[1]);
    const r2 = m[4] ? Number(m[4]) - 1 : r1;
    const c2 = m[3] ? colIndex(m[3]) : c1;
    if (r1 < 0 || r2 < 0) return null;
    return { startRow: Math.min(r1, r2), endRow: Math.max(r1, r2), startColumn: Math.min(c1, c2), endColumn: Math.max(c1, c2) };
  }
  m = /^([A-Za-z]{1,3}):([A-Za-z]{1,3})$/.exec(t);
  if (m) {
    const a = colIndex(m[1]);
    const b = colIndex(m[2]);
    return { startRow: 0, endRow: 1048575, startColumn: Math.min(a, b), endColumn: Math.max(a, b) };
  }
  m = /^(\d+):(\d+)$/.exec(t);
  if (m) {
    const a = Number(m[1]) - 1;
    const b = Number(m[2]) - 1;
    if (a < 0 || b < 0) return null;
    return { startRow: Math.min(a, b), endRow: Math.max(a, b), startColumn: 0, endColumn: 16383 };
  }
  return null;
}
