import { cookies, headers } from 'next/headers';
import type { ResponseCookie } from 'next/dist/compiled/@edge-runtime/cookies';
import { prisma } from '@/lib/prisma';
import { generateSecureToken, hashToken } from '@/lib/crypto';
import type { Session, User } from '@prisma/client';

export const SESSION_COOKIE = 'ef_session';

const sessionTtlMs = () =>
  (parseInt(process.env.SESSION_TTL_DAYS ?? '30', 10) || 30) * 24 * 60 * 60 * 1000;

function clientMeta() {
  // headers() est async depuis Next 15
  return Promise.all([headers()]).then(([h]) => ({
    ip: (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || h.get('x-real-ip') || null,
    userAgent: h.get('user-agent') ?? null,
  }));
}

/**
 * Crée une session et retourne le token brut (à placer dans le cookie).
 * Seul le hash SHA-256 du token est stocké en base.
 */
export async function createSession(userId: string): Promise<string> {
  const { ip, userAgent } = await clientMeta();
  const token = generateSecureToken(32);
  const expiresAt = new Date(Date.now() + sessionTtlMs());

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      ip,
      userAgent: userAgent?.slice(0, 400),
      expiresAt,
    },
  });
  return token;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(sessionTtlMs() / 1000),
  };
}

export interface AuthContext {
  user: User;
  session: Session;
}

/**
 * Résout le contexte d'authentification depuis le cookie de session.
 * Retourne null si absente, expirée ou révoquée (jamais d'info au client).
 */
export async function getAuth(): Promise<AuthContext | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;

  return { user: session.user, session };
}

export async function destroySession(sessionId: string): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  });
}

export async function destroyAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
