import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { z } from 'zod';

/**
 * Politique de mot de passe (CDC §62 : hash sécurisé).
 * Min 8 caractères, au moins une lettre et un chiffre.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Au moins 8 caractères')
  .max(128)
  .regex(/[A-Za-z]/, 'Doit contenir au moins une lettre')
  .regex(/[0-9]/, 'Doit contenir au moins un chiffre');

// Argon2id : 64 MiB mémoire, 3 itérations, parallélisme 1 (OWASP 2024+)
const params = { memoryCost: 64 * 1024, timeCost: 3, parallelism: 1 };

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, params);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argonVerify(hash, password, params);
  } catch {
    return false;
  }
}
