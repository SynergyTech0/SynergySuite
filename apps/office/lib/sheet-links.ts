// Links to other workbooks on the live sheet. Each linked workbook's values
// sit in a hidden workbook named like the link, so the formula engine works
// =[Budget]Plan!B2 out like any other reference. The links (with their values)
// are a workbook resource with a mutation, so collaborators and the .xlsx get
// them too.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { registerListResource } from "./sheet-analysis";
import { cacheOf, linkNameFor, linkNamesIn, LINKS_RESOURCE, unitFromCache, type WorkbookLink } from "./workbook-links";

export const SET_LINKS_MUTATION = "sheet.mutation.set-workbook-links";
export type LinkStore = Map<string, WorkbookLink[]>;

/** Keeps the hidden workbooks in step with a workbook's links. */
function linkUnits(injector: any, core: any, api: () => any) {
  const mounted = new Map<string, string>(); // unit id -> what it holds (to skip reloading unchanged links)
  const instances = injector.get(core.IUniverInstanceService);
  const recalc = () => {
    try {
      api()?.getFormula?.()?.executeCalculation?.();
    } catch {
      /* the next edit recalculates */
    }
  };
  return {
    mount(links: WorkbookLink[], mainUnitId?: string) {
      let changed = false;
      const want = new Set(links.map((l) => l.name));
      for (const id of [...mounted.keys()])
        if (!want.has(id)) {
          try {
            instances.disposeUnit(id);
          } catch {
            /* already gone */
          }
          mounted.delete(id);
          changed = true;
        }
      for (const link of links) {
        if (!link?.name || link.name === mainUnitId) continue;
        const sig = `${link.updated}:${link.docId || link.file || ""}`;
        if (mounted.get(link.name) === sig) continue;
        try {
          if (instances.getUnit?.(link.name)) instances.disposeUnit(link.name);
          instances.createUnit(core.UniverInstanceType.UNIVER_SHEET, unitFromCache(link), { makeCurrent: false });
          mounted.set(link.name, sig);
          changed = true;
        } catch {
          /* a link that can't be shown leaves its formulas at #REF! */
        }
      }
      if (changed) setTimeout(recalc, 0);
    },
    dispose() {
      for (const id of mounted.keys())
        try {
          instances.disposeUnit(id);
        } catch {
          /* already gone */
        }
      mounted.clear();
    },
  };
}

export function registerLinks(injector: any, core: any, api: () => any, store: LinkStore, onChange: () => void) {
  const units = linkUnits(injector, core, api);
  const sync = () => {
    const unitId = api()?.getActiveWorkbook?.()?.getId?.();
    units.mount((unitId && store.get(unitId)) || [], unitId);
    onChange();
  };
  const dispose = registerListResource<WorkbookLink>(injector, core, {
    resource: LINKS_RESOURCE,
    mutation: SET_LINKS_MUTATION,
    field: "links",
    store,
    // The workbook may not be the active one yet while it loads.
    onChange: () => setTimeout(sync, 0),
  });
  return () => {
    dispose();
    units.dispose();
  };
}

export const linksOf = (store: LinkStore, unitId: string | undefined) => (unitId && store.get(unitId)) || [];

function saveLinks(api: any, links: WorkbookLink[]) {
  const wb = api.getActiveWorkbook();
  api.syncExecuteCommand(SET_LINKS_MUTATION, { unitId: wb.getId(), value: links });
}

type DocRow = { id: string; kind: string; title: string };

async function sheetDocs(): Promise<DocRow[]> {
  const res = await fetch("/api/docs").catch(() => null);
  if (!res?.ok) return [];
  return ((await res.json()).documents || []).filter((d: DocRow) => d.kind === "sheet");
}

async function linkTo(doc: { id: string; title: string }, name: string): Promise<WorkbookLink | null> {
  const res = await fetch(`/api/docs/${doc.id}`).catch(() => null);
  if (!res?.ok) return null;
  const d = (await res.json()).document;
  const snapshot = typeof d?.snapshot === "string" ? JSON.parse(d.snapshot) : d?.snapshot;
  return { name, docId: doc.id, title: d?.title || doc.title, updated: Date.now(), cache: cacheOf(snapshot || {}) };
}

/** The spreadsheets one may link to (not this one). */
export async function linkableSheets(selfId?: string): Promise<DocRow[]> {
  return (await sheetDocs()).filter((d) => d.id !== selfId);
}

/** Adds (or re-points) a link to a suite spreadsheet; resolves to its name in formulas. */
export async function addLink(api: any, store: LinkStore, doc: { id: string; title: string }, replacing?: string): Promise<string> {
  const unitId = api.getActiveWorkbook().getId();
  const links = linksOf(store, unitId);
  const name = replacing || links.find((l) => l.docId === doc.id)?.name || linkNameFor(doc.title, links.map((l) => l.name));
  const link = await linkTo(doc, name);
  if (!link) throw new Error(`"${doc.title}" could not be opened.`);
  saveLinks(api, [...links.filter((l) => l.name !== name), link]);
  return name;
}

/** Brings in the linked workbooks' current values. Returns the names that could not be updated. */
export async function updateLinks(api: any, store: LinkStore, only?: string[]): Promise<string[]> {
  const unitId = api.getActiveWorkbook().getId();
  const links = linksOf(store, unitId);
  const failed: string[] = [];
  const next: WorkbookLink[] = [];
  let changed = false;
  for (const l of links) {
    if ((only && !only.includes(l.name)) || !l.docId) {
      if (only?.includes(l.name) && !l.docId) failed.push(l.name);
      next.push(l);
      continue;
    }
    const fresh = await linkTo({ id: l.docId, title: l.title }, l.name);
    // Unchanged values are not news (and not an edit to send to everyone).
    if (fresh && (JSON.stringify(fresh.cache) !== JSON.stringify(l.cache) || fresh.title !== l.title)) {
      next.push(fresh);
      changed = true;
    } else if (fresh) next.push(l);
    else {
      failed.push(l.name);
      next.push(l);
    }
  }
  if (changed) saveLinks(api, next);
  return failed;
}

/**
 * Links formulas' new workbook names to the suite spreadsheets with those
 * titles (as typing =[Budget]Plan!A1 links to the spreadsheet "Budget").
 * Resolves to the names it linked.
 */
export async function linkNewNames(api: any, store: LinkStore, formulas: string[], selfId?: string): Promise<string[]> {
  const unitId = api.getActiveWorkbook()?.getId();
  const known = new Set(linksOf(store, unitId).map((l) => l.name.toLowerCase()));
  const wanted = [...new Set(formulas.flatMap(linkNamesIn))].filter((n) => !known.has(n.toLowerCase()));
  if (!wanted.length) return [];
  const docs = await linkableSheets(selfId);
  const added: string[] = [];
  for (const name of wanted) {
    const doc = docs.find((d) => d.title.trim().toLowerCase() === name.trim().toLowerCase());
    if (!doc) continue;
    try {
      await addLink(api, store, doc, name);
      added.push(name);
    } catch {
      /* stays #REF! until linked */
    }
  }
  return added;
}

/** Breaks a link: formulas that read it become their current values. Returns the cells changed. */
export async function breakLink(api: any, store: LinkStore, name: string): Promise<number> {
  const wb = api.getActiveWorkbook();
  const snap = wb.save();
  let n = 0;
  for (const sheetId of snap.sheetOrder || []) {
    const value: Record<number, Record<number, unknown>> = {};
    let any = false;
    for (const [r, row] of Object.entries((snap.sheets?.[sheetId]?.cellData || {}) as Record<string, Record<string, any>>))
      for (const [c, cell] of Object.entries(row || {})) {
        if (!cell?.f || !linkNamesIn(cell.f).some((x) => x.toLowerCase() === name.toLowerCase())) continue;
        (value[Number(r)] ||= {})[Number(c)] = { v: cell.v ?? null, t: cell.t, f: null, si: null };
        any = true;
        n++;
      }
    if (any) await api.executeCommand("sheet.command.set-range-values", { unitId: wb.getId(), subUnitId: sheetId, value });
  }
  saveLinks(api, linksOf(store, wb.getId()).filter((l) => l.name !== name));
  return n;
}
