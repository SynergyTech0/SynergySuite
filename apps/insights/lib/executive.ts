import type { Metabase } from "./metabase";

/**
 * The Executive overview: one dashboard of the numbers a business owner checks every morning,
 * made by Insights over the suite's own data so a fresh install has it without anyone building
 * it. It replaces the suite's old Executive View page, section for section: today's brief, the
 * one thing that matters most, revenue and cash, growth, trends and what needs attention.
 *
 * Every sync makes sure it exists: an "Executive" collection holding one saved question per card
 * and the dashboard laying them out. Things are found again by name, so a sync never makes a
 * second copy. A card whose query Insights has since changed is updated in place; the layout is
 * only rewritten when one of Insights' cards is missing from the dashboard, so a resized or
 * rearranged dashboard stays as it is. Cards over a source that isn't connected are left out
 * until it is.
 *
 * Finance figures are for admins: the collection is closed to everyone else when Insights makes
 * it. An admin can share it later in the designer's collection permissions, and that stays.
 */

export const EXECUTIVE_COLLECTION = "Executive";
export const EXECUTIVE_DASHBOARD = "Executive overview";

/** Metabase dashboards are 24 grid columns wide. */
const GRID = 24;

export interface ExecutiveCard {
  /** Suite database the query runs against. */
  source: string;
  name: string;
  description: string;
  display: "scalar" | "bar" | "row" | "line" | "table";
  sql: string;
  settings: Record<string, unknown>;
}

const col = (name: string) => JSON.stringify(["name", name]);
const currency = (...names: string[]) => Object.fromEntries(names.map((n) => [col(n), { number_style: "currency" }]));
const scalar = (field: string, money: boolean) => ({ "scalar.field": field, ...(money ? { column_settings: currency(field) } : {}) });
const chart = (dimension: string, metric: string, money: boolean) => ({
  "graph.dimensions": [dimension],
  "graph.metrics": [metric],
  "graph.show_values": false,
  ...(money ? { column_settings: currency(metric) } : {}),
});

/** Every query answers with a row of zeros (or no rows, for lists) when the app holds no data yet. */
const months = (from: string) =>
  `generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month') AS ${from}`;

// Books: issued invoices are revenue (drafts and voided ones aren't); what's still due on
// sent, part-paid and overdue invoices is owed to the business.
const issued = (t = "") => `${t}status NOT IN ('DRAFT', 'VOID')`;
const openInvoice = (t = "") => `${t}status NOT IN ('DRAFT', 'PAID', 'VOID', 'WRITTEN_OFF') AND ${t}"amountDue" > 0`;
const OPEN_BILL = `status NOT IN ('DRAFT', 'PAID', 'VOID') AND "amountDue" > 0`;
// Planner: a task is overdue when it isn't done, archived or on a closed board and its due date has passed.
const OVERDUE_TASK = `FROM cards c JOIN lists l ON l.id = c.list_id JOIN boards b ON b.id = c.board_id
WHERE NOT c.is_complete AND NOT c.is_archived AND NOT l.is_archived AND NOT b.is_closed
  AND l.status_category <> 'done' AND c.due_date < now()`;
const OPEN_CASE = `status IN ('open', 'pending')`;

export const CARDS = {
  overdue: {
    source: "books",
    name: "Overdue to you",
    description: "What customers owe on invoices past their due date.",
    display: "scalar",
    sql: `SELECT COALESCE(SUM("amountDue"), 0) AS "Overdue" FROM "Invoice" WHERE ${openInvoice()} AND "dueDate" < now()`,
    settings: scalar("Overdue", true),
  },
  revenueThisMonth: {
    source: "books",
    name: "Revenue this month",
    description: "Invoices issued since the first of this month, drafts and voided invoices left out.",
    display: "scalar",
    sql: `SELECT COALESCE(SUM("totalAmount"), 0) AS "Revenue" FROM "Invoice"
WHERE ${issued()} AND "invoiceDate" >= date_trunc('month', current_date)`,
    settings: scalar("Revenue", true),
  },
  revenueLastMonth: {
    source: "books",
    name: "Revenue last month",
    description: "Invoices issued last month, drafts and voided invoices left out.",
    display: "scalar",
    sql: `SELECT COALESCE(SUM("totalAmount"), 0) AS "Revenue" FROM "Invoice"
WHERE ${issued()} AND "invoiceDate" >= date_trunc('month', current_date) - interval '1 month'
  AND "invoiceDate" < date_trunc('month', current_date)`,
    settings: scalar("Revenue", true),
  },
  cash: {
    source: "books",
    name: "Cash on hand",
    description: "Current balance of the active checking, savings and money market accounts in Books.",
    display: "scalar",
    sql: `SELECT COALESCE(SUM("currentBalance"), 0) AS "Cash" FROM "BankAccount"
WHERE "isActive" AND "accountType" IN ('CHECKING', 'SAVINGS', 'MONEY_MARKET')`,
    settings: scalar("Cash", true),
  },
  owed: {
    source: "books",
    name: "Owed to you",
    description: "Everything still due on sent invoices, overdue or not.",
    display: "scalar",
    sql: `SELECT COALESCE(SUM("amountDue"), 0) AS "Owed" FROM "Invoice" WHERE ${openInvoice()}`,
    settings: scalar("Owed", true),
  },
  billsDue: {
    source: "books",
    name: "Bills due in the next 30 days",
    description: "Unpaid bills falling due within 30 days.",
    display: "scalar",
    sql: `SELECT COALESCE(SUM("amountDue"), 0) AS "Due" FROM "Bill"
WHERE ${OPEN_BILL} AND "dueDate" >= now() AND "dueDate" < now() + interval '30 days'`,
    settings: scalar("Due", true),
  },
  billsOverdue: {
    source: "books",
    name: "Bills overdue",
    description: "Unpaid bills past their due date.",
    display: "scalar",
    sql: `SELECT COALESCE(SUM("amountDue"), 0) AS "Overdue" FROM "Bill" WHERE ${OPEN_BILL} AND "dueDate" < now()`,
    settings: scalar("Overdue", true),
  },
  pipeline: {
    source: "crm",
    name: "Open pipeline",
    description: "Value of every deal in CRM that is neither won nor lost.",
    display: "scalar",
    sql: `SELECT COALESCE(SUM(amount), 0) AS "Pipeline" FROM opportunities WHERE stage NOT IN ('closed_won', 'closed_lost')`,
    settings: scalar("Pipeline", true),
  },
  wonThisMonth: {
    source: "crm",
    name: "Won this month",
    description: "Value of deals won since the first of this month.",
    display: "scalar",
    sql: `SELECT COALESCE(SUM(amount), 0) AS "Won" FROM opportunities
WHERE stage = 'closed_won' AND COALESCE(close_date, updated_at::date) >= date_trunc('month', current_date)`,
    settings: scalar("Won", true),
  },
  newLeads: {
    source: "crm",
    name: "New leads this month",
    description: "Leads added to CRM since the first of this month.",
    display: "scalar",
    sql: `SELECT COUNT(*) AS "Leads" FROM leads WHERE created_at >= date_trunc('month', current_date)`,
    settings: scalar("Leads", false),
  },
  pipelineByStage: {
    source: "crm",
    name: "Pipeline by stage",
    description: "Value of open deals at each stage.",
    display: "bar",
    sql: `SELECT s.label AS "Stage", COALESCE(SUM(o.amount), 0) AS "Value", COUNT(o.id) AS "Deals"
FROM (VALUES (1, 'prospecting', 'Prospecting'), (2, 'qualification', 'Qualification'), (3, 'proposal', 'Proposal'),
             (4, 'negotiation', 'Negotiation')) AS s(pos, stage, label)
LEFT JOIN opportunities o ON o.stage = s.stage
GROUP BY s.pos, s.label ORDER BY s.pos`,
    settings: chart("Stage", "Value", true),
  },
  revenueByMonth: {
    source: "books",
    name: "Revenue by month",
    description: "Invoices issued each month over the last 12 months.",
    display: "bar",
    sql: `SELECT to_char(m.month, 'Mon YYYY') AS "Month", COALESCE(SUM(i."totalAmount"), 0) AS "Revenue"
FROM ${months("m(month)")}
LEFT JOIN "Invoice" i ON date_trunc('month', i."invoiceDate") = m.month AND ${issued("i.")}
GROUP BY m.month ORDER BY m.month`,
    settings: chart("Month", "Revenue", true),
  },
  wonByMonth: {
    source: "crm",
    name: "Deals won by month",
    description: "Value of deals won each month over the last 12 months.",
    display: "bar",
    sql: `SELECT to_char(m.month, 'Mon YYYY') AS "Month", COALESCE(SUM(o.amount), 0) AS "Won", COUNT(o.id) AS "Deals"
FROM ${months("m(month)")}
LEFT JOIN opportunities o ON o.stage = 'closed_won' AND date_trunc('month', COALESCE(o.close_date, o.updated_at::date)) = m.month
GROUP BY m.month ORDER BY m.month`,
    settings: chart("Month", "Won", true),
  },
  openCases: {
    source: "desk",
    name: "Open support cases",
    description: "Desk tickets that are open or waiting on someone.",
    display: "scalar",
    sql: `SELECT COUNT(*) AS "Cases" FROM tickets WHERE ${OPEN_CASE}`,
    settings: scalar("Cases", false),
  },
  urgentCases: {
    source: "desk",
    name: "Urgent and high-priority cases",
    description: "Open Desk tickets marked urgent or high priority.",
    display: "scalar",
    sql: `SELECT COUNT(*) AS "Cases" FROM tickets WHERE ${OPEN_CASE} AND priority IN ('urgent', 'high')`,
    settings: scalar("Cases", false),
  },
  overdueTasks: {
    source: "planner",
    name: "Overdue tasks",
    description: "Planner tasks past their due date that aren't done.",
    display: "scalar",
    sql: `SELECT COUNT(*) AS "Tasks" ${OVERDUE_TASK}`,
    settings: scalar("Tasks", false),
  },
  overdueInvoiceList: {
    source: "books",
    name: "Overdue invoices",
    description: "The invoices past their due date, oldest first.",
    display: "table",
    sql: `SELECT i."invoiceNumber" AS "Invoice", c.name AS "Customer", i."dueDate"::date AS "Due",
       current_date - i."dueDate"::date AS "Days overdue", i."amountDue" AS "Amount due"
FROM "Invoice" i JOIN "Customer" c ON c.id = i."customerId"
WHERE ${openInvoice("i.")} AND i."dueDate" < now()
ORDER BY i."dueDate" LIMIT 25`,
    settings: { column_settings: currency("Amount due") },
  },
  overdueTaskList: {
    source: "planner",
    name: "Overdue task list",
    description: "Planner tasks past their due date, oldest first.",
    display: "table",
    sql: `SELECT b.title AS "Board", c.title AS "Task", c.due_date::date AS "Due", current_date - c.due_date::date AS "Days late"
${OVERDUE_TASK}
ORDER BY c.due_date LIMIT 25`,
    settings: {},
  },
  caseList: {
    source: "desk",
    name: "Oldest open cases",
    description: "Open Desk tickets, most urgent and oldest first.",
    display: "table",
    sql: `SELECT number AS "Case", subject AS "Subject", priority AS "Priority", status AS "Status",
       NULLIF(assignee, '') AS "Assignee", current_date - created_at::date AS "Days open"
FROM tickets WHERE ${OPEN_CASE}
ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, created_at
LIMIT 25`,
    settings: {},
  },
} satisfies Record<string, ExecutiveCard>;

type CardKey = keyof typeof CARDS;
type Cell = [CardKey, number];
type Section = { heading?: string; text?: string; rows: { height: number; cells: Cell[] }[] };

const BRIEF = `## Today's brief
Revenue, cash, growth and what needs attention, from Books, CRM, Desk and Planner. The figures are worked out each time this dashboard opens.`;

/** The dashboard, top to bottom, in the old Executive View's order. Widths add up to 24 per row. */
export const LAYOUT: Section[] = [
  { text: BRIEF, rows: [] },
  { heading: "The one thing that matters most", rows: [{ height: 3, cells: [["overdue", 24]] }] },
  {
    heading: "Revenue & cash",
    rows: [
      { height: 3, cells: [["revenueThisMonth", 8], ["revenueLastMonth", 8], ["cash", 8]] },
      { height: 3, cells: [["owed", 8], ["billsDue", 8], ["billsOverdue", 8]] },
    ],
  },
  {
    heading: "Growth",
    rows: [
      { height: 3, cells: [["pipeline", 8], ["wonThisMonth", 8], ["newLeads", 8]] },
      { height: 6, cells: [["pipelineByStage", 24]] },
    ],
  },
  { heading: "Trends", rows: [{ height: 7, cells: [["revenueByMonth", 12], ["wonByMonth", 12]] }] },
  {
    heading: "Needs attention",
    rows: [
      { height: 3, cells: [["openCases", 8], ["urgentCases", 8], ["overdueTasks", 8]] },
      { height: 8, cells: [["overdueInvoiceList", 12], ["overdueTaskList", 12]] },
      { height: 8, cells: [["caseList", 24]] },
    ],
  },
];

export interface DashcardSpec {
  card_id: number | null;
  row: number;
  col: number;
  size_x: number;
  size_y: number;
  visualization_settings: Record<string, unknown>;
}

function virtual(display: "heading" | "text", text: string): Record<string, unknown> {
  return {
    virtual_card: { name: null, display, visualization_settings: {}, dataset_query: {}, archived: false },
    text,
    "dashcard.background": display === "text",
  };
}

/**
 * Places the cards that exist (by key) on the grid. Sections whose cards are all missing are
 * dropped, and a row closes up around a missing card.
 */
export function layout(ids: Partial<Record<CardKey, number>>): DashcardSpec[] {
  const out: DashcardSpec[] = [];
  let y = 0;
  for (const s of LAYOUT) {
    const rows = s.rows
      .map((r) => ({ height: r.height, cells: r.cells.filter(([k]) => ids[k] !== undefined) }))
      .filter((r) => r.cells.length > 0);
    if (s.text) {
      out.push({ card_id: null, row: y, col: 0, size_x: GRID, size_y: 2, visualization_settings: virtual("text", s.text) });
      y += 2;
    }
    if (rows.length === 0) continue;
    if (s.heading) {
      out.push({ card_id: null, row: y, col: 0, size_x: GRID, size_y: 1, visualization_settings: virtual("heading", s.heading) });
      y += 1;
    }
    for (const r of rows) {
      // The cards left in a row share its width.
      const total = r.cells.reduce((n, [, w]) => n + w, 0);
      let x = 0;
      r.cells.forEach(([k, w], i) => {
        const size = i === r.cells.length - 1 ? GRID - x : Math.round((w / total) * GRID);
        out.push({ card_id: ids[k]!, row: y, col: x, size_x: size, size_y: r.height, visualization_settings: {} });
        x += size;
      });
      y += r.height;
    }
  }
  return out;
}

/** JSON with object keys sorted, so settings compare the same however Metabase orders them. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

interface MbCard {
  id: number;
  name: string;
  description?: string | null;
  display: string;
  collection_id?: number | null;
  archived?: boolean;
  visualization_settings?: Record<string, unknown> | null;
  dataset_query?: {
    database?: number;
    native?: { query?: string };
    /** Newer Metabase versions answer in their pMBQL form. */
    stages?: { native?: string }[];
  };
}

interface MbItem {
  id: number;
  model: string;
  name: string;
  archived?: boolean;
}

interface MbCollection {
  id: number | string;
  name: string;
  location?: string | null;
  archived?: boolean;
  personal_owner_id?: number | null;
}

/** True when a saved card already is what Insights would make. */
export function cardMatches(card: MbCard, def: ExecutiveCard, database: number): boolean {
  const q = card.dataset_query ?? {};
  const sql = q.native?.query ?? q.stages?.[0]?.native;
  const vs = card.visualization_settings ?? {};
  return (
    q.database === database &&
    sql === def.sql &&
    card.display === def.display &&
    (card.description ?? "") === def.description &&
    Object.entries(def.settings).every(([k, v]) => stable(vs[k]) === stable(v))
  );
}

function cardBody(def: ExecutiveCard, database: number, collectionId: number) {
  return {
    name: def.name,
    description: def.description,
    display: def.display,
    visualization_settings: def.settings,
    collection_id: collectionId,
    dataset_query: { type: "native", database, native: { query: def.sql, "template-tags": {} } },
  };
}

const list = <T>(r: { data: T[] } | T[]): T[] => (Array.isArray(r) ? r : r.data);

/**
 * The collection is closed to everyone but admins (Metabase admins always see every collection)
 * when Insights makes it. Done once, so an admin can open it up later.
 */
async function restrictCollection(mb: Metabase, id: number): Promise<void> {
  const groups = await mb.asService<{ id: number; magic_group_type?: string | null }[]>("/api/permissions/group");
  const allUsers = groups.find((g) => g.magic_group_type === "all-internal-users")?.id ?? 1;
  const analysts = await mb.analystsGroupId();
  const graph = await mb.asService<{ revision: number }>("/api/collection/graph");
  await mb.asService("/api/collection/graph", {
    method: "PUT",
    body: { revision: graph.revision, groups: { [allUsers]: { [id]: "none" }, [analysts]: { [id]: "none" } } },
  });
}

async function ensureCollection(mb: Metabase): Promise<number> {
  const all = list(await mb.asService<{ data: MbCollection[] } | MbCollection[]>("/api/collection"));
  const found = all.find(
    (c) => c.name === EXECUTIVE_COLLECTION && typeof c.id === "number" && !c.archived && !c.personal_owner_id && (c.location ?? "/") === "/",
  );
  if (found) return found.id as number;
  const made = await mb.asService<{ id: number }>("/api/collection", {
    body: { name: EXECUTIVE_COLLECTION, description: "The Executive overview and its cards, set up by Insights. Admins only unless shared.", parent_id: null },
  });
  await restrictCollection(mb, made.id);
  return made.id;
}

export interface ExecutiveResult {
  status: "ok" | "skipped" | "error";
  dashboardId?: number;
  cards: number;
  detail?: string;
}

/**
 * Makes or brings up to date the Executive overview. `databases` maps each connected suite
 * database (books, crm, ...) to its id in Metabase; cards over anything else are left out.
 */
export async function provisionExecutive(mb: Metabase, databases: Record<string, number>): Promise<ExecutiveResult> {
  const wanted = (Object.keys(CARDS) as CardKey[]).filter((k) => databases[CARDS[k].source] !== undefined);
  if (wanted.length === 0) {
    return { status: "skipped", cards: 0, detail: "None of Books, CRM, Desk or Planner is connected yet." };
  }
  const collectionId = await ensureCollection(mb);
  const items = list(
    await mb.asService<{ data: MbItem[] } | MbItem[]>(`/api/collection/${collectionId}/items?models=card&models=dashboard`),
  ).filter((i) => !i.archived);

  const ids: Partial<Record<CardKey, number>> = {};
  for (const k of wanted) {
    const def: ExecutiveCard = CARDS[k];
    const database = databases[def.source];
    const existing = items.find((i) => i.model === "card" && i.name === def.name);
    if (existing) {
      const card = await mb.asService<MbCard>(`/api/card/${existing.id}`);
      if (!cardMatches(card, def, database)) {
        await mb.asService(`/api/card/${existing.id}`, { method: "PUT", body: cardBody(def, database, collectionId) });
      }
      ids[k] = existing.id;
    } else {
      ids[k] = (await mb.asService<{ id: number }>("/api/card", { body: cardBody(def, database, collectionId) })).id;
    }
  }

  const existingDash = items.find((i) => i.model === "dashboard" && i.name === EXECUTIVE_DASHBOARD);
  const dashboardId =
    existingDash?.id ??
    (
      await mb.asService<{ id: number }>("/api/dashboard", {
        body: {
          name: EXECUTIVE_DASHBOARD,
          description: "Revenue, cash, growth and what needs attention across the business. Set up by Insights.",
          collection_id: collectionId,
        },
      })
    ).id;
  const dash = await mb.asService<{ dashcards?: { card_id: number | null }[]; ordered_cards?: { card_id: number | null }[] }>(
    `/api/dashboard/${dashboardId}`,
  );
  const onDash = new Set((dash.dashcards ?? dash.ordered_cards ?? []).map((d) => d.card_id));
  if (wanted.some((k) => !onDash.has(ids[k]!))) {
    const dashcards = layout(ids).map((d, i) => ({ id: -(i + 1), ...d, series: [], parameter_mappings: [] }));
    await mb.asService(`/api/dashboard/${dashboardId}`, { method: "PUT", body: { dashcards } });
  }
  return { status: "ok", dashboardId, cards: wanted.length };
}

/** The Executive overview among the dashboards someone can open, if it is one of them. */
export function findExecutive<T extends { name: string; collection: string | null }>(dashboards: T[]): T | undefined {
  return dashboards.find((d) => d.name === EXECUTIVE_DASHBOARD && d.collection === EXECUTIVE_COLLECTION);
}
