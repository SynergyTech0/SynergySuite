// The little XML a DAV server needs: read a request body into a namespace-aware tree, and write
// multistatus answers with fixed prefixes. Request bodies come from the network, so the parser
// never resolves external entities (xmldom doesn't) and bodies are size-capped by the caller.
import { DOMParser } from "@xmldom/xmldom";

export const NS = {
  DAV: "DAV:",
  CALDAV: "urn:ietf:params:xml:ns:caldav",
  CARDDAV: "urn:ietf:params:xml:ns:carddav",
  CS: "http://calendarserver.org/ns/",
  ICAL: "http://apple.com/ns/ical/",
} as const;

const PREFIX: Record<string, string> = {
  [NS.DAV]: "d",
  [NS.CALDAV]: "cal",
  [NS.CARDDAV]: "card",
  [NS.CS]: "cs",
  [NS.ICAL]: "ical",
};

/** An element: its namespace and local name, children, and the text directly inside it. */
export type XNode = { ns: string; name: string; attrs: Record<string, string>; children: XNode[]; text: string };

/** Clark notation, "{DAV:}getetag": how properties are named everywhere in this package. */
export const clark = (n: { ns: string; name: string }) => `{${n.ns}}${n.name}`;

export function parseXml(body: string): XNode | null {
  if (!body.trim()) return null;
  let failed = false;
  let doc;
  try {
    doc = new DOMParser({ onError: (level: string) => { if (level !== "warning") failed = true; } })
      .parseFromString(body, "application/xml");
  } catch {
    return null;
  }
  if (failed || !doc || !doc.documentElement) return null;
  return convert(doc.documentElement as unknown as DomEl);
}

type DomEl = {
  nodeType: number; namespaceURI: string | null; localName: string | null; nodeName: string; nodeValue: string | null;
  attributes?: { length: number; item(i: number): { localName: string | null; nodeName: string; value: string } | null };
  childNodes: { length: number; item(i: number): DomEl | null };
};

function convert(el: DomEl): XNode {
  const node: XNode = { ns: el.namespaceURI ?? "", name: el.localName ?? el.nodeName, attrs: {}, children: [], text: "" };
  for (let i = 0; el.attributes && i < el.attributes.length; i++) {
    const a = el.attributes.item(i);
    if (a) node.attrs[a.localName ?? a.nodeName] = a.value;
  }
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes.item(i);
    if (!c) continue;
    if (c.nodeType === 1) node.children.push(convert(c));
    else if (c.nodeType === 3 || c.nodeType === 4) node.text += c.nodeValue ?? "";
  }
  return node;
}

export function child(n: XNode | null | undefined, ns: string, name: string): XNode | undefined {
  return n?.children.find((c) => c.ns === ns && c.name === name);
}

export function childrenOf(n: XNode | null | undefined, ns?: string, name?: string): XNode[] {
  return (n?.children ?? []).filter((c) => (ns == null || c.ns === ns) && (name == null || c.name === name));
}

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Writes an element named in Clark notation; unknown namespaces get their own xmlns. */
export function el(name: string, inner = ""): string {
  const m = /^\{([^}]*)\}(.+)$/.exec(name);
  const ns = m ? m[1] : NS.DAV;
  const local = m ? m[2] : name;
  const prefix = PREFIX[ns];
  if (prefix) return inner === "" ? `<${prefix}:${local}/>` : `<${prefix}:${local}>${inner}</${prefix}:${local}>`;
  const decl = ` xmlns:x="${esc(ns)}"`;
  return inner === "" ? `<x:${local}${decl}/>` : `<x:${local}${decl}>${inner}</x:${local}>`;
}

export function document(root: string): string {
  // Declare every fixed prefix on the root so the parts above can use them freely.
  const decls = Object.entries(PREFIX).map(([ns, p]) => ` xmlns:${p}="${ns}"`).join("");
  return `<?xml version="1.0" encoding="utf-8"?>\n${root.replace(/^<([a-z]+:[A-Za-z-]+)/, `<$1${decls}`)}`;
}
