# Synergy CAD

2D drafting in the suite: the AutoCAD-style command line, object snaps, layers, dimensions, hatches,
blocks, layouts and PDF plotting, with DWG and DXF drawings. The editor is
[CADCraft](https://github.com/storytold/cadcraft) (MIT / Apache-2.0), a clean-room CAD program in
Rust compiled to WebAssembly. It runs entirely in the browser; this app adds the suite header,
sign-in, and a library where drawings are opened from and saved to.

CADCraft is early (pre-alpha upstream). Opening drawings, markup and everyday 2D drafting work.
DXF saves keep entities the editor doesn't model as they were read; `cadcraft-save-fidelity.patch`
also keeps polyface and polygon meshes as meshes (upstream splits them into loose 3D faces) and the
standard arrowhead blocks leaders name. Still lost on save: in a DWG, object types the DWG library
can't write (OLE objects, proxy entities, lights, section planes); some dimension associativity
(arc, ordinate and angular); multileaders saved below AutoCAD 2007 become a leader and text.

3D models open in [Chili3D](https://github.com/xiangechen/chili3d) (AGPL-3.0, its WebAssembly kernel
LGPL-3.0): sketches, extrude, revolve, sweep, loft, booleans, fillets and chamfers on Open CASCADE,
with STEP, IGES, BREP and STL import and export. **2D drawing** turns the model into a drawing sheet
the 2D editor opens: front, top and right views with hidden lines, an isometric view, overall sizes
and hole diameters, on an A3 border with a title block. Chili3D has no constraint-driven sketches yet.

**Share** on a file in the library makes a view-only link. Anyone holding it can open the drawing
or model in the viewer and leave review comments beside it, without an account; people who are
signed in comment under their own name, and the owner can remove comments. Stopping sharing (or
deleting the file) kills the link and its comments. Pasted links preview with the file's name.
**History** lists every earlier save of the open file, to download or restore.
The library has folders (drag a file onto a folder, or use **Move to…**) and shows a picture of
each drawing and model, made the first time it's opened and again after each save.

## How it fits together

- `public/engine/` holds CADCraft's static web build, unchanged from upstream (not committed;
  `engine/build.sh` makes it). `components/Editor.tsx` loads it in an iframe at
  `/engine/index.html?host=parent`, which turns on CADCraft's own host bridge: it takes drawings
  from this page and sends every save and export back to it (`postMessage`, same origin only)
  instead of downloading them. `lib/bridge.ts` has the messages.
- **DWG.** CADCraft's web build reads and writes DXF only. Its DWG bridge (on the acadrust crate,
  MPL-2.0) compiles for the browser, but wasm32 can't catch the panics a damaged DWG can cause,
  so upstream leaves it out. We build it as a separate module instead (`engine/dwg`, with the
  `wasm` feature that `engine/dwg-wasm.patch` adds to CADCraft's DWG crate) and run it in a Web
  Worker (`public/dwg-worker.js`, driven by `lib/dwg.ts`). Opening a DWG converts it to DXF first;
  saving it converts back to DWG in the file's own version (2018 when CADCraft can't write that
  version). If a file traps the converter, only that conversion fails and the next one gets a fresh
  worker. The patch is small and meant for upstream.
- **3D.** `components/Modeler.tsx` loads Chili3D's web build from `public/engine3d/` (made by
  `engine/build-3d.sh`, not committed) at `/engine3d/index.html?host=parent`.
  `engine/chili3d-host.patch` adds that host bridge (`packages/web/src/host.ts` in the patch documents
  the messages): every download (Save, Save to file, exports) goes to this page instead, and the
  page sends files in. A `.cd` file (Chili3D's own format) opens as a model; a STEP, IGES, BREP or STL
  is imported into a new model of the same name, and saving it writes `<name>.cd` beside it. The
  patch also removes upstream's analytics script and remote video thumbnails.
  `lib/model.ts` has the messages and which editor each file type opens in.
- **AI modeling assistant.** Chili3D's chat ("AI Assistant" on the ribbon) builds models from a
  description, e.g. "a 40 mm bracket with four M5 holes". Upstream it takes a provider key in the
  browser; here it uses the suite's model instead. The page tells the editor (`chili3d:ai`) which
  protocol that model speaks, and the editor's own Anthropic or OpenAI client posts to
  `/api/ai/anthropic/v1/messages` or `/api/ai/openai/chat/completions`. Those routes hand each request
  to `relay` in `@synergy/ai`, which puts in the configured model and the server's key and streams
  the answer back (`lib/ai.ts`). So the browser never holds a key, the settings form is hidden, and
  with no model configured the panel says the assistant is off. It follows the suite's `AI_*`
  settings; `CAD_AI_*` gives CAD a model of its own. The assistant calls tools many times per
  request, so a capable model works best.
- **Drawings from models.** The patch's bridge also answers `chili3d:geometry` with every visible
  body as triangles. `lib/views.ts` finds the lines each view shows (sharp edges, plus the
  silhouettes of curved faces) and splits them where something in front hides them; `lib/drawing.ts`
  turns chords back into circles and arcs, lays the views out in third-angle projection at a standard
  scale, adds dimensions and the title block, and writes the DXF. Geometry stays full size, so
  dimensions read true millimetres; the sheet is scaled around it, as in AutoCAD model space.
  Dimensions are written without their geometry blocks: the 2D editor draws them and adds the blocks
  on its first save, which other DXF readers need.
- Saving under the open file's name replaces it; Save As or exports (PDF, SVG, PNG) to another
  name add a new file.
- **Version history.** Every save keeps the bytes it replaces in `<id>.versions/` (the last 50,
  or `CAD_VERSIONS`). **History** in either editor lists them to download or restore; restoring
  keeps the current bytes as a version too, so nothing is lost. Files saved before this kept one
  `<id>.prev`, which becomes their first version.
- **Share links.** `lib/store.ts` keeps each share at `shares/<token>.json` (random 128-bit token,
  the owner's folder, the file and the comments) and the token on the file's record; the link
  works only while both agree. `/s/<token>` opens `components/Shared.tsx`, which runs the same
  editors with `readOnly` (saves are refused in the page) and the bytes from
  `/api/shared/<token>/file`. The gateway lets those paths and the engines' files through without
  sign-in (`maybe_signed_in` in `deploy/Caddyfile`); everything else still needs an account.
- **Library pictures and folders.** The browser draws each picture from the file itself, not
  from the editors' screens: `lib/thumbnail.ts` reads a DXF's model-space lines, circles, arcs,
  polylines and block inserts (DWG after its conversion), or a model's isometric view from
  `lib/views.ts`, and uploads a 320×240 PNG (`/api/files/<id>/thumb`; the server keeps only real
  PNGs). DXF uploads get theirs straight away; DWG and 3D files when first opened. A file's
  `folder` is a path such as `Projects/Site A`, and `folders.json` lists the user's folders, so empty
  ones stay; only empty folders can be removed.
- `lib/store.ts` keeps each user's drawings on disk under `CAD_DIR`. It is the only storage seam,
  so moving to Drive once Drive runs on the suite's sign-in changes that file alone.

## Develop

```sh
# Rust with the wasm32-unknown-unknown target, Trunk, and wasm-bindgen-cli 0.2.129
npm run engine --workspace apps/cad      # 2D engine; about 10 minutes the first time
npm run engine:3d --workspace apps/cad   # 3D engine; Node only, about 2 minutes
DEV_USER_EMAIL=you@example.com npm run dev --workspace apps/cad   # http://localhost:3660
npm test --workspace apps/cad
```

`CADCRAFT_REF` picks the upstream tag (default `v0.7.0`). To move to a newer release, bump it here
and in `deploy/cad.Dockerfile`, check `engine/dwg-wasm.patch` still applies, and keep the
`wasm-bindgen` pin in `engine/dwg/Cargo.toml` equal to the one in CADCraft's `Cargo.lock`.
`CHILI3D_REF` pins a Chili3D commit (it has no release tags yet); bump it in `engine/build-3d.sh` and
`deploy/cad.Dockerfile` together and check `engine/chili3d-host.patch` still applies.
