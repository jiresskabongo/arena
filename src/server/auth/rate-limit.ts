/**
 * Rate limiting en mémoire (sandbox mono-instance).
 * En production : remplacer par un store partagé (Redis) sans changer l'API.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Nettoyage périodique des buckets expirés
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (b.resetAt < now) buckets.delete(key);
  }
}, 60 * 1000).unref?.();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterMs: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfterMs: bucket.resetAt - now };
  }
  return { ok: true, retryAfterMs: 0 };
}

/** Clé standard : route + IP */
export function rlKey(route: string, ip: string | null): string {
  return `${route}:${ip ?? 'unknown'}`;
}

export const limits = {
  authPerMin: parseInt(process.env.RATE_LIMIT_AUTH_PER_MIN ?? '5', 10),
  publicRsvpPerMin: parseInt(process.env.RATE_LIMIT_PUBLIC_RSVP_PER_MIN ?? '10', 10),
  scanPerMin: parseInt(process.env.RATE_LIMIT_SCAN_PER_MIN ?? '60', 10),
};
