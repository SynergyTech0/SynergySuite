/**
 * Templates are contract text with fields in double braces: {{Counterparty}}, {{Start date}}.
 * {{clause: Limitation of liability}} pulls that clause's current text from the clause library.
 * Pure functions, so the browser and the server fill a template the same way.
 */

const FIELD = /\{\{\s*([^{}]+?)\s*\}\}/g;
const CLAUSE = /^clause\s*:\s*(.+)$/i;

/** Fields the contract form already knows, filled without asking. */
export const BUILTIN_FIELDS = ["Counterparty", "Counterparty email", "Title", "Start date", "End date", "Value", "Currency", "Owner", "Today"];

/** The fields a template asks for, in the order they first appear, without clauses or built-ins. */
export function templateFields(body: string): string[] {
  const seen = new Map<string, string>();
  for (const m of body.matchAll(FIELD)) {
    const name = m[1].trim();
    if (CLAUSE.test(name)) continue;
    const key = name.toLowerCase();
    if (BUILTIN_FIELDS.some((b) => b.toLowerCase() === key)) continue;
    if (!seen.has(key)) seen.set(key, name);
  }
  return [...seen.values()];
}

/** The clause titles a template pulls in. */
export function templateClauses(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(FIELD)) {
    const c = m[1].trim().match(CLAUSE);
    if (c && !out.some((t) => t.toLowerCase() === c[1].trim().toLowerCase())) out.push(c[1].trim());
  }
  return out;
}

/**
 * Fills a template. `values` and `clauses` are matched ignoring case. A field with no value stays
 * as [Field name] so the gap is easy to spot; a clause missing from the library says so.
 */
export function fillTemplate(body: string, values: Record<string, string>, clauses: Record<string, string> = {}): string {
  const v = new Map(Object.entries(values).map(([k, x]) => [k.trim().toLowerCase(), x]));
  const c = new Map(Object.entries(clauses).map(([k, x]) => [k.trim().toLowerCase(), x]));
  return body.replace(FIELD, (_all, raw: string) => {
    const name = raw.trim();
    const clause = name.match(CLAUSE);
    if (clause) {
      const title = clause[1].trim();
      return c.get(title.toLowerCase()) ?? `[Clause "${title}" is not in the library]`;
    }
    const val = v.get(name.toLowerCase());
    return val !== undefined && val !== "" ? val : `[${name}]`;
  });
}
