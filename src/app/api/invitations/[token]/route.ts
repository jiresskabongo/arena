import { NextResponse } from 'next/server';
import { getPublicInvitation } from '@/server/services/invitation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/invitations/[token] — vue publique (sans auth).
 * Anti-énumération : 404 identique pour token inconnu, révoqué, expiré
 * ou événement non publié.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Token = 32 chars base62 ; longueurs/jeux de caractères hors norme → 404 immédiat
  if (!/^[0-9A-Za-z]{16,80}$/.test(token)) {
    return NextResponse.json(
      { error: { code: 'invitation_not_found', message: 'Invitation introuvable.' } },
      { status: 404 },
    );
  }
  const view = await getPublicInvitation(token);
  if (!view) {
    return NextResponse.json(
      { error: { code: 'invitation_not_found', message: 'Invitation introuvable.' } },
      { status: 404 },
    );
  }
  return NextResponse.json({
    ok: true,
    invitation: {
      ...view.invitation,
      event: { ...view.invitation.event, date: view.invitation.event.date.toISOString() },
    },
  });
}
