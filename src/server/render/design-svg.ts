import { type DesignContent, type DesignElement, FONT_STACKS } from '@/lib/design-elements';
import QRCode from 'qrcode';

/**
 * Rendu SVG d'un design (source des exports PNG).
 * Les images `src` sont résolues via `resolveImageSrc` (mediaId → data URI).
 * Approximation déclarée : le retex du texte utilise une largeur moyenne
 * de caractère (pas de métriques de police côté serveur).
 */

type ResolveImageSrc = (src: string) => Promise<string | null>;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Largeur moyenne d'un caractère (fraction de fontSize), approximation. */
function charWidthFactor(fontFamily: string, weight: number): number {
  let f = fontFamily === 'display' ? 0.55 : 0.52;
  if (weight >= 600) f += 0.03;
  return f;
}

function wrapText(
  text: string,
  width: number,
  fontSize: number,
  factor: number,
): string[] {
  const maxChars = Math.max(4, Math.floor(width / (fontSize * factor)));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars) {
      cur = next;
    } else {
      if (cur) lines.push(cur);
      // Mot plus large que la ligne → découpe dure
      if (w.length > maxChars) {
        for (let i = 0; i < w.length; i += maxChars) lines.push(w.slice(i, i + maxChars));
        cur = '';
      } else {
        cur = w;
      }
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function parseGradient(value: string): { stops: [number, string][]; angle: number } | null {
  const m = value.match(/linear-gradient\(\s*(\d+)deg,\s*(.+)\)/);
  if (!m) return null;
  const angle = Number(m[1]);
  const stops = m[2].split(',').map((s) => {
    const parts = s.trim().split(/\s+/);
    return [parts.length > 1 ? Number(parts[1].replace('%', '')) : 0, parts[0]] as [number, string];
  });
  if (stops.length < 2) return null;
  return { stops, angle };
}

function transform(el: DesignElement): string {
  if (!el.rotation) return '';
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  return `transform="rotate(${el.rotation} ${cx} ${cy})"`;
}

export async function designToSvg(
  design: { width: number; height: number },
  content: DesignContent,
  resolveImageSrc: ResolveImageSrc,
): Promise<string> {
  const parts: string[] = [];
  const defs: string[] = [];

  // Arrière-plan
  const bg = content.background;
  if (bg.type === 'color' || bg.type === 'pattern') {
    const grad = bg.type === 'pattern' ? parseGradient(bg.value) : null;
    if (grad) {
      // angle CSS → coordonnées SVG (0deg = vers le haut)
      const rad = ((grad.angle - 90) * Math.PI) / 180;
      const dx = Math.cos(rad) * design.width;
      const dy = Math.sin(rad) * design.height;
      defs.push(
        `<linearGradient id="bgGrad" x1="0" y1="0" x2="${dx}" y2="${dy}" gradientUnits="userSpaceOnUse">` +
          grad.stops.map(([p, c]) => `<stop offset="${p}%" stop-color="${c}"/>`).join('') +
          `</linearGradient>`,
      );
      parts.push(`<rect width="100%" height="100%" fill="url(#bgGrad)"/>`);
    } else {
      parts.push(`<rect width="100%" height="100%" fill="${esc(bg.value || '#FFFFFF')}"/>`);
    }
  } else if (bg.type === 'image') {
    const dataUri = await resolveImageSrc(bg.value);
    if (dataUri) {
      parts.push(`<image href="${dataUri}" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"/>`);
    } else {
      parts.push(`<rect width="100%" height="100%" fill="#eee"/>`);
    }
  }

  // Éléments triés par z
  const sorted = [...content.elements].sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));
  for (const el of sorted) {
    const op = `opacity="${el.opacity}"`;
    const tr = transform(el);
    if (el.type === 'text') {
      const stack = FONT_STACKS[el.fontFamily] ?? FONT_STACKS.sans;
      const factor = charWidthFactor(el.fontFamily, el.fontWeight);
      const maxTextWidth = el.width - 4;
      const lines = wrapText(el.uppercase ? el.text.toUpperCase() : el.text, maxTextWidth, el.fontSize, factor);
      const lineH = el.fontSize * (el.lineHeight || 1.2);
      const totalH = lines.length * lineH;
      const boxH = el.height > 0 ? el.height : totalH;
      const centerY = el.y + boxH / 2;
      const anchor = el.align === 'left' ? 'start' : el.align === 'right' ? 'end' : 'middle';
      const tx = el.align === 'left' ? el.x : el.align === 'right' ? el.x + el.width : el.x + el.width / 2;
      const textEl = lines
        .map(
          (line, i) =>
            `<text x="${tx}" y="${centerY - totalH / 2 + lineH * (i + 0.5)}" text-anchor="${anchor}" ` +
            `dominant-baseline="middle" font-family="${esc(stack)}" font-size="${el.fontSize}" ` +
            `font-weight="${el.fontWeight}" font-style="${el.italic ? 'italic' : 'normal'}" ` +
            `fill="${el.color}" letter-spacing="${el.letterSpacing ?? 0}" ${op}>${esc(line)}</text>`,
        )
        .join('');
      parts.push(`<g ${tr}>${textEl}</g>`);
    } else if (el.type === 'shape') {
      if (el.shape === 'rect') {
        parts.push(
          `<g ${tr}><rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" rx="${el.borderRadius}" ` +
            `fill="${el.fill === 'none' ? 'none' : el.fill}" stroke="${el.stroke === 'none' ? 'none' : el.stroke}" ` +
            `stroke-width="${el.strokeWidth}" ${op}/></g>`,
        );
      } else if (el.shape === 'circle') {
        parts.push(
          `<g ${tr}><ellipse cx="${el.x + el.width / 2}" cy="${el.y + el.height / 2}" rx="${el.width / 2}" ry="${el.height / 2}" ` +
            `fill="${el.fill === 'none' ? 'none' : el.fill}" stroke="${el.stroke === 'none' ? 'none' : el.stroke}" ` +
            `stroke-width="${el.strokeWidth}" ${op}/></g>`,
        );
      } else if (el.shape === 'ring') {
        const r = el.width / 2;
        parts.push(
          `<g ${tr}><ellipse cx="${el.x + r}" cy="${el.y + el.height / 2}" rx="${r - el.strokeWidth / 2}" ry="${el.height / 2 - el.strokeWidth / 2}" ` +
            `fill="none" stroke="${el.stroke === 'none' ? '#999999' : el.stroke}" stroke-width="${el.strokeWidth}" ${op}/></g>`,
        );
      } else if (el.shape === 'line') {
        parts.push(
          `<g ${tr}><line x1="${el.x}" y1="${el.y + el.height / 2}" x2="${el.x + el.width}" y2="${el.y + el.height / 2}" ` +
            `stroke="${el.stroke === 'none' ? '#999999' : el.stroke}" stroke-width="${el.strokeWidth || 2}" ${op}/></g>`,
        );
      } else if (el.shape === 'triangle') {
        const { x, y, width: w, height: h } = el;
        parts.push(
          `<g ${tr}><path d="M ${x + w / 2} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z" ` +
            `fill="${el.fill === 'none' ? 'none' : el.fill}" stroke="${el.stroke === 'none' ? 'none' : el.stroke}" ` +
            `stroke-width="${el.strokeWidth}" ${op}/></g>`,
        );
      }
    } else if (el.type === 'icon') {
      // Glyphes Unicode dans un <text> (compatibles SVG sans polices externes)
      const glyph = ICON_GLYPHS[el.icon] ?? '•';
      const ih = el.height > 0 ? el.height : el.width;
      parts.push(
        `<g ${tr}><text x="${el.x + el.width / 2}" y="${el.y + (ih / 2)}" text-anchor="middle" ` +
          `dominant-baseline="middle" font-size="${ih * 0.7}" fill="${el.iconColor}" ${op}>${esc(glyph)}</text></g>`,
      );
    } else if (el.type === 'image') {
      const dataUri = await resolveImageSrc(el.src);
      const clipId = `clip${el.id.replace(/[^a-zA-Z0-9]/g, '')}`;
      if (el.borderRadius > 0) {
        defs.push(
          `<clipPath id="${clipId}"><rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" rx="${el.borderRadius}"/></clipPath>`,
        );
      }
      if (dataUri) {
        const par = el.fit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice';
        parts.push(
          `<g ${tr} ${el.borderRadius > 0 ? `clip-path="url(#${clipId})"` : ''}>` +
            `<image href="${dataUri}" x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" ` +
            `preserveAspectRatio="${par}" ${op}/></g>`,
        );
      }
    } else if (el.type === 'qr') {
      const qrUri = await qrDataUri(el.value, el.color, el.margin);
      const white = el.color === 'white';
      parts.push(
        `<g ${tr}>` +
          (white ? `<rect x="${el.x - 8}" y="${el.y - 8}" width="${el.width + 16}" height="${el.height + 16}" fill="#FFFFFF" rx="12"/>` : '') +
          `<image href="${qrUri}" x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" ${op}/></g>`,
      );
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${design.width}" height="${design.height}" viewBox="0 0 ${design.width} ${design.height}">` +
    `<defs>${defs.join('')}</defs>${parts.join('')}</svg>`
  );
}

const ICON_GLYPHS: Record<string, string> = {
  heart: '♥', star: '★', sparkle: '✦', flower: '✿', leaf: '❧',
  music: '♪', champagne: '🍾', cake: '🎂', ring: '💍', calendar: '📅',
  location: '📍', church: '⛪', phone: '✆', gift: '🎁', crown: '♛',
  laurel: '🌿', sun: '☀', moon: '☾', infinity: '∞', diamond: '◆',
};

async function qrDataUri(value: string, color: 'black' | 'white', margin: number): Promise<string> {
  const buf = await QRCode.toBuffer(value, {
    errorCorrectionLevel: 'M',
    margin,
    width: 512,
    color: color === 'white' ? { dark: '#FFFFFF', light: '#000000' } : { dark: '#000000', light: '#FFFFFF' },
  });
  return `data:image/png;base64,${buf.toString('base64')}`;
}
