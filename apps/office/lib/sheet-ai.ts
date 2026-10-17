// The spreadsheet's AI helpers, on the server: a formula from a plain-language
// request, and insights worded for a table. They use whatever model the suite
// is set up with through @synergy/ai (OFFICE_AI_* settings, falling back to
// AI_*); with none, AiUnavailableError tells the caller AI is off.
import { loadAiConfig, structured, type AiConfig } from "@synergy/ai";

export const AI_PREFIX = "OFFICE_";
export const MAX_PROMPT = 2000;
export const MAX_TABLE = 12_000;

export type FormulaContext = {
  sheet?: string;
  /** The cell the formula goes into, e.g. E2. */
  cell?: string;
  /** The table around it, e.g. A1:D20. */
  range?: string;
  /** Column letters and their header names. */
  columns?: { column: string; name: string }[];
  /** A few rows of the table as text. */
  sample?: string;
};
export type FormulaAnswer = { formula: string; explanation: string };
export type InsightAnswer = { insights: { title: string; text: string }[] };

export const configFor = (env?: Record<string, string | undefined>): Promise<AiConfig | null> => loadAiConfig({ prefix: AI_PREFIX, env });

const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);

export function formulaPrompt(request: string, ctx: FormulaContext): string {
  const cols = (ctx.columns || []).slice(0, 40).map((c) => `${clip(c.column, 4)} = ${clip(c.name, 60)}`).join(", ");
  return [
    `Request: ${clip(request, MAX_PROMPT)}`,
    ctx.sheet ? `Sheet: ${clip(ctx.sheet, 80)}` : "",
    ctx.cell ? `The formula goes in cell ${clip(ctx.cell, 12)}.` : "",
    ctx.range ? `The data table is ${clip(ctx.range, 24)}, with column names in its first row.` : "",
    cols ? `Columns: ${cols}` : "",
    ctx.sample ? `Sample rows:\n${clip(ctx.sample, 3000)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const FORMULA_SYSTEM =
  "You write spreadsheet formulas in Excel syntax (English function names, comma separators, A1 references). " +
  "Use the cell references of the table described; prefer whole column ranges of the table (e.g. C2:C20) over guesses. " +
  "Dynamic array functions (FILTER, SORT, UNIQUE, XLOOKUP, LET, LAMBDA) are allowed. " +
  "Answer with one formula starting with = and a one or two sentence explanation in plain language.";

/** Cleans up a model's formula: one line, starting with =. Throws if there is none. */
export function cleanFormula(f: unknown): string {
  let s = String(f ?? "").trim();
  s = s.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "").trim();
  if (s.startsWith("`") && s.endsWith("`")) s = s.slice(1, -1).trim();
  s = s.replace(/\s*\n\s*/g, " ");
  if (!s) throw new Error("The model did not give a formula.");
  if (!s.startsWith("=")) s = `=${s}`;
  if (s.length > 4000) throw new Error("The formula is too long.");
  return s;
}

export async function suggestFormula(request: string, ctx: FormulaContext, config?: AiConfig | null): Promise<FormulaAnswer> {
  const answer = await structured<FormulaAnswer>({
    config: config === undefined ? await configFor() : config,
    system: FORMULA_SYSTEM,
    prompt: formulaPrompt(request, ctx),
    toolName: "record_formula",
    toolDescription: "Record the spreadsheet formula that answers the request.",
    schema: {
      type: "object",
      properties: {
        formula: { type: "string", description: "The formula, starting with =" },
        explanation: { type: "string", description: "What the formula does, in one or two sentences" },
      },
      required: ["formula", "explanation"],
    },
    maxTokens: 800,
    temperature: 0,
  });
  return { formula: cleanFormula(answer?.formula), explanation: clip(answer?.explanation, 600).trim() };
}

export async function suggestInsights(table: string, config?: AiConfig | null): Promise<InsightAnswer> {
  const answer = await structured<InsightAnswer>({
    config: config === undefined ? await configFor() : config,
    system:
      "You are a data analyst. Given a table's column summary and sample rows, state up to five short, specific, factual insights " +
      "(largest contributors, trends, unusual values, relationships). Only state what the numbers support; never invent values.",
    prompt: clip(table, MAX_TABLE),
    toolName: "record_insights",
    toolDescription: "Record the insights about the table.",
    schema: {
      type: "object",
      properties: {
        insights: {
          type: "array",
          maxItems: 5,
          items: { type: "object", properties: { title: { type: "string" }, text: { type: "string" } }, required: ["title", "text"] },
        },
      },
      required: ["insights"],
    },
    maxTokens: 1200,
    temperature: 0.2,
  });
  const list = Array.isArray(answer?.insights) ? answer.insights : [];
  return {
    insights: list
      .filter((x) => x && typeof x.text === "string" && x.text.trim())
      .slice(0, 5)
      .map((x) => ({ title: clip(x.title, 120).trim() || "Insight", text: clip(x.text, 600).trim() })),
  };
}
