/*
 * Icon tone derivation, in plain ESM so both the React component and
 * tools/theme-audit.mjs can use the same code. The audit asserts the contrast of
 * every seeded brand colour in both themes — a claim about legibility should be
 * computed, not asserted.
 *
 * OKLab is used because HSL lightness is not perceptual luminance: pinning HSL
 * `l` left a 3.8x contrast spread across hues (a teal brand at 1.82:1 against
 * the page while a blue sat at 6.98:1). OKLab's L is perceptually uniform.
 */

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

export function hexToOklch(hex) {
  const c = /^#?[0-9a-f]{6}$/i.test(hex || '') ? hex.replace('#', '') : '4f7cff';
  const [r, g, b] = [0, 2, 4].map((i) => srgbToLinear(parseInt(c.slice(i, i + 2), 16) / 255));

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;

  return { L, C: Math.hypot(a, bb), H: Math.atan2(bb, a) };
}

export function oklchToHex({ L, C, H }) {
  const a = C * Math.cos(H), b = C * Math.sin(H);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;

  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ].map((v) => Math.round(clamp01(linearToSrgb(v)) * 255));

  return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/* An achromatic seed used to be zeroed to pure grey. That kept a grey brand
   grey — but it also meant #000000, #888888, #ffffff and Google's own #5f6368
   ALL produced the identical #717171, so four differently-branded apps became
   indistinguishable, and a grey mark in a launcher of coloured ones reads as
   disabled. Pinning L makes this unavoidable: greys at one lightness are one
   colour. So an achromatic seed now takes a deterministic hue derived from the
   app's key, at low chroma — a tinted neutral, distinct per app, still quiet.
   Forcing hue 0 (which turned every grey app red) was the wrong fix, not the
   wrong problem. */
function hueFromKey(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return (h % 360) * (Math.PI / 180);
}

function tone(base, L, maxC) {
  return oklchToHex({ L, C: Math.min(base.C, maxC), H: base.H });
}

/* WHY THE TONES ARE THIS FAR APART: the previous pairs sat 1.38-1.55:1 from
   each other, so every internal detail drawn in --ic-deep — the folded corner
   of the document, the camera lens, the book's spine, the person's shoulders —
   was invisible at 44px and each mark read as a flat silhouette. A product
   family needs its marks to have INTERNAL structure. These values are the
   widest separation that still keeps every other guarantee (fill and deep both
   >= 3:1 on page and panel, pale >= 3:1 on fill, monogram >= 4.5:1 on its
   plate), searched across all seeded brand colours; tools/theme-audit.mjs
   recomputes the lot. */
export function iconTones(hex, key = '') {
  /* A MISSING colour is the case this mechanism exists for, and it used to skip
     it: `hexToOklch(hex ?? '#4f7cff')` substituted a chromatic blue before the
     achromatic test, so every app with a null sa_apps.color came out the
     identical #567ce2 — four apps in the real fleet rendered as the same blue
     plate. Decide on the INPUT, not on what it fell back to. */
  const valid = /^#?[0-9a-f]{6}$/i.test(hex || '');
  const raw = valid ? hexToOklch(hex) : null;
  const base = (!raw || raw.C < 0.02)
    ? { L: raw ? raw.L : 0.6, C: 0.06, H: hueFromKey(key || String(hex ?? '')) }
    : raw;
  return {
    '--ic-fill-l': tone(base, 0.61, 0.16),
    '--ic-deep-l': tone(base, 0.26, 0.16),
    /* 0.97, not 0.94: --ic-pale draws the detail ON TOP of --ic-fill (the
       document rule lines, the envelope flap, the shield tick, the gear hub),
       so it owes 3:1 against fill, not against the page. Swept across the hue
       circle at several chromas the old value bottomed out at 2.85:1 on
       green-cyan seeds — and nothing checked it, while the comment below
       claimed the audit did. It does now. */
    '--ic-pale-l': tone(base, 0.97, 0.05),
    '--ic-fill-d': tone(base, 0.84, 0.14),
    '--ic-deep-d': tone(base, 0.62, 0.14),
    '--ic-pale-d': tone(base, 0.22, 0.07),
  };
}
