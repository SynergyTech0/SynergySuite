"use client";

// Renders slides at their natural size outside the viewport, for exporters
// that read the laid-out DOM (PDF drawing, autofit scales for .pptx).
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { AnimState, Slide } from "@/lib/slides/model";
import { DeckSlides, SlideView, type DeckLook } from "./SlideView";

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** `deck`: every slide, for zooms (defaults to `slides`); `anims`: a slide show state per slide (video frames). */
export async function renderOffscreen(slides: Slide[], look: DeckLook, deck: Slide[] = slides, anims?: (AnimState | undefined)[]): Promise<{ roots: HTMLElement[]; dispose: () => void }> {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.dataset.offscreen = "";
  Object.assign(host.style, { position: "fixed", left: "-100000px", top: "0", width: `${look.W}px`, pointerEvents: "none", zIndex: "-1" });
  document.body.appendChild(host);
  const root = createRoot(host);
  const tree = () => (
    <DeckSlides.Provider value={{ slides: deck }}>
      {slides.map((s, i) => (
        <div key={`${s.id}-${i}`} data-offscreen-slide="" style={{ width: look.W, height: look.H, overflow: "hidden" }}>
          <SlideView slide={s} look={look} anim={anims?.[i]} muted />
        </div>
      ))}
    </DeckSlides.Provider>
  );
  flushSync(() => root.render(tree()));
  await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
  // lay out again with the web fonts in place, so shrink-to-fit measures the final text
  flushSync(() => root.render(tree()));
  await Promise.all([...host.querySelectorAll("img")].map((img) => img.decode().catch(() => undefined)));
  await frame();
  await frame();
  const roots = [...host.querySelectorAll<HTMLElement>("[data-offscreen-slide]")].map((d) => d.firstElementChild as HTMLElement);
  return {
    roots,
    dispose: () => {
      root.unmount();
      host.remove();
    },
  };
}

/**
 * The shrink-to-fit scale of each text box that shrinks its text (below 1),
 * per slide id: element ids, and "body" for the content placeholder.
 */
export function fitScales(slides: Slide[], roots: HTMLElement[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  slides.forEach((s, i) => {
    roots[i]?.querySelectorAll<HTMLElement>(":scope > [data-el]").forEach((el) => {
      const v = Number(el.querySelector<HTMLElement>("[data-fit-scale]")?.dataset.fitScale);
      if (v > 0 && v < 0.995) (out[s.id] ||= {})[el.dataset.el!] = v;
    });
  });
  return out;
}

/**
 * Hold every animation under `root` at `ms` into its slide show step (delays
 * count), so its computed style is that moment's look.
 */
export function seekAnimations(root: HTMLElement, ms: number) {
  for (const a of root.getAnimations({ subtree: true })) {
    a.pause();
    a.currentTime = ms;
  }
}
