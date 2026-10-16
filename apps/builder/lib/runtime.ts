/**
 * A running app: which screen is showing, variables, collections, the records loaded from each
 * data source, and what people have typed or picked in each control. It answers formula names
 * (the Host in lib/fx) and carries out behavior functions. React draws from it (components/Canvas)
 * and re-draws when it says it changed; nothing in here touches the DOM, so tests drive it directly.
 */
import { CONTROLS, propKind, propsOf, type ControlType } from "./controls";
import {
  asTable,
  declaredIn,
  equals,
  evalData,
  FxError,
  FxObject,
  isBlank,
  isRec,
  parseCached,
  rowOf,
  runBehavior,
  sourceOf,
  toBool,
  toText,
  withRow,
  withSource,
  type Host,
  type NotifyKind,
  type Rec,
  type Transition,
  type Value,
} from "./fx";
import { allControls, type AppDef, type Control, type DataSource, type Screen, type SourceField } from "./model";
import { defaultsFor, toBaseValues, toRecord, type BaseRow } from "./records";

/** How the app reaches its data; the browser's goes through the Builder API (lib/client.ts). */
export interface DataAdapter {
  list(source: DataSource): Promise<BaseRow[]>;
  create(source: DataSource, values: Record<string, unknown>): Promise<BaseRow>;
  update(source: DataSource, id: string, values: Record<string, unknown>): Promise<BaseRow>;
  remove(source: DataSource, ids: string[]): Promise<void>;
  runFlow?(flow: string, inputs: Rec): Promise<Value>;
}

export type SourceState = { rows: Rec[]; status: "loading" | "ready" | "error"; error?: string };
export type FormMode = "Edit" | "New" | "View";
type FormState = { mode?: FormMode; values: Rec; lastSubmit: Rec | null; submittedItem: Rec | null; error: string };
type InputState = { value: Value; base: Value };
export type Toast = { id: number; message: string; kind: NotifyKind };

/** Where a formula sits: its screen, and for a gallery's template controls, which item. */
export type Where = { screenId: string; item?: { galleryId: string; record: Rec; key: string } };

const SAFE_URL = /^(https?:|mailto:|tel:)/i;

/** The item key of the stand-in record an empty gallery shows in the studio. */
export const PLACEHOLDER = "#placeholder";

/** In the studio, an empty gallery still shows its template, with every field blank. */
export const placeholderItem = (): Rec => new FxObject("record", "ThisItem", () => null) as unknown as Rec;

export class AppRuntime implements Host {
  app!: AppDef;
  screenId: string;
  transition: Transition = "None";
  history: string[] = [];
  globals: Rec = {};
  contexts = new Map<string, Rec>();
  collections = new Map<string, Rec[]>();
  sources = new Map<string, SourceState>();
  /** The latest error from each property formula, `${controlId}.${prop}` -> message, for the studio. */
  errors = new Map<string, string>();
  toasts: Toast[] = [];
  busy = 0;
  version = 0;

  private errorFrom = new Map<string, string>();
  private inputs = new Map<string, InputState>();
  private forms = new Map<string, FormState>();
  private galleries = new Map<string, Rec | null>();
  private byName = new Map<string, { control: Control; screen: Screen; parent: Control | null }>();
  private listeners = new Set<() => void>();
  private memo = new Map<string, Value>();
  private evaluating = new Set<string>();
  private toastId = 0;
  private collectionId = 0;
  private where: Where;

  constructor(
    app: AppDef,
    private adapter: DataAdapter,
    private opts: { user: { email: string; name: string }; launch?: (url: string) => void; design?: boolean } = { user: { email: "", name: "" } },
  ) {
    this.setApp(app);
    this.screenId = app.screens[0].id;
    this.where = { screenId: this.screenId };
  }

  /** Swaps in an edited definition (the studio), keeping variables and loaded data. */
  setApp(app: AppDef): void {
    this.app = app;
    this.byName.clear();
    for (const entry of allControls(app)) this.byName.set(entry.control.name.toLowerCase(), entry);
    if (this.screenId && !app.screens.some((s) => s.id === this.screenId)) this.screenId = app.screens[0].id;
    for (const ds of app.dataSources) if (!this.sources.has(ds.name)) this.sources.set(ds.name, { rows: [], status: "loading" });
    for (const name of [...this.sources.keys()]) if (!app.dataSources.some((d) => d.name === name)) this.sources.delete(name);
    this.declare();
    this.changed();
  }

  /** Variables and collections the formulas create start out blank and empty (see declaredIn). */
  private declare(): void {
    const globals = new Set<string>();
    const collections = new Set<string>();
    const scan = (src: string | undefined, screenId: string | null) => {
      if (!src || !/set|context|collect|clear|navigate/i.test(src)) return;
      let found;
      try {
        found = declaredIn(parseCached(src));
      } catch {
        return;
      }
      found.globals.forEach((g) => globals.add(g));
      found.collections.forEach((c) => collections.add(c));
      // Navigate's context record lands on the target screen; it's declared on every screen, harmlessly.
      for (const c of found.contexts) {
        for (const s of this.app.screens) {
          if (screenId && s.id !== screenId && !/navigate/i.test(src)) continue;
          const ctx = this.contexts.get(s.id) ?? {};
          if (!(c in ctx)) this.contexts.set(s.id, { ...ctx, [c]: null });
        }
      }
    };
    scan(this.app.onStart, null);
    for (const s of this.app.screens) {
      for (const f of Object.values(s.props)) scan(f, s.id);
      for (const { control, screen } of allControls({ screens: [s] })) for (const f of Object.values(control.props)) scan(f, screen.id);
    }
    for (const g of globals) if (!(g in this.globals) && !this.taken(g)) this.globals[g] = null;
    for (const c of collections) if (!this.collections.has(c) && !this.sources.has(c)) this.collections.set(c, []);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  changed(): void {
    this.version++;
    this.memo.clear();
    for (const fn of this.listeners) fn();
  }

  screen(): Screen {
    return this.app.screens.find((s) => s.id === this.screenId) ?? this.app.screens[0];
  }

  /** Loads every data source, then runs OnStart and the first screen's OnVisible. */
  async start(): Promise<void> {
    await Promise.all(this.app.dataSources.map((d) => this.load(d.name)));
    await this.runFormula(this.app.onStart, { screenId: this.screenId });
    if (!this.opts.design) await this.runFormula(this.screen().props.OnVisible ?? "", { screenId: this.screenId });
  }

  async load(name: string): Promise<void> {
    const ds = this.app.dataSources.find((d) => d.name === name);
    if (!ds) return;
    const prev = this.sources.get(name);
    this.sources.set(name, { rows: prev?.rows ?? [], status: "loading" });
    this.changed();
    try {
      const rows = await this.adapter.list(ds);
      this.sources.set(name, { rows: rows.map((r) => toRecord(ds, r)), status: "ready" });
    } catch (e) {
      this.sources.set(name, { rows: prev?.rows ?? [], status: "error", error: (e as Error).message });
    }
    this.changed();
  }

  // ---- Names --------------------------------------------------------------------------

  resolve(name: string): Value | undefined {
    return this.resolveAt(name, this.where);
  }

  private resolveAt(name: string, where: Where): Value | undefined {
    const lower = name.toLowerCase();
    const hit = this.byName.get(lower);
    if (hit && hit.control.name === name) {
      // A gallery's template control means the one in the current item, when there is one.
      if (hit.parent) return where.item && where.item.galleryId === hit.parent.id ? this.controlObj(hit.control, where) : null;
      return this.controlObj(hit.control, { screenId: hit.screen.id });
    }
    const ctx = this.contexts.get(where.screenId);
    if (ctx && name in ctx) return ctx[name];
    if (name in this.globals) return this.globals[name];
    const coll = this.collections.get(name);
    if (coll) return withSource([...coll], name);
    const src = this.sources.get(name);
    if (src) return withSource([...src.rows], name);
    const screen = this.app.screens.find((s) => s.name === name);
    if (screen) return this.screenObj(screen);
    return undefined;
  }

  /** A host bound to one place, so names resolve as they do there. */
  hostAt(where: Where): Host {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const rt = this;
    return new Proxy(this as Host, {
      get(target, prop, receiver) {
        if (prop === "resolve") return (n: string) => rt.resolveAt(n, where);
        if (prop === "updateContext") return (r: Rec) => rt.updateContextAt(where, r);
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  localsFor(control: Control | null, where: Where): Record<string, Value> {
    const locals: Record<string, Value> = {};
    if (where.item) {
      locals.ThisItem = where.item.record;
      const g = this.findControl(where.item.galleryId);
      if (g) locals.Parent = this.controlObj(g, { screenId: where.screenId });
    } else {
      const s = this.app.screens.find((x) => x.id === where.screenId);
      if (s) locals.Parent = this.screenObj(s);
    }
    if (control) locals.Self = this.controlObj(control, where);
    return locals;
  }

  findControl(id: string): Control | null {
    for (const { control } of allControls(this.app)) if (control.id === id) return control;
    return null;
  }

  private screenObj(screen: Screen): FxObject {
    return new FxObject("screen", screen.name, (prop) => {
      if (prop === "Name") return screen.name;
      if (prop === "Width") return this.app.width;
      if (prop === "Height") return this.app.height;
      return this.evalScreenProp(screen, prop);
    });
  }

  private controlObj(control: Control, where: Where): FxObject {
    const kind = control.type === "form" ? "form" : "control";
    return new FxObject(kind, control.name, (prop) => this.output(control, prop, where));
  }

  /** A control's property: what it holds (Text, Selected ...) or its formula's value. */
  output(control: Control, prop: string, where: Where): Value {
    if (prop === "Name") return control.name;
    switch (control.type as ControlType) {
      case "textinput":
        if (prop === "Text" || prop === "Value") return this.inputValue(control, where, "Default", "");
        break;
      case "checkbox":
      case "toggle":
        if (prop === "Value") return toBool(this.inputValue(control, where, "Default", false));
        break;
      case "datepicker":
        if (prop === "SelectedDate" || prop === "Value") return this.inputValue(control, where, "DefaultDate", null);
        break;
      case "dropdown":
        if (prop === "Selected") return this.dropdownSelected(control, where);
        if (prop === "SelectedText") {
          const s = this.dropdownSelected(control, where);
          return s ? { Value: displayText(s) } : null;
        }
        break;
      case "gallery":
        if (prop === "Selected") return this.gallerySelected(control, where);
        if (prop === "AllItems") return this.galleryItems(control, where);
        break;
      case "form":
        return this.formOutput(control, prop, where);
    }
    if (!(prop in control.props) && !propsOf(control.type).some((p) => p.name === prop)) throw new FxError(`${control.name} has no property ${prop}`);
    return this.prop(control, prop, where);
  }

  // ---- Property formulas --------------------------------------------------------------

  private key(control: Control, where: Where) {
    return where.item ? `${control.id}:${where.item.key}` : control.id;
  }

  /** A data property's value; an error leaves a note in `errors` and gives the fallback. */
  prop(control: Control, prop: string, where: Where, fallback: Value = null): Value {
    const spec = CONTROLS[control.type].props.find((p) => p.name === prop);
    const formula = control.props[prop] ?? spec?.default;
    if (formula === undefined) {
      if (["X", "Y", "Width", "Height"].includes(prop)) return 0;
      if (prop === "Visible") return true;
      return fallback;
    }
    if (propKind(control.type, prop) === "behavior") return null;
    const k = `${this.key(control, where)}.${prop}`;
    if (this.memo.has(k)) return this.memo.get(k)!;
    if (this.evaluating.has(k)) throw new FxError(`${control.name}.${prop} refers to itself`);
    this.evaluating.add(k);
    let v: Value;
    // A template control's error is noted from the first item that hits it, and cleared when
    // that item (or the control outside a gallery) works again.
    const ek = `${control.id}.${prop}`;
    const from = where.item?.key ?? "";
    try {
      v = evalData(formula, this.hostAt(where), this.localsFor(control, where));
      if (this.errorFrom.get(ek) === from) {
        this.errors.delete(ek);
        this.errorFrom.delete(ek);
      }
    } catch (e) {
      if (!(e instanceof Error)) throw e;
      if (from !== PLACEHOLDER && (!this.errors.has(ek) || this.errorFrom.get(ek) === from)) {
        this.errors.set(ek, e.message);
        this.errorFrom.set(ek, from);
      }
      v = fallback;
    } finally {
      this.evaluating.delete(k);
    }
    this.memo.set(k, v);
    return v;
  }

  evalScreenProp(screen: Screen, prop: string): Value {
    const f = screen.props[prop];
    if (!f || prop.startsWith("On")) return null;
    const k = `${screen.id}.${prop}`;
    if (this.memo.has(k)) return this.memo.get(k)!;
    let v: Value = null;
    try {
      v = evalData(f, this.hostAt({ screenId: screen.id }), this.localsFor(null, { screenId: screen.id }));
      this.errors.delete(k);
    } catch (e) {
      this.errors.set(k, (e as Error).message);
    }
    this.memo.set(k, v);
    return v;
  }

  // ---- Control state ------------------------------------------------------------------

  /** What a person typed or picked, unless the default changed since (then the default again). */
  private inputValue(control: Control, where: Where, defaultProp: string, fallback: Value): Value {
    const def = this.prop(control, defaultProp, where, fallback);
    const st = this.inputs.get(this.key(control, where));
    if (st && equals(st.base, def)) return st.value;
    return def;
  }

  /** A person typed, checked, picked a date ... */
  setInput(control: Control, where: Where, value: Value): void {
    const def = this.prop(control, control.type === "datepicker" ? "DefaultDate" : "Default", where, null);
    this.inputs.set(this.key(control, where), { value, base: def });
    this.changed();
  }

  /** Reset(control): back to its default. */
  reset(control: FxObject): void {
    const hit = this.byName.get(control.name.toLowerCase());
    if (!hit) return;
    for (const k of [...this.inputs.keys()]) if (k === hit.control.id || k.startsWith(`${hit.control.id}:`)) this.inputs.delete(k);
    this.galleries.delete(hit.control.id);
    this.changed();
  }

  dropdownItems(control: Control, where: Where): Rec[] {
    const v = this.prop(control, "Items", where, []);
    try {
      return asTable(v).map((r) => (isRec(r) ? r : { Value: r as Value }));
    } catch (e) {
      this.errors.set(`${control.id}.Items`, (e as Error).message);
      return [];
    }
  }

  private dropdownSelected(control: Control, where: Where): Rec | null {
    const items = this.dropdownItems(control, where);
    const st = this.inputs.get(this.key(control, where));
    const def = this.prop(control, "Default", where, null);
    if (st && equals(st.base, def)) {
      const picked = st.value as Rec | null;
      const still = picked && items.find((r) => r === picked || equals(r, picked));
      if (still) return still;
    }
    if (!isBlank(def)) {
      const hit = items.find((r) => (isRec(def) ? equals(r, def) : displayText(r) === toText(def)));
      if (hit) return hit;
    }
    return items[0] ?? null;
  }

  galleryItems(control: Control, where: Where): Rec[] {
    const v = this.prop(control, "Items", where, []);
    try {
      return asTable(v).map((r) => (isRec(r) ? r : { Value: r as Value }));
    } catch (e) {
      this.errors.set(`${control.id}.Items`, (e as Error).message);
      return [];
    }
  }

  private gallerySelected(control: Control, where: Where): Rec | null {
    const items = this.galleryItems(control, where);
    const sel = this.galleries.get(control.id);
    if (sel) {
      const still = items.find((r) => r === sel || equals(r, sel));
      if (still) return still;
    }
    return items[0] ?? null;
  }

  selectItem(gallery: Control, record: Rec): void {
    this.galleries.set(gallery.id, record);
    this.changed();
  }

  /** A stable key for a gallery item: its data source row, else its position. */
  itemKey(record: Rec, index: number): string {
    const ref = rowOf(record);
    return ref ? `${ref.source}#${ref.id}` : `#${index}`;
  }

  // ---- Forms --------------------------------------------------------------------------

  private formState(control: Control): FormState {
    let st = this.forms.get(control.id);
    if (!st) this.forms.set(control.id, (st = { values: {}, lastSubmit: null, submittedItem: null, error: "" }));
    return st;
  }

  formMode(control: Control, where: Where): FormMode {
    const st = this.formState(control);
    if (st.mode) return st.mode;
    const m = toText(this.prop(control, "DefaultMode", where, "Edit"));
    return m === "New" || m === "View" ? m : "Edit";
  }

  formSource(control: Control, where: Where): DataSource | null {
    const name = sourceOf(this.prop(control, "DataSource", where, null));
    return this.app.dataSources.find((d) => d.name === name) ?? null;
  }

  formItem(control: Control, where: Where): Rec {
    const src = this.formSource(control, where);
    const st = this.formState(control);
    if (this.formMode(control, where) === "New") return src ? defaultsFor(src) : {};
    if (st.submittedItem) return st.submittedItem;
    const v = this.prop(control, "Item", where, null);
    return isRec(v) ? v : {};
  }

  formFields(control: Control, where: Where): SourceField[] {
    const src = this.formSource(control, where);
    if (!src) return [];
    const names = control.fields?.length ? control.fields : src.fields.filter((f) => f.type !== "autonumber").map((f) => f.name);
    return names.map((n) => src.fields.find((f) => f.name === n)).filter((f): f is SourceField => !!f);
  }

  formValue(control: Control, where: Where, field: string): Value {
    const st = this.formState(control);
    if (field in st.values) return st.values[field];
    return this.formItem(control, where)[field] ?? null;
  }

  setFormValue(control: Control, field: string, value: Value): void {
    this.formState(control).values[field] = value;
    this.changed();
  }

  formError(control: Control): string {
    return this.formState(control).error;
  }

  private missingRequired(control: Control, where: Where): string[] {
    return this.formFields(control, where)
      .filter((f) => f.required && f.type !== "autonumber")
      .filter((f) => {
        const v = this.formValue(control, where, f.name);
        return isBlank(v) || (Array.isArray(v) && !v.length);
      })
      .map((f) => f.name);
  }

  private formOutput(control: Control, prop: string, where: Where): Value {
    const st = this.formState(control);
    switch (prop) {
      case "Mode":
        return this.formMode(control, where);
      case "LastSubmit":
        return st.lastSubmit;
      case "Error":
        return st.error;
      case "Unsaved":
        return Object.keys(st.values).length > 0;
      case "Valid":
        return this.missingRequired(control, where).length === 0;
      case "Updates": {
        const out: Rec = {};
        for (const f of this.formFields(control, where)) out[f.name] = this.formValue(control, where, f.name);
        return out;
      }
      case "Item":
        return this.formItem(control, where);
    }
    if (!(prop in control.props) && !propsOf(control.type).some((p) => p.name === prop)) throw new FxError(`${control.name} has no property ${prop}`);
    return this.prop(control, prop, where);
  }

  async form(action: "submit" | "reset" | "new" | "edit" | "view", obj: FxObject): Promise<void> {
    const hit = this.byName.get(obj.name.toLowerCase());
    if (!hit || hit.control.type !== "form") throw new FxError(`${obj.name} isn't a form`);
    const control = hit.control;
    const where: Where = { screenId: hit.screen.id };
    const st = this.formState(control);
    if (action !== "submit") {
      st.values = {};
      st.error = "";
      st.submittedItem = null;
      st.mode = action === "new" ? "New" : action === "edit" ? "Edit" : action === "view" ? "View" : undefined;
      this.changed();
      if (action === "reset") await this.runFormula(control.props.OnReset ?? "", where);
      return;
    }
    const src = this.formSource(control, where);
    const mode = this.formMode(control, where);
    const fail = async (message: string) => {
      st.error = message;
      this.changed();
      this.notify(message, "Error");
      await this.runFormula(control.props.OnFailure ?? "", where);
    };
    if (!src) return fail(`${control.name} has no data source to save to`);
    if (mode === "View") return fail(`${control.name} is in view mode`);
    const missing = this.missingRequired(control, where);
    if (missing.length) return fail(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required`);
    try {
      const item = this.formItem(control, where);
      const saved = await this.patch(src.name, mode === "New" ? null : item, mode === "New" ? { ...item, ...st.values } : { ...st.values });
      st.values = {};
      st.error = "";
      st.lastSubmit = saved;
      if (mode === "New") {
        st.mode = "Edit";
        st.submittedItem = saved;
      }
      this.changed();
    } catch (e) {
      return fail((e as Error).message);
    }
    await this.runFormula(control.props.OnSuccess ?? "", where);
  }

  // ---- Behavior functions (lib/fx Host) -----------------------------------------------

  navigate(screen: Value, transition: Transition, context: Rec | null): void {
    const name = screen instanceof FxObject ? screen.name : toText(screen);
    const target = this.app.screens.find((s) => s.name === name);
    if (!target) throw new FxError(`There's no screen called ${name}`);
    if (context) this.contexts.set(target.id, { ...(this.contexts.get(target.id) ?? {}), ...context });
    if (target.id !== this.screenId) this.history.push(this.screenId);
    this.show(target, transition);
  }

  back(): void {
    const prev = this.history.pop();
    const target = prev && this.app.screens.find((s) => s.id === prev);
    if (target) this.show(target, "UnCover");
  }

  private show(target: Screen, transition: Transition) {
    this.screenId = target.id;
    this.where = { screenId: target.id };
    this.transition = transition;
    this.changed();
    if (!this.opts.design) void this.runFormula(target.props.OnVisible ?? "", { screenId: target.id });
  }

  /** True when a control, screen or data source already has this exact name. */
  private taken(name: string): boolean {
    return this.byName.get(name.toLowerCase())?.control.name === name || this.sources.has(name) || this.app.screens.some((s) => s.name === name);
  }

  set(name: string, value: Value): void {
    if (this.taken(name)) {
      throw new FxError(`${name} is already the name of something in this app`);
    }
    this.globals[name] = value;
    this.changed();
  }

  updateContext(values: Rec): void {
    this.updateContextAt(this.where, values);
  }

  private updateContextAt(where: Where, values: Rec): void {
    this.contexts.set(where.screenId, { ...(this.contexts.get(where.screenId) ?? {}), ...values });
    this.changed();
  }

  collect(name: string, items: Rec[], clearFirst: boolean): Rec[] {
    if (this.sources.has(name)) throw new FxError(`Use Patch to add records to ${name}`);
    if (this.taken(name) || name in this.globals) throw new FxError(`${name} is already the name of something in this app`);
    const list = clearFirst ? [] : [...(this.collections.get(name) ?? [])];
    for (const it of items) list.push(withRow({ ...it }, { source: name, id: String(++this.collectionId) }));
    this.collections.set(name, list);
    this.changed();
    return withSource([...list], name);
  }

  clear(name: string): void {
    if (this.sources.has(name)) throw new FxError(`Clear only empties collections; ${name} is a data source`);
    this.collections.set(name, []);
    this.changed();
  }

  defaults(source: string): Rec {
    const ds = this.app.dataSources.find((d) => d.name === source);
    return ds ? defaultsFor(ds) : {};
  }

  async patch(source: string, base: Rec | null, changes: Rec): Promise<Rec> {
    const coll = this.collections.get(source);
    if (coll) {
      const ref = base && rowOf(base);
      const i = ref ? coll.findIndex((r) => rowOf(r)?.id === ref.id) : -1;
      const rec = withRow({ ...(i >= 0 ? coll[i] : {}), ...changes }, { source, id: i >= 0 ? ref!.id : String(++this.collectionId) });
      if (i >= 0) coll[i] = rec;
      else coll.push(rec);
      this.changed();
      return rec;
    }
    const ds = this.app.dataSources.find((d) => d.name === source);
    if (!ds) throw new FxError(`There's no data source called ${source}`);
    const values = toBaseValues(ds, changes);
    const ref = base ? rowOf(base) : undefined;
    if (base && (!ref || ref.source !== source)) throw new FxError(`That record isn't from ${source}`);
    this.busy++;
    this.changed();
    try {
      const row = ref ? await this.adapter.update(ds, ref.id, values) : await this.adapter.create(ds, values);
      const rec = toRecord(ds, row);
      const st = this.sources.get(source) ?? { rows: [], status: "ready" as const };
      const i = st.rows.findIndex((r) => rowOf(r)?.id === String(row.id));
      const rows = [...st.rows];
      if (i >= 0) rows[i] = rec;
      else rows.push(rec);
      this.sources.set(source, { ...st, rows });
      return rec;
    } finally {
      this.busy--;
      this.changed();
    }
  }

  async remove(source: string, records: Rec[]): Promise<void> {
    const ids = records.map((r) => {
      const ref = rowOf(r);
      if (!ref || ref.source !== source) throw new FxError(`That record isn't from ${source}`);
      return ref.id;
    });
    const coll = this.collections.get(source);
    if (coll) {
      this.collections.set(source, coll.filter((r) => !ids.includes(rowOf(r)!.id)));
      this.changed();
      return;
    }
    const ds = this.app.dataSources.find((d) => d.name === source);
    if (!ds) throw new FxError(`There's no data source called ${source}`);
    this.busy++;
    this.changed();
    try {
      if (ids.length) await this.adapter.remove(ds, ids);
      const st = this.sources.get(source);
      if (st) this.sources.set(source, { ...st, rows: st.rows.filter((r) => !ids.includes(rowOf(r)!.id)) });
    } finally {
      this.busy--;
      this.changed();
    }
  }

  async refresh(source: string): Promise<void> {
    if (this.collections.has(source)) return;
    await this.load(source);
  }

  notify(message: string, kind: NotifyKind): void {
    const toast = { id: ++this.toastId, message, kind };
    this.toasts = [...this.toasts.slice(-4), toast];
    this.changed();
  }

  dismiss(id: number): void {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.changed();
  }

  launch(url: string): void {
    if (!SAFE_URL.test(url.trim())) throw new FxError("Launch only opens https, mailto and tel addresses");
    this.opts.launch?.(url.trim());
  }

  async runFlow(flow: string, inputs: Rec): Promise<Value> {
    if (!this.adapter.runFlow) throw new FxError("Flows can't be run from here");
    this.busy++;
    this.changed();
    try {
      return await this.adapter.runFlow(flow, inputs);
    } finally {
      this.busy--;
      this.changed();
    }
  }

  user(): Rec {
    return { FullName: this.opts.user.name, Email: this.opts.user.email, Image: "" };
  }

  // ---- Running behavior formulas ------------------------------------------------------

  /** Runs a control's behavior property (OnSelect ...). Errors show as a notification. */
  async run(control: Control, prop: string, where: Where): Promise<void> {
    if (this.opts.design) return;
    await this.runFormula(control.props[prop] ?? "", where, control);
  }

  async runFormula(src: string, where: Where, control: Control | null = null): Promise<void> {
    if (!src.trim()) return;
    try {
      await runBehavior(src, this.hostAt(where), this.localsFor(control, where));
    } catch (e) {
      this.notify((e as Error).message, "Error");
    }
  }
}

/** The text a dropdown shows for a record: its Value, else its first column. */
export function displayText(r: Rec): string {
  if ("Value" in r) return safeText(r.Value);
  const k = Object.keys(r)[0];
  return k === undefined ? "" : safeText(r[k]);
}

function safeText(v: Value): string {
  try {
    return toText(v);
  } catch {
    return "";
  }
}
