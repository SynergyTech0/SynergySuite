import { type SearchResult, type SearchResults, clipText, queryToSql, readSearchQuery, snippet } from "@synergy/search";
import { prisma } from "@/lib/db";
import { APP } from "@/lib/compliance";

/** What suite search can ask Sign for. */
export const KINDS = ["document"];

const TEXT = ['d."title"', 'd."description"', 'd."originalFileName"', 'd."aiSummary"', "u.name", "u.email"];

type Row = {
  id: string; title: string; description: string | null; status: string; created_at: Date; sender: string;
  mine: boolean; token: string | null; my_status: string | null;
};

/**
 * Suite search for one person: documents they sent, and documents sent to them for signature
 * (by their email), by title, description, file name and summary. Never documents deleted under a hold.
 */
export async function searchFor(me: { email: string; id: string }, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  if (s.kinds.length && !s.kinds.includes("document")) return { app: APP, results: [] };
  const params: unknown[] = [me.id, me.email.toLowerCase(), s.limit];
  const words = queryToSql(s.parsed, TEXT, params.length + 1);
  params.push(...words.params);
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT d.id, d."title" AS title, d."description" AS description, d."status"::text AS status, d."createdAt" AS created_at,
            lower(u.email) AS sender, d."senderId" = $1 AS mine, ms.token, ms."status"::text AS my_status
     FROM documents d
     JOIN users u ON u.id = d."senderId"
     LEFT JOIN LATERAL (SELECT s.token, s."status" FROM document_signers s
                        WHERE s."documentId" = d.id AND lower(s.email) = $2 ORDER BY s."order" LIMIT 1) ms ON TRUE
     WHERE d."heldDeletedAt" IS NULL AND (d."senderId" = $1 OR ms."status" IS NOT NULL) AND ${words.sql}
     ORDER BY d."createdAt" DESC, d.id
     LIMIT $3`,
    ...params,
  );
  const results = rows.map((r): SearchResult => {
    const waiting = !r.mine && r.my_status === "PENDING" && r.status === "SENT";
    const line = r.mine ? `Sent by you · ${r.status.toLowerCase()}` : waiting ? `Waiting for your signature · from ${r.sender}` : `From ${r.sender} · ${r.status.toLowerCase()}`;
    return {
      id: r.id,
      kind: "document",
      title: r.title,
      snippet: r.description ? snippet(r.description, s.parsed) : line,
      date: new Date(r.created_at).toISOString(),
      url: r.mine ? `/dashboard/documents/${r.id}` : r.token ? `/sign/${r.token}` : "/dashboard",
      person: r.sender,
      ...(s.text ? { text: clipText([r.title, line, r.description].filter(Boolean).join("\n")) } : {}),
    };
  });
  return { app: APP, results };
}
