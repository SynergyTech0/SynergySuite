// Contrast verification for the design tokens in src/app/globals.css.
//
// Reads the oklch() values straight out of the stylesheet, converts them to sRGB, and
// computes WCAG 2.1 contrast ratios for every foreground/background pair the UI actually
// uses — in both themes. Eyeballing a screenshot cannot tell you that #8b8b93 on #f7f7f9 is
// 3.9:1 and fails; this can.
//
// Badge and metadata text is 11–12px, so every pair here is held to the 4.5:1 normal-text
// threshold rather than the 3:1 large-text one.

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = join(here, '..', 'src', 'app', 'globals.css');

// ── oklch → sRGB (Björn Ottosson's Oklab matrices) ───────────────────────────
function oklchToSrgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const bb = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = L - 0.0894841775 * a - 1.291485548 * bb;

  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;

  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  // Clamp: a token outside the sRGB gamut renders clipped, so measure what ships.
  return lin.map((v) => Math.min(1, Math.max(0, v)));
}

function relLuminance(linRgb) {
  const [r, g, b] = linRgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fgLin, bgLin) {
  const a = relLuminance(fgLin) + 0.05;
  const b = relLuminance(bgLin) + 0.05;
  return a > b ? a / b : b / a;
}

function hex(linRgb) {
  const enc = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  return (
    '#' +
    linRgb
      .map((v) => Math.round(Math.min(255, Math.max(0, enc(v) * 255))).toString(16).padStart(2, '0'))
      .join('')
  );
}

// ── parse the two @theme blocks out of globals.css ───────────────────────────
const css = await readFile(cssPath, 'utf8');

// The dark block is the one nested inside the prefers-color-scheme media query.
const darkIdx = css.indexOf('@media (prefers-color-scheme: dark)');
if (darkIdx < 0) {
  console.error('No dark-mode block found in globals.css — expected a prefers-color-scheme rule.');
  process.exit(1);
}

function parseTokens(text) {
  const out = {};
  const re = /--color-([a-z0-9-]+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/g;
  let m;
  while ((m = re.exec(text))) {
    out[m[1]] = oklchToSrgb(Number(m[2]), Number(m[3]), Number(m[4]));
  }
  return out;
}

const light = parseTokens(css.slice(0, darkIdx));
const dark = { ...light, ...parseTokens(css.slice(darkIdx)) };

// ── the pairs the UI actually renders ────────────────────────────────────────
const PAIRS = [
  ['ink', 'surface', 'body text on page background'],
  ['ink', 'surface-2', 'body text on card'],
  ['ink-2', 'surface', 'secondary text on page'],
  ['ink-2', 'surface-2', 'secondary text on card'],
  ['ink-3', 'surface', 'metadata on page'],
  ['ink-3', 'surface-2', 'metadata on card'],
  ['accent', 'surface', 'links on page'],
  ['accent', 'surface-2', 'links on card'],
  ['ok', 'ok-soft', 'Pass / Implemented badge'],
  ['warn', 'warn-soft', 'Partial / Not measured badge'],
  ['bad', 'bad-soft', 'Fail / No control badge'],
  ['info', 'info-soft', 'Mapped-not-done badge'],
  ['mute', 'mute-soft', 'N/A badge'],
  ['ok', 'surface-2', 'audit-ready stat figure'],
  ['warn', 'surface-2', 'warning stat figure'],
  ['bad', 'surface-2', 'failing stat figure'],
];

const MIN = 4.5;
let pass = 0;
const failures = [];

for (const [themeName, tokens] of [['light', light], ['dark', dark]]) {
  console.log(`\n=== ${themeName} theme ===\n`);
  for (const [fg, bg, use] of PAIRS) {
    if (!tokens[fg] || !tokens[bg]) {
      failures.push(`${themeName}: token --color-${tokens[fg] ? bg : fg} not found`);
      console.log(`  FAIL  ${fg} on ${bg} — token missing`);
      continue;
    }
    const ratio = contrast(tokens[fg], tokens[bg]);
    const ok = ratio >= MIN;
    const line =
      `${fg} on ${bg}`.padEnd(26) +
      `${ratio.toFixed(2)}:1`.padStart(8) +
      `   ${hex(tokens[fg])} on ${hex(tokens[bg])}   ${use}`;
    if (ok) {
      pass++;
      console.log(`  PASS  ${line}`);
    } else {
      failures.push(`${themeName}: ${fg} on ${bg} = ${ratio.toFixed(2)}:1 (need ${MIN}) — ${use}`);
      console.log(`  FAIL  ${line}`);
    }
  }
}

console.log('\n' + '='.repeat(72));
if (failures.length) {
  console.log(`FAILED — ${pass} passed, ${failures.length} below ${MIN}:1:\n`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log(`All ${pass} contrast pairs meet WCAG AA (${MIN}:1) in both themes.`);
}
console.log('='.repeat(72) + '\n');
