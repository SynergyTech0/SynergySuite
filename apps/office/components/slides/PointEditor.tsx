"use client";

// Edit Points on a freeform: drag anchors (squares) and curve handles
// (circles); double-click an anchor to delete it, or the outline to add one.
import { useEffect, useRef, useState } from "react";
import { deleteVertex, insertVertex, parseD, pathPoints, refit, scaledD, setPoint, type Geom } from "@/lib/slides/freeform";
import type { Box, ShapeEl } from "@/lib/slides/model";

export function PointEditor({ el, scale, onChange }: { el: ShapeEl & { geom: Geom }; scale: number; onChange: (v: { geom: Geom; box: Box }) => void }) {
  const [live, setLive] = useState<Geom | null>(null);
  const g = live || el.geom;
  const sx = el.w / (g.w || 1), sy = el.h / (g.h || 1);
  const inv = 1 / scale;
  const drag = useRef<{ cmd: number; pair: number; x0: number; y0: number; px: number; py: number } | null>(null);
  useEffect(() => setLive(null), [el.geom.d, el.w, el.h]);
  const toGeom = (dx: number, dy: number) => {
    // screen px -> slide px (undo the zoom and the shape's rotation) -> path units
    const t = (-(el.rot || 0) * Math.PI) / 180;
    const ux = (dx * Math.cos(t) - dy * Math.sin(t)) * inv, uy = (dx * Math.sin(t) + dy * Math.cos(t)) * inv;
    return [ux / sx * (el.flipH ? -1 : 1), uy / sy * (el.flipV ? -1 : 1)];
  };
  const down = (cmd: number, pair: number, x: number, y: number) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    drag.current = { cmd, pair, x0: e.clientX, y0: e.clientY, px: x, py: y };
    let last: Geom | null = null;
    const move = (ev: PointerEvent) => {
      const d = drag.current!;
      const [gx, gy] = toGeom(ev.clientX - d.x0, ev.clientY - d.y0);
      last = setPoint(el.geom, d.cmd, d.pair, d.px + gx, d.py + gy);
      setLive(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      drag.current = null;
      if (last) onChange(refit(last, el));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const pts = pathPoints(g);
  const cmds = parseD(g.d);
  // one invisible stroke per segment, to add a point where it is double-clicked
  const segs: { cmd: number; d: string }[] = [];
  let at: number[] | null = null;
  cmds.forEach((c, k) => {
    if (c.c !== "M" && c.c !== "Z" && at) {
      const p = c.p.map((v, i) => (i % 2 ? v * sy : v * sx));
      segs.push({ cmd: k, d: `M${at[0] * sx} ${at[1] * sy} ${c.c}${p.join(" ")}` });
    }
    if (c.p.length) at = c.p.slice(-2);
  });
  const flip = el.flipH || el.flipV ? `scale(${el.flipH ? -1 : 1}, ${el.flipV ? -1 : 1})` : undefined;
  return (
    <div data-testid="point-editor" style={{ position: "absolute", left: el.x, top: el.y, width: el.w, height: el.h, transform: `${el.rot ? `rotate(${el.rot}deg)` : ""} ${flip || ""}`.trim() || undefined, zIndex: 60000, pointerEvents: "none" }} onPointerDown={(e) => e.stopPropagation()}>
      <svg width={el.w} height={el.h} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <path d={scaledD(g, el.w, el.h)} fill="none" stroke="#4f46e5" strokeWidth={1.5 * inv} strokeDasharray={`${4 * inv} ${3 * inv}`} />
        {segs.map((s) => (
          <path key={s.cmd} data-testid="pt-seg" data-cmd={s.cmd} d={s.d} fill="none" stroke="transparent" strokeWidth={10 * inv} style={{ pointerEvents: "stroke", cursor: "copy" }} onDoubleClick={(e) => { e.stopPropagation(); onChange(refit(insertVertex(el.geom, s.cmd), el)); }} />
        ))}
        {pts.filter((p) => p.ctrl).map((p) => {
          // a handle's line runs to the anchor it belongs to
          const c = cmds[p.cmd];
          const prev = cmds.slice(0, p.cmd).reverse().find((x) => x.p.length);
          const anchor = p.pair === 0 ? prev?.p.slice(-2) : c.p.slice(-2);
          return anchor ? <line key={`l${p.cmd}-${p.pair}`} x1={anchor[0] * sx} y1={anchor[1] * sy} x2={p.x * sx} y2={p.y * sy} stroke="#94a3b8" strokeWidth={inv} /> : null;
        })}
      </svg>
      {pts.map((p) => (
        <div
          key={`${p.cmd}-${p.pair}`}
          data-testid={p.ctrl ? "pt-ctrl" : "pt-anchor"}
          data-cmd={p.cmd}
          title={p.ctrl ? "Curve handle" : "Point: drag to move, double-click to delete"}
          onPointerDown={down(p.cmd, p.pair, p.x, p.y)}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (p.ctrl) return;
            const next = deleteVertex(el.geom, p.cmd);
            if (next) onChange(refit(next, el));
          }}
          style={{ position: "absolute", left: p.x * sx - 5, top: p.y * sy - 5, width: 10, height: 10, transform: `scale(${inv})`, background: p.ctrl ? "#fff" : "#4f46e5", border: "1.5px solid #4f46e5", borderRadius: p.ctrl ? "50%" : 1, cursor: "move", pointerEvents: "auto" }}
        />
      ))}
    </div>
  );
}
