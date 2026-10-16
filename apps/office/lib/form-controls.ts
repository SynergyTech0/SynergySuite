// Excel's form controls (Developer > Insert > Form Controls): check boxes,
// option buttons, spin buttons, scroll bars, combo and list boxes, buttons,
// labels and group boxes, each optionally linked to a cell. Over the grid
// they are floating drawings that work (a check box sets its cell TRUE or
// FALSE, a spin button steps it, a combo box writes the chosen item's
// number). In .xlsx they are VML shapes with x:ClientData, the form every
// Excel version reads (Excel 2010 and later also write ctrlProp parts, which
// are read here when present). A button's macro is kept but never run.

export const FORM_CONTROL_COMPONENT = "SynergyFormControl";

export type FormControlKind = "checkbox" | "option" | "button" | "spin" | "scroll" | "combo" | "list" | "label" | "group";
export type FormControlData = {
  kind: FormControlKind;
  text: string;
  /** The linked cell, as Excel writes it ($B$2 or 'Sheet 2'!$B$2). */
  link?: string;
  /** Combo and list boxes: the range of items. */
  input?: string;
  checked?: boolean;
  /** Spin button, scroll bar, combo and list box: the current value (1-based item for lists). */
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  page?: number;
  horizontal?: boolean;
  /** A button's macro (kept for Excel; macros don't run here). */
  macro?: string;
  /** Combo box: lines shown when open. */
  dropLines?: number;
  /** Option buttons: the first of a group (the next ones share its link). */
  firstButton?: boolean;
};

export const FORM_CONTROL_LABELS: Record<FormControlKind, string> = {
  checkbox: "Check Box",
  option: "Option Button",
  button: "Button",
  spin: "Spin Button",
  scroll: "Scroll Bar",
  combo: "Combo Box",
  list: "List Box",
  label: "Label",
  group: "Group Box",
};
const TO_VML: Record<FormControlKind, string> = { checkbox: "Checkbox", option: "Radio", button: "Button", spin: "Spin", scroll: "Scroll", combo: "Drop", list: "List", label: "Label", group: "GBox" };
const FROM_VML: Record<string, FormControlKind> = Object.fromEntries(Object.entries(TO_VML).map(([k, v]) => [v.toLowerCase(), k as FormControlKind]));
const FROM_CTRL: Record<string, FormControlKind> = { checkbox: "checkbox", radio: "option", button: "button", spin: "spin", scroll: "scroll", drop: "combo", list: "list", label: "label", gbox: "group" };

export function newFormControl(kind: FormControlKind, n = 1): FormControlData {
  const base: FormControlData = { kind, text: kind === "spin" || kind === "scroll" || kind === "combo" || kind === "list" ? "" : `${FORM_CONTROL_LABELS[kind]} ${n}` };
  if (kind === "spin" || kind === "scroll") return { ...base, value: 0, min: 0, max: 100, step: 1, page: 10, ...(kind === "scroll" ? { horizontal: false } : {}) };
  if (kind === "combo" || kind === "list") return { ...base, value: 0, dropLines: 8 };
  if (kind === "checkbox") return { ...base, checked: false };
  return base;
}

/** The control's size when inserted, in pixels. */
export const defaultControlSize = (kind: FormControlKind) =>
  kind === "spin" ? { w: 24, h: 40 } : kind === "scroll" ? { w: 20, h: 100 } : kind === "list" ? { w: 120, h: 90 } : kind === "group" ? { w: 180, h: 110 } : kind === "button" ? { w: 110, h: 30 } : { w: 130, h: 22 };

/** A spin or scroll step from a value, kept within the control's range. */
export function stepValue(d: FormControlData, by: number): number {
  const min = d.min ?? 0;
  const max = d.max ?? 100;
  return Math.min(max, Math.max(min, (d.value ?? min) + by));
}

// ---- VML ----------------------------------------------------------------------

export type ControlAnchor = { from: { column: number; columnOffset: number; row: number; rowOffset: number }; to: { column: number; columnOffset: number; row: number; rowOffset: number } };
export type ReadControl = { data: FormControlData; anchor: ControlAnchor; shapeId?: number };

const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tagText = (xml: string, name: string) => {
  const m = new RegExp(`<x:${name}>([\\s\\S]*?)</x:${name}>`).exec(xml);
  return m ? unesc(m[1]).trim() : undefined;
};
const has = (xml: string, name: string) => new RegExp(`<x:${name}\\s*/>|<x:${name}>`).test(xml);
const num = (s: string | undefined) => (s != null && s !== "" && Number.isFinite(Number(s)) ? Number(s) : undefined);

/** The form controls in a VML drawing (comments and other shapes are skipped). */
export function readVmlControls(vml: string): ReadControl[] {
  const out: ReadControl[] = [];
  for (const m of vml.matchAll(/<v:shape\b([^>]*)>([\s\S]*?)<\/v:shape>/g)) {
    const body = m[2];
    const shapeId = Number(/(?:\bo:spid|\bid)="_x0000_s(\d+)"/.exec(m[1])?.[1]) || undefined;
    const type = /<x:ClientData\b[^>]*ObjectType="([^"]+)"/.exec(body)?.[1]?.toLowerCase();
    const kind = type ? FROM_VML[type] : undefined;
    if (!kind) continue;
    const a = (tagText(body, "Anchor") || "").split(",").map((x) => Number(x.trim()) || 0);
    if (a.length < 8) continue;
    // The text: the textbox's words (Excel writes <div><font>…</font></div>, with <br/> for new lines).
    const box = /<v:textbox\b[^>]*>([\s\S]*?)<\/v:textbox>/.exec(body)?.[1] || "";
    const text = unesc(box.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/\u00a0/g, " ").trim();
    const data: FormControlData = { kind, text };
    const link = tagText(body, "FmlaLink");
    if (link) data.link = link;
    const input = tagText(body, "FmlaRange");
    if (input) data.input = input;
    const macro = tagText(body, "FmlaMacro");
    if (macro) data.macro = macro;
    if (kind === "checkbox" || kind === "option") data.checked = tagText(body, "Checked") === "1";
    if (kind === "spin" || kind === "scroll") {
      data.value = num(tagText(body, "Val")) ?? 0;
      data.min = num(tagText(body, "Min")) ?? 0;
      data.max = num(tagText(body, "Max")) ?? 100;
      data.step = num(tagText(body, "Inc")) ?? 1;
      data.page = num(tagText(body, "Page")) ?? 10;
      if (kind === "scroll") data.horizontal = has(body, "Horiz");
    }
    if (kind === "combo" || kind === "list") {
      data.value = num(tagText(body, "Sel")) ?? 0;
      data.dropLines = num(tagText(body, "DropLines")) ?? 8;
    }
    if (kind === "option" && has(body, "FirstButton")) data.firstButton = true;
    out.push({ data, anchor: { from: { column: a[0], columnOffset: a[1], row: a[2], rowOffset: a[3] }, to: { column: a[4], columnOffset: a[5], row: a[6], rowOffset: a[7] } }, ...(shapeId ? { shapeId } : {}) });
  }
  return out;
}

/** Fills in a control from its ctrlProp part (Excel 2010 and later), which wins over the VML. */
export function withCtrlProp(c: FormControlData, ctrlPropXml: string): FormControlData {
  const tag = /<formControlPr\b[^>]*>/.exec(ctrlPropXml)?.[0];
  if (!tag) return c;
  const a = (n: string) => {
    const m = new RegExp(`\\b${n}="([^"]*)"`).exec(tag);
    return m ? unesc(m[1]) : undefined;
  };
  const kind = FROM_CTRL[(a("objectType") || "").toLowerCase()] || c.kind;
  const out: FormControlData = { ...c, kind };
  if (a("fmlaLink")) out.link = a("fmlaLink");
  if (a("fmlaRange")) out.input = a("fmlaRange");
  if (a("checked")) out.checked = a("checked") === "Checked";
  for (const [k, n] of [["value", "val"], ["min", "min"], ["max", "max"], ["step", "inc"], ["page", "page"], ["dropLines", "dropLines"]] as const) if (num(a(n)) != null) out[k] = num(a(n));
  if (kind === "combo" || kind === "list") if (num(a("sel")) != null) out.value = num(a("sel"));
  if (a("horiz") === "1") out.horizontal = true;
  if (a("firstButton") === "1") out.firstButton = true;
  return out;
}

export const VML_SHAPETYPE = `<v:shapetype id="_x0000_t201" coordsize="21600,21600" o:spt="201" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path shadowok="f" o:extrusionok="f" strokeok="f" fillok="f" o:connecttype="rect"/><o:lock v:ext="edit" shapetype="t"/></v:shapetype>`;

/** One control as Excel's VML shape. */
export function vmlControlXml(c: ReadControl, shapeId: number): string {
  const d = c.data;
  const { from, to } = c.anchor;
  const x: string[] = [`<x:Anchor>${from.column}, ${from.columnOffset}, ${from.row}, ${from.rowOffset}, ${to.column}, ${to.columnOffset}, ${to.row}, ${to.rowOffset}</x:Anchor>`, "<x:PrintObject>False</x:PrintObject>", "<x:AutoFill>False</x:AutoFill>"];
  if (d.kind === "checkbox" || d.kind === "option" || d.kind === "label" || d.kind === "button") x.push("<x:AutoLine>False</x:AutoLine>", "<x:TextVAlign>Center</x:TextVAlign>");
  if (d.kind === "button") x.push("<x:TextHAlign>Center</x:TextHAlign>");
  if (d.macro) x.push(`<x:FmlaMacro>${esc(d.macro)}</x:FmlaMacro>`);
  if (d.link) x.push(`<x:FmlaLink>${esc(d.link)}</x:FmlaLink>`);
  if (d.input) x.push(`<x:FmlaRange>${esc(d.input)}</x:FmlaRange>`);
  if (d.kind === "checkbox" || d.kind === "option") {
    if (d.checked) x.push("<x:Checked>1</x:Checked>");
    if (d.kind === "option" && d.firstButton) x.push("<x:FirstButton/>");
  }
  if (d.kind === "spin" || d.kind === "scroll") {
    x.push(`<x:Val>${d.value ?? 0}</x:Val>`, `<x:Min>${d.min ?? 0}</x:Min>`, `<x:Max>${d.max ?? 100}</x:Max>`, `<x:Inc>${d.step ?? 1}</x:Inc>`, `<x:Page>${d.page ?? 10}</x:Page>`);
    if (d.kind === "scroll" && d.horizontal) x.push("<x:Horiz/>");
  }
  if (d.kind === "combo" || d.kind === "list") {
    x.push(`<x:Sel>${d.value ?? 0}</x:Sel>`, "<x:SelType>Single</x:SelType>");
    if (d.kind === "combo") x.push(`<x:DropStyle>Combo</x:DropStyle>`, `<x:DropLines>${d.dropLines ?? 8}</x:DropLines>`);
  }
  if (d.kind !== "label" && d.kind !== "group" && d.kind !== "button") x.push("<x:NoThreeD/>");
  const text = d.text ? `<v:textbox style="mso-direction-alt:auto" o:singleclick="f"><div style="text-align:${d.kind === "button" ? "center" : "left"}"><font face="Segoe UI" size="160" color="auto">${esc(d.text).replace(/\n/g, "<br/>")}</font></div></v:textbox>` : "";
  const filled = d.kind === "button" ? 'fillcolor="buttonFace [67]" strokecolor="windowText [64]" o:insetmode="auto"' : 'filled="f" fillcolor="window [65]" stroked="f" strokecolor="windowText [64]" o:insetmode="auto"';
  return `<v:shape id="_x0000_s${shapeId}" type="#_x0000_t201" style="position:absolute;z-index:${shapeId - 1024};visibility:visible" ${filled}><v:path shadowok="t" strokeok="t" fillok="t"/><o:lock v:ext="edit" rotation="t"/>${text}<x:ClientData ObjectType="${TO_VML[d.kind]}">${x.join("")}</x:ClientData></v:shape>`;
}

const VML_HEAD = `<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>`;

/**
 * Adds the controls to a VML drawing (a new one when `vml` is empty), after
 * any comment shapes already there, with fresh shape ids.
 */
export function addControlsToVml(vml: string, controls: ReadControl[], idBlock = 1): string {
  let xml = vml && /<\/xml>\s*$/.test(vml) ? vml : `${VML_HEAD.replace('data="1"', `data="${idBlock}"`)}</xml>`;
  if (!/xmlns:x=/.test(xml)) xml = xml.replace(/<xml\b/, '<xml xmlns:x="urn:schemas-microsoft-com:office:excel"');
  if (!/xmlns:o=/.test(xml)) xml = xml.replace(/<xml\b/, '<xml xmlns:o="urn:schemas-microsoft-com:office:office"');
  if (!xml.includes('id="_x0000_t201"')) xml = xml.replace(/<\/xml>\s*$/, `${VML_SHAPETYPE}</xml>`);
  let id = Math.max(idBlock * 1024, ...[...xml.matchAll(/_x0000_s(\d+)/g)].map((m) => Number(m[1]))) + 1;
  const shapes = controls.map((c) => vmlControlXml(c, id++)).join("");
  return xml.replace(/<\/xml>\s*$/, `${shapes}</xml>`);
}

// ---- The editor's side --------------------------------------------------------

/** Set by the sheet editor: how a control reads and writes its cells and saves itself. */
export const formControlBus = {
  canEdit: false,
  /** The values of a reference (the linked cell or input range) seen from the control's sheet. */
  read: null as ((drawingId: string, ref: string) => unknown[][] | null) | null,
  /** Writes the linked cell and saves the control's new state. */
  set: null as ((drawingId: string, data: FormControlData, cellValue: unknown) => void) | null,
  /** An option button was picked: its group's link gets its number. */
  pickOption: null as ((drawingId: string) => void) | null,
  /** A button was clicked. */
  press: null as ((data: FormControlData) => void) | null,
};

/** A reference as Excel writes it ($B$2, Sheet2!$B$2, 'My sheet'!$A$1:$A$5): the sheet's name and the A1 range. */
export function splitRef(ref: string): { sheet?: string; a1: string } | null {
  const m = /^(?:(?:'((?:[^']|'')+)'|([^'!]+))!)?\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/i.exec(ref.trim().replace(/^=/, ""));
  if (!m) return null;
  const sheet = m[1] != null ? m[1].replace(/''/g, "'") : m[2];
  return { ...(sheet ? { sheet } : {}), a1: `${m[3]}${m[4]}${m[5] ? `:${m[5]}${m[6]}` : ""}`.toUpperCase() };
}

/** The control's state, from its linked cell when it has one. */
export function controlState(d: FormControlData, linked: unknown): { checked: boolean; value: number } {
  if (d.kind === "checkbox") return { checked: d.link ? linked === true || linked === 1 || String(linked).toUpperCase() === "TRUE" : !!d.checked, value: 0 };
  const n = typeof linked === "number" ? linked : Number(linked);
  return { checked: !!d.checked, value: d.link && linked != null && linked !== "" && Number.isFinite(n) ? n : (d.value ?? 0) };
}
