// Grouping in exported slides. PptxGenJS cannot write group shapes, so after it
// has written a slide we wrap each group's members (found by their
// `syn-el-<id>` names) in a <p:grpSp> whose child space equals its own, so the
// members keep their positions.

const OBJ = /<p:(sp|pic|graphicFrame|cxnSp)>[\s\S]*?<\/p:\1>/g;

/** Where an object (by its `syn-el-` name) or an already written group (by its name) sits in the slide XML. */
function unitAt(xml: string, name: string): { start: number; end: number; text: string } | null {
  if (!name.startsWith("syn-el-")) {
    const at = xml.indexOf(`<p:grpSp><p:nvGrpSpPr><p:cNvPr id="`);
    for (let i = at; i >= 0; i = xml.indexOf(`<p:grpSp><p:nvGrpSpPr><p:cNvPr id="`, i + 1)) {
      const head = /^<p:grpSp><p:nvGrpSpPr><p:cNvPr id="\d+" name="([^"]*)"/.exec(xml.slice(i, i + 300));
      if (head?.[1] !== name) continue;
      // the matching end tag (groups nest)
      let depth = 0;
      const re = /<p:grpSp>|<\/p:grpSp>/g;
      re.lastIndex = i;
      for (let m = re.exec(xml); m; m = re.exec(xml)) {
        depth += m[0] === "<p:grpSp>" ? 1 : -1;
        if (!depth) return { start: i, end: m.index + m[0].length, text: xml.slice(i, m.index + m[0].length) };
      }
      return null;
    }
    return null;
  }
  for (const m of xml.matchAll(OBJ)) if (/<p:cNvPr id="\d+" name="([^"]*)"/.exec(m[0])?.[1] === name) return { start: m.index!, end: m.index! + m[0].length, text: m[0] };
  return null;
}

/**
 * Wrap each group in a <p:grpSp>. `ids` are element ids, or "group:<name>"
 * for a group written before it (inner groups come first, so groups nest).
 * Groups whose members are not adjacent in the tree are left alone.
 */
export function wrapGroups(xml: string, groups: { name: string; ids: string[] }[]): string {
  let nextId = Math.max(0, ...[...xml.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => Number(m[1]))) + 1;
  for (const g of groups) {
    if (g.ids.length < 2) continue;
    const hits = g.ids.map((id) => unitAt(xml, id.startsWith("group:") ? id.slice(6) : `syn-el-${id}`));
    if (hits.some((h) => !h)) continue;
    const units = (hits as { start: number; end: number; text: string }[]).sort((a, b) => a.start - b.start);
    // members must sit next to each other in the shape tree
    if (units.some((h, i) => i > 0 && xml.slice(units[i - 1].end, h.start).trim() !== "")) continue;
    const boxes = units.map((h) => {
      const off = /<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>/.exec(h.text);
      const ext = /<a:ext cx="(\d+)" cy="(\d+)"\s*\/>/.exec(h.text);
      return off && ext ? { x: +off[1], y: +off[2], r: +off[1] + +ext[1], b: +off[2] + +ext[2] } : null;
    });
    if (boxes.some((b) => !b)) continue;
    const x = Math.min(...boxes.map((b) => b!.x));
    const y = Math.min(...boxes.map((b) => b!.y));
    const cx = Math.max(...boxes.map((b) => b!.r)) - x;
    const cy = Math.max(...boxes.map((b) => b!.b)) - y;
    const xfrm = `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/><a:chOff x="${x}" y="${y}"/><a:chExt cx="${cx}" cy="${cy}"/></a:xfrm>`;
    const head = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${nextId++}" name="${g.name}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>${xfrm}</p:grpSpPr>`;
    const first = units[0].start;
    const last = units[units.length - 1].end;
    xml = xml.slice(0, first) + head + xml.slice(first, last) + "</p:grpSp>" + xml.slice(last);
  }
  return xml;
}
