"use client";

// Transitions & Animations pane (PowerPoint's Transitions and Animations tabs
// in one side panel): the current slide's transition and timing, the selected
// object's entrance effect, and the slide's animation order.
import { useRef } from "react";
import { ANIM_EFFECTS, EMPH_EFFECTS, EXIT_EFFECTS, PATH_PRESETS, TRANSITIONS, animKind, animTargets, effectLabel, effectsOf, htmlText, triggerOk, type Anim, type AnimEffect, type AnimKind, type AnimSound, type Slide, type Transition, type TransType } from "@/lib/slides/model";
import { BUILTIN_PREFIX, BUILTIN_SOUNDS, soundUrl } from "@/lib/slides/anim-sound";
import { reversePath } from "@/lib/slides/motion";

const field = "h-8 rounded-md text-sm text-slate-700 bg-white border border-slate-200 px-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 w-full";
const label = "text-[11px] uppercase tracking-wide text-slate-400 font-semibold";

const ANIM_DIRS: { id: NonNullable<Anim["dir"]>; label: string }[] = [
  { id: "b", label: "From bottom" },
  { id: "t", label: "From top" },
  { id: "l", label: "From left" },
  { id: "r", label: "From right" },
];
const TRANS_DIRS: { id: NonNullable<Transition["dir"]>; label: string }[] = [
  { id: "l", label: "From right" },
  { id: "r", label: "From left" },
  { id: "u", label: "From bottom" },
  { id: "d", label: "From top" },
];

export function targetLabel(s: Slide, key: string): string {
  if (key === "title") return `Title: ${s.title || "(empty)"}`;
  if (key === "body") return `Content: ${htmlText(s.body).slice(0, 40) || "(empty)"}`;
  const e = s.elements.find((x) => x.id === key);
  if (!e) return key;
  if (e.type === "text") return `Text: ${htmlText(e.html).slice(0, 40) || "(empty)"}`;
  if (e.type === "shape") return `${e.shape}${e.html ? `: ${htmlText(e.html).slice(0, 30)}` : ""}`;
  if (e.type === "image") return `Picture${e.alt ? `: ${e.alt}` : ""}`;
  if (e.type === "media") return `${e.kind === "audio" ? "Audio" : "Video"}${e.name ? `: ${e.name}` : ""}`;
  return e.type.charAt(0).toUpperCase() + e.type.slice(1);
}

export const animOf = (s: Slide, key: string): Anim | undefined => effectsOf(s, key)[0];

const KIND_LABEL: Record<AnimKind, string> = { entr: "Entrance", emph: "Emphasis", exit: "Exit", path: "Motion path" };
const KIND_DOT: Record<AnimKind, string> = { entr: "bg-emerald-500", emph: "bg-amber-400", exit: "bg-rose-500", path: "bg-sky-500" };
const effectsFor = (k: AnimKind) => (k === "exit" ? EXIT_EFFECTS : k === "emph" ? EMPH_EFFECTS : k === "path" ? [] : ANIM_EFFECTS);

/** A fresh effect of a class, placed last in the slide's sequence. */
function newEffect(kind: AnimKind, order: number): Anim {
  const base = { start: "click" as const, delay: 0, order };
  if (kind === "emph") return { ...base, kind: "emph", effect: "pulse", dur: 500 };
  if (kind === "exit") return { ...base, kind: "exit", effect: "fade", dur: 500 };
  if (kind === "path") return { ...base, kind: "path", effect: "path", dur: 2000, path: PATH_PRESETS[0].path };
  return { ...base, effect: "fade", dur: 500 };
}

/** What an effect can hook into besides its own object: other objects to trigger it, sounds, path drawing. */
type EffectTools = {
  /** objects on the slide that can trigger this one (key, label) */
  triggers: { key: string; label: string }[];
  /** draw a custom motion path for effect i (straight lines or a scribble), or edit its points */
  drawPath?: (i: number, mode: "lines" | "scribble") => void;
  editPath?: (i: number) => void;
  /** store a sound file and give the effect's sound */
  uploadSound?: (f: File) => Promise<AnimSound | null>;
};

function EffectEditor({ a, i, isBody, canEdit, onPatch, onRemove, tools }: { a: Anim; i: number; isBody: boolean; canEdit: boolean; onPatch: (p: Partial<Anim>) => void; onRemove: () => void; tools: EffectTools }) {
  const kind = animKind(a);
  const soundFile = useRef<HTMLInputElement>(null);
  const soundVal = !a.sound ? "" : a.sound.src.startsWith(BUILTIN_PREFIX) ? a.sound.src : "own";
  const btn = "rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40";
  const list = effectsFor(kind);
  const def = list.find((x) => x.id === a.effect) as { dirs?: boolean } | undefined;
  const preset = PATH_PRESETS.find((p) => p.path === a.path)?.id || "custom";
  const tid = (n: string) => (i === 0 ? n : `${n}-${i}`);
  return (
    <div className="rounded border border-slate-200 p-2 space-y-1.5" data-testid="anim-effect-card" data-kind={kind}>
      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <span className={`w-2 h-2 rounded-full ${KIND_DOT[kind]}`} />
        {KIND_LABEL[kind]}
        {canEdit && <button className="ml-auto text-slate-400 hover:text-rose-600" title="Remove effect" data-testid={tid("anim-remove")} onClick={onRemove}>✕</button>}
      </div>
      {kind === "path" ? (
        <select className={field} disabled={!canEdit} value={preset} data-testid={tid("anim-path")} onChange={(e) => { const p = PATH_PRESETS.find((x) => x.id === e.target.value); if (p) onPatch({ path: p.path }); }}>
          {PATH_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          {preset === "custom" && <option value="custom">Custom path</option>}
        </select>
      ) : (
        <select className={field} disabled={!canEdit} value={a.effect} data-testid={tid("anim-effect")} onChange={(e) => onPatch({ effect: e.target.value as AnimEffect })}>
          {list.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      )}
      {kind === "path" && canEdit && (
        <div className="flex flex-wrap gap-1">
          {tools.drawPath && <button type="button" className={btn} data-testid={tid("anim-path-draw-lines")} title="Draw a path of straight lines: click each corner, double-click or Enter to finish" onClick={() => tools.drawPath!(i, "lines")}>Draw lines</button>}
          {tools.drawPath && <button type="button" className={btn} data-testid={tid("anim-path-draw-scribble")} title="Draw a path freehand: drag from anywhere" onClick={() => tools.drawPath!(i, "scribble")}>Scribble</button>}
          {tools.editPath && <button type="button" className={btn} data-testid={tid("anim-path-edit")} title="Drag the path's points on the slide" onClick={() => tools.editPath!(i)}>Edit points</button>}
          <button type="button" className={btn} data-testid={tid("anim-path-reverse")} title="Reverse path direction" onClick={() => a.path && onPatch({ path: reversePath(a.path) })}>Reverse</button>
        </div>
      )}
      {def?.dirs && (
        <select className={field} disabled={!canEdit} value={a.dir || "b"} onChange={(e) => onPatch({ dir: e.target.value as Anim["dir"] })}>
          {ANIM_DIRS.map((x) => <option key={x.id} value={x.id}>{kind === "exit" ? x.label.replace("From", "To") : x.label}</option>)}
        </select>
      )}
      {a.effect === "grow" && (
        <label className="flex items-center gap-2 text-xs text-slate-600">Size (%)
          <input type="number" min={10} max={400} step={5} className={`${field} w-20`} disabled={!canEdit} data-testid={tid("anim-amount")} value={Math.round((a.amount || 1.5) * 100)} onChange={(e) => onPatch({ amount: Math.max(0.1, Math.min(4, Number(e.target.value) / 100 || 1.5)) })} />
        </label>
      )}
      <select className={field} disabled={!canEdit} value={a.start} data-testid={tid("anim-start")} onChange={(e) => onPatch({ start: e.target.value as Anim["start"] })}>
        <option value="click">On click</option>
        <option value="with">With previous</option>
        <option value="after">After previous</option>
      </select>
      <div className="flex gap-2">
        <label className="flex-1 text-xs text-slate-600">Duration (s)
          <input type="number" min={0.1} max={20} step={0.1} className={field} disabled={!canEdit || a.effect === "appear"} value={a.dur / 1000} onChange={(e) => onPatch({ dur: Math.round(Number(e.target.value) * 1000) || 500 })} />
        </label>
        <label className="flex-1 text-xs text-slate-600">Delay (s)
          <input type="number" min={0} max={60} step={0.1} className={field} disabled={!canEdit} value={a.delay / 1000} onChange={(e) => onPatch({ delay: Math.max(0, Math.round(Number(e.target.value) * 1000)) })} />
        </label>
      </div>
      <label className="block text-xs text-slate-600">Start on click of
        <select className={field} disabled={!canEdit} value={a.trigger && tools.triggers.some((t) => t.key === a.trigger) ? a.trigger : ""} data-testid={tid("anim-trigger")} onChange={(e) => onPatch({ trigger: e.target.value || undefined })}>
          <option value="">(the slide: click sequence)</option>
          {tools.triggers.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </label>
      <div className="flex items-end gap-1">
        <label className="flex-1 text-xs text-slate-600">Sound
          <select
            className={field}
            disabled={!canEdit}
            value={soundVal}
            data-testid={tid("anim-sound")}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "upload") return soundFile.current?.click();
              if (v === "own") return;
              const b = BUILTIN_SOUNDS.find((x) => `${BUILTIN_PREFIX}${x.id}` === v);
              onPatch({ sound: b ? { src: v, name: b.name } : undefined });
            }}
          >
            <option value="">No sound</option>
            {BUILTIN_SOUNDS.map((b) => <option key={b.id} value={`${BUILTIN_PREFIX}${b.id}`}>{b.name}</option>)}
            {soundVal === "own" && <option value="own">{a.sound?.name || "Own sound"}</option>}
            {tools.uploadSound && <option value="upload">Other sound…</option>}
          </select>
        </label>
        {a.sound && (
          <button type="button" className="h-8 px-2 rounded-md border border-slate-200 text-xs text-slate-600 hover:bg-slate-50" title="Play the sound" data-testid={tid("anim-sound-play")} onClick={() => { try { void new Audio(soundUrl(a.sound!.src)).play().catch(() => {}); } catch { /* no audio */ } }}>▶</button>
        )}
        <input
          ref={soundFile}
          type="file"
          accept="audio/*"
          className="hidden"
          data-testid={tid("anim-sound-file")}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f || !tools.uploadSound) return;
            const snd = await tools.uploadSound(f);
            if (snd) onPatch({ sound: snd });
          }}
        />
      </div>
      {isBody && (kind === "entr" || kind === "exit") && (
        <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" disabled={!canEdit} checked={!!a.byPara} onChange={(e) => onPatch({ byPara: e.target.checked || undefined })} /> One paragraph at a time</label>
      )}
    </div>
  );
}

export default function AnimPanel({
  slide,
  selKey,
  canEdit,
  setAnim,
  setTrans,
  applyTransAll,
  reorder,
  select,
  preview,
  onClose,
  drawPath,
  editPath,
  uploadSound,
}: {
  slide: Slide;
  selKey: string | null;
  canEdit: boolean;
  /** set (or with null remove) effect `idx` of a target; idx = its current count appends */
  setAnim: (key: string, a: Anim | null, idx?: number) => void;
  setTrans: (t: Transition | null) => void;
  applyTransAll: () => void;
  reorder: (key: string, idx: number, dir: -1 | 1) => void;
  select: (key: string) => void;
  preview: () => void;
  onClose: () => void;
  /** custom motion paths for the selected object's effect i */
  drawPath?: (i: number, mode: "lines" | "scribble") => void;
  editPath?: (i: number) => void;
  uploadSound?: (f: File) => Promise<AnimSound | null>;
}) {
  const t: Transition = slide.trans || { type: "none", dur: 700 };
  const patchT = (p: Partial<Transition>) => {
    const n = { ...t, ...p };
    if (TRANSITIONS.find((x) => x.id === n.type)?.dirs && !n.dir) n.dir = "l";
    setTrans(n.type === "none" && !n.advAfter && n.advClick !== false ? null : n);
  };
  const tDef = TRANSITIONS.find((x) => x.id === t.type);
  const effects = selKey ? effectsOf(slide, selKey) : [];
  const list = animTargets(slide);
  const nextOrder = Math.max(0, ...list.map((x) => x.anim.order)) + 1;
  const patchA = (i: number, p: Partial<Anim>) => {
    if (!selKey) return;
    const n = { ...effects[i], ...p };
    if (effectsFor(animKind(n)).find((x) => x.id === n.effect && (x as { dirs?: boolean }).dirs) && !n.dir) n.dir = "b";
    setAnim(selKey, n, i);
  };
  const add = (kind: AnimKind) => selKey && setAnim(selKey, newEffect(kind, nextOrder), effects.length);
  // any other object on the slide can trigger the selected one's effects
  const triggers = [
    ...(slide.layout !== "blank" ? ["title"] : []),
    ...(slide.layout !== "blank" && slide.layout !== "titleOnly" ? ["body"] : []),
    ...slide.elements.map((e) => e.id),
  ]
    .filter((k) => k !== selKey)
    .map((k) => ({ key: k, label: targetLabel(slide, k) }));
  const tools: EffectTools = { triggers, drawPath, editPath, uploadSound };
  return (
    <aside className="w-64 shrink-0 border-l border-slate-200 bg-white overflow-y-auto p-3 space-y-4 text-sm no-print" data-testid="anim-panel">
      <div className="flex items-center">
        <span className="font-semibold text-slate-800">Transitions & animations</span>
        <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700" aria-label="Close">✕</button>
      </div>

      <section className="space-y-2">
        <div className={label}>Slide transition</div>
        <select className={field} disabled={!canEdit} value={t.type} data-testid="trans-type" onChange={(e) => patchT({ type: e.target.value as TransType })}>
          {TRANSITIONS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
        {tDef?.dirs && (
          <select className={field} disabled={!canEdit} value={t.dir || "l"} onChange={(e) => patchT({ dir: e.target.value as Transition["dir"] })}>
            {TRANS_DIRS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        )}
        {t.type !== "none" && (
          <label className="flex items-center gap-2 text-xs text-slate-600">
            Duration (s)
            <input type="number" min={0.1} max={10} step={0.1} className={`${field} w-20`} disabled={!canEdit} value={t.dur / 1000} onChange={(e) => patchT({ dur: Math.round(Number(e.target.value) * 1000) || 700 })} />
          </label>
        )}
        <div className="text-xs text-slate-600 space-y-1">
          <div>Advance slide</div>
          <label className="flex items-center gap-2"><input type="checkbox" disabled={!canEdit} checked={t.advClick !== false} onChange={(e) => patchT({ advClick: e.target.checked ? undefined : false })} /> On mouse click</label>
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={!canEdit} checked={!!t.advAfter} onChange={(e) => patchT({ advAfter: e.target.checked ? 5000 : undefined })} /> After
            <input type="number" min={0} step={0.5} className={`${field} w-16`} disabled={!canEdit || !t.advAfter} value={(t.advAfter || 0) / 1000} onChange={(e) => patchT({ advAfter: Math.max(0, Math.round(Number(e.target.value) * 1000)) || undefined })} /> s
          </label>
        </div>
        <button className="text-xs text-indigo-600 hover:underline disabled:opacity-40" disabled={!canEdit} onClick={applyTransAll}>Apply to all slides</button>
      </section>

      <section className="space-y-2">
        <div className={label}>Animation</div>
        {!selKey ? (
          <div className="text-xs text-slate-400">Select an object on the slide to animate it.</div>
        ) : (
          <>
            <div className="text-xs text-slate-500 truncate">{targetLabel(slide, selKey)}</div>
            {!effects.length && (
              <select className={field} disabled={!canEdit} value="" data-testid="anim-effect" onChange={(e) => e.target.value && setAnim(selKey, { ...newEffect("entr", nextOrder), effect: e.target.value as AnimEffect, ...(e.target.value === "fly" || e.target.value === "wipe" ? { dir: "b" as const } : {}) }, 0)}>
                <option value="">None</option>
                {ANIM_EFFECTS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            )}
            {effects.map((a, i) => (
              <EffectEditor key={i} a={a} i={i} isBody={selKey === "body"} canEdit={canEdit} tools={tools} onPatch={(p) => patchA(i, p)} onRemove={() => setAnim(selKey, null, i)} />
            ))}
            {canEdit && (
              <div className="flex flex-wrap gap-1">
                {(["entr", "emph", "exit", "path"] as AnimKind[]).map((k) => (
                  <button key={k} type="button" data-testid={`anim-add-${k}`} className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50" onClick={() => add(k)}>
                    <span className={`w-1.5 h-1.5 rounded-full ${KIND_DOT[k]}`} />+ {KIND_LABEL[k]}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section className="space-y-1">
        <div className="flex items-center">
          <span className={label}>Animation order</span>
          <button className="ml-auto text-xs text-indigo-600 hover:underline" onClick={preview} data-testid="anim-preview">▶ Preview</button>
        </div>
        {!list.length && <div className="text-xs text-slate-400">No animations on this slide.</div>}
        {list.map((x, i) => (
          <div key={`${x.key}#${x.idx}`} className={`flex items-center gap-1 rounded px-1 py-1 cursor-pointer ${x.key === selKey ? "bg-indigo-50" : "hover:bg-slate-50"}`} onClick={() => select(x.key)} data-testid="anim-row">
            <span className="w-5 text-[11px] text-slate-400 tabular-nums" title={x.anim.trigger ? `On click of ${targetLabel(slide, x.anim.trigger)}` : undefined}>{triggerOk(slide, x.anim.trigger) ? "⚡" : x.anim.start === "click" ? i + 1 : ""}</span>
            {x.anim.sound && <span className="text-[10px] text-slate-400" title={`Sound: ${x.anim.sound.name || "sound"}`}>♪</span>}
            <span className="flex-1 min-w-0 truncate text-xs text-slate-700">{targetLabel(slide, x.key)}</span>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${KIND_DOT[animKind(x.anim)]}`} />
            <span className="text-[10px] text-slate-400">{effectLabel(x.anim)}</span>
            {canEdit && (
              <>
                <button className="text-[10px] text-slate-400 hover:text-slate-700 px-0.5" onClick={(e) => { e.stopPropagation(); reorder(x.key, x.idx, -1); }}>↑</button>
                <button className="text-[10px] text-slate-400 hover:text-slate-700 px-0.5" onClick={(e) => { e.stopPropagation(); reorder(x.key, x.idx, 1); }}>↓</button>
              </>
            )}
          </div>
        ))}
      </section>
    </aside>
  );
}
