import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuth, destroySession } from '@/server/auth/session';
import { logActivity } from '@/server/services/activity';

export const dynamic = 'force-dynamic';

/** Révoque une session. Sécurité : une session ne peut être révoquée que par son propriétaire. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuth();
  if (!auth) {
    return NextResponse.json({ error: { code: 'unauthorized', message: 'Session expirée.' } }, { status: 401 });
  }

  const { id } = await params;
  const session = await prisma.session.findUnique({ where: { id } });
  if (!session || session.userId !== auth.user.id) {
    // Même réponse que succès pour ne pas révéler l'existence d'une session
    return NextResponse.json({ ok: true });
  }

  await destroySession(id);
  await logActivity({
    userId: auth.user.id,
    action: 'auth.session_revoked',
    entity: 'session',
    entityId: id,
    meta: { isCurrent: id === auth.session.id },
  });

  const res = NextResponse.json({ ok: true, revokedCurrent: id === auth.session.id });
  if (id === auth.session.id) {
    const { cookies } = await import('next/headers');
    const store = await cookies();
    store.delete('ef_session');
  }
  return res;
}
