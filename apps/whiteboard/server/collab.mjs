// Synergy Whiteboard real-time collaboration server.
// Hocuspocus (MIT) speaks the Yjs sync protocol over WebSocket. A board is one Yjs document
// (see lib/scene.mjs): every shape anyone draws is merged into it live, and everyone's cursor is
// shared through Yjs awareness. The whole document is kept in Postgres (boards.ydoc), so a board
// reopens exactly as it was left, with its words copied out for search.
//
// Access is checked on every connection with the same rules as the web app (lib/access.mjs):
// the gateway signs people in and passes who they are; someone who can only view the board is
// connected read-only, so their client can watch but its changes are dropped here.
import { Hocuspocus } from "@hocuspocus/server";
import { identify, optionsFromEnv } from "@synergy/identity";
import pg from "pg";
import * as Y from "yjs";
import { ACCESS_SQL, RANK, UUID, roleFrom } from "../lib/access.mjs";
import { ELEMENTS, FILES, MAX_FILE_CHARS, sceneSummary } from "../lib/scene.mjs";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5499/whiteboard",
  max: 8,
});

const PORT = Number(process.env.COLLAB_PORT || 3751);

const server = new Hocuspocus({
  port: PORT,
  // Localhost in development; in the container the gateway reaches us over the compose network.
  address: process.env.COLLAB_ADDRESS || "127.0.0.1",
  // Save at most every 2 s while people draw, and at least every 10 s.
  debounce: 2000,
  maxDebounce: 10000,
  quiet: true,

  async onConnect({ requestHeaders, documentName, connection }) {
    const who = identify(requestHeaders || {}, optionsFromEnv());
    if (!who) throw new Error("unauthenticated");
    if (!UUID.test(documentName)) throw new Error("forbidden");
    const { rows } = await pool.query(ACCESS_SQL, [documentName, who.email]);
    const role = roleFrom(rows[0], who.email);
    if (!role) throw new Error("forbidden");
    if (RANK[role] < RANK.editor) connection.readOnly = true;
    return { email: who.email, role };
  },

  // Images are kept in the board itself; one too large to keep is taken out again.
  async onChange({ document }) {
    const files = document.getMap(FILES);
    for (const [id, json] of files.entries()) {
      if (typeof json === "string" && json.length > MAX_FILE_CHARS) files.delete(id);
    }
  },

  async onLoadDocument({ documentName, document }) {
    // Apply the saved state onto the document Hocuspocus provides (a returned update would not
    // be applied), so the board survives a restart with nobody connected.
    const { rows } = await pool.query("SELECT ydoc FROM boards WHERE id = $1", [documentName]);
    if (rows[0]?.ydoc) Y.applyUpdate(document, new Uint8Array(rows[0].ydoc));
    return document;
  },

  async onStoreDocument({ documentName, document, context }) {
    const state = Buffer.from(Y.encodeStateAsUpdate(document));
    const { text, count } = sceneSummary(document.getMap(ELEMENTS).values());
    await pool.query(
      `UPDATE boards SET ydoc = $2, text = $3, element_count = $4, modified_at = now(), modified_by = COALESCE($5, modified_by)
       WHERE id = $1`,
      [documentName, state, text, count, context?.email ?? null],
    );
  },
});

server.listen().then(() => {
  console.log(`Synergy Whiteboard collaboration server on ${process.env.COLLAB_ADDRESS || "127.0.0.1"}:${PORT}`);
});
