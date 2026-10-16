/**
 * POST /api/search: suite-wide search on behalf of the signed-in person (see @synergy/search).
 *
 * Who can see what, as lib/access.ts decides it: a document, spreadsheet or presentation is
 * visible to its owner, to anyone with a per-person grant (doc_grants), and to the whole org when
 * it is shared with the company (scope 'company' with a company role).
 *
 * What is searched: the title and the stored snippet of every kind, and for spreadsheets the cell
 * text and sheet names in the saved workbook snapshot. The body of a document or presentation is
 * kept only as Yjs state (binary), so it is not searchable here beyond its snippet.
 */
import { identify, optionsFromEnv } from "@synergy/identity";
import { readSearchQuery, queryToSql, matchesQuery, snippet, clipText, SearchInputError, type SearchResult, type SearchResults } from "@synergy/search";
import { q } from "@/lib/db";

export const KINDS = ["doc", "sheet", "slide"] as const;
const HREF: Record<string, (id: string) => string> = {
  doc: (id) => `/doc/${id}`,
  sheet: (id) => `/sheet/${id}`,
  slide: (id) => `/slides/${id}`,
};
/** Most rows read before the exact text check; the SQL prefilter keeps this generous. */
const SCAN = 300;
/** Most characters of a workbook's text looked at. */
const MAX_SHEET_TEXT = 200_000;

type Row = { id: string; kind: string; title: string; snippet: string; owner_email: string; updated_at: string; snapshot: unknown };

/** Sheet names and cell text (values and rich text) of a Univer workbook snapshot. */
export function workbookText(snapshot: unknown): string {
  const out: string[] = [];
  let size = 0;
  const push = (s: string) => {
    if (!s || size > MAX_SHEET_TEXT) return;
    out.push(s);
    size += s.length + 1;
  };
  const sheets = (snapshot as { sheets?: Record<string, any> } | null)?.sheets;
  if (!sheets || typeof sheets !== "object") return "";
  for (const sheet of Object.values(sheets)) {
    if (!sheet || typeof sheet !== "object") continue;
    if (typeof sheet.name === "string") push(sheet.name);
    for (const row of Object.values((sheet.cellData ?? {}) as Record<string, Record<string, any>>)) {
      for (const cell of Object.values(row ?? {})) {
        if (!cell || typeof cell !== "object") continue;
        const rich = cell.p?.body?.dataStream;
        if (typeof rich === "string") push(rich.replace(/[\r\n]+$/, ""));
        else if (typeof cell.v === "string" || typeof cell.v === "number") push(String(cell.v));
      }
    }
  }
  return out.join("\n");
}

export async function searchDocs(me: { email: string; org: string }, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  const kinds = s.kinds.length ? KINDS.filter((k) => s.kinds.includes(k)) : [...KINDS];
  if (!kinds.length) return { app: "office", results: [] };
  // Narrow in SQL with the positive terms over a superset of the text (the sheet snapshot as JSON);
  // the exact match, -words included, runs on the visible text below.
  const f = queryToSql({ groups: s.parsed.groups, none: [] }, ["d.title", "d.snippet", "CASE WHEN d.kind = 'sheet' THEN d.snapshot::text END"], 4);
  const rows = await q<Row>(
    `SELECT d.id, d.kind, d.title, d.snippet, d.owner_email, d.updated_at,
            CASE WHEN d.kind = 'sheet' THEN d.snapshot END AS snapshot
       FROM documents d
      WHERE d.org = $1 AND d.kind = ANY($3)
        AND (d.owner_email = $2
             OR (d.scope = 'company' AND d.company_role IS NOT NULL)
             OR EXISTS (SELECT 1 FROM doc_grants g WHERE g.doc_id = d.id AND g.org = d.org AND g.email = $2))
        AND ${f.sql}
      ORDER BY d.updated_at DESC LIMIT ${SCAN}`,
    [me.org, me.email, kinds, ...f.params],
  );
  const results: SearchResult[] = [];
  for (const r of rows) {
    const cells = r.kind === "sheet" ? workbookText(r.snapshot) : "";
    const text = [r.title, r.snippet, cells].filter(Boolean).join("\n");
    if (!matchesQuery(text, s.parsed)) continue;
    const content = cells || r.snippet;
    results.push({
      id: r.id,
      kind: r.kind,
      title: r.title,
      snippet: snippet(content || r.title, s.parsed),
      date: new Date(r.updated_at).toISOString(),
      url: (HREF[r.kind] ?? HREF.doc)(r.id),
      person: r.owner_email,
      ...(s.text ? { text: clipText(`${r.title}\n${content}`) } : {}),
    });
    if (results.length >= s.limit) break;
  }
  return { app: "office", results };
}

/** The route: the same gateway identity check as the rest of the API (lib/identity.ts). */
export async function handleSearch(req: Request): Promise<Response> {
  const who = identify(req.headers, optionsFromEnv());
  if (!who?.email) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    // Same org as lib/identity.ts (which reads next/headers, so it is not used here).
    return Response.json(await searchDocs({ email: who.email, org: process.env.DOCS_ORG || "synergy" }, body));
  } catch (e) {
    if (e instanceof SearchInputError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
