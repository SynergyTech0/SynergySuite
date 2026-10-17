/**
 * Just enough XML for Windows device management: the SOAP messages of enrollment and the SyncML
 * of OMA-DM sessions. Elements keep their local name (namespace prefixes dropped), attributes
 * and text; DOCTYPE and entity declarations are refused.
 */

export type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string };

export class XmlError extends Error {}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

const TAG = /<([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;

const local = (name: string) => name.slice(name.indexOf(":") + 1);

export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    const top = stack[stack.length - 1];
    if (lt < 0) {
      if (src.slice(i).trim() && stack.length > 1) throw new XmlError("Unclosed element");
      break;
    }
    if (lt > i) top.text += decode(src.slice(i, lt));
    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt);
      if (end < 0) throw new XmlError("Unclosed comment");
      i = end + 3;
    } else if (src.startsWith("<![CDATA[", lt)) {
      const end = src.indexOf("]]>", lt);
      if (end < 0) throw new XmlError("Unclosed CDATA");
      top.text += src.slice(lt + 9, end);
      i = end + 3;
    } else if (src.startsWith("<?", lt)) {
      const end = src.indexOf("?>", lt);
      if (end < 0) throw new XmlError("Unclosed declaration");
      i = end + 2;
    } else if (src.startsWith("<!", lt)) {
      throw new XmlError("DOCTYPE isn't allowed");
    } else if (src[lt + 1] === "/") {
      const end = src.indexOf(">", lt);
      if (end < 0) throw new XmlError("Unclosed tag");
      const name = local(src.slice(lt + 2, end).trim());
      const open = stack.pop();
      if (!open || open === root || open.name !== name) throw new XmlError(`Unexpected </${name}>`);
      i = end + 1;
    } else {
      TAG.lastIndex = lt;
      const m = TAG.exec(src);
      if (!m) throw new XmlError("Malformed tag");
      const node: XmlNode = { name: local(m[1]), attrs: {}, children: [], text: "" };
      for (const a of m[2].matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) node.attrs[local(a[1])] = decode(a[2] ?? a[3] ?? "");
      top.children.push(node);
      if (!m[3]) stack.push(node);
      i = lt + m[0].length;
    }
    if (stack.length > 64) throw new XmlError("Too deeply nested");
  }
  if (stack.length > 1) throw new XmlError("Unclosed element");
  const doc = root.children[0];
  if (!doc || root.children.length > 1) throw new XmlError("Expected one root element");
  return doc;
}

/** The first child with this name, following a path of names. */
export function child(n: XmlNode | undefined, ...path: string[]): XmlNode | undefined {
  let cur = n;
  for (const p of path) cur = cur?.children.find((c) => c.name === p);
  return cur;
}

export const children = (n: XmlNode | undefined, name: string): XmlNode[] => n?.children.filter((c) => c.name === name) ?? [];

/** Trimmed text of the element at the path, or "". */
export const textAt = (n: XmlNode | undefined, ...path: string[]): string => child(n, ...path)?.text.trim() ?? "";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
