// Equations in exported slides. PptxGenJS writes an equation as a plain text
// box (named syn-el-<id>); here it becomes PowerPoint's equation markup: an
// mc:AlternateContent whose a14 choice holds the Office Math (a14:m) and
// whose fallback keeps the plain text for older readers.
import type { MathEl } from "./model";
import { latexToOmml } from "./math";

const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const A14 = "http://schemas.microsoft.com/office/drawing/2010/main";

export function wrapMath(xml: string, els: MathEl[], textColor: string, kind: "el" | "mel" | "lel" = "el"): string {
  if (!els.length) return xml;
  const byName = new Map(els.map((e) => [`syn-${kind}-${e.id}`, e]));
  return xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (frag) => {
    const name = /<p:cNvPr id="\d+" name="([^"]*)"/.exec(frag)?.[1];
    const e = name ? byName.get(name) : undefined;
    if (!e) return frag;
    const color = /^[0-9a-f]{6}$/i.test(e.color || "") ? e.color! : textColor;
    const rPr = `<a:rPr lang="en-US" sz="${Math.round((e.size || 28) * 100)}" i="1"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Cambria Math" panose="02040503050406030204" pitchFamily="18" charset="0"/></a:rPr>`;
    const para = `<a:p><a:pPr algn="ctr"/><a14:m>${latexToOmml(e.latex, rPr)}</a14:m><a:endParaRPr lang="en-US" sz="${Math.round((e.size || 28) * 100)}"/></a:p>`;
    const choice = frag.replace(/(<p:txBody>[\s\S]*?)(<a:p>[\s\S]*<\/a:p>|<a:p\/>)/, (_, head) => head + para);
    return `<mc:AlternateContent xmlns:mc="${MC}"><mc:Choice xmlns:a14="${A14}" Requires="a14">${choice}</mc:Choice><mc:Fallback>${frag}</mc:Fallback></mc:AlternateContent>`;
  });
}
