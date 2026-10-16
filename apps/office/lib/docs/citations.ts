// Citations and bibliography in Word's four common styles. Sources live in
// the document settings (Word keeps them in customXml as b:Sources); a
// citation names one or more sources by tag and shows "(Smith, 2020)",
// "(Smith 12)", "(Smith 2020, 12)" or "[1]"; the bibliography lists every
// source of the document in the style's order and form.

export type CitationStyle = "APA" | "MLA" | "Chicago" | "IEEE";
export const CITATION_STYLES: { id: CitationStyle; label: string; title: string; xsl: string }[] = [
  { id: "APA", label: "APA (7th edition)", title: "References", xsl: "\\APASixthEditionOfficeOnline.xsl" },
  { id: "MLA", label: "MLA (9th edition)", title: "Works Cited", xsl: "\\MLASeventhEditionOfficeOnline.xsl" },
  { id: "Chicago", label: "Chicago (author-date)", title: "Bibliography", xsl: "\\CHICAGO.XSL" },
  { id: "IEEE", label: "IEEE", title: "References", xsl: "\\IEEE2006OfficeOnline.xsl" },
];

export type SourceType = "Book" | "JournalArticle" | "InternetSite" | "Report" | "Misc";
export const SOURCE_TYPES: { id: SourceType; label: string }[] = [
  { id: "Book", label: "Book" },
  { id: "JournalArticle", label: "Journal article" },
  { id: "InternetSite", label: "Web site" },
  { id: "Report", label: "Report" },
  { id: "Misc", label: "Miscellaneous" },
];

export type Source = {
  tag: string;
  type: SourceType;
  /** "Last, First; Last, First" (a name without a comma is a corporate author) */
  authors: string;
  title: string;
  year?: string;
  publisher?: string;
  city?: string;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  url?: string;
  /** web site name */
  site?: string;
  /** date accessed, yyyy-mm-dd */
  accessed?: string;
};

/** One piece of formatted text; titles are italic. */
export type Seg = { text: string; italic?: boolean };

type Name = { last: string; first: string; corporate?: boolean };

export function parseAuthors(s: string): Name[] {
  return s
    .split(/;|\s+&\s+|\s+and\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const i = x.indexOf(",");
      if (i < 0) {
        const parts = x.split(/\s+/);
        // "Jane Doe" -> Doe, Jane; a single word or an organisation stays as it is
        return parts.length === 2 && /^[A-Z][a-z]/.test(parts[0]) && /^[A-Z][a-z]/.test(parts[1]) ? { last: parts[1], first: parts[0] } : { last: x, first: "", corporate: true };
      }
      return { last: x.slice(0, i).trim(), first: x.slice(i + 1).trim() };
    });
}

const initials = (first: string, spaced = true) =>
  first
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((w) => w.split("-").map((p) => `${p[0].toUpperCase()}.`).join("-"))
    .join(spaced ? " " : "");

/** A tag Word would make: the first three letters of the first author and two digits of the year ("Smi20"). */
export function makeTag(s: Pick<Source, "authors" | "title" | "year">, taken: string[] = []): string {
  const a = parseAuthors(s.authors)[0];
  const base = ((a?.last || s.title || "Src").replace(/[^A-Za-z0-9]/g, "").slice(0, 3) || "Src") + (s.year || "").replace(/\D/g, "").slice(-2);
  let t = base;
  for (let i = 0; taken.includes(t); i++) t = base + String.fromCharCode(97 + i);
  return t;
}

const year = (s: Source) => s.year || "n.d.";
const end = (t: string) => (/[.?!]$/.test(t) ? t : `${t}.`);

function nameList(names: Name[], style: CitationStyle): string {
  if (!names.length) return "";
  const full = (n: Name, i: number) => {
    if (n.corporate || !n.first) return n.last;
    switch (style) {
      case "APA":
        return `${n.last}, ${initials(n.first)}`;
      case "IEEE":
        return `${initials(n.first)} ${n.last}`;
      default:
        // MLA and Chicago: first author inverted, the rest in natural order
        return i === 0 ? `${n.last}, ${n.first}` : `${n.first} ${n.last}`;
    }
  };
  const ns = names.map(full);
  switch (style) {
    case "APA":
      if (ns.length === 1) return ns[0];
      if (ns.length <= 20) return `${ns.slice(0, -1).join(", ")}, & ${ns[ns.length - 1]}`;
      return `${ns.slice(0, 19).join(", ")}, … ${ns[ns.length - 1]}`;
    case "MLA":
      return ns.length === 1 ? ns[0] : ns.length === 2 ? `${ns[0]}, and ${ns[1]}` : `${ns[0]}, et al`;
    case "IEEE":
      return ns.length === 1 ? ns[0] : ns.length === 2 ? `${ns[0]} and ${ns[1]}` : ns.length > 6 ? `${ns[0]} et al.` : `${ns.slice(0, -1).join(", ")}, and ${ns[ns.length - 1]}`;
    default:
      return ns.length === 1 ? ns[0] : `${ns.slice(0, -1).join(", ")}, and ${ns[ns.length - 1]}`;
  }
}

/** The bibliography entry of a source, as text pieces (titles in italic). */
export function bibEntry(s: Source, style: CitationStyle, num?: number): Seg[] {
  const names = parseAuthors(s.authors);
  const who = nameList(names, style);
  const out: Seg[] = [];
  const t = (text: string) => text && out.push({ text });
  const i = (text: string) => text && out.push({ text, italic: true });
  const title = s.title || "Untitled";
  const container = s.type === "JournalArticle";
  switch (style) {
    case "APA": {
      t(who ? `${end(who)} (${year(s)}). ` : "");
      if (container) {
        t(`${end(title)} `);
        if (s.journal) {
          i(s.journal);
          if (s.volume) (t(", "), i(s.volume));
          t(`${s.issue ? `(${s.issue})` : ""}${s.pages ? `, ${s.pages}` : ""}. `);
        }
      } else {
        if (!who) t(`${title}. (${year(s)}). `);
        else (i(end(title)), t(" "));
        if (s.type === "InternetSite") t(s.site ? `${end(s.site)} ` : "");
        else if (s.publisher) t(`${end(s.publisher)} `);
      }
      if (s.url) t(s.url);
      break;
    }
    case "MLA": {
      if (who) t(`${end(who)} `);
      if (container) {
        t(`“${end(title)}” `);
        if (s.journal) (i(s.journal), t(", "));
        t([s.volume && `vol. ${s.volume}`, s.issue && `no. ${s.issue}`, s.year, s.pages && `pp. ${s.pages}`].filter(Boolean).join(", ") + ". ");
      } else {
        i(end(title));
        t(" ");
        const pub = s.type === "InternetSite" ? s.site : s.publisher;
        t([pub, s.year].filter(Boolean).join(", ") + (pub || s.year ? ", " : ""));
        if (s.url) t(`${s.url}. `);
        else if (pub || s.year) out[out.length - 1].text = out[out.length - 1].text.replace(/, $/, ". ");
        if (s.accessed) t(`Accessed ${s.accessed}.`);
      }
      break;
    }
    case "Chicago": {
      t(`${who ? end(who) + " " : ""}${year(s)}. `);
      if (container) {
        t(`“${end(title)}” `);
        if (s.journal) i(s.journal);
        t(`${s.volume ? ` ${s.volume}` : ""}${s.issue ? ` (${s.issue})` : ""}${s.pages ? `: ${s.pages}` : ""}. `);
      } else {
        i(end(title));
        t(" ");
        if (s.type === "InternetSite") t(s.site ? `${end(s.site)} ` : "");
        else if (s.publisher) t(`${s.city ? `${s.city}: ` : ""}${end(s.publisher)} `);
      }
      if (s.url) t(`${s.url}.`);
      break;
    }
    case "IEEE": {
      t(`[${num ?? 1}]\t`);
      if (who) t(`${who}, `);
      if (container) {
        t(`“${title},” `);
        if (s.journal) i(s.journal);
        t(`${[s.volume && `vol. ${s.volume}`, s.issue && `no. ${s.issue}`, s.pages && `pp. ${s.pages}`, s.year].filter(Boolean).map((x) => `, ${x}`).join("")}.`);
      } else if (s.type === "InternetSite") {
        t(`“${title}.” `);
        if (s.site) (i(s.site), t(". "));
        if (s.url) t(`[Online]. Available: ${s.url}`);
        if (s.accessed) t(` [Accessed ${s.accessed}].`);
      } else {
        i(title);
        t(`. ${[s.city && s.publisher ? `${s.city}: ${s.publisher}` : s.publisher, s.year].filter(Boolean).join(", ")}.`);
      }
      break;
    }
  }
  if (out.length) out[out.length - 1] = { ...out[out.length - 1], text: out[out.length - 1].text.trimEnd() };
  return out;
}

/** Sort key for author-date styles: first author's last name, then year, then title. */
const sortKey = (s: Source) => `${(parseAuthors(s.authors)[0]?.last || s.title || "").toLowerCase()}\u0000${s.year || ""}\u0000${s.title.toLowerCase()}`;

/** IEEE numbers sources in the order they are first cited; the others list by author. */
export function citationOrder(sources: Source[], citedTags: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of citedTags) if (!m.has(t) && sources.some((s) => s.tag === t)) m.set(t, m.size + 1);
  for (const s of sources) if (!m.has(s.tag)) m.set(s.tag, m.size + 1);
  return m;
}

/** The bibliography: every source, in the style's order, with its entry. */
export function bibliography(sources: Source[], style: CitationStyle, citedTags: string[] = []): { tag: string; segs: Seg[] }[] {
  if (style === "IEEE") {
    const order = citationOrder(sources, citedTags);
    return [...sources].sort((a, b) => order.get(a.tag)! - order.get(b.tag)!).map((s) => ({ tag: s.tag, segs: bibEntry(s, style, order.get(s.tag)) }));
  }
  return [...sources].sort((a, b) => sortKey(a).localeCompare(sortKey(b))).map((s) => ({ tag: s.tag, segs: bibEntry(s, style) }));
}

function citeName(names: Name[], style: CitationStyle, title: string): string {
  if (!names.length) return `“${title}”`;
  const l = names.map((n) => n.last);
  const amp = style === "APA" ? " & " : " and ";
  if (l.length === 1) return l[0];
  if (l.length === 2) return `${l[0]}${amp}${l[1]}`;
  if (l.length === 3 && style === "Chicago") return `${l[0]}, ${l[1]}, and ${l[2]}`;
  return `${l[0]} et al.`;
}

/** The text of an in-text citation of one or more sources (by tag), with optional page(s) for the first. */
export function citationText(sources: Source[], tags: string[], style: CitationStyle, pages?: string, order?: Map<string, number>): string {
  const found = tags.map((t) => sources.find((s) => s.tag === t)).filter((s): s is Source => !!s);
  if (!found.length) return tags.length ? `(${tags.join("; ")})` : "(Source)";
  const pg = pages?.trim();
  if (style === "IEEE") {
    const ord = order || citationOrder(sources, tags);
    return found.map((s, k) => `[${ord.get(s.tag) ?? "?"}${k === 0 && pg ? `, ${/^\d+$/.test(pg) ? "p." : "pp."} ${pg}` : ""}]`).join(", ");
  }
  const one = (s: Source, k: number) => {
    const name = citeName(parseAuthors(s.authors), style, s.title);
    const p = k === 0 && pg ? pg : "";
    if (style === "MLA") return `${name}${p ? ` ${p}` : ""}`;
    if (style === "APA") return `${name}, ${year(s)}${p ? `, ${/[-–,]/.test(p) ? "pp." : "p."} ${p}` : ""}`;
    return `${name} ${year(s)}${p ? `, ${p}` : ""}`;
  };
  return `(${found.map(one).join("; ")})`;
}

// ---- Word's b:Sources XML ----

const B = "http://schemas.openxmlformats.org/officeDocument/2006/bibliography";
const xesc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function sourcesXml(sources: Source[], style: CitationStyle): string {
  const st = CITATION_STYLES.find((c) => c.id === style) || CITATION_STYLES[0];
  const el = (tag: string, v?: string) => (v ? `<b:${tag}>${xesc(v)}</b:${tag}>` : "");
  const items = sources.map((s) => {
    const names = parseAuthors(s.authors);
    const corporate = names.length === 1 && names[0].corporate;
    const author = !names.length
      ? ""
      : `<b:Author><b:Author>${corporate ? `<b:Corporate>${xesc(names[0].last)}</b:Corporate>` : `<b:NameList>${names.map((n) => `<b:Person><b:Last>${xesc(n.last)}</b:Last>${n.first ? `<b:First>${xesc(n.first)}</b:First>` : ""}</b:Person>`).join("")}</b:NameList>`}</b:Author></b:Author>`;
    const [ay, am, ad] = (s.accessed || "").split("-");
    return (
      `<b:Source><b:Tag>${xesc(s.tag)}</b:Tag><b:SourceType>${s.type === "Misc" ? "Misc" : s.type}</b:SourceType>${author}` +
      el("Title", s.title) +
      el("Year", s.year) +
      el("Publisher", s.publisher) +
      el("City", s.city) +
      el("JournalName", s.journal) +
      el("Volume", s.volume) +
      el("Issue", s.issue) +
      el("Pages", s.pages) +
      el("InternetSiteTitle", s.site) +
      el("URL", s.url) +
      el("YearAccessed", ay) +
      el("MonthAccessed", am) +
      el("DayAccessed", ad) +
      `</b:Source>`
    );
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<b:Sources xmlns:b="${B}" xmlns="${B}" SelectedStyle="${xesc(st.xsl)}" StyleName="${st.id}">${items.join("")}</b:Sources>`;
}

/** Read b:Sources (from parsed XML: an element tree with local names). */
export function parseSources(root: { local: string; attrs: Record<string, string>; children: unknown[]; text?: string }): { sources: Source[]; style?: CitationStyle } {
  type X = { local: string; attrs: Record<string, string>; children: X[]; text?: string };
  const r = root as X;
  const kid = (e: X | undefined, n: string) => e?.children.find((c) => c.local === n);
  const txt = (e: X | undefined): string => (e ? (e.text ?? "") + e.children.map(txt).join("") : "");
  const sources: Source[] = [];
  for (const s of r.children.filter((c) => c.local === "Source")) {
    const g = (n: string) => txt(kid(s, n)).trim() || undefined;
    const typ = g("SourceType") || "Misc";
    const auth = kid(kid(kid(s, "Author"), "Author"), "NameList");
    const corp = txt(kid(kid(kid(s, "Author"), "Author"), "Corporate")).trim();
    const people = (auth?.children || []).filter((c) => c.local === "Person").map((p) => {
      const last = txt(kid(p, "Last")).trim();
      const first = [txt(kid(p, "First")).trim(), txt(kid(p, "Middle")).trim()].filter(Boolean).join(" ");
      return first ? `${last}, ${first}` : last;
    });
    const type: SourceType = typ === "JournalArticle" || typ === "ArticleInAPeriodical" ? "JournalArticle" : typ === "InternetSite" || typ === "DocumentFromInternetSite" ? "InternetSite" : typ === "Report" ? "Report" : typ === "Book" || typ === "BookSection" ? "Book" : "Misc";
    const [ay, am, ad] = [g("YearAccessed"), g("MonthAccessed"), g("DayAccessed")];
    const src: Source = {
      tag: g("Tag") || `Src${sources.length + 1}`,
      type,
      authors: corp || people.join("; "),
      title: g("Title") || g("BookTitle") || "",
      year: g("Year"),
      publisher: g("Publisher"),
      city: g("City"),
      journal: g("JournalName") || g("PeriodicalTitle"),
      volume: g("Volume"),
      issue: g("Issue"),
      pages: g("Pages"),
      site: g("InternetSiteTitle"),
      url: g("URL"),
      accessed: ay ? [ay, am, ad].filter(Boolean).join("-") : undefined,
    };
    for (const k of Object.keys(src) as (keyof Source)[]) if (src[k] === undefined) delete src[k];
    sources.push(src);
  }
  const sn = (r.attrs.StyleName || "").toUpperCase();
  const style = sn.startsWith("APA") ? "APA" : sn.startsWith("MLA") ? "MLA" : sn.startsWith("CHICAGO") ? "Chicago" : sn.startsWith("IEEE") ? "IEEE" : undefined;
  return { sources, style };
}

/** Parse a CITATION field instruction: CITATION Smi20 \l 1033 \p 12 \m Doe19 */
export function parseCitationInstr(instr: string): { tags: string[]; pages?: string } | null {
  const m = /^\s*CITATION\s+(\S+)(.*)$/i.exec(instr);
  if (!m) return null;
  const tags = [m[1]];
  const rest = m[2];
  for (const x of rest.matchAll(/\\m\s+(\S+)/g)) tags.push(x[1]);
  const p = /\\p\s+("([^"]*)"|\S+)/.exec(rest);
  return { tags, pages: p ? p[2] ?? p[1] : undefined };
}
