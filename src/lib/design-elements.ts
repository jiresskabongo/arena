import { z } from 'zod';

/**
 * Modèle d'éléments du canvas (identique au seed des templates plateforme).
 * Étendu Phase 7 : rotation, z, éléments image et QR.
 */

export const FONT_FAMILIES = ['display', 'sans'] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

/** Famille CSS → pile de polices (fallbacks web sans téléchargement). */
export const FONT_STACKS: Record<FontFamily, string> = {
  display: 'Playfair Display, Georgia, "Times New Roman", serif',
  sans: 'Inter, Arial, Helvetica, sans-serif',
};

export const DESIGN_SIZES = {
  portrait: { width: 1080, height: 1350 },
  square: { width: 1080, height: 1080 },
  landscape: { width: 1350, height: 1080 },
  story: { width: 1080, height: 1920 },
  print: { width: 1587, height: 2245 }, // A4 150 dpi
} as const;

const baseElement = z.object({
  id: z.string().min(1).max(40),
  x: z.number().min(-5000).max(5000),
  y: z.number().min(-5000).max(5000),
  width: z.number().min(1).max(5000),
  height: z.number().min(1).max(5000),
  rotation: z.number().min(-180).max(180).default(0),
  z: z.number().int().min(0).max(1000).default(0),
  opacity: z.number().min(0).max(1).default(1),
});

export const textElementSchema = baseElement.extend({
  type: z.literal('text'),
  text: z.string().max(2000),
  fontFamily: z.enum(FONT_FAMILIES).default('sans'),
  fontSize: z.number().min(8).max(400).default(32),
  fontWeight: z.number().int().min(100).max(900).default(400),
  color: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).default('#111111'),
  align: z.enum(['left', 'center', 'right']).default('center'),
  letterSpacing: z.number().min(-10).max(40).default(0),
  lineHeight: z.number().min(0.8).max(3).default(1.25),
  uppercase: z.boolean().default(false),
  italic: z.boolean().default(false),
});

export const shapeElementSchema = baseElement.extend({
  type: z.literal('shape'),
  shape: z.enum(['rect', 'circle', 'ring', 'line', 'triangle']),
  fill: z.string().default('none'),
  stroke: z.string().default('none'),
  strokeWidth: z.number().min(0).max(200).default(0),
  borderRadius: z.number().min(0).max(500).default(0),
});

export const iconElementSchema = baseElement.extend({
  type: z.literal('icon'),
  icon: z.string().min(1).max(40).default('heart'),
  iconColor: z.string().default('#999999'),
});

export const imageElementSchema = baseElement.extend({
  type: z.literal('image'),
  /** mediaId (base) ou dataURL (collage ponctuel) */
  src: z.string().min(1),
  fit: z.enum(['cover', 'contain', 'fill']).default('cover'),
  borderRadius: z.number().min(0).max(500).default(0),
});

export const qrElementSchema = baseElement.extend({
  type: z.literal('qr'),
  /** Contenu codé (URL d'invitation, RSVP, lien public…) */
  value: z.string().min(1).max(2000),
  /** 'black' | 'white' (blanc sur fond foncé) */
  color: z.enum(['black', 'white']).default('black'),
  /** marge en modules */
  margin: z.number().int().min(0).max(8).default(2),
});

export const designElementSchema = z.discriminatedUnion('type', [
  textElementSchema,
  shapeElementSchema,
  iconElementSchema,
  imageElementSchema,
  qrElementSchema,
]);
export type DesignElement = z.infer<typeof designElementSchema>;

export const backgroundSchema = z.object({
  type: z.enum(['color', 'gradient', 'image', 'pattern']).default('color'),
  value: z.string().default('#FFFFFF'),
});
export type DesignBackground = z.infer<typeof backgroundSchema>;

export const designContentSchema = z.object({
  background: backgroundSchema,
  elements: z.array(designElementSchema).max(200).default([]),
});
export type DesignContent = z.infer<typeof designContentSchema>;

/** Icônes disponibles (glyphes Unicode — pas de dépenance d'icônes SVG). */
export const ICONS: Record<string, string> = {
  heart: '♥', star: '★', sparkle: '✦', flower: '✿', leaf: '❧',
  music: '♪', champagne: '🍾', cake: '🎂', ring: '💍', calendar: '📅',
  location: '📍', church: '⛪', phone: '✆', gift: '🎁', crown: '♛',
  laurel: '🌿', sun: '☀', moon: '☾', infinity: '∞', diamond: '◆',
};
export const ICON_LIST = Object.keys(ICONS);

let counter = 0;
/** Id court unique (stable côté client dans la session). */
export function newElementId(): string {
  counter = (counter + 1) % 1000;
  return `e${Date.now().toString(36)}${counter.toString(36)}`;
}

export function makeTextElement(partial: Partial<z.infer<typeof textElementSchema>> = {}): z.infer<typeof textElementSchema> {
  return textElementSchema.parse({
    id: newElementId(),
    type: 'text',
    x: 140, y: 200, width: 800, height: 60,
    text: 'Nouveau texte',
    ...partial,
  });
}

export function makeShapeElement(partial: Partial<z.infer<typeof shapeElementSchema>> = {}): z.infer<typeof shapeElementSchema> {
  return shapeElementSchema.parse({
    id: newElementId(),
    type: 'shape',
    shape: 'rect',
    x: 200, y: 300, width: 300, height: 200,
    fill: '#E5E7EB',
    ...partial,
  });
}

export function makeImageElement(partial: Partial<z.infer<typeof imageElementSchema>> = {}): z.infer<typeof imageElementSchema> {
  return imageElementSchema.parse({
    id: newElementId(),
    type: 'image',
    x: 240, y: 300, width: 600, height: 600,
    src: '',
    ...partial,
  });
}

export function makeQrElement(partial: Partial<z.infer<typeof qrElementSchema>> = {}): z.infer<typeof qrElementSchema> {
  return qrElementSchema.parse({
    id: newElementId(),
    type: 'qr',
    x: 700, y: 900, width: 280, height: 280,
    value: 'https://eventflow.app/i/…',
    ...partial,
  });
}

/** Normalise une liste d'éléments (applatit les valeurs par défaut manquantes). */
export function normalizeContent(raw: unknown): DesignContent {
  return designContentSchema.parse(raw ?? { background: { type: 'color', value: '#FFFFFF' }, elements: [] });
}
