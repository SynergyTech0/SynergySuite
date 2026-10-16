// Slide rich text is shared through the collab doc, so anything rendered as
// raw HTML (thumbnails, slideshow, inactive text boxes) is first reduced to the
// small tag/style vocabulary the slide editor itself produces.

import { safeHref } from "./text";

const TAGS = new Set(["p", "ul", "ol", "li", "strong", "b", "em", "i", "u", "s", "strike", "del", "span", "br", "sub", "sup", "mark", "a"]);
const STYLES = ["color", "font-size", "font-family", "text-align", "background-color", "line-height", "margin-top", "margin-bottom"];
const SAFE_VALUE = /^[#\w\s.,%'"()-]+$/;

const cache = new Map<string, string>();

export function sanitizeHtml(html: string): string {
  if (!html) return "";
  if (typeof DOMParser === "undefined") return "";
  const hit = cache.get(html);
  if (hit !== undefined) return hit;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const out = document.createElement("div");
  const copy = (src: Node, dst: Node) => {
    src.childNodes.forEach((n) => {
      if (n.nodeType === 3) dst.appendChild(document.createTextNode(n.textContent || ""));
      else if (n.nodeType === 1) {
        const el = n as HTMLElement;
        const tag = el.tagName.toLowerCase();
        if (!TAGS.has(tag)) {
          if (tag !== "script" && tag !== "style") copy(el, dst); // keep text, drop the tag
          return;
        }
        const c = document.createElement(tag);
        const css: string[] = [];
        for (const p of STYLES) {
          const v = el.style.getPropertyValue(p);
          if (v && SAFE_VALUE.test(v) && !/url\s*\(|expression/i.test(v)) css.push(`${p}: ${v}`);
        }
        if (css.length) c.setAttribute("style", css.join("; "));
        if (tag === "a") {
          // links open in a new tab, never as script
          const href = safeHref(el.getAttribute("href"));
          if (href) c.setAttribute("href", href);
          c.setAttribute("target", "_blank");
          c.setAttribute("rel", "noopener noreferrer nofollow");
        }
        copy(el, c);
        dst.appendChild(c);
      }
    });
  };
  copy(doc.body, out);
  const res = out.innerHTML;
  if (cache.size > 500) cache.clear();
  cache.set(html, res);
  return res;
}

/** Only allow image sources that can't run script. */
export function safeSrc(src: string): string {
  if (/^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml);base64,/i.test(src)) return src;
  if (/^https?:\/\//i.test(src) || src.startsWith("/")) return src;
  return "";
}

/** Audio/video sources: uploaded files on this server, http(s) URLs, or base64 data while an import uploads. */
export function safeMediaSrc(src: string): string {
  if (/^data:(video|audio)\/[\w.+-]+;base64,/i.test(src)) return src;
  if (/^https?:\/\//i.test(src) || (src.startsWith("/") && !src.startsWith("//"))) return src;
  return "";
}
