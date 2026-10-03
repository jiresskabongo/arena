import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword, passwordSchema } from '@/server/auth/password';
import { rateLimit } from '@/server/auth/rate-limit';
import { loginSchema, registerSchema } from '@/lib/schemas/auth';

describe('politique de mot de passe (CDC §62)', () => {
  it('accepte un mot de passe valide', () => {
    expect(passwordSchema.safeParse('S3cur3Pass').success).toBe(true);
  });

  it("rejette les mots de passe trop courts / sans chiffre / sans lettre", () => {
    expect(passwordSchema.safeParse('Ab1').success).toBe(false);
    expect(passwordSchema.safeParse('TropLongSansChiffre').success).toBe(false);
    expect(passwordSchema.safeParse('12345678').success).toBe(false);
  });
});

describe('hashing Argon2id', () => {
  it('hash puis vérifie correctement', async () => {
    const hash = await hashPassword('MaPass123');
    expect(hash).not.toContain('MaPass123');
    await expect(verifyPassword('MaPass123', hash)).resolves.toBe(true);
    await expect(verifyPassword('Mauvaise123', hash)).resolves.toBe(false);
  });

  it('ne lève pas d’exception sur un hash corrompu', async () => {
    await expect(verifyPassword('x1', 'not-a-hash')).resolves.toBe(false);
  });
});

describe('rate limiting (CDC §62)', () => {
  it('laisse passer jusqu’au seuil puis bloque', () => {
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      expect(rateLimit(key, 3, 60_000).ok).toBe(true);
    }
    const blocked = rateLimit(key, 3, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('réinitialise après la fenêtre', () => {
    const key = `test:${Math.random()}`;
    rateLimit(key, 1, 50);
    // Attendre la fenêtre
    return new Promise<void>((resolve) => setTimeout(resolve, 80)).then(() => {
      expect(rateLimit(key, 1, 60_000).ok).toBe(true);
    });
  });
});

describe('schemas d’authentification', () => {
  it('normalise l’email en minuscules', () => {
    const parsed = loginSchema.safeParse({ email: 'User@Exemple.COM', password: 'x1' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.email).toBe('user@exemple.com');
  });

  it('rejette un register incomplet', () => {
    const parsed = registerSchema.safeParse({ email: 'a@b.c' });
    expect(parsed.success).toBe(false);
  });
});
