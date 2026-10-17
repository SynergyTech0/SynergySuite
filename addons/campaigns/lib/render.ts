/**
 * Turns an email's blocks into the HTML and plain text that go out. Rendering happens in two steps:
 *
 *   compose(blocks)  once per campaign: the body with every link replaced by a numbered slot
 *                    ({{link:N}}) and the list of those links, frozen when the send starts;
 *   personalize(...) once per recipient: merge tags filled in with their (escaped) details, each
 *                    link slot pointed at the click tracker, the open pixel and the footer added.
 *
 * Block text is never trusted as HTML. Text blocks take a small markup instead: **bold**,
 * *italic*, [words](https://link) and line breaks.
 */
import type { Block } from "./types";
import { escapeHtml } from "./util";

export type Composed = { html: string; text: string; links: string[] };

export type Recipient = { email: string; firstName: string; lastName: string; company: string; fields: Record<string, string> };

export type Footer = { orgName: string; postalAddress: string; unsubscribeUrl: string; preferencesUrl?: string; browserUrl?: string; reason?: string };

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

/** A link a person typed: http(s) or mailto (a {{merge}} may sit inside), anything else is dropped. */
export function safeUrl(u: unknown): string {
  const s = String(u ?? "").trim();
  return SAFE_URL.test(s) && !/[\s<>"]/.test(s.replace(/\{\{[^}]*\}\}/g, "")) ? s : "";
}

const COLOR = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

function inline(src: string, link: (url: string) => string): string {
  // Escape first, then turn the markup into tags; the markup's characters survive escaping.
  let s = escapeHtml(src);
  s = s.replace(/\[([^\]\n]{1,200})\]\(([^)\s]{1,800})\)/g, (_m, words: string, url: string) => {
    const real = safeUrl(url.replace(/&amp;/g, "&"));
    return real ? `<a href="${link(real)}" style="color:#0f6cbd">${words}</a>` : words;
  });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return s.replace(/\r?\n/g, "<br>");
}

function plain(src: string): string {
  return src.replace(/\[([^\]\n]{1,200})\]\(([^)\s]{1,800})\)/g, "$1 ($2)").replace(/\*\*([^*\n]+)\*\*/g, "$1").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2");
}

/** The campaign body with numbered link slots, and those links in order. */
export function compose(blocks: Block[], opts: { preheader?: string } = {}): Composed {
  const links: string[] = [];
  const link = (url: string) => {
    let i = links.indexOf(url);
    if (i < 0) i = links.push(url) - 1;
    return `{{link:${i}}}`;
  };
  const html: string[] = [];
  const text: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "heading": {
        const big = b.level !== 2;
        html.push(`<h${big ? 1 : 2} style="font-size:${big ? 24 : 19}px;line-height:1.3;font-weight:700;margin:20px 0 10px">${inline(b.text ?? "", link)}</h${big ? 1 : 2}>`);
        text.push(plain(b.text ?? ""), "=".repeat(Math.min(60, plain(b.text ?? "").length)), "");
        break;
      }
      case "text":
        html.push(`<p style="font-size:16px;line-height:1.6;margin:0 0 16px">${inline(b.text ?? "", link)}</p>`);
        text.push(plain(b.text ?? ""), "");
        break;
      case "button": {
        const url = safeUrl(b.url);
        const color = COLOR.test(b.color ?? "") ? b.color : "#0f6cbd";
        if (!url) break;
        html.push(`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0"><tr><td style="background:${color};border-radius:6px">
<a href="${link(url)}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600">${escapeHtml(b.text || "Learn more")}</a></td></tr></table>`);
        text.push(`${b.text || "Learn more"}: ${url}`, "");
        break;
      }
      case "image": {
        const src = safeUrl(b.url);
        if (!src || src.startsWith("mailto:")) break;
        const img = `<img src="${escapeHtml(src)}" alt="${escapeHtml(b.alt ?? "")}" width="544" style="display:block;max-width:100%;height:auto;border:0;border-radius:6px">`;
        const to = safeUrl(b.link);
        html.push(`<div style="margin:16px 0">${to ? `<a href="${link(to)}">${img}</a>` : img}</div>`);
        if (b.alt) text.push(`[${b.alt}]`, "");
        break;
      }
      case "divider":
        html.push(`<hr style="border:0;border-top:1px solid #e3e5e9;margin:22px 0">`);
        text.push("----------", "");
        break;
      case "spacer":
        html.push(`<div style="height:${Math.min(Math.max(Number(b.height) || 24, 4), 120)}px;line-height:0;font-size:0">&nbsp;</div>`);
        break;
    }
  }
  const pre = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(opts.preheader)}${"&nbsp;&zwnj;".repeat(40)}</div>`
    : "";
  const doc = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1f2328">
${pre}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;max-width:600px;width:100%"><tr><td style="padding:12px 28px 20px">
${html.join("\n")}
</td></tr></table>
{{footer}}
</td></tr></table>{{pixel}}
</body></html>`;
  return { html: doc, text: text.join("\n").trim(), links };
}

const MERGE = /\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|\s*default:\s*([^}]*?)\s*)?\}\}/g;

function value(r: Recipient, key: string): string {
  switch (key) {
    case "email": return r.email;
    case "first_name": return r.firstName;
    case "last_name": return r.lastName;
    case "company": return r.company;
    case "name": return [r.firstName, r.lastName].filter(Boolean).join(" ");
  }
  const k = key.startsWith("fields.") ? key.slice(7) : key;
  return String(r.fields?.[k] ?? "");
}

/** Fills {{first_name}}, {{company|default: there}}, {{fields.plan}} and the like. */
export function merge(s: string, r: Recipient, encode: (v: string) => string): string {
  return s.replace(MERGE, (m, key: string, fallback?: string) => {
    if (key.startsWith("link:") || key === "footer" || key === "pixel") return m;
    return encode(value(r, key) || (fallback ?? "").replace(/^["']|["']$/g, ""));
  });
}

export function footerHtml(f: Footer): string {
  const parts = [
    f.reason ? `<p style="margin:0 0 8px">${escapeHtml(f.reason)}</p>` : "",
    `<p style="margin:0 0 8px">${escapeHtml(f.orgName)}<br>${escapeHtml(f.postalAddress).replace(/\r?\n/g, "<br>")}</p>`,
    `<p style="margin:0"><a href="${escapeHtml(f.unsubscribeUrl)}" style="color:#6b7280">Unsubscribe</a>`
      + (f.preferencesUrl ? ` &middot; <a href="${escapeHtml(f.preferencesUrl)}" style="color:#6b7280">Email preferences</a>` : "")
      + (f.browserUrl ? ` &middot; <a href="${escapeHtml(f.browserUrl)}" style="color:#6b7280">View in your browser</a>` : "")
      + `</p>`,
  ];
  return `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%"><tr><td style="padding:16px 28px;font-size:12px;line-height:1.5;color:#6b7280;text-align:center">${parts.join("")}</td></tr></table>`;
}

function footerText(f: Footer): string {
  return ["", "--", f.reason ?? "", f.orgName, f.postalAddress, `Unsubscribe: ${f.unsubscribeUrl}`].filter((l, i) => i < 2 || l).join("\n");
}

/**
 * One recipient's copy. `linkUrl(i, url)` gives what slot i points at (the click tracker when
 * sending, the link itself for a preview); `pixelUrl` adds the open pixel.
 */
export function personalize(
  c: Composed,
  r: Recipient,
  opts: { footer: Footer; linkUrl: (i: number, url: string) => string; pixelUrl?: string },
): { html: string; text: string } {
  let html = merge(c.html, r, escapeHtml);
  html = html.replace(/\{\{link:(\d+)\}\}/g, (_m, i: string) => escapeHtml(opts.linkUrl(Number(i), c.links[Number(i)] ?? "")));
  html = html.replace("{{footer}}", footerHtml(opts.footer));
  html = html.replace("{{pixel}}", opts.pixelUrl ? `<img src="${escapeHtml(opts.pixelUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">` : "");
  const text = merge(c.text, r, (v) => v) + "\n" + footerText(opts.footer);
  return { html, text };
}

/** A link with the recipient's details merged in (URL-encoded), for the click redirect. */
export function mergeUrl(url: string, r: Recipient): string {
  return merge(url, r, encodeURIComponent);
}

/** A subject line with merge tags filled in, as plain text. */
export function mergeSubject(subject: string, r: Recipient): string {
  return merge(subject, r, (v) => v).replace(/[\r\n]+/g, " ");
}

/** Where people reach Campaigns from outside: CAMPAIGNS_PUBLIC_URL, else campaigns.SUITE_DOMAIN. */
export function publicBase(): string {
  const base = process.env.CAMPAIGNS_PUBLIC_URL || (process.env.SUITE_DOMAIN ? `https://campaigns.${process.env.SUITE_DOMAIN}` : "http://localhost:3400");
  return base.replace(/\/$/, "");
}
