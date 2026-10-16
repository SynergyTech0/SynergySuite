// Block renderer: turns a page's block array + site theme into a standalone
// HTML document. Shared by the public route and the staff preview endpoint —
// one renderer, so suite-served and (future) MSP-served sites look identical.
const { appUrl } = require('@synergy/config');
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const url = u => {
  const s = String(u || '').trim();
  if (!s) return '#';
  if (/^(https?:)?\/\//.test(s) || s.startsWith('/') || s.startsWith('#') || s.startsWith('mailto:') || s.startsWith('tel:')) return esc(s);
  return esc('https://' + s);
};
const mdInline = s => esc(s)
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1<em>$2</em>')
  .replace(/\n/g, '<br/>');

function renderBlock(b) {
  const d = b.data || {};
  switch (b.type) {
    case 'hero':
      return `<section class="blk hero" style="${d.bg ? `background:${esc(d.bg)};` : ''}${d.image ? `background-image:linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.35)),url('${url(d.image)}');background-size:cover;background-position:center;color:#fff;` : ''}">
        <div class="wrap">
          <h1>${esc(d.heading || '')}</h1>
          ${d.subheading ? `<p class="sub">${mdInline(d.subheading)}</p>` : ''}
          ${d.buttonText ? `<a class="btn" href="${url(d.buttonUrl)}">${esc(d.buttonText)}</a>` : ''}
        </div></section>`;
    case 'heading':
      return `<section class="blk"><div class="wrap"><h2>${esc(d.text || '')}</h2></div></section>`;
    case 'text':
      return `<section class="blk"><div class="wrap prose"><p>${mdInline(d.text || '')}</p></div></section>`;
    case 'image':
      return `<section class="blk"><div class="wrap"><figure><img src="${url(d.image)}" alt="${esc(d.alt || '')}"/>${d.caption ? `<figcaption>${esc(d.caption)}</figcaption>` : ''}</figure></div></section>`;
    case 'cta':
      return `<section class="blk cta"><div class="wrap">
        <h2>${esc(d.heading || '')}</h2>${d.text ? `<p>${mdInline(d.text)}</p>` : ''}
        ${d.buttonText ? `<a class="btn" href="${url(d.buttonUrl)}">${esc(d.buttonText)}</a>` : ''}
      </div></section>`;
    case 'columns': {
      const cols = (d.columns || []).map(c =>
        `<div class="col"><h3>${esc(c.heading || '')}</h3><p>${mdInline(c.text || '')}</p></div>`).join('');
      return `<section class="blk"><div class="wrap cols">${cols}</div></section>`;
    }
    case 'form':
      // GLUE: embed a SynergyForms form by slug.
      return `<section class="blk"><div class="wrap"><iframe class="embed" src="${esc(appUrl('forms'))}/f/${esc(d.slug || '')}" title="Form"></iframe></div></section>`;
    case 'booking':
      // GLUE: embed a booking page (user/slug) from SITES_BOOKING_URL.
      if (!process.env.SITES_BOOKING_URL) return '';
      return `<section class="blk"><div class="wrap"><iframe class="embed tall" src="${esc(process.env.SITES_BOOKING_URL)}/book/${esc(d.owner || '')}/${esc(d.slug || '')}" title="Booking"></iframe></div></section>`;
    case 'embed':
      return `<section class="blk"><div class="wrap"><iframe class="embed" src="${url(d.url)}" title="Embed"></iframe></div></section>`;
    case 'footer':
      return `<footer class="blk site-footer"><div class="wrap">${mdInline(d.text || '')}</div></footer>`;
    default:
      return '';
  }
}

function renderPage(site, page, opts = {}) {
  const theme = site.theme || {};
  const primary = /^#[0-9a-fA-F]{3,8}$/.test(theme.primary || '') ? theme.primary : '#4f46e5';
  const font = theme.font === 'serif' ? 'Georgia, "Times New Roman", serif'
    : theme.font === 'mono' ? 'ui-monospace, "Cascadia Mono", Consolas, monospace'
    : '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const blocks = Array.isArray(page.blocks) ? page.blocks.map(renderBlock).join('\n') : '';
  const chat = site.livechat_key && process.env.SITES_LIVECHAT_URL
    ? `<script defer data-widget="${esc(site.livechat_key)}" src="${esc(process.env.SITES_LIVECHAT_URL)}/widget.js"></script>` : '';
  const banner = opts.preview ? `<div style="position:fixed;top:0;left:0;right:0;background:${primary};color:#fff;text-align:center;padding:5px;font:600 13px sans-serif;z-index:9999">Preview — not published</div>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(page.title || site.name)}</title>
${site.description ? `<meta name="description" content="${esc(site.description)}">` : ''}
<style>
:root{--primary:${primary}}
*{box-sizing:border-box}body{margin:0;font-family:${font};color:#1d1e26;line-height:1.6}
.wrap{max-width:960px;margin:0 auto;padding:0 22px}
.blk{padding:56px 0}.blk h1{font-size:44px;margin:0 0 14px;line-height:1.15}
.blk h2{font-size:30px;margin:0 0 12px}.blk h3{font-size:19px;margin:0 0 6px}
.hero{text-align:center;padding:96px 0;background:#f6f7f9}
.hero .sub{font-size:19px;opacity:.85;max-width:640px;margin:0 auto 22px}
.prose{max-width:720px;font-size:17px}
.btn{display:inline-block;background:var(--primary);color:#fff;text-decoration:none;padding:13px 26px;border-radius:9px;font-weight:700;font-size:16px}
.cta{background:var(--primary);color:#fff;text-align:center}.cta .btn{background:#fff;color:var(--primary);margin-top:8px}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:26px}
figure{margin:0}figure img{max-width:100%;border-radius:12px}figcaption{color:#889;font-size:14px;margin-top:6px}
.embed{width:100%;height:520px;border:1px solid #e3e5ee;border-radius:12px}.embed.tall{height:640px}
.site-footer{background:#1d1e26;color:#c9ccd6;text-align:center;padding:34px 0;font-size:14px}
@media(max-width:600px){.blk h1{font-size:32px}.hero{padding:64px 0}}
</style></head><body>${banner}${blocks}${chat}</body></html>`;
}

module.exports = { renderPage };
