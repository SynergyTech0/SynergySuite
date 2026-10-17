import { type ExportItem, type SearchHit, type SearchResponse, MAX_ATTACHMENT_BYTES, queryToSql } from "@synergy/compliance";
import { prisma } from "@/lib/db";
import { getFileBuffer } from "@/lib/storage";
import { APP, type Search, nextCursor, snippet } from "@/lib/compliance";

/**
 * Sign's content for the Admin center: documents sent for signature. Each belongs to its sender;
 * the signers are its other people. Documents deleted under a legal hold are included, marked deleted.
 */
export const KINDS = ["document"];

const TEXT = ['d."title"', 'd."description"', 'd."originalFileName"', 'd."aiSummary"', "u.email", "u.name"];

const PEOPLE = `ARRAY(SELECT DISTINCT lower(s.email) FROM document_signers s WHERE s."documentId" = d.id AND lower(s.email) <> lower(u.email) ORDER BY 1)`;

type Row = {
  id: string; title: string; description: string | null; ai_summary: string | null; status: string; owner: string;
  participants: string[]; created_at: Date; held_deleted_at: Date | null; file_size: number; original_file_name: string;
  total: bigint | number;
};

const SELECT = `SELECT d.id, d."title" AS title, d."description" AS description, d."aiSummary" AS ai_summary, d."status"::text AS status,
  lower(u.email) AS owner, ${PEOPLE} AS participants, d."createdAt" AS created_at, d."heldDeletedAt" AS held_deleted_at,
  d."fileSize" AS file_size, d."originalFileName" AS original_file_name`;

function hit(r: Row, s: Pick<Search, "query">): SearchHit {
  const body = [r.description, r.ai_summary].filter(Boolean).join(" ");
  return {
    id: r.id,
    kind: "document",
    title: r.title,
    owner: r.owner,
    ...(r.participants.length ? { participants: r.participants } : {}),
    date: new Date(r.created_at).toISOString(),
    snippet: snippet(body || `${r.original_file_name} (${r.status.toLowerCase()})`, s.query),
    size: Number(r.file_size) || 0,
    ...(r.held_deleted_at ? { deleted: true } : {}),
  };
}

/** Documents matching an eDiscovery search, those deleted under a hold included. */
export async function search(s: Search): Promise<SearchResponse> {
  if (s.kinds && !s.kinds.includes("document")) return { app: APP, hits: [], total: 0 };
  const params: unknown[] = [s.custodians, s.from, s.until, s.limit, s.offset];
  const words = queryToSql(s.query, TEXT, params.length + 1);
  params.push(...words.params);
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `${SELECT}, COUNT(*) OVER () AS total
     FROM documents d JOIN users u ON u.id = d."senderId"
     WHERE ${words.sql}
       AND (cardinality($1::text[]) = 0 OR lower(u.email) = ANY($1::text[])
            OR EXISTS (SELECT 1 FROM document_signers s WHERE s."documentId" = d.id AND lower(s.email) = ANY($1::text[])))
       AND ($2::timestamptz IS NULL OR d."createdAt" >= $2::timestamptz)
       AND ($3::timestamptz IS NULL OR d."createdAt" < $3::timestamptz)
     ORDER BY d."createdAt" DESC, d.id
     LIMIT $4 OFFSET $5`,
    ...params,
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { app: APP, hits: rows.map((r) => hit(r, s)), total, nextCursor: nextCursor(s, s.offset + rows.length < total) };
}

async function attachment(name: string, storagePath: string | null, provider: "LOCAL" | "AWS" | "AZURE" | "GOOGLE") {
  if (!storagePath) return null;
  try {
    const buf = await getFileBuffer(storagePath, provider);
    if (buf.length > MAX_ATTACHMENT_BYTES) return { name, type: "application/pdf", size: buf.length, skipped: "too large" };
    return { name, type: "application/pdf", size: buf.length, base64: buf.toString("base64") };
  } catch (e) {
    return { name, type: "application/pdf", size: 0, skipped: `unreadable: ${(e as Error).message}` };
  }
}

/** Each document in full: who signed when, the audit trail, and the original and signed PDFs. */
export async function exportItems(ids: string[]): Promise<{ items: ExportItem[] }> {
  const wanted = ids.filter((i) => /^[a-z0-9_-]{8,64}$/i.test(i));
  if (!wanted.length) return { items: [] };
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `${SELECT}, 0 AS total FROM documents d JOIN users u ON u.id = d."senderId" WHERE d.id = ANY($1::text[])`,
    wanted,
  );
  const items: ExportItem[] = [];
  for (const r of rows) {
    // The extended client hides held documents; ask for them explicitly.
    const doc = await prisma.document.findFirst({
      where: { id: r.id, heldDeletedAt: r.held_deleted_at ? { not: null } : null },
      include: {
        signers: { orderBy: { order: "asc" } },
        auditLogs: { orderBy: { timestamp: "asc" } },
      },
    });
    if (!doc) continue;
    const attachments = (
      await Promise.all([
        attachment(doc.originalFileName || `${doc.id}.pdf`, doc.cloudStoragePath, doc.cloudProvider),
        attachment(`signed-${doc.originalFileName || `${doc.id}.pdf`}`, doc.signedDocumentPath, doc.cloudProvider),
      ])
    ).filter((a): a is NonNullable<typeof a> => a !== null);
    items.push({
      ...hit(r, { query: { groups: [], none: [] } }),
      app: APP,
      metadata: {
        status: doc.status,
        signingOrder: doc.signingOrder,
        deadline: doc.deadline?.toISOString() ?? null,
        completedAt: doc.completedAt?.toISOString() ?? null,
        documentHash: doc.documentHash,
        signers: doc.signers.map((s) => ({
          name: s.name, email: s.email, order: s.order, status: s.status,
          signedAt: s.signedAt?.toISOString() ?? null, declinedAt: s.declinedAt?.toISOString() ?? null,
          ipAddress: s.ipAddress, userAgent: s.userAgent,
        })),
        auditTrail: doc.auditLogs.map((a) => ({
          action: a.action, at: a.timestamp.toISOString(), ipAddress: a.ipAddress, details: a.details,
        })),
        ...(doc.heldDeletedAt ? { deletedAt: doc.heldDeletedAt.toISOString() } : {}),
      },
      text: [doc.title, doc.description, doc.aiSummary].filter(Boolean).join("\n\n"),
      attachments,
    });
  }
  return { items };
}

/**
 * Deletes a document, unless its sender or one of its signers is under a legal hold: then it is
 * kept (files and all) for eDiscovery and its signing links stop working. Returns how it went.
 */
export async function deleteDocument(id: string, onHold: (email: string) => Promise<boolean>): Promise<"deleted" | "held"> {
  const doc = await prisma.document.findUnique({
    where: { id },
    select: { id: true, cloudStoragePath: true, signedDocumentPath: true, cloudProvider: true, sender: { select: { email: true } }, signers: { select: { email: true } } },
  });
  if (!doc) throw Object.assign(new Error("Document not found"), { code: "P2025" });
  for (const e of [doc.sender.email, ...doc.signers.map((s) => s.email)]) {
    if (await onHold(e)) {
      await prisma.$transaction([
        prisma.documentSigner.updateMany({ where: { documentId: id }, data: { token: null } }),
        prisma.document.update({ where: { id }, data: { heldDeletedAt: new Date() } }),
      ]);
      return "held";
    }
  }
  const { deleteFile } = await import("@/lib/storage");
  for (const p of [doc.cloudStoragePath, doc.signedDocumentPath]) {
    if (!p) continue;
    // A document made from a template shares the template's file.
    const shared =
      (await prisma.template.count({ where: { cloudStoragePath: p } })) +
      (await prisma.document.count({ where: { cloudStoragePath: p, id: { not: id } } }));
    if (shared) continue;
    try {
      await deleteFile(p, doc.cloudProvider);
    } catch (err) {
      console.warn("[sign] file delete warning:", (err as Error).message);
    }
  }
  await prisma.document.delete({ where: { id } });
  return "deleted";
}
