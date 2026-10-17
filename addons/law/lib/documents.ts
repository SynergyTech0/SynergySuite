import { AiRequestError, AiUnavailableError, aiConfig, structured } from "@synergy/ai";
import type { Me } from "./api";
import { holdChecker } from "./compliance";
import { q, tx } from "./db";
import { access, logEvent } from "./law";
import { UserError, uuidish } from "./util";

/**
 * Case documents on a matter (pleadings, orders, correspondence, discovery), kept with their text
 * so they can be searched and read by the AI. This replaces synergylaw's Python case processor:
 * text comes out of PDFs and Word files here, and the AI work runs on the suite's bring-your-own
 * model (@synergy/ai), or LAW_AI_* to give Law its own. Case files stay in the firm's database.
 */
export const AI_PREFIX = "LAW_";
export const MAX_BYTES = 50 * 1024 * 1024;
const MAX_CHARS = 150_000;

export function aiAvailable(): boolean {
  try {
    return !!aiConfig({ prefix: AI_PREFIX });
  } catch {
    return false;
  }
}

/** Plain text and page count from a PDF, Word document or text file; empty when it has none. */
export async function extractText(name: string, type: string, bytes: Buffer): Promise<{ text: string; pages: number | null }> {
  const lower = name.toLowerCase();
  try {
    if (type === "application/pdf" || lower.endsWith(".pdf")) {
      const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const out = await pdfText(pdf, { mergePages: true });
      return { text: String(out.text ?? "").replace(/\u0000/g, ""), pages: out.totalPages };
    }
    if (lower.endsWith(".docx") || type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const mammoth = await import("mammoth");
      const out = await mammoth.extractRawText({ buffer: bytes });
      return { text: out.value.replace(/\u0000/g, ""), pages: null };
    }
    if (type.startsWith("text/") || /\.(txt|md|eml|csv)$/.test(lower)) return { text: bytes.toString("utf8").replace(/\u0000/g, ""), pages: null };
  } catch (e) {
    console.warn("[law] text extraction failed", name, (e as Error).message);
  }
  return { text: "", pages: null };
}

const DOC_COLS = `id, matter_id, name, type, size, pages, length(text) AS text_length, analysis, analyzed_at, uploaded_by, uploaded_at`;

export async function listDocuments(me: Me, matterId: string) {
  await access(me.email, matterId);
  return q(`SELECT ${DOC_COLS} FROM documents WHERE matter_id = $1 AND held_deleted_at IS NULL ORDER BY uploaded_at DESC`, [matterId]);
}

export async function uploadDocument(me: Me, matterId: string, file: File) {
  await access(me.email, matterId);
  if (!file || typeof file.arrayBuffer !== "function") throw new UserError("Choose a file");
  if (file.size > MAX_BYTES) throw new UserError("Files can be up to 50 MB");
  const bytes = Buffer.from(await file.arrayBuffer());
  const name = (file.name || "document").slice(0, 200);
  const type = (file.type || "application/octet-stream").slice(0, 100);
  const { text, pages } = await extractText(name, type, bytes);
  return tx(async (tq) => {
    const [d] = await tq<{ id: string }>(
      `INSERT INTO documents (matter_id, name, type, size, bytes, text, pages, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [matterId, name, type, bytes.length, bytes, text, pages, me.email],
    );
    await logEvent(tq, matterId, "document", `Added ${name}`, me.email);
    return { id: d.id, name, textLength: text.length, pages };
  });
}

async function docFor(me: Me, id: string) {
  if (!uuidish(id)) throw new UserError("Not found", 404);
  const [d] = await q<{ id: string; matter_id: string; name: string; type: string; uploaded_by: string }>(
    `SELECT id, matter_id, name, type, uploaded_by FROM documents WHERE id = $1 AND held_deleted_at IS NULL`,
    [id],
  );
  if (!d) throw new UserError("Not found", 404);
  const a = await access(me.email, d.matter_id);
  return { d, role: a.role };
}

export async function getDocument(me: Me, id: string) {
  await docFor(me, id);
  const [d] = await q(`SELECT ${DOC_COLS}, text FROM documents WHERE id = $1`, [id]);
  return d;
}

export async function documentBytes(me: Me, id: string) {
  await docFor(me, id);
  const [d] = await q<{ name: string; type: string; bytes: Buffer }>(`SELECT name, type, bytes FROM documents WHERE id = $1`, [id]);
  return d;
}

/** The person who added it or the matter's lawyer removes it; kept hidden while anyone involved is on hold. */
export async function deleteDocument(me: Me, id: string) {
  const { d, role } = await docFor(me, id);
  if (d.uploaded_by !== me.email && role !== "responsible" && role !== "admin") throw new UserError("Only the person who added it or the responsible lawyer can remove it", 403);
  const held = holdChecker();
  const soft = (await held(d.uploaded_by)) || (await held(me.email));
  await tx(async (tq) => {
    if (soft) await tq(`UPDATE documents SET held_deleted_at = now() WHERE id = $1`, [id]);
    else await tq(`DELETE FROM documents WHERE id = $1`, [id]);
    await logEvent(tq, d.matter_id, "document", `Removed ${d.name}`, me.email);
  });
}

export type Analysis = {
  documentType: string;
  title: string;
  filedBy: string;
  documentDate: string;
  summary: string;
  keyPoints: string[];
  parties: { name: string; role: string }[];
  timeline: { date: string; event: string }[];
  deadlines: { title: string; date: string; basis: string }[];
  issues: string[];
};

const DOC_SCHEMA = {
  type: "object",
  properties: {
    documentType: { type: "string", description: "complaint, answer, motion, order, judgment, brief, discovery, deposition, correspondence, contract, exhibit, notice, or other" },
    title: { type: "string" },
    filedBy: { type: "string", description: "Who filed or wrote it, or ''" },
    documentDate: { type: "string", description: "YYYY-MM-DD if stated, else ''" },
    summary: { type: "string", description: "One paragraph." },
    keyPoints: { type: "array", items: { type: "string" }, description: "Up to 8 points a lawyer needs." },
    parties: {
      type: "array",
      items: { type: "object", properties: { name: { type: "string" }, role: { type: "string", description: "plaintiff, defendant, petitioner, respondent, witness, counsel for X, judge, other" } }, required: ["name", "role"] },
    },
    timeline: { type: "array", items: { type: "object", properties: { date: { type: "string" }, event: { type: "string" } }, required: ["date", "event"] } },
    deadlines: {
      type: "array",
      description: "Dates by which someone must act that the document sets or triggers. Leave empty if none are stated.",
      items: { type: "object", properties: { title: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD if it can be worked out, else as written" }, basis: { type: "string" } }, required: ["title", "date", "basis"] },
    },
    issues: { type: "array", items: { type: "string" }, description: "The legal or factual questions it raises." },
  },
  required: ["documentType", "title", "filedBy", "documentDate", "summary", "keyPoints", "parties", "timeline", "deadlines", "issues"],
};

function config() {
  let cfg;
  try {
    cfg = aiConfig({ prefix: AI_PREFIX });
  } catch (e) {
    throw new UserError((e as Error).message, 503);
  }
  if (!cfg) throw new UserError("AI is off. An administrator can turn it on with the AI settings.", 503);
  return cfg;
}

async function ask<T>(opts: Parameters<typeof structured>[0]): Promise<T> {
  try {
    return await structured<T>(opts);
  } catch (e) {
    if (e instanceof AiUnavailableError) throw new UserError("AI is off. An administrator can turn it on with the AI settings.", 503);
    if (e instanceof AiRequestError) throw new UserError(`The AI model didn't answer: ${e.message}`, 502);
    throw e;
  }
}

const strs = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).slice(0, n) : []);
const objs = <T>(v: unknown, keys: (keyof T)[], n: number): T[] =>
  Array.isArray(v)
    ? (v.filter((x) => x && typeof x === "object").map((x) => Object.fromEntries(keys.map((k) => [k, String((x as Record<string, unknown>)[k as string] ?? "")]))) as T[]).slice(0, n)
    : [];

export function cleanAnalysis(a: Partial<Analysis>): Analysis {
  return {
    documentType: String(a.documentType ?? "other"),
    title: String(a.title ?? ""),
    filedBy: String(a.filedBy ?? ""),
    documentDate: /^\d{4}-\d{2}-\d{2}$/.test(String(a.documentDate ?? "")) ? String(a.documentDate) : "",
    summary: String(a.summary ?? ""),
    keyPoints: strs(a.keyPoints, 12),
    parties: objs<Analysis["parties"][number]>(a.parties, ["name", "role"], 40),
    timeline: objs<Analysis["timeline"][number]>(a.timeline, ["date", "event"], 60),
    deadlines: objs<Analysis["deadlines"][number]>(a.deadlines, ["title", "date", "basis"], 20),
    issues: strs(a.issues, 12),
  };
}

/** Reads one document and keeps what it found on it. Nothing in the matter changes by itself. */
export async function analyzeDocument(me: Me, id: string): Promise<Analysis> {
  const { d } = await docFor(me, id);
  const cfg = config();
  const [{ text, matter }] = await q<{ text: string; matter: string }>(
    `SELECT d.text, m.number || ' ' || m.title || ' (' || c.name || ', our client)' AS matter FROM documents d
     JOIN matters m ON m.id = d.matter_id JOIN clients c ON c.id = m.client_id WHERE d.id = $1`,
    [id],
  );
  if (!text.trim()) throw new UserError("There's no text in this file to read. A scanned PDF needs to be run through OCR first.", 400);
  const raw = await ask<Partial<Analysis>>({
    config: cfg,
    system:
      "You help a law firm read case documents. Work only from the text given; never invent facts, names, dates or citations. " +
      "When something is unclear or missing, say so rather than guessing. Dates as YYYY-MM-DD where the text gives them.",
    prompt: `Matter: ${matter}\nFile: ${d.name}\n\nDocument text${text.length > MAX_CHARS ? " (cut short, it is long)" : ""}:\n"""\n${text.slice(0, MAX_CHARS)}\n"""`,
    toolName: "record_document",
    toolDescription: "Record what the document is and what it says.",
    schema: DOC_SCHEMA,
    maxTokens: 4000,
  });
  const clean = cleanAnalysis(raw);
  await tx(async (tq) => {
    await tq(`UPDATE documents SET analysis = $2, analyzed_at = now() WHERE id = $1`, [id, JSON.stringify(clean)]);
    await logEvent(tq, d.matter_id, "ai", `AI read ${d.name}`, me.email);
  });
  return clean;
}

export type Brief = {
  caseName: string; caseNumber: string; court: string; judge: string; parties: { name: string; role: string }[]; claims: string[];
  status: string; keyIssues: string[]; summary: string; timeline: { date: string; event: string }[]; nextSteps: string[];
};

const BRIEF_SCHEMA = {
  type: "object",
  properties: {
    caseName: { type: "string" },
    caseNumber: { type: "string" },
    court: { type: "string" },
    judge: { type: "string" },
    parties: { type: "array", items: { type: "object", properties: { name: { type: "string" }, role: { type: "string" } }, required: ["name", "role"] } },
    claims: { type: "array", items: { type: "string" } },
    status: { type: "string", description: "Where the case stands procedurally." },
    keyIssues: { type: "array", items: { type: "string" } },
    summary: { type: "string", description: "Three or four paragraphs: what it is about, key facts, procedural history, where it stands." },
    timeline: { type: "array", items: { type: "object", properties: { date: { type: "string" }, event: { type: "string" } }, required: ["date", "event"] } },
    nextSteps: { type: "array", items: { type: "string" } },
  },
  required: ["caseName", "caseNumber", "court", "judge", "parties", "claims", "status", "keyIssues", "summary", "timeline", "nextSteps"],
};

/** A case overview from every document the AI has read on the matter. */
export async function briefMatter(me: Me, matterId: string): Promise<Brief> {
  const { m } = await access(me.email, matterId);
  const cfg = config();
  const docs = await q<{ name: string; analysis: Analysis }>(
    `SELECT name, analysis FROM documents WHERE matter_id = $1 AND analysis IS NOT NULL AND held_deleted_at IS NULL ORDER BY uploaded_at LIMIT 200`,
    [matterId],
  );
  if (!docs.length) throw new UserError("Have the AI read at least one document first", 400);
  const body = docs
    .map((d) => `## ${d.name} (${d.analysis.documentType}${d.analysis.documentDate ? `, ${d.analysis.documentDate}` : ""})\n${d.analysis.summary}\n` +
      `Key points: ${d.analysis.keyPoints.join("; ")}\nParties: ${d.analysis.parties.map((p) => `${p.name} (${p.role})`).join("; ")}\n` +
      `Events: ${d.analysis.timeline.map((t) => `${t.date} ${t.event}`).join("; ")}`)
    .join("\n\n")
    .slice(0, MAX_CHARS);
  const raw = await ask<Partial<Brief>>({
    config: cfg,
    system: "You write case overviews for the lawyers on a matter. Use only the document notes given. Say what is unknown rather than guessing.",
    prompt: `Matter ${m.number}: ${m.title}. Our client: ${m.client_name}.${m.court ? ` Court: ${m.court}.` : ""}${m.case_number ? ` Case number: ${m.case_number}.` : ""}\n\nDocument notes:\n${body}`,
    toolName: "record_overview",
    toolDescription: "Record the case overview.",
    schema: BRIEF_SCHEMA,
    maxTokens: 4000,
  });
  const brief: Brief = {
    caseName: String(raw.caseName ?? m.title),
    caseNumber: String(raw.caseNumber ?? ""),
    court: String(raw.court ?? ""),
    judge: String(raw.judge ?? ""),
    parties: objs(raw.parties, ["name", "role"], 40),
    claims: strs(raw.claims, 20),
    status: String(raw.status ?? ""),
    keyIssues: strs(raw.keyIssues, 12),
    summary: String(raw.summary ?? ""),
    timeline: objs(raw.timeline, ["date", "event"], 100),
    nextSteps: strs(raw.nextSteps, 12),
  };
  await tx(async (tq) => {
    await tq(`UPDATE matters SET ai_brief = $2 WHERE id = $1`, [matterId, JSON.stringify({ ...brief, at: new Date().toISOString(), documents: docs.length })]);
    await logEvent(tq, matterId, "ai", `AI case overview from ${docs.length} documents`, me.email);
  });
  return brief;
}
