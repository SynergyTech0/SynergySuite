import { sql } from "drizzle-orm";
import { db, pool } from "@/db";

/** Every table in db/schema.ts, child-first for readability (CASCADE does the real work). */
const TABLES = [
  "activities",
  "automations",
  "attachments",
  "card_labels",
  "card_members",
  "checklist_items",
  "checklists",
  "comments",
  "notifications",
  "card_watchers",
  "card_field_values",
  "custom_fields",
  "sprint_reports",
  "saved_filters",
  "work_logs",
  "card_fix_versions",
  "card_components",
  "versions",
  "components",
  "issue_links",
  "cards",
  // Holds FKs into workspaces, boards and users, so it must precede all three here. CASCADE from
  // those parents would usually clear it anyway, but only incidentally — a workspace-only invite
  // whose parent rows survive would leak between tests, and invites.token is UNIQUE, so a leaked
  // row surfaces as a baffling conflict in an unrelated test rather than an honest failure.
  "invites",
  "labels",
  "lists",
  "sprints",
  "board_members",
  "board_stars",
  "boards",
  "workspace_members",
  "workspaces",
  "users",
];

/** Wipe between tests. Guarded by tests/setup.ts, which refuses any non-test DATABASE_URL. */
export async function resetDb() {
  await db.execute(
    sql.raw(`truncate table ${TABLES.map((t) => `"${t}"`).join(", ")} restart identity cascade`),
  );
}

export async function closeDb() {
  await pool.end();
}
