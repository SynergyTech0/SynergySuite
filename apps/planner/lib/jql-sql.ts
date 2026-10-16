import { SQL, and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { boards, cards, lists } from "@/db/schema";
import { JqlError, jqlDate, type Condition, type Field, type Node, type Query, type Value } from "@/lib/jql";

/**
 * Turn a parsed JQL query into a Drizzle condition over `cards`, joined to its list and board.
 *
 * Every value goes through drizzle's parameter binding (sql`... ${v}`), never string concatenation,
 * so a query is data and not executable text. The caller always ANDs the result with the set of
 * boards the user can see, so a query can narrow that set but never widen it.
 */
type Ctx = { userId: string };

const text = (v: Value): string => {
  if (v.kind === "string") return v.value;
  if (v.kind === "number") return String(v.value);
  throw new JqlError("Expected a text value");
};
const like = (v: Value) => `%${text(v).replace(/[%_]/g, (c) => `\\${c}`)}%`;

const TEXT_COLUMNS: Partial<Record<Field, SQL>> = {
  summary: sql`${cards.title}`,
  description: sql`${cards.description}`,
  key: sql`${cards.issueKey}`,
};
const ENUM_COLUMNS: Partial<Record<Field, SQL>> = {
  type: sql`${cards.issueType}::text`,
  priority: sql`${cards.priority}::text`,
  resolution: sql`${cards.resolution}::text`,
  statusCategory: sql`${lists.statusCategory}::text`,
};
const DATE_COLUMNS: Partial<Record<Field, SQL>> = {
  due: sql`${cards.dueDate}`,
  created: sql`${cards.createdAt}`,
  updated: sql`${cards.updatedAt}`,
};

/** EXISTS over a join table, so "label = bug" means "has a label called bug". */
const existsLabel = (v: Value) => sql`exists (select 1 from card_labels cl join labels l on l.id = cl.label_id
  where cl.card_id = ${cards.id} and lower(l.name) = lower(${text(v)}))`;
const existsComponent = (v: Value) => sql`exists (select 1 from card_components cc join components co on co.id = cc.component_id
  where cc.card_id = ${cards.id} and lower(co.name) = lower(${text(v)}))`;
const existsVersion = (v: Value) => sql`exists (select 1 from card_fix_versions cv join versions ve on ve.id = cv.version_id
  where cv.card_id = ${cards.id} and lower(ve.name) = lower(${text(v)}))`;
const existsSprint = (v: Value) => sql`exists (select 1 from sprints sp where sp.id = ${cards.sprintId}
  and lower(sp.name) = lower(${text(v)}))`;
const existsMember = (v: Value, ctx: Ctx) => v.kind === "me"
  ? sql`exists (select 1 from card_members cm where cm.card_id = ${cards.id} and cm.user_id = ${ctx.userId})`
  : sql`exists (select 1 from card_members cm join users u on u.id = cm.user_id
      where cm.card_id = ${cards.id} and lower(u.name) = lower(${text(v)}))`;
const isBlocked = sql`exists (select 1 from issue_links il join cards b on b.id = il.source_id
  where il.target_id = ${cards.id} and il.type = 'blocks' and b.is_complete = false and b.is_archived = false)`;

function personColumn(field: Field) {
  return field === "assignee" ? sql`${cards.assigneeId}` : sql`${cards.reporterId}`;
}
function personMatches(field: Field, v: Value, ctx: Ctx): SQL {
  const col = personColumn(field);
  if (v.kind === "me") return sql`${col} = ${ctx.userId}`;
  if (v.kind === "empty") return sql`${col} is null`;
  return sql`exists (select 1 from users u where u.id = ${col} and (lower(u.name) = lower(${text(v)}) or lower(u.email) = lower(${text(v)})))`;
}

function emptiness(field: Field): SQL {
  switch (field) {
    case "assignee": case "reporter": return sql`${personColumn(field)} is null`;
    case "due": return sql`${cards.dueDate} is null`;
    case "resolution": return sql`${cards.resolution} is null`;
    case "points": return sql`${cards.points} is null`;
    case "sprint": return sql`${cards.sprintId} is null`;
    case "label": return sql`not exists (select 1 from card_labels cl where cl.card_id = ${cards.id})`;
    case "component": return sql`not exists (select 1 from card_components cc where cc.card_id = ${cards.id})`;
    case "fixVersion": return sql`not exists (select 1 from card_fix_versions cv where cv.card_id = ${cards.id})`;
    case "member": return sql`not exists (select 1 from card_members cm where cm.card_id = ${cards.id})`;
    case "description": return sql`(${cards.description} is null or ${cards.description} = '')`;
    default: throw new JqlError(`${field} cannot be empty`);
  }
}

function equality(field: Field, v: Value, ctx: Ctx): SQL {
  if (v.kind === "empty") return emptiness(field);
  switch (field) {
    case "text": return sql`(${cards.title} ilike ${like(v)} or ${cards.description} ilike ${like(v)} or ${cards.issueKey} ilike ${like(v)})`;
    case "summary": case "description": case "key": return sql`lower(${TEXT_COLUMNS[field]!}) = lower(${text(v)})`;
    case "board": return sql`(lower(${boards.title}) = lower(${text(v)}) or upper(${boards.keyPrefix}) = upper(${text(v)}))`;
    case "status": return sql`lower(${lists.title}) = lower(${text(v)})`;
    case "type": case "priority": case "resolution": case "statusCategory":
      return sql`${ENUM_COLUMNS[field]!} = lower(${text(v)})`;
    case "assignee": case "reporter": return personMatches(field, v, ctx);
    case "member": return existsMember(v, ctx);
    case "label": return existsLabel(v);
    case "component": return existsComponent(v);
    case "fixVersion": return existsVersion(v);
    case "sprint": return existsSprint(v);
    case "points": return sql`${cards.points} = ${Number(text(v))}`;
    case "blocked": return /^(true|yes|1)$/i.test(text(v)) ? isBlocked : sql`not ${isBlocked}`;
    // cf[...] conditions are resolved in conditionSql before they reach here.
    case "custom": throw new JqlError("a custom field must be written as cf[Name]");
    case "due": case "created": case "updated": {
      const d = jqlDate(v);
      if (!d) throw new JqlError(`${field} needs a date like 2026-09-17 or -7d`);
      // A bare date means that whole day, which is what "due = 2026-09-17" is expected to mean.
      const start = new Date(d); start.setUTCHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + 86400000);
      return sql`(${DATE_COLUMNS[field]!} >= ${start} and ${DATE_COLUMNS[field]!} < ${end})`;
    }
  }
}

function comparison(field: Field, op: string, v: Value): SQL {
  const operator = sql.raw(op);   // one of > >= < <=, checked by the parser's token list
  if (field === "points") return sql`${cards.points} ${operator} ${Number(text(v))}`;
  const col = DATE_COLUMNS[field];
  if (!col) throw new JqlError(`${field} cannot be compared with ${op}`);
  const d = jqlDate(v);
  if (!d) throw new JqlError(`${field} needs a date like 2026-09-17 or -7d`);
  return sql`${col} ${operator} ${d}`;
}

/** cf[Name] = value — compare the stored JSON value as text, which covers text, select, number and date. */
function customField(name: string, v: Value): SQL {
  const wanted = v.kind === "number" ? String(v.value) : v.kind === "string" ? v.value : null;
  if (wanted === null) throw new JqlError(`cf[${name}] needs a value`);
  return sql`exists (select 1 from card_field_values fv join custom_fields cfd on cfd.id = fv.field_id
    where fv.card_id = ${cards.id} and lower(cfd.name) = lower(${name})
    and lower(fv.value #>> '{}') = lower(${wanted}))`;
}

function customEmpty(name: string): SQL {
  return sql`not exists (select 1 from card_field_values fv join custom_fields cfd on cfd.id = fv.field_id
    where fv.card_id = ${cards.id} and lower(cfd.name) = lower(${name}))`;
}

function conditionSql(c: Condition, ctx: Ctx): SQL {
  if (c.field === "custom") {
    const name = c.custom!;
    switch (c.op) {
      case "=": return c.values[0].kind === "empty" ? customEmpty(name) : customField(name, c.values[0]);
      case "!=": return sql`not ${customField(name, c.values[0])}`;
      case "in": return or(...c.values.map((v) => customField(name, v)))!;
      case "not in": return sql`not ${or(...c.values.map((v) => customField(name, v)))!}`;
      case "is empty": return customEmpty(name);
      case "is not empty": return sql`not ${customEmpty(name)}`;
      default: throw new JqlError(`cf[${name}] supports =, !=, IN and IS EMPTY`);
    }
  }
  switch (c.op) {
    case "=": return equality(c.field, c.values[0], ctx);
    case "!=": return sql`not ${equality(c.field, c.values[0], ctx)}`;
    case "~": {
      const col = TEXT_COLUMNS[c.field];
      if (c.field === "text") return equality("text", c.values[0], ctx);
      if (!col) throw new JqlError(`${c.field} cannot be searched with ~`);
      return sql`${col} ilike ${like(c.values[0])}`;
    }
    case "!~": return sql`not ${conditionSql({ ...c, op: "~" }, ctx)}`;
    case "in": return or(...c.values.map((v) => equality(c.field, v, ctx)))!;
    case "not in": return sql`not ${or(...c.values.map((v) => equality(c.field, v, ctx)))!}`;
    case "is empty": return emptiness(c.field);
    case "is not empty": return sql`not ${emptiness(c.field)}`;
    default: return comparison(c.field, c.op, c.values[0]);
  }
}

export function whereSql(node: Node | null, ctx: Ctx): SQL | undefined {
  if (!node) return undefined;
  if (node.type === "condition") return conditionSql(node, ctx);
  if (node.type === "not") return sql`not ${whereSql(node.child, ctx)!}`;
  const parts = node.children.map((c) => whereSql(c, ctx)!);
  return node.type === "and" ? and(...parts) : or(...parts);
}

const ORDER_COLUMNS: Partial<Record<Field, SQL>> = {
  ...DATE_COLUMNS,
  summary: sql`${cards.title}`,
  key: sql`${cards.issueKey}`,
  points: sql`${cards.points}`,
  status: sql`${lists.title}`,
  board: sql`${boards.title}`,
  // Highest first when ascending: a priority order is about severity, not the alphabet.
  priority: sql`array_position(array['highest','high','medium','low','lowest']::text[], ${cards.priority}::text)`,
  type: sql`array_position(array['epic','story','task','bug','subtask']::text[], ${cards.issueType}::text)`,
};

/** Run a parsed query inside `visibleBoards`. Returns cards with their board and list names. */
export async function runJql(query: Query, ctx: Ctx, visibleBoards: string[], limit = 100) {
  if (!visibleBoards.length) return [];
  const where = whereSql(query.where, ctx);
  const order = query.orderBy ? ORDER_COLUMNS[query.orderBy.field] : null;
  if (query.orderBy && !order) throw new JqlError(`Cannot order by ${query.orderBy.field}`);

  return db.select({
    id: cards.id, title: cards.title, issueKey: cards.issueKey, issueType: cards.issueType,
    priority: cards.priority, isComplete: cards.isComplete, dueDate: cards.dueDate, updatedAt: cards.updatedAt,
    points: cards.points, assigneeId: cards.assigneeId, boardId: cards.boardId,
    boardTitle: boards.title, listTitle: lists.title, statusCategory: lists.statusCategory,
  }).from(cards)
    .innerJoin(lists, eq(lists.id, cards.listId))
    .innerJoin(boards, eq(boards.id, cards.boardId))
    .where(and(inArray(cards.boardId, visibleBoards), eq(cards.isArchived, false), where))
    .orderBy(order ? (query.orderBy!.dir === "desc" ? desc(order) : asc(order)) : desc(cards.updatedAt))
    .limit(Math.min(Math.max(limit, 1), 500));
}
