import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { updateGuest, removeGuest } from '@/server/services/guest';
import { updateGuestSchema } from '@/lib/schemas/guest';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** PATCH /api/events/[id]/guests/[gid] — mise à jour partielle (guest:update). */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; gid: string }> },
) {
  try {
    const { id: eventId, gid } = await params;
    const ctx = await requireTenant('guest:update');

    const body = await req.json().catch(() => null);
    const parsed = updateGuestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'validation',
            message: 'Veuillez corriger les champs indiqués.',
            details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
          },
        },
        { status: 400 },
      );
    }

    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    const guest = await updateGuest(ctx, eventId, gid, parsed.data, ip);
    return NextResponse.json({ ok: true, guest });
  } catch (e) {
    return apiError(e);
  }
}

/** DELETE /api/events/[id]/guests/[gid] — suppression (guest:delete). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; gid: string }> },
) {
  try {
    const { id: eventId, gid } = await params;
    const ctx = await requireTenant('guest:delete');
    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    await removeGuest(ctx, eventId, gid, ip);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
