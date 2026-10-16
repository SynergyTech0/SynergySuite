"use client";

// The horizontal ruler. It lines up with the page the cursor is on (so it
// follows the document when a pane opens on either side), shows the
// paragraph's indents and tab stops, and lets them and the page margins be
// dragged. A click on the ruler adds a tab stop of the kind in the selector;
// dragging a stop off the ruler removes it.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { Node as PMNodeT } from "@tiptap/pm/model";
import { type DocStyle, type Section, ptToPx, resolveStyle } from "@/lib/docs/model";
import { parseJson, type TabStop } from "@/lib/docs/para-format";
import { TAB_KINDS, addTab, dragIndents, dragMargins, moveTab, rulerMarks, rulerTicks, type Indents, type RulerHandle } from "@/lib/docs/ruler";

const PARA = ["paragraph", "heading"];

type Measure = { offset: number; scale: number; section: Section; mirrored: boolean };

function cursorBlock(editor: Editor): { node: PMNodeT; pos: number } | null {
  const $from = editor.state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (PARA.includes(n.type.name)) return { node: n, pos: $from.before(d) };
  }
  return null;
}

export function indentsOf(node: PMNodeT | undefined, styles: DocStyle[]): Indents {
  if (!node) return { left: 0, right: 0, first: 0 };
  const id = node.type.name === "heading" ? `Heading${node.attrs.level || 1}` : node.attrs.styleId || "Normal";
  const p = resolveStyle(styles, id).para;
  const num = (v: unknown, d: number | undefined) => (typeof v === "number" ? v : d ?? 0);
  return { left: num(node.attrs.indLeft, p.indentLeft), right: num(node.attrs.indRight, p.indentRight), first: num(node.attrs.indFirst, p.indentFirst) };
}

export function Ruler({
  editor,
  section,
  zoom,
  styles,
  mirrorMargins,
  editable,
  onMargins,
}: {
  editor: Editor | null;
  section: Section;
  zoom?: number;
  styles: DocStyle[];
  mirrorMargins?: boolean;
  editable: boolean;
  onMargins: (m: Section["margins"]) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [measure, setMeasure] = useState<Measure | null>(null);
  const [, setTick] = useState(0);
  const [drag, setDrag] = useState<null | { handle: RulerHandle; x0: number; dx: number; off: boolean }>(null);
  const dragged = useRef(0);
  const [tabKind, setTabKind] = useState<TabStop["align"]>("left");

  const remeasure = useCallback(() => {
    const host = ref.current;
    if (!host || !editor || editor.isDestroyed) return;
    const doc = document.querySelector<HTMLElement>("[data-testid=word-doc]");
    if (!doc) return;
    const hostLeft = host.getBoundingClientRect().left;
    const pages = [...doc.querySelectorAll<HTMLElement>(".pl-page")];
    if (pages.length) {
      // the page under the cursor (by its vertical position), else the first one
      let y = 0;
      try {
        y = editor.view.coordsAtPos(editor.state.selection.from).top;
      } catch {
        /* not laid out yet */
      }
      const page = pages.find((p) => {
        const r = p.getBoundingClientRect();
        return y >= r.top && y <= r.bottom;
      }) || pages[0];
      const r = page.getBoundingClientRect();
      const n = Number(page.dataset.page) || 1;
      setMeasure({ offset: r.left - hostLeft, scale: r.width / section.pageWidth, section, mirrored: !!mirrorMargins && n % 2 === 0 });
      return;
    }
    // web layout: the text column is the editor's content box
    const pm = doc.querySelector<HTMLElement>(".ProseMirror");
    if (!pm) return;
    const r = pm.getBoundingClientRect();
    const cs = getComputedStyle(pm);
    // px per pt on screen (getBoundingClientRect includes the zoom, offsetWidth does not)
    const scale = (96 / 72) * (r.width / (pm.offsetWidth || 1));
    const padL = parseFloat(cs.paddingLeft) * 0.75;
    const padR = parseFloat(cs.paddingRight) * 0.75;
    const w = pm.offsetWidth * 0.75;
    setMeasure({ offset: r.left - hostLeft, scale, section: { ...section, pageWidth: w, margins: { ...section.margins, left: padL, right: padR, gutter: 0 } }, mirrored: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, section, mirrorMargins, zoom]);

  useLayoutEffect(() => {
    remeasure();
  }, [remeasure]);

  useEffect(() => {
    if (!editor) return;
    let raf = 0;
    const later = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        remeasure();
        setTick((t) => t + 1);
      });
    };
    editor.on("transaction", later);
    window.addEventListener("resize", later);
    const ro = new ResizeObserver(later);
    if (ref.current) ro.observe(ref.current);
    const doc = document.querySelector("[data-testid=word-doc]");
    if (doc) {
      ro.observe(doc);
      if (doc.parentElement) {
        ro.observe(doc.parentElement);
        doc.parentElement.addEventListener("scroll", later, { passive: true });
      }
    }
    // pages are re-laid out after edits: watch for them appearing
    const mo = doc ? new MutationObserver(later) : null;
    const pagesEl = doc?.querySelector(".pl-pages");
    if (mo && pagesEl) mo.observe(pagesEl, { childList: true, attributes: true, subtree: true });
    return () => {
      cancelAnimationFrame(raf);
      editor.off("transaction", later);
      window.removeEventListener("resize", later);
      ro.disconnect();
      mo?.disconnect();
      doc?.parentElement?.removeEventListener("scroll", later);
    };
  }, [editor, remeasure]);

  if (!measure) return <div ref={ref} className="no-print bg-white border-t border-slate-100 h-5" data-testid="ruler" />;

  const block = editor ? cursorBlock(editor) : null;
  const ind = indentsOf(block?.node, styles);
  const tabs = (parseJson<TabStop[]>(block?.node.attrs.tabs) || []) as TabStop[];
  const s = measure.section;
  const base = rulerMarks(s, ind, tabs, measure.mirrored);
  const px = (pt: number) => pt * measure.scale;

  // preview of the marker being dragged
  let shown = base;
  let shownTabs = tabs;
  let shownSection = s;
  if (drag) {
    const dx = drag.dx / measure.scale;
    if (drag.handle === "marginLeft" || drag.handle === "marginRight") {
      shownSection = { ...s, margins: dragMargins(s, drag.handle, dx, measure.mirrored) };
      shown = rulerMarks(shownSection, ind, tabs, measure.mirrored);
    } else if (drag.handle.startsWith("tab:")) {
      const i = Number(drag.handle.slice(4));
      // a stop dragged off stays drawn (dimmed) so it keeps the pointer until it is let go
      if (!drag.off) shownTabs = tabs.map((t, k) => (k === i ? { ...t, pos: Math.max(0, t.pos + dx) } : t));
      shown = rulerMarks(s, ind, shownTabs, measure.mirrored);
    } else {
      shown = rulerMarks(s, dragIndents(ind, drag.handle as "first" | "hanging" | "leftBox" | "right", dx, base), tabs, measure.mirrored);
    }
  }

  const start = (handle: RulerHandle) => (e: React.PointerEvent) => {
    if (!editable || (!handle.startsWith("margin") && !block)) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ handle, x0: e.clientX, dx: 0, off: false });
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const r = ref.current!.getBoundingClientRect();
    setDrag({ ...drag, dx: e.clientX - drag.x0, off: Math.abs(e.clientY - (r.top + r.height / 2)) > 24 });
  };
  const end = () => {
    if (!drag || !editor) return setDrag(null);
    dragged.current = Date.now();
    const dx = drag.dx / measure.scale;
    const h = drag.handle;
    setDrag(null);
    if (Math.abs(drag.dx) < 1 && !drag.off) return;
    if (h === "marginLeft" || h === "marginRight") onMargins(dragMargins(section, h, dx, measure.mirrored));
    else if (h.startsWith("tab:")) {
      const i = Number(h.slice(4));
      editor.chain().focus().setParaFormat({ tabs: moveTab(tabs, i, drag.off ? null : tabs[i].pos + dx) }).run();
    } else {
      const n = dragIndents(ind, h as "first" | "hanging" | "leftBox" | "right", dx, base);
      editor.chain().focus().setParaFormat({ indLeft: n.left, indRight: n.right, indFirst: n.first }).run();
    }
  };
  const clickAdd = (e: React.MouseEvent) => {
    if (!editable || !editor || !block || drag || Date.now() - dragged.current < 300) return;
    const r = ref.current!.getBoundingClientRect();
    const pt = (e.clientX - r.left - measure.offset) / measure.scale - base.textLeft;
    if (pt <= 0 || base.textLeft + pt >= base.textRight) return;
    editor.chain().focus().setParaFormat({ tabs: addTab(tabs, pt, tabKind) }).run();
  };

  const tri = "absolute w-0 h-0 border-x-[5px] border-x-transparent";
  const handleCls = editable ? "cursor-ew-resize" : "pointer-events-none";
  const tabGlyph: Record<string, string> = { left: "└", center: "┴", right: "┘", decimal: "┴." };
  return (
    <div className="no-print bg-white border-t border-slate-100 relative h-6 overflow-hidden select-none" ref={ref} data-testid="ruler" onPointerMove={move} onPointerUp={end} onPointerCancel={() => setDrag(null)}>
      <button
        className="absolute left-1 top-0.5 h-5 w-5 text-[11px] leading-none rounded border border-slate-200 text-slate-600 hover:bg-slate-50 z-10"
        title={`Tab stop: ${tabKind} (click to change)`}
        data-testid="tab-kind"
        data-kind={tabKind}
        onClick={() => setTabKind(TAB_KINDS[(TAB_KINDS.indexOf(tabKind) + 1) % TAB_KINDS.length])}
      >
        {tabGlyph[tabKind]}
      </button>
      <div className="absolute top-0 h-full" style={{ left: measure.offset, width: px(s.pageWidth) }} data-testid="ruler-page" data-left={Math.round(measure.offset)}>
        {/* margins shaded, text area white */}
        <div className="absolute top-1 bottom-1 inset-x-0 bg-slate-200 rounded-sm" />
        <div className="absolute top-1 bottom-1 bg-white border-y border-slate-200" style={{ left: px(shown.textLeft), width: px(shown.textRight - shown.textLeft) }} onClick={clickAdd} data-testid="ruler-text" />
        {rulerTicks(shown).map((t, i) => (
          <div key={i} className="absolute pointer-events-none" style={{ left: px(t.at), top: t.major ? 6 : 10, height: t.major ? 12 : 4 }}>
            {t.label ? <span className="absolute -translate-x-1/2 text-[9px] leading-none text-slate-500" style={{ top: 1 }}>{t.label}</span> : <span className="block w-px h-full bg-slate-400" />}
          </div>
        ))}
        {/* margin edges */}
        <div className={`absolute top-0 h-full w-2 -ml-1 ${handleCls}`} style={{ left: px(shown.textLeft) }} title="Left margin" data-handle="marginLeft" onPointerDown={start("marginLeft")} />
        <div className={`absolute top-0 h-full w-2 -ml-1 ${handleCls}`} style={{ left: px(shown.textRight) }} title="Right margin" data-handle="marginRight" onPointerDown={start("marginRight")} />
        {/* indents */}
        {block && (
          <>
            <div className={`${tri} top-0 border-t-[6px] border-t-slate-600 -ml-[5px] z-[2] ${handleCls}`} style={{ left: px(shown.first) }} title="First line indent" data-handle="first" data-at={shown.first} onPointerDown={start("first")} />
            <div className={`${tri} bottom-[5px] border-b-[6px] border-b-slate-600 -ml-[5px] z-[2] ${handleCls}`} style={{ left: px(shown.left) }} title="Hanging indent" data-handle="hanging" data-at={shown.left} onPointerDown={start("hanging")} />
            <div className={`absolute bottom-0 h-[5px] w-[10px] -ml-[5px] bg-slate-600 z-[2] ${handleCls}`} style={{ left: px(shown.left) }} title="Left indent" data-handle="leftBox" onPointerDown={start("leftBox")} />
            <div className={`${tri} bottom-[5px] border-b-[6px] border-b-slate-600 -ml-[5px] z-[2] ${handleCls}`} style={{ left: px(shown.right) }} title="Right indent" data-handle="right" data-at={shown.right} onPointerDown={start("right")} />
            {shownTabs.map((t, i) => (
              <div
                key={i}
                className={`absolute bottom-1 text-[10px] leading-none -ml-[3px] text-slate-800 z-[3] ${handleCls} ${drag?.handle === `tab:${i}` && drag.off ? "opacity-30" : ""}`}
                style={{ left: px(shown.textLeft + t.pos) }}
                title={`${t.align} tab`}
                data-tab={t.pos}
                onPointerDown={start(`tab:${i}`)}
              >
                {tabGlyph[t.align]}
              </div>
            ))}
          </>
        )}
      </div>
      {drag && <div className="fixed top-0 bottom-0 w-px bg-indigo-400/60 pointer-events-none z-50" style={{ left: (ref.current?.getBoundingClientRect().left || 0) + measure.offset + drag.dx + px(handleAt(drag.handle, base, tabs)) }} />}
    </div>
  );
}

function handleAt(h: RulerHandle, m: ReturnType<typeof rulerMarks>, tabs: TabStop[]): number {
  if (h === "marginLeft") return m.textLeft;
  if (h === "marginRight") return m.textRight;
  if (h === "first") return m.first;
  if (h === "hanging" || h === "leftBox") return m.left;
  if (h === "right") return m.right;
  return m.textLeft + (tabs[Number(h.slice(4))]?.pos || 0);
}
