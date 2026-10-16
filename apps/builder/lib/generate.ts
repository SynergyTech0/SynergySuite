/**
 * "Start from data": a working three-screen app made from one Base table, as Power Apps makes
 * one from a list. A browse screen with search and a gallery, a detail screen showing the
 * selected record, and an edit screen whose form saves new and changed records.
 */
import { LAYOUTS, newKey, type AppDef, type Control, type DataSource, type Layout, type Screen, type SourceField } from "./model";

const RESERVED = new Set(["true", "false", "and", "or", "not", "in", "exactin", "self", "parent", "thisitem", "thisrecord"]);

/** A name as a formula writes it: quoted when it has spaces or clashes with a keyword. */
export function quoteName(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !RESERVED.has(name.toLowerCase()) ? name : `'${name.replace(/'/g, "''")}'`;
}

/** Formula text for a string. */
export const fxString = (s: string) => `"${s.replace(/"/g, '""')}"`;

const ACCENT = "RGBA(164, 55, 58, 1)";
const WHITE = "RGBA(255, 255, 255, 1)";
const HEADER = 88;

const TEXTUAL = new Set(["text", "longtext", "email", "phone", "hyperlink", "choice"]);

function control(name: string, type: Control["type"], props: Record<string, string>, extra: Partial<Control> = {}): Control {
  return { id: newKey(), name, type, props, ...extra };
}

/** How a field reads as text in a label. */
function fieldText(f: SourceField, record = "ThisItem"): string {
  const ref = `${record}.${quoteName(f.name)}`;
  if (f.type === "multichoice" || f.type === "multilookup") return `Concat(${ref}, Value, ", ")`;
  if (f.type === "currency") return `Text(${ref}, "$#,##0.00")`;
  if (f.type === "yesno") return `If(${ref}, "Yes", "No")`;
  if (f.type === "date") return `Text(${ref}, DateTimeFormat.ShortDate)`;
  if (f.type === "datetime") return `Text(${ref}, DateTimeFormat.ShortDateTime)`;
  return ref;
}

function header(prefix: string, title: string, width: number): Control[] {
  return [
    control(`${prefix}Header`, "rectangle", { X: "0", Y: "0", Width: String(width), Height: String(HEADER), Fill: ACCENT }),
    control(`${prefix}Title`, "label", {
      X: "24", Y: "0", Width: String(width - 380), Height: String(HEADER),
      Text: fxString(title), Color: WHITE, Size: "22", FontWeight: "FontWeight.Semibold",
    }),
  ];
}

function headerButton(name: string, text: string, x: number, onSelect: string, extra: Record<string, string> = {}): Control {
  return control(name, "button", {
    X: String(x), Y: "22", Width: "100", Height: "44", Text: fxString(text),
    Fill: "RGBA(255, 255, 255, 0.15)", Color: WHITE, BorderRadius: "6", OnSelect: onSelect, ...extra,
  });
}

/** Names screens and controls with a number so a second generated table doesn't clash. */
export function fromTable(source: DataSource, layout: Layout = "tablet", n = 1): AppDef {
  const { width, height } = LAYOUTS[layout];
  const src = quoteName(source.name);
  const fields = source.fields.filter((f) => f.type !== "autonumber");
  const textual = fields.filter((f) => TEXTUAL.has(f.type));
  const shown = [...textual, ...fields.filter((f) => !TEXTUAL.has(f.type))].slice(0, 3);
  const title = shown[0];

  const browse = `BrowseScreen${n}`;
  const detail = `DetailScreen${n}`;
  const edit = `EditScreen${n}`;
  const gallery = `BrowseGallery${n}`;
  const search = `SearchBox${n}`;
  const editForm = `EditForm${n}`;
  const detailForm = `DetailForm${n}`;

  const searchCols = textual.slice(0, 4).map((f) => fxString(f.name));
  const items = searchCols.length
    ? `SortByColumns(Search(${src}, ${search}.Text, ${searchCols.join(", ")}), ${fxString(title!.name)})`
    : src;

  const lines = shown.map((f, i) =>
    control(`${["Title", "Subtitle", "Body"][i]}${n}`, "label", {
      X: "24",
      Y: String(i === 0 ? 10 : 10 + 30 + (i - 1) * 24),
      Width: String(width - 120),
      Height: i === 0 ? "30" : "24",
      Text: fieldText(f),
      Size: i === 0 ? "17" : "13",
      FontWeight: i === 0 ? "FontWeight.Semibold" : "FontWeight.Normal",
      Color: i === 0 ? "RGBA(17, 24, 39, 1)" : "RGBA(107, 114, 128, 1)",
    }),
  );
  if (!lines.length) lines.push(control(`Title${n}`, "label", { X: "24", Y: "10", Width: String(width - 120), Height: "30", Text: `"Record " & ThisItem.ID`, Size: "17" }));
  lines.push(control(`NextArrow${n}`, "label", { X: String(width - 64), Y: "24", Width: "40", Height: "40", Text: `">"`, Size: "20", Align: "Align.Center", Color: "RGBA(107, 114, 128, 1)" }));

  const browseScreen: Screen = {
    id: newKey(),
    name: browse,
    props: { Fill: WHITE, OnVisible: "" },
    controls: [
      ...header(browse, source.tableName, width),
      headerButton(`RefreshButton${n}`, "Refresh", width - 240, `Refresh(${src})`),
      headerButton(`NewButton${n}`, "+ New", width - 124, `NewForm(${editForm}); Navigate(${edit}, ScreenTransition.Cover)`),
      control(search, "textinput", { X: "24", Y: String(HEADER + 16), Width: String(width - 48), Height: "44", Default: `""`, HintText: `"Search ${source.tableName.replace(/"/g, '""')}"` }),
      control(gallery, "gallery", {
        X: "0", Y: String(HEADER + 76), Width: String(width), Height: String(height - HEADER - 76),
        Items: items, TemplateSize: "88", OnSelect: `Navigate(${detail}, ScreenTransition.Cover)`,
      }, { children: lines }),
    ],
  };

  const allFields = fields.map((f) => f.name);
  const detailScreen: Screen = {
    id: newKey(),
    name: detail,
    props: { Fill: WHITE, OnVisible: "" },
    controls: [
      ...header(detail, source.tableName, width),
      headerButton(`BackButton${n}`, "Back", width - 356, "Back()"),
      headerButton(`EditButton${n}`, "Edit", width - 240, `EditForm(${editForm}); Navigate(${edit}, ScreenTransition.Cover)`),
      headerButton(`DeleteButton${n}`, "Delete", width - 124, `Remove(${src}, ${gallery}.Selected); Back()`),
      control(detailForm, "form", {
        X: "0", Y: String(HEADER), Width: String(width), Height: String(height - HEADER),
        DataSource: src, Item: `${gallery}.Selected`, DefaultMode: "FormMode.View", Columns: layout === "phone" ? "1" : "2",
      }, { fields: allFields }),
    ],
  };

  const editScreen: Screen = {
    id: newKey(),
    name: edit,
    props: { Fill: WHITE, OnVisible: "" },
    controls: [
      ...header(edit, source.tableName, width),
      headerButton(`CancelButton${n}`, "Cancel", width - 240, `ResetForm(${editForm}); Back()`),
      headerButton(`SaveButton${n}`, "Save", width - 124, `SubmitForm(${editForm})`),
      control(editForm, "form", {
        X: "0", Y: String(HEADER), Width: String(width), Height: String(height - HEADER),
        DataSource: src, Item: `${gallery}.Selected`, DefaultMode: "FormMode.Edit", Columns: layout === "phone" ? "1" : "2",
        OnSuccess: `Notify("Saved", NotificationType.Success); Back()`,
      }, { fields: allFields }),
    ],
  };

  return { v: 1, width, height, onStart: "", screens: [browseScreen, detailScreen, editScreen], dataSources: [source] };
}
