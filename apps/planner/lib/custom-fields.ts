import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { cardFieldValues, customFields } from "@/db/schema";
import { canSeeBoard, isUuid } from "@/lib/authz";
import { parseDate } from "@/lib/validate";

export const FIELD_TYPES = ["text", "number", "select", "date", "user", "checkbox"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const isFieldType = (v: unknown): v is FieldType => FIELD_TYPES.includes(v as FieldType);

type Field = typeof customFields.$inferSelect;

/**
 * Check a value against its field's type, returning what to store (or an error to report).
 *
 * Values are checked here rather than at the call site so every route agrees, and so a board never
 * ends up holding a select value that is not one of its options or a user who cannot see the board.
 */
export async function validateFieldValue(field: Field, raw: unknown): Promise<{ value: unknown } | { error: string; status: 400 | 404 }> {
  if (raw === null || raw === "") return { value: null };
  switch (field.type) {
    case "text":
      if (typeof raw !== "string") return { error: `${field.name} takes text`, status: 400 };
      return { value: raw.slice(0, 2000) };
    case "number": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (typeof raw === "boolean" || !Number.isFinite(n)) return { error: `${field.name} takes a number`, status: 400 };
      return { value: n };
    }
    case "select":
      if (typeof raw !== "string" || !(field.options ?? []).includes(raw)) {
        return { error: `${field.name} takes one of: ${(field.options ?? []).join(", ")}`, status: 400 };
      }
      return { value: raw };
    case "date": {
      const d = parseDate(raw);
      if (d === undefined) return { error: `${field.name} takes a date`, status: 400 };
      return { value: d ? d.toISOString() : null };
    }
    case "user":
      if (!isUuid(raw) || !(await canSeeBoard(raw, field.boardId))) {
        return { error: "that person cannot see this board", status: 404 };
      }
      return { value: raw };
    case "checkbox":
      if (typeof raw !== "boolean") return { error: `${field.name} takes true or false`, status: 400 };
      return { value: raw };
  }
}

export const boardFields = (boardId: string) =>
  db.select().from(customFields).where(eq(customFields.boardId, boardId)).orderBy(asc(customFields.position), asc(customFields.createdAt));

/** A card's values as { fieldId: value }, leaving out cleared ones. */
export async function fieldValuesFor(cardId: string) {
  const rows = await db.select().from(cardFieldValues).where(eq(cardFieldValues.cardId, cardId));
  return Object.fromEntries(rows.map((r) => [r.fieldId, r.value]));
}
