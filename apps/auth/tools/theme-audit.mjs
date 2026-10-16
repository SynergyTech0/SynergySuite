/*
 * Theme audit — objective checks on the Hub design system.
 *
 *   node tools/theme-audit.mjs             run the checks
 *   node tools/theme-audit.mjs --selftest  prove the checks can actually fail
 *
 * WHY THIS WAS REWRITTEN
 * The previous version reported 113/113 while the entire system-dark palette was
 * deleted, while body text was 1.09:1 for every OS-dark user, and with hardcoded
 * colours planted in three places. Four holes:
 *   1. it parsed only the [data-sh-theme='dark'] block and never the
 *      @media (prefers-color-scheme: dark) block — the palette most dark users
 *      actually get;
 *   2. its literal scanner treated ANY rule whose selector began with :root as a
 *      token block, exempting real rules like `:root[...] .sh-appicon`;
 *   3. it matched only #hex, so rgb()/hsl()/named colours were invisible;
 *   4. it scanned a hand-maintained list of three files that already missed one
 *      containing a literal.
 * A green suite that cannot go red is worse than none, because it is trusted.
 * Hence --selftest: the suite must demonstrate it fails when the product breaks.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { iconTones, oklchToHex } from '../app/icon-tones.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => { try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; } };
const css = read('app/hub.css');
const suiteCss = read('public/synergy-theme.css');

// ---------------------------------------------------------------- colour maths
const hex = (h) => {
  h = h.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const lum = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [lum(hex(a)), lum(hex(b))].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

let pass = 0, fail = 0;
const problems = [];
const notes = [];
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else { fail++; problems.push(`${name}${detail ? ' — ' + detail : ''}`); }
};

// ---------------------------------------------------------------- parsing
const declsIn = (block) => {
  const out = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]] = m[2].trim();
  return out;
};
/* Body of the first rule whose selector matches, brace-balanced so a nested
   @media does not truncate it. */
function ruleBody(source, selectorStart) {
  const i = source.indexOf(selectorStart);
  if (i < 0) return '';
  const open = source.indexOf('{', i);
  if (open < 0) return '';
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}') { depth--; if (depth === 0) return source.slice(open + 1, j); }
  }
  return '';
}

const light = declsIn(ruleBody(css, ':root {'));
const attrDark = declsIn(ruleBody(css, ":root[data-sh-theme='dark']"));
const mediaBlock = ruleBody(css, '@media (prefers-color-scheme: dark)');
const mediaDark = declsIn(ruleBody(mediaBlock, ":root:not([data-sh-theme='light'])"));

check('light token block parsed', Object.keys(light).length > 10, `${Object.keys(light).length} tokens`);
check('forced-dark token block parsed', Object.keys(attrDark).length > 10, `${Object.keys(attrDark).length} tokens`);
check('system-dark (@media) token block parsed', Object.keys(mediaDark).length > 10,
  `${Object.keys(mediaDark).length} tokens — at 0 the audit is blind to OS-dark users`);

/* The two dark palettes are hand-duplicated; nothing stops them drifting. */
{
  const keys = new Set([...Object.keys(attrDark), ...Object.keys(mediaDark)]);
  const diffs = [...keys].filter((k) => attrDark[k] !== mediaDark[k])
    .map((k) => `${k}: forced=${attrDark[k] ?? '(absent)'} system=${mediaDark[k] ?? '(absent)'}`);
  check('system-dark and forced-dark palettes are identical', diffs.length === 0, diffs.join('; '));
}

// ---------------------------------------------------------------- 1. parity
const COLOUR_RE = /^#|^rgba?\(|^hsla?\(/;
for (const [t, v] of Object.entries(light)) {
  if (!COLOUR_RE.test(v)) continue;
  check(`dark override exists for ${t}`, t in attrDark && t in mediaDark,
    'a light-only token leaks its light value into dark mode');
}

// ---------------------------------------------------------------- 2. contrast
const PAIRS = [
  ['body text',             '--sh-on',                     '--sh-bg',                  4.5],
  /* --sh-surface is used in exactly ONE rule, the skip link, where the text is
     --sh-primary. "Body text on surface" and "secondary on surface" were pairs
     that do not occur anywhere in the product — six checks reporting on a
     combination no user ever sees, which is worse than no check because it
     looks like coverage. */
  ['skip link on surface',  '--sh-primary',                '--sh-surface',             4.5],
  ['body text on elevated', '--sh-on',                     '--sh-surface-elev',        4.5],
  ['secondary text',        '--sh-on-variant',             '--sh-bg',                  4.5],
  ['secondary on elevated', '--sh-on-variant',             '--sh-surface-elev',        4.5],
  ['filled button label',   '--sh-on-primary',             '--sh-primary',             4.5],
  ['selected container',    '--sh-on-secondary-container', '--sh-secondary-container', 4.5],
  ['primary on bg',         '--sh-primary',                '--sh-bg',                  4.5],
  ['primary on elevated',   '--sh-primary',                '--sh-surface-elev',        4.5],
  /* Panels sit on --sh-surface-elev, not --sh-surface, so the boundary that
     actually has to hold 3:1 is this one. Checking only the flat surface left
     every popover border unverified. */
  ['outline vs elevated',   '--sh-outline',                '--sh-surface-elev',        3.0],
];
/* Informational: Google's own divider is #dadce0 on white (1.37:1). Google is
   the anchor, so matching it is deliberate — but the number stays visible. */
const INFO = [
  /* Measured against what each divider is ACTUALLY drawn on. The old pair put
     --sh-divider against --sh-surface, a background it never touches, and
     reported a comfortable 1.57:1 while the account-menu separator was sitting
     at 1.28:1 on the elevated surface, invisible in dark mode. */
  ['top-bar hairline vs page', '--sh-divider', '--sh-bg'],
  ['menu separator vs panel', '--sh-divider-elev', '--sh-surface-elev'],
  /* The search chip's fill. Light is ~1.06:1 and that is Gmail's own value, so
     it is reported rather than gated; dark is gated below because ours was
     WORSE than Google's (1.13:1 against a 1.43:1 anchor) and the field read as
     absent rather than subtle. */
  ['search chip vs bar', '--sh-container', '--sh-bg'],
];

for (const [theme, set] of [
  ['light', light],
  ['system-dark', { ...light, ...mediaDark }],
  ['forced-dark', { ...light, ...attrDark }],
]) {
  for (const [label, fg, bg] of INFO) {
    const a = set[fg], b = set[bg];
    if (a && b && a.startsWith('#') && b.startsWith('#'))
      notes.push(`${theme}: ${label} = ${contrast(a, b).toFixed(2)}:1 (matches Google; not gated)`);
  }
  for (const [label, fg, bg, min] of PAIRS) {
    const a = set[fg], b = set[bg];
    if (!a || !b || !a.startsWith('#') || !b.startsWith('#')) {
      check(`${theme}: ${label}`, false, `missing or non-hex (${fg}=${a}, ${bg}=${b})`);
      continue;
    }
    const c = contrast(a, b);
    check(`${theme}: ${label} >= ${min}:1`, c >= min, `${a} on ${b} = ${c.toFixed(2)}:1`);
  }

  /* Dark only: on a dark bar a chip that is DARKER than the bar disappears,
     which is not what Gmail does — its dark chip sits at ~1.43:1. On a light
     bar the same 1.06:1 is Google's own choice, so gating both would be
     gating against the anchor. */
  if (theme !== 'light') {
    const chip = set['--sh-container'], bar = set['--sh-bg'];
    const c = chip && bar && chip.startsWith('#') && bar.startsWith('#') ? contrast(chip, bar) : 0;
    check(`${theme}: search chip vs bar >= 1.35:1`, c >= 1.35,
      `${chip} on ${bar} = ${c.toFixed(2)}:1 — Gmail's dark chip is ~1.43:1`);
  }
}

// ---------------------------------------------------------------- 3. literals
/* A rule is a token block only if EVERY declaration is a custom property. The
   old test — "the selector starts with :root" — exempted real rules such as
   `:root[data-sh-theme='dark'] .sh-appicon`. */
function strayLiterals(src, label) {
  const source = src.replace(/\/\*[\s\S]*?\*\//g, '');   // comments are not declarations
  const strays = [];
  for (const m of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (selector.startsWith('@')) continue;
    const decls = m[2].split(';').map((d) => d.trim()).filter(Boolean);
    if (decls.length && decls.every((d) => d.startsWith('--'))) continue;
    for (const d of decls) {
      if (d.startsWith('--')) continue;
      const lit = d.match(/#[0-9a-f]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)|:\s*(?:white|black|red|blue|green|yellow|orange|purple|gray|grey)\b/i);
      if (lit && !/url\(/.test(d)) strays.push(`${label} :: ${selector.slice(0, 44)} :: ${d.slice(0, 56)}`);
    }
  }
  return strays;
}
/* BOTH stylesheets. synergy-theme.css ships to seven apps and was never scanned
   for literals at all — a hardcoded colour in a live .sy-card rule went
   straight to production unremarked. */
for (const [label, src] of [['hub.css', css], ['synergy-theme.css', suiteCss]]) {
  if (!src) continue;
  const strays = strayLiterals(src, label);
  check(`no colour literals outside the token layer (${label})`, strays.length === 0,
    strays.length ? `${strays.length}:\n      ` + strays.join('\n      ') : '');
}

/* WALKED, not hand-listed. The previous list named five files by hand — which
   is the same mistake this file's header criticises the version before it for,
   and it missed layout.tsx, which had a literal in it. Anything under app/ that
   can carry a colour is scanned now, so a new file is covered the day it lands. */
function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(join(ROOT, dir), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(rel, out); }
    else if (/\.(tsx?|jsx?|mjs)$/.test(e.name)) out.push(rel);
  }
  return out;
}
/* waffle.js is exempt by design: injected into third-party pages where no token
   layer is guaranteed, so it must carry literal fallbacks — kept in one table
   and contrast-asserted below. icon-tones.mjs is exempt because deriving colour
   is its entire job. dev-preview is dev-only and never reaches a user. */
const EXEMPT = /icon-tones\.mjs$|^app\/dev-preview\//;
/* Scope is the Hub design system, by DIRECTORY rather than by filename, so a
   new file under these paths is covered the day it lands. The login / consent /
   account / authenticator pages are deliberately outside it — they are the older
   navy theme, hub.css is scoped so as not to disturb them, and gating their
   colours here would be asserting a design decision nobody made. */
const CODE_FILES = [
  ...walk('app/hub'), ...walk('app/waffle'),
  'app/AppIcon.tsx', 'app/layout.tsx',
].filter((f) => !EXEMPT.test(f));
check('code scan covers every file on the Hub surfaces', CODE_FILES.length >= 6,
  `${CODE_FILES.length} files: ${CODE_FILES.join(', ')}`);
for (const rel of CODE_FILES) {
  const src = read(rel);
  if (!src) { check(`${rel} readable`, false, 'file missing'); continue; }
  const hits = [];
  src.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    const m = line.match(/#[0-9a-f]{6}\b|\brgba?\(\s*\d+[^)]*\)/i);
    if (m) hits.push(`${rel}:${i + 1} ${m[0]}`);
  });
  check(`no colour literals in ${rel}`, hits.length === 0, hits.join(', '));
}

// ---------------------------------------------------------------- 4. suite theme
/* synergy-theme.css ships to seven apps via nginx and previously had no coverage. */
if (suiteCss) {
  const sLight = declsIn(ruleBody(suiteCss, ':root {'));
  const sDark = declsIn(ruleBody(suiteCss, ":root[data-sy-theme='dark']"));
  /* The auto palette, inside @media (prefers-color-scheme: dark). This section
     parsed only the two explicit blocks — which is the EXACT hole this file's
     own header describes for hub.css, left open one section later. Every
     OS-dark user of every themed app was outside the audit. */
  const sMediaBlock = ruleBody(suiteCss, '@media (prefers-color-scheme: dark)');
  const sAuto = declsIn(ruleBody(sMediaBlock, ":root[data-sy-theme='auto']"));
  check('suite auto-dark (@media) token block parsed', Object.keys(sAuto).length > 10,
    `${Object.keys(sAuto).length} tokens — at 0 the suite's OS-dark users are unchecked`);

  /* The file's header promises it "never sets position, display, width, height,
     float or grid/flex properties, so it cannot break an app's layout". That
     was prose, not a rule: it shipped `scrollbar-width: thin` and a 12px
     ::-webkit-scrollbar on a universal selector, plus a global
     `animation-duration: .01ms !important` that froze every host app's spinner.
     A promise a stylesheet makes about seven apps it does not own should be
     enforced, not asserted. Opt-in rules (.sy-*) may do as they like — the app
     asked for those by adding the class. */
  {
    const LAYOUT = /(^|[;{\s])(position|display|width|height|float|grid[a-z-]*|flex[a-z-]*|scrollbar-width)\s*:/;
    const bare = [];
    const body = suiteCss.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim();
      if (sel.startsWith('@')) continue;
      // Opt-in (.sy-…) and the token blocks are the app's own choice.
      if (/\.sy-/.test(sel) || /^:root/.test(sel)) continue;
      if (LAYOUT.test(m[2])) bare.push(`${sel.slice(0, 40)} :: ${m[2].trim().slice(0, 50)}`);
    }
    check('suite theme sets no layout property outside its own opt-in classes',
      bare.length === 0, bare.join(' | '));

    const globalMotion = /(^|[,{])\s*\*(\s*,|\s*::|\s*\{)/.test(
      ruleBody(body, '@media (prefers-reduced-motion: reduce)'));
    check('suite reduced-motion rule does not target every element in the host app',
      !globalMotion, 'a global animation-duration override freezes host spinners');
  }

  /* The two dark palettes are hand-duplicated here too. */
  {
    const keys = new Set([...Object.keys(sDark), ...Object.keys(sAuto)]);
    const diffs = [...keys].filter((k) => sDark[k] !== sAuto[k])
      .map((k) => `${k}: forced=${sDark[k] ?? '(absent)'} auto=${sAuto[k] ?? '(absent)'}`);
    check('suite auto-dark and forced-dark palettes are identical', diffs.length === 0, diffs.join('; '));
  }
  const SUITE_PAIRS = [
    ['link on bg',         '--sy-link',    '--sy-bg',      4.5],
    ['link on surface',    '--sy-link',    '--sy-surface', 4.5],
    ['body text on bg',    '--sy-on',      '--sy-bg',      4.5],
    ['outline vs surface', '--sy-outline', '--sy-surface', 3.0],
  ];
  for (const [theme, set] of [
    ['suite-light', sLight],
    ['suite-forced-dark', { ...sLight, ...sDark }],
    ['suite-auto-dark', { ...sLight, ...sAuto }],
  ]) {
    for (const [label, fg, bg, min] of SUITE_PAIRS) {
      const a = set[fg], b = set[bg];
      if (!a || !b || !a.startsWith('#') || !b.startsWith('#')) {
        check(`${theme}: ${label}`, false, `missing (${fg}=${a}, ${bg}=${b})`);
        continue;
      }
      const c = contrast(a, b);
      check(`${theme}: ${label} >= ${min}:1`, c >= min, `${a} on ${b} = ${c.toFixed(2)}:1`);
    }
  }
  const thumb = /::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*var\((--sy-[a-z-]+)\)/.exec(suiteCss);
  if (thumb) {
    const v = sLight[thumb[1]];
    const c = v && v.startsWith('#') ? contrast(v, sLight['--sy-surface']) : 0;
    check('suite scrollbar thumb >= 3:1', c >= 3, `${thumb[1]}=${v} = ${c.toFixed(2)}:1`);
  }
} else {
  check('synergy-theme.css readable', false, 'file missing');
}

// ---------------------------------------------------------------- 5. icon tones
const BRANDS = [
  '#4f7cff', '#1a73e8', '#00832d', '#00ac47', '#7248b9', '#ea4335',
  '#f9ab00', '#e8710a', '#5f6368', '#188038', '#d93025', '#00696e',
  '#000000', '#888888', '#ffffff',
];
for (const brand of BRANDS) {
  const t = iconTones(brand);
  for (const [label, tone, bg] of [
    ['light page', t['--ic-fill-l'], light['--sh-bg']],
    ['light panel', t['--ic-fill-l'], light['--sh-surface-elev']],
    ['dark page', t['--ic-fill-d'], mediaDark['--sh-bg']],
    ['dark panel', t['--ic-fill-d'], mediaDark['--sh-surface-elev']],
  ]) {
    const c = bg && bg.startsWith('#') ? contrast(tone, bg) : 0;
    check(`icon mark >= 3:1 on ${label} (${brand})`, c >= 3, `${tone} = ${c.toFixed(2)}:1`);
  }
  /* The monogram sits on its own PLATE, not directly on the panel, so the old
     letter-vs-panel check stopped measuring anything real. Two assertions
     replace it: the letter against what is actually behind it (4.5:1, it is
     text) and the plate against the panel (3:1, it is a graphic boundary).
     The plate is --ic-deep and the letter --ic-pale, not the reverse: a pale
     plate on a pale panel measured 1.21:1, which is not a plate at all. */
  for (const [label, ink, plate, panel] of [
    ['light', t['--ic-pale-l'], t['--ic-deep-l'], light['--sh-surface-elev']],
    ['dark', t['--ic-pale-d'], t['--ic-deep-d'], mediaDark['--sh-surface-elev']],
  ]) {
    check(`monogram letter >= 4.5:1 on its plate, ${label} (${brand})`,
      contrast(ink, plate) >= 4.5, `${ink} on ${plate} = ${contrast(ink, plate).toFixed(2)}:1`);
    const c = panel && panel.startsWith('#') ? contrast(plate, panel) : 0;
    check(`monogram plate >= 3:1 on the ${label} panel (${brand})`, c >= 3,
      `${plate} on ${panel} = ${c.toFixed(2)}:1`);
  }

  /* The two tones of a single mark must differ enough to see. At 1.38-1.55:1 —
     where they sat — the folded corner of the document, the camera lens and the
     book's spine were invisible at 44px and every mark was a flat silhouette. */
  for (const [label, fill, deep] of [
    ['light', t['--ic-fill-l'], t['--ic-deep-l']],
    ['dark', t['--ic-fill-d'], t['--ic-deep-d']],
  ]) {
    const c = contrast(fill, deep);
    check(`mark's two tones are distinguishable, ${label} (${brand})`, c >= 2.0,
      `${deep} on ${fill} = ${c.toFixed(2)}:1 — the mark reads as one flat shape`);
  }
}

/* --ic-pale draws the detail ON TOP of --ic-fill, so it owes 3:1 against fill.
   icon-tones.mjs claimed "the audit recomputes the lot" and there was NO such
   check — and the seeded brand list would not have found it anyway: the floor
   is on green-cyan hues that no seed happens to sit on. Sweep the hue circle. */
{
  let worst = Infinity, worstAt = '';
  for (let deg = 0; deg < 360; deg += 3) {
    for (const C of [0.05, 0.10, 0.16, 0.22, 0.30]) {
      for (const L of [0.35, 0.55, 0.75]) {
        const seed = oklchToHex({ L, C, H: (deg * Math.PI) / 180 });
        const t = iconTones(seed, 'sweep');
        const c = contrast(t['--ic-pale-l'], t['--ic-fill-l']);
        if (c < worst) { worst = c; worstAt = `${t['--ic-pale-l']} on ${t['--ic-fill-l']} (seed ${seed})`; }
      }
    }
  }
  check('pale detail >= 3:1 on the mark it sits on, across every hue', worst >= 3,
    `worst ${worst.toFixed(2)}:1 — ${worstAt}`);
}

/* Pinning L means two achromatic seeds produce the SAME colour: #000000,
   #888888, #ffffff and #5f6368 all emitted #717171, so four differently-branded
   apps were indistinguishable. */
{
  const byFill = {};
  for (const brand of BRANDS) {
    const f = iconTones(brand, brand)['--ic-fill-l'];
    (byFill[f] = byFill[f] || []).push(brand);
  }
  const collisions = Object.entries(byFill).filter(([, v]) => v.length > 1)
    .map(([k, v]) => `${k} <- ${v.join(', ')}`);
  check('no two brand colours collapse to the same mark', collisions.length === 0,
    collisions.join(' | '));
}
/* This used to assert that an achromatic brand stayed exactly neutral. That
   rule was written to stop a bug where forcing hue 0 turned every grey app red,
   but taken literally it guaranteed the collision above: neutral greys at a
   pinned L are all the SAME grey. An achromatic seed now takes a deterministic
   hue from its key at low chroma — distinct per app, still quiet. The rule that
   replaces it is the one actually wanted: a grey brand must not become a
   saturated one. */
{
  const spread = (hexStr) => {
    const g = hexStr.replace('#', '');
    const [r, gg, b] = [0, 2, 4].map((i) => parseInt(g.slice(i, i + 2), 16));
    return Math.max(r, gg, b) - Math.min(r, gg, b);
  };
  for (const seed of ['#888888', '#000000', '#ffffff', '#5f6368']) {
    for (const [label, key] of [['light', '--ic-fill-l'], ['dark', '--ic-fill-d']]) {
      const out = iconTones(seed, seed)[key];
      check(`achromatic brand ${seed} stays quiet in ${label}`, spread(out) <= 64,
        `${out} channel spread ${spread(out)} — a grey brand should tint, not saturate`);
    }
  }
}

// ---------------------------------------------------------------- 6. icon geometry
/* Marks are drawn in a 42-unit box then scaled about (21,21) by OPTICAL. Scaled
   geometry that leaves the box is clipped by the SVG viewport — which is how the
   camera mark shipped with its lens sliced off. */
{
  const icon = read('app/AppIcon.tsx');
  const optical = {};
  const om = /const OPTICAL[^=]*=\s*\{([\s\S]*?)\}/.exec(icon);
  if (om) for (const m of om[1].matchAll(/(\w+):\s*([\d.]+)/g)) optical[m[1]] = parseFloat(m[2]);

  const bodies = {};
  for (const m of icon.matchAll(/case '(\w+)':([\s\S]*?)(?=\n\s+case '|\n\s+default:)/g)) {
    bodies[m[1]] = m[2];
  }
  check('icon shapes and OPTICAL parsed',
    Object.keys(bodies).length > 8 && Object.keys(optical).length > 8,
    `${Object.keys(bodies).length} shapes, ${Object.keys(optical).length} scales`);

  /* A real walker: SVG path data mixes absolute and relative commands, arc radii
     and control points, so treating every number as a coordinate (as a first
     attempt did) reports nonsense. Track the current point and collect only
     actual geometry. */
  /* SVG arc, endpoint parameterisation -> centre parameterisation, then
     sampled. Straight out of the spec's implementation notes (F.6.5). Sampling
     rather than solving for the extrema: 33 points is well inside a tenth of a
     unit on a 42-unit box, and it is far harder to get subtly wrong. */
  function arcPoints(x1, y1, x2, y2, rx, ry, rotDeg, large, sweep) {
    if (!rx || !ry) return [[x2, y2]];
    rx = Math.abs(rx); ry = Math.abs(ry);
    const phi = (rotDeg * Math.PI) / 180;
    const cosP = Math.cos(phi), sinP = Math.sin(phi);
    const dx2 = (x1 - x2) / 2, dy2 = (y1 - y2) / 2;
    const x1p = cosP * dx2 + sinP * dy2;
    const y1p = -sinP * dx2 + cosP * dy2;

    // Scale the radii up if they are too small to span the chord.
    const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lam > 1) { const k = Math.sqrt(lam); rx *= k; ry *= k; }

    const sign = large !== sweep ? 1 : -1;
    const num0 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den0 = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const co = sign * Math.sqrt(Math.max(0, num0) / (den0 || 1));
    const cxp = (co * rx * y1p) / ry;
    const cyp = (-co * ry * x1p) / rx;
    const ccx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
    const ccy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;

    const ang = (ux, uy, vx, vy) => {
      const d = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy)) || 1;
      let a = Math.acos(Math.min(1, Math.max(-1, (ux * vx + uy * vy) / d)));
      if (ux * vy - uy * vx < 0) a = -a;
      return a;
    };
    const ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry;
    const vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry;
    const t1 = ang(1, 0, ux, uy);
    let dt = ang(ux, uy, vx, vy);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    if (sweep && dt < 0) dt += 2 * Math.PI;

    const out = [];
    const STEPS = 32;
    for (let i = 0; i <= STEPS; i++) {
      const t = t1 + (dt * i) / STEPS;
      out.push([
        ccx + rx * Math.cos(t) * cosP - ry * Math.sin(t) * sinP,
        ccy + rx * Math.cos(t) * sinP + ry * Math.sin(t) * cosP,
      ]);
    }
    return out;
  }

  function pathPoints(d) {
    const pts = [];
    let cx = 0, cy = 0, sx = 0, sy = 0;
    const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
    let i = 0, cmd = '';
    const num = () => parseFloat(tokens[i++]);
    while (i < tokens.length) {
      if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
      const rel = cmd === cmd.toLowerCase();
      const C = cmd.toUpperCase();
      if (C === 'M' || C === 'L' || C === 'T') {
        const x = num(), y = num();
        cx = rel ? cx + x : x; cy = rel ? cy + y : y;
        if (C === 'M') { sx = cx; sy = cy; }
      } else if (C === 'H') { const x = num(); cx = rel ? cx + x : x; }
      else if (C === 'V') { const y = num(); cy = rel ? cy + y : y; }
      else if (C === 'C') {
        const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x = num(), y = num();
        pts.push([rel ? cx + x1 : x1, rel ? cy + y1 : y1], [rel ? cx + x2 : x2, rel ? cy + y2 : y2]);
        cx = rel ? cx + x : x; cy = rel ? cy + y : y;
      } else if (C === 'S' || C === 'Q') {
        const x1 = num(), y1 = num(), x = num(), y = num();
        pts.push([rel ? cx + x1 : x1, rel ? cy + y1 : y1]);
        cx = rel ? cx + x : x; cy = rel ? cy + y : y;
      } else if (C === 'A') {
        /* An arc BULGES past its endpoints. Recording only the endpoints
           under-measured a near-circular arc to a third of its real size, and
           the optical scale then grew the mark until it clipped. Bounding it by
           the radii around both ends over-corrected just as badly (a 14-unit
           pie measured 68). So: convert endpoint form to centre form the way
           the SVG spec's implementation notes describe, and sample the real
           sweep. */
        const rxIn = num(), ryIn = num(), rot = num(), large = num(), sweep = num();
        const x = num(), y = num();
        const ex = rel ? cx + x : x, ey = rel ? cy + y : y;
        for (const p of arcPoints(cx, cy, ex, ey, rxIn, ryIn, rot, large, sweep)) pts.push(p);
        cx = ex; cy = ey;
      } else if (C === 'Z') { cx = sx; cy = sy; }
      else { i++; continue; }
      pts.push([cx, cy]);
    }
    return pts;
  }

  const boxes = [];
  const measured = [];
  for (const [shape, body] of Object.entries(bodies)) {
    const k = optical[shape] ?? 1;
    /* Expand each element by ITS OWN half-stroke, at collection time.
       Padding the whole mark by its MAXIMUM stroke width inflated every mark
       that merely CONTAINS an interior stroke: `bubble` and `sms` share a
       byte-identical outer path, yet measured 0.97 vs 1.09 purely because
       bubble has a stroked line inside it. 59 of 67 marks carry an interior
       stroke, so every suggested scale for them was systematically small. */
    const pts = [];
    for (const el of body.match(/<(?:path|rect|circle)\b[^>]*\/?>/g) || []) {
      const swm = el.match(/strokeWidth="([\d.]+)"/);
      const pad = (/stroke=\{/.test(el) && swm) ? +swm[1] / 2 : 0;
      const push = (x, y) => pts.push([x - pad, y - pad], [x + pad, y + pad]);
      const dm = el.match(/\sd="([^"]+)"/);
      if (dm) for (const [x, y] of pathPoints(dm[1])) push(x, y);
      const rm = el.match(/x="([\d.]+)"\s+y="([\d.]+)"\s+width="([\d.]+)"\s+height="([\d.]+)"/);
      if (rm) { const x = +rm[1], y = +rm[2]; push(x, y); push(x + +rm[3], y + +rm[4]); }
      const cm = el.match(/cx="([\d.]+)"\s+cy="([\d.]+)"\s+r="([\d.]+)"/);
      if (cm) { const x = +cm[1], y = +cm[2], r = +cm[3]; push(x - r, y - r); push(x + r, y + r); }
    }
    if (!pts.length) { check(`mark "${shape}" geometry readable`, false, 'no points parsed'); continue; }
    /* A stroke straddles its path: half the width falls OUTSIDE the geometry.
       Ignoring it meant a stroked mark could overhang the viewBox by up to
       1.25 units and still be reported as fitting. */
    const stroke = Math.max(0, ...[...body.matchAll(/strokeWidth="([\d.]+)"/g)].map((m) => +m[1]));
    const pad = stroke / 2;
    let maxOffset = 0;
    for (const [x, y] of pts) {
      maxOffset = Math.max(maxOffset, Math.abs(x - 21), Math.abs(y - 21));
    }
    check(`mark "${shape}" fits its box at scale ${k}`, maxOffset * k <= 21.01,
      `reaches ${(maxOffset * k).toFixed(2)} of 21 — it will be clipped`);

    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const w = (Math.max(...xs) - Math.min(...xs)) * k;
    const h = (Math.max(...ys) - Math.min(...ys)) * k;
    boxes.push([shape, Math.sqrt(w * h), Math.max(w, h)]);

    /* --measure prints the scale each mark WOULD need, using this file's own
       walker. A separate measuring script drifted from it the moment the arc
       handling was fixed here, and produced scales that made three marks clip.
       One walker, one source of truth. */
    if (process.argv.includes('--measure')) {
      const target = 26;                       // the family's optical area
      const cap = 31;                          // and its largest-dimension cap
      const suggested = Math.min(target / (Math.sqrt(w * h) / k), cap / (Math.max(w, h) / k));
      measured.push([shape, k, w, h, suggested]);
    }
  }

  if (process.argv.includes('--measure')) {
    measured.sort((x, y) => y[4] - x[4]);
    console.log('\nsuggested OPTICAL scales (area 26, max-dimension cap 31):');
    const L = [];
    for (let i = 0; i < measured.length; i += 6) {
      L.push('  ' + measured.slice(i, i + 6).map((m) => m[0] + ': ' + m[4].toFixed(2)).join(', ') + ',');
    }
    console.log(L.join('\n'));
  }

  /* The marks must carry the same optical WEIGHT, or they do not read as one
     family. The scales previously equalised height alone while the comment
     claimed a shared box, and widths ran 18 to 41 in a 42-unit viewBox — a mark
     more than twice as wide as its neighbour. Area (sqrt(w*h)) is the measure
     that lets a wide mark stay wide without dominating the grid. */
  if (boxes.length) {
    const areas = boxes.map((b) => b[1]);
    const lo = Math.min(...areas), hi = Math.max(...areas);
    const loName = boxes.find((b) => b[1] === lo)[0], hiName = boxes.find((b) => b[1] === hi)[0];
    check('marks share an optical area within 1.15x', hi / lo <= 1.15,
      `${(hi / lo).toFixed(2)}x — ${loName} ${lo.toFixed(1)} vs ${hiName} ${hi.toFixed(1)}`);

    const maxes = boxes.map((b) => b[2]);
    const mlo = Math.min(...maxes), mhi = Math.max(...maxes);
    check('no mark is more than 1.3x another in its largest dimension', mhi / mlo <= 1.3,
      `${(mhi / mlo).toFixed(2)}x (${mlo.toFixed(1)} to ${mhi.toFixed(1)})`);
  }
}

// ---------------------------------------------------------------- 7. features
/* EVERY check here reads the comment-stripped source. Testing the raw file let
   a comment satisfy the check: the reduced-motion block, the forced-colors
   block and every :focus-visible rule could all be deleted and the suite stayed
   green because each phrase still appeared in the prose explaining it — which,
   in a file this heavily commented, is a near-certainty. The same for the
   breakpoints: the numbers survive in comments that name them. */
const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
const suiteNoComments = suiteCss.replace(/\/\*[\s\S]*?\*\//g, '');
check('has a prefers-reduced-motion guard', /@media[^{]*prefers-reduced-motion/.test(noComments));
check('has M3 breakpoints (600 and 840)',
  /@media[^{]*max-width:\s*840px/.test(noComments) && /@media[^{]*max-width:\s*600px/.test(noComments));
check('has a focus-visible rule', /:focus-visible\s*(,|\{)/.test(noComments));
check('handles forced-colors', /@media[^{]*forced-colors/.test(noComments));
check('font is self-hosted (no fonts.googleapis.com request)',
  !/fonts\.googleapis\.com/.test(noComments) && !/fonts\.googleapis\.com/.test(suiteNoComments));
check('declares @font-face locally', /@font-face/.test(noComments) && /\/fonts\//.test(noComments));
/* The face itself, not just the @font-face rule: pointing the stack at Comic
   Sans left every check above green. */
/* Read the TOKEN the UI actually renders in, not the first font-family in the
   file — which is the @font-face descriptor and is therefore always "Roboto
   Local" no matter what the interface is set in. The check was named for
   something it did not do: both stacks could be swapped to Comic Sans and it
   stayed green. */
for (const [label, src, token] of [
  ['hub', noComments, '--sh-font'], ['suite', suiteNoComments, '--sy-font'],
]) {
  if (!src) continue;
  const m = new RegExp(token + ':\\s*([^;]+);').exec(src);
  const stack = m ? m[1].trim() : null;
  check(`${label} UI font stack (${token}) leads with Roboto`,
    !!stack && /^['"]?Roboto/i.test(stack),
    `${token} is ${stack ?? '(not declared)'}`);
  /* And the element that carries it must still use the token. */
  const applied = new RegExp('font-family:\\s*var\\(' + token + '\\)').test(src);
  check(`${label} applies ${token} to the UI`, applied,
    `nothing renders in var(${token}) — the token is declared and unused`);
}

// ---------------------------------------------------------------- 8. waffle.js
{
  const w = read('public/waffle.js');
  const grab = (theme, key) => {
    const block = w.split(theme + ':')[1] || '';
    const m = block.match(new RegExp(key + ":\\s*'(#[0-9a-f]{6})'", 'i'));
    return m ? m[1] : null;
  };
  const surf = grab('dark', 'surface');
  const edge = (w.split('dark:')[1] || '').match(/edge:\s*'1px solid (#[0-9a-f]{6})'/i);

  for (const [label, fg, bg] of [
    ['glyph on light host', grab('light', 'glyph'), '#ffffff'],
    ['ring on light host', grab('light', 'ring'), '#ffffff'],
    ['glyph on dark host', grab('dark', 'glyph'), '#1f1f1f'],
    ['ring on dark host', grab('dark', 'ring'), '#1f1f1f'],
  ]) {
    if (!fg) { check(`waffle ${label}`, false, 'token unreadable'); continue; }
    const c = contrast(fg, bg);
    check(`waffle ${label} >= 3:1`, c >= 3, `${fg} on ${bg} = ${c.toFixed(2)}:1`);
  }
  if (edge && surf) {
    for (const [label, bg] of [['its own surface', surf], ['a dark host page', '#131314']]) {
      const c = contrast(edge[1], bg);
      check(`waffle dark hairline >= 3:1 vs ${label}`, c >= 3, `${edge[1]} on ${bg} = ${c.toFixed(2)}:1`);
    }
  } else check('waffle dark hairline readable', false, 'could not read T.dark.edge/surface');
}

// ------------------------------------------------ 8b. icons for real names
/* The shape table is only worth anything if the FLEET resolves through it. The
   first version matched exact slugs and \b-anchored words, so every camel-case
   product name — which is every name here — fell through to a monogram. A
   launcher of bare letters passes every colour check ever written. */
{
  const src = read('app/AppIcon.tsx');
  const LFCHAR = String.fromCharCode(10);

  /* Re-implement the matcher from the source so this cannot drift: pull the
     tables and the word splitter out of the component itself. */
  const tableOf = (decl) => {
    const body = ruleBody(src, decl) || (() => {
      const i = src.indexOf(decl); if (i < 0) return '';
      const open = src.indexOf('{', i); let d = 0;
      for (let j = open; j < src.length; j++) {
        if (src[j] === '{') d++;
        else if (src[j] === '}') { d--; if (!d) return src.slice(open + 1, j); }
      }
      return '';
    })();
    return body;
  };
  const bySlug = {};
  const slugBody = tableOf('const BY_SLUG');
  for (const m of slugBody.matchAll(/(\w+):\s*'(\w+)'/g)) bySlug[m[1]] = m[2];
  const byWord = [];
  /* BY_WORD is an ARRAY literal, so brace matching finds the wrong block —
     it walked past the table into the first function body below it. */
  const wStart = src.indexOf('const BY_WORD');
  const wordBody = wStart < 0 ? '' : src.slice(wStart, src.indexOf(LFCHAR + '];', wStart));
  for (const m of wordBody.matchAll(/\[\/(.+?)\/i,\s*'(\w+)'\]/g)) byWord.push([new RegExp(m[1], 'i'), m[2]]);

  check('icon match tables parsed',
    Object.keys(bySlug).length > 10 && byWord.length > 5,
    `${Object.keys(bySlug).length} slugs, ${byWord.length} patterns`);

  /* Take the camel-case splitter FROM the component. Re-implementing it here
     would let the audit pass while the shipped matcher was broken — the copy
     would keep resolving names the product no longer resolves. */
  const camel = /\.replace\(\/(.+?)\/g, '\$1 \$2'\)/.exec(src);
  check('AppIcon splits camel-case before matching', !!camel,
    'no camel-case split in shapeFor — camel-case names cannot resolve');
  const CAMEL = camel ? new RegExp(camel[1], 'g') : /(?!)/g;
  const words = (x) => (x || '')
    .replace(CAMEL, '$1 $2')
    .toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && w !== 'synergy');
  const shapeFor = (slug, name) => {
    const toks = [...words(slug), ...words(name)];
    for (const t of toks) if (bySlug[t]) return bySlug[t];
    const hay = toks.join(' ');
    for (const [re, sh] of byWord) if (re.test(hay)) return sh;
    return '';
  };

  /* THE REAL FLEET — every app in the estate, not a list chosen to match the
     table. The previous version listed exactly the fifteen apps the shape table
     already covered, so it was the table validating itself: 22 of the 37 real
     apps rendered as bare letters and this check stayed green. A fixture list
     drawn from the thing under test proves nothing. */
  /* TypeScript caught a duplicate BY_SLUG key that this suite did not: adding
     `video: 'play'` beside the existing `video: 'camera'` silently shadowed one
     of them, and the audit passed 451/451 while the production build failed.
     A map whose keys collide resolves an app to the wrong mark, which is exactly
     what the checks below exist to prevent. */
  {
    const slugBlock = src.split('const BY_SLUG')[1].split('};')[0];
    const keys = [...slugBlock.matchAll(/(?:^|[{,\s])([a-z0-9]+):\s*'/g)].map((m) => m[1]);
    const dupes = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
    check('BY_SLUG has no duplicate keys', dupes.length === 0,
      `duplicated: ${dupes.join(', ')} — one silently shadows the other`);
  }
  const FLEET = [
    ['streamr', 'Streamr'],
    ['drive', 'SynergyDrive'], ['meet', 'SynergyMeet'], ['chat', 'SynergyChat'],
    ['mail', 'SynergyMail'], ['sign', 'SynergySign'], ['boards', 'SynergyBoards'],
    ['routes', 'SynergyRoutes'], ['msp', 'SynergyMSP'], ['books', 'SynergyBooks'],
    ['vault', 'SynergyVault'], ['exec', 'Executive Portal'], ['admin', 'Admin Console'],
    ['forms', 'SynergyForms'], ['people', 'SynergyPeople'],
    ['law', 'SynergyLaw'], ['emr', 'SynergyEMR'], ['meter', 'SynergyMeter'],
    ['sms', 'SynergySMS'], ['phone', 'SynergyPhone'], ['transcribe', 'SynergyTranscribe'],
    ['erp', 'SynergyERP'], ['wire', 'SynergyWire'], ['invest', 'SynergyInvest'],
    ['flight', 'SynergyFlight'], ['shield', 'SynergyShield'], ['crm', 'SynergyCRM'],
    ['auth', 'SynergyAuth'], ['terminal', 'SynergyTerminal'], ['sdr', 'SynergySDR'],
    ['db', 'SynergyDB'],
    ['os', 'SynergyOS'], ['linkcheck', 'synergy-linkcheck'],
    ['leadscout', 'LeadScout'],
    /* A reviewer drew THEIR fixture from the live fleet instead of from the
       shape table and found 14 more apps rendering as letters. Widening this
       list is the point: it is only worth anything if it is ahead of the
       table. */
    ['alias', 'synergy-alias'], ['removals', 'synergy-removals'],
    ['mask', 'synergy-mask'], ['verify', 'synergy-verify'],
    ['act', 'synergy-act'], ['aba', 'synergy-aba'],
    ['syntelligence', 'Syntelligence'], ['credit', 'Credit-AI'],
    ['weather', 'SynergyWeather'], ['backups', 'Backups'],
    ['gitea', 'Gitea'],

    /* EVERY ROW OF PRODUCTION sa_apps, read off the registry 2026-09-11. Both
       earlier fixtures were assembled from what the shape table already knew,
       and both reported full coverage while the LIVE launcher showed letters:
       the registry's real names are SynergyExpense, SynergySites,
       SynergyReferrals, SynergyLearn, SynergyTime and SynergyShifts, and none
       of them were in any fixture. Five more pairs were quietly sharing a
       glyph. Refresh this from the registry, never from the table:
         docker exec saauth-db psql -U postgres -d synergyauth \\
           -tAc "SELECT slug||'|'||name FROM sa_apps ORDER BY slug;" */
    ['statuspage', 'SynergyStatus'], ['expense', 'SynergyExpense'],
    ['budget', 'SynergyBudget'], ['billing', 'SynergyBilling'],
    ['invoice', 'SynergyInvoice'], ['bills', 'SynergyBills'],
    ['clm', 'SynergyCLM'], ['livechat', 'SynergyLiveChat'],
    ['book', 'SynergyBook'], ['portal', 'SynergyPortal'],
    ['insights', 'SynergyInsights'], ['sites', 'SynergySites'],
    ['referrals', 'SynergyReferrals'], ['learn', 'SynergyLearn'],
    ['cal', 'SynergyCal'], ['docs', 'SynergyDocs'], ['notes', 'SynergyNotes'],
    ['desk', 'SynergyDesk'], ['time', 'SynergyTime'],
    ['shifts', 'SynergyShifts'], ['stock', 'SynergyStock'],
    ['synapse', 'Synapse'], ['hire', 'SynergyHire'],
  ];
  check('the fleet fixture covers the whole registry', FLEET.length >= 55,
    `${FLEET.length} apps — a short list is the table marking its own homework`);
  const unresolved = FLEET.filter(([sl, nm]) => !shapeFor(sl, nm)).map(([, nm]) => nm);
  check('every app in the fleet resolves to a drawn mark', unresolved.length === 0,
    `falls through to a bare letter: ${unresolved.join(', ')}`);

  /* Resolving is not enough — two apps resolving to the SAME mark is the other
     half of "not a product family". Checking that the shape TABLE has no
     duplicate drawings missed this entirely: the drawings are distinct, it is
     the mapping that collides. */
  {
    const byShape = {};
    for (const [sl, nm] of FLEET) {
      const sh = shapeFor(sl, nm);
      if (!sh) continue;
      (byShape[sh] = byShape[sh] || []).push(nm);
    }
    const shared = Object.entries(byShape).filter(([, v]) => v.length > 1)
      .map(([sh, v]) => `${sh}: ${v.join(' + ')}`);
    check('no two apps in the fleet share a mark', shared.length === 0, shared.join(' | '));
  }

  /* And again from the NAME alone. sa_apps.slug is operator-entered, so a new
     app can easily arrive as `synergy-drive` or `drive-app` and miss the table
     entirely — then the name is the only thing left to match on. Testing only
     the slug+name pair hid this: the slug rescued every case, so breaking the
     camel-case split changed nothing and the check stayed green. */
  const nameOnly = FLEET.filter(([, nm]) => !shapeFor('', nm)).map(([, nm]) => nm);
  check('every app resolves from its NAME alone (unmapped slug)', nameOnly.length === 0,
    `no shape without a slug hit: ${nameOnly.join(', ')}`);

  /* The anchors exist to stop false matches; keep proving they still do. */
  /* Two entries was not a fixture, it was a coincidence: both happened to hit
     the only patterns whose anchors were attached to anything. In a regex,
     alternation binds looser than concatenation, so `\b(a|b|c)\b` written as
     `\ba|b|c\b` anchors ONLY the first and last branch — every middle
     alternative is a bare substring match. These are the real names that broke. */
  const FALSE_FRIENDS = [
    /* "Platform Tools", not "Platform Status": this entry exists to prove
       `form` does not match inside "Platform", and `status` is now a legitimate
       mapping of its own, so the old name tested two things and failed the
       wrong one. */
    ['platform', 'Platform Overview'], ['design', 'Design System'],
    ['profiles', 'User Profiles'],      // `files?` inside "Profiles"
    ['recall', 'Recall Tracker'],       // `call` inside "Recall"
    ['desktop', 'Desktop Agent'],       // `desk` inside "Desktop"
    ['sitemap', 'Sitemap Tool'],        // `site` inside "Sitemap"
    ['paralegal', 'Paralegal Desk2'],   // `legal` inside "Paralegal"
    ['medicare', 'Medicare Lookup'],    // `care` inside "Medicare"
    ['newsletter', 'Newsletter Tool'],  // `news` inside "Newsletter"
    ['association', 'Association List'], // `sso` inside "Association"
  ];
  const wrong = FALSE_FRIENDS
    .map(([sl, nm]) => [nm, shapeFor(sl, nm)])
    .filter(([, sh]) => sh)
    .map(([nm, sh]) => `${nm} -> ${sh}`);
  check('word matching does not fire on substrings', wrong.length === 0, wrong.join(', '));

  /* The monogram is a plate, and the letter on it is TEXT, so it owes 4.5:1. */
  const monoRule = ruleBody(css, '.sh-appicon-mono {');
  check('monogram renders on a filled plate', /background:\s*var\(--ic-deep\)/.test(monoRule),
    'the plate must be the saturated tone — a pale plate on a pale panel is 1.2:1, i.e. no plate');
  for (const [label, fill, deep, pale] of [
    ['light', '--ic-fill-l', '--ic-deep-l', '--ic-pale-l'],
    ['dark', '--ic-fill-d', '--ic-deep-d', '--ic-pale-d'],
  ]) {
    let worst = Infinity, worstHue = '';
    for (const seed of BRANDS) {
      const t = iconTones(seed);
      const c = contrast(t[deep], t[pale]);
      if (c < worst) { worst = c; worstHue = seed; }
    }
    check(`${label}: monogram letter on its plate >= 4.5:1`, worst >= 4.5,
      `worst seed ${worstHue} = ${worst.toFixed(2)}:1`);
  }
}

// ------------------------------------------------- 9. cross-surface contract
/* The launcher exists twice: in-page on the Hub, and inside an iframe driven by
   waffle.js on every other app. Round after round a fix landed on one side and
   not the other, which is invisible until you open the half nobody tests. These
   checks make the drift fail the build instead. */
{
  const host = read('public/waffle.js');
  const frame = read('app/waffle/WaffleFrame.tsx');
  const wafflePage = read('app/waffle/page.tsx');
  const hubPage = read('app/hub/page.tsx');

  /* Read the real send and receive sites. A first attempt matched every
     'synergy-waffle-*' string literal and reported the CSS class names
     (synergy-waffle-btn, synergy-waffle-style) as unhandled messages. */
  const collect = (src, patterns) => {
    const out = new Set();
    for (const p of patterns) for (const m of src.matchAll(p)) out.add(m[1]);
    return out;
  };
  const SENT = [/post(?:Message)?\(\s*'(synergy-waffle-[a-z-]+)'/g, /\bt:\s*'(synergy-waffle-[a-z-]+)'/g];
  const HANDLED = [/e\.data(?:\.t)?\s*[!=]==\s*'(synergy-waffle-[a-z-]+)'/g];
  const hostSent = collect(host, SENT), hostHandled = collect(host, HANDLED);
  const frameSent = collect(frame, SENT), frameHandled = collect(frame, HANDLED);

  /* A message one side sends and the other never handles is a dead handshake —
     exactly how the first-open focus bug and the height bug both presented. */
  const deadFrame = [...frameSent].filter((m) => !hostHandled.has(m));
  const deadHost = [...hostSent].filter((m) => !frameHandled.has(m));
  check('every message the frame SENDS is handled by waffle.js', deadFrame.length === 0, deadFrame.join(', '));
  check('every message waffle.js SENDS is handled by the frame', deadHost.length === 0, deadHost.join(', '));
  check('the handshake is not empty',
    frameSent.size >= 3 && hostSent.size >= 1 && hostHandled.size >= 3,
    `frame sends ${frameSent.size}, host sends ${hostSent.size}, host handles ${hostHandled.size}`);

  /* The frame must refuse to act on messages from an origin it could not
     validate, rather than falling back to '*'. */
  check('frame validates the host origin against the suite domain',
    /synergytech\\.cloud/.test(frame) && /ALLOWED\.test\(o\)/.test(frame),
    'no origin allowlist found');
  check('frame fails closed when the origin is unknown',
    /target === '\*'/.test(frame), "no guard on target === '*'");

  // Geometry and motion, read from both implementations and compared.
  const hubWaffle = ruleBody(css, '.sh-waffle {');
  const hubWidth = /width:\s*(\d+)px/.exec(hubWaffle);
  /* Anchored to the panel's own cssText — an unanchored width matched the
     40px button and then the 36px skeleton plate. */
  const hostWidth = /z-index:2147483647;width:(\d+)px/.exec(host);
  check('panel width matches across surfaces',
    !!hubWidth && !!hostWidth && hubWidth[1] === hostWidth[1],
    `hub=${hubWidth && hubWidth[1]} waffle.js=${hostWidth && hostWidth[1]}`);

  const tokens = declsIn(ruleBody(css, ':root {'));
  const easeOf = (t) => (tokens[t] || '').replace(/\s+/g, '');
  const durOf = (t) => (tokens[t] || '').trim();
  const inTransition = /transition = 'opacity (\d+ms) ([^,]+),/.exec(host);
  const outTransition = /transition = 'opacity (\d+ms) ([^,]+),/g;
  const transitions = [...host.matchAll(/transition = 'opacity (\d+ms) (cubic-bezier\([^)]*\))/g)]
    .map((m) => [m[1], m[2].replace(/\s+/g, '')]);
  check('waffle.js declares both an entrance and an exit', transitions.length === 2,
    `found ${transitions.length}`);
  if (transitions.length === 2) {
    const [ent, ex] = transitions;
    check('entrance duration matches --sh-dur-med', ent[0] === durOf('--sh-dur-med'),
      `waffle.js=${ent[0]} token=${durOf('--sh-dur-med')}`);
    check('entrance easing matches --sh-ease-decel', ent[1] === easeOf('--sh-ease-decel'),
      `waffle.js=${ent[1]} token=${easeOf('--sh-ease-decel')}`);
    check('exit duration matches --sh-dur-short', ex[0] === durOf('--sh-dur-short'),
      `waffle.js=${ex[0]} token=${durOf('--sh-dur-short')}`);
    check('exit easing matches --sh-ease-accel', ex[1] === easeOf('--sh-ease-accel'),
      `waffle.js=${ex[1]} token=${easeOf('--sh-ease-accel')}`);
  }

  /* sh-pop-in displaces as well as scales. waffle.js scaled only, so the same
     panel arrived differently depending on which surface opened it. */
  const popIn = /@keyframes sh-pop-in\s*\{[^}]*transform:\s*scale\(([\d.]+)\)\s*translateY\((-?[\d.]+px)\)/.exec(css);
  check('hub entrance keyframe scales AND displaces', !!popIn, 'sh-pop-in not in the expected shape');
  if (popIn) {
    const hostFrom = new RegExp("transform = 'scale\\(" + popIn[1].replace('.', '\\.') +
      "\\) translateY\\(" + popIn[2].replace('.', '\\.') + "\\)'").test(host);
    check('waffle.js entrance starts from the same transform as sh-pop-in', hostFrom,
      `expected scale(${popIn[1]}) translateY(${popIn[2]})`);
  }

  /* font-display: swap with no preload paints Arial and then reflows every
     label. Both surfaces render the same tiles, so both need it. */
  const PRE = /rel="preload"[^>]*roboto-var\.woff2/;
  check('Hub page preloads the font', PRE.test(hubPage), 'no preload link');
  check('waffle page preloads the font', PRE.test(wafflePage), 'no preload link');
  /* The signed-out branch is a separate return, and it shipped without one. */
  check('waffle page preloads the font in BOTH branches',
    (wafflePage.match(new RegExp(PRE.source, 'g')) || []).length >= 2,
    'only one branch has the preload');

  /* Both panels claim the same accessible name; a user who learns one should
     not meet a different label on the other. */
  check('both surfaces name the launcher identically',
    /Synergy apps/.test(host) && /Synergy apps/.test(wafflePage),
    'the launcher is labelled differently on the two surfaces');
}

// ----------------------------------------------- 10. the design constants
/* Every check before this one is about COLOUR. An independent review pointed
   out that the suite stayed green through a 140px top bar, 11px body text, a
   3000ms panel animation, a deleted .sh-waffle rule, 900px grid columns and
   disabled state layers — eight visible breakages, zero detections. The values
   below are the anchor's, so they are worth asserting directly. */
{
  const decl = (selector, prop) => {
    const body = ruleBody(noComments, selector);
    const m = new RegExp(prop + ':\\s*([^;]+)').exec(body);
    return m ? m[1].trim() : null;
  };
  const tok = (name) => (light[name] || '').trim();

  const CONSTANTS = [
    // Google's bar is 64px, dropping to 56px in the compact window class.
    ['top bar height', () => decl('.sh-topbar {', 'height'), '64px'],
    // body-medium: 14px/20px. Roboto's default leading is ~1.17, which sets the
    // whole UI ~18% tighter than the anchor, so the leading must be explicit.
    ['body font size', () => decl('.sh-root {', 'font-size'), '14px'],
    ['body line height', () => decl('.sh-root {', 'line-height'), '20px'],
    // The launcher panel: 320px on an 8px radius, hung 8px under its trigger.
    ['waffle panel width', () => decl('.sh-waffle {', 'width'), '320px'],
    /* min(300px, …) not a flat 300px: min-width beats max-width in CSS, so a
       flat minimum holds the panel wider than the viewport and pushes it
       off-screen on a narrow device. The minimum has to be able to yield. */
    ['menu panel min width', () => decl('.sh-menu {', 'min-width'), 'min(300px, calc(100vw - 16px))'],
    // M3 motion tokens. A panel that takes 3s to arrive is a different product.
    ['short duration', () => tok('--sh-dur-short'), '100ms'],
    ['medium duration', () => tok('--sh-dur-med'), '150ms'],
    ['long duration', () => tok('--sh-dur-long'), '200ms'],
    // M3 state layers: 8% hover, 12% press. Zeroing them removes all feedback.
    ['hover state layer', () => tok('--sh-state-hover'), '.08'],
    ['press state layer', () => tok('--sh-state-press'), '.12'],
    // The focus ring is 2px offset by 2px; a 0px ring is an invisible one.
    ['focus ring width', () => decl('.sh-root :where(a, button, input, [tabindex]):focus-visible', 'outline'), '2px solid var(--sh-primary)'],
  ];
  for (const [label, get, want] of CONSTANTS) {
    const got = get();
    check(`${label} is ${want}`, got === want, `found ${got === null ? '(rule or property missing)' : got}`);
  }

  /* Durations must be milliseconds in a plausible range whatever the value —
     the exact-match checks above would be defeated by a token renamed rather
     than retuned. */
  for (const t of ['--sh-dur-short', '--sh-dur-med', '--sh-dur-long']) {
    const ms = parseFloat(tok(t));
    check(`${t} is a sane UI duration`, ms > 0 && ms <= 400, `${tok(t) || '(missing)'}`);
  }

  // The compact window class drops the bar to 56px; the panels follow it.
  const compact = ruleBody(noComments, '@media (max-width: 600px)');
  check('compact window class shrinks the bar to 56px',
    /\.sh-topbar\s*\{[^}]*height:\s*56px/.test(compact), 'no 56px bar under 600px');

  // The tile grid stays a dense icon grid, not a card dashboard.
  const gridCols = decl('.sh-grid {', 'grid-template-columns');
  const min = gridCols && /minmax\((\d+)px/.exec(gridCols);
  check('app grid uses dense auto-fill columns', !!min && +min[1] >= 88 && +min[1] <= 140,
    `grid-template-columns: ${gridCols}`);

  /* Material defines exactly two type roles at 14px — body-medium (0.25px of
     tracking) and label-large (0.1px). Five different values were in use, three
     of them invented, which is the kind of drift nobody sees in one rule and
     everybody feels across a screen. */
  {
    const M3_14PX = ['.0178571em', '.0071428em'];
    const odd = [];
    for (const m of noComments.matchAll(/font-size:\s*14px[^;}]*;[^}]*?letter-spacing:\s*([^;]+);/g)) {
      if (!M3_14PX.includes(m[1].trim())) odd.push(m[1].trim());
    }
    for (const m of noComments.matchAll(/letter-spacing:\s*([^;]+);[^}]*?font-size:\s*14px/g)) {
      if (!M3_14PX.includes(m[1].trim())) odd.push(m[1].trim());
    }
    check('14px type uses only Material tracking values', odd.length === 0,
      `found ${[...new Set(odd)].join(', ')} — Material has 0.25px (body) and 0.1px (label)`);
  }

  // The skip link has to actually arrive on screen when focused.
  const skipFocus = ruleBody(noComments, '.sh-skip:focus-visible');
  const top = /top:\s*(-?\d+)px/.exec(skipFocus || '');
  check('skip link becomes visible on focus', !!top && +top[1] >= 0,
    `.sh-skip:focus-visible top is ${top ? top[1] + 'px' : '(unset)'}`);
}

// ------------------------------------------------------------ 11. structure
{
  const hub = read('app/hub/HubClient.tsx');
  const host = read('public/waffle.js');
  const frame = read('app/waffle/WaffleFrame.tsx');
  const wpage = read('app/waffle/page.tsx');
  const compactBlock = ruleBody(noComments, '@media (max-width: 600px)');

  const has = (label, ok, detail) => check(label, !!ok, detail);

  // --- the bar ------------------------------------------------------------
  has('top bar is sticky', /position:\s*sticky/.test(ruleBody(noComments, '.sh-topbar {')),
    'a launcher bar that scrolls away is not the Workspace bar');
  has('scroll hairline rule survives', /\[data-scrolled='true'\][^{]*\{[^}]*box-shadow/.test(noComments),
    'the bar never separates from the content it covers');
  has('compact breakpoint hides the wide search field',
    /\.sh-search\s*\{[^}]*display:\s*none/.test(compactBlock),
    'four actions plus the brand leave the field unusable below 600px');
  has('compact breakpoint reveals the search toggle',
    /\.sh-search-toggle\s*\{[^}]*display:\s*inline-flex/.test(compactBlock),
    'the field is hidden with nothing to open it');

  // --- the panels ---------------------------------------------------------
  for (const sel of ['.sh-menu {', '.sh-waffle {']) {
    const body = ruleBody(noComments, sel);
    const radius = /border-radius:\s*([^;]+)/.exec(body);
    has(`${sel.trim()} keeps a rounded corner`,
      radius && !/^0(px)?$/.test(radius[1].trim()),
      `border-radius is ${radius ? radius[1].trim() : '(unset)'} — Workspace popovers are never square`);
    has(`${sel.trim()} keeps its elevation`, /box-shadow:\s*var\(--sh-elev/.test(body),
      'a popover with no shadow does not read as floating above the page');
  }

  // --- state layers and focus --------------------------------------------
  has('state layer rules exist', /::before\s*\{[^}]*background:\s*currentColor/.test(noComments),
    'hover and press feedback is gone from every button and tile');
  has('hover state layer is applied', /:hover::before\s*\{[^}]*opacity:\s*var\(--sh-state-hover\)/.test(noComments),
    'the token is declared but nothing uses it');
  has('press state layer is applied', /:active::before\s*\{[^}]*opacity:\s*var\(--sh-state-press\)/.test(noComments),
    'the token is declared but nothing uses it');
  {
    const ring = ruleBody(noComments, '.sh-root :where(a, button, input, [tabindex]):focus-visible');
    const off = /outline-offset:\s*(-?[\d.]+)px/.exec(ring);
    has('focus ring is drawn outside the control', off && parseFloat(off[1]) >= 0,
      `outline-offset is ${off ? off[1] + 'px' : '(unset)'} — a negative offset hides the ring inside a filled control`);
  }

  // --- type and grid ------------------------------------------------------
  {
    const label = ruleBody(noComments, '.sh-tile-name {');
    const size = /font-size:\s*(\d+)px/.exec(label);
    has('tile labels stay readable', size && +size[1] >= 12,
      `.sh-tile-name is ${size ? size[1] + 'px' : '(unset)'}`);
    /* The selector has to be found, or the check passes on an empty string —
       which is exactly what happened: this read `.sh-section-title`, a class
       that does not exist, so "headers are not shouted" was vacuously true and
       an uppercase sabotage sailed through. */
    const head = ruleBody(noComments, '.sh-cat h2 {');
    has('section header rule is found', head.length > 0, '.sh-cat h2 not in hub.css');
    has('section headers are not shouted',
      head.length > 0 && !/text-transform:\s*uppercase/.test(head),
      'Workspace sets no UI section header in uppercase');
    const weight = /font-weight:\s*(\d+)/.exec(head);
    has('section header weight is in Google\'s set', weight && ['400', '500'].includes(weight[1]),
      `font-weight is ${weight ? weight[1] : '(unset)'} — 600 is not in the Workspace weight set`);
  }
  {
    const grid = ruleBody(noComments, '.sh-grid {');
    /* `gap: 0` is deliberate — .sh-tile carries its own padding, so the rhythm
       comes from the tile rather than the grid. Requiring a px unit made the
       check read "(unset)" and fail on a perfectly good value. */
    const gap = /gap:\s*([\d.]+)(px)?/.exec(grid);
    has('app grid gap is a grid gap, not a gutter', gap && +gap[1] <= 24,
      `gap is ${gap ? gap[1] + 'px' : '(unset)'}`);
    const wgrid = ruleBody(noComments, '.shw-grid {');
    has('waffle grid is three columns', /repeat\(3,/.test(wgrid),
      `grid-template-columns is ${wgrid.trim().slice(0, 60)} — Google's launcher is 3 across`);
  }

  // --- the marks ----------------------------------------------------------
  {
    const icon = read('app/AppIcon.tsx');
    has('marks are drawn in the tone tokens',
      /var\(--ic-fill\)/.test(icon) && /var\(--ic-deep\)/.test(icon),
      'a hardcoded colour here makes every product mark the same');
    /* Distinct shapes: a launcher where two apps render the same glyph is not a
       family. Count the shapes the switch actually draws. */
    const shapes = new Set([...icon.matchAll(/case '(\w+)':/g)].map((m) => m[1]));
    has('there are many distinct marks', shapes.size >= 12, `${shapes.size} shapes defined`);
    const drawn = [...icon.matchAll(/case '(\w+)':([\s\S]*?)(?=\n\s+case '|\n\s+default:)/g)]
      .map((m) => [m[1], m[2].replace(/\s+/g, '')]);
    const bodies = new Map();
    const dupes = [];
    for (const [name, body] of drawn) {
      if (bodies.has(body)) dupes.push(`${name} == ${bodies.get(body)}`);
      else bodies.set(body, name);
    }
    has('no two marks are the same drawing', dupes.length === 0, dupes.join(', '));
  }

  // --- keyboard and assistive technology ----------------------------------
  has('skip link is rendered', /className="sh-skip"/.test(hub) && /\.sh-skip\s*\{/.test(noComments),
    'the first focusable element on a Google surface is a skip link');
  has('launcher trigger announces its state', /aria-expanded=\{/.test(hub),
    'a popover trigger with no state is silent to a screen reader');
  /* aria-haspopup="true" is DEFINED as equivalent to "menu", so it announced
     "menu pop-up button" over a role="group" with no menu items. There is no
     haspopup value for a group, and aria-expanded already carries the state,
     so the honest thing is to promise nothing rather than the wrong thing.
     This file rejects role="dialog" for the same reason. */
  /* Comment-stripped, and both spellings — the JSX attribute AND
     setAttribute('aria-haspopup','true'). Matching only `haspopup="true"` left
     waffle.js's setAttribute form invisible; then reading the raw source made
     the COMMENT explaining the removal trip the check. */
  const stripped = (x) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const [label, src] of [['Hub', stripped(hub)], ['waffle.js', stripped(host)]]) {
    has(`${label} does not promise a menu it has no menu for`,
      !/aria-haspopup['"]?\s*[,:=]\s*['"]?(true|menu)/.test(src),
      'aria-haspopup="true" means "menu"; these popovers are role="group"');
  }
  has('tiles carry accessible names', /aria-label=\{/.test(hub),
    'an icon tile with no name is an unlabelled link');
  has('roving tabindex is implemented', /tabIndex=\{/.test(hub),
    'without it Tab walks every tile in the grid one at a time');
  has('arrow-key grid navigation is implemented',
    /Arrow(Up|Down|Left|Right)/.test(hub), 'the grid is not navigable by arrows');
  has('the iframe grid is navigable too', /Arrow(Up|Down|Left|Right)/.test(frame),
    'the injected copy behaves differently from the Hub');
  has('decorative marks are hidden from AT', /aria-hidden/.test(read('app/AppIcon.tsx')),
    'the mark is read out as well as the label');
  has('waffle page tiles carry accessible names', /aria-label=\{/.test(wpage),
    'the injected grid has unlabelled links');

  // --- the injected copy --------------------------------------------------
  {
    /* Anchored to the BUTTON's own cssText. Unanchored, this matched the
       skeleton's 96x12 placeholder bar and reported the button as 96x12. */
    const size = /justify-content:center;width:(\d+)px;height:(\d+)px/.exec(host);
    has('injected button keeps a 40px target', size && +size[1] === 40 && +size[2] === 40,
      `injected button is ${size ? size[1] + 'x' + size[2] : '(unreadable)'}`);
    const hostRadius = /t\.surface \+ ';border-radius:(\d+)px/.exec(host);
    const hubRadius = /--sh-r-sm:\s*(\d+)px/.exec(noComments);
    has('injected panel radius matches the Hub',
      hostRadius && hubRadius && hostRadius[1] === hubRadius[1],
      `waffle.js=${hostRadius && hostRadius[1]} hub --sh-r-sm=${hubRadius && hubRadius[1]}`);
    has('injected button still declares its popup state',
      /aria-haspopup/.test(host) && /aria-expanded/.test(host),
      'the injected trigger is silent to a screen reader');
  }
}

// -------------------------------------------- 12. checks that generalise
{
  const hub = read('app/hub/HubClient.tsx');
  const host = read('public/waffle.js');
  const frame = read('app/waffle/WaffleFrame.tsx');
  const wpage = read('app/waffle/page.tsx');
  const icon = read('app/AppIcon.tsx');
  const has = (label, ok, detail) => check(label, !!ok, detail);

  /* --- the dark page must use the dark tone set --------------------------
     Not "the tokens exist" — that the CASCADE selects them. Swapping the
     selector bodies so a dark page kept the LIGHT icon tones was invisible to
     every check, and it is the single most visible theming failure there is. */
  {
    const darkIcon = ruleBody(noComments, ":root:not([data-sh-theme='light']) .sh-appicon");
    const forcedIcon = ruleBody(noComments, ":root[data-sh-theme='dark'] .sh-appicon");
    for (const [label, body] of [['system-dark', darkIcon], ['forced-dark', forcedIcon]]) {
      has(`${label} selects the dark icon tones`,
        /--ic-fill:\s*var\(--ic-fill-d\)/.test(body)
        && /--ic-deep:\s*var\(--ic-deep-d\)/.test(body)
        && /--ic-pale:\s*var\(--ic-pale-d\)/.test(body),
        'a dark page would paint the light tone set');
    }
    const base = ruleBody(noComments, '.sh-appicon {');
    has('the default icon tones are the LIGHT set',
      /--ic-fill:\s*var\(--ic-fill-l\)/.test(base), 'the base rule does not seed the light tones');
  }

  /* --- radii, elevation and sizes must stay in range --------------------- */
  {
    const tok = (n) => (light[n] || '').trim();
    for (const [t, min] of [['--sh-r-sm', 4], ['--sh-r-md', 8], ['--sh-r-lg', 12]]) {
      const v = parseFloat(tok(t));
      has(`${t} is a real corner radius`, v >= min, `${tok(t) || '(missing)'}`);
    }
    has('--sh-r-full is a pill', parseFloat(tok('--sh-r-full')) >= 999, tok('--sh-r-full'));
    for (const t of ['--sh-elev-1', '--sh-elev-2', '--sh-elev-3']) {
      has(`${t} actually casts a shadow`, /\d+px/.test(tok(t)) && !/^none$/.test(tok(t)), tok(t));
    }
  }

  /* --- every declared font-size is in a plausible UI range --------------- */
  {
    const odd = [];
    for (const m of noComments.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
      const px = parseFloat(m[1]);
      if (px < 11 || px > 40) odd.push(px + 'px');
    }
    has('no font-size is outside 11-40px', odd.length === 0,
      `${[...new Set(odd)].join(', ')} — 16px is the iOS zoom-on-focus threshold for inputs`);
    const field = ruleBody(noComments, '.sh-search input');
    const fs2 = /font-size:\s*(\d+)px/.exec(field);
    has('the search field is >= 16px so iOS does not zoom on focus',
      !fs2 || +fs2[1] >= 16, `search input is ${fs2 ? fs2[1] + 'px' : 'unset'}`);
  }

  /* --- the icon plate must not clip its own art ------------------------- */
  {
    const plate = ruleBody(noComments, '.sh-appicon {');
    has('the icon plate does not clip the mark', !/overflow:\s*hidden/.test(plate),
      'border-radius + overflow:hidden clips the mark to an inscribed circle');
  }

  /* --- behaviour the launcher cannot be a launcher without ---------------
     Read the CODE, not the comments. /Escape/ matched the keyboard-model
     comment at the top of HubClient, so deleting every Escape handler left the
     check green — a behaviour check that a docstring can satisfy. */
  const code = (x) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const [label, src, needles] of [
    ['Hub', code(hub), [
      ['Escape closes an open panel', /=== 'Escape'/],
      ['an outside click closes a panel', /closest\?\.\(|closest\(/],
      ['panels are anchored to their trigger', /getBoundingClientRect/],
      ['the panel position survives a resize', /addEventListener\('resize'/],
      ['focus returns to the trigger on close', /\.focus\(\)/],
    ]],
    ['waffle.js', code(host), [
      ['Escape closes an open panel', /synergy-waffle-close/],
      ['an outside click closes a panel', /document\.addEventListener\('click'|onclick|'pointerdown'/],
      ['the panel is anchored to its button', /btn\.getBoundingClientRect/],
      ['the panel follows a scroll', /addEventListener\('scroll'/],
      ['the panel is re-placed on resize', /addEventListener\('resize'/],
    ]],
  ]) {
    for (const [what, re] of needles) has(`${label}: ${what}`, re.test(src), 'not found in source');
  }

  /* --- both copies clamp to the viewport -------------------------------- */
  for (const [label, src] of [['Hub', hub], ['waffle.js', host]]) {
    /* Name the clamp. `Math.min(` alone matched unrelated arithmetic elsewhere
       in the file, so removing the upper bound changed nothing here. */
    has(`${label} clamps the panel to the viewport at both ends`,
      /Math\.max\(8, vw - 8 - wide\)/.test(src) && /Math\.min\(/.test(src),
      'a one-sided clamp puts the panel off the left edge of a phone');
  }

  /* --- the iframe must stamp the theme before it paints ------------------ */
  has('the waffle frame stamps the theme on <html> pre-paint',
    /documentElement\.setAttribute\('data-sh-theme'/.test(wpage),
    'without this the frame paints light tones on a dark host for a frame');
  has('the waffle frame reports its height', /synergy-waffle-size/.test(frame),
    'the host would be left guessing the iframe height');

  /* --- marks must be drawn in tokens, at a size that can be seen --------- */
  {
    const sizes = [...icon.matchAll(/size\s*=\s*(\d+)/g)].map((m) => +m[1]);
    has('the default mark size is a launcher size', sizes.every((n) => n >= 24),
      `found ${sizes.join(', ')} — a 16px product mark is a favicon`);
    has('every mark uses the tone tokens and no literal',
      !/fill="#|stroke="#/.test(icon), 'a literal colour in a mark ignores the theme');
  }

  /* --- grid geometry stays a launcher grid ------------------------------ */
  {
    const wgrid = ruleBody(noComments, '.shw-grid {');
    has('the waffle grid is a grid', /display:\s*grid/.test(wgrid), wgrid.trim().slice(0, 50));
    const gap = /gap:\s*([\d.]+)(px)?/.exec(wgrid);
    has('the waffle grid gap is tight', gap && parseFloat(gap[1]) <= 12,
      `gap is ${gap ? gap[0] : '(unset)'}`);
  }
}

// ------------------------------------------ 13. things that break silently
/* Each of these was a sabotage an independent reviewer landed while 405 checks
   stayed green. They share a shape: nothing about them is a colour or a token,
   and each one leaves the UI looking exactly the same in a screenshot. */
{
  const hub = read('app/hub/HubClient.tsx');
  const host = read('public/waffle.js');
  const wpage = read('app/waffle/page.tsx');
  const mw = read('middleware.ts');
  const bare = (x) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const has = (label, ok, detail) => check(label, !!ok, detail);

  /* The iframe's links MUST escape the iframe. Without target="_top" every app
     opens INSIDE the 320px launcher panel — the app loads, in a letterbox. */
  {
    const tiles = (bare(wpage).match(/target="_top"/g) || []).length;
    has('every link in the waffle frame escapes the iframe', tiles >= 3,
      `only ${tiles} target="_top" in the frame — an app would open inside the panel`);
  }

  /* The launcher is framed on purpose and everything else is not. Flipping the
     exemption off kills the launcher fleet-wide and nothing looks different
     until you open one. */
  has('middleware still exempts /waffle from the frame ban',
    /pathname === '\/waffle'/.test(bare(mw)) && /frame-ancestors 'self'/.test(bare(mw)),
    'the launcher cannot be embedded at all, in every app at once');
  has('middleware keeps DENY everywhere else',
    /X-Frame-Options', 'DENY'/.test(bare(mw)), 'consent and login become framable');

  /* A search that filters silently is unusable without sight. */
  has('search results are announced', /aria-live=/.test(bare(hub)),
    'filtering with no live region is silent to a screen reader');

  /* Both panels can overflow their max-height; both need to scroll. */
  for (const sel of ['.sh-menu {', '.sh-waffle {']) {
    const body = ruleBody(noComments, sel);
    has(`${sel.trim()} can scroll when it overflows`, /overflow-y:\s*auto/.test(body),
      'a panel with a max-height and no overflow silently truncates its contents');
  }

  /* The same tile on two surfaces must be the same size. */
  {
    /* Split on the className, not the bare word: 'shw-tile' first appears
       inside a querySelectorAll and 'sh-actions' inside a closest() call, so
       splitting on either landed in the wrong half of the file. */
    const hubTile = /<AppIcon[^>]*size=\{(\d+)\}/.exec(bare(hub).split('className="shw-tile"')[1] || '');
    const framePane = /<AppIcon[^>]*size=\{(\d+)\}/.exec(bare(wpage));
    has('the waffle tile mark is the same size on both surfaces',
      hubTile && framePane && hubTile[1] === framePane[1],
      `Hub=${hubTile && hubTile[1]} frame=${framePane && framePane[1]}`);
  }

  /* The icon plate is a circle in Google's launcher, not a rounded square. */
  {
    const plate = ruleBody(noComments, '.sh-appicon {');
    has('the icon plate is fully rounded', /border-radius:\s*var\(--sh-r-full\)/.test(plate),
      'a squared plate reads as a favicon, not a product mark');
  }

  /* The Hub's exit timing must come from the token, not a literal — waffle.js's
     is machine-compared to --sh-dur-short and the Hub's was free to drift. */
  has('the Hub reads its exit duration from the motion token',
    /--sh-dur-short/.test(bare(hub)),
    'a hand-typed delay drifts the moment the token is retuned');

  /* Focus leaving the DOCUMENT is not the user dismissing a panel. */
  for (const [label, src] of [['Hub', bare(hub)], ['waffle.js', bare(host)]]) {
    has(`${label} does not close the panel on a tab-switch`,
      /if \(!next\) return;/.test(src),
      'alt-tab away and the launcher closes itself, losing focus with it');
  }

  /* An empty launcher must say why it is empty, on BOTH surfaces. */
  for (const [label, src] of [['Hub', bare(hub)], ['waffle frame', bare(wpage)]]) {
    has(`${label} has an empty state`, /shw-empty/.test(src),
      'a newly provisioned user gets a box with a header and nothing in it');
  }

  /* Icon buttons need a visible label on hover, not just an accessible one. */
  {
    /* Bounded to the cluster. Taking everything AFTER the className swept in
       the panels and the tile grid below it, whose tiles carry their own
       title=, so the count stayed above the threshold with every bar tooltip
       deleted. */
    const bar = (bare(hub).split('className="sh-actions"')[1] || '').split('</header>')[0];
    const titles = (bar.match(/title=/g) || []).length;
    has('bar icon buttons carry a tooltip', titles >= 3,
      `${titles} tooltips in the action cluster — Workspace labels every one`);
  }
}

// ---------------------------------------------------------------- report
console.log(`\nTheme audit: ${pass}/${pass + fail} checks passed\n`);
for (const n of notes) console.log('  note  ' + n);
if (notes.length) console.log('');
if (problems.length) {
  for (const p of problems) console.log('  FAIL  ' + p);
  console.log('');
  process.exit(1);
}
console.log('All theme checks passed.\n');

// ---------------------------------------------------------------- self-test
/* Each sabotage breaks the product in a way a user would feel. The suite is
   required to notice — otherwise a green run means nothing. */
if (process.argv.includes('--selftest')) {
  /* Each sabotage names the file it breaks: the contract checks span four
     files, and a self-test that can only edit hub.css cannot exercise them. */
  const originals = new Map();
  const load = (rel) => {
    if (!originals.has(rel)) originals.set(rel, readFileSync(join(ROOT, rel), 'utf8'));
    return originals.get(rel);
  };
  /* Mutate the WINNING declaration, inside one rule only. Inserting a token at
     the top of a block is not a sabotage: the real declaration further down
     wins the cascade, and the audit models that faithfully, so the product is
     not actually broken and a pass is correct. Two sabotages were written that
     way and scored the suite as blind when it was not. */
  const inRule = (src, anchor, fn) => {
    const i = src.indexOf(anchor);
    if (i < 0) return src;
    let depth = 0;
    for (let j = src.indexOf('{', i); j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0)
        return src.slice(0, i) + fn(src.slice(i, j + 1)) + src.slice(j + 1);
    }
    return src;
  };
  const CSS = 'app/hub.css', HOST = 'public/waffle.js', ICON = 'app/AppIcon.tsx';
  const SUITE = 'public/synergy-theme.css', LAYOUT = 'app/layout.tsx';
  const HUB = 'app/hub/HubClient.tsx', MW = 'middleware.ts';
  const FRAME = 'app/waffle/WaffleFrame.tsx', WPAGE = 'app/waffle/page.tsx';
  const SABOTAGES = [
    [CSS, 'delete the whole system-dark palette',
      (s) => inRule(s, '@media (prefers-color-scheme: dark)', () => '')],
    [CSS, 'body text 1.09:1 for system-dark users',
      (s) => inRule(s, '@media (prefers-color-scheme: dark)',
        (b) => b.replace(/--sh-on:\s*#[0-9a-f]{3,8}/i, '--sh-on: #1f1f1f'))],
    [CSS, 'hardcoded hex literal in a live rule',
      (s) => s.replace('.sh-appicon-mono {', '.sh-appicon-mono { background: #ff0000;')],
    [CSS, 'non-hex literal in a live rule',
      (s) => s.replace('.sh-empty {', '.sh-empty { color: rgb(255, 0, 0);')],
    [CSS, 'the two dark palettes drift apart',
      (s) => inRule(s, ":root[data-sh-theme='dark'] {",
        (b) => b.replace(/--sh-bg:\s*#[0-9a-f]{3,8}/i, '--sh-bg: #010203'))],

    /* The cross-surface contract. Each of these is a real failure mode this
       build has actually shipped at least once. */
    [FRAME, 'the frame renames a message the host still listens for',
      (s) => s.replace("post('synergy-waffle-ready')", "post('synergy-waffle-loaded')")],
    [HOST, 'the host renames the focus message the frame listens for',
      (s) => s.replace("'synergy-waffle-focus'", "'synergy-waffle-takefocus'")],
    [HOST, 'the injected panel drifts off the Hub panel width',
      (s) => s.replace('z-index:2147483647;width:320px', 'z-index:2147483647;width:300px')],
    [HOST, 'the injected panel animates on a different curve',
      (s) => s.replace('cubic-bezier(.05,.7,.1,1)', 'cubic-bezier(.2,0,0,1)')],
    [WPAGE, 'the waffle page loses its font preload in one branch',
      (s) => s.replace(/<link rel="preload"[^>]*roboto-var\.woff2[^>]*\/>/, '')],
    [FRAME, 'the frame stops validating the host origin',
      (s) => s.replace('ALLOWED.test(o)', 'true')],

    /* The icon family. Both of these shipped: the whole fleet fell through to
       bare letters, and the letter had no plate under it. */
    [ICON, 'camel-case names stop resolving to a mark',
      (s) => s.replace("replace(/([a-z0-9])([A-Z])/g, '$1 $2')", "replace(/([a-z0-9])([QXZ])/g, '$1 $2')")],
    [ICON, 'a fleet app loses its shape mapping',
      /* Both routes to the shape have to go, or the word table still rescues
         it and the sabotage is a no-op that reports as a MISS. */
      (s) => s.replace("drive: 'folder', files: 'folder', storage: 'folder',", '')
              .replace("  [/\\b(?:drive|files?|storage)\\b/i, 'folder'],\n", '')],
    [CSS, 'the monogram goes back to a bare letter',
      (s) => s.replace('.sh-appicon-mono { background: var(--ic-deep);',
                       '.sh-appicon-mono { background: transparent;')],

    /* Holes an independent reviewer drove straight through. Each of these
       passed the suite before the checks above were written. */
    [SUITE, "the suite's OS-dark palette breaks",
      (s) => inRule(s, '@media (prefers-color-scheme: dark)',
        (b) => b.replace(/--sy-link:\s*#[0-9a-f]{3,8}/i, '--sy-link: #1a1a2e'))],
    [SUITE, "the suite's OS-dark palette is deleted outright",
      (s) => inRule(s, '@media (prefers-color-scheme: dark)', () => '')],
    [SUITE, 'a hardcoded colour lands in a live suite rule',
      (s) => s.replace('.sy-card {', '.sy-card { background: #ff0000;')],
    [LAYOUT, 'a colour literal lands in the root layout',
      (s) => s.replace('<html lang="en"', '<html style={{ background: "#ff0000" }} lang="en"')],
    [CSS, 'the reduced-motion guard is deleted but still described in a comment',
      (s) => s.replace(/@media \(prefers-reduced-motion: reduce\) \{/, '@media (min-width: 1px) {')],
    [CSS, 'the forced-colors block is deleted but still described in a comment',
      (s) => s.replace(/@media \(forced-colors: active\) \{/, '@media (min-width: 2px) {')],
    [SUITE, 'the suite sizes scrollbars in every host app again',
      (s) => s.replace('.sy-themed, .sy-themed * { scrollbar-width: thin; }', '* { scrollbar-width: thin; }')],
    [SUITE, 'the suite freezes every host app animation again',
      (s) => s.replace('.sy-themed, .sy-themed *, .sy-themed *::before, .sy-themed *::after {', '*, *::before, *::after {')],
    /* Eight visible breakages an independent review drove through the suite
       while it could only see colour. */
    [CSS, 'the top bar becomes 140px tall',
      (s) => s.replace('height: 64px; display: flex;', 'height: 140px; display: flex;')],
    [CSS, 'body text drops to 11px with no leading',
      (s) => s.replace('  font-size: 14px; line-height: 20px; letter-spacing: .0178571em;\n  -webkit-font-smoothing',
                       '  font-size: 11px; line-height: 11px;\n  -webkit-font-smoothing')],
    [CSS, 'panels take three seconds to arrive',
      (s) => s.replace('--sh-dur-med: 150ms;', '--sh-dur-med: 3000ms;')],
    [CSS, 'state layers are switched off',
      (s) => s.replace('--sh-state-hover: .08;', '--sh-state-hover: 0;')],
    [CSS, 'the app grid becomes a card dashboard',
      (s) => s.replace(/minmax\(\d+px/, 'minmax(900px')],
    [CSS, 'the skip link never comes on screen',
      (s) => s.replace('.sh-skip:focus-visible { top: 8px; }', '.sh-skip:focus-visible { top: -60px; }')],
    [CSS, 'the launcher panel loses its width',
      (s) => s.replace('top: 68px; width: 320px;', 'top: 68px; width: 900px;')],
    /* Twenty sabotages an independent reviewer landed while the suite caught
       ZERO of them. Every check before section 11 was about token values;
       none asked whether the rules using those tokens still existed. */
    [CSS, 'the whole launcher renders in Comic Sans',
      (s) => s.replace(/--sh-font:[^;]+;/, "--sh-font: 'Comic Sans MS', cursive;")],
    [SUITE, 'every themed app renders in Comic Sans',
      (s) => s.replace(/--sy-font:[^;]+;/, "--sy-font: 'Comic Sans MS', cursive;")],
    [CSS, 'hover and press feedback is deleted everywhere',
      (s) => s.replace(/\.sh-iconbtn:hover::before[^}]*\}/, '')
              .replace(/\.sh-iconbtn:active::before[^}]*\}/, '')],
    [CSS, 'section headers become uppercase',
      (s) => s.replace('.sh-cat h2 {', '.sh-cat h2 { text-transform: uppercase;')],
    [CSS, 'both popovers become square boxes',
      (s) => s.replace('border-radius: 28px; box-shadow: var(--sh-elev-3);', 'border-radius: 0; box-shadow: var(--sh-elev-3);')
              .replace('background: var(--sh-surface-elev); border-radius: var(--sh-r-sm);', 'background: var(--sh-surface-elev); border-radius: 0;')],
    [CSS, 'the top bar stops being sticky',
      (s) => s.replace('position: sticky; top: 0; z-index: 20;', 'position: static; z-index: 20;')],
    [CSS, 'the waffle grid goes to six columns',
      (s) => s.replace('grid-template-columns: repeat(3, 1fr)', 'grid-template-columns: repeat(6, 1fr)')],
    [CSS, 'all panel elevation is removed',
      (s) => s.replace(/box-shadow: var\(--sh-elev-3\);/g, '')],
    [CSS, 'the focus ring is drawn inside the control',
      (s) => s.replace('  outline-offset: 2px;', '  outline-offset: -6px;')],
    [CSS, 'tile labels drop to 9px',
      (s) => s.replace('.sh-tile-name {\n  font-size: 14px;', '.sh-tile-name {\n  font-size: 9px;')],
    [CSS, 'the app grid gap becomes a gutter',
      (s) => s.replace('minmax(112px, 1fr)); gap: 0;', 'minmax(112px, 1fr)); gap: 64px;')],
    [ICON, 'every product mark goes grey',
      (s) => s.replace("const fill = 'var(--ic-fill)';", "const fill = '#9e9e9e';")],
    [ICON, 'every app gets the same mark',
      (s) => s.replace(/case 'folder':[\s\S]*?<\/>\);/, "case 'folder':\n      return (<>\n        <path d=\"M13 8h11l7 7v17a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z\" fill={fill} />\n        <path d=\"M24 8l7 7h-7V8Z\" fill={deep} />\n        <path d=\"M15 22h14M15 27h14\" stroke={pale} strokeWidth=\"2.8\" strokeLinecap=\"round\" />\n      </>);")],
    [HUB, 'the skip link is deleted',
      (s) => s.replace(/className="sh-skip"/, 'className="sh-gone"')],
    [HUB, 'the launcher trigger stops announcing its popup state',
      (s) => s.replace(/aria-haspopup="dialog"/g, '').replace(/aria-expanded=\{/g, 'data-expanded={')],
    [HUB, 'the roving tabindex is removed',
      (s) => s.replace(/tabIndex=\{/g, 'data-tabindex={')],
    [HUB, 'arrow-key grid navigation is deleted',
      (s) => s.replace(/Arrow(Up|Down|Left|Right)/g, 'Nope$1')],
    [HOST, 'the injected button shrinks to a 22px target',
      (s) => s.replace('justify-content:center;width:40px;height:40px;', 'justify-content:center;width:22px;height:22px;')],
    [HOST, 'the injected panel becomes square, diverging from the Hub',
      (s) => s.replace("t.surface + ';border-radius:8px;", "t.surface + ';border-radius:0px;")],
    [CSS, 'the compact breakpoint stops hiding the search field',
      (s) => s.replace('  .sh-search { display: none; }', '  .sh-search { display: flex; }')],
    /* Categories a reviewer drove through while the suite asserted only the
       specific values it had been taught. */
    [CSS, 'a dark page keeps the LIGHT icon tones',
      (s) => s.replace(/--ic-fill: var\(--ic-fill-d\)/g, '--ic-fill: var(--ic-fill-l)')],
    [CSS, 'every pill becomes a square box',
      (s) => s.replace('--sh-r-full: 9999px;', '--sh-r-full: 0;')],
    [CSS, 'all elevation is removed from the tokens',
      (s) => s.replace(/--sh-elev-3: [^;]+;/, '--sh-elev-3: none;')],
    [CSS, 'the icon plate clips every mark to a circle again',
      (s) => s.replace('justify-content: center; line-height: 1; flex: none;',
                       'justify-content: center; line-height: 1; flex: none; overflow: hidden;')],
    [CSS, 'the search field drops to 11px and iOS zooms on focus',
      (s) => s.replace('  font-size: 16px; line-height: 24px; letter-spacing: .03125em;',
                       '  font-size: 11px; line-height: 24px; letter-spacing: .03125em;')],
    [CSS, 'the waffle grid stops being a grid',
      (s) => s.replace('.shw-grid { display: grid;', '.shw-grid { display: block;')],
    [ICON, 'every launcher mark renders at 16px',
      (s) => s.replace('size = 56', 'size = 16')],
    [ICON, 'a mark is drawn in a literal colour',
      (s) => s.replace('<circle cx="21" cy="21" r="13" fill={fill} />', '<circle cx="21" cy="21" r="13" fill="#888888" />')],
    [HUB, 'Escape no longer closes an open panel',
      (s) => s.replace(/'Escape'/g, "'Nope'").replace(/=== 'Escape'/g, "=== 'Nope'")],
    [HUB, 'the launcher panel loses its viewport clamp',
      (s) => s.replace(/const right = Math\.min\(\s*Math\.max\(8, vw - r\.right\),\s*Math\.max\(8, vw - 8 - wide\),\s*\);/,
                       'const right = Math.max(8, vw - r.right);')],
    [HOST, 'the injected panel stops following its button on scroll',
      (s) => s.replace("window.addEventListener('scroll', function () { if (open) position(); }, { passive: true, capture: true });", '')],
    [WPAGE, 'the waffle frame stops stamping the theme on <html>',
      (s) => s.replace("documentElement.setAttribute('data-sh-theme',t)", "documentElement.dataset.ignored=t")],
    /* An independent reviewer landed 20 of these and the suite caught 3.
       None of them changes a colour; all of them look identical in a
       screenshot. */
    [WPAGE, 'every app opens INSIDE the 320px launcher panel',
      (s) => s.split('target="_top"').join('')],
    [MW, 'the launcher can no longer be framed, fleet-wide',
      (s) => s.replace("const isWaffle = req.nextUrl.pathname === '/waffle';",
                       'const isWaffle = false;')],
    [HUB, 'search results stop being announced',
      (s) => s.replace('aria-live="polite"', 'data-live="polite"')],
    [CSS, 'the account menu can no longer scroll',
      (s) => s.replace('max-height: min(80vh, 560px); overflow-y: auto;', 'max-height: min(80vh, 560px);')],
    [CSS, 'the launcher panel can no longer scroll',
      (s) => s.replace('max-height: min(70vh, 600px); overflow-y: auto;', 'max-height: min(70vh, 600px);')],
    [CSS, 'the icon plate becomes a rounded square',
      (s) => s.replace('  border-radius: var(--sh-r-full); display: flex; align-items: center;',
                       '  border-radius: 4px; display: flex; align-items: center;')],
    [HUB, 'the two surfaces disagree on the tile mark size',
      (s) => s.replace('color={a.color} size={44} />', 'color={a.color} size={28} />')],
    [HUB, 'the Hub closes its launcher on a browser tab-switch',
      (s) => s.replace('      if (!next) return;\n', '')],
    [HUB, 'the Hub loses its empty state again',
      (s) => s.replace('<div className="shw-empty">No apps assigned yet.</div>', '<div />')],
    [HUB, 'the bar icon buttons lose their tooltips',
      (s) => s.split('            title="Synergy apps"\n').join('')
              .replace(' title="Settings"', '')
              .replace("            title={searchOpen ? 'Close search' : 'Search your apps'}\n", '')],
    [ICON, 'the word table loses its anchors again',
      (s) => s.replace("[/\\b(?:drive|files?|storage)\\b/i, 'folder'],",
                       "[/\\bdrive|files?|storage\\b/i, 'folder'],")],
    [ICON, 'a mark strokes pale straight onto the page',
      (s) => s.replace('<rect x="8" y="8" width="26" height="26" rx="6" fill={fill} />', '')],
    [CSS, 'the dark search chip goes back to invisible',
      (s) => s.split('--sh-container: #303134;').join('--sh-container: #1f1f1f;')],
  ];
  let caught = 0;
  console.log('Self-test — every sabotage must make the suite fail:\n');
  for (const [rel, label, mutate] of SABOTAGES) {
    const original = load(rel);
    /* Sources are CRLF; anchors below are written with plain newlines. Mutate a
       normalised copy, and restore from the pristine bytes either way. */
    const flat = original.split(String.fromCharCode(13)).join('');
    const broken = mutate(flat);
    if (broken === flat) { console.log(`  SKIPPED ${label} (anchor not found)`); continue; }
    writeFileSync(join(ROOT, rel), broken, 'utf8');
    let failed = false;
    try { execFileSync(process.execPath, [fileURLToPath(import.meta.url)], { stdio: 'pipe' }); }
    catch { failed = true; }
    writeFileSync(join(ROOT, rel), original, 'utf8');   // restore before the next one
    console.log(`  ${failed ? 'caught  ' : 'MISSED  '}${label}`);
    if (failed) caught++;
  }
  // Belt and braces: restore everything the run touched.
  for (const [rel, src] of originals) writeFileSync(join(ROOT, rel), src, 'utf8');
  console.log(`\nSelf-test: ${caught}/${SABOTAGES.length} sabotages caught\n`);
  if (caught !== SABOTAGES.length) process.exit(1);
}
