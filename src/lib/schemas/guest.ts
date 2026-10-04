import { z } from 'zod';

export const guestCategorySchema = z.enum(['famille', 'amis', 'vip', 'collegues', 'autres']);
export const rsvpStatusSchema = z.enum(['pending', 'confirmed', 'declined', 'maybe']);
export const presenceStatusSchema = z.enum(['pending', 'present', 'absent']);

const cleanable = <T extends z.ZodTypeAny>(s: T) => s.optional().or(z.literal('').transform(() => undefined));

/** Création d'un invité (étendu Phase 6 : accompagnateurs, notes, préférences). */
export const createGuestSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: cleanable(z.string().email()),
  phone: cleanable(z.string().min(5).max(30)),
  category: guestCategorySchema.default('autres'),
  tableId: z.string().optional(),
  companions: z.number().int().min(0).max(50).default(0),
  internalNotes: cleanable(z.string().max(2000)),
  preference: z
    .object({
      meal: cleanable(z.string().max(80)),
      drink: cleanable(z.string().max(80)),
      allergies: cleanable(z.string().max(500)),
      ceremonyAttending: z.boolean().optional(),
      receptionAttending: z.boolean().optional(),
    })
    .optional(),
});

/** Mise à jour partielle d'un invité (tous champs + préférences upsert + statut RSVP). */
export const updateGuestSchema = createGuestSchema.partial().extend({
  rsvpStatus: rsvpStatusSchema.optional(),
});

/** Liste paginée + recherche + filtres + tris (CDC §11, §66). */
export const listGuestsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
  search: cleanable(z.string().min(1).max(120)),
  category: guestCategorySchema.optional(),
  tableId: cleanable(z.string().min(1)),
  noTable: z.coerce.boolean().optional().default(false),
  rsvpStatus: rsvpStatusSchema.optional(),
  presenceStatus: presenceStatusSchema.optional(),
  sort: z.enum(['name', 'createdAt', 'category', 'table']).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
});

/** Tables (capacité + occupation, CDC §11). */
export const createTableSchema = z.object({
  name: z.string().min(1).max(60),
  capacity: z.number().int().min(1).max(200).default(8),
  sortOrder: z.number().int().min(-1000).max(1000).default(0),
});
export const updateTableSchema = createTableSchema.partial();

/**
 * Import (CDC §11) : upload → mapping → aperçu → correction → confirmation.
 * Le serveur re-valide TOUTES les lignes à la confirmation (source de vérité)
 * et détecte les doublons (interne + au sein du fichier).
 */
export type ImportField =
  | 'firstName'
  | 'lastName'
  | 'phone'
  | 'email'
  | 'category'
  | 'table'
  | 'companions';

export const IMPORT_FIELDS = [
  'firstName', 'lastName', 'phone', 'email', 'category', 'table', 'companions',
] as const satisfies readonly ImportField[];

export const importUploadSchema = z.object({
  fileName: z.string().min(1).max(255),
  /** 'csv' | 'xlsx' */
  kind: z.enum(['csv', 'xlsx']),
  /** CSV : texte brut ; xlsx : base64 du fichier (1ʳᵉ feuille). */
  content: z.string().min(1).max(8_000_000),
});

export const importConfirmSchema = z.object({
  jobId: z.string().min(1),
  /** colIndex → champ (les colonnes non mappées sont ignorées) */
  mapping: z.record(z.string(), z.enum([...IMPORT_FIELDS])).default({}),
  rows: z
    .array(
      z.object({
        row: z.number().int().min(2),
        data: z.record(z.string()),
      }),
    )
    .min(1)
    .max(5000),
});
