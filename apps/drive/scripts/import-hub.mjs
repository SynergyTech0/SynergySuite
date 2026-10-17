/*
 * Brings files over from an older Synergy Hub's SynergyDrive into Drive. Reads the hub's export
 * (deploy/hub-import/drive.sql) on stdin, followed by the file contents from drive.files.sh;
 * deploy/hub-import/run.sh does both steps.
 *
 *   - People: the hub's Drive knew each person only as a UUID made from their email (UUIDv5,
 *     DNS namespace, as its sign-in shim did). Those are matched against the suite's accounts,
 *     everyone who already has something in Drive, and any --email you add (repeatable, or
 *     comma-separated). Files of anyone still unknown are left out and listed.
 *   - Folders and files land in their owner's own files with the same tree. A folder that is
 *     already there by name is used as it is; a file whose name is taken gets "name (1).ext".
 *   - Every version the hub kept comes along with its date. Items keep the hub's ids.
 *   - Left behind: things in the hub's recycle bin, and anything in a hub shared drive.
 *
 * Writes the database rows and DRIVE_DIR blobs the way Drive itself does (lib/db.ts,
 * lib/blobs.ts), without quota checks. Safe to run again: an item already here (same id) is left
 * as it is. --dry-run prints the plan only.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const EXTRA = argv.flatMap((a, i) => (argv[i - 1] === "--email" ? a.split(",") : a.startsWith("--email=") ? a.slice(8).split(",") : []));
const ROOT = path.resolve(process.env.DRIVE_DIR || path.join(process.cwd(), ".data"));

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

/** Python's uuid.uuid5(uuid.NAMESPACE_DNS, email): how the hub's Drive named people. */
function hubId(email) {
  const ns = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");
  const h = createHash("sha1").update(ns).update(email, "utf8").digest().subarray(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

// Same rules as lib/names.ts.
const BAD_CHARS = /[\u0000-\u001f\\/:*?"<>|]/g;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
function cleanName(raw) {
  const name = String(raw ?? "").normalize("NFC").replace(BAD_CHARS, "-").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 250) || "Untitled";
  return RESERVED.test(name) ? `${name}_` : name;
}
function uniqueName(name, taken, isFolder) {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const i = name.lastIndexOf(".");
  const [stem, ext] = !isFolder && i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ""];
  for (let n = 1; ; n++) if (!used.has(`${stem} (${n})${ext}`.toLowerCase())) return `${stem} (${n})${ext}`;
}
const TYPES = {
  txt: "text/plain", md: "text/markdown", csv: "text/csv", tsv: "text/tab-separated-values", log: "text/plain",
  json: "application/json", xml: "application/xml", yaml: "text/yaml", yml: "text/yaml", html: "text/html", htm: "text/html",
  css: "text/css", js: "text/javascript", mjs: "text/javascript", ts: "text/plain", tsx: "text/plain", jsx: "text/plain",
  py: "text/x-python", rb: "text/plain", go: "text/plain", rs: "text/plain", java: "text/plain", c: "text/plain", h: "text/plain",
  cpp: "text/plain", cs: "text/plain", sh: "text/x-shellscript", sql: "text/plain", ini: "text/plain", toml: "text/plain",
  pdf: "application/pdf", rtf: "application/rtf",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif",
  bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml", heic: "image/heic", tif: "image/tiff", tiff: "image/tiff",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", m4v: "video/mp4", ogv: "video/ogg",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac", aac: "audio/aac",
  zip: "application/zip", gz: "application/gzip", tar: "application/x-tar", "7z": "application/x-7z-compressed",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ppt: "application/vnd.ms-powerpoint",
  odt: "application/vnd.oasis.opendocument.text", ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation", dwg: "image/vnd.dwg", dxf: "image/vnd.dxf",
};
const mimeFor = (name) => TYPES[(name.lastIndexOf(".") > 0 ? name.slice(name.lastIndexOf(".") + 1) : "").toLowerCase()] ?? "application/octet-stream";
const isText = (mime) => mime.startsWith("text/") || mime === "application/json" || mime === "application/xml";

/** Stores bytes as DRIVE_DIR/blobs/ab/cd/<sha256>, like lib/blobs.ts. */
async function putBlob(data) {
  const sha = createHash("sha256").update(data).digest("hex");
  const dest = path.join(ROOT, "blobs", sha.slice(0, 2), sha.slice(2, 4), sha);
  if (DRY || (await stat(dest).then(() => true, () => false))) return sha;
  const tmp = path.join(ROOT, "tmp", randomUUID());
  await mkdir(path.dirname(tmp), { recursive: true });
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(tmp, data);
  await rename(tmp, dest);
  return sha;
}

/** Hub timestamps are UTC without a zone. */
const when = (t) => (t ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`) : new Date());

async function main() {
  const { hub, bytes } = await readStdin();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const db = (text, params = []) => pool.query(text, params).then((r) => r.rows);
  const log = (s) => console.log((DRY ? "[dry run] " : "") + s);

  const [ready] = await db("SELECT to_regclass('items') AS items, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'items' AND column_name = 'label_id') AS current");
  if (!ready.items || !ready.current) throw new Error("Drive hasn't set up its database yet. Open Drive once (or wait a minute after it starts), then run this again.");

  // Who the hub's ids are.
  const emails = new Set(EXTRA.map((e) => e.trim().toLowerCase()).filter(Boolean));
  for (const r of await db("SELECT owner AS e FROM items UNION SELECT email FROM shares UNION SELECT email FROM library_members")) emails.add(String(r.e).toLowerCase());
  try {
    const url = new URL(process.env.HUB_AUTH_DATABASE_URL || process.env.DATABASE_URL);
    if (!process.env.HUB_AUTH_DATABASE_URL) url.pathname = "/auth";
    const auth = new pg.Client({ connectionString: url.toString() });
    await auth.connect();
    for (const r of (await auth.query("SELECT email FROM sa_users")).rows) emails.add(String(r.email).toLowerCase());
    await auth.end();
  } catch {
    console.log("(Couldn't read the suite's accounts; matching people by Drive and --email only.)");
  }
  const person = new Map([...emails].map((e) => [hubId(e), e]));

  const unknown = new Map();
  const skipped = { trash: 0, shared: 0, noBytes: 0 };
  const keep = (row, what) => {
    if (row.deleted_at) { skipped.trash++; return false; }
    if (row.shared_drive_id) { skipped.shared++; log(`left out ${what} "${row.name}": it is in a hub shared drive`); return false; }
    if (!person.has(row.owner_id)) { unknown.set(row.owner_id, (unknown.get(row.owner_id) ?? 0) + 1); return false; }
    return true;
  };
  const folders = (hub.folders ?? []).filter((f) => keep(f, "folder"));
  const files = (hub.files ?? []).filter((f) => keep(f, "file"));
  const versionsOf = new Map();
  for (const v of hub.versions ?? []) if (!v.deleted_at) versionsOf.set(v.file_id, [...(versionsOf.get(v.file_id) ?? []), v]);

  const folderId = new Map(); // hub folder id -> item id here (null: their root)
  const byId = new Map(folders.map((f) => [f.id, f]));
  const added = { folders: 0, files: 0, versions: 0 }, present = { folders: 0, files: 0 };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tq = (text, params = []) => client.query(text, params).then((r) => r.rows);
    // Names in a folder, counting what this run adds (a dry run writes nothing to ask about).
    const ours = new Map();
    const namesAt = async (space, parent) => [
      ...(await tq(`SELECT id, name, kind FROM items WHERE space = $1 AND parent_id IS NOT DISTINCT FROM $2 AND trash_root IS NULL`, [space, parent])),
      ...(DRY ? ours.get(`${space}|${parent}`) ?? [] : []),
    ];
    const took = (space, parent, item) => ours.set(`${space}|${parent}`, [...(ours.get(`${space}|${parent}`) ?? []), item]);
    const activity = (id, actor, detail) =>
      tq("INSERT INTO activity (item_id, actor, action, detail, at) VALUES ($1, $2, 'uploaded', $3, now())", [id, actor, detail]);

    // Folders, parents first. A folder whose parent is missing from the export goes to the root.
    const placeFolder = async (f, seen = new Set()) => {
      if (folderId.has(f.id)) return folderId.get(f.id);
      const owner = person.get(f.owner_id), space = `u:${owner}`;
      const parentHub = f.parent_folder_id && byId.has(f.parent_folder_id) && !seen.has(f.parent_folder_id) ? byId.get(f.parent_folder_id) : null;
      const parent = parentHub ? await placeFolder(parentHub, new Set([...seen, f.id])) : null;
      const [mine] = await tq("SELECT id FROM items WHERE id = $1", [f.id]);
      if (mine) { present.folders++; folderId.set(f.id, f.id); return f.id; }
      const name = cleanName(f.name);
      const here = await namesAt(space, parent);
      const same = here.find((i) => i.kind === "folder" && i.name.toLowerCase() === name.toLowerCase());
      if (same) { present.folders++; folderId.set(f.id, same.id); log(`folder ${name}: using the one already in ${owner}'s files`); return same.id; }
      const final = uniqueName(name, here.map((i) => i.name), true);
      if (!DRY) {
        await tq(`INSERT INTO items (id, space, owner, parent_id, kind, name, created_by, modified_by, created_at, modified_at)
                  VALUES ($1, $2, $3, $4, 'folder', $5, $3, $3, $6, $7)`, [f.id, space, owner, parent, final, when(f.created_at), when(f.updated_at ?? f.created_at)]);
        await activity(f.id, owner, "created in the old Hub Drive");
      }
      took(space, parent, { id: f.id, name: final, kind: "folder" });
      added.folders++; log(`folder ${final} (${owner})`);
      folderId.set(f.id, f.id);
      return f.id;
    };
    for (const f of folders) await placeFolder(f);

    for (const f of files) {
      const owner = person.get(f.owner_id), space = `u:${owner}`;
      if ((await tq("SELECT 1 FROM items WHERE id = $1", [f.id])).length) { present.files++; continue; }
      const parentHub = f.parent_folder_id ? byId.get(f.parent_folder_id) : null;
      const parent = parentHub ? await placeFolder(parentHub) : null;
      const kept = (versionsOf.get(f.id) ?? []).filter((v) => bytes.has(v.storage_path));
      if (!kept.length) { skipped.noBytes++; log(`left out ${f.name}: its contents aren't in the hub's storage`); continue; }
      const name = uniqueName(cleanName(f.name), (await namesAt(space, parent)).map((i) => i.name), false);
      const mime = mimeFor(name);
      const stored = [];
      for (const v of kept) {
        const data = bytes.get(v.storage_path);
        stored.push({ v, data, sha: await putBlob(data) });
      }
      const last = stored[stored.length - 1];
      const text = isText(mime) ? last.data.subarray(0, 1024 * 1024).toString("utf8").replace(/\u0000/g, "").slice(0, 200_000) : null;
      const lastBy = person.get(last.v.uploaded_by) ?? owner;
      if (!DRY) {
        await tq(`INSERT INTO items (id, space, owner, parent_id, kind, name, mime, size, sha256, version, text, created_by, modified_by, created_at, modified_at)
                  VALUES ($1, $2, $3, $4, 'file', $5, $6, $7, $8, $9, $10, $3, $11, $12, $13)`,
          [f.id, space, owner, parent, name, mime, last.data.length, last.sha, stored.length, text, lastBy, when(f.created_at), when(last.v.created_at ?? f.updated_at)]);
        for (const [i, s] of stored.entries()) {
          await tq("INSERT INTO versions (item_id, n, size, sha256, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
            [f.id, i + 1, s.data.length, s.sha, person.get(s.v.uploaded_by) ?? owner, when(s.v.created_at)]);
        }
        await activity(f.id, owner, "from the old Hub Drive");
      }
      took(space, parent, { id: f.id, name, kind: "file" });
      added.files++; added.versions += stored.length;
      log(`${name} (${owner}${stored.length > 1 ? `, ${stored.length} versions` : ""})`);
    }
    await client.query(DRY ? "ROLLBACK" : "COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  console.log(`\nFolders: ${added.folders} added, ${present.folders} already here. Files: ${added.files} added (${added.versions} versions), ${present.files} already here.`);
  if (skipped.trash || skipped.shared || skipped.noBytes)
    console.log(`Left out: ${skipped.trash} in the hub's recycle bin, ${skipped.shared} in hub shared drives, ${skipped.noBytes} without contents.`);
  for (const [id, n] of unknown) console.log(`Unknown person ${id}: ${n} item(s) left out. Run again with --email <their address>.`);
  if (DRY) console.log("Dry run: nothing was written.");
  await pool.end();
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
