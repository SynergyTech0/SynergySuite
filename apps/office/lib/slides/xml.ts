// Tiny, dependency-free XML reader for OOXML parts. It builds a light tree that
// behaves the same in the browser and in Node (tests), matching elements by
// local name (OOXML prefixes are conventional, not guaranteed).

export type XEl = {
  name: string; // qualified, e.g. "a:p"
  local: string; // local part, e.g. "p"
  attrs: Record<string, string>; // keyed by local attribute name (and qualified name)
  children: XEl[];
  text: string; // concatenated direct text content
};

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decode(s: string): string {
  if (s.indexOf("&") < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENT[e] ?? m;
  });
}

const localOf = (n: string) => {
  const i = n.indexOf(":");
  return i < 0 ? n : n.slice(i + 1);
};

/**
 * Parse XML into a light tree. With `mixed`, text between elements is also
 * kept in order as "#text" children (for mixed content such as ODF text:p).
 */
export function parseXml(src: string, opts: { mixed?: boolean } = {}): XEl {
  const root: XEl = { name: "#root", local: "#root", attrs: {}, children: [], text: "" };
  const stack: XEl[] = [root];
  let i = 0;
  const n = src.length;
  const attrRe = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) break;
    if (lt > i) {
      const t = decode(src.slice(i, lt));
      const top = stack[stack.length - 1];
      top.text += t;
      if (opts.mixed && stack.length > 1) top.children.push({ name: "#text", local: "#text", attrs: {}, children: [], text: t });
    }
    if (src.startsWith("<!--", lt)) {
      const e = src.indexOf("-->", lt);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", lt)) {
      const e = src.indexOf("]]>", lt);
      stack[stack.length - 1].text += src.slice(lt + 9, e < 0 ? n : e);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (src[lt + 1] === "?" || src[lt + 1] === "!") {
      const e = src.indexOf(">", lt);
      i = e < 0 ? n : e + 1;
      continue;
    }
    // find end of tag, respecting quoted attribute values
    let j = lt + 1;
    let q: string | null = null;
    while (j < n) {
      const c = src[j];
      if (q) {
        if (c === q) q = null;
      } else if (c === '"' || c === "'") q = c;
      else if (c === ">") break;
      j++;
    }
    const tag = src.slice(lt + 1, j);
    i = j + 1;
    if (tag[0] === "/") {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const selfClose = tag.endsWith("/");
    const body = selfClose ? tag.slice(0, -1) : tag;
    const sp = body.search(/\s/);
    const name = sp < 0 ? body : body.slice(0, sp);
    const el: XEl = { name, local: localOf(name), attrs: {}, children: [], text: "" };
    if (sp >= 0) {
      const rest = body.slice(sp);
      attrRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = attrRe.exec(rest))) {
        const v = decode(m[3] ?? m[4] ?? "");
        el.attrs[m[1]] = v;
        const l = localOf(m[1]);
        if (!(l in el.attrs)) el.attrs[l] = v;
      }
    }
    stack[stack.length - 1].children.push(el);
    if (!selfClose) stack.push(el);
  }
  return root.children[0] || root;
}

export function child(el: XEl | undefined, local: string): XEl | undefined {
  if (!el) return undefined;
  for (const c of el.children) if (c.local === local) return c;
  return undefined;
}
export function kids(el: XEl | undefined, local?: string): XEl[] {
  if (!el) return [];
  return local ? el.children.filter((c) => c.local === local) : el.children;
}
/** Follow a path of local names, e.g. path(sp, "spPr", "xfrm", "off"). */
export function path(el: XEl | undefined, ...names: string[]): XEl | undefined {
  let cur = el;
  for (const nm of names) cur = child(cur, nm);
  return cur;
}
export function descendants(el: XEl | undefined, local: string, out: XEl[] = []): XEl[] {
  if (!el) return out;
  for (const c of el.children) {
    if (c.local === local) out.push(c);
    descendants(c, local, out);
  }
  return out;
}
export function attr(el: XEl | undefined, name: string): string | undefined {
  return el?.attrs[name];
}
export function num(el: XEl | undefined, name: string): number | undefined {
  const v = el?.attrs[name];
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
