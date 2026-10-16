"use client";

// One shape or text box over the grid. Univer places, moves and resizes the
// box (it is a floating DOM drawing); this draws the outline and the text.
// Double-clicking asks the sheet to open Format shape for it.
import { useEffect, useRef, useState } from "react";
import { shapeParts, type ShapeData } from "@/lib/sheet-shapes";

/** Set by the sheet: opens the format dialog for a shape (by drawing id). */
export const shapeEvents: { edit: ((drawingId: string) => void) | null } = { edit: null };

export default function SheetShape({ data, floatDomId }: { data?: ShapeData; floatDomId?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (!data) return null;
  if (data.kind === "group")
    return (
      <div ref={box} data-sheet-shape="group" title={data.name} onDoubleClick={() => floatDomId && shapeEvents.edit?.(floatDomId)} style={{ position: "absolute", inset: 0 }}>
        {(data.children || []).map((c, i) => (
          <div key={i} style={{ position: "absolute", left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }}>
            <SheetShape data={c.data} />
          </div>
        ))}
      </div>
    );
  const lw = data.line ? Math.max(0.5, (data.lineWidth * 96) / 72) : 0;
  const pad = lw / 2;
  const w = Math.max(0, size.w - lw);
  const h = Math.max(0, size.h - lw);
  const justify = data.vAlign === "t" ? "flex-start" : data.vAlign === "b" ? "flex-end" : "center";
  return (
    <div
      ref={box}
      data-sheet-shape={data.kind}
      title={data.name}
      onDoubleClick={() => floatDomId && shapeEvents.edit?.(floatDomId)}
      style={{ position: "absolute", inset: 0, overflow: "visible" }}
    >
      <svg width={size.w} height={size.h} style={{ position: "absolute", inset: 0, overflow: "visible" }} aria-hidden="true">
        {w > 0 && h > 0 && (
          // Fills first, then outlines, so a preset's inner lines show over its body.
          <g transform={`translate(${pad} ${pad})`}>
            {shapeParts(data, w, h).map((part, i) => part.fill && data.kind !== "line" && data.fill ? <path key={`f${i}`} d={part.d} fill={data.fill} stroke="none" /> : null)}
            {shapeParts(data, w, h).map((part, i) => (part.stroke && data.line ? <path key={`s${i}`} d={part.d} fill="none" stroke={data.line} strokeWidth={lw} strokeLinejoin="round" /> : null))}
          </g>
        )}
      </svg>
      {data.kind !== "line" && data.text && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            padding: "4px 8px",
            display: "flex",
            flexDirection: "column",
            justifyContent: justify,
            textAlign: data.align === "l" ? "left" : data.align === "r" ? "right" : "center",
            color: data.color,
            fontSize: `${data.fontSize}pt`,
            fontWeight: data.bold ? 700 : 400,
            fontStyle: data.italic ? "italic" : "normal",
            fontFamily: "Calibri, Carlito, Arial, sans-serif",
            lineHeight: 1.2,
            whiteSpace: "pre-wrap",
            overflow: "hidden",
            pointerEvents: "none",
          }}
        >
          {data.text}
        </div>
      )}
    </div>
  );
}
