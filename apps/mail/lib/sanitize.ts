import sanitizeHtml from "sanitize-html";

/**
 * Email HTML is hostile by default. We keep layout and formatting, drop anything that can run
 * code or submit data, point inline (cid:) images at our attachment endpoint, and hold back
 * remote images until the reader asks for them, since loading one tells the sender the mail
 * was opened. The result is shown in a sandboxed iframe as a second layer.
 */
export function cleanHtml(
  html: string,
  opts: { allowRemoteImages: boolean; cids: Map<string, string> },
): { html: string; blockedRemote: boolean; usedCids: Set<string> } {
  let blockedRemote = false;
  const usedCids = new Set<string>();
  const out = sanitizeHtml(html, {
    allowedTags: [
      "a", "abbr", "address", "b", "big", "blockquote", "br", "caption", "center", "cite", "code", "col", "colgroup",
      "dd", "del", "div", "dl", "dt", "em", "font", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins",
      "kbd", "li", "mark", "ol", "p", "pre", "q", "s", "small", "span", "strike", "strong", "sub", "sup", "table",
      "tbody", "td", "tfoot", "th", "thead", "tr", "tt", "u", "ul", "style",
    ],
    allowedAttributes: {
      "*": ["style", "align", "valign", "width", "height", "bgcolor", "color", "dir", "lang", "title", "class"],
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height", "border"],
      font: ["face", "size", "color"],
      table: ["border", "cellpadding", "cellspacing"],
      td: ["colspan", "rowspan", "nowrap"],
      th: ["colspan", "rowspan", "nowrap"],
      col: ["span"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "cid", "data"] },
    allowVulnerableTags: true, // <style> is needed for most newsletters; scripts are still stripped
    transformTags: {
      a: (tag, attribs) => ({ tagName: "a", attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" } }),
      img: (tag, attribs) => {
        const src = attribs.src || "";
        if (src.startsWith("cid:")) {
          const cid = src.slice(4).replace(/^<|>$/g, "");
          const url = opts.cids.get(cid);
          usedCids.add(cid);
          return { tagName: "img", attribs: { ...attribs, src: url || "" } };
        }
        if (/^https?:/i.test(src) && !opts.allowRemoteImages) {
          blockedRemote = true;
          return { tagName: "img", attribs: { ...attribs, src: "",} };
        }
        return { tagName: "img", attribs };
      },
    },
  });
  // Remote CSS (url(...) and @import in styles) is another tracking channel.
  const noRemoteCss = opts.allowRemoteImages ? out : out
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*['"]?https?:[^)]*\)/gi, () => {
      blockedRemote = true;
      return "none";
    });
  return { html: noRemoteCss, blockedRemote, usedCids };
}
