import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { updateEventMember, removeEventMember } from '@/server/services/event';
import { eventMemberSchema } from '@/lib/schemas/event';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';

/** PATCH /api/events/[id]/members/[mid] — modifier une personne (event:update). */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; mid: string }> },
) {
  try {
    const { id, mid } = await params;
    const ctx = await requireTenant('event:update');

    const body = await req.json().catch(() => null);
    const parsed = eventMemberSchema.safeParse(body);
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

    await updateEventMember(ctx, id, mid, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}

/** DELETE /api/events/[id]/members/[mid] — retirer une personne (event:update). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; mid: string }> },
) {
  try {
    const { id, mid } = await params;
    const ctx = await requireTenant('event:update');

    await removeEventMember(ctx, id, mid);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
