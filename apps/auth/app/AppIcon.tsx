/*
 * Product icons for the launcher and the waffle.
 *
 * WHY NOT EMOJI: an emoji renders in the viewer's system emoji font — Segoe UI
 * Emoji on Windows, Apple Color Emoji on macOS, Noto on Android/Linux — so the
 * same launcher looks materially different on three machines. A product family
 * is recognisable precisely because its marks do not change.
 *
 * WHY NOT AN ICON FONT: a failed font request must never turn the UI into raw
 * ligature text. These are inline SVG, so a missing asset is impossible.
 *
 * WHY THE TONES ARE CSS CUSTOM PROPERTIES, NOT A `dark` PROP:
 * a prop cannot be correct during SSR or on the first client paint — the theme
 * is only known after localStorage and matchMedia are read, so every icon would
 * paint its light tones for a frame on a dark page, which is exactly the flash
 * the pre-paint theme bootstrap exists to prevent. Emitting both tone sets and
 * letting the cascade choose means the correct colours are resolved before the
 * first paint, with no JS and no server/client mismatch.
 *
 * WHY OKLAB: HSL lightness is not perceptual luminance. Pinning HSL `l` left a
 * 3.8x contrast spread across hues — a teal brand landed at 1.82:1 against the
 * page while a blue sat at 6.98:1. OKLab's L is perceptually uniform, so pinning
 * it gives every app's mark the same visual weight whatever colour it is given.
 */

import { iconTones } from './icon-tones.mjs';

// ---------------------------------------------------------------- shapes
/* Anchored matching. Substring matching on slug+name meant `form` matched
   "Platform", `hr` matched any name containing those letters, `sign` matched
   "Design" and `map` matched "Sitemap". */
const BY_SLUG: Record<string, string> = {
  /* Drive and Docs are different products and must not share a mark — the
     first version mapped both to 'doc', so two installed apps could render the
     identical glyph. Same for analytics vs reporting. */
  drive: 'folder', files: 'folder', storage: 'folder',
  docs: 'doc', documents: 'doc',
  sheet: 'sheet', sheets: 'sheet', spreadsheet: 'sheet', spreadsheets: 'sheet',
  slides: 'slidedeck', slide: 'slidedeck', deck: 'slidedeck', presentation: 'slidedeck',
  meet: 'camera', video: 'camera',
  chat: 'bubble', converse: 'bubble', messages: 'bubble',
  mail: 'envelope', email: 'envelope',
  sign: 'pen', signature: 'pen', esign: 'pen',
  boards: 'board', kanban: 'board', tasks: 'board', projects: 'board',
  routes: 'pin', dispatch: 'pin', field: 'pin',
  msp: 'wrench', tools: 'wrench', maintenance: 'wrench', ops: 'wrench', manufacturing: 'wrench',
  desk: 'ticket', support: 'ticket', helpdesk: 'ticket', tickets: 'ticket',
  books: 'book', ledger: 'book', accounting: 'book',
  exec: 'chart', reports: 'chart', dashboard: 'chart',
  insights: 'graph', analytics: 'graph', metrics: 'graph', stats: 'graph',
  vault: 'lock', secrets: 'lock', passwords: 'lock',
  shield: 'shield', security: 'shield', protect: 'shield', antivirus: 'shield',

  /* The rest of the real fleet. Two thirds of it used to fall through to a
     monogram, which is a launcher of coloured letters — the exact thing the
     drawn marks exist to avoid. */
  law: 'scales', legal: 'scales', court: 'scales', case: 'scales',
  emr: 'cross', health: 'cross', clinic: 'cross', care: 'cross', patient: 'cross',
  meter: 'gauge', usage: 'gauge', metering: 'gauge', quota: 'gauge',
  phone: 'phone', voice: 'phone', call: 'phone', dialer: 'phone',
  sms: 'sms', text: 'sms', texting: 'sms',
  transcribe: 'wave', audio: 'wave', speech: 'wave', recordings: 'wave',
  erp: 'cube', operations: 'cube',
  stock: 'crate', inventory: 'crate', warehouse: 'crate', supplies: 'crate',
  wire: 'feed', news: 'feed', press: 'feed', digest: 'feed',
  invest: 'house', finance: 'coin', fund: 'coin', portfolio: 'coin',
  payments: 'card', wallet: 'card', checkout: 'card',
  flight: 'plane', drone: 'plane', fleet: 'plane',
  auth: 'key', identity: 'key', sso: 'key', login: 'key', keys: 'key',
  terminal: 'terminal', pos: 'terminal', kiosk: 'terminal',
  sdr: 'megaphone', outreach: 'megaphone', campaigns: 'megaphone', marketing: 'megaphone',
  db: 'database', database: 'database', data: 'database', sql: 'database',
  site: 'globe', web: 'globe', www: 'globe', domains: 'globe',
  link: 'link', linkcheck: 'link', links: 'link', redirects: 'link',
  streamr: 'play', stream: 'play', watch: 'play',
  hub: 'grid', launcher: 'grid', apps: 'grid',
  portal: 'door', clientportal: 'door', gateway: 'door',
  leadscout: 'target', leads: 'target', prospects: 'target', scout: 'target',
  crm: 'contactcard', customers: 'contactcard', accounts: 'contactcard',
  os: 'chip',

  /* Straight from production's sa_apps. Six of these were rendering as bare
     letters in the live launcher and five pairs were sharing a glyph. */
  time: 'clock', timesheet: 'clock', hours: 'clock',
  expense: 'receipt', expenses: 'receipt', claims: 'receipt',
  invoice: 'invoice', invoices: 'invoice',
  bills: 'bill', bill: 'bill',
  budget: 'piechart', budgets: 'piechart', forecasting: 'piechart',
  billing: 'card',
  book: 'booking', booking: 'booking', bookings: 'booking', appointments: 'booking',
  referrals: 'share', referral: 'share', affiliates: 'share',
  learn: 'cap', learning: 'cap', training: 'cap', courses: 'cap',
  shifts: 'roster', roster: 'roster', rota: 'roster', scheduling: 'roster',
  hire: 'personplus', hiring: 'personplus', recruiting: 'personplus', ats: 'personplus',
  notes: 'note', notebook: 'note',
  clm: 'contract', contracts: 'contract', agreements: 'contract',
  livechat: 'headset', chatsupport: 'headset',
  sites: 'globe', website: 'globe', websites: 'globe',
  synapse: 'nodes', graph3: 'nodes',
  statuspage: 'server', statuspages: 'server',

  /* The rest of the deployed estate. An independent review picked its fixture
     from the live fleet rather than from this table and found 14 more apps
     rendering as letters — the table had only ever been measured against the
     apps it already knew about. */
  alias: 'swap', aliases: 'swap', forward: 'swap', relay: 'swap',
  removals: 'trash', removal: 'trash', cleanup: 'trash', purge: 'trash',
  mask: 'mask', privacy: 'mask', redact: 'mask',
  verify: 'badge', audit: 'badge', compliance: 'badge', attest: 'badge',
  act: 'bolt', automation: 'bolt', actions: 'bolt', triggers: 'bolt',
  aba: 'puzzle', therapy: 'puzzle', modules: 'puzzle', plugins: 'puzzle',
  syntelligence: 'brain', intelligence: 'brain', ai: 'brain', assistant: 'brain',
  credit: 'spark', scoring: 'spark', underwriting: 'spark',
  weather: 'cloud', forecast: 'cloud',
  backups: 'archive', backup: 'archive', snapshots: 'archive',
  status: 'server', infra: 'server', monitor: 'server', uptime: 'server',
  gitea: 'branch', git: 'branch', repo: 'branch', code: 'branch',
  admin: 'gear', settings: 'gear', console: 'gear',
  calendar: 'calendar', cal: 'calendar', schedule: 'calendar',
  forms: 'form', surveys: 'form',
  people: 'person', contacts: 'person', team: 'person', hr: 'person',
  /* The suite's own apps. Seventeen of the 51 suite tiles fell through to a
     monogram, so the home page showed a column of lettered circles. */
  search: 'magnifier', find: 'magnifier',
  groups: 'people', communities: 'people',
  office: 'pages', todo: 'checkbox', planner: 'clipboard',
  flow: 'flow', workflows: 'flow',
  photo: 'photo', photos: 'photo', images: 'photo',
  cad: 'setsquare', drafting: 'setsquare',
  trust: 'keyshield', grc: 'keyshield',
  devices: 'devices', endpoints: 'devices', mdm: 'devices',
  base: 'rows', lists: 'rows',
  engage: 'bubbles', community: 'bubbles',
  builder: 'blocks', lowcode: 'blocks',
  diagrams: 'diagram', diagram: 'diagram', visio: 'diagram',
  whiteboard: 'easel', whiteboards: 'easel',
  loop: 'loop', commerce: 'bag', shop: 'bag', store: 'bag',
};
const BY_WORD: Array<[RegExp, string]> = [
  [/\bto[\s-]?dos?\b/i, 'checkbox'],
  [/\b(?:drive|files?|storage)\b/i, 'folder'],
  [/\b(?:docs?|documents?)\b/i, 'doc'],
  [/\b(?:meet|video)\b|\b(?:conferenc)/i, 'camera'],
  [/\b(?:chat)\b|\b(?:messag)/i, 'bubble'],
  [/\b(?:mail|inbox)\b/i, 'envelope'],
  [/\b(?:sign(?:ing|ature)?)\b/i, 'pen'],
  [/\b(?:boards?|kanban)\b/i, 'board'],
  [/\b(?:routes?|dispatch)\b/i, 'pin'],
  [/\b(?:msp|tools|maintenance)\b/i, 'wrench'],
  [/\b(?:desk|support|helpdesk|tickets?)\b/i, 'lifebuoy'],
  [/\b(?:books?|ledger|accounting)\b/i, 'book'],
  [/\b(?:executive|exec)\b|\b(?:report)/i, 'chart'],
  [/\b(?:insight|metric)s?\b|\b(?:analytic)/i, 'graph'],
  [/\b(?:vault|secrets?|passwords?)\b/i, 'lock'],
  [/\b(?:shield|security|antivirus)\b/i, 'shield'],
  [/\b(?:admin|console)\b/i, 'gear'],
  [/\b(?:law|legal|court)\b/i, 'scales'],
  [/\b(?:emr|health|clinic|care)\b/i, 'cross'],
  [/\b(?:meter|usage|quota)\b/i, 'gauge'],
  [/\b(?:phone|voice|call|dialer)\b/i, 'phone'],
  [/\b(?:sms|texting)\b/i, 'sms'],
  [/\b(?:transcribe|audio|speech)\b/i, 'wave'],
  [/\b(?:erp|operations)\b/i, 'cube'],
  [/\b(?:stock|inventory|warehouse|supplies)\b/i, 'crate'],
  [/\b(?:wire|news|press)\b/i, 'feed'],
  [/\b(?:invest|finance|fund|portfolio)\b/i, 'coin'],
  [/\b(?:pay|wallet|checkout)\b/i, 'card'],
  [/\b(?:flight|drone|fleet)\b/i, 'plane'],
  [/\b(?:auth|identity|sso)\b/i, 'key'],
  [/\b(?:terminal|pos|kiosk)\b/i, 'terminal'],
  [/\b(?:sdr|outreach)\b|\b(?:campaign)/i, 'megaphone'],
  [/\b(?:db|database|sql)\b/i, 'database'],
  [/\b(?:site|web|domains?)\b/i, 'globe'],
  [/\b(?:link(?:check|s)?)\b/i, 'link'],
  [/\b(?:hub|launcher)\b/i, 'grid'],
  [/\b(?:portal|gateway)\b/i, 'door'],
  [/\b(?:leads?|prospects?|scout)\b/i, 'target'],
  [/\b(?:crm|customers?)\b/i, 'contactcard'],
  [/\b(?:calendar)\b/i, 'calendar'],
  [/\b(?:forms?|surveys?)\b/i, 'form'],
  [/\b(?:people|contacts?|staff|team)\b/i, 'person'],
  [/\b(?:time|timesheets?|hours)\b/i, 'clock'],
  [/\b(?:expenses?|claims)\b/i, 'receipt'],
  [/\b(?:invoices?)\b/i, 'invoice'],
  [/\b(?:bills?)\b/i, 'bill'],
  [/\b(?:budgets?|forecasting)\b/i, 'piechart'],
  [/\b(?:billing)\b/i, 'card'],
  [/\b(?:book|bookings?|appointments?)\b/i, 'ticket'],
  [/\b(?:referrals?|affiliates?)\b/i, 'share'],
  [/\b(?:learn|learning|training|courses?)\b/i, 'cap'],
  [/\b(?:shifts?|roster|rota)\b/i, 'roster'],
  [/\b(?:hire|hiring|recruiting)\b/i, 'personplus'],
  [/\b(?:notes?|notebook)\b/i, 'note'],
  [/\b(?:clm|contracts?|agreements?)\b/i, 'contract'],
  [/\b(?:livechat)\b/i, 'headset'],
  [/\b(?:sites?|websites?)\b/i, 'globe'],
  [/\b(?:synapse)\b/i, 'nodes'],
  [/\b(?:alias(?:es)?|forward|relay)\b/i, 'swap'],
  [/\b(?:removals?|cleanup|purge)\b/i, 'trash'],
  [/\b(?:mask|privacy|redact)\b/i, 'mask'],
  [/\b(?:verify|audit|compliance)\b/i, 'badge'],
  [/\b(?:act|automation|triggers?)\b/i, 'bolt'],
  [/\b(?:aba|therapy|modules?|plugins?)\b/i, 'puzzle'],
  [/\b(?:syntelligence|intelligence|ai|assistant)\b/i, 'brain'],
  [/\b(?:credit|scoring|underwriting)\b/i, 'spark'],
  [/\b(?:weather|forecast)\b/i, 'cloud'],
  [/\b(?:backups?|snapshots?)\b/i, 'archive'],
  [/\b(?:status|infra|monitor|uptime)\b/i, 'server'],
  [/\b(?:gitea|git|repos?)\b/i, 'branch'],
];

/* Split an identifier into words before matching anything.
   BY_SLUG was exact-match on the raw slug and BY_WORD anchored on `\b`, and
   neither can see inside a camel-case product name: "SynergyDrive" has no word
   boundary before "Drive", and it is not the key `drive`. Every name in this
   fleet is camel-case, so the whole fleet fell through to the monogram — a
   launcher of bare letters, which is the opposite of a product family.
   The "synergy" prefix is dropped because every app carries it, so it
   distinguishes nothing. */
function words(s: string): string[] {
  return (s || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && w !== 'synergy');
}

function shapeFor(slug: string, name: string): string {
  const toks = [...words(slug), ...words(name)];
  for (const t of toks) if (BY_SLUG[t]) return BY_SLUG[t];
  /* Space-joined so the `\b` anchors still do their job: they are what stops
     `form` matching "Platform" and `sign` matching "Design". */
  const hay = toks.join(' ');
  for (const [re, shape] of BY_WORD) if (re.test(hay)) return shape;
  return '';
}

/* Optical normalisation: each path is drawn at its natural size, then scaled to
   a common optical AREA — sqrt(width x height) ≈ 26 units, centred on (21,21).
   Not a common box: the earlier scales equalised HEIGHT alone while claiming a
   shared box, which left widths running 18 to 41 in a 42-unit viewBox. A mark
   nearly twice as wide as its neighbour does not read as the same family, and
   the extremes (camera, envelope) pushed right up against the clip edge.
   Normalising on area keeps a wide mark wide and a tall mark tall — Gmail's
   envelope is genuinely wider than the Docs page — while giving every mark the
   same visual weight in its tile. tools/theme-audit.mjs holds the spread. */
const OPTICAL: Record<string, number> = {
  camera: 1.29, pin: 1.19, ticket: 1.19, envelope: 1.16, board: 1.14, doc: 1.14, receipt: 1.11,
  folder: 1.10, phone: 1.10, bubble: 1.09, swap: 1.09, chart: 1.08, person: 1.08, wrench: 1.07,
  brain: 1.05, branch: 1.05, contactcard: 1.05, feed: 1.05, puzzle: 1.04, badge: 1.03,
  bill: 1.03, archive: 1.02, database: 1.01, invoice: 1.01, play: 1.01, coin: 1.00,
  cross: 1.00, gauge: 1.00, grid: 1.00, link: 1.00, lock: 1.00, target: 1.00, graph: 0.99,
  shield: 0.99, key: 0.98, trash: 0.98, terminal: 0.97, cube: 0.96, megaphone: 0.96, pen: 0.96,
  nodes: 0.95, note: 0.95, cap: 0.94, card: 0.94, bolt: 0.93, calendar: 0.93, clock: 0.93,
  gear: 0.93, mask: 0.93, personplus: 0.93, piechart: 0.93, wave: 0.93, form: 0.91,
  headset: 0.91, share: 0.91, spark: 0.91, book: 0.90, globe: 0.90, scales: 0.90, server: 0.90,
  contract: 0.88, cloud: 0.87, door: 0.85, house: 0.85, slidedeck: 0.85, sms: 0.85, chip: 0.84,
  plane: 0.84, roster: 0.84, lifebuoy: 0.83, sheet: 0.83, crate: 0.81, booking: 0.79,
  bag: 1.02, photo: 1.00, checkbox: 1.00, keyshield: 0.99, people: 0.98, clipboard: 0.97, rows: 0.96,
  magnifier: 0.95, setsquare: 0.94, flow: 0.93, bubbles: 0.93, blocks: 0.93, pages: 0.91, loop: 0.95,
  diagram: 0.89, easel: 0.88, devices: 0.87
};

function Shape({ shape }: { shape: string }) {
  const fill = 'var(--ic-fill)';
  const deep = 'var(--ic-deep)';
  const pale = 'var(--ic-pale)';
  switch (shape) {
    case 'doc':
      return (<>
        <path d="M13 8h11l7 7v17a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z" fill={fill} />
        <path d="M24 8l7 7h-7V8Z" fill={deep} />
        <path d="M15 22h14M15 27h14" stroke={pale} strokeWidth="2.8" strokeLinecap="round" />
      </>);
    case 'lock':
      return (<>
        <path d="M14 19v-4a7 7 0 0 1 14 0v4" stroke={deep} strokeWidth="2.8" fill="none" strokeLinecap="round" />
        <rect x="9" y="18" width="24" height="17" rx="4" fill={fill} />
        <circle cx="21" cy="26" r="3" fill={pale} />
      </>);
    case 'card':
      return (<>
        <rect x="7" y="11" width="28" height="20" rx="3" fill={fill} />
        <path d="M7 17h28" stroke={deep} strokeWidth="5" />
        <path d="M12 26h7" stroke={pale} strokeWidth="2.8" strokeLinecap="round" />
      </>);
    case 'contactcard':
      return (<>
        <rect x="7" y="10" width="28" height="22" rx="3" fill={fill} />
        <circle cx="17" cy="18" r="4" fill={pale} />
        <path d="M11 27c0-3 2.7-5 6-5s6 2 6 5" fill={pale} />
        <path d="M27 17h5M27 22h5" stroke={deep} strokeWidth="2.8" strokeLinecap="round" />
      </>);
    case 'sms':
      return (<>
        <rect x="11" y="3" width="17" height="36" rx="4" fill={fill} />
        <path d="M17 8h5" stroke={pale} strokeWidth="2" strokeLinecap="round" />
        <path d="M21 20h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4v-4h-2a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" fill={deep} />
      </>);
    case 'link':
      /* The connector is --ic-fill, NOT --ic-pale. Nothing sits behind it — it
         bridges the gap between the two arcs — so it is drawn straight onto the
         page, where pale measures ~1.02:1 and simply is not there. The whole
         pale contract is "3:1 against the FILL it sits on"; a pale stroke with
         no fill under it is outside that contract, and the mark rendered as two
         disconnected arcs. Tightened to 12..30 as well: at its area scale the
         old geometry was 36 units wide, the widest mark in the family. */
      return (<>
        <rect x="8" y="8" width="26" height="26" rx="6" fill={fill} />
        <path d="M17 25l8-8" stroke={pale} strokeWidth="2.8" strokeLinecap="round" />
        <path d="M19 16h7v7" stroke={pale} strokeWidth="2.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16 20v6h6" stroke={deep} strokeWidth="2.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>);
    case 'mask':
      return (<>
        <path d="M7 15h28v7a11 11 0 0 1-11 11h-6A11 11 0 0 1 7 22v-7Z" fill={fill} />
        <circle cx="15" cy="22" r="3" fill={pale} />
        <circle cx="27" cy="22" r="3" fill={pale} />
        <path d="M7 15l14-6 14 6" stroke={deep} strokeWidth="2.8" fill="none" strokeLinejoin="round" />
      </>);
    case 'swap':
      return (<>
        <path d="M10 16h20l-5-5" stroke={fill} strokeWidth="2.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M32 26H12l5 5" stroke={deep} strokeWidth="2.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>);
    case 'trash':
      return (<>
        <path d="M9 13h24l-2 20a3 3 0 0 1-3 2.6H14A3 3 0 0 1 11 33L9 13Z" fill={fill} />
        <path d="M16 10a3 3 0 0 1 3-2.6h4A3 3 0 0 1 26 10" stroke={deep} strokeWidth="2.8" fill="none" strokeLinecap="round" />
        <path d="M17 20v8M25 20v8" stroke={pale} strokeWidth="2.8" strokeLinecap="round" />
      </>);
    case 'badge':
      return (<>
        <circle cx="21" cy="18" r="11" fill={fill} />
        <path d="M16 18l4 4 7-7" stroke={pale} strokeWidth="2.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 27l-3 9 10-4 10 4-3-9" fill={deep} />
      </>);
    case 'bolt':
      return (<>
        <path d="M23 6l-12 18h8l-2 12 12-18h-8l2-12Z" fill={fill} />
        <path d="M19 24h8l-2 12 12-18" fill="none" stroke={deep} strokeWidth="0" />
      </>);
    case 'puzzle':
      return (<>
        <path d="M10 11h8a3 3 0 0 1 6 0h8v8a3 3 0 0 0 0 6v8h-8a3 3 0 0 0-6 0h-8v-8a3 3 0 0 1 0-6v-8Z" fill={fill} />
        <path d="M24 25a3 3 0 0 1 0-6" stroke={pale} strokeWidth="2.8" fill="none" />
      </>);
    case 'spark':
      return (<>
        <path d="M21 7l3.4 8.6L33 19l-8.6 3.4L21 31l-3.4-8.6L9 19l8.6-3.4L21 7Z" fill={fill} />
        <path d="M31 27l1.4 3.6L36 32l-3.6 1.4L31 37l-1.4-3.6L26 32l3.6-1.4L31 27Z" fill={deep} />
      </>);
    case 'brain':
      return (<>
        <path d="M18 9a6 6 0 0 0-6 6 5 5 0 0 0-2 9 6 6 0 0 0 8 8V9Z" fill={fill} />
        <path d="M24 9a6 6 0 0 1 6 6 5 5 0 0 1 2 9 6 6 0 0 1-8 8V9Z" fill={deep} />
      </>);
    case 'cloud':
      return (<>
        <path d="M14 30a8 8 0 0 1-.6-16A10 10 0 0 1 32 17a7 7 0 0 1-1 13H14Z" fill={fill} />
        <path d="M17 34l-1 3M23 34l-1 3M29 34l-1 3" stroke={deep} strokeWidth="2.8" strokeLinecap="round" />
      </>);
    case 'archive':
      return (<>
        <rect x="8" y="9" width="26" height="8" rx="2.5" fill={deep} />
        <path d="M10 18h22v13a3 3 0 0 1-3 3H13a3 3 0 0 1-3-3V18Z" fill={fill} />
        <path d="M17 24h8" stroke={pale} strokeWidth="2.8" strokeLinecap="round" />
      </>);
    case 'server':
      return (<>
        <rect x="7" y="7" width="28" height="9" rx="1.5" fill={fill} />
        <rect x="7" y="19" width="28" height="9" rx="1.5" fill={deep} />
        <rect x="7" y="31" width="28" height="6" rx="1.5" fill={fill} />
        <path d="M12 11.5h9M12 23.5h9" stroke={pale} strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="30" cy="11.5" r="1.8" fill={pale} />
        <circle cx="30" cy="23.5" r="1.8" fill={pale} />
      </>);
    case 'branch':
      return (<>
        <path d="M14 13v16" stroke={fill} strokeWidth="2.8" strokeLinecap="round" />
        <path d="M14 20h8a6 6 0 0 0 6-6" stroke={deep} strokeWidth="2.8" fill="none" strokeLinecap="round" />
        <circle cx="14" cy="11" r="4" fill={fill} />
        <circle cx="14" cy="31" r="4" fill={fill} />
        <circle cx="28" cy="11" r="4" fill={deep} />
      </>);
    case 'clock':
      return (<>
        <circle cx="21" cy="21" r="14" fill={fill} />
        <path d="M21 12v9l6 4" stroke={pale} strokeWidth="2.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>);
    case 'receipt':
      return (<>
        <path d="M12 8l3.5 2.5L19 8l3.5 2.5L26 8l3.5 2.5L33 8v26l-3.5-2.5L26 34l-3.5-2.5L19 34l-3.5-2.5L12 34V8Z" fill={fill} />
        <path d="M17 16h11M17 21h11M17 26h7" stroke={pale} strokeWidth="2.6" strokeLinecap="round" />
      </>);
    case 'invoice':
      return (<>
        <rect x="10" y="6" width="22" height="30" rx="3" fill={fill} />
        <path d="M21 11v20" stroke={pale} strokeWidth="2.8" strokeLinecap="round" />
        <path d="M25 16.5a4 4 0 0 0-4-2.5h-1a3.5 3.5 0 0 0 0 7h2a3.5 3.5 0 0 1 0 7h-1a4 4 0 0 1-4-2.5" stroke={pale} strokeWidth="2.8" fill="none" strokeLinecap="round" />
      </>);
    case 'bill':
      return (<>
        <rect x="6" y="12" width="30" height="18" rx="3" fill={fill} />
        <circle cx="21" cy="21" r="5" fill={pale} />
        <path d="M11 17v8M31 17v8" stroke={deep} strokeWidth="2.8" strokeLinecap="round" />
      </>);
    case 'piechart':
      /* A <circle> for the body rather than one big arc: the audit's path
         walker tracks arc ENDPOINTS, and an arc bulges past them, so a
         circle-sized shape drawn as a path measures far smaller than it is and
         gets scaled up until it clips. Drawn this way the bounding box is
         honest. */
      return (<>
        <circle cx="21" cy="21" r="14" fill={fill} />
        <path d="M21 21V7a14 14 0 0 1 14 14H21Z" fill={deep} />
      </>);
    case 'ticket':
      return (<>
        <path d="M8 13h26v6a3 3 0 0 0 0 6v6H8v-6a3 3 0 0 0 0-6v-6Z" fill={fill} />
        <path d="M21 15v5M21 24v5" stroke={pale} strokeWidth="2.8" strokeLinecap="round" />
      </>);
    case 'share':
      return (<>
        <circle cx="29" cy="11" r="5" fill={deep} />
        <circle cx="29" cy="31" r="5" fill={deep} />
        <circle cx="12" cy="21" r="5.5" fill={fill} />
        <path d="M17 18.5l7-4M17 23.5l7 4" stroke={fill} strokeWidth="2.8" strokeLinecap="round" />
      </>);
    case 'cap':
      return (<>
        <path d="M21 8l16 7-16 7-16-7 16-7Z" fill={fill} />
        <path d="M12 19v8c0 2.8 4 5 9 5s9-2.2 9-5v-8l-9 4-9-4Z" fill={deep} />
      </>);
    case 'roster':
      return (<>
        <rect x="5" y="6" width="32" height="30" rx="3" fill={fill} />
        <path d="M10 11h3M18 11h3M26 11h3" stroke={deep} strokeWidth="2.6" strokeLinecap="round" />
        <rect x="8.5" y="16" width="6" height="9" rx="2" fill={pale} />
        <rect x="18" y="21" width="6" height="11" rx="2" fill={deep} />
        <rect x="27.5" y="16" width="6" height="7" rx="2" fill={pale} />
      </>);
    case 'personplus':
      return (<>
        <circle cx="17" cy="15" r="6" fill={fill} />
        <path d="M6 33c0-6 5-9.5 11-9.5S28 27 28 33H6Z" fill={fill} />
        <path d="M32 21v10M27 26h10" stroke={deep} strokeWidth="2.8" strokeLinecap="round" />
      </>);
    case 'note':
      return (<>
        <rect x="9" y="10" width="24" height="26" rx="3" fill={fill} />
        <path d="M14 20h14M14 26h14M14 32h9" stroke={pale} strokeWidth="2.8" strokeLinecap="round" />
        <path d="M15 6v8M21 6v8M27 6v8" stroke={deep} strokeWidth="2.8" strokeLinecap="round" />
      </>);
    case 'contract':
      return (<>
        <path d="M9 5h15l8 8v24a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" fill={fill} />
        <path d="M24 5l8 8h-8V5Z" fill={deep} />
        <path d="M13 15h7M13 21h12" stroke={pale} strokeWidth="2.8" strokeLinecap="round" />
        <circle cx="20" cy="30" r="6.5" fill={deep} />
        <path d="M16 34l-2 6 6-2.5 6 2.5-2-6" fill={deep} />
      </>);
    case 'headset':
      return (<>
        <path d="M9 25v-3a12 12 0 0 1 24 0v3" stroke={deep} strokeWidth="2.8" fill="none" strokeLinecap="round" />
        <rect x="5" y="22" width="8" height="12" rx="3" fill={fill} />
        <rect x="29" y="22" width="8" height="12" rx="3" fill={fill} />
      </>);
    case 'lifebuoy':
      return (<>
        <circle cx="21" cy="21" r="14" fill={fill} />
        <circle cx="21" cy="21" r="5.5" fill={pale} />
        <path d="M21 7v6M21 29v6M7 21h6M29 21h6" stroke={deep} strokeWidth="3.4" strokeLinecap="round" />
      </>);
    case 'crate':
      return (<>
        <path d="M6 15h30v19a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V15Z" fill={fill} />
        <path d="M4 7h34v9H4V7Z" fill={deep} />
        <path d="M17 7h8v9h-8V7Z" fill={pale} />
        <path d="M21 22v9" stroke={pale} strokeWidth="2.8" strokeLinecap="round" />
      </>);
    case 'nodes':
      return (<>
        <circle cx="15" cy="16" r="8" fill={fill} />
        <circle cx="27" cy="16" r="8" fill={deep} />
        <circle cx="21" cy="27" r="8" fill={fill} />
      </>);
    case 'scales':
      return (<>
        <path d="M21 8v26M13 34h16" stroke={deep} strokeWidth="2.8" strokeLinecap="round" />
        <path d="M8 14h26" stroke={deep} strokeWidth="2.8" strokeLinecap="round" />
        <path d="M11 14l-4 8h8l-4-8ZM31 14l-4 8h8l-4-8Z" fill={fill} />
      </>);
    case 'cross':
      return (<>
        <rect x="8" y="8" width="26" height="26" rx="7" fill={fill} />
        <path d="M21 14v14M14 21h14" stroke={pale} strokeWidth="4" strokeLinecap="round" />
      </>);
    case 'gauge':
      /* A full dial, not a semicircle. Drawn as a half-gauge it measured
         37.5 x 18.1 — an aspect no scale can normalise without either dwarfing
         its neighbours in width or vanishing in height. */
      return (<>
        <circle cx="21" cy="21" r="13" fill={fill} />
        <path d="M21 21l7-7" stroke={pale} strokeWidth="2.8" strokeLinecap="round" />
        <circle cx="21" cy="21" r="3.5" fill={deep} />
      </>);
    case 'phone':
      return (<>
        <rect x="11" y="7" width="20" height="28" rx="4.5" fill={fill} />
        <path d="M17 11h8" stroke={pale} strokeWidth="2.8" strokeLinecap="round" />
        <circle cx="21" cy="30" r="2" fill={pale} />
      </>);
    case 'wave':
      return (<>
        <rect x="16" y="4" width="10" height="18" rx="5" fill={fill} />
        <path d="M11 18a10 10 0 0 0 20 0" stroke={deep} strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M21 28v4" stroke={deep} strokeWidth="3" strokeLinecap="round" />
        <path d="M12 36h18" stroke={deep} strokeWidth="3" strokeLinecap="round" />
      </>);
    case 'cube':
      return (<>
        <path d="M21 7l13 7v14l-13 7-13-7V14l13-7Z" fill={fill} />
        <path d="M21 21l13-7v14l-13 7V21Z" fill={deep} />
      </>);
    case 'feed':
      return (<>
        <rect x="7" y="10" width="28" height="22" rx="3" fill={fill} />
        <rect x="11" y="14" width="11" height="8" rx="1.5" fill={pale} />
        <path d="M25 15h6M25 19h6M11 26h20" stroke={pale} strokeWidth="2.8" strokeLinecap="round" />
      </>);
    case 'coin':
      return (<>
        <circle cx="21" cy="21" r="13" fill={fill} />
        <path d="M21 13v16M17 17h6a3 3 0 0 1 0 6h-4a3 3 0 0 0 0 6h6" stroke={pale} strokeWidth="2.8" fill="none" strokeLinecap="round" />
      </>);
    case 'plane':
      return (<>
        <path d="M21 6l4 13 12 5-12 2-4 10-4-10-12-2 12-5 4-13Z" fill={fill} />
        <path d="M21 6l4 13-4 2-4-2 4-13Z" fill={deep} />
      </>);
    case 'key':
      // Diagonal rather than horizontal, for the same aspect-ratio reason.
      return (<>
        <circle cx="16" cy="16" r="9" fill={fill} />
        <circle cx="16" cy="16" r="3.5" fill={pale} />
        <path d="M22 22l10 10M27 30l3-3" stroke={deep} strokeWidth="2.8" strokeLinecap="round" />
      </>);
    case 'terminal':
      return (<>
        <rect x="7" y="9" width="28" height="20" rx="3" fill={fill} />
        <path d="M13 16l4 3-4 3M21 22h7" stroke={pale} strokeWidth="2.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M15 33h12" stroke={deep} strokeWidth="2.8" strokeLinecap="round" />
      </>);
    case 'megaphone':
      return (<>
        <path d="M9 17h6l14-8v24l-14-8H9a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Z" fill={fill} />
        <path d="M33 15a7 7 0 0 1 0 12" stroke={deep} strokeWidth="2.8" fill="none" strokeLinecap="round" />
      </>);
    case 'database':
      return (<>
        <ellipse cx="21" cy="12" rx="13" ry="5" fill={deep} />
        <path d="M8 12v18c0 2.8 5.8 5 13 5s13-2.2 13-5V12" fill={fill} />
        <path d="M8 21c0 2.8 5.8 5 13 5s13-2.2 13-5" stroke={pale} strokeWidth="2.8" fill="none" />
      </>);
    case 'globe':
      return (<>
        <circle cx="21" cy="21" r="13" fill={fill} />
        <path d="M8 21h26M21 8c4 4 4 22 0 26M21 8c-4 4-4 22 0 26" stroke={pale} strokeWidth="2.8" fill="none" />
      </>);
    case 'chip':
      return (<>
        <rect x="11" y="11" width="20" height="20" rx="3" fill={fill} />
        <rect x="16" y="16" width="10" height="10" rx="1.5" fill={pale} />
        <path d="M16 7v4M21 7v4M26 7v4M16 31v4M21 31v4M26 31v4M7 16h4M7 21h4M7 26h4M31 16h4M31 21h4M31 26h4"
          stroke={deep} strokeWidth="2.8" strokeLinecap="round" />
      </>);
    case 'door':
      return (<>
        <path d="M18 9a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v28H18V9Z" fill={fill} />
        <circle cx="23" cy="22" r="2" fill={pale} />
        <path d="M6 22h9M11 17l5 5-5 5" stroke={deep} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>);
    case 'grid':
      return (<>
        <rect x="8" y="8" width="11" height="11" rx="2.5" fill={fill} />
        <rect x="23" y="8" width="11" height="11" rx="2.5" fill={deep} />
        <rect x="8" y="23" width="11" height="11" rx="2.5" fill={deep} />
        <rect x="23" y="23" width="11" height="11" rx="2.5" fill={fill} />
      </>);
    case 'target':
      return (<>
        <circle cx="21" cy="21" r="13" fill={fill} />
        <circle cx="21" cy="21" r="8" fill={pale} />
        <circle cx="21" cy="21" r="3.5" fill={deep} />
      </>);
    case 'folder':
      return (<>
        <path d="M9 12h9l3 3h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V14a2 2 0 0 1 2-2Z" fill={fill} />
        <path d="M7 19h28v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V19Z" fill={deep} />
      </>);
    case 'graph':
      return (<>
        <path d="M9 10v21a2 2 0 0 0 2 2h22" stroke={deep} strokeWidth="2.8" fill="none" strokeLinecap="round" />
        <path d="M13 27l6-7 5 4 7-9" stroke={fill} strokeWidth="2.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="31" cy="15" r="3" fill={fill} />
      </>);
    case 'play':
      return (<>
        <rect x="6" y="10" width="30" height="22" rx="4" fill={fill} />
        <path d="M18 17l9 5-9 5v-10Z" fill={pale} />
      </>);
    case 'camera':
      return (<>
        <rect x="9" y="14" width="17" height="16" rx="3" fill={fill} />
        <path d="M27 20l6-4v12l-6-4v-4Z" fill={deep} />
      </>);
    case 'bubble':
      return (<>
        <path d="M10 13h22a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H19l-7 5v-5h-2a2 2 0 0 1-2-2V15a2 2 0 0 1 2-2Z" fill={fill} />
        <path d="M15 20h12M15 25h8" stroke={pale} strokeWidth="2.8" strokeLinecap="round" />
      </>);
    case 'envelope':
      return (<>
        <rect x="8" y="13" width="26" height="18" rx="3" fill={fill} />
        <path d="M9 16l12 9 12-9" stroke={pale} strokeWidth="2.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>);
    case 'pen':
      return (<>
        <path d="M9 24c5-13 8-13 9-9s-3 13 1 13 5-6 8-6 4 4 6 4" stroke={fill} strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 33h26" stroke={deep} strokeWidth="3" strokeLinecap="round" />
      </>);
    case 'board':
      return (<>
        <rect x="8" y="11" width="26" height="20" rx="3" fill={fill} />
        <rect x="12" y="15" width="6" height="12" rx="1.5" fill={pale} />
        <rect x="21" y="15" width="6" height="7" rx="1.5" fill={pale} />
      </>);
    case 'pin':
      return (<>
        <path d="M21 8a9 9 0 0 1 9 9c0 6.5-9 17-9 17s-9-10.5-9-17a9 9 0 0 1 9-9Z" fill={fill} />
        <circle cx="21" cy="17" r="3.5" fill={pale} />
      </>);
    case 'wrench':
      return (<>
        <path d="M29 9a7 7 0 0 0-8.6 9.2L9 29.6 12.4 33l11.4-11.4A7 7 0 0 0 33 13l-4.2 4.2-3-3L30 10a7 7 0 0 0-1-1Z" fill={fill} />
      </>);
    case 'book':
      return (<>
        <path d="M12 6h20a2 2 0 0 1 2 2v26a2 2 0 0 1-2 2H12V6Z" fill={fill} />
        <path d="M8 6h5v30H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" fill={deep} />
        <path d="M17 13h6M17 19h6M17 25h6M17 31h6" stroke={pale} strokeWidth="2.4" strokeLinecap="round" />
        <path d="M27 13h4M27 19h4M27 25h4M27 31h4" stroke={pale} strokeWidth="2.4" strokeLinecap="round" />
      </>);
    case 'chart':
      return (<>
        <rect x="9" y="22" width="6" height="11" rx="1.5" fill={deep} />
        <rect x="18" y="15" width="6" height="18" rx="1.5" fill={fill} />
        <rect x="27" y="9" width="6" height="24" rx="1.5" fill={deep} />
      </>);
    case 'shield':
      return (<>
        <path d="M21 7l12 5v9c0 8-5.2 13.4-12 15-6.8-1.6-12-7-12-15v-9l12-5Z" fill={fill} />
        <path d="M15.5 21l4 4 7-7.5" stroke={pale} strokeWidth="2.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>);
    case 'gear':
      return (<>
        <path d="M21 8l2.4 3.6 4.2-1.1 1 4.2 4.2 1-1.1 4.2L35 22l-3.3 2.1 1.1 4.2-4.2 1-1 4.2-4.2-1.1L21 36l-2.4-3.6-4.2 1.1-1-4.2-4.2-1 1.1-4.2L7 22l3.3-2.1-1.1-4.2 4.2-1 1-4.2 4.2 1.1L21 8Z" fill={fill} />
        <circle cx="21" cy="22" r="5" fill={pale} />
      </>);
    case 'calendar':
      return (<>
        <rect x="7" y="8" width="28" height="28" rx="3" fill={fill} />
        <path d="M7 11a3 3 0 0 1 3-3h22a3 3 0 0 1 3 3v5H7v-5Z" fill={deep} />
        <circle cx="14" cy="23" r="2.3" fill={pale} />
        <circle cx="21" cy="23" r="2.3" fill={pale} />
        <circle cx="28" cy="23" r="2.3" fill={pale} />
        <circle cx="14" cy="30" r="2.3" fill={pale} />
        <circle cx="21" cy="30" r="2.3" fill={pale} />
      </>);
    case 'sheet':
      return (<>
        <rect x="6" y="7" width="30" height="28" rx="3" fill={fill} />
        <path d="M6 14h30" stroke={deep} strokeWidth="4" />
        <path d="M16 9v26M26 9v26" stroke={pale} strokeWidth="2.2" />
        <path d="M8 21h26M8 28h26" stroke={pale} strokeWidth="2.2" />
      </>);
    case 'slidedeck':
      return (<>
        <rect x="5" y="8" width="32" height="21" rx="3" fill={fill} />
        <path d="M11 15h14M11 21h9" stroke={pale} strokeWidth="2.8" strokeLinecap="round" />
        <path d="M21 29v5" stroke={deep} strokeWidth="2.8" strokeLinecap="round" />
        <path d="M14 36h14" stroke={deep} strokeWidth="2.8" strokeLinecap="round" />
      </>);
    case 'booking':
      return (<>
        <rect x="6" y="9" width="24" height="25" rx="3" fill={fill} />
        <rect x="11" y="4" width="3.5" height="9" rx="1.75" fill={deep} />
        <rect x="21" y="4" width="3.5" height="9" rx="1.75" fill={deep} />
        <circle cx="29" cy="29" r="9" fill={deep} />
        <path d="M29 24v5l3.5 2.5" stroke={pale} strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>);
    case 'house':
      return (<>
        <path d="M21 6 6 18v17a2 2 0 0 0 2 2h26a2 2 0 0 0 2-2V18L21 6Z" fill={fill} />
        <path d="M13 30l6-6 4 4 7-8" stroke={pale} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M27 16h4v6" stroke={pale} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>);
    case 'form':
      return (<>
        <path d="M11 5h14l7 7v25a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" fill={fill} />
        <path d="M25 5l7 7h-7V5Z" fill={deep} />
        <path d="M14 19l2 2 4-4M14 28l2 2 4-4" stroke={pale} strokeWidth="2.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M23 20h6M23 29h6" stroke={pale} strokeWidth="2.8" strokeLinecap="round" />
      </>);
    case 'magnifier':
      return (<>
        <circle cx="18" cy="18" r="10" fill={fill} />
        <circle cx="18" cy="18" r="5" fill={pale} />
        <path d="M25.5 25.5L33 33" stroke={deep} strokeWidth="4.5" strokeLinecap="round" />
      </>);
    case 'people':
      return (<>
        <circle cx="27" cy="14" r="4.5" fill={deep} />
        <path d="M19 30c0-5 3.6-8 8-8s8 3 8 8H19Z" fill={deep} />
        <circle cx="16" cy="16" r="5.5" fill={fill} />
        <path d="M6 34c0-5.8 4.5-9.5 10-9.5S26 28.2 26 34H6Z" fill={fill} />
      </>);
    case 'pages':
      return (<>
        <rect x="15" y="6" width="20" height="25" rx="2.5" fill={deep} />
        <rect x="8" y="11" width="20" height="25" rx="2.5" fill={fill} />
        <path d="M12.5 19h11M12.5 24h11M12.5 29h7" stroke={pale} strokeWidth="2.6" strokeLinecap="round" />
      </>);
    case 'checkbox':
      return (<>
        <rect x="8" y="8" width="26" height="26" rx="7" fill={fill} />
        <path d="M14 21.5l5 5 9-10" stroke={pale} strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>);
    case 'clipboard':
      return (<>
        <rect x="9" y="9" width="24" height="27" rx="3" fill={fill} />
        <rect x="15" y="6" width="12" height="6" rx="2" fill={deep} />
        <rect x="13.5" y="17" width="4" height="4" rx="1" fill={pale} />
        <rect x="13.5" y="26" width="4" height="4" rx="1" fill={pale} />
        <path d="M21 19h7M21 28h7" stroke={pale} strokeWidth="2.6" strokeLinecap="round" />
      </>);
    case 'flow':
      return (<>
        <rect x="6" y="8" width="13" height="10" rx="2.5" fill={fill} />
        <rect x="23" y="24" width="13" height="10" rx="2.5" fill={fill} />
        <path d="M12.5 18v6a5 5 0 0 0 5 5h4" stroke={deep} strokeWidth="2.8" fill="none" strokeLinecap="round" />
        <path d="M19 25.5l3.5 3.5-3.5 3.5" stroke={deep} strokeWidth="2.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M23 13h8a3 3 0 0 1 3 3v3" stroke={deep} strokeWidth="2.8" fill="none" strokeLinecap="round" />
      </>);
    case 'photo':
      return (<>
        <rect x="7" y="9" width="28" height="24" rx="3" fill={fill} />
        <circle cx="27" cy="16.5" r="3" fill={pale} />
        <path d="M7 29l8.5-9 6 6.5 4-4 9.5 9.5V30a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3V29Z" fill={deep} />
      </>);
    case 'setsquare':
      return (<>
        <path d="M9 35V8l27 27H9Z" fill={fill} />
        <path d="M14.5 29.5v-8.5l8.5 8.5h-8.5Z" fill={pale} />
        <path d="M9 14h4.5M9 19h3M9 24h4.5" stroke={deep} strokeWidth="2.2" strokeLinecap="round" />
      </>);
    case 'keyshield':
      return (<>
        <path d="M21 7l12 5v9c0 8-5.2 13.4-12 15V7Z" fill={deep} />
        <path d="M21 7L9 12v9c0 8 5.2 13.4 12 15V7Z" fill={fill} />
        <circle cx="21" cy="19" r="3.5" fill={pale} />
        <path d="M19.3 21h3.4l1 7h-5.4l1-7Z" fill={pale} />
      </>);
    case 'devices':
      return (<>
        <rect x="6" y="9" width="23" height="16" rx="2" fill={fill} />
        <path d="M4 28h24v1.5a2.5 2.5 0 0 1-2.5 2.5h-19A2.5 2.5 0 0 1 4 29.5V28Z" fill={fill} />
        <rect x="26" y="15" width="12" height="20" rx="2.5" fill={deep} />
        <rect x="28.5" y="18" width="7" height="13" rx="1" fill={fill} />
      </>);
    case 'rows':
      return (<>
        <rect x="8" y="7" width="26" height="8" rx="2.5" fill={deep} />
        <rect x="8" y="17" width="26" height="8" rx="2.5" fill={fill} />
        <rect x="8" y="27" width="26" height="8" rx="2.5" fill={fill} />
        <path d="M12.5 21h2M12.5 31h2M18 21h11M18 31h11" stroke={pale} strokeWidth="2.4" strokeLinecap="round" />
      </>);
    case 'bubbles':
      return (<>
        <path d="M18 6h14a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-1v5l-6-5h-7a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3Z" fill={deep} />
        <path d="M10 14h14a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-8l-6 5v-5a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3Z" fill={fill} />
        <path d="M12 20.5h10M12 25h6" stroke={pale} strokeWidth="2.6" strokeLinecap="round" />
      </>);
    case 'blocks':
      return (<>
        <rect x="14.5" y="6" width="13" height="13" rx="2.5" fill={deep} />
        <rect x="7" y="21" width="13" height="13" rx="2.5" fill={fill} />
        <rect x="22" y="21" width="13" height="13" rx="2.5" fill={fill} />
      </>);
    case 'diagram':
      return (<>
        <path d="M13 19v10h9" stroke={deep} strokeWidth="2.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M19 13h9" stroke={deep} strokeWidth="2.8" strokeLinecap="round" />
        <rect x="7" y="7" width="12" height="12" rx="2.5" fill={fill} />
        <path d="M29.5 6.5l6.5 11H23l6.5-11Z" fill={fill} />
        <circle cx="29" cy="29" r="7" fill={fill} />
      </>);
    case 'easel':
      return (<>
        <path d="M14 27l-3.5 8M28 27l3.5 8" stroke={deep} strokeWidth="2.8" strokeLinecap="round" />
        <rect x="6" y="7" width="30" height="21" rx="2.5" fill={fill} />
        <path d="M11 21c3-5 5.5-6 7.5-2.5s4.5 3.5 7-0.5 4.5-4 6-2.5" stroke={pale} strokeWidth="2.8" fill="none" strokeLinecap="round" />
      </>);
    case 'loop':
      return (<>
        <path d="M21 21c-2.5-4-4.6-7-8-7a7 7 0 0 0 0 14c3.4 0 5.5-3 8-7Z" stroke={deep} strokeWidth="4.2" fill="none" strokeLinejoin="round" />
        <path d="M21 21c2.5 4 4.6 7 8 7a7 7 0 0 0 0-14c-3.4 0-5.5 3-8 7Z" stroke={fill} strokeWidth="4.2" fill="none" strokeLinejoin="round" />
      </>);
    case 'bag':
      return (<>
        <path d="M16 17v-4a5 5 0 0 1 10 0v4" stroke={deep} strokeWidth="2.8" fill="none" strokeLinecap="round" />
        <path d="M10 15h22l-1.5 19a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2L10 15Z" fill={fill} />
        <circle cx="16" cy="20.5" r="1.8" fill={pale} />
        <circle cx="26" cy="20.5" r="1.8" fill={pale} />
      </>);
    case 'person':
      return (<>
        <circle cx="21" cy="16" r="6" fill={fill} />
        <path d="M9 34c0-6.1 5.4-10 12-10s12 3.9 12 10H9Z" fill={deep} />
      </>);
    default:
      return null;
  }
}

export default function AppIcon({
  slug, name, color, size = 56,
}: {
  slug: string; name: string; color: string | null; size?: number;
}) {
  const shape = shapeFor(slug, name);
  /* The slug is the key an achromatic brand gets its hue from, so two grey-
     branded apps do not render the identical mark. */
  const vars = iconTones(color, slug) as unknown as React.CSSProperties;

  // No mapped shape: a neutral monogram plate, still on the pinned tones. An
  // emoji here would put a platform-dependent glyph next to vector marks.
  if (!shape) {
    const letter = (name || slug || '?').replace(/^Synergy\s*/i, '').trim().charAt(0).toUpperCase();
    /* This letter is TEXT, not a glyph, so WCAG wants 4.5:1 rather than the
       3:1 that applies to the drawn marks. It renders in --ic-pale on an
       --ic-deep PLATE (see .sh-appicon-mono): the pale-on-deep pair is the one
       gated at 4.5:1. This comment used to say the letter was --ic-deep, which
       was true until the plate was introduced and false afterwards. */
    return (
      <span className="sh-appicon sh-appicon-mono" style={{ ...vars, width: size, height: size }} aria-hidden="true">
        <span style={{ fontSize: Math.round(size * 0.42), fontWeight: 500 }}>{letter || '?'}</span>
      </span>
    );
  }

  const k = OPTICAL[shape] ?? 1;
  return (
    <span className="sh-appicon" style={{ ...vars, width: size, height: size }} aria-hidden="true">
      <svg width="100%" height="100%" viewBox="0 0 42 42" role="presentation" focusable="false">
        <g transform={`translate(21 21) scale(${k}) translate(-21 -21)`}>
          <Shape shape={shape} />
        </g>
      </svg>
    </span>
  );
}
