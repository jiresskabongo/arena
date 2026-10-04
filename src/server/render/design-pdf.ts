import { type DesignContent, type DesignElement } from '@/lib/design-elements';
import QRCode from 'qrcode';

/** Surface API de PDFKit utilisée par ce renderer (types pdfkit incomplets). */
export type PdfDoc = {
  save(): PdfDoc;
  restore(): PdfDoc;
  opacity(n: number): PdfDoc;
  translate(x: number, y: number): PdfDoc;
  rotate(deg: number): PdfDoc;
  font(f: string): PdfDoc;
  fontSize(n: number): PdfDoc;
  fillColor(c: string): PdfDoc;
  text(s: string, x: number, y: number, opts?: Record<string, unknown>): PdfDoc;
  rect(x: number, y: number, w: number, h: number): PdfDoc;
  roundedRect(x: number, y: number, w: number, h: number, r: number): PdfDoc;
  circle(cx: number, cy: number, r: number): PdfDoc;
  moveTo(x: number, y: number): PdfDoc;
  lineTo(x: number, y: number): PdfDoc;
  closePath(): PdfDoc;
  fill(c?: string): PdfDoc;
  image(buf: Buffer, x: number, y: number, opts?: Record<string, unknown>): PdfDoc;
  linearGradient(x1: number, y1: number, x2: number, y2: number): { stop(p: number, c: string): { stop(p: number, c: string): unknown } };
  lineWidth(n: number): PdfDoc;
  lineCap(s: string): PdfDoc;
  stroke(color?: string): PdfDoc;
};

/**
 * Rendu PDF d'un design (PDFKit, polices base-14).
 * Approximations déclarées : polices = Times (display) / Helvetica (sans),
 * retex estimé (largeur moyenne de caractère), pas de polices web custom.
 */

const FONT_MAP: Record<string, { reg: string; bold: string; italic: string; boldItalic: string }> = {
  display: { reg: 'Times-Roman', bold: 'Times-Bold', italic: 'Times-Italic', boldItalic: 'Times-BoldItalic' },
  sans: { reg: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique', boldItalic: 'Helvetica-BoldOblique' },
};

type ResolveImageSrc = (src: string) => Promise<Buffer | null>;

function wrapText(text: string, widthPt: number, fontSize: number, family: string): string[] {
  const factor = family === 'display' ? 0.5 : 0.52;
  const maxChars = Math.max(3, Math.floor(widthPt / (fontSize * factor)));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars) cur = next;
    else {
      if (cur) lines.push(cur);
      if (w.length > maxChars) {
        for (let i = 0; i < w.length; i += maxChars) lines.push(w.slice(i, i + maxChars));
        cur = '';
      } else cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function pickFont(family: string, weight: number, italic: boolean): string {
  const f = FONT_MAP[family] ?? FONT_MAP.sans;
  if (weight >= 600 && italic) return f.boldItalic;
  if (weight >= 600) return f.bold;
  if (italic) return f.italic;
  return f.reg;
}

type Size = { width: number; height: number };

export async function renderDesignPdf(
  doc: PdfDoc,
  design: Size,
  content: DesignContent,
  resolveImageSrc: ResolveImageSrc,
): Promise<void> {
  const bg = content.background;
  if (bg.type === 'color' || bg.type === 'pattern') {
    const m = bg.value.match(/linear-gradient\(\s*\d+deg,\s*(.+)\)/);
    if (m) {
      const stops = m[1].split(',').map((s) => {
        const p = s.trim().split(/\s+/);
        return [p.length > 1 ? Number(p[1].replace('%', '')) : 0, p[0]] as [number, string];
      });
      if (stops.length >= 2) {
        // Dégradé linéaire haut → bas (approx)
        doc.linearGradient(0, 0, 0, design.height)
          .stop(0, stops[0][1])
          .stop(1, stops[stops.length - 1][1]);
        doc.rect(0, 0, design.width, design.height).fill();
        await drawElements(doc, design, content, resolveImageSrc);
        return;
      }
    }
    doc.rect(0, 0, design.width, design.height).fill(bg.type === 'pattern' ? '#fff' : bg.value);
  } else if (bg.type === 'image') {
    const buf = await resolveImageSrc(bg.value);
    if (buf) {
      doc.image(buf, 0, 0, { fit: [design.width, design.height] });
    } else {
      doc.rect(0, 0, design.width, design.height).fill('#eeeeee');
    }
  }
  await drawElements(doc, design, content, resolveImageSrc);
}

async function drawElements(
  doc: PdfDoc,
  design: Size,
  content: DesignContent,
  resolveImageSrc: ResolveImageSrc,
): Promise<void> {
  const sorted = [...content.elements].sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));
  for (const el of sorted) {
    await drawElement(doc, el, resolveImageSrc);
    void design;
  }
}

async function drawElement(
  doc: PdfDoc,
  el: DesignElement,
  resolveImageSrc: ResolveImageSrc,
): Promise<void> {
  doc.save();
  if (el.opacity < 1) doc.opacity(el.opacity);
  if (el.rotation) {
    const rad = (el.rotation * Math.PI) / 180;
    doc.translate(el.x + el.width / 2, el.y + el.height / 2)
      .rotate(rad)
      .translate(-(el.x + el.width / 2), -(el.y + el.height / 2));
  }

  if (el.type === 'text') {
    const family = el.fontFamily;
    const fontName = pickFont(family, el.fontWeight, el.italic);
    doc.font(fontName);
    const lineH = el.fontSize * el.lineHeight;
    const lines = wrapText(el.uppercase ? el.text.toUpperCase() : el.text, el.width - 4, el.fontSize, family);
    const totalH = lines.length * lineH;
    let y = el.y + el.height / 2 - totalH / 2;
    for (const line of lines) {
      doc.fontSize(el.fontSize).fillColor(el.color);
      doc.text(line, el.x, y + lineH * 0.35, {
        width: el.width,
        align: el.align,
        lineBreak: false,
      });
      y += lineH;
    }
  } else if (el.type === 'shape') {
    if (el.shape === 'rect') {
      const path =
        el.borderRadius > 0
          ? doc.roundedRect(el.x, el.y, el.width, el.height, el.borderRadius)
          : doc.rect(el.x, el.y, el.width, el.height);
      if (el.fill !== 'none') path.fill(el.fill);
      if (el.stroke !== 'none' && el.strokeWidth > 0) doc.lineWidth(el.strokeWidth).lineCap('round').stroke(el.stroke);
    } else if (el.shape === 'circle') {
      const path = doc.circle(el.x + el.width / 2, el.y + el.height / 2, Math.min(el.width, el.height) / 2);
      if (el.fill !== 'none') path.fill(el.fill);
      if (el.stroke !== 'none' && el.strokeWidth > 0) doc.lineWidth(el.strokeWidth).lineCap('round').stroke(el.stroke);
    } else if (el.shape === 'ring') {
      doc.lineWidth(el.strokeWidth).lineCap('round');
      doc.circle(el.x + el.width / 2, el.y + el.height / 2, el.width / 2 - el.strokeWidth / 2)
        .stroke(el.stroke === 'none' ? '#999999' : el.stroke);
    } else if (el.shape === 'line') {
      doc.lineWidth(el.strokeWidth || 2).lineCap('round');
      doc.moveTo(el.x, el.y + el.height / 2)
        .lineTo(el.x + el.width, el.y + el.height / 2)
        .stroke(el.stroke === 'none' ? '#999999' : el.stroke);
    } else if (el.shape === 'triangle') {
      doc.moveTo(el.x + el.width / 2, el.y)
        .lineTo(el.x + el.width, el.y + el.height)
        .lineTo(el.x, el.y + el.height)
        .closePath();
      if (el.fill !== 'none') doc.fill(el.fill);
      if (el.stroke !== 'none' && el.strokeWidth > 0) doc.lineWidth(el.strokeWidth).lineCap('round').stroke(el.stroke);
    }
  } else if (el.type === 'icon') {
    const glyph = safeGlyph(el.icon);
    doc.font('Helvetica').fontSize(el.height * 0.7).fillColor(el.iconColor);
    doc.text(glyph, el.x, el.y, { width: el.width, align: 'center', lineBreak: false });
  } else if (el.type === 'image') {
    const buf = await resolveImageSrc(el.src);
    if (buf) {
      doc.image(buf, el.x, el.y, { width: el.width, height: el.height });
    }
  } else if (el.type === 'qr') {
    const buf = await QRCode.toBuffer(el.value, {
      errorCorrectionLevel: 'M',
      margin: el.margin,
      width: 512,
      color: el.color === 'white' ? { dark: '#FFFFFF', light: '#000000' } : { dark: '#000000', light: '#FFFFFF' },
    });
    if (el.color === 'white') {
      doc.rect(el.x - 8, el.y - 8, el.width + 16, el.height + 16).fill('#FFFFFF');
    }
    doc.image(buf, el.x, el.y, { width: el.width, height: el.height });
  }

  doc.restore();
}

/** Seuls les glyphes compatibles base-14/Helvetica ; les emoji → fallback '•'. */
function safeGlyph(icon: string): string {
  const map: Record<string, string> = {
    heart: '♥', star: '★', sparkle: '✦', flower: '✿', leaf: '❧',
    music: '♪', phone: '✆', crown: '♛', sun: '☀', moon: '☾',
    infinity: '∞', diamond: '◆',
  };
  return map[icon] ?? '•';
}
