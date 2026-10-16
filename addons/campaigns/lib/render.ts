import type { Block } from './repo';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Render ordered content blocks into an email-safe HTML document. */
export function blocksToHtml(blocks: Block[], opts: { preheader?: string } = {}): string {
  const body = blocks.map(renderBlock).join('\n');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:Segoe UI,Arial,sans-serif;color:#1a1a1a">
${opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden">${esc(opts.preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7"><tr>
<td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;max-width:600px;width:100%">
<tr><td style="padding:8px 28px">
${body}
</td></tr></table>
</td></tr></table>
</body></html>`;
}

function renderBlock(b: Block): string {
  switch (b.type) {
    case 'heading':
      return `<h1 style="font-size:24px;font-weight:700;margin:20px 0 8px">${(b.text as string) ?? ''}</h1>`;
    case 'text':
      return `<p style="font-size:16px;line-height:1.6;margin:0 0 16px">${(b.text as string) ?? ''}</p>`;
    case 'button':
      return `<p style="margin:16px 0">
<a href="${(b.url as string) ?? '#'}" style="display:inline-block;background:${(b.color as string) ?? '#0b5cff'};color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-size:15px;font-weight:600">${(b.text as string) ?? 'Click here'}</a></p>`;
    case 'image':
      return `<p style="margin:16px 0"><img src="${(b.url as string) ?? ''}" alt="${esc((b.alt as string) ?? '')}" style="max-width:100%;border-radius:6px"></p>`;
    case 'divider':
      return `<hr style="border:none;border-top:1px solid #e3e3e8;margin:20px 0">`;
    default:
      return '';
  }
}

/**
 * Inject open + click tracking. Leaves {{track_token}} as a merge placeholder so
 * the Python mailer fills a unique value per recipient. baseUrl must be public.
 */
export function injectTracking(html: string, baseUrl: string, campaignId: string): string {
  const base = baseUrl.replace(/\/$/, '');
  // rewrite each real link through the click tracker (skip mailto/anchors/merge-only)
  let out = html.replace(/href="([^"]+)"/g, (m, url: string) => {
    if (/^(mailto:|#|\{\{)/.test(url)) return m;
    const dest = encodeURIComponent(url);
    return `href="${base}/t/c/${campaignId}/{{track_token}}?u=${dest}"`;
  });
  const pixel = `<img src="${base}/t/o/${campaignId}/{{track_token}}" width="1" height="1" alt="" style="display:none;max-height:0;overflow:hidden">`;
  if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, `${pixel}</body>`);
  else out += pixel;
  return out;
}

/** Simple {{var}} preview merge for the in-app preview pane (not used for sending). */
export function previewMerge(html: string, row: Record<string, string>): string {
  return html.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*(?:\|\s*default:\s*([^}]*?)\s*)?\}\}/g,
    (_m, k: string, d?: string) => row[k] ?? d ?? '');
}
