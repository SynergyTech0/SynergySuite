// SynergyNotes real-time collaboration server.
// Hocuspocus (MIT) speaks the Yjs sync protocol over WebSocket: every keystroke
// is a CRDT update merged across all connected editors, so two people editing a
// page no longer clobber each other the way last-write-wins autosave did.
//
// The shared document is a single Y.Text named "body" (the page's markdown). We
// persist the whole Y.Doc as a bytea blob in page_ydoc so a page reopens exactly
// where it was left, AND mirror the text back into pages.body on every save so
// search, rendering, and the REST API keep seeing the current content.
//
// Auth: the /collab WebSocket is gated by oauth2-proxy (SynergyAuth) at the
// ingress, exactly like the app, so only signed-in Synergy users reach this
// process. onConnect re-derives the user's effective role from the same tables
// the app uses and connects viewers READ-ONLY.
import { Hocuspocus } from '@hocuspocus/server';
import * as Y from 'yjs';
import { createDb } from '@synergy/db';
import { identify, optionsFromEnv } from '@synergy/identity';
import notesCompliance from './compliance.js';

const db = createDb({ devUrl: 'postgres://dev:dev@127.0.0.1:5475/notes', max: 8 });
const q = db.q;

const PORT = Number(process.env.COLLAB_PORT || 3136);
const SPACE_ADMINS = (process.env.SPACE_ADMINS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 };

// documentName is "page-<id>".
const pageIdOf = name => Number(String(name).replace(/^page-/, ''));

async function effectiveRole(email, pageId) {
  email = String(email).toLowerCase();
  const page = (await q('SELECT space_id FROM pages WHERE id = $1 AND deleted_at IS NULL', [pageId])).rows[0];
  if (!page) return null;
  const sid = page.space_id;
  let role = null;
  if (SPACE_ADMINS.includes(email)) role = 'admin';
  else {
    const sp = (await q('SELECT created_by, restricted FROM spaces WHERE id = $1', [sid])).rows[0];
    if (!sp) return null;
    if (sp.created_by && sp.created_by.toLowerCase() === email) role = 'admin';
    else {
      const m = (await q('SELECT role FROM space_members WHERE space_id = $1 AND email = $2', [sid, email])).rows[0];
      if (m) role = m.role;
      else if (!sp.restricted) role = 'editor';
    }
  }
  if (!role) return null;
  // page-level restriction: non-admins must be on the allowlist if one exists
  if (role !== 'admin') {
    const allow = (await q('SELECT email FROM page_restrictions WHERE page_id = $1', [pageId])).rows.map(r => r.email);
    if (allow.length && !allow.includes(email)) return null;
  }
  return role;
}

const server = new Hocuspocus({
  port: PORT,
  address: process.env.COLLAB_ADDRESS || '127.0.0.1',

  // Identity: prod carries the signed-in email on the oauth2-proxy header. In local
  // dev (DEV_USER_EMAIL set, not production) a browser WebSocket can't set headers,
  // so the provider's `token` stands in for the simulated user. The token is
  // client-supplied, so it is never trusted in production.
  async onAuthenticate({ requestHeaders, documentName, token, connection }) {
    const devOverride = token && token !== 'proxy' && token.includes('@') ? token : null;
    const who = identify(requestHeaders || {}, { ...optionsFromEnv(), devOverride });
    if (!who) throw new Error('unauthenticated');
    const email = who.email;
    const role = await effectiveRole(email, pageIdOf(documentName));
    if (!role) throw new Error('forbidden');
    if (ROLE_RANK[role] < ROLE_RANK.editor) connection.readOnly = true; // viewers watch live, can't write
    return { user: email }; // merged into context so onStoreDocument can attribute the version
  },

  async onLoadDocument({ documentName, document }) {
    const id = pageIdOf(documentName);
    const row = (await q('SELECT ydoc FROM page_ydoc WHERE page_id = $1', [id])).rows[0];
    if (row && row.ydoc) {
      Y.applyUpdate(document, new Uint8Array(row.ydoc));
    } else {
      // First open: seed the shared Y.Text from the page's stored markdown.
      const p = (await q('SELECT body FROM pages WHERE id = $1', [id])).rows[0];
      if (p && p.body) document.getText('body').insert(0, p.body);
    }
    return document;
  },

  async onStoreDocument({ documentName, document, context }) {
    const id = pageIdOf(documentName);
    const state = Buffer.from(Y.encodeStateAsUpdate(document));
    await q(`INSERT INTO page_ydoc (page_id, ydoc, updated_at) VALUES ($1, $2, now())
             ON CONFLICT (page_id) DO UPDATE SET ydoc = EXCLUDED.ydoc, updated_at = now()`, [id, state]);
    // Mirror the live text back into pages.body so REST/search/render stay current,
    // and record a version so history keeps working for collaborative edits.
    const body = document.getText('body').toString();
    const editor = (context && context.user) || 'collab';
    const { rows } = await q(
      `UPDATE pages SET body = $2, updated_by = $3, updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL RETURNING title`, [id, body, editor]);
    if (rows[0]) {
      try {
        const latest = (await q(
          `SELECT id, version_no, title, body, edited_by, created_at FROM page_versions
            WHERE page_id = $1 ORDER BY version_no DESC LIMIT 1`, [id])).rows[0];
        if (!(latest && latest.title === rows[0].title && latest.body === body)) {
          const WINDOW = 10 * 60 * 1000;
          // Under a legal hold every save is its own version, so no saved text is overwritten.
          if (latest && latest.edited_by === editor && (Date.now() - new Date(latest.created_at).getTime()) < WINDOW
              && !(await notesCompliance.holdsEveryVersion(q, id, editor))) {
            await q('UPDATE page_versions SET title = $2, body = $3, created_at = now() WHERE id = $1',
              [latest.id, rows[0].title, body]);
          } else {
            await q(`INSERT INTO page_versions (page_id, version_no, title, body, edited_by)
                     VALUES ($1, $2, $3, $4, $5)`, [id, (latest?.version_no || 0) + 1, rows[0].title, body, editor]);
          }
        }
      } catch { /* versioning is best-effort here */ }
    }
  },

});

server.listen().then(() => console.log(`SynergyNotes collab server on ${process.env.COLLAB_ADDRESS || '127.0.0.1'}:${PORT}`));
