/**
 * Segments: saved filters over one audience ("tag is vip and opened any campaign in the last 30
 * days"). Rules compile to a SQL condition over subscribers `s`, with every value passed as a
 * parameter; the field and operator lists are fixed, so nothing a person types reaches the SQL.
 */
import { q } from "./db";
import { assertCanEdit } from "./members";
import { SEGMENT_FIELDS, SEGMENT_OPS, type Condition, type Ctx, type Rules, type Segment } from "./types";
import { UserError, isUuid, required, text } from "./util";

const COLUMN: Record<string, string> = {
  email: "s.email", first_name: "s.first_name", last_name: "s.last_name", company: "s.company", source: "s.source",
};

const OPS_FOR: Record<string, readonly string[]> = {
  email: ["is", "is_not", "contains", "not_contains"],
  first_name: ["is", "is_not", "contains", "not_contains"],
  last_name: ["is", "is_not", "contains", "not_contains"],
  company: ["is", "is_not", "contains", "not_contains"],
  source: ["is", "is_not"],
  field: ["is", "is_not", "contains", "not_contains"],
  tag: ["is", "is_not"],
  created: ["before", "after", "within_days"],
  opened: ["any", "none", "within_days"],
  clicked: ["any", "none", "within_days"],
};

/** Checks rules sent by the browser. */
export function cleanRules(v: unknown): Rules {
  const r = (v ?? {}) as { match?: unknown; conditions?: unknown };
  const match = r.match === "any" ? "any" : "all";
  if (!Array.isArray(r.conditions)) return { match, conditions: [] };
  if (r.conditions.length > 30) throw new UserError("A segment can have at most 30 conditions");
  const conditions: Condition[] = r.conditions.map((raw) => {
    const c = (raw ?? {}) as Record<string, unknown>;
    const field = c.field as Condition["field"];
    const op = c.op as Condition["op"];
    if (!SEGMENT_FIELDS.includes(field) || !SEGMENT_OPS.includes(op) || !OPS_FOR[field].includes(op)) throw new UserError("A segment condition doesn't make sense");
    const value = text(c.value, 300);
    if (op === "within_days" && !(Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) <= 3650)) throw new UserError("Enter a number of days");
    if ((op === "before" || op === "after") && Number.isNaN(Date.parse(value))) throw new UserError("Enter a date");
    if ((field === "opened" || field === "clicked") && op !== "within_days" && value && !isUuid(value)) throw new UserError("Pick a campaign");
    const out: Condition = { field, op, value };
    if (field === "field") {
      const key = text(c.key, 40).toLowerCase();
      if (!/^[a-z0-9_]+$/.test(key)) throw new UserError("Pick a field");
      out.key = key;
    }
    return out;
  });
  return { match, conditions };
}

/** The rules as one SQL condition over `s`, numbering parameters from `start`. */
export function compileRules(rules: Rules, start: number): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${start + params.length - 1}`;
  };
  const parts = rules.conditions.map((c) => {
    const col = c.field === "field" ? `coalesce(s.fields->>${p(c.key)}, '')` : COLUMN[c.field];
    switch (c.field) {
      case "tag":
        return `${c.op === "is_not" ? "NOT " : ""}(${p(c.value.toLowerCase())} = ANY(s.tags))`;
      case "created":
        if (c.op === "within_days") return `s.created_at >= now() - make_interval(days => ${p(Number(c.value))}::int)`;
        return `s.created_at ${c.op === "before" ? "<" : ">="} ${p(new Date(c.value).toISOString())}::timestamptz`;
      case "opened":
      case "clicked": {
        const at = c.field === "opened" ? "d.opened_at" : "d.clicked_at";
        const scope = c.op === "within_days"
          ? `${at} >= now() - make_interval(days => ${p(Number(c.value))}::int)`
          : c.value ? `d.campaign_id = ${p(c.value)}::uuid` : "d.campaign_id IS NOT NULL";
        const exists = `EXISTS (SELECT 1 FROM deliveries d WHERE d.subscriber_id = s.id AND ${at} IS NOT NULL AND ${scope})`;
        return c.op === "none" ? `NOT ${exists}` : exists;
      }
      default:
        switch (c.op) {
          case "is": return `lower(${col}) = lower(${p(c.value)})`;
          case "is_not": return `lower(${col}) <> lower(${p(c.value)})`;
          case "contains": return `${col} ILIKE ${p(`%${c.value.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)}`;
          default: return `${col} NOT ILIKE ${p(`%${c.value.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)}`;
        }
    }
  });
  if (!parts.length) return { sql: "TRUE", params };
  return { sql: `(${parts.join(rules.match === "any" ? " OR " : " AND ")})`, params };
}

type Row = { id: string; audience_id: string; name: string; rules: Rules; updated_at: Date };
const toSegment = (r: Row): Segment => ({ id: r.id, audienceId: r.audience_id, name: r.name, rules: r.rules, updatedAt: new Date(r.updated_at).toISOString() });

/** How many people in the audience a send would reach: subscribed, not suppressed, matching. */
export async function countMatching(audienceId: string, rules: Rules): Promise<number> {
  const c = compileRules(rules, 2);
  const [r] = await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM subscribers s WHERE s.audience_id = $1 AND s.status = 'subscribed'
       AND NOT EXISTS (SELECT 1 FROM suppressions x WHERE x.email = lower(s.email)) AND ${c.sql}`,
    [audienceId, ...c.params],
  );
  return r.n;
}

export async function listSegments(audienceId?: string): Promise<Segment[]> {
  const rows = audienceId
    ? await q<Row>("SELECT * FROM segments WHERE audience_id = $1 ORDER BY lower(name)", [audienceId])
    : await q<Row>("SELECT * FROM segments ORDER BY lower(name)");
  const out = rows.map(toSegment);
  for (const s of out) s.count = await countMatching(s.audienceId, s.rules);
  return out;
}

export async function getSegment(id: string): Promise<Segment> {
  if (!isUuid(id)) throw new UserError("Segment not found", 404);
  const [r] = await q<Row>("SELECT * FROM segments WHERE id = $1", [id]);
  if (!r) throw new UserError("Segment not found", 404);
  return toSegment(r);
}

export async function createSegment(ctx: Ctx, audienceId: string, b: Record<string, unknown>): Promise<Segment> {
  assertCanEdit(ctx);
  if (!isUuid(audienceId)) throw new UserError("Audience not found", 404);
  const [r] = await q<{ id: string }>(
    "INSERT INTO segments (audience_id, name, rules, created_by, updated_by) VALUES ($1, $2, $3::jsonb, $4, $4) RETURNING id",
    [audienceId, required(b.name, "A name", 120), JSON.stringify(cleanRules(b.rules)), ctx.email],
  );
  return getSegment(r.id);
}

export async function updateSegment(ctx: Ctx, id: string, b: Record<string, unknown>): Promise<Segment> {
  assertCanEdit(ctx);
  const s = await getSegment(id);
  await q("UPDATE segments SET name = $2, rules = $3::jsonb, updated_at = now(), updated_by = $4 WHERE id = $1", [
    id, b.name === undefined ? s.name : required(b.name, "A name", 120), JSON.stringify(b.rules === undefined ? s.rules : cleanRules(b.rules)), ctx.email,
  ]);
  return getSegment(id);
}

export async function deleteSegment(ctx: Ctx, id: string): Promise<void> {
  assertCanEdit(ctx);
  const [busy] = await q("SELECT 1 FROM campaigns WHERE segment_id = $1 AND status IN ('scheduled','sending','paused')", [id]);
  if (busy) throw new UserError("A campaign to this segment is scheduled or sending. Cancel it first.");
  await q("DELETE FROM segments WHERE id = $1", [id]);
}
