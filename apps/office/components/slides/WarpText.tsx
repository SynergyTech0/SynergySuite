"use client";

// WordArt Transform on the slide: the text of a box drawn along its warp's
// path (stretched to fill it, as PowerPoint does), with its WordArt effects.
import { useId } from "react";
import { htmlText, type WordArt } from "@/lib/slides/model";
import { firstRunStyle, type WarpKind } from "@/lib/slides/warp";
import { gradientVector, validGradient } from "@/lib/slides/effects";

export function WarpText({ warp, html, w, h, wa, font, color, defaultPx }: { warp: WarpKind; html: string; w: number; h: number; wa?: WordArt; font: string; color: string; defaultPx: number }) {
  const id = useId().replace(/:/g, "");
  const text = htmlText(html).replace(/\s+/g, " ").trim();
  if (!text || !warp.path) return null;
  const st = firstRunStyle(html);
  const px = Math.min(st.px || defaultPx, h * 0.45);
  const d = warp.path(w, h);
  const grad = wa?.grad && validGradient(wa.grad) ? wa.grad : undefined;
  const gv = grad ? gradientVector(grad.angle) : undefined;
  const shadow = wa?.shadow ? `drop-shadow(${Math.round(Math.cos((wa.shadow.dir * Math.PI) / 180) * wa.shadow.dist)}px ${Math.round(Math.sin((wa.shadow.dir * Math.PI) / 180) * wa.shadow.dist)}px ${wa.shadow.blur / 2}px rgba(0,0,0,${wa.shadow.alpha}))` : "";
  const glow = wa?.glow ? `drop-shadow(0 0 ${wa.glow.r / 2}px #${wa.glow.c})` : "";
  return (
    <svg data-warp={warp.id} width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: "absolute", inset: 0, overflow: "visible", filter: [glow, shadow].filter(Boolean).join(" ") || undefined }}>
      <defs>
        <path id={`wp${id}`} d={d} />
        {grad && gv && (
          <linearGradient id={`wg${id}`} x1={gv.x1} y1={gv.y1} x2={gv.x2} y2={gv.y2}>
            {grad.stops.map((s, k) => <stop key={k} offset={`${s.pos}%`} stopColor={`#${s.color}`} />)}
          </linearGradient>
        )}
      </defs>
      <text
        fontFamily={st.font || font}
        fontSize={px}
        fontWeight={st.bold ? 700 : undefined}
        fontStyle={st.italic ? "italic" : undefined}
        fill={grad ? `url(#wg${id})` : `#${st.color || color}`}
        stroke={wa?.stroke ? `#${wa.stroke.c}` : undefined}
        strokeWidth={wa?.stroke ? wa.stroke.w : undefined}
        paintOrder="stroke"
        dominantBaseline="alphabetic"
      >
        <textPath href={`#wp${id}`} textLength={pathLength(d)} lengthAdjust="spacingAndGlyphs" startOffset="0">
          {text}
        </textPath>
      </text>
    </svg>
  );
}

/** Approximate length of a warp path (lines, arcs and curves sampled), for textLength. */
export function pathLength(d: string): number {
  if (typeof document !== "undefined") {
    try {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", d);
      const n = p.getTotalLength?.();
      if (n && Number.isFinite(n)) return Math.round(n * 0.96);
    } catch {
      /* fall through */
    }
  }
  const nums = (d.match(/-?[\d.]+/g) || []).map(Number);
  return Math.round(Math.abs((nums[nums.length - 2] ?? 0) - (nums[0] ?? 0)) * 1.1);
}
