// Slides as pictures, in the browser: a laid-out slide (see renderOffscreen)
// is copied with its computed styles inlined and its pictures as data URLs
// into an SVG <foreignObject>, which a canvas can draw without being tainted.
// Used for zoom thumbnails in .pptx files and for the frames of a video.

const SKIP = new Set(["SCRIPT", "NOSCRIPT", "TEMPLATE", "AUDIO"]);

async function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
}

/** A picture's URL as a data URL (pictures that cannot be read are left out). */
async function inlineUrl(url: string, cache: Map<string, Promise<string | null>>): Promise<string | null> {
  if (!url || url.startsWith("data:")) return url || null;
  let p = cache.get(url);
  if (!p) {
    p = fetch(url, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => (b ? blobToDataUrl(b) : null))
      .catch(() => null);
    cache.set(url, p);
  }
  return p;
}

function styleText(cs: CSSStyleDeclaration): string {
  let out = "";
  for (let i = 0; i < cs.length; i++) {
    const p = cs[i];
    // never animate or transition in the picture; it shows the end state
    if (p.startsWith("animation") || p.startsWith("transition")) continue;
    out += `${p}:${cs.getPropertyValue(p)};`;
  }
  return out;
}

/** A detached copy of `src` with every element's computed style written inline. */
async function cloneStyled(src: Element, cache: Map<string, Promise<string | null>>): Promise<Node | null> {
  if (SKIP.has(src.tagName)) return null;
  const win = src.ownerDocument.defaultView || window;
  if (src instanceof win.HTMLVideoElement) {
    // a video shows its current frame (or its poster)
    const img = src.ownerDocument.createElement("img");
    img.setAttribute("style", styleText(win.getComputedStyle(src)));
    try {
      if (src.readyState >= 2 && src.videoWidth) {
        const c = src.ownerDocument.createElement("canvas");
        c.width = src.videoWidth;
        c.height = src.videoHeight;
        c.getContext("2d")!.drawImage(src, 0, 0);
        img.src = c.toDataURL("image/jpeg", 0.85);
      } else if (src.poster) img.src = (await inlineUrl(src.poster, cache)) || "";
    } catch {
      img.src = src.poster ? (await inlineUrl(src.poster, cache)) || "" : "";
    }
    return img;
  }
  if (src instanceof win.HTMLCanvasElement) {
    const img = src.ownerDocument.createElement("img");
    img.setAttribute("style", styleText(win.getComputedStyle(src)));
    try {
      img.src = src.toDataURL();
    } catch {
      // a tainted canvas is left blank
    }
    return img;
  }
  const out = src.cloneNode(false) as Element;
  out.setAttribute("style", styleText(win.getComputedStyle(src)));
  out.removeAttribute("class");
  if (src instanceof win.HTMLImageElement) {
    const data = await inlineUrl(src.currentSrc || src.src, cache);
    if (data) out.setAttribute("src", data);
    else out.removeAttribute("src");
    out.removeAttribute("srcset");
  } else if (src.namespaceURI === "http://www.w3.org/2000/svg" && src.localName === "image") {
    const href = src.getAttribute("href") || src.getAttributeNS("http://www.w3.org/1999/xlink", "href") || "";
    const data = await inlineUrl(href, cache);
    if (data) out.setAttribute("href", data);
  }
  for (const c of Array.from(src.childNodes)) {
    if (c.nodeType === 3) out.appendChild(c.cloneNode());
    else if (c.nodeType === 1) {
      const k = await cloneStyled(c as Element, cache);
      if (k) out.appendChild(k);
    }
  }
  return out;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("The slide could not be drawn."));
    img.src = url;
  });
}

/** The SVG document that draws `root` (a W×H slide) at outW×outH. */
export async function slideSvg(root: HTMLElement, W: number, H: number, outW = W, outH = H, cache = new Map<string, Promise<string | null>>()): Promise<string> {
  const copy = (await cloneStyled(root, cache)) as HTMLElement;
  copy.style.position = "relative";
  copy.style.left = "0";
  copy.style.top = "0";
  copy.style.margin = "0";
  const xml = new XMLSerializer().serializeToString(copy);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="0 0 ${W} ${H}"><foreignObject x="0" y="0" width="${W}" height="${H}">${xml}</foreignObject></svg>`;
}

/** Draw a laid-out slide onto a new canvas of outW×outH. */
export async function rasterize(root: HTMLElement, W: number, H: number, outW: number, outH: number, cache?: Map<string, Promise<string | null>>): Promise<HTMLCanvasElement> {
  const svg = await slideSvg(root, W, H, outW, outH, cache);
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  await img.decode().catch(() => undefined);
  const c = document.createElement("canvas");
  c.width = outW;
  c.height = outH;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, outW, outH);
  g.drawImage(img, 0, 0, outW, outH);
  return c;
}
