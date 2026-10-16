"use client";

import React, { useEffect, useRef, useState } from "react";
import { usePdf } from "@/hooks/usePdf";

type PdfPageProps = {
  url: string;
  pageNumber: number;
  scale?: number;
  onRendered?: (info: { width: number; height: number }) => void;
};

export default function PdfPage({
  url,
  pageNumber,
  scale = 1,
  onRendered,
}: PdfPageProps) {
  const { pdf } = usePdf(url);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;

    const canvas = canvasRef.current;
    let mounted = true;
    let renderTask: any = null;

    const render = async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale });

        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) throw new Error("No 2D context found");

        const dpr = window.devicePixelRatio || 1;

        // Set internal and CSS sizes
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        // Clear and prepare background
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Apply device pixel ratio scaling
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Cancel previous render if exists
        if ((canvas as any).__renderTask) {
          try {
            (canvas as any).__renderTask.cancel();
          } catch {
            /* ignore */
          }
        }

        // ✅ Compatible with PDF.js v3.x
        renderTask = page.render({
          canvasContext: ctx,
          viewport,
        });
        
        (canvas as any).__renderTask = renderTask;

        await renderTask.promise;

        if (!mounted) return;

        // Sync wrapper size
        setPageSize({ w: viewport.width, h: viewport.height });
        if (wrapperRef.current) {
          wrapperRef.current.style.width = `${Math.round(viewport.width)}px`;
          wrapperRef.current.style.height = `${Math.round(viewport.height)}px`;
        }

        onRendered?.({ width: viewport.width, height: viewport.height });
      } catch (err: any) {
        if (err?.name === "RenderingCancelledException") return;
        console.error("❌ PDF render error:", err);
      }
    };

    render();

    return () => {
      mounted = false;
      if (renderTask) {
        try {
          renderTask.cancel();
        } catch {
          /* ignore */
        }
      }
    };
  }, [pdf, url, pageNumber, scale, onRendered]);

  return (
    <div style={{ display: "flex", justifyContent: "center", width: "100%" }}>
      <div
        ref={wrapperRef}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: pageSize?.w ?? "100%",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            display: "block",
            background: "#fff",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            borderRadius: "4px",
          }}
        />
      </div>
    </div>
  );
}
