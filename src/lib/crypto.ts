import { createHash, randomBytes } from 'node:crypto';

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Token opaque non prédictible (CDC §22–23) : 32 octets aléatoires → base62 (32 chars).
 * Ne contient AUCUNE donnée personnelle.
 */
export function generateSecureToken(bytes = 32): string {
  const buf = randomBytes(bytes);
  let out = '';
  for (const b of buf) out += B62[b % 62];
  return out;
}

/** Hash hexadécimal SHA-256 (stockage des tokens de session / e-mail). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Slug URL-safe à partir d'un nom (pages publiques). */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Normalise un téléphone au format E.164 basique (dévient '' si invalide). */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const cleaned = input.replace(/[\s().-]/g, '');
  if (/^\+?[0-9]{7,15}$/.test(cleaned)) return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  return null;
}
