import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { q } from "@/lib/db";
import { identity } from "@/lib/identity";
import { docAccess, atLeast } from "@/lib/access";
import { cleanAnchor } from "@/lib/comment-anchor";

export const dynamic = "force-dynamic";

type In = {
  sheetId?: unknown;
  ref?: unknown;
  key?: unknown;
  quote?: unknown;
  resolved?: unknown;
  messages?: {
    author_name?: unknown;
    author_email?: unknown;
    body?: unknown;
    created_ms?: unknown;
  }[];
};

// Comment threads that came in with an opened file: Excel threaded comments
// (anchored to a cell) or Word comments (anchored by a mark in the document,
// so they carry the key the document uses for them and get back the new id).
// An author whose email is an account here that can open this document (its
// owner, someone it is shared with, or, for a document shared with the whole
// company, anyone who has used Docs in the org) is linked to that account, so
// the thread shows them as they appear elsewhere. Anyone else keeps the name
// from the file and no email: a file can't put words in the mouth of someone
// who can't see the document.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await identity();
  if (!me.email)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const a = await docAccess(id, me);
  if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!atLeast(a.role, "editor"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { threads?: In[] };
  const threads = Array.isArray(body.threads)
    ? body.threads.slice(0, 2000)
    : [];
  const wanted = [
    ...new Set(
      threads
        .flatMap((t) =>
          (Array.isArray(t.messages) ? t.messages : []).map((m) =>
            String(m?.author_email || "")
              .trim()
              .toLowerCase(),
          ),
        )
        .filter((e) => /^[^\s@]+@[^\s@]+$/.test(e) && e.length <= 320),
    ),
  ].slice(0, 500);
  const accounts = await linkedAccounts(id, me, a.doc, wanted);
  let imported = 0;
  const ids: Record<string, string> = {};
  for (const t of threads) {
    const key = typeof t.key === "string" && t.key.length <= 40 ? t.key : null;
    const anchor =
      key === null ? cleanAnchor({ sheetId: t.sheetId, ref: t.ref }) : "";
    const messages = (Array.isArray(t.messages) ? t.messages : [])
      .filter((m) => typeof m?.body === "string" && m.body.trim())
      .slice(0, 500);
    if ((key === null && !anchor) || !messages.length) continue;
    const threadId = randomBytes(9).toString("base64url");
    if (key !== null) ids[key] = threadId;
    const quote = typeof t.quote === "string" ? t.quote.slice(0, 300) : "";
    const first = Number(messages[0].created_ms);
    await q(
      `INSERT INTO comment_threads (id, doc_id, org, quote, anchor, resolved, created_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        threadId,
        id,
        me.org,
        quote,
        anchor,
        t.resolved === true,
        Number.isFinite(first) ? first : Date.now(),
      ],
    );
    for (const [i, m] of messages.entries()) {
      const account = accounts.get(
        String(m.author_email || "")
          .trim()
          .toLowerCase(),
      );
      const email = account?.email || "";
      const name =
        account?.name || String(m.author_name || "").slice(0, 200) || "Unknown";
      const at = Number(m.created_ms);
      await q(
        `INSERT INTO comments (id, thread_id, doc_id, org, author_email, author_name, body, created_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          randomBytes(9).toString("base64url"),
          threadId,
          id,
          me.org,
          email,
          name,
          String(m.body).slice(0, 4000),
          Number.isFinite(at) ? at : Date.now() + i,
        ],
      );
    }
    imported++;
  }
  return NextResponse.json({ imported, ids }, { status: 201 });
}

/** The authors' emails that are accounts able to open the document, with the name each goes by here. */
async function linkedAccounts(
  docId: string,
  me: { email: string; name: string; org: string },
  doc: { owner_email: string; scope: string },
  emails: string[],
): Promise<Map<string, { email: string; name: string }>> {
  const out = new Map<string, { email: string; name: string }>();
  out.set(me.email.toLowerCase(), { email: me.email, name: me.name });
  const rest = emails.filter((e) => !out.has(e));
  if (!rest.length) return out;
  const rows = await q<{ email: string }>(
    `SELECT lower(owner_email) AS email FROM documents WHERE id = $1 AND lower(owner_email) = ANY($3)
       UNION SELECT lower(email) FROM doc_grants WHERE doc_id = $1 AND org = $2 AND lower(email) = ANY($3)
       UNION SELECT lower(owner_email) FROM documents WHERE org = $2 AND $4 AND lower(owner_email) = ANY($3)
       UNION SELECT lower(email) FROM doc_grants WHERE org = $2 AND $4 AND lower(email) = ANY($3)
       UNION SELECT lower(author_email) FROM comments WHERE org = $2 AND $4 AND author_email <> '' AND lower(author_email) = ANY($3)`,
    [docId, me.org, rest, doc.scope === "company"],
  );
  if (!rows.length) return out;
  const found = rows.map((r) => r.email);
  // The name they last wrote a comment under (what other threads show), if any.
  const names = await q<{ email: string; author_name: string }>(
    `SELECT DISTINCT ON (lower(author_email)) lower(author_email) AS email, author_name FROM comments WHERE org = $1 AND lower(author_email) = ANY($2) ORDER BY lower(author_email), created_ms DESC`,
    [me.org, found],
  );
  const nameOf = new Map(names.map((r) => [r.email, r.author_name]));
  for (const e of found) out.set(e, { email: e, name: nameOf.get(e) || "" });
  return out;
}
