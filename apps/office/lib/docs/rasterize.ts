// Browser only: draw an SVG as a PNG (for Word's raster copy of an SVG picture).
export function rasterizeSvg(svg: string, width: number, height: number, scale = 2): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve(null);
    const img = new Image();
    img.onload = () => {
      // at most 4096 px on a side
      const s = Math.min(scale, 4096 / Math.max(width, height, 1));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(width * s));
      c.height = Math.max(1, Math.round(height * s));
      const ctx = c.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(async (b) => resolve(b ? new Uint8Array(await b.arrayBuffer()) : null), "image/png");
    };
    img.onerror = () => resolve(null);
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  });
}
