import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { confirmImport } from '@/server/services/guest';
import { importConfirmSchema } from '@/lib/schemas/guest';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/**
 * POST /api/events/[id]/import/confirm — étape finale : le serveur
 * re-valide TOUTES les lignes, détecte les doublons, contrôle le quota
 * (toute ou rien) et crée les invités.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: eventId } = await params;
    const ctx = await requireTenant('guest:import');
    const body = await req.json().catch(() => null);
    const parsed = importConfirmSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'validation',
            message: 'Import invalide. Vérifiez le fichier et réessayez.',
            details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
          },
        },
        { status: 400 },
      );
    }
    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    const res = await confirmImport(ctx, eventId, parsed.data, ip);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return apiError(e);
  }
}
