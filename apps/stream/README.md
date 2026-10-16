# Synergy Stream

Video in the suite: a company video library (Microsoft Stream) and a video editor (Clipchamp).
Upload or record a video, and Stream turns it into a web-ready MP4 with a poster, plays it with
captions, chapters, a searchable transcript and comments, and shares it with people, the whole
organization, or anyone with a link (with an embed code). Captions, a summary and chapters can be
written by the suite's AI model.

The editor is [FilmCraft](https://github.com/storytold/filmcraft) (MIT / Apache-2.0), a Rust video
editor compiled to WebAssembly, the same family as the PhotoCraft engine in Synergy Photo. It runs
entirely in the browser; Stream opens library videos in it and saves exports and projects back.

## How it fits together

- `lib/media.ts` runs FFmpeg on the server: every upload becomes `web.mp4` (H.264/AAC, faststart,
  at most 1080p; streams already in that format are copied) plus `poster.jpg`. `STREAM_JOBS` caps
  how many run at once; jobs left unfinished by a restart pick up again on start.
- `lib/store.ts` keeps files under `STREAM_DIR` (`videos/<id>/` and `projects/<id>.fcproj`). It is
  the only storage seam.
- `public/engine/` holds FilmCraft's static web build (not committed; `engine/build.sh` makes it).
  `components/Editor.tsx` loads it in an iframe at `/engine/index.html?host`.
- `engine/host-bridge.patch` is our change to FilmCraft's web runner: with `?host`, files it writes
  (exports and saved projects) are posted to the parent page (`postMessage`, same origin only)
  instead of downloaded, and it says when it is ready. `lib/bridge.ts` reads those messages.
- `lib/ai.ts` uses `@synergy/ai` (prefix `STREAM_`): audio is cut into 30 second pieces for
  speech to text, and the timed transcript feeds the summary and chapters.
- Search (`/api/search`) and eDiscovery (`/api/compliance/{search,export}`) cover videos,
  comments and editor projects. Under a legal hold, deletes are kept out of sight instead.

## Develop

```sh
npm run engine --workspace apps/stream   # Rust + wasm32 target + wasm-bindgen-cli 0.2.129
DEV_USER_EMAIL=you@example.com npm run dev --workspace apps/stream   # http://localhost:3725
TEST_DATABASE_URL=postgres://... npm test --workspace apps/stream    # needs ffmpeg on PATH
```

`FILMCRAFT_REF` picks the upstream tag (default `v0.8.0`). To move to a newer release, bump it here
and in `deploy/stream.Dockerfile`, and check the patch still applies. The ArtCraft name and logos are
the upstream project's trademarks, so the editor ships under Synergy branding with credit in About.
