# Synergy Diagrams

The suite's Visio: flowcharts, org charts, network, software, business and floor-plan diagrams,
drawn in [draw.io](https://github.com/jgraph/drawio)'s web editor (Apache-2.0) with its full shape
libraries and templates (CC BY 4.0).

- **Home** (`app/page.tsx`, `components/Home.tsx`): a template gallery, "Describe it to AI", opening
  a Visio (.vsdx, .vssx, .vsdm) or draw.io file, and Recent / My diagrams / Shared with me.
- **Editor** (`app/d/[id]`, `components/Editor.tsx`): draw.io in embed mode in a frame, served from
  this app's own `/drawio/` with `stealth=1`, so the editor makes no requests outside the suite.
  Changes autosave; a save made against an older copy (another window, another person) gets a 409
  and a banner to load the newer copy or keep yours.
- **Visio import** (`components/importer.ts`) runs in the browser, through draw.io's own importer.
  Old binary Visio files (.vsd) need saving as .vsdx first. draw.io's open source build has no
  .vsdx export, so downloads are .drawio, PNG, SVG or PDF.
- **AI**: draw.io's Generate window posts to `/api/ai/chat`, which answers through `@synergy/ai`
  (the suite's `AI_*` setting, or `DIAGRAMS_AI_*`). `engine/PostConfig.js` turns the window on.
- **Suite**: search (`/api/search`), eDiscovery and legal hold (`/api/compliance/*`, deletes of a
  held person's diagram are kept hidden), sharing with editors and viewers, version history.

## Running it

```sh
npm run engine --workspace apps/diagrams   # puts draw.io in public/drawio (needs git)
npm run dev --workspace apps/diagrams      # http://localhost:3790
```

`engine/build.sh` checks out the draw.io release in `DRAWIO_REF` and `engine/install.sh` copies its
web app, without the cloud-storage pages and source maps, adding `engine/PreConfig.js` and
`engine/PostConfig.js`. `deploy/diagrams.Dockerfile` does the same.

Settings: `DATABASE_URL` (the database is created on first start if missing), `DIAGRAMS_MAX_MB`
(largest diagram, default 25), `DIAGRAMS_VERSIONS` (earlier versions kept per diagram, default 25),
`DIAGRAMS_AI_PROVIDER`, `DIAGRAMS_AI_BASE_URL`, `DIAGRAMS_AI_API_KEY`, `DIAGRAMS_AI_MODEL`.

Tests: `TEST_DATABASE_URL=postgres://... npm test --workspace apps/diagrams`.

draw.io is a trademark of draw.io Ltd and draw.io AG; Synergy Diagrams is not affiliated with them.
