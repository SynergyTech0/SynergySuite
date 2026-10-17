/*
 * Brings documents over from an older Synergy Hub's SynergySign into this Sign. Reads the hub's
 * export (deploy/hub-import/sign.sql) on stdin, followed by the PDFs from sign.files.sh;
 * deploy/hub-import/run.sh does both steps.
 *
 *   - People: matched by email to Sign users here; anyone not here yet is added (they sign in
 *     with their suite account, so no password comes along). Admin rights come from
 *     SIGN_ADMIN_EMAILS as usual, not from the hub.
 *   - Documents keep their ids, status, signers, fields, audit trail and notifications, and the
 *     original and signed PDFs are written to LOCAL_STORAGE_PATH under the same names.
 *   - Contract events the hub already delivered (or gave up on) come along as history; ones it
 *     never sent stay behind, so the suite's Contracts doesn't get the hub's old events.
 *
 * Safe to run again: anything already here (same id) is left as it is. --dry-run prints the plan only.
 */
import { createRequire } from "node:module";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");

const DRY = process.argv.includes("--dry-run");
const STORE = process.env.LOCAL_STORAGE_PATH || "/var/www/ai_docusign_clone/uploads";

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const [json, files = ""] = Buffer.concat(chunks).toString("utf8").split(/\r?\n#hub-files\r?\n/);
  if (!json.trim()) throw new Error("No hub export on stdin. Run deploy/hub-import/run.sh.");
  const bytes = new Map();
  for (const line of files.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab > 0) bytes.set(line.slice(0, tab), Buffer.from(line.slice(tab + 1).trim(), "base64"));
  }
  return { hub: JSON.parse(json), bytes };
}

/** A stored file's place under LOCAL_STORAGE_PATH, or null for anything that would leave it. */
function localPath(key) {
  if (!key || path.isAbsolute(key) || key.split(/[\\/]/).includes("..")) return null;
  return path.join(STORE, key);
}

const exists = (p) => access(p).then(() => true, () => false);

async function main() {
  const { hub, bytes } = await readStdin();
  const prisma = new PrismaClient();
  const log = (s) => console.log((DRY ? "[dry run] " : "") + s);

  // People, by email.
  const userId = new Map();
  let usersAdded = 0, usersFound = 0;
  for (const u of hub.users ?? []) {
    const email = String(u.email).trim().toLowerCase();
    const found = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, orderBy: { createdAt: "asc" } });
    if (found) { userId.set(u.id, found.id); usersFound++; continue; }
    const idFree = !(await prisma.user.findUnique({ where: { id: u.id } }));
    const id = idFree ? u.id : undefined;
    if (!DRY) {
      const made = await prisma.user.create({
        data: {
          id, email, name: u.name, firstName: u.firstName, lastName: u.lastName, companyName: u.companyName,
          emailVerified: new Date(), role: "SENDER", createdAt: u.createdAt ? new Date(u.createdAt + "Z") : undefined,
        },
      });
      userId.set(u.id, made.id);
    } else userId.set(u.id, id ?? u.id);
    usersAdded++; log(`added ${email}`);
  }
  const who = (id) => (id == null ? null : userId.get(id) ?? null);

  const documents = (hub.documents ?? []).filter((d) => {
    if (userId.has(d.senderId)) return true;
    log(`skipped "${d.title}": its sender isn't in the export`);
    return false;
  }).map((d) => ({ ...d, senderId: who(d.senderId) }));
  const docIds = new Set(documents.map((d) => d.id));
  const ofDoc = (rows) => (rows ?? []).filter((r) => r.documentId == null || docIds.has(r.documentId));
  const signers = ofDoc(hub.document_signers).map((s) => ({ ...s, userId: who(s.userId) }));
  const fields = ofDoc(hub.document_fields);
  const audit = ofDoc(hub.audit_logs).map((a) => ({ ...a, userId: who(a.userId) }));
  const notes = ofDoc(hub.notifications).map((n) => ({ ...n, userId: who(n.userId) }));
  const outbox = ofDoc(hub.contract_event_outbox);
  const events = outbox.filter((o) => o.deliveredAt || o.failedAt);

  // PDFs first: a document whose row is here always has its file.
  let filesWritten = 0, filesHere = 0, filesMissing = 0;
  for (const d of documents) {
    for (const key of [d.cloudStoragePath, d.signedDocumentPath]) {
      if (!key) continue;
      const dest = localPath(key);
      const data = bytes.get(key);
      if (!dest || d.cloudProvider !== "LOCAL" || !data) {
        filesMissing++; log(`no file for "${d.title}" (${key})`);
        continue;
      }
      if (await exists(dest)) { filesHere++; continue; }
      if (!DRY) {
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, data);
      }
      filesWritten++;
    }
  }

  // Rows, keeping their ids. json_populate_recordset fills columns the hub didn't have yet.
  const counts = {};
  await prisma.$transaction(async (tx) => {
    for (const [table, rows] of [
      ["documents", documents], ["document_signers", signers], ["document_fields", fields],
      ["audit_logs", audit], ["notifications", notes], ["contract_event_outbox", events],
    ]) {
      let n = 0;
      if (rows.length) {
        const have = new Set((await tx.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = ANY($1::text[])`, rows.map((r) => r.id))).map((r) => r.id));
        const fresh = rows.filter((r) => !have.has(r.id));
        n = fresh.length;
        if (n && !DRY) {
          n = (await tx.$queryRawUnsafe(
            `INSERT INTO "${table}" SELECT * FROM json_populate_recordset(NULL::"${table}", $1::json) ON CONFLICT DO NOTHING RETURNING id`,
            JSON.stringify(fresh),
          )).length;
        }
      }
      counts[table] = n;
    }
  }, { timeout: 120_000 });

  for (const d of documents) log(`${d.title} (${d.status.toLowerCase()})`);
  console.log(`\nPeople: ${usersAdded} added, ${usersFound} already here.`);
  console.log(`Documents: ${counts.documents} added, ${documents.length - counts.documents} already here. ` +
    `Signers ${counts.document_signers}, fields ${counts.document_fields}, audit entries ${counts.audit_logs}, ` +
    `notifications ${counts.notifications}, contract events ${counts.contract_event_outbox} added` +
    (outbox.length > events.length ? ` (${outbox.length - events.length} never sent by the hub, left behind).` : "."));
  console.log(`Files: ${filesWritten} written, ${filesHere} already here${filesMissing ? `, ${filesMissing} missing from the hub` : ""}.`);
  if (DRY) console.log("Dry run: nothing was written.");
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
