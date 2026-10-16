"use client";
/**
 * Draws one screen of a running app. Every visible property comes from the control's formulas
 * through the runtime; typing, picking and clicking go back to it. In design mode (the studio)
 * the controls show their live values but clicks select them instead of running OnSelect.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { isBlank, toBool, toDate, toNumber, toText, type Rec, type Value } from "@/lib/fx";
import type { Control, Screen, SourceField } from "@/lib/model";
import { displayText, PLACEHOLDER, placeholderItem, type AppRuntime, type Where } from "@/lib/runtime";

export type DesignHooks = {
  selectedId: string | null;
  /** Pointer down on a control in the designer: select it and maybe start dragging. */
  onPointerDown(control: Control, e: ReactPointerEvent, parent: Control | null): void;
};

export function useRuntime(rt: AppRuntime): number {
  return useSyncExternalStore(
    (fn) => rt.subscribe(fn),
    () => rt.version,
    () => rt.version,
  );
}

const num = (v: Value, fallback = 0) => {
  try {
    const n = toNumber(v);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
};
const text = (v: Value) => {
  try {
    return toText(v);
  } catch {
    return "";
  }
};
const bool = (v: Value, fallback = true) => {
  try {
    return isBlank(v) ? fallback : toBool(v);
  } catch {
    return fallback;
  }
};
const color = (v: Value, fallback = "transparent") => {
  const s = text(v).trim();
  return s && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i.test(s) ? s : fallback;
};
const ALIGN: Record<string, CSSProperties["justifyContent"]> = { Left: "flex-start", Center: "center", Right: "flex-end", Justify: "flex-start" };
const VALIGN: Record<string, CSSProperties["alignItems"]> = { Top: "flex-start", Middle: "center", Bottom: "flex-end" };
const WEIGHT: Record<string, number> = { Normal: 400, Lighter: 300, Semibold: 600, Bold: 700 };
const FIT: Record<string, CSSProperties["objectFit"]> = { Fit: "contain", Fill: "cover", Stretch: "fill", Center: "none" };
const SAFE_IMG = /^(https?:\/\/|data:image\/(png|jpe?g|gif|webp);)/i;

const ymd = (d: Date | null) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "");
const fromYmd = (s: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const safeDate = (v: Value) => {
  try {
    return toDate(v);
  } catch {
    return null;
  }
};

export function Canvas({ rt, screen, design, zoom = 1 }: { rt: AppRuntime; screen: Screen; design?: DesignHooks; zoom?: number }) {
  useRuntime(rt);
  const fill = color(rt.evalScreenProp(screen, "Fill"), "#fff");
  const where: Where = { screenId: screen.id };
  return (
    <div className="app-canvas" style={{ width: rt.app.width, height: rt.app.height, background: fill, transform: zoom === 1 ? undefined : `scale(${zoom})` }}>
      {screen.controls.map((c) => (
        <ControlView key={c.id} rt={rt} control={c} where={where} design={design} parent={null} />
      ))}
    </div>
  );
}

function ControlView({ rt, control, where, design, parent }: { rt: AppRuntime; control: Control; where: Where; design?: DesignHooks; parent: Control | null }) {
  const p = (prop: string, fallback: Value = null) => rt.prop(control, prop, where, fallback);
  const visible = bool(p("Visible", true));
  const designItem = !where.item || where.item.key === "#design" || where.item.key === PLACEHOLDER;
  const selected = design?.selectedId === control.id && designItem;
  if (!visible && !selected) return null;
  const box: CSSProperties = {
    left: num(p("X")),
    top: num(p("Y")),
    width: Math.max(0, num(p("Width"), 100)),
    height: Math.max(0, num(p("Height"), 40)),
    opacity: visible ? undefined : 0.35,
  };
  const disabled = (() => {
    const m = text(p("DisplayMode", "Edit"));
    return m === "Disabled" || m === "View";
  })();
  const run = (prop: string) => {
    if (!design) void rt.run(control, prop, where);
  };
  const designable = design && designItem;
  const onPointerDown = designable
    ? (e: ReactPointerEvent) => {
        e.stopPropagation();
        design!.onPointerDown(control, e, parent);
      }
    : undefined;
  const cls = `ctl ctl-${control.type}${selected ? " selected" : ""}${design ? " design" : ""}`;
  const font = (extra: CSSProperties = {}): CSSProperties => ({
    fontSize: num(p("Size", 15), 15),
    color: color(p("Color"), "#111827"),
    fontWeight: WEIGHT[text(p("FontWeight"))] ?? 400,
    ...extra,
  });

  let body: ReactNode = null;
  switch (control.type) {
    case "label": {
      body = (
        <div
          className={cls}
          style={{
            ...box,
            ...font(),
            background: color(p("Fill")),
            justifyContent: ALIGN[text(p("Align"))] ?? "flex-start",
            alignItems: VALIGN[text(p("VerticalAlign"))] ?? "center",
            textAlign: (text(p("Align")) || "Left").toLowerCase() as CSSProperties["textAlign"],
            whiteSpace: bool(p("Wrap"), true) ? "pre-wrap" : "nowrap",
            cursor: control.props.OnSelect && !design ? "pointer" : undefined,
          }}
          onPointerDown={onPointerDown}
          onClick={() => run("OnSelect")}
        >
          <span>{text(p("Text"))}</span>
        </div>
      );
      break;
    }
    case "button":
      body = (
        <button
          className={cls}
          style={{ ...box, ...font({ color: color(p("Color"), "#fff") }), background: color(p("Fill"), "#a4373a"), borderRadius: num(p("BorderRadius"), 6) }}
          disabled={disabled && !design}
          onPointerDown={onPointerDown}
          onClick={(e) => {
            e.stopPropagation();
            run("OnSelect");
          }}
        >
          {text(p("Text"))}
        </button>
      );
      break;
    case "textinput": {
      const value = text(rt.output(control, "Text", where));
      const mode = text(p("Mode"));
      const common = {
        className: cls,
        style: { ...box, fontSize: num(p("Size", 15), 15) },
        value,
        placeholder: text(p("HintText")),
        readOnly: !!design || disabled,
        onPointerDown,
        onChange: (e: { target: { value: string } }) => rt.setInput(control, where, e.target.value),
        onBlur: () => run("OnChange"),
      };
      body = mode === "MultiLine" ? <textarea {...common} /> : <input {...common} type={mode === "Password" ? "password" : "text"} onKeyDown={(e) => e.key === "Enter" && run("OnChange")} />;
      break;
    }
    case "dropdown": {
      const items = rt.dropdownItems(control, where);
      const sel = rt.output(control, "Selected", where) as Rec | null;
      const idx = sel ? items.indexOf(sel) : -1;
      body = (
        <select
          className={cls}
          style={{ ...box, fontSize: 15 }}
          value={idx < 0 ? "" : String(idx)}
          disabled={(disabled && !design) || undefined}
          onPointerDown={onPointerDown}
          onChange={(e) => {
            if (design) return;
            rt.setInput(control, where, items[Number(e.target.value)] ?? null);
            run("OnChange");
          }}
        >
          {idx < 0 && <option value="" />}
          {items.slice(0, 1000).map((r, i) => (
            <option key={i} value={String(i)}>
              {displayText(r)}
            </option>
          ))}
        </select>
      );
      break;
    }
    case "checkbox":
    case "toggle": {
      const on = bool(rt.output(control, "Value", where), false);
      const change = (v: boolean) => {
        if (design || disabled) return;
        rt.setInput(control, where, v);
        if (control.type === "checkbox") run(v ? "OnCheck" : "OnUncheck");
        else run("OnChange");
      };
      body = (
        <label className={cls} style={{ ...box, ...font() }} onPointerDown={onPointerDown}>
          <input type="checkbox" className={control.type === "toggle" ? "switch" : undefined} checked={on} disabled={disabled} onChange={(e) => change(e.target.checked)} />
          {control.type === "checkbox" && <span>{text(p("Text"))}</span>}
        </label>
      );
      break;
    }
    case "datepicker": {
      const d = safeDate(rt.output(control, "SelectedDate", where));
      body = (
        <input
          type="date"
          className={cls}
          style={{ ...box, fontSize: 15 }}
          value={ymd(d)}
          readOnly={!!design || disabled}
          onPointerDown={onPointerDown}
          onChange={(e) => {
            rt.setInput(control, where, fromYmd(e.target.value));
            run("OnChange");
          }}
        />
      );
      break;
    }
    case "image": {
      const src = text(p("Image"));
      body = (
        <div className={cls} style={{ ...box, background: color(p("Fill")), borderRadius: num(p("BorderRadius")) }} onPointerDown={onPointerDown} onClick={() => run("OnSelect")}>
          {SAFE_IMG.test(src) ? <img src={src} alt="" style={{ objectFit: FIT[text(p("ImagePosition"))] ?? "contain" }} draggable={false} /> : design ? <span className="muted">Image</span> : null}
        </div>
      );
      break;
    }
    case "rectangle":
      body = (
        <div
          className={cls}
          style={{
            ...box,
            background: color(p("Fill")),
            borderRadius: num(p("BorderRadius")),
            border: `${num(p("BorderThickness"))}px solid ${color(p("BorderColor"))}`,
            cursor: control.props.OnSelect && !design ? "pointer" : undefined,
          }}
          onPointerDown={onPointerDown}
          onClick={() => run("OnSelect")}
        />
      );
      break;
    case "gallery":
      body = <Gallery rt={rt} control={control} where={where} box={box} cls={cls} design={design} onPointerDown={onPointerDown} />;
      break;
    case "form":
      body = <Form rt={rt} control={control} where={where} box={box} cls={cls} design={design} onPointerDown={onPointerDown} />;
      break;
  }
  return body;
}

function Gallery({ rt, control, where, box, cls, design, onPointerDown }: {
  rt: AppRuntime; control: Control; where: Where; box: CSSProperties; cls: string; design?: DesignHooks; onPointerDown?: (e: ReactPointerEvent) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const items = rt.galleryItems(control, where);
  const size = Math.max(8, num(rt.prop(control, "TemplateSize", where, 80), 80));
  const height = Number(box.height) || 0;
  const selected = rt.output(control, "Selected", where);
  const tFill = color(rt.prop(control, "TemplateFill", where));
  const sFill = color(rt.prop(control, "SelectedFill", where));
  const seps = bool(rt.prop(control, "ShowSeparators", where), true);
  // Only the items in view (and a few either side) are drawn.
  const first = Math.max(0, Math.floor(scroll / size) - 3);
  const last = Math.min(items.length, Math.ceil((scroll + height) / size) + 3);
  const shown = items.slice(first, last);
  return (
    <div className={cls} style={box} ref={ref} onPointerDown={onPointerDown} onScroll={(e) => setScroll((e.target as HTMLDivElement).scrollTop)}>
      <div style={{ position: "relative", height: Math.max(items.length, design ? 1 : 0) * size }}>
        {(design && !items.length ? [placeholderItem()] : shown).map((record, i) => {
          const index = first + i;
          const key = design && !items.length ? PLACEHOLDER : design && index === 0 ? "#design" : rt.itemKey(record, index);
          const itemWhere: Where = { screenId: where.screenId, item: { galleryId: control.id, record, key } };
          const isSel = record === selected;
          return (
            <div
              key={key}
              className={`gallery-item${seps ? " sep" : ""}`}
              style={{ top: index * size, height: size, background: isSel ? sFill : tFill }}
              onClick={() => {
                if (design) return;
                rt.selectItem(control, record);
                void rt.run(control, "OnSelect", itemWhere);
              }}
            >
              {(control.children ?? []).map((ch) => (
                <ControlView key={ch.id} rt={rt} control={ch} where={itemWhere} design={design} parent={control} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Form({ rt, control, where, box, cls, design, onPointerDown }: {
  rt: AppRuntime; control: Control; where: Where; box: CSSProperties; cls: string; design?: DesignHooks; onPointerDown?: (e: ReactPointerEvent) => void;
}) {
  const fields = rt.formFields(control, where);
  const mode = rt.formMode(control, where);
  const cols = Math.min(4, Math.max(1, Math.round(num(rt.prop(control, "Columns", where, 1), 1))));
  const error = rt.formError(control);
  const src = rt.formSource(control, where);
  return (
    <div className={cls} style={box} onPointerDown={onPointerDown}>
      {error && <div className="form-error">{error}</div>}
      {!src && <div className="muted form-empty">{design ? "Set DataSource to a table, and Item to the record to show" : "No data"}</div>}
      <div className="form-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {fields.map((f) => (
          <label key={f.id} className={`form-field${f.type === "longtext" || f.type === "multichoice" ? " wide" : ""}`}>
            <span className="form-label">
              {f.name}
              {f.required && mode !== "View" && <span className="req">*</span>}
            </span>
            <FieldInput field={f} value={rt.formValue(control, where, f.name)} readOnly={mode === "View" || !!design} onChange={(v) => rt.setFormValue(control, f.name, v)} />
          </label>
        ))}
      </div>
    </div>
  );
}

function FieldInput({ field, value, readOnly, onChange }: { field: SourceField; value: Value; readOnly: boolean; onChange: (v: Value) => void }) {
  if (readOnly) {
    let shown: string;
    if (Array.isArray(value)) shown = value.map((r) => text((r as Rec).Value ?? null)).join(", ");
    else if (field.type === "yesno") shown = bool(value, false) ? "Yes" : "No";
    else if (field.type === "currency" && typeof value === "number") shown = value.toLocaleString(undefined, { style: "currency", currency: "USD" });
    else shown = text(value);
    return <div className="form-value">{shown || " "}</div>;
  }
  switch (field.type) {
    case "autonumber":
      return <div className="form-value muted">{text(value) || "(new)"}</div>;
    case "longtext":
      return <textarea value={text(value)} rows={3} onChange={(e) => onChange(e.target.value)} />;
    case "number":
    case "currency":
      return <input type="number" step="any" value={value === null || value === "" ? "" : text(value)} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />;
    case "date":
      return <input type="date" value={ymd(safeDate(value))} onChange={(e) => onChange(fromYmd(e.target.value))} />;
    case "datetime": {
      const d = safeDate(value);
      const local = d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
      return <input type="datetime-local" value={local} onChange={(e) => onChange(e.target.value ? new Date(e.target.value) : null)} />;
    }
    case "yesno":
      return <input type="checkbox" checked={bool(value, false)} onChange={(e) => onChange(e.target.checked)} />;
    case "choice":
      return (
        <select value={text(value)} onChange={(e) => onChange(e.target.value || null)}>
          <option value="" />
          {(field.choices ?? []).map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      );
    case "multichoice": {
      const picked = new Set(Array.isArray(value) ? value.map((r) => text((r as Rec).Value ?? null)) : []);
      return (
        <div className="choices">
          {(field.choices ?? []).map((c) => (
            <label key={c}>
              <input
                type="checkbox"
                checked={picked.has(c)}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(c);
                  else next.delete(c);
                  onChange((field.choices ?? []).filter((x) => next.has(x)).map((x) => ({ Value: x })));
                }}
              />
              {c}
            </label>
          ))}
        </div>
      );
    }
    case "lookup":
      return <LookupInput value={value} onChange={onChange} />;
    case "multilookup":
      return <div className="form-value muted">{Array.isArray(value) ? value.map((r) => text((r as Rec).Value ?? null)).join(", ") : ""}</div>;
    default:
      return <input type={field.type === "email" ? "email" : field.type === "phone" ? "tel" : field.type === "hyperlink" ? "url" : "text"} value={text(value)} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** A lookup shows the related record's text; typing a number points it at that record ID. */
function LookupInput({ value, onChange }: { value: Value; onChange: (v: Value) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [value]);
  return (
    <input
      value={draft ?? text(typeof value === "object" && value && !Array.isArray(value) && !(value instanceof Date) ? ((value as Rec).Value ?? null) : value)}
      placeholder="Related record ID"
      title="Type the ID of the related record"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === null) return;
        if (/^\d+$/.test(draft.trim())) onChange(Number(draft.trim()));
        else if (!draft.trim()) onChange(null);
        setDraft(null);
      }}
    />
  );
}

/** The app's notifications (Notify), newest last. */
export function Toasts({ rt }: { rt: AppRuntime }) {
  useRuntime(rt);
  useEffect(() => {
    if (!rt.toasts.length) return;
    const t = setTimeout(() => rt.dismiss(rt.toasts[0].id), 5000);
    return () => clearTimeout(t);
  }, [rt, rt.toasts]);
  if (!rt.toasts.length) return null;
  return (
    <div className="toasts">
      {rt.toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind.toLowerCase()}`} role="status">
          <span>{t.message}</span>
          <button onClick={() => rt.dismiss(t.id)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
