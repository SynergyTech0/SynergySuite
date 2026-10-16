"use client";

// A Google-Docs-style menu bar. Purely presentational: it takes menu
// definitions and renders click-to-open dropdowns that switch on hover once
// one is open, and close on outside click / Escape / item selection.
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type MenuItem =
  | { divider: true }
  | { label: string; onClick?: () => void; shortcut?: string; checked?: boolean; disabled?: boolean; divider?: false; items?: MenuItem[] };
export type Menu = { label: string; items: MenuItem[] };

export default function MenuBar({ menus }: { menus: Menu[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [sub, setSub] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={ref} className="flex items-center text-[13px] text-slate-700">
      {menus.map((m, i) => (
        <div key={m.label} className="relative">
          <button
            onClick={() => setOpen(open === i ? null : i)}
            onMouseEnter={() => open !== null && setOpen(i)}
            className={`px-2 py-0.5 rounded ${open === i ? "bg-slate-200" : "hover:bg-slate-100"}`}
          >
            {m.label}
          </button>
          {open === i && (
            <div className="absolute left-0 top-full mt-1 min-w-[240px] max-h-[calc(100vh-96px)] overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-xl py-1 z-50">
              {m.items.map((it, j) => (
                <Item
                  key={j}
                  it={it}
                  subOpen={sub === j}
                  onHover={() => setSub("items" in it && it.items ? j : null)}
                  close={() => {
                    setOpen(null);
                    setSub(null);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Item({ it, subOpen, onHover, close }: { it: MenuItem; subOpen?: boolean; onHover?: () => void; close: () => void }) {
  const [inner, setInner] = useState<number | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const subRef = useRef<HTMLDivElement | null>(null);
  const [subPos, setSubPos] = useState<{ left: number; top: number } | null>(null);
  // a submenu is placed in the viewport: beside its item, moved up when it would run off the bottom
  useLayoutEffect(() => {
    if (!subOpen || !rowRef.current) {
      setSubPos(null);
      return;
    }
    const r = rowRef.current.getBoundingClientRect();
    const h = subRef.current?.offsetHeight || 0;
    const w = subRef.current?.offsetWidth || 220;
    const left = r.right + w > window.innerWidth - 4 ? Math.max(4, r.left - w) : r.right;
    setSubPos({ left, top: Math.max(8, Math.min(r.top - 4, window.innerHeight - h - 8)) });
  }, [subOpen]);
  if ("divider" in it && it.divider) return <div className="my-1 border-t border-slate-100" />;
  const item = it as Extract<MenuItem, { label: string }>;
  return (
    <div className="relative" ref={rowRef} onMouseEnter={onHover}>
      <button
        disabled={item.disabled}
        data-menu-item={item.label}
        onClick={() => {
          if (item.items) return onHover?.();
          close();
          item.onClick?.();
        }}
        className="w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-indigo-50 flex items-center gap-2 disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <span className="w-4 text-indigo-600 text-xs">{item.checked ? "✓" : ""}</span>
        <span className="flex-1">{item.label}</span>
        {item.shortcut && <span className="text-[11px] text-slate-400 tabular-nums">{item.shortcut}</span>}
        {item.items && <span className="text-[10px] text-slate-400">▶</span>}
      </button>
      {item.items && subOpen && !item.disabled && (
        <div
          ref={subRef}
          className="fixed min-w-[220px] max-h-[calc(100vh-16px)] overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-xl py-1 z-50"
          style={subPos ? { left: subPos.left, top: subPos.top } : { visibility: "hidden", left: 0, top: 0 }}
        >
          {item.items.map((c, k) => (
            <Item key={k} it={c} subOpen={inner === k} onHover={() => setInner("items" in c && c.items ? k : null)} close={close} />
          ))}
        </div>
      )}
    </div>
  );
}
