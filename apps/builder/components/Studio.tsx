"use client";
/**
 * The studio: build an app by placing controls on screens and writing their properties as
 * formulas, with the app running live underneath (real data, real formula values). The draft
 * saves itself; Publish makes it what the people it's shared with get.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { api, browserAdapter, type AppDetail } from "@/lib/client";
import { CONTROLS, CONTROL_TYPES, propsOf, SCREEN_PROPS, type ControlType } from "@/lib/controls";
import { parse, toNumber } from "@/lib/fx";
import { quoteName } from "@/lib/generate";
import { allControls, blankScreen, newControl, newKey, nextName, sourceName, type AppDef, type Control, type DataSource, type Screen } from "@/lib/model";
import { renameEverywhere } from "@/lib/rename";
import { AppRuntime, PLACEHOLDER, placeholderItem, type Where } from "@/lib/runtime";
import { Canvas, Toasts, useRuntime } from "./Canvas";
import { Running } from "./Player";
import { ShareDialog } from "./ShareDialog";

type Sel = { kind: "app" } | { kind: "screen" } | { kind: "control"; id: string };
type SaveState = "saved" | "saving" | "unsaved" | "error";

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function findControl(def: AppDef, id: string): { control: Control; screen: Screen; parent: Control | null } | null {
  for (const e of allControls(def)) if (e.control.id === id) return e;
  return null;
}

/** A copy of the app with one control changed. */
function withControl(def: AppDef, id: string, fn: (c: Control) => void): AppDef {
  const next = structuredClone(def);
  const hit = findControl(next, id);
  if (hit) fn(hit.control);
  return next;
}

const errorOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Studio({ id, user }: { id: string; user: { email: string; name: string } }) {
  const [detail, setDetail] = useState<AppDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    api<{ app: AppDetail }>(`/api/apps/${encodeURIComponent(id)}`)
      .then(async ({ app }) => {
        if (!app.draft) throw new Error("You can run this app, but not edit it.");
        // Catch up with renamed or added Base fields.
        const fresh = await Promise.all(
          app.draft.dataSources.map(async (ds) => {
            try {
              const t = await api<{ table: { name: string; fields: DataSource["fields"] } }>(`/api/tables/${encodeURIComponent(ds.tableId)}`);
              return { ...ds, tableName: t.table.name, fields: t.table.fields };
            } catch {
              return ds;
            }
          }),
        );
        setDetail({ ...app, draft: { ...app.draft, dataSources: fresh } });
      })
      .catch((e) => setLoadError(e.status === 404 ? "This app doesn't exist, or it hasn't been shared with you." : errorOf(e)));
  }, [id]);
  if (loadError) return <div className="signed-out">{loadError}</div>;
  if (!detail) return <div className="signed-out">Loading…</div>;
  return <Editor detail={detail} user={user} />;
}

function Editor({ detail, user }: { detail: AppDetail; user: { email: string; name: string } }) {
  const id = detail.id;
  const [def, setDefState] = useState<AppDef>(detail.draft!);
  const [name, setName] = useState(detail.name);
  const [meta, setMeta] = useState(detail);
  const [screenId, setScreenId] = useState(def.screens[0].id);
  const [sel, setSel] = useState<Sel>({ kind: "screen" });
  const [prop, setProp] = useState("Fill");
  const [save, setSave] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState("");
  const [preview, setPreview] = useState(false);
  const [left, setLeft] = useState<"tree" | "data">("tree");
  const [dialog, setDialog] = useState<null | "data" | "share" | "versions">(null);
  const [zoom, setZoom] = useState(0);
  const undo = useRef<AppDef[]>([]);
  const redo = useRef<AppDef[]>([]);
  const first = useRef(true);

  const adapter = useMemo(() => browserAdapter(id), [id]);
  const rt = useMemo(() => new AppRuntime(detail.draft!, adapter, { user, design: true }), [detail, adapter, user]);
  useRuntime(rt);
  useEffect(() => {
    void rt.start();
  }, [rt]);
  useEffect(() => {
    rt.setApp(def);
  }, [rt, def]);
  useEffect(() => {
    if (rt.screenId !== screenId) {
      rt.screenId = screenId;
      rt.changed();
    }
  }, [rt, screenId]);

  /** Every change goes through here, so it can be undone. */
  const setDef = useCallback((next: AppDef | ((d: AppDef) => AppDef), group = false) => {
    setDefState((cur) => {
      const n = typeof next === "function" ? next(cur) : next;
      if (n === cur) return cur;
      if (!group) {
        undo.current = [...undo.current.slice(-99), cur];
        redo.current = [];
      }
      return n;
    });
  }, []);

  // Autosave the draft a moment after the last change.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSave("unsaved");
    const t = setTimeout(async () => {
      setSave("saving");
      try {
        const r = await api<{ app: AppDetail }>(`/api/apps/${encodeURIComponent(id)}`, { method: "PATCH", body: { definition: def } });
        setMeta(r.app);
        setSave("saved");
        setSaveError("");
      } catch (e) {
        setSave("error");
        setSaveError(errorOf(e));
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [def, id]);

  const screen = def.screens.find((s) => s.id === screenId) ?? def.screens[0];
  const selected = sel.kind === "control" ? findControl(def, sel.id) : null;

  const doUndo = () => {
    const prev = undo.current.pop();
    if (!prev) return;
    redo.current.push(def);
    setDefState(prev);
  };
  const doRedo = () => {
    const next = redo.current.pop();
    if (!next) return;
    undo.current.push(def);
    setDefState(next);
  };

  const selectControl = (cid: string) => {
    const hit = findControl(def, cid);
    if (!hit) return;
    setSel({ kind: "control", id: cid });
    if (hit.screen.id !== screenId) setScreenId(hit.screen.id);
    const props = propsOf(hit.control.type).map((p) => p.name);
    if (!props.includes(prop)) setProp(hit.control.type === "button" ? "OnSelect" : (["Text", "Items", "Default", "DataSource"].find((p) => props.includes(p)) ?? "X"));
  };

  // ---- Inserting and removing ---------------------------------------------------------

  const insert = (type: ControlType) => {
    const into = selected && (selected.control.type === "gallery" ? selected.control : selected.parent);
    const c = newControl(def, type, into ? { x: 16, y: 8 } : { x: 40 + (screen.controls.length % 8) * 16, y: 120 + (screen.controls.length % 8) * 16 });
    if (into && type === "form") return alert("A form can't go inside a gallery.");
    if (into && type === "gallery") return alert("A gallery can't go inside another gallery.");
    if (into) {
      c.props.Width = String(Math.min(Number(c.props.Width), 400));
      if (type === "label") c.props.Text = "ThisItem.Title";
    }
    setDef((d) => {
      const next = structuredClone(d);
      if (into) findControl(next, into.id)!.control.children!.push(c);
      else next.screens.find((s) => s.id === screen.id)!.controls.push(c);
      return next;
    });
    setSel({ kind: "control", id: c.id });
    setProp(type === "button" ? "OnSelect" : (["Text", "Items", "DataSource", "Default"].find((p) => p in c.props) ?? "X"));
  };

  const removeSelected = () => {
    if (!selected) return;
    setDef((d) => {
      const next = structuredClone(d);
      const hit = findControl(next, selected.control.id)!;
      if (hit.parent) hit.parent.children = hit.parent.children!.filter((x) => x.id !== hit.control.id);
      else hit.screen.controls = hit.screen.controls.filter((x) => x.id !== hit.control.id);
      return next;
    });
    setSel({ kind: "screen" });
    setProp("Fill");
  };

  const duplicateSelected = () => {
    if (!selected) return;
    const copy = (c: Control, d: AppDef): Control => ({
      ...structuredClone(c),
      id: newKey(),
      name: nextName(d, c.name.replace(/\d+$/, "") || "Control"),
      children: c.children?.map((ch) => copy(ch, d)),
    });
    let made: Control | null = null;
    setDef((d) => {
      const next = structuredClone(d);
      const c = copy(selected.control, next);
      c.props.X = String(toNum(c.props.X) + 20);
      c.props.Y = String(toNum(c.props.Y) + 20);
      const hit = findControl(next, selected.control.id)!;
      (hit.parent ? hit.parent.children! : hit.screen.controls).push(c);
      made = c;
      return next;
    });
    setTimeout(() => made && setSel({ kind: "control", id: (made as Control).id }), 0);
  };

  const reorder = (to: "front" | "back") => {
    if (!selected) return;
    setDef((d) => {
      const next = structuredClone(d);
      const hit = findControl(next, selected.control.id)!;
      const list = hit.parent ? hit.parent.children! : hit.screen.controls;
      const i = list.findIndex((x) => x.id === hit.control.id);
      const [c] = list.splice(i, 1);
      if (to === "front") list.push(c);
      else list.unshift(c);
      return next;
    });
  };

  // ---- Screens ------------------------------------------------------------------------

  const addScreen = () => {
    const s = blankScreen(nextName(def, "Screen"));
    setDef((d) => ({ ...d, screens: [...d.screens, s] }));
    setScreenId(s.id);
    setSel({ kind: "screen" });
    setProp("Fill");
  };

  const removeScreen = (sid: string) => {
    if (def.screens.length < 2) return;
    const s = def.screens.find((x) => x.id === sid)!;
    if (!confirm(`Delete ${s.name} and its controls?`)) return;
    setDef((d) => ({ ...d, screens: d.screens.filter((x) => x.id !== sid) }));
    if (screenId === sid) setScreenId(def.screens.find((x) => x.id !== sid)!.id);
    setSel({ kind: "screen" });
  };

  const moveScreen = (sid: string, by: -1 | 1) => {
    setDef((d) => {
      const list = [...d.screens];
      const i = list.findIndex((x) => x.id === sid);
      const j = i + by;
      if (j < 0 || j >= list.length) return d;
      [list[i], list[j]] = [list[j], list[i]];
      return { ...d, screens: list };
    });
  };

  // ---- Properties ---------------------------------------------------------------------

  const formulaOf = (p: string): string => {
    if (sel.kind === "app") return def.onStart;
    if (sel.kind === "screen") return screen.props[p] ?? "";
    if (selected) return selected.control.props[p] ?? (propsOf(selected.control.type).find((x) => x.name === p)?.default ?? "");
    return "";
  };

  const setFormula = (p: string, value: string, group = false) => {
    if (sel.kind === "app") setDef((d) => ({ ...d, onStart: value }), group);
    else if (sel.kind === "screen") setDef((d) => ({ ...d, screens: d.screens.map((s) => (s.id === screen.id ? { ...s, props: { ...s.props, [p]: value } } : s)) }), group);
    else if (selected) setDef((d) => withControl(d, selected.control.id, (c) => (c.props[p] = value)), group);
  };

  const rename = (to: string): string | null => {
    const from = sel.kind === "screen" ? screen.name : selected?.control.name;
    if (!from || to === from) return null;
    if (!NAME.test(to)) return "Names start with a letter and use letters, digits and _";
    const taken = new Set([...def.screens.map((s) => s.name), ...[...allControls(def)].map((e) => e.control.name), ...def.dataSources.map((d) => d.name)].map((n) => n.toLowerCase()));
    if (taken.has(to.toLowerCase())) return `Something is already called ${to}`;
    setDef((d) => {
      const next = renameEverywhere(d, from, to);
      if (sel.kind === "screen") next.screens.find((s) => s.id === screen.id)!.name = to;
      else findControl(next, selected!.control.id)!.control.name = to;
      return next;
    });
    return null;
  };

  // ---- Dragging and resizing on the canvas --------------------------------------------

  const stage = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setFit(Math.min((el.clientWidth - 48) / def.width, (el.clientHeight - 48) / def.height, 1));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [def.width, def.height]);
  const scale = zoom || fit;

  const drag = useRef<{ id: string; mode: "move" | "resize"; x0: number; y0: number; a: number; b: number; moved: boolean } | null>(null);

  const startDrag = (control: Control, e: ReactPointerEvent, mode: "move" | "resize") => {
    const a = toNum(mode === "move" ? control.props.X : control.props.Width);
    const b = toNum(mode === "move" ? control.props.Y : control.props.Height);
    drag.current = { id: control.id, mode, x0: e.clientX, y0: e.clientY, a, b, moved: false };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = Math.round((e.clientX - d.x0) / scale);
      const dy = Math.round((e.clientY - d.y0) / scale);
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      const group = d.moved;
      d.moved = true;
      setDef(
        (cur) =>
          withControl(cur, d.id, (c) => {
            if (d.mode === "move") {
              c.props.X = String(Math.max(-2000, d.a + dx));
              c.props.Y = String(Math.max(-2000, d.b + dy));
            } else {
              c.props.Width = String(Math.max(10, d.a + dx));
              c.props.Height = String(Math.max(10, d.b + dy));
            }
          }),
        group,
      );
    };
    const up = () => (drag.current = null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [scale, setDef]);

  const designHooks = {
    selectedId: sel.kind === "control" ? sel.id : null,
    onPointerDown(control: Control, e: ReactPointerEvent) {
      selectControl(control.id);
      startDrag(control, e, "move");
    },
  };

  // Where the selected control sits on the canvas, for the resize handle.
  const handle = (() => {
    if (!selected || selected.screen.id !== screen.id) return null;
    const where: Where = { screenId: screen.id };
    const n = (c: Control, p: string, w: Where = where) => {
      try {
        return toNumber(rt.prop(c, p, w, 0));
      } catch {
        return 0;
      }
    };
    let x = 0;
    let y = 0;
    if (selected.parent) {
      x = n(selected.parent, "X");
      y = n(selected.parent, "Y");
    }
    const w: Where = selected.parent ? { screenId: screen.id, item: { galleryId: selected.parent.id, record: placeholderItem(), key: PLACEHOLDER } } : where;
    return { left: x + n(selected.control, "X", w) + n(selected.control, "Width", w), top: y + n(selected.control, "Y", w) + n(selected.control, "Height", w) };
  })();

  // ---- Keyboard -----------------------------------------------------------------------

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      } else if (mod && e.key.toLowerCase() === "y" && !typing) {
        e.preventDefault();
        doRedo();
      } else if (e.key === "F5") {
        e.preventDefault();
        setPreview(true);
      } else if (typing) {
        return;
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        removeSelected();
      } else if (mod && e.key.toLowerCase() === "d" && selected) {
        e.preventDefault();
        duplicateSelected();
      } else if (selected && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const [dx, dy] = e.key === "ArrowLeft" ? [-step, 0] : e.key === "ArrowRight" ? [step, 0] : e.key === "ArrowUp" ? [0, -step] : [0, step];
        setDef((d) => withControl(d, selected.control.id, (c) => {
          c.props.X = String(toNum(c.props.X) + dx);
          c.props.Y = String(toNum(c.props.Y) + dy);
        }));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  // ---- Publishing and details ---------------------------------------------------------

  const [publishing, setPublishing] = useState(false);
  const publish = async () => {
    setPublishing(true);
    try {
      await api(`/api/apps/${encodeURIComponent(id)}`, { method: "PATCH", body: { definition: def } });
      const r = await api<{ app: AppDetail }>(`/api/apps/${encodeURIComponent(id)}/publish`, { method: "POST" });
      setMeta(r.app);
      setSave("saved");
      rt.notify(`Published version ${r.app.publishedVersion}`, "Success");
    } catch (e) {
      rt.notify(errorOf(e), "Error");
    } finally {
      setPublishing(false);
    }
  };

  const saveName = async (n: string) => {
    const v = n.trim();
    if (!v || v === meta.name) return setName(meta.name);
    try {
      const r = await api<{ app: AppDetail }>(`/api/apps/${encodeURIComponent(id)}`, { method: "PATCH", body: { name: v } });
      setMeta(r.app);
    } catch (e) {
      setName(meta.name);
      rt.notify(errorOf(e), "Error");
    }
  };

  // ---- Data ---------------------------------------------------------------------------

  const addSource = (ds: Omit<DataSource, "name">) => {
    if (def.dataSources.some((d) => d.tableId === ds.tableId)) return setDialog(null);
    let nm = sourceName(ds.tableName);
    const taken = new Set([...def.screens.map((s) => s.name), ...[...allControls(def)].map((e) => e.control.name), ...def.dataSources.map((d) => d.name)].map((x) => x.toLowerCase()));
    for (let i = 2; taken.has(nm.toLowerCase()); i++) nm = `${sourceName(ds.tableName)}${i}`;
    const next = { ...def, dataSources: [...def.dataSources, { ...ds, name: nm }] };
    setDef(next);
    setDialog(null);
    setLeft("data");
    // The data route only serves sources in the saved draft, so save before loading.
    void api(`/api/apps/${encodeURIComponent(id)}`, { method: "PATCH", body: { definition: next } })
      .then(() => rt.load(nm))
      .catch((e) => rt.notify(errorOf(e), "Error"));
  };

  // ---- Render ---------------------------------------------------------------------------

  const propList =
    sel.kind === "app" ? [{ name: "OnStart", kind: "behavior" as const }] : sel.kind === "screen" ? SCREEN_PROPS : selected ? propsOf(selected.control.type) : [];
  const formula = formulaOf(prop);
  const errorKey = sel.kind === "control" ? `${sel.id}.${prop}` : sel.kind === "screen" ? `${screen.id}.${prop}` : "";
  let formulaError = errorKey ? rt.errors.get(errorKey) ?? "" : "";
  try {
    parse(formula);
  } catch (e) {
    formulaError = errorOf(e);
  }

  return (
    <div className="studio">
      <header className="studio-bar">
        <a href="/" className="button" title="All apps">
          ←
        </a>
        <input className="app-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={(e) => void saveName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} aria-label="App name" />
        <button onClick={doUndo} disabled={!undo.current.length} title="Undo (Ctrl+Z)">
          ↶
        </button>
        <button onClick={doRedo} disabled={!redo.current.length} title="Redo (Ctrl+Y)">
          ↷
        </button>
        <InsertMenu onInsert={insert} />
        <span className="grow" />
        <span className={`save-state ${save}`} title={saveError}>
          {save === "saved" ? "Saved" : save === "saving" ? "Saving…" : save === "unsaved" ? "Unsaved changes" : `Not saved: ${saveError}`}
        </span>
        <button onClick={() => setPreview(true)} title="Preview (F5)">
          ▶ Preview
        </button>
        <button onClick={() => setDialog("versions")}>Versions</button>
        <button onClick={() => setDialog("share")}>Share</button>
        <button className="primary" onClick={() => void publish()} disabled={publishing}>
          {publishing ? "Publishing…" : "Publish"}
        </button>
      </header>

      <div className="formula-bar">
        <select value={prop} onChange={(e) => setProp(e.target.value)} aria-label="Property">
          {propList.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="fx">fx</span>
        <div className="formula-wrap">
          <textarea
            className={`formula${formulaError ? " bad" : ""}`}
            value={formula}
            spellCheck={false}
            rows={Math.min(8, Math.max(1, formula.split("\n").length))}
            onFocus={() => {
              undo.current = [...undo.current.slice(-99), def];
              redo.current = [];
            }}
            onChange={(e) => setFormula(prop, e.target.value, true)}
            aria-label="Formula"
          />
          {formulaError && <div className="formula-error">{formulaError}</div>}
        </div>
      </div>

      <div className="studio-body">
        <aside className="panel left">
          <div className="panel-tabs">
            <button className={left === "tree" ? "on" : ""} onClick={() => setLeft("tree")}>
              Tree view
            </button>
            <button className={left === "data" ? "on" : ""} onClick={() => setLeft("data")}>
              Data
            </button>
          </div>
          {left === "tree" ? (
            <div className="tree">
              <button className={`tree-item${sel.kind === "app" ? " on" : ""}`} onClick={() => (setSel({ kind: "app" }), setProp("OnStart"))}>
                ⚙ App
              </button>
              {def.screens.map((s, i) => (
                <div key={s.id}>
                  <div className={`tree-item screen${s.id === screen.id && sel.kind === "screen" ? " on" : ""}`}>
                    <button
                      className="tree-label"
                      onClick={() => {
                        setScreenId(s.id);
                        setSel({ kind: "screen" });
                        setProp("Fill");
                      }}
                    >
                      ▭ {s.name}
                    </button>
                    <span className="tree-actions">
                      <button onClick={() => moveScreen(s.id, -1)} disabled={i === 0} title="Move up">
                        ↑
                      </button>
                      <button onClick={() => moveScreen(s.id, 1)} disabled={i === def.screens.length - 1} title="Move down">
                        ↓
                      </button>
                      <button onClick={() => removeScreen(s.id)} disabled={def.screens.length < 2} title="Delete screen">
                        ×
                      </button>
                    </span>
                  </div>
                  {s.id === screen.id &&
                    [...s.controls].reverse().map((c) => (
                      <div key={c.id}>
                        <TreeControl c={c} depth={1} sel={sel} onSelect={selectControl} errors={rt.errors} />
                        {[...(c.children ?? [])].reverse().map((ch) => (
                          <TreeControl key={ch.id} c={ch} depth={2} sel={sel} onSelect={selectControl} errors={rt.errors} />
                        ))}
                      </div>
                    ))}
                </div>
              ))}
              <button className="add-screen" onClick={addScreen}>
                + New screen
              </button>
            </div>
          ) : (
            <DataPanel def={def} rt={rt} onAdd={() => setDialog("data")} onRemove={(n) => setDef((d) => ({ ...d, dataSources: d.dataSources.filter((x) => x.name !== n) }))} />
          )}
        </aside>

        <main
          className="stage"
          ref={stage}
          onPointerDown={() => {
            setSel({ kind: "screen" });
            if (!SCREEN_PROPS.some((p) => p.name === prop)) setProp("Fill");
          }}
        >
          <div className="stage-inner" style={{ width: def.width * scale, height: def.height * scale }}>
            <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0", width: def.width, height: def.height, position: "relative" }}>
              <Canvas rt={rt} screen={screen} design={designHooks} />
              {handle && (
                <div
                  className="resize-handle"
                  style={{ left: handle.left - 6, top: handle.top - 6, transform: `scale(${1 / scale})` }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    startDrag(selected!.control, e, "resize");
                  }}
                  title="Drag to resize"
                />
              )}
            </div>
          </div>
          <div className="zoom">
            <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom">
              <option value={0}>Fit ({Math.round(fit * 100)}%)</option>
              {[0.5, 0.75, 1, 1.25, 1.5].map((z) => (
                <option key={z} value={z}>
                  {z * 100}%
                </option>
              ))}
            </select>
          </div>
        </main>

        <aside className="panel right">
          <Properties
            key={sel.kind === "control" ? sel.id : sel.kind === "screen" ? screen.id : "app"}
            sel={sel}
            def={def}
            screen={screen}
            control={selected?.control ?? null}
            parent={selected?.parent ?? null}
            prop={prop}
            rt={rt}
            meta={meta}
            onPick={setProp}
            onFormula={(p, v) => setFormula(p, v)}
            onRename={rename}
            onFields={(fields) => selected && setDef((d) => withControl(d, selected.control.id, (c) => (c.fields = fields)))}
            onDelete={removeSelected}
            onDuplicate={duplicateSelected}
            onReorder={reorder}
            onLayout={(w, h) => setDef((d) => ({ ...d, width: w, height: h }))}
            onDescription={async (description) => {
              try {
                setMeta((await api<{ app: AppDetail }>(`/api/apps/${encodeURIComponent(id)}`, { method: "PATCH", body: { description } })).app);
              } catch (e) {
                rt.notify(errorOf(e), "Error");
              }
            }}
          />
        </aside>
      </div>

      <Toasts rt={rt} />
      {preview && (
        <div className="preview-overlay">
          <Running id={id} def={def} name={name} user={user} draft onClose={() => setPreview(false)} />
        </div>
      )}
      {dialog === "data" && <AddData onClose={() => setDialog(null)} onAdd={addSource} />}
      {dialog === "share" && <ShareDialog appId={id} me={user.email} published={meta.published} onClose={() => setDialog(null)} />}
      {dialog === "versions" && (
        <Versions
          appId={id}
          onClose={() => setDialog(null)}
          onRestore={(d) => {
            setDef(d);
            setScreenId(d.screens[0].id);
            setSel({ kind: "screen" });
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

const toNum = (s: string | undefined) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

function TreeControl({ c, depth, sel, onSelect, errors }: { c: Control; depth: number; sel: Sel; onSelect: (id: string) => void; errors: Map<string, string> }) {
  const bad = [...errors.keys()].some((k) => k.startsWith(`${c.id}.`));
  return (
    <button className={`tree-item${sel.kind === "control" && sel.id === c.id ? " on" : ""}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => onSelect(c.id)}>
      <span className="tree-icon">{CONTROLS[c.type].icon}</span> {c.name}
      {bad && (
        <span className="warn" title="A formula here has an error">
          ⚠
        </span>
      )}
    </button>
  );
}

function InsertMenu({ onInsert }: { onInsert: (t: ControlType) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="menu-wrap">
      <button onClick={() => setOpen(!open)} aria-expanded={open}>
        + Insert
      </button>
      {open && (
        <div className="menu" onMouseLeave={() => setOpen(false)}>
          {CONTROL_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => {
                onInsert(t);
                setOpen(false);
              }}
            >
              <span className="tree-icon">{CONTROLS[t].icon}</span> {CONTROLS[t].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Properties(props: {
  sel: Sel; def: AppDef; screen: Screen; control: Control | null; parent: Control | null; prop: string; rt: AppRuntime; meta: AppDetail;
  onPick: (p: string) => void; onFormula: (p: string, v: string) => void; onRename: (to: string) => string | null;
  onFields: (f: string[]) => void; onDelete: () => void; onDuplicate: () => void; onReorder: (to: "front" | "back") => void;
  onLayout: (w: number, h: number) => void; onDescription: (d: string) => void;
}) {
  const { sel, def, screen, control, prop, rt } = props;
  const [nameDraft, setNameDraft] = useState(control?.name ?? screen.name);
  const [nameError, setNameError] = useState("");
  if (sel.kind === "app") {
    const phone = def.width < def.height;
    return (
      <div className="props">
        <h3>App</h3>
        <label className="prop-row">
          <span>Description</span>
          <textarea defaultValue={props.meta.description} rows={3} onBlur={(e) => e.target.value !== props.meta.description && props.onDescription(e.target.value)} />
        </label>
        <label className="prop-row">
          <span>Layout</span>
          <select value={phone ? "phone" : "tablet"} onChange={(e) => (e.target.value === "phone" ? props.onLayout(640, 1136) : props.onLayout(1366, 768))}>
            <option value="tablet">Tablet (1366 × 768)</option>
            <option value="phone">Phone (640 × 1136)</option>
          </select>
        </label>
        <p className="muted small">OnStart runs when the app opens: load collections with ClearCollect, set variables with Set.</p>
        <button className={`prop-formula${prop === "OnStart" ? " on" : ""}`} onClick={() => props.onPick("OnStart")}>
          <span>OnStart</span>
          <code>{def.onStart || "(empty)"}</code>
        </button>
        <p className="muted small">
          {props.meta.published ? `Published version ${props.meta.publishedVersion}.` : "Not published yet."} Changes save as a draft until you publish.
        </p>
      </div>
    );
  }
  const list = sel.kind === "screen" ? SCREEN_PROPS : propsOf(control!.type);
  const formulas = sel.kind === "screen" ? screen.props : control!.props;
  const errKey = (p: string) => (sel.kind === "screen" ? `${screen.id}.${p}` : `${control!.id}.${p}`);
  return (
    <div className="props">
      <h3>{sel.kind === "screen" ? "Screen" : CONTROLS[control!.type].label}</h3>
      <label className="prop-row">
        <span>Name</span>
        <input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => {
            const err = props.onRename(nameDraft.trim());
            setNameError(err ?? "");
            if (err) setNameDraft(control?.name ?? screen.name);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </label>
      {nameError && <div className="error small">{nameError}</div>}
      {control && (
        <div className="prop-actions">
          <button onClick={props.onDuplicate} title="Ctrl+D">
            Duplicate
          </button>
          <button onClick={() => props.onReorder("front")}>To front</button>
          <button onClick={() => props.onReorder("back")}>To back</button>
          <button className="danger" onClick={props.onDelete} title="Delete">
            Delete
          </button>
        </div>
      )}
      {control?.type === "gallery" && <p className="muted small">Insert controls while the gallery is selected to add them to its template; ThisItem is the record each one shows.</p>}
      {control?.type === "form" && <FormFields control={control} def={def} rt={rt} onFields={props.onFields} />}
      {list.map((p) => (
        <button key={p.name} className={`prop-formula${prop === p.name ? " on" : ""}${rt.errors.has(errKey(p.name)) ? " bad" : ""}`} onClick={() => props.onPick(p.name)} title={p.hint}>
          <span>{p.name}</span>
          <code>{formulas[p.name] ?? p.default ?? ""}</code>
        </button>
      ))}
    </div>
  );
}

/** Which of the data source's fields a form shows, in order. */
function FormFields({ control, def, rt, onFields }: { control: Control; def: AppDef; rt: AppRuntime; onFields: (f: string[]) => void }) {
  const src = rt.formSource(control, { screenId: rt.screenId });
  const ds = src ?? def.dataSources.find((d) => d.name === control.props.DataSource?.trim());
  if (!ds) return <p className="muted small">Set DataSource to one of the app&apos;s data sources ({def.dataSources.map((d) => quoteName(d.name)).join(", ") || "add one under Data"}).</p>;
  const chosen = control.fields?.length ? control.fields : ds.fields.filter((f) => f.type !== "autonumber").map((f) => f.name);
  const toggle = (n: string) => onFields(chosen.includes(n) ? chosen.filter((x) => x !== n) : [...chosen, n]);
  const move = (n: string, by: number) => {
    const i = chosen.indexOf(n);
    const j = i + by;
    if (j < 0 || j >= chosen.length) return;
    const next = [...chosen];
    [next[i], next[j]] = [next[j], next[i]];
    onFields(next);
  };
  return (
    <div className="form-fields">
      <h4>Fields</h4>
      {chosen.map((n) => (
        <div key={n} className="field-row">
          <label>
            <input type="checkbox" checked onChange={() => toggle(n)} /> {n}
          </label>
          <button onClick={() => move(n, -1)}>↑</button>
          <button onClick={() => move(n, 1)}>↓</button>
        </div>
      ))}
      {ds.fields
        .filter((f) => !chosen.includes(f.name))
        .map((f) => (
          <div key={f.id} className="field-row off">
            <label>
              <input type="checkbox" checked={false} onChange={() => toggle(f.name)} /> {f.name}
            </label>
          </div>
        ))}
    </div>
  );
}

function DataPanel({ def, rt, onAdd, onRemove }: { def: AppDef; rt: AppRuntime; onAdd: () => void; onRemove: (name: string) => void }) {
  const [flows, setFlows] = useState<{ available: boolean; flows: { id: string; name: string; inputs: { name: string }[] }[]; error?: string } | null>(null);
  useEffect(() => {
    api("/api/flows").then(setFlows).catch(() => setFlows({ available: false, flows: [] }));
  }, []);
  return (
    <div className="data-panel">
      <button className="primary" onClick={onAdd}>
        + Add data
      </button>
      {!def.dataSources.length && <p className="muted small">Add a Synergy Base table to show and edit its records.</p>}
      {def.dataSources.map((d) => {
        const st = rt.sources.get(d.name);
        return (
          <div key={d.name} className="source">
            <div className="source-head">
              <strong>{d.name}</strong>
              <button onClick={() => void rt.load(d.name)} title="Reload records">
                ↻
              </button>
              <button
                onClick={() => {
                  if (confirm(`Remove ${d.name} from the app? Formulas that use it will show errors.`)) onRemove(d.name);
                }}
                title="Remove"
              >
                ×
              </button>
            </div>
            <div className="muted small">
              Base table {d.tableName} · {st?.status === "ready" ? `${st.rows.length} records` : st?.status === "error" ? st.error : "loading…"}
            </div>
            <div className="small fields-list">{d.fields.map((f) => quoteName(f.name)).join(", ")}</div>
          </div>
        );
      })}
      <h4>Flows</h4>
      {!flows ? (
        <p className="muted small">Loading…</p>
      ) : !flows.available ? (
        <p className="muted small">Synergy Flow isn&apos;t set up in this suite. When it is, buttons can run flows with RunFlow(&quot;Flow name&quot;, {"{...}"}).</p>
      ) : flows.error ? (
        <p className="error small">{flows.error}</p>
      ) : !flows.flows.length ? (
        <p className="muted small">No flows with a manual trigger yet. Make one in Synergy Flow, then run it from a button with RunFlow.</p>
      ) : (
        flows.flows.map((f) => (
          <div key={f.id} className="source">
            <strong>{f.name}</strong>
            <code className="small">
              RunFlow(&quot;{f.name}&quot;{f.inputs.length ? `, {${f.inputs.map((i) => `${quoteName(i.name)}: ...`).join(", ")}}` : ""})
            </code>
          </div>
        ))
      )}
    </div>
  );
}

/** Picks a Base table to add as a data source. */
export function AddData({ onClose, onAdd, title = "Add data", children }: { onClose: () => void; onAdd: (ds: Omit<DataSource, "name">) => void; title?: string; children?: React.ReactNode }) {
  const [dbs, setDbs] = useState<{ id: string; name: string }[] | null>(null);
  const [db, setDb] = useState<string>("");
  const [tables, setTables] = useState<{ id: string; name: string; fields: DataSource["fields"] }[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ databases: { id: string; name: string }[] }>("/api/bases")
      .then((r) => setDbs(r.databases))
      .catch((e) => setError(errorOf(e)));
  }, []);
  useEffect(() => {
    if (!db) return;
    setTables(null);
    api<{ tables: { id: string; name: string; fields: DataSource["fields"] }[] }>(`/api/bases/${encodeURIComponent(db)}`)
      .then((r) => setTables(r.tables))
      .catch((e) => setError(errorOf(e)));
  }, [db]);
  return (
    <Modal title={title} onClose={onClose}>
      {children}
      {error && <p className="error">{error}</p>}
      {!dbs ? (
        !error && <p className="muted">Loading your Base databases…</p>
      ) : !dbs.length ? (
        <p className="muted">
          You don&apos;t have any Synergy Base databases yet. Make one in Base, add a table, then come back.
        </p>
      ) : (
        <>
          <label className="prop-row">
            <span>Database</span>
            <select value={db} onChange={(e) => setDb(e.target.value)}>
              <option value="">Choose…</option>
              {dbs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          {db && !tables && <p className="muted">Loading tables…</p>}
          {tables && !tables.length && <p className="muted">This database has no tables yet.</p>}
          <div className="table-list">
            {tables?.map((t) => (
              <button key={t.id} onClick={() => onAdd({ kind: "base", databaseId: db, tableId: t.id, tableName: t.name, fields: t.fields })}>
                <strong>{t.name}</strong>
                <span className="muted small">{t.fields.map((f) => f.name).join(", ")}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

function Versions({ appId, onClose, onRestore }: { appId: string; onClose: () => void; onRestore: (d: AppDef) => void }) {
  const [list, setList] = useState<{ version: number; publishedBy: string; publishedAt: string }[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api(`/api/apps/${encodeURIComponent(appId)}/versions`)
      .then((r) => setList(r.versions))
      .catch((e) => setError(errorOf(e)));
  }, [appId]);
  const restore = async (v: number) => {
    if (!confirm(`Replace the draft with version ${v}? Publish afterwards to make it live.`)) return;
    try {
      const r = await api<{ app: AppDetail }>(`/api/apps/${encodeURIComponent(appId)}/versions/${v}`, { method: "POST" });
      onRestore(r.app.draft!);
    } catch (e) {
      setError(errorOf(e));
    }
  };
  return (
    <Modal title="Versions" onClose={onClose}>
      {error && <p className="error">{error}</p>}
      {list && !list.length && <p className="muted">Nothing published yet.</p>}
      <ul className="versions">
        {list?.map((v, i) => (
          <li key={v.version}>
            <span>
              <strong>Version {v.version}</strong> {i === 0 && <span className="badge">Live</span>}
              <br />
              <span className="muted small">
                {new Date(v.publishedAt).toLocaleString()} by {v.publishedBy}
              </span>
            </span>
            <button onClick={() => void restore(v.version)}>Restore to draft</button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="modal-back" onPointerDown={onClose}>
      <div className="modal" role="dialog" aria-label={title} onPointerDown={(e) => e.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
