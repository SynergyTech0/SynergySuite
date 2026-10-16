// Builds a small hand-written .pptx in memory (no binary fixture in the repo).
// It exercises the parts of OOXML real PowerPoint files rely on: slide order
// that differs from part names, placeholder geometry/style inheritance from
// layout and master, theme colours with modifiers, groups, pictures, tables,
// connectors, backgrounds, hidden slides and speaker notes.
import JSZip from "jszip";

export const PNG_RED_2x2 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==";

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rels = (items: [string, string, string][]) =>
  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
    .map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`)
    .join("")}</Relationships>`;

const xfrm = (x: number, y: number, w: number, h: number, extra = "") =>
  `<a:xfrm${extra}><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>`;
const EMU = 9525; // per px

const theme = `<?xml version="1.0" encoding="UTF-8"?><a:theme ${NS} name="Test"><a:themeElements>
<a:clrScheme name="T"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1>
<a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4>
<a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme>
<a:fontScheme name="F"><a:majorFont><a:latin typeface="Georgia"/></a:majorFont><a:minorFont><a:latin typeface="Verdana"/></a:minorFont></a:fontScheme>
<a:fmtScheme name="S"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>`;

const master = `<?xml version="1.0" encoding="UTF-8"?><p:sldMaster ${NS}><p:cSld>
<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg2"/></p:bgRef></p:bg>
<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title Placeholder"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(48 * EMU, 30 * EMU, 864 * EMU, 120 * EMU)}</p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:p><a:r><a:t>Click to edit</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body Placeholder"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(48 * EMU, 170 * EMU, 864 * EMU, 480 * EMU)}</p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Click</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="4" name="Date"/><p:cNvSpPr/><p:nvPr><p:ph type="dt" idx="10"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(0, 680 * EMU, 200 * EMU, 30 * EMU)}</p:spPr></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="5" name="Logo bar"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(0, 700 * EMU, 960 * EMU, 20 * EMU)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></p:spPr></p:sp>
</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:txStyles>
<p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>
<p:bodyStyle><a:lvl1pPr><a:buChar char="•"/><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr><a:lvl2pPr><a:buChar char="–"/><a:defRPr sz="2400"/></a:lvl2pPr></p:bodyStyle>
<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:otherStyle>
</p:txStyles></p:sldMaster>`;

const layoutContent = `<?xml version="1.0" encoding="UTF-8"?><p:sldLayout ${NS}><p:cSld name="Title and Content"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content 2"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(60 * EMU, 180 * EMU, 840 * EMU, 460 * EMU)}</p:spPr></p:sp>
</p:spTree></p:cSld></p:sldLayout>`;

const layoutTitle = `<?xml version="1.0" encoding="UTF-8"?><p:sldLayout ${NS} showMasterSp="0"><p:cSld name="Title Slide"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(72 * EMU, 220 * EMU, 816 * EMU, 150 * EMU)}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="5400"/></a:lvl1pPr></a:lstStyle><a:p/></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Subtitle 2"/><p:cNvSpPr/><p:nvPr><p:ph type="subTitle" idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(144 * EMU, 400 * EMU, 672 * EMU, 120 * EMU)}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr algn="ctr"><a:buNone/><a:defRPr sz="2400"/></a:lvl1pPr></a:lstStyle><a:p/></p:txBody></p:sp>
</p:spTree></p:cSld></p:sldLayout>`;

const spTree = (inner: string) =>
  `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${inner}</p:spTree></p:cSld>`;

const slideTitle = `<?xml version="1.0" encoding="UTF-8"?><p:sld ${NS}>${spTree(`
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>Hello Deck</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Subtitle 2"/><p:cNvSpPr/><p:nvPr><p:ph type="subTitle" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>A &amp; B subtitle</a:t></a:r></a:p></p:txBody></p:sp>`)}</p:sld>`;

// PowerPoint-style transition (p14 inside AlternateContent) and an animation
// sequence: body by paragraph on click, text box flies in from the left after
// it, then the group fades in on the next click with a delay.
const effect = (id: number, preset: number, sub: number, node: string, spid: number, extra = "", delay = 0, dur = 500) =>
  `<p:par><p:cTn id="${id}" presetID="${preset}" presetClass="entr" presetSubtype="${sub}" fill="hold" nodeType="${node}"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst><p:childTnLst>` +
  `<p:set><p:cBhvr><p:cTn id="${id + 100}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${spid}">${extra}</p:spTgt></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>` +
  `<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="${id + 200}" dur="${dur}"/><p:tgtEl><p:spTgt spid="${spid}">${extra}</p:spTgt></p:tgtEl></p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par>`;
const click = (id: number, inner: string) => `<p:par><p:cTn id="${id}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>${inner}</p:childTnLst></p:cTn></p:par>`;
const group = (id: number, delay: number, inner: string) => `<p:par><p:cTn id="${id}" fill="hold"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst><p:childTnLst>${inner}</p:childTnLst></p:cTn></p:par>`;
const CONTENT_TIMING =
  `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" Requires="p14"><p:transition spd="slow" p14:dur="1200" advTm="4000"><p:push dir="u"/></p:transition></mc:Choice><mc:Fallback><p:transition spd="slow" advTm="4000"><p:push dir="u"/></p:transition></mc:Fallback></mc:AlternateContent>` +
  `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>` +
  click(3, group(4, 0, effect(5, 10, 0, "clickEffect", 3, '<p:txEl><p:pRg st="0" end="0"/></p:txEl>')) + group(6, 500, effect(7, 2, 8, "afterEffect", 4, "", 0, 800))) +
  click(8, group(9, 0, effect(10, 10, 0, "clickEffect", 3, '<p:txEl><p:pRg st="1" end="1"/></p:txEl>'))) +
  click(11, group(12, 0, effect(13, 10, 0, "clickEffect", 7, "", 250))) +
  click(14, group(15, 0, `<p:par><p:cTn id="16" presetID="10" presetClass="exit" presetSubtype="0" fill="hold" nodeType="clickEffect"><p:childTnLst/></p:cTn></p:par>`)) +
  `</p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;

const slideContent = `<?xml version="1.0" encoding="UTF-8"?><p:sld ${NS}><p:cSld>
<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFEEDD"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>Agenda</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content 2"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr><a:normAutofit fontScale="50000"/></a:bodyPr>
<a:p><a:r><a:rPr b="1"/><a:t>First</a:t></a:r><a:r><a:t> point</a:t></a:r></a:p>
<a:p><a:pPr lvl="1"/><a:r><a:rPr i="1"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr><a:t>Nested</a:t></a:r></a:p>
<a:p><a:pPr algn="ctr"><a:buNone/></a:pPr><a:r><a:rPr u="sng" sz="3200"><a:solidFill><a:schemeClr val="accent1"><a:lumMod val="75000"/></a:schemeClr></a:solidFill></a:rPr><a:t>Plain centred</a:t></a:r><a:br/><a:r><a:t>second line</a:t></a:r></a:p>
<a:p><a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:rPr strike="sngStrike"/><a:t>Step one</a:t></a:r></a:p>
<a:p><a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:rPr><a:latin typeface="Courier New"/></a:rPr><a:t>Step two</a:t></a:r></a:p>
</p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="4" name="TextBox 3"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(500 * EMU, 600 * EMU, 300 * EMU, 50 * EMU)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr anchor="b"/><a:p><a:r><a:t>Free text</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="5" name="Oval 4"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(100 * EMU, 100 * EMU, 80 * EMU, 60 * EMU, ' rot="5400000" flipH="1"')}<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:p><a:r><a:t>In shape</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="6" name="Styled"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(10 * EMU, 10 * EMU, 20 * EMU, 20 * EMU)}<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom></p:spPr><p:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent3"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style></p:sp>
<p:grpSp><p:nvGrpSpPr><p:cNvPr id="7" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${200 * EMU}" y="${300 * EMU}"/><a:ext cx="${200 * EMU}" cy="${100 * EMU}"/><a:chOff x="0" y="0"/><a:chExt cx="${100 * EMU}" cy="${50 * EMU}"/></a:xfrm></p:grpSpPr>
<p:sp><p:nvSpPr><p:cNvPr id="8" name="Inner"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(50 * EMU, 25 * EMU, 50 * EMU, 25 * EMU)}<a:prstGeom prst="triangle"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></p:spPr></p:sp>
</p:grpSp>
<p:pic><p:nvPicPr><p:cNvPr id="9" name="Picture" descr="A red square"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId3"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(700 * EMU, 100 * EMU, 100 * EMU, 100 * EMU)}<a:prstGeom prst="rect"/></p:spPr></p:pic>
<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="10" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${100 * EMU}" y="${450 * EMU}"/><a:ext cx="${300 * EMU}" cy="${80 * EMU}"/></p:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid><a:gridCol w="${150 * EMU}"/><a:gridCol w="${150 * EMU}"/></a:tblGrid>
<a:tr h="${40 * EMU}"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Name</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Score</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
<a:tr h="${40 * EMU}"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1400"/><a:t>Ada</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="FFFF00"/></a:solidFill></a:tcPr></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:pPr algn="r"/><a:r><a:t>10</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
</a:tbl></a:graphicData></a:graphic></p:graphicFrame>
<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="11" name="Line"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(10 * EMU, 690 * EMU, 300 * EMU, 0)}<a:prstGeom prst="line"/><a:ln w="28575"><a:solidFill><a:srgbClr val="333333"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></p:spPr></p:cxnSp>
</p:spTree></p:cSld>${CONTENT_TIMING}</p:sld>`;

const slideHidden = `<?xml version="1.0" encoding="UTF-8"?><p:sld ${NS} show="0">${spTree(`
<p:sp><p:nvSpPr><p:cNvPr id="2" name="TextBox"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(100 * EMU, 100 * EMU, 400 * EMU, 100 * EMU)}</p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Only a text box</a:t></a:r></a:p></p:txBody></p:sp>`)}</p:sld>`;

const notes = `<?xml version="1.0" encoding="UTF-8"?><p:notes ${NS}>${spTree(`
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>Say hello</a:t></a:r><a:br/><a:r><a:t>then pause</a:t></a:r></a:p><a:p><a:r><a:t>Second para</a:t></a:r></a:p></p:txBody></p:sp>`)}</p:notes>`;

export async function buildSyntheticPptx(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`);
  zip.file("_rels/.rels", rels([["rId1", "officeDocument", "ppt/presentation.xml"]]));
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8"?><p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/><p:sldId id="258" r:id="rId4"/></p:sldIdLst>
<p:sldSz cx="9144000" cy="6858000" type="screen4x3"/><p:notesSz cx="6858000" cy="9144000"/>
<p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:defaultTextStyle></p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    rels([
      ["rId1", "slideMaster", "slideMasters/slideMaster1.xml"],
      ["rId2", "slide", "slides/slide2.xml"],
      ["rId3", "slide", "slides/slide1.xml"],
      ["rId4", "slide", "slides/slide3.xml"],
    ]),
  );
  zip.file("ppt/theme/theme1.xml", theme);
  zip.file("ppt/slideMasters/slideMaster1.xml", master);
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    rels([
      ["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"],
      ["rId2", "slideLayout", "../slideLayouts/slideLayout2.xml"],
      ["rId3", "theme", "../theme/theme1.xml"],
    ]),
  );
  zip.file("ppt/slideLayouts/slideLayout1.xml", layoutContent);
  zip.file("ppt/slideLayouts/slideLayout2.xml", layoutTitle);
  zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", rels([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]));
  zip.file("ppt/slideLayouts/_rels/slideLayout2.xml.rels", rels([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]));
  // slide1.xml = title slide (listed second in sldIdLst order but rId3 is first)
  zip.file("ppt/slides/slide1.xml", slideTitle);
  zip.file("ppt/slides/_rels/slide1.xml.rels", rels([["rId1", "slideLayout", "../slideLayouts/slideLayout2.xml"]]));
  zip.file("ppt/slides/slide2.xml", slideContent);
  zip.file(
    "ppt/slides/_rels/slide2.xml.rels",
    rels([
      ["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"],
      ["rId2", "notesSlide", "../notesSlides/notesSlide1.xml"],
      ["rId3", "image", "../media/image1.png"],
    ]),
  );
  zip.file("ppt/slides/slide3.xml", slideHidden);
  zip.file("ppt/slides/_rels/slide3.xml.rels", rels([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"]]));
  zip.file("ppt/notesSlides/notesSlide1.xml", notes);
  zip.file("ppt/media/image1.png", PNG_RED_2x2, { base64: true });
  return zip.generateAsync({ type: "uint8array" });
}
