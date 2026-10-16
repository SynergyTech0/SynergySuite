# Synergy Whiteboard

The suite's Microsoft Whiteboard: an infinite canvas that everyone on a board draws on at the same
time. Drawing is [Excalidraw](https://github.com/excalidraw/excalidraw) (MIT); live collaboration is
Yjs over [Hocuspocus](https://github.com/ueberdosis/hocuspocus) (MIT), the same pattern Office and
Notes use.

## What it does

- Boards with live editing: shapes, pen, text, arrows, images, frames, laser pointer, everyone's
  cursor and selection, undo of your own changes.
- Sticky notes in six colours from the header, and seven templates (Brainstorm, Kanban,
  Retrospective, SWOT, Mind map, Flowchart, Weekly planner).
- Sharing: people as editors or viewers (editors can bring people in; only the owner takes access
  away), or a link anyone signed in to the suite can view or edit. Viewers watch live, read only.
- Drive: save a copy of a board into Drive's Whiteboards folder as .excalidraw, .png or .svg, and
  open an .excalidraw file from Drive ("Open in Whiteboard" in Drive's preview) or your computer.
- Meet and Chat: the whiteboard button in a meeting or a chat channel opens that meeting's or
  channel's own board, which everyone signed in to the meeting, or in the channel, can edit.
- Suite search finds boards by name and the words on them; the Admin center's eDiscovery finds and
  exports them (with the drawing as an .excalidraw file), and legal holds keep deleted boards.
- AI sticky-note ideas on the suite's own model (AI_*, or WHITEBOARD_AI_*), only when one is set up.

## How it fits together

| Piece | Where |
| --- | --- |
| Web app (Next.js 16) | port 3750, `npm run dev` |
| Collaboration server | port 3751, `npm run collab` (`server/collab.mjs`) |
| Database | Postgres `whiteboard` (made on first start if missing) |

A board is one Yjs document (see `lib/scene.mjs`): a map of Excalidraw elements by id and a map of
images. Each browser sends the elements whose version changed and merges other people's with
Excalidraw's own reconciler (`components/BoardCanvas.tsx`). The collaboration server checks access
on every connection with the same rules as the web app (`lib/access.mjs`), connects viewers read
only, and saves the document and its words to Postgres.

Meet and Chat reach `POST /api/svc/boards` on the internal network with `PROXY_SHARED_SECRET`
after checking who is in the meeting or channel; the gateway never forwards `/api/svc/`.

Excalidraw's fonts are copied into `public/fonts` at build (`npm run fonts`) so nothing loads from a
public CDN.

## Developing

```sh
createdb whiteboard   # or let the app make it
DATABASE_URL=postgres://postgres@localhost:5432/whiteboard DEV_USER_EMAIL=you@example.com npm run dev
DATABASE_URL=postgres://postgres@localhost:5432/whiteboard DEV_USER_EMAIL=you@example.com npm run collab
TEST_DATABASE_URL=postgres://postgres@localhost:5432/whiteboard_test npm test
```

Send an `x-dev-user: someone@example.com` header (or use a second browser profile with an extension
that sets it) to try a board as a second person.
