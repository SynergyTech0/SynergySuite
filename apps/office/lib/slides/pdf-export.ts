// PDF export: slides (one page each, at the slide's size), notes pages (the
// slide above its speaker notes) or handouts (1, 2, 3, 4, 6 or 9 slides per
// page; 3 per page adds lines for notes). Each slide is drawn once as a form
// XObject and placed on as many pages as need it. Browser only.
import { Ops, PdfWriter, isWinAnsi, type LinkAnnot, type RGB, type StdFont } from "./pdf";
import { slideForm, stdWidth, type PdfLink } from "./pdf-render";

export type PdfLayout = "slides" | "notes" | "handouts";
export type PdfOptions = { layout: PdfLayout; perPage?: 1 | 2 | 3 | 4 | 6 | 9; includeHidden?: boolean; frame?: boolean };
export type PdfSlide = { root: HTMLElement; notes: string; hidden?: boolean; num: number };

export const HANDOUT_SIZES = [1, 2, 3, 4, 6, 9] as const;

const LETTER = { w: 612, h: 792 };
const GRAY: RGB = [128, 128, 128];
const LINE: RGB = [190, 190, 190];
const PX_TO_PT = 0.75;

/** Greedy word wrap with the standard font's widths; keeps blank lines. */
export function wrapText(text: string, font: StdFont, size: number, width: number, measure = stdWidth): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r\n?/g, "\n").split("\n")) {
    const words = para.split(/(\s+)/).filter((w) => w.length);
    let line = "";
    for (const w of words) {
      const next = line + w;
      if (!line.trim() || measure(font, size, next.trimEnd()) <= width) line = /^\s+$/.test(next) ? "" : next;
      else {
        out.push(line.trimEnd());
        line = /^\s+$/.test(w) ? "" : w;
      }
      // a single word wider than the line is cut into pieces
      while (!/\s/.test(line) && measure(font, size, line) > width && line.length > 1) {
        let k = line.length - 1;
        while (k > 1 && measure(font, size, line.slice(0, k)) > width) k--;
        out.push(line.slice(0, k));
        line = line.slice(k);
      }
    }
    out.push(line.trimEnd());
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

/** One line of page text (y-down page space, `y` = baseline). */
function textLine(pdf: PdfWriter, ops: Ops, s: string, x: number, y: number, size: number, font: StdFont, color: RGB = [0, 0, 0]) {
  if (!s) return;
  if (isWinAnsi(s)) {
    ops.save().fillColor(color).text(pdf.font(font), size, [1, 0, 0, -1, x, y], s).restore();
    return;
  }
  // characters outside the standard fonts: a picture of the line
  const k = 3;
  const cv = document.createElement("canvas");
  const g0 = cv.getContext("2d")!;
  const css = `${/Bold/.test(font) ? "bold " : ""}${size}px ${font.startsWith("Times") ? "serif" : font.startsWith("Courier") ? "monospace" : "Arial, sans-serif"}`;
  g0.font = css;
  const w = Math.ceil(g0.measureText(s).width) + 2;
  cv.width = w * k;
  cv.height = Math.ceil(size * 1.4 * k);
  const g = cv.getContext("2d")!;
  g.scale(k, k);
  g.font = css;
  g.fillStyle = `rgb(${color.join(",")})`;
  g.fillText(s, 0, size * 1.05);
  const name = pdf.rgba(g.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
  const h = cv.height / k;
  ops.save().cm([w, 0, 0, -h, x, y - size * 1.05 + h]).xobject(name).restore();
}

/** Place a slide form at (x, top) in y-down page space, `s` units per slide px. */
function placeForm(ops: Ops, form: string, x: number, top: number, s: number, W: number, H: number, frame: boolean) {
  ops.save().cm([s, 0, 0, -s, x, top + H * s]).xobject(form).restore();
  if (frame) ops.save().strokeColor(GRAY).lineWidth(0.75).rect(x, top, W * s, H * s).stroke().restore();
}

const flipPage = (h: number) => new Ops().cm([1, 0, 0, -1, 0, h]);

function footer(pdf: PdfWriter, ops: Ops, page: number, pageW: number, pageH: number) {
  const s = String(page);
  textLine(pdf, ops, s, pageW / 2 - stdWidth("Helvetica", 9, s) / 2, pageH - 22, 9, "Helvetica", GRAY);
}

/** Build the PDF from rendered slides (each `root` laid out at W x H px). */
export async function buildPdf(slides: PdfSlide[], W: number, H: number, title: string, opts: PdfOptions): Promise<Uint8Array> {
  const pdf = new PdfWriter();
  pdf.title = title;
  const list = slides.filter((s) => opts.includeHidden || !s.hidden);
  const images = new Map<string, Promise<string | null>>();
  const forms: { form: string; links: PdfLink[] }[] = [];
  for (const s of list) forms.push(await slideForm(pdf, s.root, W, H, images));

  if (opts.layout === "slides") {
    const pw = W * PX_TO_PT, ph = H * PX_TO_PT;
    forms.forEach(({ form, links }) => {
      const ops = flipPage(ph);
      placeForm(ops, form, 0, 0, PX_TO_PT, W, H, false);
      const annots: LinkAnnot[] = links.map((l) => ({ url: l.url, rect: [l.x * PX_TO_PT, ph - (l.y + l.h) * PX_TO_PT, (l.x + l.w) * PX_TO_PT, ph - l.y * PX_TO_PT] }));
      pdf.addPage(pw, ph, ops.toString(), annots);
    });
  } else if (opts.layout === "notes") {
    const { w: pw, h: ph } = LETTER;
    const slideW = 432, s = slideW / W, slideH = H * s, left = (pw - slideW) / 2, top = 54;
    const size = 12, lead = 15.5, textX = 72, textW = pw - 144;
    let page = 0;
    list.forEach((sl, i) => {
      let ops = flipPage(ph);
      placeForm(ops, forms[i].form, left, top, s, W, H, true);
      let y = top + slideH + 36;
      const lines = wrapText(sl.notes.trim(), "Helvetica", size, textW);
      for (const ln of lines) {
        if (y > ph - 54) {
          footer(pdf, ops, ++page, pw, ph);
          pdf.addPage(pw, ph, ops.toString());
          ops = flipPage(ph);
          y = 72;
        }
        textLine(pdf, ops, ln, textX, y, size, "Helvetica");
        y += lead;
      }
      footer(pdf, ops, ++page, pw, ph);
      pdf.addPage(pw, ph, ops.toString());
    });
  } else {
    const per = opts.perPage && HANDOUT_SIZES.includes(opts.perPage) ? opts.perPage : 6;
    const { w: pw, h: ph } = LETTER;
    const [cols, rows] = ({ 1: [1, 1], 2: [1, 2], 3: [1, 3], 4: [2, 2], 6: [2, 3], 9: [3, 3] } as const)[per];
    const area = { x: 54, y: 66, w: pw - 108, h: ph - 66 - 48 };
    const cw = area.w / cols, ch = area.h / rows;
    const pad = per === 1 ? 0 : 12;
    let page = 0;
    for (let start = 0; start < forms.length; start += per) {
      const ops = flipPage(ph);
      textLine(pdf, ops, title, area.x, 40, 10, "Helvetica", GRAY);
      for (let k = 0; k < per && start + k < forms.length; k++) {
        const col = k % cols, row = Math.floor(k / cols);
        const cx = area.x + col * cw, cy = area.y + row * ch;
        const boxW = (per === 3 ? cw * 0.52 : cw) - pad * 2, boxH = ch - pad * 2;
        const s = Math.min(boxW / W, boxH / H);
        const sw = W * s, sh = H * s;
        const x = cx + pad + (per === 3 ? 0 : (boxW - sw) / 2), top = cy + pad + (boxH - sh) / 2;
        placeForm(ops, forms[start + k].form, x, top, s, W, H, opts.frame !== false);
        if (per === 3) {
          // ruled lines beside the slide for the audience's notes
          const lx = cx + cw * 0.56, lw = cw * 0.44 - pad;
          ops.save().strokeColor(LINE).lineWidth(0.5);
          for (let ly = top + 22; ly <= top + sh; ly += 22) ops.m(lx, ly).l(lx + lw, ly);
          ops.stroke().restore();
        }
      }
      footer(pdf, ops, ++page, pw, ph);
      pdf.addPage(pw, ph, ops.toString());
    }
  }
  if (!pdf.pageCount) pdf.addPage(W * PX_TO_PT, H * PX_TO_PT, "");
  return pdf.save();
}
