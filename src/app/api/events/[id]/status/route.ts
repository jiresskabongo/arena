import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { setEventStatus } from '@/server/services/event';
import { eventStatusSchema } from '@/lib/schemas/event';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/**
 * POST /api/events/[id]/status — machine à états (publier, dépublier,
 * archiver, restaurer). Permission event:update (archiver) ;
 * la suppression est une autre route (event:delete).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant('event:update');

    const body = await req.json().catch(() => null);
    const parsed = eventStatusSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'validation', message: 'Statut invalide.' } },
        { status: 400 },
      );
    }

    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    const updated = await setEventStatus(ctx, id, parsed.data.status, ip);
    return NextResponse.json({ ok: true, event: updated });
  } catch (e) {
    return apiError(e);
  }
}
