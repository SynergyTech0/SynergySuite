// Checks Office extension markup against element rules taken from the
// published schemas (see ooxml-rules.json): every child is one the element
// allows, in the schema's order, required children and attributes present.
// Only elements with a rule are checked, so ordinary DrawingML passes through.
import { readFileSync } from "node:fs";

type Rule = { req: string[]; seq: [string, number][]; need: string[] };
const RULES: Record<string, Rule> = JSON.parse(readFileSync(new URL("./ooxml-rules.json", import.meta.url), "utf8")).rules;

/** Problems found in `xml` (empty when it is valid). Needs a DOMParser (jsdom in tests). */
export function schemaProblems(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const err = doc.getElementsByTagName("parsererror")[0];
  if (err) return [`not well formed: ${err.textContent?.slice(0, 200)}`];
  const out: string[] = [];
  const walk = (el: Element) => {
    const rule = RULES[el.tagName];
    if (rule) {
      for (const a of rule.req) if (!el.hasAttribute(a)) out.push(`${el.tagName}: missing attribute ${a}`);
      let last = -1;
      const names = [...el.children].map((c) => c.tagName);
      for (const n of names) {
        const at = rule.seq.find(([s]) => s === n) ?? rule.seq.find(([s]) => s === "*");
        if (!at) out.push(`${el.tagName}: ${n} is not allowed here`);
        else if (at[1] < last) out.push(`${el.tagName}: ${n} is out of order`);
        else last = at[1];
      }
      for (const n of rule.need) if (!names.includes(n)) out.push(`${el.tagName}: missing ${n}`);
    }
    for (const c of el.children) walk(c);
  };
  walk(doc.documentElement);
  return out;
}

/** How many elements of the document have a rule (so a test can tell it checked something). */
export function ruledElements(xml: string): number {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return [...doc.getElementsByTagName("*")].filter((e) => RULES[e.tagName]).length;
}
