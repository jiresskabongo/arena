/**
 * Provider IA — Phase 13 (CDC §18, ARCHITECTURE §5.9).
 *
 * MOCK DÉTERMINISTE (MVP — réserve §13 « éditeur/IA mock ») :
 * - AUCUNE intégration externe : les compositions sont des arrangements
 *   DÉTERMINISTES (hash du prompt + données de l'événement) de palettes et
 *   mises en page valides pour le studio — même entrée ⇒ même sortie.
 * - Le texte est assemblé à partir de gabarits paramétrés (événement/prompt).
 * - Mode « Démo » assumé : l'UI badge les sorties, Design.isAiGenerated = true.
 *
 * Échec simulé (déterministe, testable) : un prompt contenant `#fail` fait
 * lever `AiProviderError` — le service IA rembourse alors les crédits
 * (critère de sortie P13 : « provider failure = credit refund »).
 */
import {
  makeShapeElement,
  makeTextElement,
  type DesignBackground,
  type DesignElement,
} from '@/lib/design-elements';

export class AiProviderError extends Error {
  readonly code = 'ai_provider_error';
  constructor(message: string) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export interface AiEventRef {
  name: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  venue: string | null;
  city: string | null;
}

export interface AiDesignRequest {
  prompt: string;
  type: string;
  width: number;
  height: number;
  event?: AiEventRef | null;
}

export interface AiDesignResult {
  name: string;
  background: DesignBackground;
  elements: DesignElement[];
}

export interface AiTextRequest {
  prompt: string;
  event?: AiEventRef | null;
}

// ── Déterminisme ─────────────────────────────────────────────────────────────

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Choix stable dans un tableau (hash d'une entrée canonicalisée). */
function pick<T>(arr: readonly T[], seed: string, salt: string): T {
  return arr[fnv1a(`${seed}::${salt}`) % arr.length];
}

function shortHash(s: string): number {
  return fnv1a(s) % 1000;
}

// ── Palettes (choix déterministe) ────────────────────────────────────────────

interface Palette {
  name: string;
  background: DesignBackground;
  frame: string;
  accent: string;
  title: string;
  body: string;
  chipBg: string;
  chipText: string;
}

const PALETTES: readonly Palette[] = [
  {
    name: 'Nuit or',
    background: { type: 'gradient', value: 'linear-gradient(160deg, #0f172a, #1e293b 55%, #0f172a)' },
    frame: '#c8a24a',
    accent: '#c8a24a',
    title: '#f8fafc',
    body: '#cbd5e1',
    chipBg: '#c8a24a',
    chipText: '#0f172a',
  },
  {
    name: 'Sauge élégante',
    background: { type: 'color', value: '#f4f6f3' },
    frame: '#5f7161',
    accent: '#5f7161',
    title: '#243028',
    body: '#4c5a50',
    chipBg: '#5f7161',
    chipText: '#f4f6f3',
  },
  {
    name: 'Bordeaux profond',
    background: { type: 'gradient', value: 'linear-gradient(135deg, #3f1d28, #5c2a3a 60%, #3f1d28)' },
    frame: '#d9b48f',
    accent: '#d9b48f',
    title: '#fdf6ee',
    body: '#e8cfc0',
    chipBg: '#d9b48f',
    chipText: '#3f1d28',
  },
  {
    name: 'Ciel pastel',
    background: { type: 'color', value: '#eef4fb' },
    frame: '#4a7fb5',
    accent: '#4a7fb5',
    title: '#173049',
    body: '#3d5876',
    chipBg: '#4a7fb5',
    chipText: '#ffffff',
  },
  {
    name: 'Terracotta',
    background: { type: 'gradient', value: 'linear-gradient(150deg, #f7ede2, #f0dcc4 70%)' },
    frame: '#b4643c',
    accent: '#b4643c',
    title: '#4a2c1c',
    body: '#7a5a44',
    chipBg: '#b4643c',
    chipText: '#fdf3e9',
  },
  {
    name: 'Monochrome',
    background: { type: 'color', value: '#fafafa' },
    frame: '#171717',
    accent: '#171717',
    title: '#171717',
    body: '#525252',
    chipBg: '#171717',
    chipText: '#fafafa',
  },
] as const;

// ── Gabarits de texte (démonstration de composition) ─────────────────────────

const OPENERS: readonly string[] = [
  'L’art du rendez-vous', 'Une soirée à ne pas manquer', 'Le moment où tout commence',
  'Entre amis, autour de l’essentiel', 'L’invitation que vous attendiez', 'La magie des grandes dates',
] as const;

const CLOSERS: readonly string[] = [
  'Votre présence fera toute la différence.',
  'Répondez avant la date limite — nous vous réservons une place.',
  'À très vite, et n’oubliez pas : l’élégance, c’est d’arriver à l’heure.',
  'Confirmez votre venue, le reste nous appartient.',
] as const;

const TYPE_CHIPS: Record<string, string> = {
  invitation: 'Invitation',
  save_the_date: 'Save the date',
  vip_invitation: 'Invitation VIP',
  access_card: 'Badge d’accès',
  poster: 'Affiche',
  badge: 'Badge',
  program: 'Programme',
  thank_you_card: 'Remerciement',
  facebook_post: 'Publication',
  instagram_post: 'Publication',
  story: 'Story',
  whatsapp_visual: 'Visuel WhatsApp',
  custom: 'Création',
};

// ── Composition déterministe ─────────────────────────────────────────────────

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtDateFr(iso: string, time: string): string {
  try {
    const d = new Date(`${iso}T00:00:00Z`);
    const date = new Intl.DateTimeFormat('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    }).format(d);
    const hh = time.slice(0, 2);
    const mm = time.slice(3, 5) === '00' ? '' : `:${time.slice(3, 5)}`;
    return `${date} · ${hh}${mm}h`;
  } catch {
    return `${iso} · ${time}`;
  }
}

/**
 * Compose un design complet (fond + éléments canvas) — DÉTERMINISTE :
 * même prompt + même événement ⇒ même composition (id d'éléments exclus,
 * régénérés pour rester uniques dans la base).
 */
export function generateDesign(req: AiDesignRequest): AiDesignResult {
  if (req.prompt.includes('#fail')) {
    throw new AiProviderError('échec simulé du provider (jeton « #fail » détecté)');
  }
  const seed = `${req.prompt}|${req.event ? `${req.event.name} ${req.event.date}` : 'none'}|${req.type}`;
  const p = pick(PALETTES, seed, 'palette');
  const opener = pick(OPENERS, seed, 'opener');
  const closer = pick(CLOSERS, seed, 'closer');

  const w = req.width;
  const h = req.height;
  const ev = req.event;
  const title = ev?.name ?? (req.prompt.trim().slice(0, 60) || 'Création IA');

  const els: DesignElement[] = [];
  let z = 0;

  // Cadre décoratif
  const m = Math.round(Math.min(w, h) * 0.045);
  els.push(makeShapeElement({
    shape: 'rect', x: m, y: m, width: w - 2 * m, height: h - 2 * m,
    fill: 'none', stroke: p.frame, strokeWidth: Math.max(2, Math.round(Math.min(w, h) * 0.004)),
    z: z++, opacity: 0.85,
  }));
  // Halos décoratifs (positions dérivées du hash)
  const cx = 0.16 + (shortHash(seed + 'cx') / 1000) * 0.12;
  const cy = 0.12 + (shortHash(seed + 'cy') / 1000) * 0.1;
  const d1 = Math.round(Math.min(w, h) * (0.16 + (shortHash(seed + 'd1') / 1000) * 0.1));
  els.push(makeShapeElement({
    shape: 'circle', x: w * cx - d1 / 2, y: h * cy - d1 / 2, width: d1, height: d1,
    fill: p.accent, z: z++, opacity: 0.14,
  }));
  const d2 = Math.round(Math.min(w, h) * (0.1 + (shortHash(seed + 'd2') / 1000) * 0.08));
  els.push(makeShapeElement({
    shape: 'circle', x: w * (1 - cx) - d2 / 2, y: h * (1 - cy) - d2 / 2, width: d2, height: d2,
    fill: p.accent, z: z++, opacity: 0.1,
  }));

  // Chip de type (en haut)
  const chipW = Math.round(w * 0.34);
  els.push(makeTextElement({
    text: TYPE_CHIPS[req.type] ?? 'Création',
    x: (w - chipW) / 2, y: h * 0.115, width: chipW, height: Math.round(h * 0.045),
    fontSize: Math.round(Math.min(w, h) * 0.026), fontWeight: 600,
    color: p.chipText, align: 'center', uppercase: true, letterSpacing: 4,
    fontFamily: 'sans', z: z++,
  }));
  // Fond du chip
  els.push(makeShapeElement({
    shape: 'rect', x: (w - chipW) / 2 - 14, y: h * 0.115 - 10,
    width: chipW + 28, height: Math.round(h * 0.045) + 20,
    fill: p.chipBg, borderRadius: 40, z: z - 1, opacity: 0.95,
  }));

  // Titre
  const titleSize = Math.round(Math.min(w, h) * (title.length > 34 ? 0.055 : 0.075));
  els.push(makeTextElement({
    text: title,
    x: w * 0.09, y: h * 0.2, width: w * 0.82, height: Math.round(h * 0.16),
    fontSize: titleSize, fontWeight: 700, color: p.title, align: 'center',
    fontFamily: 'display', lineHeight: 1.12, z: z++,
  }));

  // Ligne de séparation
  els.push(makeShapeElement({
    shape: 'line', x: w * 0.4, y: h * 0.385, width: w * 0.2, height: 2,
    stroke: p.accent, strokeWidth: 2, z: z++,
  }));

  // Slogan (dérivé du prompt ou opener)
  const tagline = req.prompt.trim().length > 12
    ? req.prompt.trim().replace(/\s+/g, ' ').slice(0, 90)
    : opener;
  els.push(makeTextElement({
    text: titleCase(tagline),
    x: w * 0.12, y: h * 0.415, width: w * 0.76, height: Math.round(h * 0.06),
    fontSize: Math.round(Math.min(w, h) * 0.028), fontWeight: 400,
    color: p.body, align: 'center', italic: true, lineHeight: 1.3, z: z++,
  }));

  // Bloc informations (événement)
  const infoLines: string[] = [];
  if (ev) {
    infoLines.push(fmtDateFr(ev.date, ev.startTime));
    if (ev.venue) infoLines.push(ev.city ? `${ev.venue} · ${ev.city}` : ev.venue);
  }
  infoLines.push(closer);
  const infoTop = h * (ev ? 0.5 : 0.52);
  infoLines.forEach((line, i) => {
    els.push(makeTextElement({
      text: line,
      x: w * 0.12, y: infoTop + i * Math.round(h * 0.045), width: w * 0.76,
      height: Math.round(h * 0.038),
      fontSize: Math.round(Math.min(w, h) * (i === infoLines.length - 1 ? 0.024 : 0.03)),
      fontWeight: i === infoLines.length - 1 ? 400 : 500,
      color: i === infoLines.length - 1 ? p.body : p.title,
      align: 'center', lineHeight: 1.25, z: z++,
    }));
  });

  return {
    name: `${TYPE_CHIPS[req.type] ?? 'Création'} IA · ${title}`.slice(0, 120),
    background: p.background,
    elements: els,
  };
}

/**
 * Texte marketing composé DÉTERMINISTEMENT à partir du prompt (+ données
 * événement si fournies). Gabarits FR — la production branchera un LLM.
 */
export function generateText(req: AiTextRequest): string {
  if (req.prompt.includes('#fail')) {
    throw new AiProviderError('échec simulé du provider (jeton « #fail » détecté)');
  }
  const seed = `${req.prompt}|${req.event?.name ?? 'none'}`;
  const opener = pick(OPENERS, seed, 'opener');
  const closer = pick(CLOSERS, seed, 'closer');
  const ev = req.event;

  const parts: string[] = [];
  parts.push(opener + '.');
  if (ev) {
    const date = fmtDateFr(ev.date, ev.startTime);
    parts.push(
      `Le rendez-vous est fixé : ${ev.name} aura lieu le ${date.toLowerCase()}${ev.venue ? ` à ${ev.venue}${ev.city ? ` (${ev.city})` : ''}` : ''}.`,
    );
  } else if (req.prompt.trim()) {
    parts.push(`« ${req.prompt.trim().replace(/\s+/g, ' ').slice(0, 160)} » — voici la suite que nous imaginions pour vous.`);
  }
  parts.push(closer);
  return parts.join('\n\n');
}
