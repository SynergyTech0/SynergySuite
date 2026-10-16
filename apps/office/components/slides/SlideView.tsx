"use client";

// Static (read-only) slide renderer used by the thumbnail rail, the slideshow,
// presenter view and printing. Everything is laid out at the slide's real size
// in "slide px" and scaled with a CSS transform, so a thumbnail, the editor
// canvas and the projector all show exactly the same layout.
import { createContext, useContext, useId, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { BODY_PT, SLOT_KINDS, animKind, titleText, bodyBox, bodyPt, footerBoxes, footerFor, pathPoints, titleBox, titlePt, toHtml, type AnimItem, type AnimRest, type AnimState, type BodyStyle, type Box, type HeaderFooter, type Slide, type MathEl, type SlideElement, type TableEl, type ZoomEl } from "@/lib/slides/model";
import { BAR_H, type Theme } from "@/lib/slides/themes";
import { isLineShape, shapePath } from "@/lib/slides/shapes";
import { safeSrc, sanitizeHtml } from "@/lib/slides/sanitize";
import { scaledD } from "@/lib/slides/freeform";
import { latexToMathml } from "@/lib/slides/math";
import { borderCss, cellHtml, fractions, gridCols, normalizeTable } from "@/lib/slides/table";
import { styledRows } from "@/lib/slides/table-style";
import { cropBox, gradientCss, gradientVector, hasCrop, shadowCss, validGradient, wordArtCss } from "@/lib/slides/effects";
import { ChartView } from "./ChartView";
import { MediaView } from "./MediaView";
import { WarpText } from "./WarpText";
import { warpOf } from "@/lib/slides/warp";
import { ModelView } from "./ModelView";

/** font: body text CSS font list; headFont: titles (defaults to font); hf: header & footer */
export type DeckLook = { W: number; H: number; theme: Theme; font: string; headFont?: string; hf?: HeaderFooter };

const cssFont = (name: string | undefined, fallback: string) => (name ? `'${name}', ${fallback}` : fallback);

export const boxStyle = (b: Box, z?: number): CSSProperties => ({ position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, zIndex: z });

export const justify = (v?: "top" | "middle" | "bottom") => (v === "middle" ? "center" : v === "bottom" ? "flex-end" : "flex-start");

/** Text inset used by PowerPoint text boxes (0.1in x 0.05in). */
export const TEXT_PAD = "4.8px 9.6px";

export function SlideBackground({ slide, look }: { slide: Slide; look: DeckLook }) {
  const src = slide.bgImg ? safeSrc(slide.bgImg) : "";
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: -100000, overflow: "hidden" }}>
      <div data-bg-grad={validGradient(slide.bgGrad) ? "1" : undefined} style={{ position: "absolute", inset: 0, background: validGradient(slide.bgGrad) ? gradientCss(slide.bgGrad) : `#${slide.bg || look.theme.bg}` }} />
      {src && <img src={src} alt="" draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
      {look.theme.bar && <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: BAR_H, background: `#${look.theme.accent}` }} />}
    </div>
  );
}

export function titleCss(slide: Slide, look: DeckLook): CSSProperties {
  const ts = slide.tstyle || {};
  return {
    fontSize: `${titlePt(slide)}pt`,
    fontWeight: ts.bold === false ? 400 : 700,
    color: `#${ts.color || look.theme.title}`,
    fontFamily: cssFont(ts.font, look.headFont || look.font),
    textAlign: ts.align || (slide.layout === "title" ? "center" : "left"),
    lineHeight: 1.1,
  };
}

/** CSS variables carrying the deeper outline levels' looks (see .slide-body-ph in globals.css). */
export function levelVars(bs: BodyStyle | undefined, look: DeckLook): CSSProperties {
  const out: Record<string, string> = {};
  bs?.lv?.forEach((l, i) => {
    if (!l) return;
    if (l.size) out[`--syn-l${i + 2}-sz`] = `${l.size}pt`;
    if (l.color) out[`--syn-l${i + 2}-c`] = `#${l.color}`;
    if (l.font) out[`--syn-l${i + 2}-f`] = cssFont(l.font, look.font);
  });
  return out as CSSProperties;
}

export function bodyCss(slide: Slide, look: DeckLook): CSSProperties {
  return {
    ...levelVars(slide.bstyle, look),
    fontSize: `${bodyPt(slide)}pt`,
    color: `#${slide.bstyle?.color || look.theme.text}`,
    fontFamily: cssFont(slide.bstyle?.font, look.font),
    textAlign: slide.layout === "title" ? "center" : undefined,
  };
}

export function ShapeSvg({ el }: { el: Extract<SlideElement, { type: "shape" }> }) {
  const line = isLineShape(el.shape);
  const sw = el.line ? el.lineW ?? 1.33 : 0;
  const markerId = `arr-${el.id}`;
  const grad = !line && validGradient(el.grad) ? el.grad : undefined;
  // ids must be unique per rendered copy (thumbnails, editor, slide show share a document)
  const gradId = `grad-${el.id}-${useId().replace(/:/g, "")}`;
  const gv = grad && grad.kind !== "radial" ? gradientVector(grad.angle) : undefined;
  return (
    <svg
      width={el.w}
      height={el.h}
      viewBox={`0 0 ${el.w} ${el.h}`}
      data-grad={grad ? "1" : undefined}
      style={{ position: "absolute", inset: 0, overflow: "visible", transform: el.flipH || el.flipV ? `scale(${el.flipH ? -1 : 1}, ${el.flipV ? -1 : 1})` : undefined, filter: shadowCss(el.shadow) }}
    >
      {(el.shape === "lineArrow" || grad) && (
        <defs>
          {el.shape === "lineArrow" && (
            <marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill={`#${el.line || "000000"}`} />
            </marker>
          )}
          {grad && (gv ? (
            <linearGradient id={gradId} x1={gv.x1} y1={gv.y1} x2={gv.x2} y2={gv.y2}>
              {[...grad.stops].sort((p, q) => p.pos - q.pos).map((st, k) => <stop key={k} offset={`${st.pos}%`} stopColor={`#${st.color}`} />)}
            </linearGradient>
          ) : (
            <radialGradient id={gradId} cx="0.5" cy="0.5" r="0.5">
              {[...grad.stops].sort((p, q) => p.pos - q.pos).map((st, k) => <stop key={k} offset={`${st.pos}%`} stopColor={`#${st.color}`} />)}
            </radialGradient>
          ))}
        </defs>
      )}
      <path
        d={el.shape === "freeform" && el.geom ? scaledD(el.geom, el.w, el.h) : shapePath(el.shape, el.w, el.h)}
        fill={grad ? `url(#${gradId})` : line || !el.fill ? "none" : `#${el.fill}`}
        stroke={el.line ? `#${el.line}` : line ? "#000000" : "none"}
        strokeWidth={line ? Math.max(sw, 1) : sw}
        strokeLinejoin="round"
        strokeLinecap={el.shape === "freeform" ? "round" : undefined}
        strokeOpacity={el.lineA !== undefined && el.lineA < 1 ? el.lineA : undefined}
        fillOpacity={el.fillA !== undefined && el.fillA < 1 ? Math.max(0, el.fillA) : undefined}
        markerEnd={el.shape === "lineArrow" ? `url(#${markerId})` : undefined}
      />
    </svg>
  );
}

/** An equation, drawn by the browser's MathML engine. */
export function MathView({ el, look }: { el: MathEl; look: DeckLook }) {
  return (
    <div
      data-testid="math"
      style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: `${el.size || 28}pt`, color: `#${el.color || look.theme.text}`, fontFamily: "'Cambria Math', 'STIX Two Math', 'Latin Modern Math', math, serif", overflow: "hidden" }}
      dangerouslySetInnerHTML={{ __html: latexToMathml(el.latex) }}
    />
  );
}

/** A table: merged cells, per-side borders, rich cell text, column widths and row heights. */
export function TableView({ el, look, hideText, cell }: { el: TableEl; look: DeckLook; hideText?: boolean; cell?: (r: number, c: number, html: string) => ReactNode }) {
  const rows = styledRows(el, look.theme.accent, look.theme.text, look.theme.bg);
  const nc = gridCols(rows);
  const cw = fractions(el.colW, nc);
  const rh = fractions(el.rowH, rows.length);
  return (
    <table style={{ width: "100%", height: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: `${el.fontSize || 14}pt`, fontFamily: look.font, color: `#${look.theme.text}` }}>
      <colgroup>{cw.map((f, i) => <col key={i} style={{ width: `${f * 100}%` }} />)}</colgroup>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} style={{ height: `${rh[ri] * 100}%` }}>
            {r.map((c, ci) =>
              c.merged ? null : (
                <td
                  key={ci}
                  data-cell={`${ri}:${ci}`}
                  colSpan={c.cs || undefined}
                  rowSpan={c.rs || undefined}
                  style={{
                    borderTop: borderCss(c.bd?.t, el.border),
                    borderRight: borderCss(c.bd?.r, el.border),
                    borderBottom: borderCss(c.bd?.b, el.border),
                    borderLeft: borderCss(c.bd?.l, el.border),
                    padding: "4px 8px",
                    background: c.fill ? `#${c.fill}` : undefined,
                    color: c.color ? `#${c.color}` : undefined,
                    fontWeight: c.bold ? 700 : undefined,
                    textAlign: c.align,
                    overflowWrap: "anywhere",
                    verticalAlign: c.valign || "middle",
                    overflow: "hidden",
                  }}
                >
                  {cell ? cell(ri, ci, cellHtml(c)) : hideText ? null : <RichHtml html={cellHtml(c)} />}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RichHtml({ html, className = "" }: { html: string; className?: string }) {
  return <div className={`slide-text ${className}`} dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />;
}

/**
 * "Shrink text on overflow": lays its child (a padded, full-size text layer)
 * out in a larger box and scales it down until the text fits, so the text
 * shrinks and re-wraps like PowerPoint's autofit. Refits as the text changes.
 */
export function ShrinkFit({ on, children }: { on: boolean; children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = inner.current;
    if (!box) return;
    const apply = (s: number) => {
      box.style.width = box.style.height = `${100 / s}%`;
      box.style.transform = s === 1 ? "" : `scale(${s})`;
      box.dataset.fitScale = String(Math.round(s * 1000) / 1000);
    };
    const fit = () => {
      apply(1);
      if (!on) return;
      const layer = box.firstElementChild as HTMLElement | null;
      const text = layer?.firstElementChild as HTMLElement | null;
      if (!layer || !text) return;
      const cs = getComputedStyle(layer);
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      let s = 1;
      for (let k = 0; k < 6; k++) {
        const need = text.offsetHeight + pad;
        const have = layer.clientHeight;
        if (need <= have + 0.5) break;
        s = Math.max(0.25, (s * have) / need);
        apply(s);
        if (s === 0.25) break;
      }
    };
    fit();
    if (!on) return;
    const mo = new MutationObserver(fit);
    mo.observe(box, { subtree: true, childList: true, characterData: true });
    return () => mo.disconnect();
  });
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div ref={inner} style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", transformOrigin: "0 0" }}>
        {children}
      </div>
    </div>
  );
}

/** The deck's slides (resolved against their masters) for zoom thumbnails; `depth` stops a zoom inside a zoom. */
export const DeckSlides = createContext<{ slides: Slide[]; depth?: number }>({ slides: [] });

/** A zoom: the target slide drawn small, framed. */
function ZoomView({ el, look }: { el: ZoomEl; look: DeckLook }) {
  const deck = useContext(DeckSlides);
  const target = deck.slides.find((s) => s.id === el.target);
  const frame: CSSProperties = { position: "absolute", inset: 0, overflow: "hidden", outline: el.border === false ? undefined : "1px solid rgba(0,0,0,0.35)", background: "#f1f5f9" };
  if (!target || (deck.depth || 0) >= 1) {
    return <div data-zoom-target={el.target} style={{ ...frame, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontSize: 14 }}>{target ? target.title || "Zoom" : "Missing slide"}</div>;
  }
  return (
    <div data-zoom-target={el.target} data-zoom-kind={el.kind} style={frame}>
      <div style={{ width: look.W, height: look.H, transform: `scale(${el.w / look.W}, ${el.h / look.H})`, transformOrigin: "0 0", pointerEvents: "none" }}>
        <DeckSlides.Provider value={{ slides: deck.slides, depth: (deck.depth || 0) + 1 }}>
          <SlideView slide={target} look={look} />
        </DeckSlides.Provider>
      </div>
    </div>
  );
}

/** One element's visual content (without selection chrome). */
export function ElementContent({ el, look, children, live }: { el: SlideElement; look: DeckLook; children?: ReactNode; live?: boolean | "muted" }) {
  if (el.type === "chart") return <ChartView el={el} font={look.font} />;
  if (el.type === "media") return <MediaView el={el} live={live} />;
  if (el.type === "math") return <MathView el={el} look={look} />;
  if (el.type === "zoom") return <ZoomView el={el} look={look} />;
  if (el.type === "model3d") return <ModelView el={el} />;
  if (el.type === "image") {
    const src = safeSrc(el.src);
    const flip = el.flipH || el.flipV ? `scale(${el.flipH ? -1 : 1}, ${el.flipV ? -1 : 1})` : undefined;
    if (src && hasCrop(el.crop)) {
      return (
        <div data-crop="" style={{ width: "100%", height: "100%", filter: shadowCss(el.shadow), transform: flip }}>
          <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
            <img src={src} alt={el.alt || ""} draggable={false} style={{ position: "absolute", ...cropBox(el.crop), maxWidth: "none", display: "block" }} />
          </div>
        </div>
      );
    }
    return src ? (
      <img src={src} alt={el.alt || ""} draggable={false} style={{ width: "100%", height: "100%", objectFit: "fill", display: "block", transform: flip, filter: shadowCss(el.shadow) }} />
    ) : (
      <div style={{ width: "100%", height: "100%", background: "#f1f5f9" }} />
    );
  }
  if (el.type === "table") return <TableView el={el} look={look} hideText={!!children} />;
  const tx = el.type === "text" || el.type === "shape" ? el : undefined;
  const cols = tx?.cols && tx.cols > 1 ? tx.cols : 0;
  // WordArt Transform (not while the text is being edited)
  const wk = tx?.warp && !children ? warpOf(tx.warp) : undefined;
  const warped = wk?.path && tx ? <WarpText warp={wk} html={tx.html || ""} w={tx.w} h={tx.h} wa={tx.wa} font={look.font} color={look.theme.text} defaultPx={(BODY_PT * 4) / 3} /> : null;
  const textLayer = (html: string | undefined, valign: "top" | "middle" | "bottom" | undefined, center: boolean) => (
    <div
      data-text-layer=""
      style={{
        ...(wordArtCss(tx?.wa) as CSSProperties),
        position: "absolute",
        inset: 0,
        padding: TEXT_PAD,
        display: "flex",
        flexDirection: "column",
        justifyContent: justify(valign),
        fontSize: `${BODY_PT}pt`,
        color: `#${look.theme.text}`,
        fontFamily: look.font,
        textAlign: center ? "center" : undefined,
        ...(wk?.css ? { transform: wk.css } : {}),
      }}
    >
      {cols ? (
        <div data-cols={cols} style={{ columnCount: cols, columnGap: tx?.colGap ?? 24, columnFill: "auto", height: "100%" }}>{children ?? (html ? <RichHtml html={html} /> : null)}</div>
      ) : (
        children ?? (html ? <RichHtml html={html} /> : null)
      )}
    </div>
  );
  // a layout placeholder slot: its prompt in a dashed frame (it is never drawn on slides)
  if (el.type === "text" && el.slot)
    return (
      <div data-slot={el.slot} style={{ position: "absolute", inset: 0, border: "1.5px dashed #94a3b8", color: "#64748b" }}>
        {textLayer(el.html || `<p>${SLOT_KINDS.find((k) => k.id === el.slot)?.prompt || ""}</p>`, "middle", true)}
      </div>
    );
  if (el.type === "text") return warped || <ShrinkFit on={el.autofit === "shrink"}>{textLayer(el.html, el.valign, false)}</ShrinkFit>;
  return (
    <>
      <ShapeSvg el={el} />
      {warped && !isLineShape(el.shape) ? warped : !isLineShape(el.shape) && (el.html || children) ? <ShrinkFit on={el.autofit === "shrink"}>{textLayer(el.html, el.valign || "middle", true)}</ShrinkFit> : null}
    </>
  );
}

export function elementTransform(el: SlideElement): string | undefined {
  return el.rot ? `rotate(${el.rot}deg)` : undefined;
}

export type { AnimState };

const pathName = (it: AnimItem) => `syn-p-${Math.abs(hashStr(`${it.anim.path}|${it.anim.order}`)).toString(36)}`;
function hashStr(v: string): number {
  let h = 0;
  for (let i = 0; i < v.length; i++) h = (h * 31 + v.charCodeAt(i)) | 0;
  return h;
}

/** @keyframes for the motion paths playing now (translate in slide px from the object's place). */
export function pathKeyframes(items: AnimItem[], W: number, H: number): string {
  return items
    .filter((it) => animKind(it.anim) === "path" && it.anim.path)
    .map((it) => {
      const pts = pathPoints(it.anim.path!);
      const frames = pts.map((p, k) => `${Math.round((k / Math.max(1, pts.length - 1)) * 10000) / 100}% { transform: translate(${Math.round(p.x * W * 10) / 10}px, ${Math.round(p.y * H * 10) / 10}px); }`);
      return `@keyframes ${pathName(it)} { ${frames.join(" ")} }`;
    })
    .join("\n");
}

function oneAnim(it: AnimItem): string {
  const a = it.anim;
  const k = animKind(a);
  if (k === "path") return `${pathName(it)} ${a.dur}ms ease-in-out ${it.at}ms both`;
  if (k === "emph") return `syn-e-${a.effect} ${a.dur}ms ease-in-out ${it.at}ms both`;
  if (a.effect === "appear") return k === "exit" ? `syn-x-appear 1ms steps(1, end) ${it.at}ms both` : `syn-a-appear 1ms steps(1, end) ${it.at}ms both`;
  const name = a.effect === "fly" || a.effect === "wipe" ? `syn-a-${a.effect}-${a.dir || "b"}` : `syn-a-${a.effect}`;
  // an exit plays the matching entrance backwards and holds its first frame (gone)
  if (k === "exit") return `${name} ${a.dur}ms ${a.effect === "fly" ? "cubic-bezier(.7,0,.8,.3)" : "ease-in"} ${it.at}ms 1 reverse both`;
  return `${name} ${a.dur}ms ${a.effect === "fly" ? "cubic-bezier(.2,.7,.3,1)" : "ease-out"} ${it.at}ms both`;
}

export function animStyle(items: AnimItem[] | undefined): CSSProperties | undefined {
  if (!items?.length) return undefined;
  const grow = items.find((it) => it.anim.effect === "grow" && animKind(it.anim) === "emph");
  return { animation: items.map(oneAnim).join(", "), ...(grow ? ({ "--syn-grow": String(grow.anim.amount || 1.5) } as CSSProperties) : {}) };
}

function restStyle(r: AnimRest | undefined, W: number, H: number): CSSProperties | undefined {
  if (!r || (!r.dx && !r.dy && r.scale === 1)) return undefined;
  return { transform: `translate(${Math.round(r.dx * W * 10) / 10}px, ${Math.round(r.dy * H * 10) / 10}px)${r.scale !== 1 ? ` scale(${r.scale})` : ""}` };
}

function Animated({ k, st, look, children }: { k: string; st?: AnimState; look: DeckLook; children: ReactNode }) {
  const hidden = st?.hidden.has(k);
  const items = st?.play.get(k);
  return (
    <div data-anim={st ? k : undefined} data-anim-hidden={hidden ? "1" : undefined} style={{ position: "absolute", inset: 0, visibility: hidden ? "hidden" : undefined, ...restStyle(st?.rest.get(k), look.W, look.H) }}>
      <div data-anim-play={items?.length ? items.map((it) => it.anim.effect).join(" ") : undefined} style={{ position: "absolute", inset: 0, ...animStyle(items) }}>
        {children}
      </div>
    </div>
  );
}

/** Body text with paragraph-by-paragraph builds. */
function BodyText({ html, st }: { html: string; st?: AnimState }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll("p").forEach((p, k) => {
      // a list item's first paragraph carries its bullet: style the <li> instead
      const li = p.parentElement?.tagName === "LI" && p.parentElement.firstElementChild === p ? p.parentElement : null;
      const node = (li || p) as HTMLElement;
      const key = `body#${k}`;
      const it = st?.play.get(key);
      node.style.visibility = st?.hidden.has(key) ? "hidden" : st ? "visible" : "";
      node.style.animation = it ? String(animStyle(it)?.animation || "") : "";
      if (it?.length) node.style.display = node.tagName === "LI" ? "list-item" : "block";
    });
  });
  return (
    <div ref={ref}>
      <RichHtml html={html} className="slide-body-ph" />
    </div>
  );
}

/** Master/layout objects behind a slide (static, never animated). */
export function UnderLayer({ slide, look }: { slide: Slide; look: DeckLook }) {
  if (!slide.under?.length) return null;
  return (
    <>
      {slide.under.map((el) => (
        <div key={`u-${el.id}`} data-under="" style={{ ...boxStyle(el, el.z), transform: elementTransform(el), pointerEvents: "none" }}>
          <ElementContent el={el} look={look} />
        </div>
      ))}
    </>
  );
}

/** Date, footer text and slide number along the bottom of a slide. */
export function FooterLayer({ slide, look }: { slide: Slide; look: DeckLook }) {
  const f = footerFor(slide, look.hf);
  if (!f) return null;
  const b = footerBoxes(look.W, look.H, look.hf);
  const st = (bx: Box, align: "left" | "center" | "right"): CSSProperties => ({
    ...boxStyle(bx, 50000),
    padding: TEXT_PAD,
    display: "flex",
    alignItems: "center",
    justifyContent: align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center",
    fontSize: "12pt",
    color: `#${look.theme.text}`,
    opacity: 0.7,
    fontFamily: look.font,
    pointerEvents: "none",
    whiteSpace: "nowrap",
    overflow: "hidden",
  });
  return (
    <>
      {f.date && <div data-testid="slide-date" style={st(b.date, "left")}>{f.date}</div>}
      {f.footer && <div data-testid="slide-footer" style={st(b.footer, "center")}>{f.footer}</div>}
      {f.num && <div data-testid="slide-number" style={st(b.num, "right")}>{f.num}</div>}
    </>
  );
}

/** A complete slide at its natural size; wrap with a scaler to fit. */
export function SlideView({ slide, look, anim, muted }: { slide: Slide; look: DeckLook; anim?: AnimState; muted?: boolean }) {
  const tb = titleBox(slide, look.W, look.H);
  const bb = bodyBox(slide, look.W, look.H);
  return (
    <div style={{ position: "relative", width: look.W, height: look.H, overflow: "hidden", isolation: "isolate" }}>
      {anim && anim.play.size > 0 && <style>{pathKeyframes([...anim.play.values()].flat(), look.W, look.H)}</style>}
      <SlideBackground slide={slide} look={look} />
      <UnderLayer slide={slide} look={look} />
      <FooterLayer slide={slide} look={look} />
      {slide.elements.map((el) => (
        <div key={el.id} data-el={el.id} style={{ ...boxStyle(el, el.z), transform: elementTransform(el) }}>
          <Animated k={el.id} st={anim} look={look}>
            <ElementContent el={el} look={look} live={anim ? (muted ? "muted" : true) : undefined} />
          </Animated>
        </div>
      ))}
      {tb && slide.title && (
        <div data-el="title" style={boxStyle(tb, 0)}>
          <Animated k="title" st={anim} look={look}>
            <div style={{ position: "absolute", inset: 0, padding: TEXT_PAD, display: "flex", flexDirection: "column", justifyContent: slide.layout === "title" ? "flex-end" : "center", ...titleCss(slide, look), whiteSpace: "pre-wrap" }}>
              {slide.thtml && titleText(slide.thtml) === slide.title ? <RichHtml html={slide.thtml} className="slide-title-rich" /> : slide.title}
            </div>
          </Animated>
        </div>
      )}
      {bb && slide.body && (
        <div data-el="body" style={boxStyle(bb, 0)}>
          <Animated k="body" st={anim} look={look}>
            <ShrinkFit on={slide.bodyFit !== "none"}>
              <div style={{ position: "absolute", inset: 0, padding: TEXT_PAD, display: "flex", flexDirection: "column", justifyContent: justify(slide.bodyValign), ...bodyCss(slide, look) }}>
                <BodyText html={toHtml(slide.body)} st={anim} />
              </div>
            </ShrinkFit>
          </Animated>
        </div>
      )}
    </div>
  );
}

/** Scales a natural-size slide into a box of the given width. */
export function ScaledSlide({ slide, look, width, className = "" }: { slide: Slide; look: DeckLook; width: number; className?: string }) {
  const s = width / look.W;
  return (
    <div className={className} style={{ width, height: look.H * s, overflow: "hidden", position: "relative" }}>
      <div style={{ transform: `scale(${s})`, transformOrigin: "0 0", width: look.W, height: look.H }}>
        <SlideView slide={slide} look={look} />
      </div>
    </div>
  );
}
