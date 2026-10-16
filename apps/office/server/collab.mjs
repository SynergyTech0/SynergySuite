// SynergyDocs real-time collaboration server.
// Hocuspocus (MIT) speaks the Yjs sync protocol over WebSocket; every keystroke
// is a CRDT update merged across all connected editors. We persist the whole
// Yjs document as a binary blob in Postgres so a doc survives with zero data
// loss and reopens exactly where it was left.
//
// Auth model: nginx gates the /collab WebSocket with oauth2-proxy (SynergyAuth),
// so only signed-in Synergy users ever reach this process — same trust boundary
// as the web app. An optional COLLAB_SHARED_TOKEN adds a second check.
import { Hocuspocus } from "@hocuspocus/server";
import * as Y from "yjs";
import pg from "pg";
import { identify, optionsFromEnv } from "@synergy/identity";
import { foldProtections, mayMoveProtections, protectionsOf } from "../lib/protection-rules.mjs";
import { judgeChange, scanUpdate, syncUpdateOf } from "./protection-guard.mjs";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/synergydocs",
  max: 8,
});

const PORT = Number(process.env.COLLAB_PORT || 3071);

// No app-level auth hook: nginx runs the /collab WebSocket through oauth2-proxy
// (SynergyAuth), so only signed-in Synergy users ever reach this process — the
// same trust boundary as the web app. Adding onAuthenticate would require every
// client to also carry a token, which the proxy already vouches for.
const server = new Hocuspocus({
  port: PORT,
  // Bind localhost in dev; in the container the oauth2-proxy reaches us over the
  // compose network, so COLLAB_ADDRESS=0.0.0.0 there.
  address: process.env.COLLAB_ADDRESS || "127.0.0.1",

  // Access control at the socket: oauth2-proxy forwards the signed-in user's
  // email on the upgrade request. Compute the user's effective role; reject if
  // they can't view the doc, and connect them READ-ONLY if they're below editor
  // (viewer/commenter can watch live edits but can't write to the shared doc).
  // A connection with no identity is refused. (It used to be let through with full
  // access on the assumption that only the proxy could reach this port.) In local
  // dev without the gateway, DEV_EMAIL / DEV_USER_EMAIL stands in for the user.
  async onConnect({ requestHeaders, documentName, connection }) {
    const who = identify(requestHeaders || {}, optionsFromEnv());
    if (!who) throw new Error("unauthenticated");
    const email = who.email;
    const org = process.env.DOCS_ORG || "synergy";
    const RANK = { viewer: 1, commenter: 2, editor: 3, owner: 4 };

    const doc = (await pool.query("SELECT owner_email, scope, company_role FROM documents WHERE id = $1 AND org = $2", [documentName, org])).rows[0];
    if (!doc) throw new Error("forbidden");

    let role = null;
    if (doc.owner_email === email) role = "owner";
    else {
      const g = (await pool.query("SELECT role FROM doc_grants WHERE doc_id = $1 AND org = $2 AND email = $3", [documentName, org, email])).rows[0];
      if (g) role = g.role;
      if (doc.scope === "company" && doc.company_role && (!role || RANK[doc.company_role] > RANK[role])) role = doc.company_role;
    }
    if (!role) throw new Error("forbidden");
    if (RANK[role] < RANK.editor) connection.readOnly = true;
    // Who this connection is (merged into its context), for the protection check on every edit.
    return { email, role };
  },

  // Protected sheets and ranges: an edit that the person's client should have
  // refused (an old or modified client, or a race with the owner protecting
  // the range) is refused here too. The whole message is dropped and the
  // connection closed with 4403; the client reloads from the shared state.
  async beforeHandleMessage({ update, connection, context, document, documentName }) {
    if (connection?.readOnly || !context?.role || context.role === "owner") return;
    const raw = syncUpdateOf(update);
    const change = raw && scanUpdate(raw);
    if (!change || (!change.ops.length && !change.base && !change.deletes)) return;
    const current = await protectionsNow(documentName, document);
    const why = judgeChange(change, current, { email: context.email, role: context.role }, !!document.getMap("meta").get("base"));
    if (why) {
      console.log(`protection: refused an edit by ${context.email} on ${documentName}: ${why}`);
      throw Object.assign(new Error(why), { code: 4403, reason: "protected" });
    }
  },

  async onLoadDocument({ documentName, document }) {
    // Rehydrate the in-memory Y.Doc from the persisted snapshot. The update must
    // be applied onto the provided `document` (returning a raw Uint8Array is NOT
    // auto-applied by Hocuspocus) — this is what makes a doc survive a server
    // restart or reopen with every client disconnected.
    const { rows } = await pool.query("SELECT ydoc FROM documents WHERE id = $1", [documentName]);
    if (rows[0]?.ydoc) Y.applyUpdate(document, new Uint8Array(rows[0].ydoc));
    return document;
  },

  async afterUnloadDocument({ documentName }) {
    protectionCache.delete(documentName);
  },

  async onStoreDocument({ documentName, document }) {
    // Encode the whole Yjs document and upsert it as a binary blob.
    const state = Buffer.from(Y.encodeStateAsUpdate(document));
    await pool.query(
      `INSERT INTO documents (id, org, owner_email, ydoc, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (id) DO UPDATE SET ydoc = EXCLUDED.ydoc, updated_at = now()`,
      [documentName, process.env.DOCS_ORG || "synergy", "system", state],
    );
  },
});

// ---- Protection state per open document ----
// Current protections = the base snapshot's list, moved along by every op in
// the log (inserted or deleted rows and columns, the owner's changes). The
// result is cached until the base or the log changes.
const protectionCache = new Map();

async function protectionsNow(name, document) {
  const meta = document.getMap("meta");
  const log = document.getArray("ops");
  const baseStr = meta.get("base") || null;
  let entry = protectionCache.get(name);
  if (!entry || entry.doc !== document) {
    entry = { doc: document, baseStr: undefined, baseList: [], length: -1, list: [], stored: null };
    protectionCache.set(name, entry);
  }
  if (!baseStr) {
    // Nobody has opened it collaboratively yet: the saved snapshot is the truth.
    if (!entry.stored) {
      const { rows } = await pool.query("SELECT snapshot FROM documents WHERE id = $1", [name]);
      entry.stored = protectionsOf(rows[0]?.snapshot);
    }
    return entry.stored;
  }
  if (entry.baseStr !== baseStr) {
    try {
      entry.baseList = protectionsOf(JSON.parse(baseStr));
    } catch {
      entry.baseList = [];
    }
    entry.baseStr = baseStr;
    entry.length = -1;
  }
  if (entry.length !== log.length) {
    let list = entry.baseList;
    for (const json of log.toArray()) {
      if (typeof json !== "string" || !mayMoveProtections(json)) continue;
      try {
        list = foldProtections(list, JSON.parse(json));
      } catch {
        /* skip a bad entry */
      }
    }
    entry.list = list;
    entry.length = log.length;
  }
  return entry.list;
}

server.listen().then(() => {
  console.log(`SynergyDocs collab server on 127.0.0.1:${PORT}`);
});
