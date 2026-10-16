/**
 * What a form shows, as in Access's Form view: the table's fields one record at a time, in the
 * order and with the labels the design says, two columns or one, and subforms listing related
 * records. Used by the browser (to draw the form) and the server (to clean what it stores).
 */
import type { Field } from "./fields";

export type FormItem = {
  field: string;
  /** Label shown instead of the field's name. */
  label?: string;
  /** Spans both columns. */
  wide?: boolean;
};

export type Subform = {
  /** The related table, and its lookup field pointing at this form's table. */
  table: string;
  field: string;
  label?: string;
};

export type FormLayout = {
  title?: string;
  columns: 1 | 2;
  items: FormItem[];
  subforms: Subform[];
  allowEdits: boolean;
  allowAdditions: boolean;
  allowDeletions: boolean;
};

/** Access's Form button: every field, the long ones full width, and a subform per relationship. */
export function defaultLayout(fields: Field[], relations: { tableId: string; fieldId: string }[]): FormLayout {
  return {
    columns: 2,
    items: fields.filter((f) => f.type !== "autonumber").map((f) => ({ field: f.id, wide: f.type === "longtext" || f.type === "multichoice" ? true : undefined })),
    subforms: relations.map((r) => ({ table: r.tableId, field: r.fieldId })),
    allowEdits: true,
    allowAdditions: true,
    allowDeletions: true,
  };
}

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

/** Keeps the known parts of a layout from the browser. */
export function cleanLayout(input: unknown): FormLayout {
  const d = (input ?? {}) as Record<string, any>;
  const seen = new Set<string>();
  const items: FormItem[] = (Array.isArray(d.items) ? d.items : [])
    .filter((i: any) => typeof i?.field === "string" && !seen.has(i.field) && seen.add(i.field))
    .slice(0, 255)
    .map((i: any) => ({ field: i.field.slice(0, 40), label: str(i.label, 100), wide: i.wide === true ? true : undefined }));
  const subforms: Subform[] = (Array.isArray(d.subforms) ? d.subforms : [])
    .filter((s: any) => typeof s?.table === "string" && typeof s?.field === "string")
    .slice(0, 10)
    .map((s: any) => ({ table: s.table.slice(0, 40), field: s.field.slice(0, 40), label: str(s.label, 100) }));
  return {
    title: str(d.title, 200),
    columns: d.columns === 1 ? 1 : 2,
    items,
    subforms,
    allowEdits: d.allowEdits !== false,
    allowAdditions: d.allowAdditions !== false,
    allowDeletions: d.allowDeletions !== false,
  };
}

export type OnlineQuestion = { label: string; type: "text" | "textarea" | "email" | "select" | "checkbox"; required: boolean; options?: string[] };

/** Synergy Forms takes at most this many questions on a form. */
export const MAX_QUESTIONS = 40;

/** Synergy Forms question types for each Base field type; missing types aren't offered there. */
export const SYNERGY_FORMS_TYPES: Partial<Record<Field["type"], OnlineQuestion["type"]>> = {
  text: "text",
  longtext: "textarea",
  email: "email",
  hyperlink: "text",
  phone: "text",
  number: "text",
  currency: "text",
  date: "text",
  datetime: "text",
  choice: "select",
  yesno: "checkbox",
};

/** The questions an online form asks for a layout, and the fields that can't be asked online. */
export function onlineQuestions(layout: FormLayout, fields: Field[]): { questions: OnlineQuestion[]; fieldIds: string[]; notes: string[] } {
  const questions: OnlineQuestion[] = [];
  const fieldIds: string[] = [];
  const notes: string[] = [];
  for (const item of layout.items) {
    const f = fields.find((x) => x.id === item.field);
    if (!f || f.type === "autonumber") continue;
    const type = SYNERGY_FORMS_TYPES[f.type];
    if (!type) {
      notes.push(`${f.name} isn't on the online form; Synergy Forms has no question for ${f.type === "lookup" || f.type === "multilookup" ? "related records" : "several choices"}`);
      continue;
    }
    if (questions.length >= MAX_QUESTIONS) {
      notes.push(`${f.name} isn't on the online form; Synergy Forms takes up to ${MAX_QUESTIONS} questions`);
      continue;
    }
    // A required checkbox would only accept Yes, so Yes/No questions are never required.
    questions.push({ label: item.label ?? f.name, type, required: f.required && type !== "checkbox", ...(type === "select" ? { options: f.options.choices ?? [] } : {}) });
    fieldIds.push(f.id);
  }
  for (const f of fields) {
    if (f.required && f.type !== "autonumber" && !fieldIds.includes(f.id) && f.options.defaultValue === undefined) {
      notes.push(`${f.name} is required but isn't asked online, so responses can't be added until it is on the form or no longer required`);
    }
  }
  return { questions, fieldIds, notes };
}
