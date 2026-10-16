/**
 * Document intelligence — the real implementation of what AI_FEATURES_GUIDE.md only described.
 *
 * Covers, in ONE pass over the document (one model call, not seven):
 *   1. Document analysis & summary        5. Smart signer/party detection
 *   2. Smart field detection (w/ coords)  6. Document type classification
 *   3. Template suggestion hints          7. Compliance / risk flags
 *
 * Everything is grounded in the extracted layout, so suggested fields carry REAL page coordinates
 * instead of the two hardcoded ones the old route inserted.
 */

import { structuredCall, AI_MODEL } from "./client";
import {
  extractLayout, layoutToPrompt, detectAnchors, DocumentLayout, FieldAnchor,
} from "./extract";
import { graphicsToAnchors, rasterLines, renderPages, annotate, isScanned } from "./geometry";
import type { HiddenTextReport } from "./visible-text";

export type DocumentType =
  | "CONTRACT" | "NDA" | "INVOICE" | "EMPLOYMENT_AGREEMENT"
  | "SALES_AGREEMENT" | "LEASE" | "WAIVER" | "OTHER";

export type SuggestedFieldType = "SIGNATURE" | "INITIALS" | "TEXT" | "DATE" | "CHECKBOX";

export interface SuggestedField {
  fieldType: SuggestedFieldType;
  label: string;
  pageNumber: number;   // 1-based
  x: number;            // top-left origin, PDF points
  y: number;
  width: number;
  height: number;
  partyRole: string;    // which party fills this (matches a detected party's role)
  required: boolean;
  confidence: number;   // 0-1
  reason: string;       // what in the document justifies this placement
  anchorId?: string | null;   // the rule this field is bound to, when there is one
  snapped?: boolean;          // true = geometry came from the PDF, not from the model
}

export interface DetectedParty {
  role: string;         // e.g. "Employer", "Employee", "Disclosing Party"
  name: string | null;
  email: string | null;
  signingOrder: number; // 1-based; the order the document implies
}

export interface ComplianceFlag {
  severity: "HIGH" | "MEDIUM" | "LOW";
  issue: string;
  recommendation: string;
}

export interface DocumentAnalysis {
  documentType: DocumentType;
  title: string;
  summary: string;
  keywords: string[];
  parties: DetectedParty[];
  suggestedFields: SuggestedField[];
  complianceFlags: ComplianceFlag[];
  effectiveDate: string | null;
  governingLaw: string | null;
  analyzedAt: string;
  model: string;
  /**
   * Text in the PDF a reader cannot see (white, invisible, covered, microscopic, off-page, hidden
   * layer, invisible Unicode). It was removed before the model saw anything; this is the count, for
   * the warning shown to the sender. Its `samples` are for humans only — never prompt with them.
   */
  hiddenText: HiddenTextReport;
}

const SYSTEM = `You are a contract analyst for an e-signature platform. You place the fields a signer fills in.

You get:
  1. The document's text, each line prefixed with its bounding box [x=.. y=.. w=.. h=..] in PDF
     points, TOP-LEFT origin, with the page width/height. A scanned page has no text here.
  2. A list of ANCHORS: every place on the pages where a person can write, found from the PDF's own
     geometry. Each has an id (A1, A2, ...), a kind and the text around it:
       rule     = typed underscores ("Signature: ______")
       line     = a drawn line (often with a caption such as "Signature" or "Date" UNDER it)
       box      = an outlined box to write in (a form field)
       checkbox = a small square to tick
  3. Images of the pages with every anchor MARKED: a magenta line or outline, and a yellow tag
     with its id. LOOK at the images: they show what each anchor is for (the caption under a line,
     the heading of the signature block it sits in, the question beside a box) even when the text
     list is ambiguous, and they are the only source for a scanned page.

YOUR JOB IS SEMANTIC, NOT GEOMETRIC. For each anchor that is a place this document asks someone to
fill in, decide:
  * the field type: SIGNATURE / INITIALS / TEXT / DATE / CHECKBOX
  * WHICH PARTY fills it
and emit one field with "anchorId" set to that anchor's id. The platform places the field exactly on
the anchor, so x/y only need to be a rough estimate; the anchorId is what makes it land right.

Rules:
- A line captioned "Printed name", "Name" or "Title" is a TEXT field; "Date" is a DATE field.
- Lines and boxes inside a party's signature block belong to that party.
- A checkbox the signer must tick is a CHECKBOX field.
- Emit AT MOST ONE field per anchorId. Ignore anchors that are not places to fill in (table rules,
  decorative lines, boxes around printed text).
- If there is a place to sign with NO anchor, you may emit a field with anchorId=null and your best
  x/y estimate in points.
- NEVER invent a field where the document gives no place for it. Fewer, correct fields beat many
  speculative ones. If there is genuinely nowhere to sign, return an empty list.
- Assign every field to a partyRole matching one of the parties you detected.
- Name parties by what the document calls them ("Company", "Recipient", "Employer", ...), read from
  the signature-block headings and the opening paragraph. On a scanned page READ that text from the
  image; never fall back to generic names like "Party 1" when the page prints the role.

Set confidence honestly: a field on the wrong line ruins the document.`;

const SCHEMA = {
  type: "object",
  properties: {
    documentType: {
      type: "string",
      enum: ["CONTRACT", "NDA", "INVOICE", "EMPLOYMENT_AGREEMENT", "SALES_AGREEMENT", "LEASE", "WAIVER", "OTHER"],
    },
    title: { type: "string", description: "The document's actual title" },
    summary: { type: "string", description: "2-4 sentences in plain English: what this is and what signing it commits you to" },
    keywords: { type: "array", items: { type: "string" }, description: "5-8 key terms" },
    effectiveDate: { type: ["string", "null"], description: "ISO date if stated, else null" },
    governingLaw: { type: ["string", "null"], description: "Governing jurisdiction if stated, else null" },
    parties: {
      type: "array",
      description: "Every party who must sign",
      items: {
        type: "object",
        properties: {
          evidence: {
            type: "string",
            description: "The exact words printed in the document that name this party (e.g. the signature-block heading 'RECIPIENT: Priya Shah'). Copy them from the text or, on a scanned page, read them from the image.",
          },
          role: { type: "string", description: "The role those words give the party, e.g. 'Recipient'. Never a generic 'Party 1' / 'Signer 1' when the document prints a role." },
          name: { type: ["string", "null"] },
          email: { type: ["string", "null"] },
          signingOrder: { type: "integer", minimum: 1 },
        },
        required: ["evidence", "role", "name", "email", "signingOrder"],
      },
    },
    suggestedFields: {
      type: "array",
      description: "One field per anchor you claim. anchorId is the important part — it binds the field to a real rule in the document.",
      items: {
        type: "object",
        properties: {
          anchorId: {
            type: ["string", "null"],
            description: "The id of the anchor (fill-in rule) this field sits on. null ONLY if the document has a place to sign with no underscore rule.",
          },
          fieldType: { type: "string", enum: ["SIGNATURE", "INITIALS", "TEXT", "DATE", "CHECKBOX"] },
          label: { type: "string" },
          pageNumber: { type: "integer", minimum: 1 },
          x: { type: "number", description: "Estimate only; ignored when anchorId is set." },
          y: { type: "number", description: "Estimate only; ignored when anchorId is set." },
          width: { type: "number" },
          height: { type: "number" },
          partyRole: { type: "string" },
          required: { type: "boolean" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          reason: { type: "string", description: "The text/line that justifies this placement" },
        },
        required: ["anchorId", "fieldType", "label", "pageNumber", "x", "y", "width", "height", "partyRole", "required", "confidence", "reason"],
      },
    },
    complianceFlags: {
      type: "array",
      description: "Missing clauses, risky terms, or compliance gaps. Empty if none.",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
          issue: { type: "string" },
          recommendation: { type: "string" },
        },
        required: ["severity", "issue", "recommendation"],
      },
    },
  },
  required: ["documentType", "title", "summary", "keywords", "effectiveDate", "governingLaw", "parties", "suggestedFields", "complianceFlags"],
};

/**
 * Analyze a PDF. Throws AiUnavailableError if no API key is configured — callers decide the fallback
 * rather than getting a fabricated result.
 */
export async function analyzeDocument(pdf: Buffer): Promise<DocumentAnalysis> {
  const layout = await extractLayout(pdf);
  return analyzeLayout(layout, pdf);
}

/** Every place to write, from every source, numbered A1..An in reading order. */
export async function collectAnchors(layout: DocumentLayout, pdf?: Buffer) {
  const byPage = new Map<number, FieldAnchor[]>();
  const add = (a: FieldAnchor) => {
    const list = byPage.get(a.pageNumber) ?? [];
    // A drawn line under typed underscores is the same place: keep the typed rule (it has a label).
    if (list.some((b) => Math.abs(b.baseline - a.baseline) < 4 && a.x < b.x + b.width && b.x < a.x + a.width)) return;
    list.push(a);
    byPage.set(a.pageNumber, list);
  };
  detectAnchors(layout).forEach(add);
  for (const page of layout.pages) {
    if (page.graphics) graphicsToAnchors(page.pageNumber, page.width, page.runs, page.graphics).forEach(add);
  }

  // Render the pages worth showing: any with an anchor, any scan, and always page 1. Rendering is
  // best effort; without it the analysis still runs on text + anchors.
  const scanned = layout.pages.filter((p) => isScanned(layout, p.pageNumber)).map((p) => p.pageNumber);
  const wanted = [...new Set([1, ...byPage.keys(), ...scanned])].sort((a, b) => a - b).slice(0, 20);
  let rendered = new Map<number, { canvas: any; scale: number }>();
  if (pdf) {
    try {
      // Scans are rendered sharper: their text exists only as pixels, and the model must read it.
      // Pages the pixel check already rendered at this scale are reused, not rendered again.
      const reuse = layout.rendered;
      for (const n of wanted) {
        const r = reuse?.get(n);
        if (r && r.scale === 1.5 && !scanned.includes(n)) rendered.set(n, r);
      }
      for (const [n, r] of await renderPages(pdf, wanted.filter((n) => !scanned.includes(n) && !rendered.has(n)), 1.5)) rendered.set(n, r);
      for (const [n, r] of await renderPages(pdf, scanned.filter((n) => wanted.includes(n)), 2.2)) rendered.set(n, r);
    } catch { rendered = new Map(); }
    for (const n of scanned) {
      const r = rendered.get(n);
      if (!r) continue;
      const ctx = r.canvas.getContext("2d");
      const img = ctx.getImageData(0, 0, r.canvas.width, r.canvas.height);
      rasterLines(img, r.scale, n).forEach(add);
    }
  }

  let i = 0;
  const anchors: FieldAnchor[] = [];
  for (const n of [...byPage.keys()].sort((a, b) => a - b)) {
    for (const a of byPage.get(n)!.sort((p, q) => p.baseline - q.baseline || p.x - q.x)) anchors.push({ ...a, id: `A${++i}` });
  }
  const images = [...rendered.entries()].map(([n, r]) => ({
    caption: `Page ${n}${scanned.includes(n) ? " (scanned: no text layer)" : ""} — anchors marked:`,
    pngBase64: annotate(r.canvas, anchors.filter((a) => a.pageNumber === n), r.scale),
  }));
  return { anchors, images, scanned };
}

export async function analyzeLayout(layout: DocumentLayout, pdf?: Buffer): Promise<DocumentAnalysis> {
  const positioned = layoutToPrompt(layout);
  const { anchors, images, scanned } = await collectAnchors(layout, pdf);

  const anchorList = anchors.length
    ? anchors
        .map((a) => `${a.id} | ${a.kind ?? "rule"} | page ${a.pageNumber} | x=${a.x} y=${a.y} w=${a.width} | label "${a.label}"${a.lineText ? ` | ${a.lineText}` : ""}`)
        .join("\n")
    : "(none found — place fields by estimate from the page images)";

  // Everything below is built from `layout`, which holds VISIBLE text only (extract.ts): the
  // positioned text, every anchor label and line, and the page images (which show what a reader sees).
  const result = await structuredCall<Omit<DocumentAnalysis, "analyzedAt" | "model" | "hiddenText">>({
    system: SYSTEM,
    prompt:
      `Analyze this document and assign its signing fields.\n\n${positioned}\n\n` +
      `ANCHORS (every place to write, marked on the page images — bind fields to these by id):\n${anchorList}\n\n` +
      `Page count: ${layout.pages.length}.` +
      (scanned.length ? ` Scanned pages (read them from the images): ${scanned.join(", ")}.` : ""),
    images,
    toolName: "record_document_analysis",
    toolDescription: "Record the full analysis, binding each signing field to the anchor it belongs on.",
    schema: SCHEMA,
    maxTokens: 8192,
  });

  const analysis: DocumentAnalysis = {
    ...result,
    analyzedAt: new Date().toISOString(),
    model: AI_MODEL,
    hiddenText: layout.hidden,
  };

  const snapped = snapToAnchors(analysis.suggestedFields, anchors, layout);
  return { ...analysis, suggestedFields: sanitizeFields(snapped, layout) };
}

/** How tall each kind of field should be when it sits on a rule. */
const FIELD_HEIGHT: Record<SuggestedFieldType, number> = {
  SIGNATURE: 38,
  INITIALS: 30,
  TEXT: 20,
  DATE: 20,
  CHECKBOX: 14,
};

/**
 * Bind each field to the real rule it belongs on.
 *
 * The model picks the anchor; the PDF decides the pixels. A field is placed so that its BOTTOM sits
 * on the rule's baseline — which is how a human signs: on the line, not floating above it. Without
 * this, the model's own estimate landed a signature ~35pt off, which on a real contract means the
 * signature prints across the clause above it.
 */
function snapToAnchors(
  fields: SuggestedField[],
  anchors: FieldAnchor[],
  layout: DocumentLayout,
): SuggestedField[] {
  const byId = new Map(anchors.map((a) => [a.id, a]));
  const claimed = new Set<string>();
  const out: SuggestedField[] = [];

  for (const f of fields ?? []) {
    const anchor = f.anchorId ? byId.get(f.anchorId) : undefined;

    // No anchor (or the model hallucinated an id, or claimed one twice) -> keep its estimate.
    if (!anchor || claimed.has(anchor.id)) {
      out.push({ ...f, snapped: false, anchorId: anchor ? f.anchorId : null });
      continue;
    }
    claimed.add(anchor.id);

    const page = layout.pages.find((p) => p.pageNumber === anchor.pageNumber);

    // A box or checkbox IS the field: fill it (just inside its border).
    if (anchor.kind === "box" || anchor.kind === "checkbox") {
      const inset = anchor.kind === "box" ? 1.5 : 0;
      out.push({
        ...f,
        pageNumber: anchor.pageNumber,
        x: anchor.x + inset,
        y: anchor.y + inset,
        width: Math.max(4, anchor.width - 2 * inset),
        height: Math.max(4, anchor.height - 2 * inset),
        snapped: true,
        reason: `${f.reason} [fills ${anchor.kind} ${anchor.id}]`,
      });
      continue;
    }

    const height = FIELD_HEIGHT[f.fieldType] ?? 24;

    // Sit ON the rule: the field's bottom edge lands on the rule's baseline.
    const y = anchor.baseline - height;
    // Span the rule, but don't run a tiny date box across a 300pt line.
    const maxWidth = f.fieldType === "SIGNATURE" || f.fieldType === "INITIALS"
      ? anchor.width
      : Math.min(anchor.width, f.fieldType === "CHECKBOX" ? 14 : 160);

    out.push({
      ...f,
      pageNumber: anchor.pageNumber,
      x: anchor.x,
      y: Math.max(0, y),
      width: Math.min(maxWidth, (page?.width ?? 612) - anchor.x),
      height,
      snapped: true,
      reason: `${f.reason} [snapped to ${anchor.id}: "${anchor.lineText}"]`,
    });
  }
  return out;
}

/**
 * Trust but verify: drop fields the model placed off-page or with nonsense geometry, and clamp the
 * rest into bounds. A field outside the page silently vanishes from the signed PDF, so it is better
 * to discard it loudly than to store it.
 */
function sanitizeFields(fields: SuggestedField[], layout: DocumentLayout): SuggestedField[] {
  const kept: SuggestedField[] = [];

  for (const f of fields ?? []) {
    const page = layout.pages.find((p) => p.pageNumber === f.pageNumber);
    if (!page) continue;
    if (!(f.width > 0) || !(f.height > 0)) continue;

    const width = Math.min(f.width, page.width);
    const height = Math.min(f.height, page.height);
    const x = clamp(f.x, 0, page.width - width);
    const y = clamp(f.y, 0, page.height - height);

    kept.push({ ...f, x: r(x), y: r(y), width: r(width), height: r(height) });
  }
  return kept;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r = (v: number) => Math.round(v * 10) / 10;
