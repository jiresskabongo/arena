import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuth } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

/** Liste les sessions actives de l'utilisateur (CDC §51 : sessions/appareils). */
export async function GET() {
  const auth = await getAuth();
  if (!auth) {
    return NextResponse.json({ error: { code: 'unauthorized', message: 'Session expirée.' } }, { status: 401 });
  }

  const sessions = await prisma.session.findMany({
    where: { userId: auth.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
  });

  return NextResponse.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      isCurrent: s.id === auth.session.id,
    })),
  });
}
