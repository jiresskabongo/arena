import { z } from 'zod';

/** Types d'événements valides (seed : 20 types — la vérif DB est faite en service). */
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
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  timezone: z.string().min(3).max(64).default('Africa/Kinshasa'),
  venue: z.string().min(2).max(160),
  address: z.string().max(200).optional().or(z.literal('')),
  city: z.string().max(100).optional().or(z.literal('')),
  country: z.string().max(100).optional().or(z.literal('')),
  description: z.string().max(2000).optional().or(z.literal('')),
  contactPhone: z.string().max(30).optional().or(z.literal('')),
  contactEmail: z.string().email().max(160).optional().or(z.literal('')),
  dressCode: z.string().max(120).optional().or(z.literal('')),
  practicalInfo: z.string().max(1000).optional().or(z.literal('')),
  optionsJson: z
    .object({
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
    })
    .optional()
    .default({}),
});

export const addGuestSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: z.string().email().max(160).optional().or(z.literal('')),
  phone: z.string().min(5).max(30).optional().or(z.literal('')),
  category: z.enum(['famille', 'amis', 'vip', 'collegues', 'autres']).default('autres'),
  tableId: z.string().optional(),
});

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
  email: z.string().email().max(160).optional().or(z.literal('')),
  phone: z.string().max(30).optional().or(z.literal('')),
  address: z.string().max(200).optional().or(z.literal('')),
});
export type UpdateOrgInput = z.infer<typeof updateOrgSchema>;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});
