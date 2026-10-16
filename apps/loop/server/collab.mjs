// Loop's live collaboration server. Hocuspocus (MIT) speaks the Yjs sync protocol over WebSocket,
// so everyone on a page or component sees each other's changes as they type, wherever the
// component is shown: its page, its own window, or a Chat message.
//
// Documents are named "page:<id>" and "component:<id>". The whole Yjs document is saved to
// Postgres, along with its plain text for search and eDiscovery.
//
// Access: the gateway signs people in before the WebSocket reaches us and passes their identity
// on the upgrade request; each connection gets the person's role on that page or component
// (lib/access.mjs, the same rules as the web app). People who can only view are connected
// read-only; anyone else is refused.
import { Hocuspocus } from "@hocuspocus/server";
import * as Y from "yjs";
import pg from "pg";
import { identify, optionsFromEnv } from "@synergy/identity";
import { canEdit, documentRole, parseDocName } from "../lib/access.mjs";
import { docText } from "../lib/ydoc.mjs";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5499/loop",
  max: 8,
});
const q = async (text, params) => (await pool.query(text, params)).rows;

const PORT = Number(process.env.COLLAB_PORT || 3731);

const server = new Hocuspocus({
  port: PORT,
  // Localhost in development; the container sets COLLAB_ADDRESS=0.0.0.0 so the gateway can reach it.
  address: process.env.COLLAB_ADDRESS || "127.0.0.1",
  // Save at most every two seconds while people type, and at once when the last one leaves.
  debounce: 2000,
  maxDebounce: 10000,

  async onConnect({ requestHeaders, documentName, connection }) {
    const who = identify(requestHeaders || {}, optionsFromEnv());
    if (!who) throw new Error("unauthenticated");
    if (!parseDocName(documentName)) throw new Error("forbidden");
    const role = await documentRole(q, documentName, who.email);
    if (!role) throw new Error("forbidden");
    if (!canEdit(role)) connection.readOnly = true;
    return { email: who.email, role };
  },

  async onLoadDocument({ documentName, document }) {
    const d = parseDocName(documentName);
    const table = d.kind === "page" ? "pages" : "components";
    const [row] = await q(`SELECT ydoc FROM ${table} WHERE id = $1`, [d.id]);
    if (row?.ydoc) Y.applyUpdate(document, new Uint8Array(row.ydoc));
    return document;
  },

  async onStoreDocument({ documentName, document, context }) {
    const d = parseDocName(documentName);
    const state = Buffer.from(Y.encodeStateAsUpdate(document));
    const by = context?.email ?? null;
    if (d.kind === "page") {
      const { text, embeds } = docText(document, "page");
      await q(
        `UPDATE pages SET ydoc = $2, text = $3, embeds = $4::uuid[], modified_at = now(), modified_by = COALESCE($5, modified_by)
         WHERE id = $1`,
        [d.id, state, text, embeds, by],
      );
    } else {
      const [c] = await q("SELECT kind FROM components WHERE id = $1", [d.id]);
      if (!c) return;
      const { text } = docText(document, c.kind);
      await q(
        `UPDATE components SET ydoc = $2, text = $3, modified_at = now(), modified_by = COALESCE($4, modified_by) WHERE id = $1`,
        [d.id, state, text, by],
      );
    }
  },
});

server.listen().then(() => {
  console.log(`Loop collaboration server on ${process.env.COLLAB_ADDRESS || "127.0.0.1"}:${PORT}`);
});
