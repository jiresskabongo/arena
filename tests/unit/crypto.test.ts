import { describe, expect, it } from 'vitest';
import { generateSecureToken, hashToken, slugify, normalizePhone } from '@/lib/crypto';

describe('generateSecureToken (CDC §22–23)', () => {
  it('génère un token de 32 caractères base62', () => {
    const t = generateSecureToken();
    expect(t).toHaveLength(32);
    expect(t).toMatch(/^[0-9A-Za-z]+$/);
  });

  it('est non prédictible (uniqueness sur 1000 générations)', () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(generateSecureToken());
    expect(set.size).toBe(1000);
  });

  it('supporte la taille personnalisée', () => {
    expect(generateSecureToken(16)).toHaveLength(16);
  });
});

describe('hashToken', () => {
  it('est déterministe et retourne un hex sha256', () => {
    const a = hashToken('abc');
    const b = hashToken('abc');
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('slugify', () => {
  it('normalise les accents et les séparateurs', () => {
    expect(slugify('Mariage Jean & Marie!')).toBe('mariage-jean-marie');
  });
});

describe('normalizePhone (CDC §20)', () => {
  it('normalise au format E.164 basique', () => {
    expect(normalizePhone('+243 999 123 456')).toBe('+243999123456');
    expect(normalizePhone('099 123 456')).toBe('+099123456');
  });

  it("rejette les valeurs invalides", () => {
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});
