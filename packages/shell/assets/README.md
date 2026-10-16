# Synergy brand files

The Synergy Technologies logo, as used across the suite.

| File | What it is |
| --- | --- |
| `synergy-mark.png` | The eye-and-globe mark on its own (512px, transparent). Favicons and the app bar. |
| `synergy-logo.png` | Full lockup with the navy wordmark, for light backgrounds. |
| `synergy-logo-on-dark.png` | Full lockup with a near-white wordmark, for dark backgrounds. |

Brand colours, sampled from the logo: navy `#011b3e`, cyan `#19c2f0`, blue `#2b4fe0`, violet `#7b3bea`.

## Where copies live

Each app needs its own copy because Next.js and Vite only serve files from inside the app.

- App bar: `packages/shell/src/brand.ts` holds the mark at 72px as a data URI.
- Favicons: `app/icon.png` in every Next.js app (`src/app/icon.png` in Trust), and
  `web/public/favicon.png` in the Vite apps. All are the mark at 128px.
- Home-screen icons: `app/apple-icon.png` (180px) and `public/app-icon.svg` in the apps that have
  their own glyph, drawn on the cyan to violet tile.
- Auth: `apps/auth/public/synergy-mark.png` and `apps/auth/public/synergy-logo-on-dark.png`.

To swap the logo, replace the files here and regenerate those copies at the same sizes.
