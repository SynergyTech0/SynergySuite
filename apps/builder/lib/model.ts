/**
 * An app's definition: its screens and their controls, whose properties are formulas, and the
 * data sources it reads (Synergy Base tables). This is what the studio edits and saves, and what
 * the player runs. checkApp() is the server's gatekeeper for anything saved.
 */
import { CONTROLS, isControlType, type ControlType } from "./controls";

export type Control = {
  id: string;
  name: string;
  type: ControlType;
  /** Property name -> formula text. */
  props: Record<string, string>;
  /** A gallery's template controls, laid out inside one item. */
  children?: Control[];
  /** A form's fields, by data source field name, in order. */
  fields?: string[];
};

export type Screen = { id: string; name: string; props: Record<string, string>; controls: Control[] };

export type FieldKind =
  | "autonumber" | "text" | "longtext" | "number" | "currency" | "date" | "datetime" | "yesno"
  | "choice" | "multichoice" | "email" | "hyperlink" | "phone" | "lookup" | "multilookup";

/** A Base field as the app sees it: the name formulas use, and enough to edit it in a form. */
export type SourceField = { id: string; name: string; type: FieldKind; required?: boolean; choices?: string[] };

/** A Synergy Base table the app reads and writes, by the name formulas call it. */
export type DataSource = { name: string; kind: "base"; databaseId: string; tableId: string; tableName: string; fields: SourceField[] };

export type AppDef = {
  v: 1;
  /** The canvas the screens are designed on: 1366x768 (tablet) or 640x1136 (phone). */
  width: number;
  height: number;
  onStart: string;
  screens: Screen[];
  dataSources: DataSource[];
};

export const LAYOUTS = {
  tablet: { width: 1366, height: 768 },
  phone: { width: 640, height: 1136 },
} as const;

export type Layout = keyof typeof LAYOUTS;

export class ModelError extends Error {
  status = 400;
}

export const LIMITS = { screens: 60, controls: 1500, formula: 20_000, dataSources: 30, name: 80 };

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function newKey(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

export function blankScreen(name = "Screen1"): Screen {
  return { id: newKey(), name, props: { Fill: `RGBA(255, 255, 255, 1)`, OnVisible: "" }, controls: [] };
}

export function blankApp(layout: Layout = "tablet"): AppDef {
  return { v: 1, ...LAYOUTS[layout], onStart: "", screens: [blankScreen()], dataSources: [] };
}

/** Every control in the app, gallery template controls included, with the screen it's on. */
export function* allControls(app: Pick<AppDef, "screens">): Generator<{ control: Control; screen: Screen; parent: Control | null }> {
  for (const screen of app.screens) {
    for (const control of screen.controls) {
      yield { control, screen, parent: null };
      for (const child of control.children ?? []) yield { control: child, screen, parent: control };
    }
  }
}

/** Every name in use: screens, controls and data sources share one namespace. */
export function usedNames(app: AppDef): Set<string> {
  const out = new Set<string>();
  for (const s of app.screens) out.add(s.name.toLowerCase());
  for (const { control } of allControls(app)) out.add(control.name.toLowerCase());
  for (const d of app.dataSources) out.add(d.name.toLowerCase());
  return out;
}

/** The next free name like Button1, Button2 ... */
export function nextName(app: AppDef, base: string): string {
  const used = usedNames(app);
  for (let i = 1; ; i++) if (!used.has(`${base}${i}`.toLowerCase())) return `${base}${i}`;
}

/** A data source name from a table name: "Order Lines" -> "OrderLines". */
export function sourceName(tableName: string): string {
  const cleaned = tableName.replace(/[^A-Za-z0-9_]+/g, " ").trim().split(/\s+/).map((w) => w[0].toUpperCase() + w.slice(1)).join("");
  const n = cleaned && /^[A-Za-z_]/.test(cleaned) ? cleaned : `Table${cleaned}`;
  return n.slice(0, LIMITS.name);
}

const str = (v: unknown, what: string, max = LIMITS.formula): string => {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new ModelError(`${what} must be text`);
  if (v.length > max) throw new ModelError(`${what} is too long`);
  return v;
};

const name = (v: unknown, what: string): string => {
  const s = str(v, what, LIMITS.name);
  if (!NAME.test(s)) throw new ModelError(`${what} "${s}" must start with a letter and use only letters, digits and _`);
  return s;
};

function props(v: unknown, what: string): Record<string, string> {
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) throw new ModelError(`${what} properties must be an object`);
  const out: Record<string, string> = {};
  for (const [k, f] of Object.entries(v as Record<string, unknown>)) {
    if (!NAME.test(k)) throw new ModelError(`${what} has a bad property name`);
    out[k] = str(f, `${what}.${k}`);
  }
  return out;
}

function control(v: unknown, count: { n: number }, nested: boolean): Control {
  if (!v || typeof v !== "object") throw new ModelError("A control must be an object");
  const c = v as Record<string, unknown>;
  if (++count.n > LIMITS.controls) throw new ModelError(`An app can have at most ${LIMITS.controls} controls`);
  if (!isControlType(c.type)) throw new ModelError(`Unknown control type ${String(c.type)}`);
  const cname = name(c.name, "Control name");
  const out: Control = { id: str(c.id, "Control id", 40) || newKey(), name: cname, type: c.type, props: props(c.props, cname) };
  if (c.type === "gallery") {
    if (nested) throw new ModelError("A gallery can't go inside another gallery");
    out.children = Array.isArray(c.children) ? c.children.map((x) => control(x, count, true)) : [];
    for (const ch of out.children) if (ch.type === "form") throw new ModelError("A form can't go inside a gallery");
  }
  if (c.type === "form") {
    const f = Array.isArray(c.fields) ? c.fields : [];
    if (f.length > 200 || f.some((x) => typeof x !== "string" || x.length > 200)) throw new ModelError("A form's fields must be field names");
    out.fields = f as string[];
  }
  return out;
}

function field(v: unknown): SourceField {
  const f = (v ?? {}) as Record<string, unknown>;
  const out: SourceField = { id: str(f.id, "Field id", 40), name: str(f.name, "Field name", 200), type: str(f.type, "Field type", 20) as FieldKind };
  if (f.required) out.required = true;
  if (Array.isArray(f.choices)) out.choices = f.choices.filter((x): x is string => typeof x === "string").slice(0, 500);
  return out;
}

/** Checks and normalizes an app definition from a request; throws ModelError on anything wrong. */
export function checkApp(v: unknown): AppDef {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ModelError("The app definition must be an object");
  const a = v as Record<string, unknown>;
  const width = Number(a.width);
  const height = Number(a.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 200 || height < 200 || width > 4000 || height > 4000) {
    throw new ModelError("The app size must be between 200 and 4000 pixels");
  }
  if (!Array.isArray(a.screens) || !a.screens.length) throw new ModelError("An app needs at least one screen");
  if (a.screens.length > LIMITS.screens) throw new ModelError(`An app can have at most ${LIMITS.screens} screens`);
  const count = { n: 0 };
  const screens: Screen[] = a.screens.map((s) => {
    const sc = (s ?? {}) as Record<string, unknown>;
    const sname = name(sc.name, "Screen name");
    return {
      id: str(sc.id, "Screen id", 40) || newKey(),
      name: sname,
      props: props(sc.props, sname),
      controls: Array.isArray(sc.controls) ? sc.controls.map((c) => control(c, count, false)) : [],
    };
  });
  const ds = Array.isArray(a.dataSources) ? a.dataSources : [];
  if (ds.length > LIMITS.dataSources) throw new ModelError(`An app can have at most ${LIMITS.dataSources} data sources`);
  const dataSources: DataSource[] = ds.map((d) => {
    const x = (d ?? {}) as Record<string, unknown>;
    if (x.kind !== "base") throw new ModelError("Data sources must be Synergy Base tables");
    return {
      name: name(x.name, "Data source name"),
      kind: "base",
      databaseId: str(x.databaseId, "Database id", 40),
      tableId: str(x.tableId, "Table id", 40),
      tableName: str(x.tableName, "Table name", 200),
      fields: Array.isArray(x.fields) ? x.fields.slice(0, 500).map(field) : [],
    };
  });
  const app: AppDef = { v: 1, width, height, onStart: str(a.onStart, "OnStart"), screens, dataSources };
  const seen = new Set<string>();
  const names = [...screens.map((s) => s.name), ...[...allControls(app)].map((c) => c.control.name), ...dataSources.map((d) => d.name)];
  for (const n of names) {
    const k = n.toLowerCase();
    if (seen.has(k)) throw new ModelError(`Two things are called ${n}; names must be unique`);
    seen.add(k);
  }
  return app;
}

/** Default property formulas for a new control. */
export function newControl(app: AppDef, type: ControlType, at: { x: number; y: number }): Control {
  const spec = CONTROLS[type];
  const props: Record<string, string> = { X: String(Math.round(at.x)), Y: String(Math.round(at.y)), Width: String(spec.size[0]), Height: String(spec.size[1]) };
  for (const p of spec.props) if (p.default !== undefined) props[p.name] = p.default;
  const c: Control = { id: newKey(), name: nextName(app, spec.baseName), type, props };
  if (type === "gallery") c.children = [];
  if (type === "form") c.fields = [];
  return c;
}
