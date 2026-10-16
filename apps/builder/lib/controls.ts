/**
 * The controls an app is built from, with their properties. Every property is a formula; the
 * defaults below are what a newly inserted control starts with. "behavior" properties run when
 * something happens (OnSelect ...) and may change things; the rest are worked out continuously.
 * X, Y, Width, Height and Visible are on every control and aren't listed per type.
 */

export type PropKind = "data" | "behavior";
export type PropDef = { name: string; kind: PropKind; default?: string; hint?: string };

export type ControlSpec = {
  label: string;
  baseName: string;
  icon: string;
  size: [number, number];
  props: PropDef[];
  /** Values the control itself provides (TextInput1.Text ...), for the formula help. */
  outputs: string[];
};

const d = (name: string, def?: string, hint?: string): PropDef => ({ name, kind: "data", default: def, hint });
const b = (name: string, def = "", hint?: string): PropDef => ({ name, kind: "behavior", default: def, hint });

const text = [
  d("Color", "RGBA(17, 24, 39, 1)"),
  d("Size", "15", "Font size in points"),
  d("FontWeight", "FontWeight.Normal"),
  d("Align", "Align.Left"),
];

export const COMMON_PROPS: PropDef[] = [d("X"), d("Y"), d("Width"), d("Height"), d("Visible", "true")];

export const CONTROLS = {
  label: {
    label: "Text label",
    baseName: "Label",
    icon: "Aa",
    size: [280, 40],
    props: [d("Text", `"Text"`), ...text, d("VerticalAlign", "VerticalAlign.Middle"), d("Fill", "Color.Transparent"), d("Wrap", "true"), b("OnSelect")],
    outputs: [],
  },
  button: {
    label: "Button",
    baseName: "Button",
    icon: "▭",
    size: [160, 40],
    props: [
      d("Text", `"Button"`),
      d("Fill", "RGBA(164, 55, 58, 1)"),
      d("Color", "RGBA(255, 255, 255, 1)"),
      d("Size", "15"),
      d("BorderRadius", "6"),
      d("DisplayMode", "DisplayMode.Edit"),
      b("OnSelect"),
    ],
    outputs: [],
  },
  textinput: {
    label: "Text input",
    baseName: "TextInput",
    icon: "⌶",
    size: [280, 40],
    props: [d("Default", `""`), d("HintText", `""`), d("Mode", "TextMode.SingleLine"), d("Size", "15"), d("DisplayMode", "DisplayMode.Edit"), b("OnChange")],
    outputs: ["Text"],
  },
  dropdown: {
    label: "Drop down",
    baseName: "Dropdown",
    icon: "▾",
    size: [280, 40],
    props: [d("Items", `["Option 1", "Option 2", "Option 3"]`, "A table; the first column is shown"), d("Default", `""`), d("DisplayMode", "DisplayMode.Edit"), b("OnChange")],
    outputs: ["Selected", "SelectedText"],
  },
  checkbox: {
    label: "Check box",
    baseName: "Checkbox",
    icon: "☑",
    size: [200, 32],
    props: [d("Text", `"Option"`), d("Default", "false"), d("Color", "RGBA(17, 24, 39, 1)"), d("Size", "15"), d("DisplayMode", "DisplayMode.Edit"), b("OnCheck"), b("OnUncheck")],
    outputs: ["Value"],
  },
  toggle: {
    label: "Toggle",
    baseName: "Toggle",
    icon: "⏻",
    size: [100, 32],
    props: [d("Default", "false"), d("DisplayMode", "DisplayMode.Edit"), b("OnChange")],
    outputs: ["Value"],
  },
  datepicker: {
    label: "Date picker",
    baseName: "DatePicker",
    icon: "📅",
    size: [220, 40],
    props: [d("DefaultDate", "Today()"), d("DisplayMode", "DisplayMode.Edit"), b("OnChange")],
    outputs: ["SelectedDate"],
  },
  image: {
    label: "Image",
    baseName: "Image",
    icon: "🖼",
    size: [200, 160],
    props: [d("Image", `""`, "An image address (https://...)"), d("ImagePosition", "ImagePosition.Fit"), d("Fill", "RGBA(243, 244, 246, 1)"), d("BorderRadius", "0"), b("OnSelect")],
    outputs: [],
  },
  rectangle: {
    label: "Rectangle",
    baseName: "Rectangle",
    icon: "■",
    size: [200, 120],
    props: [d("Fill", "RGBA(164, 55, 58, 1)"), d("BorderRadius", "0"), d("BorderColor", "Color.Transparent"), d("BorderThickness", "0"), b("OnSelect")],
    outputs: [],
  },
  gallery: {
    label: "Gallery",
    baseName: "Gallery",
    icon: "☰",
    size: [480, 480],
    props: [
      d("Items", `[{Title: "First"}, {Title: "Second"}, {Title: "Third"}]`, "The records to show, one template per record"),
      d("TemplateSize", "80", "Height of one item"),
      d("TemplateFill", "Color.Transparent"),
      d("SelectedFill", "RGBA(251, 234, 234, 1)"),
      d("ShowSeparators", "true"),
      b("OnSelect"),
    ],
    outputs: ["Selected", "AllItems"],
  },
  form: {
    label: "Form",
    baseName: "Form",
    icon: "▤",
    size: [560, 480],
    props: [
      d("DataSource", "", "The table to save to"),
      d("Item", "", "The record shown and edited"),
      d("DefaultMode", "FormMode.Edit"),
      d("Columns", "1"),
      b("OnSuccess"),
      b("OnFailure"),
      b("OnReset"),
    ],
    outputs: ["Mode", "LastSubmit", "Error", "Unsaved", "Valid", "Updates"],
  },
} satisfies Record<string, ControlSpec>;

export type ControlType = keyof typeof CONTROLS;

export const CONTROL_TYPES = Object.keys(CONTROLS) as ControlType[];

export const isControlType = (t: unknown): t is ControlType => typeof t === "string" && t in CONTROLS;

/** Every property a control has, the common ones first. */
export function propsOf(type: ControlType): PropDef[] {
  return [...COMMON_PROPS, ...(CONTROLS[type] as ControlSpec).props];
}

export function propKind(type: ControlType, prop: string): PropKind {
  return propsOf(type).find((p) => p.name === prop)?.kind ?? (prop.startsWith("On") ? "behavior" : "data");
}

export const SCREEN_PROPS: PropDef[] = [d("Fill", "RGBA(255, 255, 255, 1)"), b("OnVisible")];
