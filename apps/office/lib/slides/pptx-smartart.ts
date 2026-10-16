// SmartArt in .pptx: a diagram is written as PowerPoint's own graphic (a
// graphic frame pointing at a data model, a layout definition, a quick style,
// colours and a pre-drawn drawing part) so PowerPoint lays it out again from
// its outline and its Text Pane edits the same items.
//
// Our own diagrams name PowerPoint's built-in layouts (process1, cycle2,
// hierarchy1, vList5, pyramid1) and carry a layout definition of our own for
// each, written from the ECMA-376 diagram schema (Part 1, 21.4); a graphic
// that came from another application keeps the layout, style and colour
// parts it came with. The drawing part is our drawing of the diagram, which
// applications that do not lay out SmartArt themselves show instead.
import type { Diagram } from "./model";

export const DGM = "http://schemas.openxmlformats.org/drawingml/2006/diagram";
export const DSP = "http://schemas.microsoft.com/office/drawing/2008/diagram";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const OA = "urn:microsoft.com/office/officeart/2005/8";

export const LAYOUT_ID: Record<Diagram["kind"], string> = {
  process: `${OA}/layout/process1`,
  cycle: `${OA}/layout/cycle2`,
  hierarchy: `${OA}/layout/hierarchy1`,
  list: `${OA}/layout/vList5`,
  pyramid: `${OA}/layout/pyramid1`,
};
const CAT: Record<Diagram["kind"], string> = { process: "process", cycle: "cycle", hierarchy: "hierarchy", list: "list", pyramid: "pyramid" };
export const QS_ID = `${OA}/quickstyle/simple1`;
export const CS_ID = `${OA}/colors/accent1_2`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const hex = (n: number, w: number) => n.toString(16).toUpperCase().padStart(w, "0");
/** Stable model ids: {xxxxxxxx-0000-4000-8000-xxxxxxxxxxxx} from a seed and a counter. */
export function modelId(seed: number, k: number): string {
  return `{${hex((seed + k * 2654435761) >>> 0, 8)}-${hex(k & 0xffff, 4)}-4000-8000-${hex(k, 12)}}`;
}

const SAMPLE = (n: number) => {
  const pts = [`<dgm:pt modelId="0" type="doc"/>`, ...Array.from({ length: n }, (_, i) => `<dgm:pt modelId="${i + 1}"><dgm:prSet phldr="1"/></dgm:pt>`)].join("");
  const cxn = Array.from({ length: n }, (_, i) => `<dgm:cxn modelId="${n + i + 1}" srcId="0" destId="${i + 1}" srcOrd="${i}" destOrd="0"/>`).join("");
  return `<dgm:sampData><dgm:dataModel><dgm:ptLst>${pts}</dgm:ptLst><dgm:cxnLst>${cxn}</dgm:cxnLst><dgm:bg/><dgm:whole/></dgm:dataModel></dgm:sampData>`;
};
const MARGINS = `<dgm:constr type="tMarg" refType="primFontSz" refFor="self" fact="0.3"/><dgm:constr type="bMarg" refType="primFontSz" refFor="self" fact="0.3"/><dgm:constr type="lMarg" refType="primFontSz" refFor="self" fact="0.3"/><dgm:constr type="rMarg" refType="primFontSz" refFor="self" fact="0.3"/>`;
const SHRINK = `<dgm:ruleLst><dgm:rule type="primFontSz" val="5" fact="NaN" max="NaN"/></dgm:ruleLst>`;
/** A text node: a shape of `geom` showing its point (and, with `deep`, the points below it as bullets). */
const textNode = (name: string, geom: string, deep: boolean, style = "node1") =>
  `<dgm:layoutNode name="${name}" styleLbl="${style}"><dgm:varLst><dgm:bulletEnabled val="1"/></dgm:varLst><dgm:alg type="tx"/><dgm:shape type="${geom}" r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf axis="${deep ? "desOrSelf" : "self"}" ptType="node"/><dgm:constrLst>${MARGINS}</dgm:constrLst>${SHRINK}</dgm:layoutNode>`;
/** The arrow between two siblings. */
const sibArrow = (name: string) =>
  `<dgm:forEach name="${name}Each" axis="followSib" ptType="sibTrans" cnt="1"><dgm:layoutNode name="${name}" styleLbl="sibTrans2D1"><dgm:alg type="conn"/><dgm:shape type="conn" r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf axis="self"/><dgm:constrLst><dgm:constr type="h" refType="w" fact="0.62"/><dgm:constr type="connDist"/><dgm:constr type="begPad" refType="connDist" fact="0.25"/><dgm:constr type="endPad" refType="connDist" fact="0.22"/></dgm:constrLst><dgm:ruleLst/></dgm:layoutNode></dgm:forEach>`;

function layoutBody(kind: Diagram["kind"]): string {
  if (kind === "process")
    return `<dgm:layoutNode name="Name0"><dgm:varLst><dgm:dir/><dgm:resizeHandles val="exact"/></dgm:varLst><dgm:alg type="lin"/><dgm:shape r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf/><dgm:constrLst><dgm:constr type="w" for="ch" forName="node" refType="w"/><dgm:constr type="h" for="ch" forName="node" refType="w" refFor="ch" refForName="node" fact="0.6"/><dgm:constr type="w" for="ch" forName="sibTrans" refType="w" refFor="ch" refForName="node" fact="0.2"/><dgm:constr type="primFontSz" for="ch" forName="node" op="equ" val="65"/></dgm:constrLst><dgm:ruleLst/><dgm:forEach name="Name1" axis="ch" ptType="node">${textNode("node", "roundRect", true)}${sibArrow("sibTrans")}</dgm:forEach></dgm:layoutNode>`;
  if (kind === "cycle")
    return `<dgm:layoutNode name="cycle"><dgm:varLst><dgm:dir/><dgm:resizeHandles val="exact"/></dgm:varLst><dgm:alg type="cycle"><dgm:param type="stAng" val="0"/><dgm:param type="spanAng" val="360"/></dgm:alg><dgm:shape r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf/><dgm:constrLst><dgm:constr type="w" for="ch" forName="node" refType="w"/><dgm:constr type="h" for="ch" forName="node" refType="w" refFor="ch" refForName="node"/><dgm:constr type="w" for="ch" forName="sibTrans" refType="w" refFor="ch" refForName="node" fact="0.25"/><dgm:constr type="sp" refType="w" refFor="ch" refForName="node" fact="0.4"/><dgm:constr type="primFontSz" for="ch" forName="node" op="equ" val="65"/></dgm:constrLst><dgm:ruleLst/><dgm:forEach name="nodes" axis="ch" ptType="node">${textNode("node", "ellipse", false)}${sibArrow("sibTrans")}</dgm:forEach></dgm:layoutNode>`;
  if (kind === "pyramid")
    return `<dgm:layoutNode name="pyramid"><dgm:varLst><dgm:dir/><dgm:animLvl val="lvl"/><dgm:resizeHandles val="exact"/></dgm:varLst><dgm:alg type="pyra"><dgm:param type="linDir" val="fromT"/><dgm:param type="txDir" val="fromT"/></dgm:alg><dgm:shape r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf/><dgm:constrLst><dgm:constr type="w" for="ch" forName="level" refType="w"/><dgm:constr type="h" for="ch" forName="level" refType="h"/><dgm:constr type="primFontSz" for="des" forName="levelText" op="equ" val="65"/></dgm:constrLst><dgm:ruleLst/><dgm:forEach name="Name1" axis="ch" ptType="node"><dgm:layoutNode name="level"><dgm:alg type="tx"/><dgm:shape type="trapezoid" r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf axis="desOrSelf" ptType="node"/><dgm:constrLst>${MARGINS}</dgm:constrLst>${SHRINK}</dgm:layoutNode></dgm:forEach></dgm:layoutNode>`;
  if (kind === "list")
    // a block for each item with its sub-items beside it
    return `<dgm:layoutNode name="Name0"><dgm:varLst><dgm:dir/><dgm:animLvl val="lvl"/><dgm:resizeHandles val="exact"/></dgm:varLst><dgm:alg type="lin"><dgm:param type="linDir" val="fromT"/><dgm:param type="nodeVertAlign" val="t"/></dgm:alg><dgm:shape r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf/><dgm:constrLst><dgm:constr type="w" for="ch" forName="row" refType="w"/><dgm:constr type="h" for="ch" forName="row" refType="w" fact="0.25"/><dgm:constr type="h" for="ch" forName="space" refType="h" refFor="ch" refForName="row" fact="0.05"/><dgm:constr type="primFontSz" for="des" forName="head" op="equ" val="65"/><dgm:constr type="primFontSz" for="des" forName="details" op="equ" val="65"/></dgm:constrLst><dgm:ruleLst/><dgm:forEach name="rows" axis="ch" ptType="node"><dgm:layoutNode name="row"><dgm:alg type="lin"><dgm:param type="linDir" val="fromL"/></dgm:alg><dgm:shape r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf/><dgm:constrLst><dgm:constr type="w" for="ch" forName="head" refType="w" fact="0.3"/><dgm:constr type="h" for="ch" forName="head" refType="h"/><dgm:constr type="w" for="ch" forName="details" refType="w" fact="0.7"/><dgm:constr type="h" for="ch" forName="details" refType="h" fact="0.8"/></dgm:constrLst><dgm:ruleLst/>${textNode("head", "roundRect", false)}<dgm:layoutNode name="details" styleLbl="alignAccFollowNode1"><dgm:varLst><dgm:bulletEnabled val="1"/></dgm:varLst><dgm:alg type="tx"><dgm:param type="parTxLTRAlign" val="l"/><dgm:param type="parTxRTLAlign" val="r"/></dgm:alg><dgm:shape type="rect" r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf axis="des" ptType="node"/><dgm:constrLst>${MARGINS}</dgm:constrLst>${SHRINK}</dgm:layoutNode></dgm:layoutNode><dgm:forEach name="gap" axis="followSib" ptType="sibTrans" cnt="1"><dgm:layoutNode name="space"><dgm:alg type="sp"/><dgm:shape r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf/><dgm:constrLst/><dgm:ruleLst/></dgm:layoutNode></dgm:forEach></dgm:forEach></dgm:layoutNode>`;
  // hierarchy: each node above its children, joined by elbow connectors
  return `<dgm:layoutNode name="hierChild1"><dgm:varLst><dgm:orgChart val="1"/><dgm:chPref val="1"/><dgm:dir/><dgm:animOne val="branch"/><dgm:animLvl val="lvl"/><dgm:resizeHandles/></dgm:varLst><dgm:alg type="hierChild"/><dgm:shape r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf/><dgm:constrLst><dgm:constr type="w" for="des" forName="node" refType="w"/><dgm:constr type="h" for="des" forName="node" refType="w" refFor="des" refForName="node" fact="0.6"/><dgm:constr type="sibSp" refType="w" refFor="des" refForName="node" fact="0.2"/><dgm:constr type="sibSp" for="des" forName="hierChild2" refType="w" refFor="des" refForName="node" fact="0.2"/><dgm:constr type="primFontSz" for="des" forName="node" op="equ" val="65"/></dgm:constrLst><dgm:ruleLst/>` +
    `<dgm:forEach name="Name1" axis="ch" ptType="node"><dgm:layoutNode name="hierRoot1"><dgm:alg type="hierRoot"/><dgm:shape r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf/><dgm:constrLst/><dgm:ruleLst/>${textNode("node", "roundRect", false)}<dgm:layoutNode name="hierChild2"><dgm:alg type="hierChild"/><dgm:shape r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf/><dgm:constrLst/><dgm:ruleLst/>` +
    `<dgm:forEach name="repeat" axis="ch" ptType="node"><dgm:forEach name="Name2" axis="precedSib" ptType="parTrans" st="-1" cnt="1"><dgm:layoutNode name="conn" styleLbl="parChTrans1D2"><dgm:alg type="conn"><dgm:param type="dim" val="1D"/><dgm:param type="endSty" val="noArr"/><dgm:param type="connRout" val="bend"/><dgm:param type="begPts" val="bCtr"/><dgm:param type="endPts" val="tCtr"/></dgm:alg><dgm:shape type="conn" r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf axis="self"/><dgm:constrLst><dgm:constr type="begPad"/><dgm:constr type="endPad"/></dgm:constrLst><dgm:ruleLst/></dgm:layoutNode></dgm:forEach>` +
    `<dgm:layoutNode name="hierRoot2"><dgm:alg type="hierRoot"/><dgm:shape r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf/><dgm:constrLst/><dgm:ruleLst/>${textNode("node", "roundRect", false, "node2")}<dgm:layoutNode name="hierChild3"><dgm:alg type="hierChild"/><dgm:shape r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf/><dgm:constrLst/><dgm:ruleLst/><dgm:forEach name="Name3" ref="repeat"/></dgm:layoutNode></dgm:layoutNode></dgm:forEach></dgm:layoutNode></dgm:layoutNode></dgm:forEach></dgm:layoutNode>`;
}

/** Our layout definition for a kind of diagram (see the note at the top). */
export function layoutDefXml(kind: Diagram["kind"]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<dgm:layoutDef xmlns:dgm="${DGM}" xmlns:a="${A}" xmlns:r="${R}" uniqueId="${LAYOUT_ID[kind]}"><dgm:title val=""/><dgm:desc val=""/><dgm:catLst><dgm:cat type="${CAT[kind]}" pri="1000"/></dgm:catLst>${SAMPLE(3)}${layoutBody(kind)}</dgm:layoutDef>`;
}

const LABELS = ["node0", "node1", "lnNode1", "vennNode1", "alignNode1", "node2", "node3", "node4", "fgImgPlace1", "alignImgPlace1", "bgImgPlace1", "sibTrans2D1", "fgSibTrans2D1", "bgSibTrans2D1", "sibTrans1D1", "callout", "asst0", "asst1", "asst2", "asst3", "asst4", "parChTrans2D1", "parChTrans2D2", "parChTrans2D3", "parChTrans2D4", "parChTrans1D1", "parChTrans1D2", "parChTrans1D3", "parChTrans1D4", "fgAcc1", "conFgAcc1", "alignAcc1", "trAlignAcc1", "bgAcc1", "solidFgAcc1", "solidAlignAcc1", "solidBgAcc1", "fgAccFollowNode1", "alignAccFollowNode1", "bgAccFollowNode1", "fgAcc0", "fgAcc2", "fgAcc3", "fgAcc4", "bgShp", "dkBgShp", "trBgShp", "fgShp", "revTx"];
const isLine = (l: string) => /1D|^revTx$/.test(l);
const isAcc = (l: string) => /Acc|Follow|bgShp|fgShp/i.test(l);

/** A plain quick style: theme line, fill and effect references for every label. */
export function styleDefXml(): string {
  const lbl = (n: string) =>
    `<dgm:styleLbl name="${n}"><dgm:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></dgm:scene3d><dgm:sp3d/><dgm:txPr/><dgm:style><a:lnRef idx="${isLine(n) ? 1 : 2}"><a:scrgbClr r="0" g="0" b="0"/></a:lnRef><a:fillRef idx="${isLine(n) ? 0 : 1}"><a:scrgbClr r="0" g="0" b="0"/></a:fillRef><a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="${isAcc(n) ? "tx1" : "lt1"}"/></a:fontRef></dgm:style></dgm:styleLbl>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<dgm:styleDef xmlns:dgm="${DGM}" xmlns:a="${A}" uniqueId="${QS_ID}"><dgm:title val=""/><dgm:desc val=""/><dgm:catLst><dgm:cat type="simple" pri="10100"/></dgm:catLst><dgm:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></dgm:scene3d>${LABELS.map(lbl).join("")}</dgm:styleDef>`;
}

/** Accent 1 colours: filled shapes in accent 1 with light text, accents and lines tinted. */
export function colorsDefXml(): string {
  const lbl = (n: string) => {
    const acc = isAcc(n), line = isLine(n);
    const fill = line ? `<a:schemeClr val="accent1"/>` : acc ? `<a:schemeClr val="accent1"><a:alpha val="90000"/><a:tint val="40000"/></a:schemeClr>` : `<a:schemeClr val="accent1"/>`;
    const lin = line ? `<a:schemeClr val="accent1"><a:shade val="60000"/></a:schemeClr>` : `<a:schemeClr val="lt1"/>`;
    const tx = acc ? `<a:schemeClr val="dk1"/>` : `<a:schemeClr val="lt1"/>`;
    return `<dgm:styleLbl name="${n}"><dgm:fillClrLst meth="repeat">${fill}</dgm:fillClrLst><dgm:linClrLst meth="repeat">${lin}</dgm:linClrLst><dgm:effectClrLst/><dgm:txLinClrLst/><dgm:txFillClrLst meth="repeat">${tx}</dgm:txFillClrLst><dgm:txEffectClrLst/></dgm:styleLbl>`;
  };
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<dgm:colorsDef xmlns:dgm="${DGM}" xmlns:a="${A}" uniqueId="${CS_ID}"><dgm:title val=""/><dgm:desc val=""/><dgm:catLst><dgm:cat type="accent1" pri="11200"/></dgm:catLst>${LABELS.map(lbl).join("")}</dgm:colorsDef>`;
}

const text = (t: string) => `<dgm:t><a:bodyPr/><a:lstStyle/><a:p>${t ? `<a:r><a:rPr lang="en-US" dirty="0"/><a:t>${esc(t)}</a:t></a:r>` : `<a:endParaRPr lang="en-US"/>`}</a:p></dgm:t>`;

/**
 * The data model of an outline: a document point, one node per item, and
 * a parent-of connection (with its parent and sibling transition points) from
 * each item to its parent. Returns the XML and each item's model id.
 */
export function dataModelXml(d: Diagram, seed: number, drawingRel?: string, loId = LAYOUT_ID[d.kind]): { xml: string; ids: string[] } {
  let k = 0;
  const id = () => modelId(seed, ++k);
  const doc = id();
  const ids = d.items.map(() => id());
  const pts: string[] = [
    `<dgm:pt modelId="${doc}" type="doc"><dgm:prSet loTypeId="${esc(loId)}" loCatId="${CAT[d.kind]}" qsTypeId="${QS_ID}" qsCatId="simple" csTypeId="${CS_ID}" csCatId="accent1" phldr="1"/><dgm:spPr/>${text("")}</dgm:pt>`,
  ];
  const cxns: string[] = [];
  const stack: { level: number; id: string }[] = [];
  const ordOf = new Map<string, number>();
  d.items.forEach((it, i) => {
    while (stack.length && stack[stack.length - 1].level >= it.level) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].id : doc;
    stack.push({ level: it.level, id: ids[i] });
    const ord = ordOf.get(parent) || 0;
    ordOf.set(parent, ord + 1);
    const cx = id(), par = id(), sib = id();
    pts.push(`<dgm:pt modelId="${ids[i]}"><dgm:prSet phldrT="[Text]"/><dgm:spPr/>${text(it.text)}</dgm:pt>`);
    pts.push(`<dgm:pt modelId="${par}" type="parTrans" cxnId="${cx}"><dgm:prSet/><dgm:spPr/>${text("")}</dgm:pt>`);
    pts.push(`<dgm:pt modelId="${sib}" type="sibTrans" cxnId="${cx}"><dgm:prSet/><dgm:spPr/>${text("")}</dgm:pt>`);
    cxns.push(`<dgm:cxn modelId="${cx}" srcId="${parent}" destId="${ids[i]}" srcOrd="${ord}" destOrd="0" parTransId="${par}" sibTransId="${sib}"/>`);
  });
  const ext = drawingRel ? `<dgm:extLst><a:ext uri="http://schemas.microsoft.com/office/drawing/2008/diagram"><dsp:dataModelExt xmlns:dsp="${DSP}" relId="${drawingRel}" minVer="http://schemas.openxmlformats.org/drawingml/2006/diagram"/></a:ext></dgm:extLst>` : "";
  return { xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<dgm:dataModel xmlns:dgm="${DGM}" xmlns:a="${A}"><dgm:ptLst>${pts.join("")}</dgm:ptLst><dgm:cxnLst>${cxns.join("")}</dgm:cxnLst><dgm:bg/><dgm:whole/>${ext}</dgm:dataModel>`, ids };
}

/** Same outline shape (levels) as when read: the original data part can be kept with new texts. */
export const sameShape = (a: Diagram["items"], b: Diagram["items"]) => a.length === b.length && a.every((x, i) => x.level === b[i].level);

/**
 * The data part a graphic came with, its node texts replaced by the current
 * items (by model id) and its drawing relationship pointed at `drawingRel`.
 */
export function patchDataTexts(xml: string, ids: string[], items: Diagram["items"], drawingRel?: string): string {
  let out = xml;
  ids.forEach((id, i) => {
    const t = items[i]?.text;
    if (t === undefined) return;
    const re = new RegExp(`(<(\\w+:)?pt\\b[^>]*modelId="${id.replace(/[{}]/g, "\\$&")}"[^>]*>[\\s\\S]*?<(?:\\w+:)?t>)([\\s\\S]*?)(</(?:\\w+:)?t>)`);
    out = out.replace(re, (_m, head: string, _pre: string | undefined, body: string, tail: string) => {
      // keep the body properties and list style, one paragraph with the first run's properties
      const bodyPr = /<a:bodyPr\b[^>]*\/>|<a:bodyPr\b[\s\S]*?<\/a:bodyPr>/.exec(body)?.[0] || "<a:bodyPr/>";
      const lst = /<a:lstStyle\/>|<a:lstStyle>[\s\S]*?<\/a:lstStyle>/.exec(body)?.[0] || "<a:lstStyle/>";
      const rPr = /<a:rPr\b[^>]*\/>|<a:rPr\b[\s\S]*?<\/a:rPr>/.exec(body)?.[0] || '<a:rPr lang="en-US"/>';
      return `${head}${bodyPr}${lst}<a:p><a:r>${rPr}<a:t>${esc(t)}</a:t></a:r></a:p>${tail}`;
    });
  });
  if (drawingRel) out = out.replace(/(<(?:\w+:)?dataModelExt\b[^>]*\brelId=")[^"]*(")/, `$1${drawingRel}$2`);
  return out;
}

/**
 * The drawing part from our shapes (p:sp XML as the slide has them): each
 * becomes a dsp:sp at its place inside the frame, tied to the point it shows.
 */
export function drawingXml(shapes: { xml: string; modelId: string }[], frame: { x: number; y: number }): string {
  const sps = shapes.map(({ xml, modelId: mid }) => {
    // the shape keeps its name (ours: syn-el-<id>, so a round trip keeps the object ids)
    const name = /<p:cNvPr [^>]*name="([^"]*)"/.exec(xml)?.[1] || "";
    let x = xml
      .replace(/<p:nvSpPr>[\s\S]*?<\/p:nvSpPr>/, `<dsp:nvSpPr><dsp:cNvPr id="0" name="${name}"/><dsp:cNvSpPr/></dsp:nvSpPr>`)
      .replace(/<(\/?)p:(sp|spPr|style|txBody)\b/g, "<$1dsp:$2")
      .replace(/^<dsp:sp\b[^>]*>/, `<dsp:sp modelId="${mid}">`);
    // positions relative to the graphic frame
    x = x.replace(/(<dsp:spPr\b[^>]*>\s*<a:xfrm\b[^>]*>\s*)<a:off x="(-?\d+)" y="(-?\d+)"\/>/, (_m, head: string, ox: string, oy: string) => `${head}<a:off x="${Number(ox) - frame.x}" y="${Number(oy) - frame.y}"/>`);
    return x;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<dsp:drawing xmlns:dgm="${DGM}" xmlns:dsp="${DSP}" xmlns:a="${A}"><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/>${sps.join("")}</dsp:spTree></dsp:drawing>`;
}

/** The slide's graphic frame for a diagram. */
export function diagramFrameXml(cNvPr: string, off: { x: number; y: number }, ext: { cx: number; cy: number }, rel: { dm: string; lo: string; qs: string; cs: string }): string {
  return `<p:graphicFrame><p:nvGraphicFramePr>${cNvPr}<p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${off.x}" y="${off.y}"/><a:ext cx="${ext.cx}" cy="${ext.cy}"/></p:xfrm><a:graphic><a:graphicData uri="${DGM}"><dgm:relIds xmlns:dgm="${DGM}" r:dm="${rel.dm}" r:lo="${rel.lo}" r:qs="${rel.qs}" r:cs="${rel.cs}"/></a:graphicData></a:graphic></p:graphicFrame>`;
}

/** The kind of our diagram from a layout's unique id (ours first, then PowerPoint's families). */
export function kindOfLayout(uniqueId: string): Diagram["kind"] | undefined {
  return (Object.keys(LAYOUT_ID) as Diagram["kind"][]).find((k) => LAYOUT_ID[k] === uniqueId);
}
