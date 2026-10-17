/*
 * Brings boards over from an older Synergy Hub's SynergyBoards into Planner. Reads the hub's
 * export (deploy/hub-import/planner.sql) as JSON on stdin; deploy/hub-import/run.sh does both steps.
 *
 *   - Planner is SynergyBoards grown up, with the same tables, so workspaces, boards, members,
 *     lists, cards (issue keys, sprints, assignees, labels, checklists, comments, links, custom
 *     fields, work logs), the activity history and automations all come across as they were,
 *     keeping their ids. A row that is already here (same id) is left alone, so running it again
 *     adds only what is missing.
 *   - People are matched by email: someone who already uses Planner keeps their row and gets the
 *     hub's boards on it. Anyone else is added with their email and no sign-in subject, and their
 *     first sign-in claims that row (lib/session.ts). The mind becomes this Planner's mind.
 *   - Uploaded attachment files live in the hub's own volume, so those attachments are skipped
 *     (links and Drive attachments come across). Pending invites and notifications stay behind.
 *
 * Everything is written in one transaction. --dry-run does the whole import and rolls it back.
 */
import pg from 'pg';

const DRY = process.argv.slice(2).includes('--dry-run');

/** Parents before children, so every foreign key already has its row. */
const TABLES = [
  'workspaces', 'workspace_members', 'boards', 'board_members', 'board_stars', 'sprints', 'sprint_reports',
  'lists', 'labels', 'components', 'versions', 'custom_fields', 'cards', 'card_labels', 'card_members',
  'card_watchers', 'card_components', 'card_fix_versions', 'card_field_values', 'issue_links', 'checklists',
  'checklist_items', 'comments', 'attachments', 'work_logs', 'activities', 'automations', 'saved_filters',
];

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) throw new Error('No hub export on stdin. Run deploy/hub-import/run.sh.');
  return JSON.parse(text);
}

async function main() {
  const hub = await readStdin();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  const db = (text, params = []) => client.query(text, params);
  const log = (s) => console.log((DRY ? '[dry run] ' : '') + s);

  const [{ t }] = (await db(`SELECT to_regclass('cards') AS t`)).rows;
  if (!t) throw new Error('Planner has no tables yet. Start the planner service once so it migrates.');

  // Which columns each table has here, and which of them point at a person.
  const columns = new Map();
  for (const r of (await db(
    `SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema = current_schema()`)).rows) {
    if (!columns.has(r.table_name)) columns.set(r.table_name, new Map());
    columns.get(r.table_name).set(r.column_name, r.is_nullable === 'YES');
  }
  const userCols = new Map();
  for (const r of (await db(
    `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass`)).rows) {
    if (!userCols.has(r.tbl)) userCols.set(r.tbl, []);
    userCols.get(r.tbl).push(r.col);
  }

  await db('BEGIN');
  try {
    // People
    const person = new Map();
    let matched = 0, created = 0;
    for (const u of hub.users ?? []) {
      const email = u.email ? String(u.email).toLowerCase().trim() : null;
      let found;
      if (u.is_mind) {
        [found] = (await db(`SELECT id FROM users WHERE is_mind ORDER BY created_at LIMIT 1`)).rows;
      } else if (email) {
        [found] = (await db(
          `SELECT id FROM users WHERE lower(email) = $1 AND NOT is_mind ORDER BY auth_sub IS NULL, created_at LIMIT 1`,
          [email])).rows;
      }
      if (found) { person.set(u.id, found.id); matched++; continue; }
      const [row] = (await db(
        `INSERT INTO users (email, name, avatar_url, is_mind, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [u.is_mind ? u.email : email, u.name, u.avatar_url, !!u.is_mind, u.created_at])).rows;
      person.set(u.id, row.id); created++;
      log(`added ${u.is_mind ? 'the mind' : email ?? u.name}`);
    }

    // Uploaded files stay in the hub's attachment volume; links and Drive files come across.
    const skippedFiles = new Set((hub.attachments ?? []).filter((a) => a.storage_key).map((a) => a.id));
    const userFields = new Set((hub.custom_fields ?? []).filter((f) => f.type === 'user').map((f) => f.id));

    const summary = [];
    for (const table of TABLES) {
      const have = columns.get(table);
      const rows = [];
      let dropped = 0;
      for (const src of hub[table] ?? []) {
        const r = { ...src };
        if (table === 'attachments' && skippedFiles.has(r.id)) { dropped++; continue; }
        if (table === 'cards' && skippedFiles.has(r.cover)) r.cover = null;
        if (table === 'card_field_values' && userFields.has(r.field_id)) r.value = person.get(r.value) ?? null;
        if (table === 'card_field_values' && r.value === null) { dropped++; continue; }
        let keep = true;
        for (const c of userCols.get(table) ?? []) {
          if (r[c] == null) continue;
          r[c] = person.get(r[c]) ?? null;
          if (r[c] === null && !have.get(c)) keep = false;
        }
        if (!keep) { dropped++; continue; }
        if (table === 'workspaces') r.slug = await freeSlug(db, r.id, r.slug);
        rows.push(r);
      }
      if (!rows.length) continue;
      // Only the columns both sides have, so a newer Planner column keeps its default.
      const cols = Object.keys(rows[0]).filter((c) => have.has(c)).map((c) => `"${c}"`).join(', ');
      let added = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const res = await db(
          `INSERT INTO "${table}" (${cols}) SELECT ${cols} FROM json_populate_recordset(null::"${table}", $1::json)
           ON CONFLICT DO NOTHING`, [JSON.stringify(rows.slice(i, i + 500))]);
        added += res.rowCount;
      }
      summary.push(`${table.replace(/_/g, ' ')} ${added}${rows.length - added ? ` (+${rows.length - added} already here)` : ''}${dropped ? `, ${dropped} skipped` : ''}`);
    }

    await db(DRY ? 'ROLLBACK' : 'COMMIT');
    console.log(`\nPeople: ${matched} already in Planner, ${created} added (they claim their row when they first sign in).`);
    console.log(`Added: ${summary.join('; ') || 'nothing'}.`);
    if (skippedFiles.size) console.log(`${skippedFiles.size} uploaded attachment file(s) were not copied: they are in the hub's attachment volume.`);
    if (DRY) console.log('Dry run: nothing was written.');
  } catch (e) {
    await db('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

/** A hub workspace keeps its slug unless a different workspace here already uses it. */
async function freeSlug(db, id, slug) {
  for (let n = 0; ; n++) {
    const s = n ? `${slug}-hub${n > 1 ? n : ''}` : slug;
    const { rows } = await db(`SELECT id FROM workspaces WHERE slug = $1`, [s]);
    if (!rows.length || rows[0].id === id) return s;
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
