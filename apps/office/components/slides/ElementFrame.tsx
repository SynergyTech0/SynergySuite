"use client";

// Selection chrome for anything positioned on the slide: move by dragging,
// resize from eight handles (Shift keeps proportions; pictures keep them by
// default), snap to the slide's centre lines and edges. While dragging, the box
// lives in local state; the result is committed once on pointer-up so a drag
// is a single collaborative change.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { rotationFrom } from "@/lib/slides/selection";
import type { Box } from "@/lib/slides/model";

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
type Handle = (typeof HANDLES)[number];

const CURSOR: Record<Handle, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };

function handlePos(h: Handle): CSSProperties {
  const p: CSSProperties = {};
  if (h.includes("n")) p.top = -5;
  else if (h.includes("s")) p.bottom = -5;
  else p.top = "calc(50% - 5px)";
  if (h.includes("w")) p.left = -5;
  else if (h.includes("e")) p.right = -5;
  else p.left = "calc(50% - 5px)";
  return p;
}

export default function ElementFrame({
  box,
  z,
  rot,
  scale,
  selected,
  showHandles = true,
  canEdit,
  movableFromBody,
  lockAspect,
  minH = 8,
  snap,
  onSelect,
  onCommit,
  onPreview,
  onDoubleClick,
  children,
  testId,
  elId,
  onRotate,
}: {
  box: Box;
  z: number;
  rot?: number;
  scale: number;
  selected: boolean;
  showHandles?: boolean;
  canEdit: boolean;
  /** true: dragging anywhere moves it; false: only the border moves it (content stays editable) */
  movableFromBody: boolean;
  lockAspect?: boolean;
  minH?: number;
  snap: (b: Box, moving: boolean) => Box;
  onSelect: (e: React.PointerEvent) => void;
  onCommit: (b: Box) => void;
  onPreview?: (b: Box | null) => void;
  onDoubleClick?: () => void;
  children: ReactNode;
  testId?: string;
  elId?: string;
  onRotate?: (deg: number) => void;
}) {
  const [live, setLive] = useState<Box | null>(null);
  const [liveRot, setLiveRot] = useState<number | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: "move" | Handle; sx: number; sy: number; start: Box; moved: boolean } | null>(null);
  const liveRef = useRef<Box | null>(null);
  const b = live || box;
  const r = liveRot ?? rot;

  useEffect(() => () => {
    drag.current = null;
  }, []);

  const begin = (kind: "move" | Handle) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect(e);
    if (e.shiftKey || e.ctrlKey || e.metaKey) return;
    if (!canEdit) return;
    e.preventDefault();
    drag.current = { kind, sx: e.clientX, sy: e.clientY, start: { ...box }, moved: false };
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = (ev.clientX - d.sx) / scale;
      const dy = (ev.clientY - d.sy) / scale;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
      d.moved = true;
      const s = d.start;
      let n: Box;
      if (d.kind === "move") n = snap({ ...s, x: s.x + dx, y: s.y + dy }, true);
      else {
        let { x, y, w, h } = s;
        if (d.kind.includes("e")) w = s.w + dx;
        if (d.kind.includes("s")) h = s.h + dy;
        if (d.kind.includes("w")) {
          w = s.w - dx;
          x = s.x + dx;
        }
        if (d.kind.includes("n")) {
          h = s.h - dy;
          y = s.y + dy;
        }
        const corner = d.kind.length === 2;
        if ((lockAspect !== ev.shiftKey) && corner && s.w > 0 && s.h > 0) {
          const r = s.w / s.h;
          if (Math.abs(w / s.w) > Math.abs(h / s.h)) {
            const nh = w / r;
            if (d.kind.includes("n")) y = s.y + s.h - nh;
            h = nh;
          } else {
            const nw = h * r;
            if (d.kind.includes("w")) x = s.x + s.w - nw;
            w = nw;
          }
        }
        if (w < 8) {
          if (d.kind.includes("w")) x -= 8 - w;
          w = 8;
        }
        if (h < minH) {
          if (d.kind.includes("n")) y -= minH - h;
          h = minH;
        }
        n = snap({ x, y, w, h }, false);
      }
      liveRef.current = n;
      setLive(n);
      if (d.kind === "move") onPreview?.(n);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const d = drag.current;
      drag.current = null;
      const cur = liveRef.current;
      liveRef.current = null;
      setLive(null);
      onPreview?.(null);
      if (d?.moved && cur) onCommit({ x: Math.round(cur.x * 10) / 10, y: Math.round(cur.y * 10) / 10, w: Math.round(cur.w * 10) / 10, h: Math.round(cur.h * 10) / 10 });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const beginRotate = (e: React.PointerEvent) => {
    if (e.button !== 0 || !onRotate) return;
    e.stopPropagation();
    e.preventDefault();
    const rc = frameRef.current?.getBoundingClientRect();
    if (!rc) return;
    // the bounding rect of a rotated box shares its centre
    const cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2;
    let last: number | null = null;
    const move = (ev: PointerEvent) => {
      last = rotationFrom(cx, cy, ev.clientX, ev.clientY, ev.shiftKey);
      setLiveRot(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setLiveRot(null);
      if (last !== null) onRotate(last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const inv = 1 / scale;
  const strip = 6 * inv;
  return (
    <div
      ref={frameRef}
      data-testid={testId}
      data-el-id={elId}
      data-selected={selected ? "1" : undefined}
      style={{ position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, zIndex: z, transform: r ? `rotate(${r}deg)` : undefined, cursor: movableFromBody && canEdit ? "move" : undefined }}
      onPointerDown={movableFromBody ? begin("move") : (e) => { e.stopPropagation(); onSelect(e); }}
      onDoubleClick={onDoubleClick}
    >
      {children}
      {(selected || !movableFromBody) && (
        <div
          className="slide-frame"
          style={{ position: "absolute", inset: 0, pointerEvents: "none", outline: selected ? `${1.5 * inv}px solid #4f46e5` : `${1 * inv}px dashed rgba(100,116,139,0.45)`, outlineOffset: 0 }}
        />
      )}
      {canEdit && !movableFromBody &&
        (["top", "bottom", "left", "right"] as const).map((side) => (
          <div
            key={side}
            onPointerDown={begin("move")}
            style={{
              position: "absolute",
              cursor: "move",
              ...(side === "top" || side === "bottom" ? { left: 0, right: 0, height: strip, [side]: -strip / 2 } : { top: 0, bottom: 0, width: strip, [side]: -strip / 2 }),
            }}
          />
        ))}
      {selected && showHandles && canEdit && onRotate && (
        <>
          <div style={{ position: "absolute", left: "50%", top: -22 * inv, width: inv, height: 22 * inv, background: "#4f46e5", pointerEvents: "none" }} />
          <div
            data-handle="rot"
            title="Rotate (Shift: 15° steps)"
            onPointerDown={beginRotate}
            style={{ position: "absolute", left: "calc(50% - 6px)", top: -22 * inv - 6, width: 12, height: 12, transform: `scale(${inv})`, background: "#fff", border: "1.5px solid #4f46e5", borderRadius: "50%", cursor: "grab", zIndex: 2 }}
          />
          {liveRot !== null && (
            <div style={{ position: "absolute", left: "50%", top: -48 * inv, transform: `translateX(-50%) rotate(${-liveRot}deg) scale(${inv})`, pointerEvents: "none" }} className="bg-slate-800 text-white text-[11px] rounded px-1 tabular-nums whitespace-nowrap">
              {Math.round(liveRot)}°
            </div>
          )}
        </>
      )}
      {selected && showHandles && canEdit &&
        HANDLES.map((h) => (
          <div
            key={h}
            data-handle={h}
            onPointerDown={begin(h)}
            style={{
              position: "absolute",
              width: 10,
              height: 10,
              ...handlePos(h),
              transform: `scale(${inv})`,
              background: "#fff",
              border: "1.5px solid #4f46e5",
              borderRadius: 2,
              cursor: CURSOR[h],
              zIndex: 2,
            }}
          />
        ))}
    </div>
  );
}
