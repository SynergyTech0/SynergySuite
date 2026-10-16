# Synergy Photo

Image editing in the suite: layers, masks, adjustment layers, type, vectors, brushes and real PSD files.
The editor is [PhotoCraft](https://github.com/storytold/photocraft) (MIT / Apache-2.0), a Rust image
editor compiled to WebAssembly. It runs entirely in the browser; this app adds the suite header,
sign-in, and a library where images are opened from and saved to.

## How it fits together

- `public/engine/` holds PhotoCraft's static web build (not committed; `engine/build.sh` makes it).
- `components/Editor.tsx` loads it in an iframe at `/engine/index.html?host`.
- `engine/host-bridge.patch` is our change to PhotoCraft's web runner: with `?host`, it takes files
  from the parent page and sends saves back to it (`postMessage`, same origin only), in place of the
  browser's file picker and downloads. The messages are documented at the top of the patch's `host.rs`.
- Saving under the open file's name replaces it (the previous bytes are kept as one level of undo);
  Save As or Export to another name adds a new image to the library.
- `lib/store.ts` keeps each user's images on disk under `PHOTO_DIR`. It is the only storage seam, so
  moving to Drive once Drive runs on the suite's sign-in changes that file alone.

## Develop

```sh
npm run engine --workspace apps/photo   # Rust + wasm32 target + Trunk; about 15 minutes the first time
DEV_USER_EMAIL=you@example.com npm run dev --workspace apps/photo   # http://localhost:3650
npm test --workspace apps/photo
```

`PHOTOCRAFT_REF` picks the upstream tag (default `v0.9.0`). To move to a newer release, bump it here
and in `deploy/photo.Dockerfile`, and check the patch still applies.
