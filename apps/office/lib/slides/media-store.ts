// Audio and video embedded in presentations live outside the collaborative
// document (a few MB would bloat every sync): each upload is a row here and the
// slide stores its URL (/api/docs/<doc>/media/<id>).
import { pool, q } from "@/lib/db";

export const MEDIA_MAX_BYTES = 100 * 1024 * 1024;
/** What can be stored: what browsers play, plus Windows Media and AVI, kept so PowerPoint still plays them (shown as their poster here). */
export const MEDIA_TYPES = /^(video\/(mp4|webm|ogg|quicktime|x-m4v|x-ms-wmv|x-msvideo|x-ms-asf)|audio\/(mpeg|mp3|mp4|x-m4a|aac|wav|x-wav|wave|ogg|webm|flac|x-ms-wma)|model\/gltf-binary)$/;

declare global {
  // eslint-disable-next-line no-var
  var __slidesMediaSchema: Promise<void> | undefined;
}

function ensureMediaTable(): Promise<void> {
  if (!global.__slidesMediaSchema) {
    global.__slidesMediaSchema = q(`
      CREATE TABLE IF NOT EXISTS doc_media (
        id         TEXT PRIMARY KEY,
        doc_id     TEXT NOT NULL,
        org        TEXT NOT NULL,
        mime       TEXT NOT NULL,
        name       TEXT NOT NULL DEFAULT '',
        size       BIGINT NOT NULL,
        bytes      BYTEA NOT NULL,
        created_by TEXT NOT NULL,
        created_ms BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS doc_media_doc_idx ON doc_media(doc_id);
    `)
      .then(() => undefined)
      .catch((e) => {
        global.__slidesMediaSchema = undefined;
        throw e;
      });
  }
  return global.__slidesMediaSchema;
}

export async function putMedia(row: { id: string; docId: string; org: string; mime: string; name: string; bytes: Buffer; by: string }) {
  await ensureMediaTable();
  await pool().query(
    `INSERT INTO doc_media (id, doc_id, org, mime, name, size, bytes, created_by, created_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [row.id, row.docId, row.org, row.mime, row.name.slice(0, 200), row.bytes.length, row.bytes, row.by, Date.now()],
  );
}

export async function mediaInfo(docId: string, org: string, id: string): Promise<{ mime: string; size: number; name: string } | null> {
  await ensureMediaTable();
  const r = await q<{ mime: string; size: string; name: string }>(`SELECT mime, size, name FROM doc_media WHERE id = $1 AND doc_id = $2 AND org = $3`, [id, docId, org]);
  return r[0] ? { mime: r[0].mime, size: Number(r[0].size), name: r[0].name } : null;
}

/** Bytes [start, end] (inclusive) of a media file. */
export async function mediaBytes(docId: string, org: string, id: string, start: number, end: number): Promise<Buffer | null> {
  await ensureMediaTable();
  const r = await q<{ b: Buffer }>(`SELECT substring(bytes FROM $4::int FOR $5::int) AS b FROM doc_media WHERE id = $1 AND doc_id = $2 AND org = $3`, [id, docId, org, start + 1, end - start + 1]);
  return r[0]?.b ?? null;
}

/** Remove every media file of a document (when the document is deleted). */
export async function deleteDocMedia(docId: string, org: string): Promise<number> {
  await ensureMediaTable();
  const r = await pool().query(`DELETE FROM doc_media WHERE doc_id = $1 AND org = $2`, [docId, org]);
  return r.rowCount ?? 0;
}

/** Copies of a document's media files for another document, with new ids (old id -> new id). */
export async function copyDocMedia(from: string, to: string, org: string, by: string, ids: string[], newId: () => string): Promise<Map<string, string>> {
  await ensureMediaTable();
  const out = new Map<string, string>();
  for (const id of [...new Set(ids)]) {
    const nid = newId();
    const r = await pool().query(
      `INSERT INTO doc_media (id, doc_id, org, mime, name, size, bytes, created_by, created_ms)
       SELECT $1, $2, org, mime, name, size, bytes, $3, $4 FROM doc_media WHERE id = $5 AND doc_id = $6 AND org = $7`,
      [nid, to, by, Date.now(), id, from, org],
    );
    if (r.rowCount) out.set(id, nid);
  }
  return out;
}
