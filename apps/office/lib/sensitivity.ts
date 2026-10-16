// Sensitivity labels and the document's custom properties. Office records a
// Microsoft Purview label as MSIP_Label_<id>_* custom properties
// (docProps/custom.xml) and, since 2021, in docMetadata/LabelInfo.xml; both
// are read and written here, and every other custom property is kept. A
// label only marks the file: encryption or rights that a label's policy
// adds are applied by Office with the organization's keys, which a browser
// app doesn't have, so a protected (encrypted) file can't be opened here.

export const DOC_PROPS_RESOURCE = "SHEET_SYNERGY_DOC_PROPS_PLUGIN";
export const SET_DOC_PROPS_MUTATION = "sheet.mutation.set-doc-props";

export type CustomProp = { name: string; type: string; value: string };
export type SensitivityLabel = { id: string; name: string; siteId?: string; method?: "Standard" | "Privileged"; setDate?: string; actionId?: string; contentBits?: string; color?: string };
/** Review > Protect Workbook: the sheets can't be added, removed, renamed, moved, hidden or shown. */
export type WorkbookProtection = { lockStructure: boolean; password?: Record<string, string> };
export type DocProps = { custom: CustomProp[]; label?: SensitivityLabel | null; workbook?: WorkbookProtection | null };

/** The labels offered when the file doesn't bring its own: the usual Purview set. */
export const DEFAULT_LABELS: SensitivityLabel[] = [
  { id: "a8b6f1c2-0d3e-4f5a-9b6c-1d2e3f4a5b60", name: "Public", color: "#15803d" },
  { id: "b9c7a2d3-1e4f-4a6b-8c7d-2e3f4a5b6c71", name: "General", color: "#2563eb" },
  { id: "c0d8b3e4-2f5a-4b7c-9d8e-3f4a5b6c7d82", name: "Confidential", color: "#d97706" },
  { id: "d1e9c4f5-3a6b-4c8d-8e9f-4a5b6c7d8e93", name: "Highly Confidential", color: "#b91c1c" },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const attr = (tag: string, n: string) => {
  const m = new RegExp(`\\b${n}="([^"]*)"`).exec(tag);
  return m ? unesc(m[1]) : undefined;
};
const LABEL_PROP = /^MSIP_Label_([0-9a-fA-F-]{36})_(\w+)$/;
const CUSTOM_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties";
const LABEL_REL = "http://schemas.microsoft.com/office/2020/02/relationships/classificationlabels";
const CUSTOM_TYPE = "application/vnd.openxmlformats-officedocument.custom-properties+xml";
const LABEL_TYPE = "application/vnd.ms-office.classificationlabels+xml";
const FMTID = "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}";

export function readCustomProps(xml: string): CustomProp[] {
  const out: CustomProp[] = [];
  for (const m of xml.matchAll(/<property\b([^>]*)>([\s\S]*?)<\/property>/g)) {
    const name = attr(m[1], "name");
    const v = /<vt:(\w+)>([\s\S]*?)<\/vt:\1>|<vt:(\w+)\/>/.exec(m[2]);
    if (!name || !v) continue;
    out.push({ name, type: v[1] || v[3], value: unesc(v[2] || "") });
  }
  return out;
}

/** The label of a file, from LabelInfo.xml or else the MSIP custom properties. */
export function labelOf(custom: CustomProp[], labelInfoXml = ""): SensitivityLabel | null {
  const byId = new Map<string, Record<string, string>>();
  for (const p of custom) {
    const m = LABEL_PROP.exec(p.name);
    if (m) (byId.get(m[1]) || byId.set(m[1], {}).get(m[1])!)[m[2]] = p.value;
  }
  const info = /<clbl:label\b[^>]*>/.exec(labelInfoXml)?.[0];
  if (info && attr(info, "enabled") !== "0" && attr(info, "removed") !== "1") {
    const id = (attr(info, "id") || "").replace(/[{}]/g, "");
    const p = byId.get(id) || {};
    return { id, name: p.Name || "Label", ...(attr(info, "siteId") ? { siteId: attr(info, "siteId")!.replace(/[{}]/g, "") } : {}), method: (attr(info, "method") as SensitivityLabel["method"]) || "Standard", ...(p.SetDate ? { setDate: p.SetDate } : {}), ...(p.ActionId ? { actionId: p.ActionId } : {}), ...(attr(info, "contentBits") ? { contentBits: attr(info, "contentBits") } : {}) };
  }
  for (const [id, p] of byId) {
    if (p.Enabled !== "true" && p.Enabled !== "True") continue;
    return { id, name: p.Name || "Label", ...(p.SiteId ? { siteId: p.SiteId } : {}), method: (p.Method as SensitivityLabel["method"]) || "Standard", ...(p.SetDate ? { setDate: p.SetDate } : {}), ...(p.ActionId ? { actionId: p.ActionId } : {}), ...(p.ContentBits ? { contentBits: p.ContentBits } : {}) };
  }
  return null;
}

export function customPropsXml(props: CustomProp[]): string {
  const body = props
    .map((p, i) => `<property fmtid="${FMTID}" pid="${i + 2}" name="${esc(p.name)}"><vt:${p.type}>${esc(p.value)}</vt:${p.type}></property>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${body}</Properties>`;
}

/** The custom properties with the label's MSIP_Label_* ones replaced. */
export function withLabel(custom: CustomProp[], label: SensitivityLabel | null | undefined): CustomProp[] {
  const rest = custom.filter((p) => !LABEL_PROP.test(p.name));
  if (!label) return rest;
  const k = (s: string) => `MSIP_Label_${label.id}_${s}`;
  const s = (name: string, value: string): CustomProp => ({ name: k(name), type: "lpwstr", value });
  return [
    ...rest,
    s("Enabled", "true"),
    s("SetDate", label.setDate || new Date().toISOString().replace(/\.\d+Z$/, "Z")),
    s("Method", label.method || "Standard"),
    s("Name", label.name),
    s("SiteId", label.siteId || "00000000-0000-0000-0000-000000000000"),
    s("ActionId", label.actionId || "00000000-0000-0000-0000-000000000000"),
    s("ContentBits", label.contentBits || "0"),
  ];
}

export const labelInfoXml = (label: SensitivityLabel) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<clbl:labelList xmlns:clbl="http://schemas.microsoft.com/office/2020/mipLabelMetadata"><clbl:label id="{${label.id}}" enabled="1" method="${label.method || "Standard"}" siteId="{${label.siteId || "00000000-0000-0000-0000-000000000000"}}" contentBits="${label.contentBits || "0"}" removed="0"/></clbl:labelList>`;

type Zip = { file: { (path: string): { async(t: "string"): Promise<string> } | null; (path: string, data: string): unknown }; remove(path: string): unknown };

/** Reads the custom properties and label of a package; null when it has neither. */
export async function readDocProps(read: (p: string) => Promise<string>): Promise<DocProps | null> {
  const rels = await read("_rels/.rels");
  const target = (type: string) => {
    const tag = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((t) => attr(t, "Type") === type);
    return tag ? (attr(tag, "Target") || "").replace(/^\//, "") : "";
  };
  const customPath = target(CUSTOM_REL) || "docProps/custom.xml";
  const labelPath = target(LABEL_REL);
  const custom = readCustomProps(await read(customPath));
  const label = labelOf(custom, labelPath ? await read(labelPath) : "");
  if (!custom.length && !label) return null;
  return { custom: custom.filter((p) => !LABEL_PROP.test(p.name)), ...(label ? { label } : {}) };
}

/** Writes custom.xml (and LabelInfo.xml for a label) with their relationships and content types. */
export async function writeDocProps(zip: Zip, props: DocProps): Promise<void> {
  const custom = withLabel(props.custom || [], props.label);
  let rels = (await zip.file("_rels/.rels")?.async("string")) || `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  let types = (await zip.file("[Content_Types].xml")?.async("string")) || "";
  const ids = [...rels.matchAll(/\bId="([^"]+)"/g)].map((m) => m[1]);
  const freshId = () => {
    let n = ids.length + 1;
    while (ids.includes(`rId${n}`)) n++;
    ids.push(`rId${n}`);
    return `rId${n}`;
  };
  const ensure = (type: string, target: string, contentType: string) => {
    if (![...rels.matchAll(/<Relationship\b[^>]*>/g)].some((m) => attr(m[0], "Type") === type)) rels = rels.replace("</Relationships>", `<Relationship Id="${freshId()}" Type="${type}" Target="${target}"/></Relationships>`);
    if (!types.includes(`PartName="/${target}"`)) types = types.replace("</Types>", `<Override PartName="/${target}" ContentType="${contentType}"/></Types>`);
  };
  const drop = (type: string, target: string) => {
    rels = rels.replace(new RegExp(`<Relationship\\b[^>]*Type="${type.replace(/[.]/g, "\\.")}"[^>]*/>`, "g"), "");
    types = types.replace(new RegExp(`<Override PartName="/${target.replace(/[.]/g, "\\.")}"[^>]*/>`, "g"), "");
    zip.remove(target);
  };
  if (custom.length) {
    zip.file("docProps/custom.xml", customPropsXml(custom));
    ensure(CUSTOM_REL, "docProps/custom.xml", CUSTOM_TYPE);
  } else drop(CUSTOM_REL, "docProps/custom.xml");
  if (props.label) {
    zip.file("docMetadata/LabelInfo.xml", labelInfoXml(props.label));
    ensure(LABEL_REL, "docMetadata/LabelInfo.xml", LABEL_TYPE);
  } else drop(LABEL_REL, "docMetadata/LabelInfo.xml");
  zip.file("_rels/.rels", rels);
  if (types) zip.file("[Content_Types].xml", types);
}
