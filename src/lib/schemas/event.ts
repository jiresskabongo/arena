import { z } from 'zod';

/** Options d'événement (CDC §10) — les 10 clés du cahier des charges. */
export const eventOptionsSchema = z.object({
  qr: z.boolean().default(true),
  rsvp: z.boolean().default(true),
  sms: z.boolean().default(false),
  email: z.boolean().default(false),
  whatsapp: z.boolean().default(false),
  guestbook: z.boolean().default(false),
  preferences: z.boolean().default(false),
  tables: z.boolean().default(false),
  gallery: z.boolean().default(false),
  countdown: z.boolean().default(true),
});
export type EventOptions = z.infer<typeof eventOptionsSchema>;

const cleanable = <T extends z.ZodTypeAny>(schema: T) =>
  schema.optional().or(z.literal(''));

export const eventTypeCodes = [
  'wedding', 'engagement', 'birthday', 'baptism', 'communion', 'anniversary',
  'funeral', 'graduation', 'retirement', 'company', 'conference', 'concert',
  'sport', 'gala', 'launch', 'party', 'reunion', 'fundraiser', 'expo', 'other',
] as const;

export const createEventSchema = z.object({
  name: z.string().min(2).max(120),
  typeCode: z.enum(eventTypeCodes),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ)'),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure invalide (HH:MM)'),
  endTime: cleanable(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)),
  timezone: z.string().min(3).max(64).default('Africa/Kinshasa'),
  venue: z.string().min(2).max(160),
  address: cleanable(z.string().max(200)),
  city: cleanable(z.string().max(100)),
  country: cleanable(z.string().max(100)),
  description: cleanable(z.string().max(2000)),
  contactPhone: cleanable(z.string().max(30)),
  contactEmail: cleanable(z.string().email()),
  website: cleanable(z.string().url()),
  dressCode: cleanable(z.string().max(120)),
  practicalInfo: cleanable(z.string().max(2000)),
  welcomeMessage: cleanable(z.string().max(400)),
  allowMultipleEntries: z.boolean().default(false),
  optionsJson: eventOptionsSchema.optional().default({}),
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

/** Mise à jour : mêmes champs, tous optionnels (CDC §10). */
export const updateEventSchema = createEventSchema.partial();
export type UpdateEventInput = z.input<typeof updateEventSchema>;

export const addGuestSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: cleanable(z.string().email()),
  phone: cleanable(z.string().min(5).max(30)),
  category: z.enum(['famille', 'amis', 'vip', 'collegues', 'autres']).default('autres'),
  tableId: z.string().optional(),
});
export type AddGuestInput = z.input<typeof addGuestSchema>;

const roleChoices = ['manager', 'designer', 'scanner', 'viewer'] as const;
export const inviteMemberSchema = z.object({
  email: z.string().email().max(160),
  role: z.enum(roleChoices).default('viewer'),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const changeMemberRoleSchema = z.object({
  role: z.enum(['manager', 'designer', 'scanner', 'viewer']),
});

export const updateOrgSchema = z.object({
  name: z.string().min(2).max(120),
  currency: z.enum(['USD', 'CDF', 'EUR']),
  locale: z.enum(['fr', 'en']),
  timezone: z.string().min(3).max(64),
  email: cleanable(z.string().email()),
  phone: cleanable(z.string().max(30)),
  address: cleanable(z.string().max(200)),
});
export type UpdateOrgInput = z.infer<typeof updateOrgSchema>;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

/** Personnes principales (CDC §10). Photos : phase 7 (upload médias). */
export const eventMemberSchema = z.object({
  roleLabel: z.string().min(1).max(60),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  mediaId: z.string().optional(),
  sortOrder: z.number().int().min(0).max(99).default(0),
});
export type EventMemberInput = z.infer<typeof eventMemberSchema>;

export const eventStatusSchema = z.object({
  status: z.enum(['draft', 'published', 'archived']),
});

/** Livre d'or public (CDC §35) — modération complète : phase 12. */
export const guestbookMessageSchema = z.object({
  authorName: z.string().min(1).max(100),
  authorEmail: cleanable(z.string().email()),
  message: z.string().min(2).max(2000),
});
export type GuestbookMessageInput = z.infer<typeof guestbookMessageSchema>;
