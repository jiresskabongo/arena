import { prisma } from '@/lib/prisma';
import { generateSecureToken, hashToken } from '@/lib/crypto';

export type EmailTokenKind = 'verify_email' | 'reset_password';

interface KindConfig {
  kind: EmailTokenKind;
  ttlHours: number;
}

const TTL: Record<EmailTokenKind, number> = {
  verify_email: 24,
  reset_password: 1,
};

/**
 * Crée un token e-mail à usage unique (24h vérif / 1h reset).
 * Retourne le token brut (lien) + crée le hash en base.
 */
export async function createEmailToken(
  userId: string,
  kind: EmailTokenKind,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSecureToken(32);
  const expiresAt = new Date(Date.now() + TTL[kind] * 60 * 60 * 1000);

  if (kind === 'verify_email') {
    await prisma.emailVerificationToken.create({
      data: { userId, tokenHash: hashToken(token), expiresAt },
    });
  } else {
    await prisma.passwordResetToken.create({
      data: { userId, tokenHash: hashToken(token), expiresAt },
    });
  }
  return { token, expiresAt };
}

export type EmailTokenResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'used' };

/**
 * Consomme un token (usage unique, avec expiration).
 * `invalid` couvre aussi un token inexistant (aucune différence de réponse côté API : anti-énumération).
 */
export async function consumeEmailToken(
  token: string,
  kind: EmailTokenKind,
): Promise<EmailTokenResult> {
  const tokenHash = hashToken(token);
  const now = new Date();

  if (kind === 'verify_email') {
    const t = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } });
    if (!t) return { ok: false, reason: 'invalid' };
    if (t.usedAt) return { ok: false, reason: 'used' };
    if (t.expiresAt < now) return { ok: false, reason: 'expired' };
    await prisma.$transaction([
      prisma.emailVerificationToken.update({ where: { id: t.id }, data: { usedAt: now } }),
      prisma.user.update({ where: { id: t.userId }, data: { emailVerifiedAt: now } }),
    ]);
    return { ok: true, userId: t.userId };
  }

  const t = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!t) return { ok: false, reason: 'invalid' };
  if (t.usedAt) return { ok: false, reason: 'used' };
  if (t.expiresAt < now) return { ok: false, reason: 'expired' };
  await prisma.passwordResetToken.update({ where: { id: t.id }, data: { usedAt: now } });
  return { ok: true, userId: t.userId };
}
