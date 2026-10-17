/*
 * Brings documents, spreadsheets and presentations over from an older Synergy Hub's SynergyDocs
 * into Office. Reads the hub's export (deploy/hub-import/docs.sql) as JSON on stdin;
 * deploy/hub-import/run.sh does both steps.
 *
 * Office grew out of SynergyDocs and keeps documents the same way (the shared Yjs state, and a
 * spreadsheet's saved Univer workbook), so each one comes across as it is: same id, owner,
 * title, sharing, comments and version history. Everything lands in this Office's
 * organization (DOCS_ORG, default "synergy"), whatever the hub called its own.
 *
 * Safe to run again: a document already here (same id) is left as it is, edits included.
 * --dry-run prints the plan only.
 */
import pg from "pg";

const DRY = process.argv.includes("--dry-run");
const ORG = process.env.DOCS_ORG || "synergy";

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) throw new Error("No hub export on stdin. Run deploy/hub-import/run.sh.");
  return JSON.parse(text);
}

const KIND = { doc: "document", sheet: "spreadsheet", slide: "presentation" };

async function main() {
  const hub = await readStdin();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const log = (s) => console.log((DRY ? "[dry run] " : "") + s);

  const [ready] = (await pool.query(
    `SELECT to_regclass('documents') AS docs, to_regclass('doc_versions') AS versions,
            EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'doc_versions' AND column_name = 'state') AS current`,
  )).rows;
  if (!ready.docs || !ready.versions || !ready.current) throw new Error("Office hasn't set up its database yet. Open Office once, then run this again.");

  const docs = (hub.documents ?? []).map((d) => ({ ...d, owner_email: String(d.owner_email).trim().toLowerCase() }));
  const have = new Set((await pool.query("SELECT id FROM documents WHERE id = ANY($1::text[])", [docs.map((d) => d.id)])).rows.map((r) => r.id));
  const fresh = docs.filter((d) => !have.has(d.id));
  const ids = new Set(fresh.map((d) => d.id));
  // Sharing, comments and versions come only with a document that is new here.
  const of = (rows) => (rows ?? []).filter((r) => ids.has(r.doc_id));
  const grants = of(hub.doc_grants).map((g) => ({ ...g, email: String(g.email).trim().toLowerCase() }));
  const threads = of(hub.comment_threads), comments = of(hub.comments), versions = of(hub.doc_versions);
  for (const d of fresh) log(`${d.title || "Untitled"} (${KIND[d.kind] ?? d.kind}, ${d.owner_email})`);

  const added = { documents: fresh.length, grants: grants.length, comments: comments.length, versions: versions.length };
  if (!DRY && fresh.length) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const json = (rows) => JSON.stringify(rows);
      added.documents = (await client.query(
        `INSERT INTO documents (id, org, owner_email, kind, title, snippet, ydoc, snapshot, created_at, updated_at, scope, company_role, starred)
         SELECT id, $2, owner_email, coalesce(kind, 'doc'), coalesce(title, ''), coalesce(snippet, ''), decode(ydoc, 'base64'), snapshot,
                created_at, updated_at, coalesce(scope, 'private'), company_role, coalesce(starred, false)
         FROM json_to_recordset($1::json) AS x(id text, owner_email text, kind text, title text, snippet text, ydoc text, snapshot jsonb,
              created_at timestamptz, updated_at timestamptz, scope text, company_role text, starred boolean)
         ON CONFLICT (id) DO NOTHING RETURNING id`, [json(fresh), ORG])).rowCount;
      added.grants = (await client.query(
        `INSERT INTO doc_grants (doc_id, org, email, role, granted_by, created_ms)
         SELECT doc_id, $2, email, role, granted_by, created_ms
         FROM json_to_recordset($1::json) AS x(doc_id text, email text, role text, granted_by text, created_ms bigint)
         ON CONFLICT DO NOTHING`, [json(grants), ORG])).rowCount;
      await client.query(
        `INSERT INTO comment_threads (id, doc_id, org, quote, resolved, created_ms)
         SELECT id, doc_id, $2, coalesce(quote, ''), coalesce(resolved, false), created_ms
         FROM json_to_recordset($1::json) AS x(id text, doc_id text, quote text, resolved boolean, created_ms bigint)
         ON CONFLICT DO NOTHING`, [json(threads), ORG]);
      added.comments = (await client.query(
        `INSERT INTO comments (id, thread_id, doc_id, org, author_email, author_name, body, created_ms)
         SELECT id, thread_id, doc_id, $2, author_email, author_name, body, created_ms
         FROM json_to_recordset($1::json) AS x(id text, thread_id text, doc_id text, author_email text, author_name text, body text, created_ms bigint)
         ON CONFLICT DO NOTHING`, [json(comments), ORG])).rowCount;
      added.versions = (await client.query(
        `INSERT INTO doc_versions (id, doc_id, org, author_email, author_name, html, label, created_ms)
         SELECT id, doc_id, $2, author_email, author_name, html, label, created_ms
         FROM json_to_recordset($1::json) AS x(id text, doc_id text, author_email text, author_name text, html text, label text, created_ms bigint)
         ON CONFLICT DO NOTHING`, [json(versions), ORG])).rowCount;
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  console.log(`\nDocuments: ${added.documents} added, ${docs.length - fresh.length} already here.`);
  console.log(`With them: ${added.grants} shares, ${added.comments} comments, ${added.versions} saved versions.`);
  if (DRY) console.log("Dry run: nothing was written.");
  await pool.end();
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
