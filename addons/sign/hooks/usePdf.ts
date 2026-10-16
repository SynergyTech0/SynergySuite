"use client";

import { useEffect, useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";

// ✅ Configure the worker only once and only in the browser
if (typeof window !== "undefined" && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
}

export function usePdf(url: string) {
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // 🧩 Load the PDF document when URL changes
  useEffect(() => {
    if (!url) {
      setPdf(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const loadingTask = pdfjsLib.getDocument(url);

    loadingTask.promise
      .then((doc) => {
        if (!cancelled) setPdf(doc);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      try {
        loadingTask.destroy();
      } catch {
        /* ignore */
      }
    };
  }, [url]);

  // 🧩 Render a page to a <canvas>
  const renderPageToCanvas = useCallback(
    async (pageNum: number, canvasEl: HTMLCanvasElement, scale = 1.5) => {
      if (!pdf) throw new Error("PDF not loaded yet");

      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const ctx = canvasEl.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("Failed to get 2D context");

      const dpr = window.devicePixelRatio || 1;

      // Canvas pixel size (high-DPI)
      canvasEl.width = Math.floor(viewport.width * dpr);
      canvasEl.height = Math.floor(viewport.height * dpr);

      // CSS size (display)
      canvasEl.style.width = `${viewport.width}px`;
      canvasEl.style.height = `${viewport.height}px`;

      // ✅ Reset transform & clear before render
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);

      // Apply device-pixel scaling
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Cancel any previous render task on this canvas
      if ((canvasEl as any).__renderTask) {
        try {
          (canvasEl as any).__renderTask.cancel();
        } catch {
          /* ignore */
        }
      }

      // ✅ Render the page (correct signature for pdfjs-dist@3.x)
      const renderTask = page.render({
        canvasContext: ctx,
        viewport,
      });

      (canvasEl as any).__renderTask = renderTask;

      await renderTask.promise.catch((err) => {
        if (err?.name === "RenderingCancelledException") {
          console.warn(`PDF page ${pageNum} rendering cancelled`);
          return;
        }
        throw err;
      });

      return { width: viewport.width, height: viewport.height };
    },
    [pdf]
  );

  return {
    pdf,
    loading,
    error,
    renderPageToCanvas,
    numPages: pdf?.numPages ?? 0,
  };
}