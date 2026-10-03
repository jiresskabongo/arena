import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { addGuest } from '@/server/services/guest';
import { addGuestSchema } from '@/lib/schemas/event';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** POST /api/events/[id]/guests — ajout manuel (permission guest:invite). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: eventId } = await params;
    const ctx = await requireTenant('guest:invite');

    const body = await req.json().catch(() => null);
    const parsed = addGuestSchema.safeParse(body);
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
    const guest = await addGuest(ctx, eventId, parsed.data, ip);
    return NextResponse.json({ ok: true, guest }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
