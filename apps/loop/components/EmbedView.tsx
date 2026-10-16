"use client";
import { useEffect, useRef } from "react";
import type { Me } from "./client";
import { ComponentCard } from "./ComponentCard";

/**
 * A component inside another app's page (a Chat message). It tells the page around it how tall
 * it is, so the frame grows and shrinks with the component instead of scrolling.
 */
export function EmbedView({ id, me, collabUrl }: { id: string; me: Me; collabUrl: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.parent === window || !ref.current) return;
    const send = () => window.parent.postMessage({ type: "synergy-loop:height", id, height: Math.ceil(ref.current!.getBoundingClientRect().height) }, "*");
    const ro = new ResizeObserver(send);
    ro.observe(ref.current);
    send();
    return () => ro.disconnect();
  }, [id]);
  return (
    <div ref={ref} className="embed">
      <ComponentCard id={id} me={me} collabUrl={collabUrl} where="embed" />
    </div>
  );
}
