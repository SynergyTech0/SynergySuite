"use client";
/**
 * The relationships diagram, as in Access: each table as a box listing its fields, and a line
 * from every lookup field to the ID of the table it looks up, marked one (1) to many (∞), or many
 * to many for a multi-value lookup. Boxes
 * can be dragged; double-click one to open the table.
 */
import { useMemo, useRef, useState } from "react";
import type { TableInfo } from "@/lib/catalog";
import { isLookup, type Field } from "@/lib/fields";
import { ON_DELETE_LABELS } from "./Datasheet";

const W = 200;

/** What deleting a related record does to the lookup. */
const ruleLabel = (f: Field) => (f.type === "multilookup" ? "Take it off the list" : ON_DELETE_LABELS[f.options.onDelete ?? "restrict"]);
const HEAD = 30;
const ROW = 22;
const GAP_X = 90;
const GAP_Y = 50;
const PER_ROW = 4;

type Pos = Record<string, { x: number; y: number }>;

function initialLayout(tables: TableInfo[]): Pos {
  const pos: Pos = {};
  let y = 20;
  for (let i = 0; i < tables.length; i += PER_ROW) {
    const row = tables.slice(i, i + PER_ROW);
    row.forEach((t, j) => (pos[t.id] = { x: 20 + j * (W + GAP_X), y }));
    y += Math.max(...row.map((t) => HEAD + t.fields.length * ROW)) + GAP_Y;
  }
  return pos;
}

export function Relationships({ tables, onOpen }: { tables: TableInfo[]; onOpen: (id: string) => void }) {
  const [pos, setPos] = useState<Pos>(() => initialLayout(tables));
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const at = (id: string) => pos[id] ?? initialLayout(tables)[id] ?? { x: 20, y: 20 };

  const links = useMemo(
    () =>
      tables.flatMap((t) =>
        t.fields
          .filter((f) => isLookup(f) && tables.some((x) => x.id === f.options.targetTable))
          .map((f) => ({ from: t, field: f, to: tables.find((x) => x.id === f.options.targetTable)! })),
      ),
    [tables],
  );

  const width = Math.max(...tables.map((t) => at(t.id).x + W), 600) + 40;
  const height = Math.max(...tables.map((t) => at(t.id).y + HEAD + t.fields.length * ROW), 300) + 40;

  function point(e: React.PointerEvent) {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  return (
    <div className="relationships">
      {tables.length === 0 ? (
        <p className="muted">Add tables, then a Lookup field, to see how they relate.</p>
      ) : (
        <svg
          ref={svgRef}
          width={width}
          height={height}
          role="img"
          aria-label="Relationships between tables"
          onPointerMove={(e) => {
            if (!drag.current) return;
            const p = point(e);
            const { id, dx, dy } = drag.current;
            setPos((prev) => ({ ...prev, [id]: { x: Math.max(0, p.x - dx), y: Math.max(0, p.y - dy) } }));
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerLeave={() => (drag.current = null)}
        >
          {links.map(({ from, field, to }) => {
            const a = at(from.id);
            const b = at(to.id);
            const fy = a.y + HEAD + from.fields.findIndex((x) => x.id === field.id) * ROW + ROW / 2;
            const ty = b.y + HEAD + Math.max(0, to.fields.findIndex((x) => x.type === "autonumber")) * ROW + ROW / 2;
            // Leave from whichever side faces the other box; a table looking itself up loops on the right.
            const self = from.id === to.id;
            const right = self || b.x >= a.x + W / 2;
            const x1 = right ? a.x + W : a.x;
            const x2 = self ? b.x + W : right ? b.x : b.x + W;
            const bend = self ? 60 : Math.max(40, Math.abs(x2 - x1) / 2);
            const c1 = right ? x1 + bend : x1 - bend;
            const c2 = self ? x2 + bend : right ? x2 - bend : x2 + bend;
            return (
              <g key={field.id} className="rel-link">
                <title>{`${from.name}.${field.name} → ${to.name}: ${ruleLabel(field)}`}</title>
                <path d={`M ${x1} ${fy} C ${c1} ${fy}, ${c2} ${ty}, ${x2} ${ty}`} fill="none" />
                <text x={x1 + (right ? 6 : -14)} y={fy - 4}>∞</text>
                <text x={x2 + (right && !self ? -12 : 6)} y={ty - 4}>{field.type === "multilookup" ? "∞" : "1"}</text>
              </g>
            );
          })}
          {tables.map((t) => {
            const { x, y } = at(t.id);
            return (
              <g
                key={t.id}
                className="rel-box"
                transform={`translate(${x} ${y})`}
                onPointerDown={(e) => {
                  const p = point(e);
                  drag.current = { id: t.id, dx: p.x - x, dy: p.y - y };
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                }}
                onDoubleClick={() => onOpen(t.id)}
              >
                <rect width={W} height={HEAD + t.fields.length * ROW} rx={6} className="box" />
                <rect width={W} height={HEAD} rx={6} className="head" />
                <text x={10} y={20} className="title">
                  {t.name}
                </text>
                {t.fields.map((f, i) => (
                  <text key={f.id} x={10} y={HEAD + i * ROW + 15} className={f.type === "autonumber" ? "key" : ""}>
                    {f.type === "autonumber" ? "🔑 " : ""}
                    {f.name}
                  </text>
                ))}
              </g>
            );
          })}
        </svg>
      )}
      {links.length > 0 && (
        <table className="rel-list">
          <thead>
            <tr>
              <th>Table</th>
              <th>Field</th>
              <th>Looks up</th>
              <th>When a related record is deleted</th>
            </tr>
          </thead>
          <tbody>
            {links.map(({ from, field, to }) => (
              <tr key={field.id}>
                <td>{from.name}</td>
                <td>{field.name}</td>
                <td>{to.name}</td>
                <td>{ruleLabel(field)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
