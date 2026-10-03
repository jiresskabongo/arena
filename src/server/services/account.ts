import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { slugify } from '@/lib/crypto';
import { createEmailToken } from '@/server/auth/tokens';
import { destroyAllSessionsForUser } from '@/server/auth/session';
import { logActivity } from './activity';
import { emailProvider, getTemplate, renderTemplate } from '@/server/providers/email';
import type { LoginInput, RegisterInput, ChangePasswordInput } from '@/lib/schemas/auth';
import type { User } from '@prisma/client';

async function uniqueOrgSlug(tx: Prisma.TransactionClient, base: string): Promise<string> {
  const suffix = Math.random().toString(36).slice(2, 6);
  for (let i = 0; i < 5; i++) {
    const slug = i === 0 ? `${base}-${suffix}` : `${base}-${suffix}-${i}`;
    const exists = await tx.organization.findUnique({ where: { slug } });
    if (!exists) return slug;
  }
  throw new Error('slug_collision');
}

export type ApiError = { code: string; message: string };
export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };

function bad(code: string, message: string): ApiError {
  return { code, message };
}

const publicUser = (u: User) => ({
  id: u.id,
  email: u.email,
  firstName: u.firstName,
  lastName: u.lastName,
  locale: u.locale,
  currency: u.currency,
  timezone: u.timezone,
  isSuperAdmin: u.isSuperAdmin,
  emailVerified: u.emailVerifiedAt !== null,
});

/**
 * Inscription (CDC §7) : utilisateur + organisation + membre owner +
 * org active + état d'onboarding, le tout en transaction.
 * Envoie l'e-mail de vérification (mock) et crée la session.
 */
export async function register(
  input: RegisterInput,
  ip: string | null,
): Promise<Result<{ userId: string; organizationId: string }>> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    return { ok: false, error: bad('email_taken', 'Un compte existe déjà avec cet e-mail.') };
  }

  const passwordHash = await hashPassword(input.password);
  const locale = input.locale ?? 'fr';
  const currency = input.currency ?? 'USD';

  const orgSlugBase = slugify(input.organizationName) || 'org';

  try {
    const { user, organization } = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          locale,
          currency,
        },
      });

      const org = await tx.organization.create({
        data: {
          name: input.organizationName,
          slug: await uniqueOrgSlug(tx, orgSlugBase),
          locale,
          currency,
        },
      });

      await tx.organizationMember.create({
        data: { organizationId: org.id, userId: u.id, role: 'owner', status: 'active' },
      });
      await tx.userActiveOrg.create({ data: { userId: u.id, organizationId: org.id } });
      await tx.onboardingState.create({ data: { userId: u.id, organizationId: org.id } });
      await tx.activityLog.create({
        data: {
          userId: u.id,
          organizationId: org.id,
          action: 'register',
          entity: 'user',
          entityId: u.id,
          ip,
        },
      });
      return { user: u, organization: org };
    });

    // E-mail de vérification (mock, lien visible dans l'outbox démo)
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    const { token } = await createEmailToken(user.id, 'verify_email');
    const tpl = await getTemplate('welcome', 'email', organization.id, locale as 'fr' | 'en');
    await emailProvider.send({
      to: input.email,
      organizationId: organization.id,
      templateKey: 'welcome',
      subject: tpl?.subject || 'Bienvenue sur EventFlow',
      text: `${renderTemplate(tpl?.body ?? 'Bienvenue !', {
        guest_name: input.firstName,
        invitation_url: `${appUrl}/${locale === 'en' ? 'en/' : ''}verify-email?token=${token}`,
      })}\n\n— Lien de vérification : ${appUrl}/${locale === 'en' ? 'en/' : ''}verify-email?token=${token}`,
    });

    return { ok: true, data: { userId: user.id, organizationId: organization.id } };
  } catch (e) {
    console.error('[register] erreur', e);
    return { ok: false, error: bad('internal', 'Inscription impossible. Veuillez réessayer.') };
  }
}

export async function login(
  input: LoginInput,
  ip: string | null,
): Promise<Result<{ userId: string }>> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Réponse identique utilisateur inexistant / mauvais mot de passe (anti-énumération)
  if (!user) {
    return { ok: false, error: bad('invalid_credentials', 'E-mail ou mot de passe incorrect.') };
  }
  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    return { ok: false, error: bad('invalid_credentials', 'E-mail ou mot de passe incorrect.') };
  }
  await logActivity({ userId: user.id, action: 'login', ip });
  return { ok: true, data: { userId: user.id } };
}

/**
 * Mot de passe oublié — toujours 200/ok (anti-énumération).
 */
export async function forgotPassword(
  email: string,
  locale: 'fr' | 'en' = 'fr',
): Promise<Result<{ sent: boolean }>> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return { ok: true, data: { sent: true } };

  const { token } = await createEmailToken(user.id, 'reset_password');
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const resetUrl = `${appUrl}/${locale === 'en' ? 'en/' : ''}reset-password?token=${token}`;

  const tpl = await getTemplate('reset_password', 'email', undefined, locale);
  await emailProvider.send({
    to: email,
    templateKey: 'reset_password',
    subject: tpl?.subject || 'Réinitialisation de mot de passe — EventFlow',
    text: `${renderTemplate(tpl?.body ?? 'Réinitialisez votre mot de passe :', {
      guest_name: user.firstName,
      invitation_url: resetUrl,
    })}\n\n— Lien : ${resetUrl}`,
  });

  await logActivity({ userId: user.id, action: 'auth.password_reset_requested', ip: null });
  return { ok: true, data: { sent: true } };
}

export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
  ip: string | null,
): Promise<Result<null>> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: bad('not_found', 'Compte introuvable.') };
  const valid = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!valid) {
    return { ok: false, error: bad('invalid_credentials', 'Mot de passe actuel incorrect.') };
  }
  const passwordHash = await hashPassword(input.newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  // Sécurité : révoquer toutes les sessions après un changement de mot de passe
  await destroyAllSessionsForUser(userId);
  await logActivity({ userId, action: 'auth.password_changed', ip });
  return { ok: true, data: null };
}
