// Indexes: XE fields mark entries ("Main:Sub", bold or italic page numbers,
// "See" cross-references) and an INDEX field lists them alphabetically with
// their pages, under letter headings, in columns.
export type IndexEntryAttrs = { entry: string; bold?: boolean; italic?: boolean; see?: string | null };
export type IndexOptions = { columns: number; rightAlign: boolean; headings: boolean };
export type IndexPage = { label: string; bold?: boolean; italic?: boolean };
export type IndexItem = { text: string; pages: IndexPage[]; see?: string; subs: IndexItem[] };
export type IndexGroup = { letter: string; items: IndexItem[] };

const unq = (s: string) => s.replace(/\\"/g, '"').replace(/\\:/g, "\u0000");

/** XE "Main:Sub" \b \i \t "See Other" */
export function parseXE(instr: string): IndexEntryAttrs | null {
  const m = /^\s*XE\s+"((?:[^"\\]|\\.)*)"(.*)$/is.exec(instr) || /^\s*XE\s+(\S+)(.*)$/is.exec(instr);
  if (!m) return null;
  const rest = m[2] || "";
  const see = /\\t\s+"((?:[^"\\]|\\.)*)"/.exec(rest)?.[1];
  const out: IndexEntryAttrs = { entry: unq(m[1]).split(":").map((p) => p.replace(/\u0000/g, ":").trim()).filter(Boolean).join(":") };
  if (!out.entry) return null;
  if (/\\b\b/.test(rest)) out.bold = true;
  if (/\\i\b/.test(rest)) out.italic = true;
  if (see) out.see = unq(see).replace(/\u0000/g, ":");
  return out;
}
export function xeInstr(a: IndexEntryAttrs): string {
  const q = (s: string) => s.replace(/"/g, '\\"');
  return `XE "${q(a.entry)}"${a.bold ? " \\b" : ""}${a.italic ? " \\i" : ""}${a.see ? ` \\t "${q(a.see)}"` : ""}`;
}

/** INDEX \c "2" \e "<tab>" \h "A" */
export function parseIndexInstr(instr: string): IndexOptions {
  const cols = /\\c\s+"?(\d+)"?/.exec(instr);
  return { columns: Math.max(1, Math.min(4, cols ? Number(cols[1]) : 1)), rightAlign: /\\e\s+"\t"/.test(instr) || /\\e\s+"\s*"/.test(instr), headings: /\\h\s+"/.test(instr) };
}
export function indexInstr(o: IndexOptions): string {
  return `INDEX${o.headings ? ' \\h "A"' : ""}${o.columns > 1 ? ` \\c "${o.columns}"` : ""}${o.rightAlign ? ' \\e "\t"' : ""} \\z "1033"`;
}

const key = (s: string) => s.toLocaleLowerCase("en").normalize("NFKD").replace(/[̀-ͯ]/g, "");
const pageNum = (p: string) => {
  const n = Number(p);
  return Number.isFinite(n) ? n : Infinity;
};

/** Entries (with the page each sits on) grouped, sorted and merged the way Word's INDEX shows them. */
export function buildIndex(entries: (IndexEntryAttrs & { page: string })[]): IndexGroup[] {
  const top = new Map<string, IndexItem>();
  const add = (parent: Map<string, IndexItem>, text: string): IndexItem => {
    const k = key(text);
    let it = parent.get(k);
    if (!it) parent.set(k, (it = { text, pages: [], subs: [] }));
    return it;
  };
  const subMaps = new WeakMap<IndexItem, Map<string, IndexItem>>();
  for (const e of entries) {
    const parts = e.entry.split(":").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) continue;
    let it = add(top, parts[0]);
    for (const p of parts.slice(1, 3)) {
      let m = subMaps.get(it);
      if (!m) subMaps.set(it, (m = new Map(it.subs.map((s) => [key(s.text), s]))));
      const before = m.size;
      const s = add(m, p);
      if (m.size > before) it.subs.push(s);
      it = s;
    }
    if (e.see) it.see = e.see;
    else if (!it.pages.some((p) => p.label === e.page && !!p.bold === !!e.bold && !!p.italic === !!e.italic)) it.pages.push({ label: e.page, ...(e.bold ? { bold: true } : {}), ...(e.italic ? { italic: true } : {}) });
  }
  const sortItems = (items: IndexItem[]) => {
    items.sort((a, b) => key(a.text).localeCompare(key(b.text), "en"));
    for (const it of items) {
      it.pages.sort((a, b) => pageNum(a.label) - pageNum(b.label) || a.label.localeCompare(b.label));
      // a page listed both plain and bold shows once, bold
      it.pages = it.pages.filter((p, i, all) => !all.some((q, j) => j !== i && q.label === p.label && (q.bold || q.italic) && !(p.bold || p.italic)));
      sortItems(it.subs);
    }
    return items;
  };
  const groups = new Map<string, IndexItem[]>();
  for (const it of sortItems([...top.values()])) {
    const first = key(it.text)[0] || "";
    const letter = /[a-z]/.test(first) ? first.toUpperCase() : /\d/.test(first) ? "#" : "*";
    groups.set(letter, [...(groups.get(letter) || []), it]);
  }
  return [...groups.entries()].sort(([a], [b]) => (a === "*" ? -2 : a === "#" ? -1 : a.charCodeAt(0)) - (b === "*" ? -2 : b === "#" ? -1 : b.charCodeAt(0))).map(([letter, items]) => ({ letter, items }));
}

/** "12, 15, 20" or "See Other". */
export function pagesText(it: IndexItem): string {
  return it.see ? `See ${it.see}` : it.pages.map((p) => p.label).join(", ");
}
