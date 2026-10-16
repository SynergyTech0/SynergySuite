/**
 * AI help writing queries, through the suite's bring-your-own model (@synergy/ai): AI_*
 * settings, or BASE_AI_* to give Base a model of its own. The model sees the database's tables
 * and fields (never its records) and answers with SQL, which is checked like any other query
 * before anyone runs it. If the SQL doesn't pass, the model is told why and asked once more.
 */
import { AiRequestError, AiUnavailableError, aiConfig, structured, type AiConfig } from "@synergy/ai";
import type { TableInfo } from "./catalog";
import { TYPE_LABELS } from "./fields";
import { HttpError } from "./http";
import { quoteName } from "./names";
import { prepareSql, QueryError, type SqlScope } from "./sql";

export function baseAiConfig(env?: Record<string, string | undefined>): AiConfig | null {
  try {
    return aiConfig({ prefix: "BASE_", env });
  } catch {
    return null; // a misconfigured provider reads as AI off
  }
}

const PG_TYPES: Record<string, string> = {
  autonumber: "bigint", text: "text", longtext: "text", number: "numeric", currency: "numeric(19,4)", date: "date",
  datetime: "timestamptz", yesno: "boolean", choice: "text", multichoice: "text[]", email: "text", hyperlink: "text",
  phone: "text", lookup: "bigint", multilookup: "bigint[]",
};

/** The database's tables as the model sees them: names, types and relationships, no data. */
export function describeSchema(tables: TableInfo[], queries: { name: string; sql: string }[] = []): string {
  const byId = new Map(tables.map((t) => [t.id, t]));
  const lines = tables.map((t) => {
    const cols = t.fields.map((f) => {
      let s = `  ${quoteName(f.name)} ${PG_TYPES[f.type]} -- ${TYPE_LABELS[f.type]}`;
      if (f.type === "autonumber") s += ", primary key";
      if (f.type === "lookup") {
        const target = byId.get(f.options.targetTable ?? "");
        if (target) s += `, references ${quoteName(target.name)}.${quoteName(target.fields.find((x) => x.type === "autonumber")?.name ?? "ID")}`;
      }
      if (f.type === "multilookup") {
        const target = byId.get(f.options.targetTable ?? "");
        if (target) s += `, IDs of ${quoteName(target.name)} records (match with = ANY(...))`;
      }
      if ((f.type === "choice" || f.type === "multichoice") && f.options.choices?.length) s += `, one of: ${f.options.choices.slice(0, 30).join(", ")}`;
      if (f.description) s += ` (${f.description.slice(0, 120)})`;
      return s;
    });
    return `${quoteName(t.name)}${t.description ? ` -- ${t.description.slice(0, 200)}` : ""}\n${cols.join("\n")}`;
  });
  const saved = queries.slice(0, 30).map((q) => `${quoteName(q.name)} AS (${q.sql.slice(0, 1500)})`);
  return lines.join("\n\n") + (saved.length ? `\n\nSaved queries (can be read like tables):\n${saved.join("\n")}` : "");
}

const SCHEMA = {
  type: "object",
  properties: {
    sql: { type: "string", description: "One PostgreSQL SELECT statement over the tables listed, with every table and field name in double quotes." },
    explanation: { type: "string", description: "One or two plain sentences saying what the query returns." },
  },
  required: ["sql", "explanation"],
};

const SYSTEM =
  "You write PostgreSQL SELECT queries for a database app like Microsoft Access. Use only the tables, fields and saved queries listed, " +
  "always in double quotes exactly as written, with no schema prefix. Write one SELECT (WITH and UNION are fine). Use ordinary functions only " +
  "(aggregates, text, maths, date_trunc, extract, to_char, coalesce, window functions); no system tables or catalog functions. " +
  "A lookup field holds the ID of a record in the table it references: join on it to show that record's fields. " +
  "Text matching should be case-insensitive (ILIKE). Give columns readable aliases in double quotes. " +
  "If the request can't be answered from these tables, write the closest useful query and say what is missing in the explanation. " +
  "Write the explanation in the language of the request.";

export type AiAnswer = { sql: string; explanation: string };

/** SQL for a question about the database, checked against `scope`. `current` is the query open now, if any. */
export async function askForSql(question: string, tables: TableInfo[], scope: SqlScope, current: string | undefined, config: AiConfig): Promise<AiAnswer> {
  const queries = [...(scope.queries ?? [])].map(([name, sql]) => ({ name, sql }));
  const schema = describeSchema(tables, queries);
  let prompt = `Tables:\n${schema}\n\n${current?.trim() ? `The query open now:\n${current.slice(0, 8000)}\n\n` : ""}Request: ${question.slice(0, 4000)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const answer = await structured<Partial<AiAnswer>>({
      config,
      system: SYSTEM,
      prompt,
      toolName: "write_query",
      toolDescription: "Record the SQL query and a short explanation.",
      schema: SCHEMA,
      maxTokens: 2000,
      temperature: 0.1,
    });
    const sql = String(answer?.sql ?? "").trim().replace(/^```(?:sql)?\s*|\s*```$/g, "").replace(/;\s*$/, "");
    const explanation = String(answer?.explanation ?? "").slice(0, 1000);
    try {
      prepareSql(sql, scope);
      return { sql, explanation };
    } catch (e) {
      if (!(e instanceof QueryError) || attempt === 1) {
        throw new HttpError(422, `The AI's query didn't work: ${(e as Error).message}. Try asking another way.`);
      }
      prompt += `\n\nYour previous answer was:\n${sql}\nIt was refused: ${e.message}. Write it again so it follows the rules.`;
    }
  }
  throw new HttpError(422, "The AI couldn't write that query");
}

/** A user-facing message and HTTP status for an AI failure. */
export function aiFailure(e: unknown): HttpError {
  if (e instanceof HttpError) return e;
  if (e instanceof AiUnavailableError) return new HttpError(503, e.message);
  if (e instanceof AiRequestError) return new HttpError(502, `The AI model could not answer: ${e.message}`);
  throw e;
}
