import { AiRequestError, AiUnavailableError, aiConfig, structured } from "@synergy/ai";
import type { Me } from "./api";
import { access, logEvent } from "./contracts";
import { q, tx } from "./db";
import { UserError } from "./util";

/**
 * AI contract review on the suite's bring-your-own model (@synergy/ai): the AI_* settings, or
 * CONTRACTS_AI_* to give Contracts its own model. It reads the text against the clause library's
 * required clauses and their guidance, and the answer is kept on the contract for people to read.
 * It is a first pass for a person, never a decision: nothing changes in the contract.
 */
export const AI_PREFIX = "CONTRACTS_";

export function reviewAvailable(): boolean {
  try {
    return !!aiConfig({ prefix: AI_PREFIX });
  } catch {
    return false;
  }
}

export type Review = {
  summary: string;
  parties: string[];
  keyDates: { label: string; date: string }[];
  paymentTerms: string;
  termination: string;
  risks: { severity: "high" | "medium" | "low"; clause: string; issue: string; suggestion: string }[];
  missing: { clause: string; why: string }[];
  obligations: { title: string; due: string; party: string }[];
};

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "Three to five sentences: what the contract is, who it binds and its main commercial terms." },
    parties: { type: "array", items: { type: "string" } },
    keyDates: {
      type: "array",
      items: { type: "object", properties: { label: { type: "string" }, date: { type: "string", description: "As written, or YYYY-MM-DD" } }, required: ["label", "date"] },
    },
    paymentTerms: { type: "string", description: "Fees, timing and late payment, or 'Not stated'." },
    termination: { type: "string", description: "How either side can end it and any notice periods, or 'Not stated'." },
    risks: {
      type: "array",
      description: "Terms that are unusual, one-sided, vague or against the guidance given. Most serious first.",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["high", "medium", "low"] },
          clause: { type: "string", description: "Section heading or a few quoted words" },
          issue: { type: "string" },
          suggestion: { type: "string", description: "What to ask for instead" },
        },
        required: ["severity", "clause", "issue", "suggestion"],
      },
    },
    missing: {
      type: "array",
      description: "Required clauses from the list given that the text does not cover.",
      items: { type: "object", properties: { clause: { type: "string" }, why: { type: "string" } }, required: ["clause", "why"] },
    },
    obligations: {
      type: "array",
      description: "Things one side must do by a date or on a schedule (reports, payments, notices, renewals).",
      items: { type: "object", properties: { title: { type: "string" }, due: { type: "string" }, party: { type: "string" } }, required: ["title", "due", "party"] },
    },
  },
  required: ["summary", "parties", "keyDates", "paymentTerms", "termination", "risks", "missing", "obligations"],
};

const MAX_CHARS = 120_000;

export async function reviewContract(me: Me, id: string): Promise<Review> {
  const { c, role } = await access(me.email, id);
  if (role === "viewer") throw new UserError("Ask the owner for edit access to run a review", 403);
  const cfg = (() => {
    try {
      return aiConfig({ prefix: AI_PREFIX });
    } catch (e) {
      throw new UserError((e as Error).message, 503);
    }
  })();
  if (!cfg) throw new UserError("AI is off. An administrator can turn it on with the AI settings.", 503);
  const [{ body }] = await q<{ body: string }>(`SELECT body FROM contracts WHERE id = $1`, [id]);
  if (!body.trim()) throw new UserError("There's no contract text to review yet", 400);
  const required = await q<{ title: string; guidance: string }>(`SELECT title, guidance FROM clauses WHERE required AND NOT archived ORDER BY title`);
  const playbook = await q<{ title: string; guidance: string }>(
    `SELECT title, guidance FROM clauses WHERE NOT required AND NOT archived AND guidance <> '' ORDER BY title LIMIT 60`,
  );
  const lines = [
    `Contract type: ${c.type}. Our side is the party that is not "${c.counterparty || "the counterparty"}".`,
    required.length ? `Required clauses:\n${required.map((r) => `- ${r.title}${r.guidance ? `: ${r.guidance}` : ""}`).join("\n")}` : "No required clauses are set.",
    playbook.length ? `Our positions on other clauses:\n${playbook.map((r) => `- ${r.title}: ${r.guidance}`).join("\n")}` : "",
    `Contract text${body.length > MAX_CHARS ? " (cut short, it is long)" : ""}:\n"""\n${body.slice(0, MAX_CHARS)}\n"""`,
  ].filter(Boolean);
  let review: Review;
  try {
    review = await structured<Review>({
      config: cfg,
      system:
        "You review contracts for a business's in-house legal team. Read only the text given; never invent terms it doesn't contain. " +
        "Flag risk from our side's point of view. Be specific and short.",
      prompt: lines.join("\n\n"),
      toolName: "record_review",
      toolDescription: "Record the contract review.",
      schema: SCHEMA,
      maxTokens: 4000,
    });
  } catch (e) {
    if (e instanceof AiUnavailableError) throw new UserError("AI is off. An administrator can turn it on with the AI settings.", 503);
    if (e instanceof AiRequestError) throw new UserError(`The AI model didn't answer: ${e.message}`, 502);
    throw e;
  }
  const clean: Review = {
    summary: String(review.summary ?? ""),
    parties: Array.isArray(review.parties) ? review.parties.map(String).slice(0, 10) : [],
    keyDates: Array.isArray(review.keyDates) ? review.keyDates.slice(0, 20) : [],
    paymentTerms: String(review.paymentTerms ?? ""),
    termination: String(review.termination ?? ""),
    risks: Array.isArray(review.risks) ? review.risks.filter((r) => ["high", "medium", "low"].includes(r?.severity)).slice(0, 30) : [],
    missing: Array.isArray(review.missing) ? review.missing.slice(0, 30) : [],
    obligations: Array.isArray(review.obligations) ? review.obligations.slice(0, 30) : [],
  };
  await tx(async (tq) => {
    await tq(`UPDATE contracts SET ai_review = $2, ai_reviewed_at = now() WHERE id = $1`, [id, JSON.stringify(clean)]);
    await logEvent(tq, id, "reviewed", `AI review: ${clean.risks.length} risks, ${clean.missing.length} missing clauses`, me.email);
  });
  return clean;
}
