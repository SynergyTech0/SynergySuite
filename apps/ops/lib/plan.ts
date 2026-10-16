/**
 * The manufacturing maths, kept free of the database so it can be tested on its own:
 * low-level codes, bill-of-materials explosion, cost roll-up and the MRP netting run.
 * Quantities are plain numbers; callers round for display.
 */

export type Source = "make" | "buy";

export interface PlanItem {
  id: number;
  sku: string;
  source: Source;
  onHand: number;
  safetyStock: number;
  reorderPoint: number;
  /** Smallest quantity worth ordering or building at once; 0 = exactly what is short. */
  lotSize: number;
  leadDays: number;
  unitCost: number;
}

export interface PlanBomLine {
  componentId: number;
  qty: number;
  scrapPct: number;
}

export interface PlanOperation {
  workCenterId: number;
  setupMinutes: number;
  /** Minutes per unit of output. */
  runMinutes: number;
}

export interface PlanBom {
  itemId: number;
  /** How many units of the item one batch of this bill makes. */
  outputQty: number;
  lines: PlanBomLine[];
  operations: PlanOperation[];
}

/** Stock already on its way: an open work order or an open purchase request. */
export interface Receipt {
  itemId: number;
  qty: number;
  date: string;
}

export interface Requirement {
  itemId: number;
  qty: number;
  date: string;
  /** Why it is needed, shown next to the planned order it causes. */
  reason: string;
}

export interface PlannedOrder {
  itemId: number;
  kind: Source;
  qty: number;
  /** When the stock must be there. */
  needDate: string;
  /** When the build or order has to start to make that date. */
  startDate: string;
  /** The start date was already past, so it is pulled to today and will be late. */
  late: boolean;
  reason: string;
}

export class PlanError extends Error {}

const EPS = 1e-9;

/** Gross quantity of one component for `qty` units of the parent. */
export function componentQty(line: PlanBomLine, bom: Pick<PlanBom, "outputQty">, qty: number): number {
  return (qty * line.qty * (1 + line.scrapPct / 100)) / (bom.outputQty || 1);
}

/** Planned minutes for `qty` units through one operation: setup once per order plus run time per unit. */
export function operationMinutes(op: PlanOperation, qty: number): number {
  return op.setupMinutes + op.runMinutes * qty;
}

/**
 * The level each item sits at in the product structure: finished goods 0, their components 1,
 * and so on, using the deepest place an item appears. MRP plans level by level so a component's
 * demand is complete before it is netted. A bill that contains itself, directly or not, is refused.
 */
export function lowLevelCodes(itemIds: number[], boms: Map<number, PlanBom>): Map<number, number> {
  const code = new Map<number, number>(itemIds.map((id) => [id, 0]));
  const visiting = new Set<number>();
  const walk = (id: number, level: number, path: number[]) => {
    if (visiting.has(id)) throw new PlanError(`A bill of materials uses itself: ${[...path, id].join(" > ")}`);
    if ((code.get(id) ?? -1) < level) code.set(id, level);
    const bom = boms.get(id);
    if (!bom) return;
    visiting.add(id);
    for (const l of bom.lines) walk(l.componentId, level + 1, [...path, id]);
    visiting.delete(id);
  };
  for (const id of itemIds) walk(id, 0, []);
  return code;
}

export interface Explosion {
  itemId: number;
  level: number;
  qty: number;
}

/** Every component needed for `qty` of `itemId`, all levels down, summed per item. */
export function explode(itemId: number, qty: number, boms: Map<number, PlanBom>): Explosion[] {
  const levels = lowLevelCodes([itemId], boms);
  const total = new Map<number, number>();
  const visit = (id: number, q: number) => {
    const bom = boms.get(id);
    if (!bom) return;
    for (const l of bom.lines) {
      const need = componentQty(l, bom, q);
      total.set(l.componentId, (total.get(l.componentId) ?? 0) + need);
      visit(l.componentId, need);
    }
  };
  visit(itemId, qty);
  return [...total].map(([id, q]) => ({ itemId: id, level: levels.get(id) ?? 1, qty: q })).sort((a, b) => a.level - b.level || a.itemId - b.itemId);
}

export interface RolledCost {
  material: number;
  labor: number;
  total: number;
}

/**
 * Standard cost of one unit: bought items and items without a bill cost their unit cost; made
 * items add up their components (scrap included) and their routing at each work center's rate.
 */
export function rollUpCost(itemId: number, items: Map<number, Pick<PlanItem, "unitCost">>, boms: Map<number, PlanBom>, rates: Map<number, number>): RolledCost {
  lowLevelCodes([itemId], boms); // refuses loops before recursing
  const memo = new Map<number, RolledCost>();
  const cost = (id: number): RolledCost => {
    const hit = memo.get(id);
    if (hit) return hit;
    const bom = boms.get(id);
    let out: RolledCost;
    if (!bom) {
      const u = items.get(id)?.unitCost ?? 0;
      out = { material: u, labor: 0, total: u };
    } else {
      let material = 0;
      let labor = 0;
      for (const l of bom.lines) {
        const c = cost(l.componentId);
        const per = componentQty(l, bom, 1);
        material += per * c.material;
        labor += per * c.labor;
      }
      for (const op of bom.operations) {
        labor += ((op.setupMinutes / (bom.outputQty || 1) + op.runMinutes) * (rates.get(op.workCenterId) ?? 0)) / 60;
      }
      out = { material, labor, total: material + labor };
    }
    memo.set(id, out);
    return out;
  };
  return cost(itemId);
}

/** yyyy-mm-dd plus `days`. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface PlanInput {
  items: PlanItem[];
  boms: Map<number, PlanBom>;
  receipts: Receipt[];
  requirements: Requirement[];
  today: string;
}

/**
 * Material requirements planning. For each item, top level first: take what is on hand above
 * safety stock, add what is already on order as it arrives, and walk the dated requirements.
 * Whenever the projection drops below zero, plan an order for the shortfall (at least the lot
 * size) due that day, started its lead time earlier. A planned build passes its components'
 * needs down to the next level, dated on its start. Items that end the horizon under their
 * reorder point get one more order to bring them back up.
 */
export function runMrp(input: PlanInput): PlannedOrder[] {
  const byId = new Map(input.items.map((i) => [i.id, i]));
  const levels = lowLevelCodes(input.items.map((i) => i.id), input.boms);
  const reqs = new Map<number, Requirement[]>();
  const addReq = (r: Requirement) => {
    if (r.qty <= EPS) return;
    if (!reqs.has(r.itemId)) reqs.set(r.itemId, []);
    reqs.get(r.itemId)!.push(r);
  };
  input.requirements.forEach(addReq);

  const orders: PlannedOrder[] = [];
  const order = [...input.items].sort((a, b) => (levels.get(a.id) ?? 0) - (levels.get(b.id) ?? 0) || a.id - b.id);

  for (const item of order) {
    const plan = (qty: number, needDate: string, reason: string) => {
      const q = Math.max(qty, item.lotSize);
      let start = addDays(needDate, -item.leadDays);
      const late = start < input.today;
      if (late) start = input.today;
      orders.push({ itemId: item.id, kind: item.source, qty: q, needDate, startDate: start, late, reason });
      const bom = item.source === "make" ? input.boms.get(item.id) : undefined;
      if (bom) {
        for (const l of bom.lines) {
          if (!byId.has(l.componentId)) continue;
          addReq({ itemId: l.componentId, qty: componentQty(l, bom, q), date: start, reason: `For ${item.sku}` });
        }
      }
      return q;
    };

    type Ev = { date: string; qty: number; reason: string; receipt: boolean };
    const events: Ev[] = [
      ...input.receipts.filter((r) => r.itemId === item.id).map((r) => ({ date: r.date, qty: r.qty, reason: "", receipt: true })),
      ...(reqs.get(item.id) ?? []).map((r) => ({ date: r.date, qty: -r.qty, reason: r.reason, receipt: false })),
    ];
    // Receipts land before requirements on the same day.
    events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : Number(a.receipt === false) - Number(b.receipt === false)));

    let projected = item.onHand - item.safetyStock;
    for (const e of events) {
      projected += e.qty;
      if (projected < -EPS) projected += plan(-projected, e.date < input.today ? input.today : e.date, e.reason);
    }
    // projected excludes safety stock; the reorder point is measured on real stock.
    const ending = projected + item.safetyStock;
    if (item.reorderPoint > 0 && ending < item.reorderPoint - EPS) {
      plan(item.reorderPoint - ending, addDays(input.today, item.leadDays), "Below reorder point");
    }
  }
  return orders;
}
