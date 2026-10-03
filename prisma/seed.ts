/**
 * EventFlow — Seeders (Phase 1)
 * Plans + prix (USD/CDF/EUR), 20 types d'événements, rôles,
 * templates de notifications, 12 templates de design plateforme (avec miniatures SVG),
 * super admin, feature flags.
 */
import { hash } from '@node-rs/argon2';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const STORAGE = path.join(process.cwd(), 'storage', 'media');

// ─────────────────────────── Modèle de design (JSON) ───────────────────────────

type Background = { type: 'color' | 'image' | 'pattern'; value: string };
type Element = {
  id: string;
  type: 'text' | 'image' | 'shape' | 'icon';
  x: number; y: number; width: number; height: number;
  rotation: number; opacity: number; z: number;
  text?: string; fontFamily?: 'display' | 'sans'; fontSize?: number; fontWeight?: number;
  color?: string; align?: 'left' | 'center' | 'right'; lineHeight?: number;
  letterSpacing?: number; uppercase?: boolean;
  src?: string; fit?: 'cover' | 'contain'; borderRadius?: number;
  shape?: 'rect' | 'circle' | 'ring' | 'line'; fill?: string; stroke?: string; strokeWidth?: number;
  icon?: string; iconColor?: string;
};
type DesignContent = { background: Background; elements: Element[] };

const el = (partial: Partial<Element> & { id: string; type: Element['type']; x: number; y: number; width: number; height: number }): Element => ({
  rotation: 0, opacity: 1, z: 1, ...partial,
});

// ─────────────────────────── Miniature SVG (aperçu) ───────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ICON_GLYPHS: Record<string, string> = {
  heart: '♥', calendar: '📅', 'map-pin': '📍', clock: '🕒', star: '★', camera: '📷', glasses: '🕶',
};

function designToSvg(d: { width: number; height: number } & DesignContent): string {
  const bg =
    d.background.type === 'color'
      ? d.background.value
      : `url(#bggrad)`;
  const defs =
    d.background.type === 'pattern'
      ? `<defs><linearGradient id="bggrad" x1="0" y1="0" x2="1" y2="1">${d.background.value
          .match(/#[0-9a-fA-F]{3,8}/g)
          ?.map((c, i, a) => `<stop offset="${i / Math.max(1, a.length - 1)}" stop-color="${c}"/>`)
          .join('')}</linearGradient></defs>`
      : '';
  const sorted = [...d.elements].sort((a, b) => a.z - b.z);
  const parts: string[] = [];
  for (const e of sorted) {
    if (e.type === 'text' && e.text) {
      const family = e.fontFamily === 'display' ? 'Playfair Display, Georgia, serif' : 'Inter, Arial, sans-serif';
      const size = e.fontSize ?? 32;
      parts.push(
        `<text x="${e.x + e.width / 2}" y="${e.y + e.height / 2}" text-anchor="middle" dominant-baseline="middle" ` +
          `font-family="${family}" font-size="${size}" font-weight="${e.fontWeight ?? 400}" ` +
          `fill="${e.color ?? '#111'}" letter-spacing="${e.letterSpacing ?? 0}" opacity="${e.opacity}">` +
          `${esc(e.uppercase ? e.text.toUpperCase() : e.text)}</text>`,
      );
    } else if (e.type === 'shape') {
      if (e.shape === 'rect') {
        parts.push(`<rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" fill="${e.fill ?? 'none'}" stroke="${e.stroke ?? 'none'}" stroke-width="${e.strokeWidth ?? 0}" opacity="${e.opacity}" rx="${e.borderRadius ?? 0}"/>`);
      } else if (e.shape === 'circle') {
        parts.push(`<circle cx="${e.x + e.width / 2}" cy="${e.y + e.height / 2}" r="${e.width / 2}" fill="${e.fill ?? 'none'}" stroke="${e.stroke ?? 'none'}" stroke-width="${e.strokeWidth ?? 0}" opacity="${e.opacity}"/>`);
      } else if (e.shape === 'ring') {
        parts.push(`<circle cx="${e.x + e.width / 2}" cy="${e.y + e.height / 2}" r="${e.width / 2 - (e.strokeWidth ?? 2) / 2}" fill="none" stroke="${e.stroke ?? '#999'}" stroke-width="${e.strokeWidth ?? 2}" opacity="${e.opacity}"/>`);
      } else if (e.shape === 'line') {
        parts.push(`<line x1="${e.x}" y1="${e.y + e.height / 2}" x2="${e.x + e.width}" y2="${e.y + e.height / 2}" stroke="${e.stroke ?? '#999'}" stroke-width="${e.strokeWidth ?? 2}" opacity="${e.opacity}"/>`);
      }
    } else if (e.type === 'icon' && e.icon) {
      parts.push(
        `<text x="${e.x + e.width / 2}" y="${e.y + e.height / 2}" text-anchor="middle" dominant-baseline="middle" font-size="${e.height * 0.6}" opacity="${e.opacity}">${ICON_GLYPHS[e.icon] ?? '•'}</text>`,
      );
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${d.width}" height="${d.height}" viewBox="0 0 ${d.width} ${d.height}">${defs}<rect width="100%" height="100%" fill="${d.background.type === 'image' ? '#eee' : bg}"/>${parts.join('')}</svg>`;
}

// ─────────────────────────── Templates de design plateforme ───────────────────────────

const T = (
  id: string, name: string, category: string, style: string, format: string,
  width: number, height: number, opts: { isPremium?: boolean; requiredPlan?: string | null; isFeatured?: boolean },
  content: DesignContent,
) => ({ id, name, category, style, format, width, height, opts, content });

const templates = [
  T('tpl-elegance-ivoire', 'Élégance Ivoire', 'mariage', 'luxe', 'portrait', 1080, 1350,
    { isPremium: true, requiredPlan: 'pro', isFeatured: true },
    {
      background: { type: 'color', value: '#FAF6EF' },
      elements: [
        el({ id: 'f1', type: 'shape', shape: 'rect', x: 60, y: 60, width: 960, height: 1230, fill: 'none', stroke: '#B08D3E', strokeWidth: 2 }),
        el({ id: 't1', type: 'text', text: 'Jean & Marie', fontFamily: 'display', fontSize: 92, fontWeight: 600, color: '#2A2620', align: 'center', x: 140, y: 420, width: 800, height: 120 }),
        el({ id: 't2', type: 'text', text: 'ont l’honneur de vous convier à leur mariage', fontFamily: 'sans', fontSize: 30, color: '#6B655C', align: 'center', x: 140, y: 580, width: 800, height: 44 }),
        el({ id: 's1', type: 'shape', shape: 'line', x: 440, y: 700, width: 200, height: 2, stroke: '#B08D3E', strokeWidth: 2 }),
        el({ id: 't3', type: 'text', text: 'Samedi 12 juin 2027', fontFamily: 'display', fontSize: 48, fontWeight: 500, color: '#2A2620', align: 'center', x: 140, y: 760, width: 800, height: 70 }),
        el({ id: 't4', type: 'text', text: 'Kinshasa — RDC', fontFamily: 'sans', fontSize: 32, color: '#6B655C', align: 'center', x: 140, y: 860, width: 800, height: 48 }),
        el({ id: 'i1', type: 'icon', icon: 'heart', x: 510, y: 1020, width: 60, height: 60, iconColor: '#B08D3E' }),
      ],
    }),
  T('tpl-jardin-romantique', 'Jardin Romantique', 'mariage', 'floral', 'portrait', 1080, 1350,
    { isFeatured: true },
    {
      background: { type: 'pattern', value: 'linear-gradient(160deg, #FBF6F0, #F1E6DC)' },
      elements: [
        el({ id: 'i1', type: 'icon', icon: 'star', x: 505, y: 300, width: 70, height: 70, iconColor: '#C4956A' }),
        el({ id: 't1', type: 'text', text: 'Awa & David', fontFamily: 'display', fontSize: 96, fontWeight: 600, color: '#7C5C50', align: 'center', x: 140, y: 460, width: 800, height: 130 }),
        el({ id: 't2', type: 'text', text: 'Se marient dans un cadre de verdure', fontFamily: 'sans', fontSize: 30, color: '#8A7B70', align: 'center', x: 140, y: 640, width: 800, height: 44 }),
        el({ id: 't3', type: 'text', text: '12 juin 2027 · Lubumbashi', fontFamily: 'display', fontSize: 44, fontWeight: 500, color: '#7C5C50', align: 'center', x: 140, y: 760, width: 800, height: 64 }),
        el({ id: 's1', type: 'shape', shape: 'line', x: 440, y: 880, width: 200, height: 2, stroke: '#C4956A', strokeWidth: 2 }),
      ],
    }),
  T('tpl-minuit-dore', 'Minuit Doré', 'mariage', 'romantique', 'portrait', 1080, 1350,
    { isPremium: true, requiredPlan: 'pro' },
    {
      background: { type: 'color', value: '#14121A' },
      elements: [
        el({ id: 'f1', type: 'shape', shape: 'rect', x: 50, y: 50, width: 980, height: 1250, fill: 'none', stroke: '#D4AF5E', strokeWidth: 1 }),
        el({ id: 't1', type: 'text', text: 'Chantal & Patrick', fontFamily: 'display', fontSize: 84, fontWeight: 600, color: '#D4AF5E', align: 'center', x: 140, y: 440, width: 800, height: 115 }),
        el({ id: 't2', type: 'text', text: 'vous invitent à célébrer leur union', fontFamily: 'sans', fontSize: 28, color: '#B8AFA2', align: 'center', x: 140, y: 610, width: 800, height: 42 }),
        el({ id: 's1', type: 'shape', shape: 'line', x: 460, y: 720, width: 160, height: 2, stroke: '#D4AF5E', strokeWidth: 2 }),
        el({ id: 't3', type: 'text', text: 'Samedi 25 décembre 2026', fontFamily: 'display', fontSize: 42, fontWeight: 500, color: '#F2EFE9', align: 'center', x: 140, y: 780, width: 800, height: 62 }),
        el({ id: 't4', type: 'text', text: 'Brussels · Belgique', fontFamily: 'sans', fontSize: 30, color: '#B8AFA2', align: 'center', x: 140, y: 880, width: 800, height: 44 }),
      ],
    }),
  T('tpl-anniversaire-scintillant', 'Anniversaire Scintillant', 'anniversaire', 'moderne', 'portrait', 1080, 1350,
    {},
    {
      background: { type: 'pattern', value: 'linear-gradient(165deg, #4F46E5, #7C3AED)' },
      elements: [
        el({ id: 'i1', type: 'icon', icon: 'star', x: 500, y: 280, width: 80, height: 80, iconColor: '#FBBF24' }),
        el({ id: 't1', type: 'text', text: '30 ans de joie', fontFamily: 'display', fontSize: 88, fontWeight: 700, color: '#FFFFFF', align: 'center', x: 140, y: 470, width: 800, height: 120 }),
        el({ id: 't2', type: 'text', text: 'Naomi Mbala fête son anniversaire', fontFamily: 'sans', fontSize: 32, color: '#E0E7FF', align: 'center', x: 140, y: 650, width: 800, height: 46 }),
        el({ id: 't3', type: 'text', text: 'Vendredi 17 avril 2027 · 19h', fontFamily: 'sans', fontSize: 34, fontWeight: 600, color: '#FBBF24', align: 'center', x: 140, y: 790, width: 800, height: 48 }),
        el({ id: 't4', type: 'text', text: 'Le Royal Lounge, Kinshasa', fontFamily: 'sans', fontSize: 30, color: '#E0E7FF', align: 'center', x: 140, y: 870, width: 800, height: 44 }),
      ],
    }),
  T('tpl-soutenance-academique', 'Soutenance Académique', 'soutenance', 'professionnel', 'portrait', 1080, 1350,
    {},
    {
      background: { type: 'color', value: '#F5F7FA' },
      elements: [
        el({ id: 's0', type: 'shape', shape: 'rect', x: 0, y: 0, width: 1080, height: 14, fill: '#1E3A5F' }),
        el({ id: 't1', type: 'text', text: 'Soutenance de thèse', fontFamily: 'sans', fontSize: 34, fontWeight: 600, color: '#1E3A5F', align: 'center', x: 140, y: 300, width: 800, height: 48, uppercase: true, letterSpacing: 4 }),
        el({ id: 't2', type: 'text', text: 'Grâce Mukendi', fontFamily: 'display', fontSize: 76, fontWeight: 600, color: '#111827', align: 'center', x: 140, y: 430, width: 800, height: 104 }),
        el({ id: 't3', type: 'text', text: 'Doctorat en Sciences de Gestion — Université de Kinshasa', fontFamily: 'sans', fontSize: 28, color: '#4B5563', align: 'center', x: 120, y: 600, width: 840, height: 42 }),
        el({ id: 's1', type: 'shape', shape: 'line', x: 460, y: 720, width: 160, height: 2, stroke: '#1E3A5F', strokeWidth: 2 }),
        el({ id: 't4', type: 'text', text: 'Jeudi 21 janvier 2027 · 10h', fontFamily: 'sans', fontSize: 34, fontWeight: 600, color: '#1E3A5F', align: 'center', x: 140, y: 790, width: 800, height: 48 }),
        el({ id: 't5', type: 'text', text: 'Amphi A, Faculté d’Économie', fontFamily: 'sans', fontSize: 30, color: '#4B5563', align: 'center', x: 140, y: 880, width: 800, height: 44 }),
      ],
    }),
  T('tpl-conference-impact', 'Conférence Impact', 'conference', 'moderne', 'landscape', 1350, 1080,
    { isPremium: true, requiredPlan: 'pro' },
    {
      background: { type: 'color', value: '#0F172A' },
      elements: [
        el({ id: 's1', type: 'shape', shape: 'rect', x: 90, y: 120, width: 8, height: 120, fill: '#F59E0B' }),
        el({ id: 't1', type: 'text', text: 'CONFÉRENCE 2026', fontFamily: 'sans', fontSize: 40, fontWeight: 700, color: '#F59E0B', align: 'left', x: 140, y: 140, width: 900, height: 56, letterSpacing: 8 }),
        el({ id: 't2', type: 'text', text: 'L’avenir de l’IA en Afrique', fontFamily: 'display', fontSize: 84, fontWeight: 600, color: '#F8FAFC', align: 'left', x: 140, y: 320, width: 1050, height: 116 }),
        el({ id: 't3', type: 'text', text: '28–30 octobre 2026 · Centre International de Conférences', fontFamily: 'sans', fontSize: 32, color: '#94A3B8', align: 'left', x: 140, y: 540, width: 1050, height: 46 }),
        el({ id: 't4', type: 'text', text: 'Kinshasa — RDC', fontFamily: 'sans', fontSize: 32, fontWeight: 600, color: '#E2E8F0', align: 'left', x: 140, y: 620, width: 1050, height: 46 }),
      ],
    }),
  T('tpl-gala-lumiere', 'Gala Lumière', 'gala', 'luxe', 'portrait', 1080, 1350,
    { isPremium: true, requiredPlan: 'pro', isFeatured: true },
    {
      background: { type: 'pattern', value: 'linear-gradient(180deg, #101010, #1C1917)' },
      elements: [
        el({ id: 'f1', type: 'shape', shape: 'rect', x: 56, y: 56, width: 968, height: 1238, fill: 'none', stroke: '#D4AF5E', strokeWidth: 2 }),
        el({ id: 't1', type: 'text', text: 'GRAND GALA 2026', fontFamily: 'sans', fontSize: 42, fontWeight: 700, color: '#D4AF5E', align: 'center', x: 140, y: 330, width: 800, height: 58, letterSpacing: 10 }),
        el({ id: 't2', type: 'text', text: 'Sous le thème de la Lumière', fontFamily: 'display', fontSize: 64, fontWeight: 600, color: '#F5F0E6', align: 'center', x: 140, y: 480, width: 800, height: 90 }),
        el({ id: 's1', type: 'shape', shape: 'line', x: 440, y: 660, width: 200, height: 2, stroke: '#D4AF5E', strokeWidth: 2 }),
        el({ id: 't3', type: 'text', text: 'Samedi 12 décembre 2026 · 20h', fontFamily: 'sans', fontSize: 34, color: '#D6CFC2', align: 'center', x: 140, y: 730, width: 800, height: 48 }),
        el({ id: 't4', type: 'text', text: 'Le Grand Hôtel, Kinshasa', fontFamily: 'sans', fontSize: 32, color: '#D6CFC2', align: 'center', x: 140, y: 810, width: 800, height: 46 }),
        el({ id: 'i1', type: 'icon', icon: 'star', x: 505, y: 950, width: 70, height: 70, iconColor: '#D4AF5E' }),
      ],
    }),
  T('tpl-sttd-minimal', 'Save the Date — Minimal', 'save_the_date', 'minimaliste', 'portrait', 1080, 1350,
    { isFeatured: true },
    {
      background: { type: 'color', value: '#FFFFFF' },
      elements: [
        el({ id: 't0', type: 'text', text: 'SAVE THE DATE', fontFamily: 'sans', fontSize: 30, fontWeight: 600, color: '#111111', align: 'center', x: 140, y: 420, width: 800, height: 42, letterSpacing: 10 }),
        el({ id: 't1', type: 'text', text: 'Awa & David', fontFamily: 'display', fontSize: 88, fontWeight: 500, color: '#111111', align: 'center', x: 140, y: 560, width: 800, height: 120 }),
        el({ id: 's1', type: 'shape', shape: 'line', x: 470, y: 760, width: 140, height: 2, stroke: '#111111', strokeWidth: 2 }),
        el({ id: 't2', type: 'text', text: '12.06.2027', fontFamily: 'display', fontSize: 56, fontWeight: 400, color: '#444444', align: 'center', x: 140, y: 830, width: 800, height: 80 }),
        el({ id: 't3', type: 'text', text: 'Kinshasa', fontFamily: 'sans', fontSize: 30, color: '#777777', align: 'center', x: 140, y: 960, width: 800, height: 44 }),
      ],
    }),
  T('tpl-babyshower-douceur', 'Douceur — Baby Shower', 'bapteme', 'floral', 'portrait', 1080, 1350,
    {},
    {
      background: { type: 'pattern', value: 'linear-gradient(170deg, #FDF3F5, #FAE8ED)' },
      elements: [
        el({ id: 'i1', type: 'icon', icon: 'heart', x: 505, y: 300, width: 70, height: 70, iconColor: '#E5A3B5' }),
        el({ id: 't1', type: 'text', text: 'Baby Shower', fontFamily: 'display', fontSize: 84, fontWeight: 600, color: '#B76E79', align: 'center', x: 140, y: 460, width: 800, height: 115 }),
        el({ id: 't2', type: 'text', text: 'pour l’arrivée de bébé de Léa & Thomas', fontFamily: 'sans', fontSize: 30, color: '#A9838B', align: 'center', x: 140, y: 630, width: 800, height: 44 }),
        el({ id: 's1', type: 'shape', shape: 'line', x: 450, y: 740, width: 180, height: 2, stroke: '#E5A3B5', strokeWidth: 2 }),
        el({ id: 't3', type: 'text', text: 'Dimanche 9 mai 2027 · 15h', fontFamily: 'sans', fontSize: 34, fontWeight: 600, color: '#B76E79', align: 'center', x: 140, y: 800, width: 800, height: 48 }),
      ],
    }),
  T('tpl-corporate-prestige', 'Corporate Prestige', 'entreprise', 'professionnel', 'landscape', 1350, 1080,
    {},
    {
      background: { type: 'color', value: '#1E293B' },
      elements: [
        el({ id: 's1', type: 'shape', shape: 'rect', x: 110, y: 240, width: 120, height: 10, fill: '#C9A227' }),
        el({ id: 't1', type: 'text', text: 'SOIRÉE DE L’ENTREPRISE', fontFamily: 'sans', fontSize: 38, fontWeight: 700, color: '#E2E8F0', align: 'left', x: 110, y: 320, width: 1050, height: 52, letterSpacing: 6 }),
        el({ id: 't2', type: 'text', text: 'Acme SARL — 10 ans d’excellence', fontFamily: 'display', fontSize: 72, fontWeight: 600, color: '#FFFFFF', align: 'left', x: 110, y: 430, width: 1080, height: 100 }),
        el({ id: 't3', type: 'text', text: 'Jeudi 11 mars 2027 · 19h — Hôtel du Lac', fontFamily: 'sans', fontSize: 32, color: '#94A3B8', align: 'left', x: 110, y: 620, width: 1050, height: 46 }),
        el({ id: 't4', type: 'text', text: 'Dress code : costume', fontFamily: 'sans', fontSize: 28, color: '#64748B', align: 'left', x: 110, y: 700, width: 1050, height: 40 }),
      ],
    }),
  T('tpl-africain-contemporain', 'Contemporain Africain', 'mariage', 'africain contemporain', 'portrait', 1080, 1350,
    { isPremium: true, requiredPlan: 'pro' },
    {
      background: { type: 'color', value: '#1C1917' },
      elements: [
        el({ id: 'r1', type: 'shape', shape: 'ring', x: 340, y: 260, width: 400, height: 400, stroke: '#D4AF5E', strokeWidth: 3 }),
        el({ id: 't1', type: 'text', text: 'Amara & Josué', fontFamily: 'display', fontSize: 80, fontWeight: 600, color: '#F5F0E6', align: 'center', x: 140, y: 520, width: 800, height: 110 }),
        el({ id: 't2', type: 'text', text: 'vous convie à la célébration de leur mariage', fontFamily: 'sans', fontSize: 28, color: '#C9BFA8', align: 'center', x: 140, y: 690, width: 800, height: 42 }),
        el({ id: 's1', type: 'shape', shape: 'line', x: 440, y: 800, width: 200, height: 2, stroke: '#D4AF5E', strokeWidth: 2 }),
        el({ id: 't3', type: 'text', text: '14 août 2027 · Goma', fontFamily: 'sans', fontSize: 36, fontWeight: 600, color: '#F5F0E6', align: 'center', x: 140, y: 870, width: 800, height: 50 }),
      ],
    }),
  T('tpl-vip-elite', 'VIP Élite', 'vip', 'luxe', 'portrait', 1080, 1350,
    { isPremium: true, requiredPlan: 'business' },
    {
      background: { type: 'color', value: '#0B0B0D' },
      elements: [
        el({ id: 'f1', type: 'shape', shape: 'rect', x: 44, y: 44, width: 992, height: 1262, fill: 'none', stroke: '#C9A227', strokeWidth: 3 }),
        el({ id: 'f2', type: 'shape', shape: 'rect', x: 64, y: 64, width: 952, height: 1222, fill: 'none', stroke: '#C9A227', strokeWidth: 1 }),
        el({ id: 't1', type: 'text', text: 'INVITATION PRIVÉE', fontFamily: 'sans', fontSize: 36, fontWeight: 700, color: '#C9A227', align: 'center', x: 140, y: 380, width: 800, height: 50, letterSpacing: 12 }),
        el({ id: 't2', type: 'text', text: 'Cercle VIP', fontFamily: 'display', fontSize: 110, fontWeight: 600, color: '#F5F0E6', align: 'center', x: 140, y: 540, width: 800, height: 150 }),
        el({ id: 's1', type: 'shape', shape: 'line', x: 460, y: 780, width: 160, height: 2, stroke: '#C9A227', strokeWidth: 2 }),
        el({ id: 't3', type: 'text', text: 'Accès réservé · 1er étage', fontFamily: 'sans', fontSize: 30, color: '#B9AE95', align: 'center', x: 140, y: 850, width: 800, height: 44 }),
      ],
    }),
];

// ─────────────────────────── Seeds ───────────────────────────

const eventTypes = [
  ['wedding', 'Mariage', 'Marriage', 'personnel'],
  ['engagement', 'Fiançailles', 'Engagement', 'personnel'],
  ['birthday', 'Anniversaire', 'Birthday', 'personnel'],
  ['baptism', 'Baptême', 'Baptism', 'personnel'],
  ['baby_shower', 'Baby shower', 'Baby shower', 'personnel'],
  ['communion', 'Communion', 'Communion', 'personnel'],
  ['graduation', 'Graduation', 'Graduation', 'personnel'],
  ['soutenance', 'Soutenance', 'Thesis defense', 'personnel'],
  ['conference', 'Conférence', 'Conference', 'corporate'],
  ['seminar', 'Séminaire', 'Seminar', 'corporate'],
  ['training', 'Formation', 'Training', 'corporate'],
  ['gala', 'Gala', 'Gala', 'corporate'],
  ['concert', 'Concert', 'Concert', 'corporate'],
  ['private_party', 'Soirée privée', 'Private party', 'personnel'],
  ['official_ceremony', 'Cérémonie officielle', 'Official ceremony', 'corporate'],
  ['corporate_event', 'Événement d’entreprise', 'Corporate event', 'corporate'],
  ['product_launch', 'Lancement de produit', 'Product launch', 'corporate'],
  ['meeting', 'Réunion', 'Meeting', 'corporate'],
  ['vip_event', 'Événement VIP', 'VIP event', 'corporate'],
  ['other', 'Autre', 'Other', 'personnel'],
] as const;

const plans = [
  {
    code: 'starter', name: 'Starter',
    description: 'Pour organiser votre premier événement avec l’essentiel : 1 événement actif, 100 invités, QR et RSVP.',
    trialDays: 7,
    limits: { events: 1, guestsPerEvent: 100, storageMb: 200, smsPerMonth: 20, emailsPerMonth: 500, aiCreditsPerMonth: 50, collaborators: 2 },
    features: { premiumTemplates: false, communications: false, advancedStats: false, team: false, whiteLabel: false },
    prices: [
      { currency: 'USD', amountMinor: 999, interval: 'monthly' },
      { currency: 'EUR', amountMinor: 899, interval: 'monthly' },
      { currency: 'CDF', amountMinor: 15000, interval: 'monthly' },
      { currency: 'USD', amountMinor: 9990, interval: 'yearly' },
      { currency: 'EUR', amountMinor: 8990, interval: 'yearly' },
      { currency: 'CDF', amountMinor: 150000, interval: 'yearly' },
    ],
  },
  {
    code: 'pro', name: 'Pro',
    description: 'Pour les organisateurs réguliers : 10 événements, 1 000 invités, templates premium, IA avancée et communications.',
    trialDays: 7,
    limits: { events: 10, guestsPerEvent: 1000, storageMb: 2000, smsPerMonth: 200, emailsPerMonth: 5000, aiCreditsPerMonth: 200, collaborators: 10 },
    features: { premiumTemplates: true, communications: true, advancedStats: true, team: true, whiteLabel: false },
    prices: [
      { currency: 'USD', amountMinor: 2999, interval: 'monthly' },
      { currency: 'EUR', amountMinor: 2799, interval: 'monthly' },
      { currency: 'CDF', amountMinor: 45000, interval: 'monthly' },
      { currency: 'USD', amountMinor: 29990, interval: 'yearly' },
      { currency: 'EUR', amountMinor: 27990, interval: 'yearly' },
      { currency: 'CDF', amountMinor: 450000, interval: 'yearly' },
    ],
  },
  {
    code: 'business', name: 'Business',
    description: 'Pour les agences et gros volumes : quotas étendus, équipe avancée, marque blanche et support prioritaire.',
    trialDays: 7,
    limits: { events: 50, guestsPerEvent: 5000, storageMb: 10000, smsPerMonth: 1000, emailsPerMonth: 25000, aiCreditsPerMonth: 1000, collaborators: 50 },
    features: { premiumTemplates: true, communications: true, advancedStats: true, team: true, whiteLabel: true },
    prices: [
      { currency: 'USD', amountMinor: 9900, interval: 'monthly' },
      { currency: 'EUR', amountMinor: 8900, interval: 'monthly' },
      { currency: 'CDF', amountMinor: 150000, interval: 'monthly' },
      { currency: 'USD', amountMinor: 99000, interval: 'yearly' },
      { currency: 'EUR', amountMinor: 89000, interval: 'yearly' },
      { currency: 'CDF', amountMinor: 1500000, interval: 'yearly' },
    ],
  },
];

const roles = [
  { code: 'owner', labelFr: 'Propriétaire', labelEn: 'Owner', permissionsJson: JSON.stringify(['*']) },
  {
    code: 'manager', labelFr: 'Manager', labelEn: 'Manager',
    permissionsJson: JSON.stringify([
      'events:read', 'events:write', 'guests:read', 'guests:write', 'invitations:read', 'invitations:write',
      'rsvp:read', 'guestbook:moderate', 'tables:write', 'communications:write', 'stats:read', 'team:read', 'scanner:read',
    ]),
  },
  {
    code: 'designer', labelFr: 'Designer', labelEn: 'Designer',
    permissionsJson: JSON.stringify(['events:read', 'designs:read', 'designs:write', 'media:write', 'templates:read']),
  },
  {
    code: 'scanner', labelFr: 'Agent de contrôle', labelEn: 'Scanner',
    permissionsJson: JSON.stringify(['scanner:use', 'guests:read:limited']),
  },
  {
    code: 'viewer', labelFr: 'Lecteur', labelEn: 'Viewer',
    permissionsJson: JSON.stringify(['events:read', 'guests:read', 'rsvp:read', 'stats:read']),
  },
];

const V = '{guest_name} {event_name} {event_date} {event_location} {invitation_url} {rsvp_url}';
const notificationTemplates = [
  {
    key: 'welcome', channel: 'email',
    subjectFr: 'Bienvenue sur EventFlow', subjectEn: 'Welcome to EventFlow',
    bodyFr: `Bonjour {guest_name},\n\nVotre espace EventFlow est prêt. Créez votre premier événement en quelques minutes.\n\n{invitation_url}\n\nL’équipe EventFlow`,
    bodyEn: `Hi {guest_name},\n\nYour EventFlow workspace is ready. Create your first event in a few minutes.\n\n{invitation_url}\n\nThe EventFlow team`,
  },
  {
    key: 'invitation', channel: 'email',
    subjectFr: 'Vous êtes invité·e : {event_name}', subjectEn: 'You are invited: {event_name}',
    bodyFr: `Bonjour {guest_name},\n\nVous êtes cordialement invité·e à {event_name}, le {event_date} à {event_location}.\n\nConsultez votre invitation et confirmez votre présence : {rsvp_url}\n\nÀ très bientôt !`,
    bodyEn: `Hi {guest_name},\n\nYou are cordially invited to {event_name} on {event_date} at {event_location}.\n\nView your invitation and confirm your attendance: {rsvp_url}\n\nSee you soon!`,
  },
  {
    key: 'invitation', channel: 'sms',
    subjectFr: '', subjectEn: '',
    bodyFr: `EventFlow : vous êtes invité·e à {event_name} le {event_date} à {event_location}. Confirmez : {rsvp_url}`,
    bodyEn: `EventFlow: you are invited to {event_name} on {event_date} at {event_location}. Confirm: {rsvp_url}`,
  },
  {
    key: 'confirmation', channel: 'email',
    subjectFr: 'Merci pour votre confirmation — {event_name}', subjectEn: 'Thank you for confirming — {event_name}',
    bodyFr: `Bonjour {guest_name},\n\nNous avons bien reçu votre confirmation pour {event_name}. Votre QR code d’accès est disponible sur votre invitation : {invitation_url}\n\nÀ bientôt le {event_date} !`,
    bodyEn: `Hi {guest_name},\n\nWe have received your confirmation for {event_name}. Your access QR code is available on your invitation: {invitation_url}\n\nSee you on {event_date}!`,
  },
  {
    key: 'reminder', channel: 'email',
    subjectFr: 'Rappel : {event_name} approche', subjectEn: 'Reminder: {event_name} is coming up',
    bodyFr: `Bonjour {guest_name},\n\nUn petit rappel : {event_name} aura lieu le {event_date} à {event_location}.\n\nVotre QR d’accès : {invitation_url}\n\nÀ très vite !`,
    bodyEn: `Hi {guest_name},\n\nA quick reminder: {event_name} will take place on {event_date} at {event_location}.\n\nYour access QR: {invitation_url}\n\nSee you soon!`,
  },
  {
    key: 'reminder', channel: 'sms',
    subjectFr: '', subjectEn: '',
    bodyFr: `Rappel : {event_name} le {event_date} à {event_location}. Votre QR : {invitation_url}`,
    bodyEn: `Reminder: {event_name} on {event_date} at {event_location}. Your QR: {invitation_url}`,
  },
  {
    key: 'change', channel: 'email',
    subjectFr: 'Information importante : {event_name}', subjectEn: 'Important update: {event_name}',
    bodyFr: `Bonjour {guest_name},\n\nLe détail de {event_name} a été mis à jour (nouveau : {event_date}, {event_location}).\n\nConsultez votre invitation : {invitation_url}`,
    bodyEn: `Hi {guest_name},\n\nThe details of {event_name} have been updated (now: {event_date}, {event_location}).\n\nCheck your invitation: {invitation_url}`,
  },
  {
    key: 'payment', channel: 'email',
    subjectFr: 'Paiement reçu — EventFlow', subjectEn: 'Payment received — EventFlow',
    bodyFr: `Bonjour,\n\nVotre paiement a bien été reçu et votre abonnement est actif.\n\nL’équipe EventFlow`,
    bodyEn: `Hi,\n\nYour payment has been received and your subscription is active.\n\nThe EventFlow team`,
  },
  {
    key: 'expiration', channel: 'email',
    subjectFr: 'Votre essai EventFlow arrive à son terme', subjectEn: 'Your EventFlow trial is ending',
    bodyFr: `Bonjour,\n\nVotre période d’essai arrive à échéance. Choisissez un plan pour conserver toutes vos fonctionnalités — vos données restent en sécurité.\n\nGérer mon abonnement : {invitation_url}`,
    bodyEn: `Hi,\n\nYour trial period is ending. Choose a plan to keep all features — your data stays safe.\n\nManage my subscription: {invitation_url}`,
  },
  {
    key: 'quota', channel: 'email',
    subjectFr: 'Votre quota EventFlow est presque atteint', subjectEn: 'Your EventFlow quota is almost reached',
    bodyFr: `Bonjour,\n\nVous avez atteint 80 % de votre quota (invités, stockage ou crédits). Pensez à passer à l’étape supérieure.\n\nGérer mon abonnement : {invitation_url}`,
    bodyEn: `Hi,\n\nYou have reached 80% of your quota (guests, storage or credits). Consider upgrading.\n\nManage my subscription: {invitation_url}`,
  },
  {
    key: 'verify_email', channel: 'email',
    subjectFr: 'Vérifiez votre adresse e-mail — EventFlow', subjectEn: 'Verify your email — EventFlow',
    bodyFr: `Bonjour {guest_name},\n\nMerci de vérifier votre adresse e-mail pour finaliser votre inscription EventFlow :\n\n{invitation_url}`,
    bodyEn: `Hi {guest_name},\n\nPlease verify your email address to finish your EventFlow signup:\n\n{invitation_url}`,
  },
  {
    key: 'reset_password', channel: 'email',
    subjectFr: 'Réinitialisation de votre mot de passe — EventFlow', subjectEn: 'Reset your password — EventFlow',
    bodyFr: `Bonjour {guest_name},\n\nNous avons reçu une demande de réinitialisation de votre mot de passe. Cliquez sur le lien ci-dessous (valable 1 heure) :\n\n{invitation_url}\n\nSi vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail.`,
    bodyEn: `Hi {guest_name},\n\nWe received a password reset request. Click the link below (valid for 1 hour):\n\n{invitation_url}\n\nIf you did not request this, please ignore this email.`,
  },
];

const featureFlags = [
  { key: 'ai_enabled', valueJson: JSON.stringify({ enabled: true }), scope: 'platform', active: true },
  { key: 'offline_scanner', valueJson: JSON.stringify({ enabled: true }), scope: 'platform', active: true },
  { key: 'whatsapp', valueJson: JSON.stringify({ enabled: false }), scope: 'platform', active: true },
  { key: 'push', valueJson: JSON.stringify({ enabled: false }), scope: 'platform', active: true },
];

async function main() {
  console.log('🌱 Seed EventFlow…');

  // Types d'événements
  for (const [code, labelFr, labelEn, category] of eventTypes) {
    await prisma.eventType.upsert({
      where: { code },
      update: { labelFr, labelEn, category },
      create: { code, labelFr, labelEn, category },
    });
  }
  console.log(`  ✔ ${eventTypes.length} types d'événements`);

  // Rôles
  for (const r of roles) {
    await prisma.role.upsert({ where: { code: r.code }, update: r, create: r });
  }
  console.log(`  ✔ ${roles.length} rôles`);

  // Plans + prix
  for (const p of plans) {
    const plan = await prisma.plan.upsert({
      where: { code: p.code },
      update: {
        name: p.name, description: p.description, trialDays: p.trialDays,
        limitsJson: p.limits as object, featuresJson: p.features as object,
      },
      create: {
        code: p.code, name: p.name, description: p.description, trialDays: p.trialDays,
        limitsJson: p.limits as object, featuresJson: p.features as object,
      },
    });
    for (const price of p.prices) {
      await prisma.planPrice.upsert({
        where: { planId_currency_interval: { planId: plan.id, currency: price.currency, interval: price.interval } },
        update: { amountMinor: price.amountMinor, isActive: true },
        create: { planId: plan.id, currency: price.currency, amountMinor: price.amountMinor, interval: price.interval, isActive: true },
      });
    }
  }
  console.log(`  ✔ ${plans.length} plans (prix USD/EUR/CDF, mensuel+annuel)`);

  // Templates de notifications
  for (const t of notificationTemplates) {
    const isSms = t.channel === 'sms';
    const data = {
      subjectFr: isSms ? '' : t.subjectFr,
      subjectEn: isSms ? '' : t.subjectEn,
      bodyFr: t.bodyFr,
      bodyEn: t.bodyEn,
      active: true,
    };
    const existing = await prisma.notificationTemplate.findFirst({
      where: { organizationId: null, key: t.key, channel: t.channel },
    });
    if (existing) {
      await prisma.notificationTemplate.update({ where: { id: existing.id }, data });
    } else {
      await prisma.notificationTemplate.create({
        data: { organizationId: null, key: t.key, channel: t.channel, ...data },
      });
    }
  }
  console.log(`  ✔ ${notificationTemplates.length} templates de notifications`);

  // Feature flags
  for (const f of featureFlags) {
    await prisma.featureFlag.upsert({ where: { key: f.key }, update: f, create: f });
  }
  console.log(`  ✔ ${featureFlags.length} feature flags`);

  // Templates de design + miniatures SVG
  mkdirSync(path.join(STORAGE, 'templates'), { recursive: true });
  for (const tpl of templates) {
    const slug = tpl.id.replace('tpl-', '');
    const svg = designToSvg({ width: tpl.width, height: tpl.height, ...tpl.content });
    const storageKey = `templates/thumb-${slug}.svg`;
    writeFileSync(path.join(STORAGE, storageKey), svg, 'utf8');

    const media = await prisma.mediaFile.upsert({
      where: { storageKey },
      update: {
        sizeBytes: Buffer.byteLength(svg),
        width: tpl.width,
        height: tpl.height,
      },
      create: {
        organizationId: null,
        kind: 'template_thumb',
        storageKey,
        originalName: `${slug}.svg`,
        mimeType: 'image/svg+xml',
        sizeBytes: Buffer.byteLength(svg),
        width: tpl.width,
        height: tpl.height,
      },
    });

    await prisma.designTemplate.upsert({
      where: { id: tpl.id },
      update: {
        name: tpl.name, category: tpl.category, style: tpl.style, format: tpl.format,
        width: tpl.width, height: tpl.height, thumbnailMediaId: media.id,
        contentJson: tpl.content as object,
        isPremium: tpl.opts.isPremium ?? false,
        requiredPlan: tpl.opts.requiredPlan ?? null,
        isFeatured: tpl.opts.isFeatured ?? false,
        status: 'published', publishedAt: new Date(),
      },
      create: {
        id: tpl.id,
        organizationId: null,
        name: tpl.name, category: tpl.category, style: tpl.style, format: tpl.format,
        width: tpl.width, height: tpl.height, thumbnailMediaId: media.id,
        contentJson: tpl.content as object,
        isPremium: tpl.opts.isPremium ?? false,
        requiredPlan: tpl.opts.requiredPlan ?? null,
        isFeatured: tpl.opts.isFeatured ?? false,
        status: 'published', publishedAt: new Date(),
      },
    });
  }
  console.log(`  ✔ ${templates.length} templates de design (miniatures SVG)`);

  // Super admin
  const adminEmail = process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@eventflow.app';
  const adminPassword = process.env.SEED_SUPERADMIN_PASSWORD ?? 'EventFlow#2026!';
  const passwordHash = await hash(adminPassword);
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { isSuperAdmin: true, passwordHash, firstName: 'Super', lastName: 'Admin' },
    create: {
      email: adminEmail, passwordHash, firstName: 'Super', lastName: 'Admin',
      isSuperAdmin: true, locale: 'fr',
    },
  });
  console.log(`  ✔ Super admin : ${adminEmail} / ${adminPassword} (dev uniquement)`);

  console.log('✅ Seed terminé.');
}

main()
  .catch((e) => {
    console.error('❌ Seed en échec :', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
