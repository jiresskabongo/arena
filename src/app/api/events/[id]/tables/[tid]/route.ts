import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { updateTable, removeTable } from '@/server/services/guest';
import { updateTableSchema } from '@/lib/schemas/guest';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** PATCH /api/events/[id]/tables/[tid] — mise à jour (table:manage). */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; tid: string }> },
) {
  try {
    const { id: eventId, tid } = await params;
    const ctx = await requireTenant('table:manage');
    const body = await req.json().catch(() => null);
    const parsed = updateTableSchema.safeParse(body);
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
    const table = await updateTable(ctx, eventId, tid, parsed.data, ip);
    return NextResponse.json({ ok: true, table: { id: table.id, name: table.name, capacity: table.capacity } });
  } catch (e) {
    return apiError(e);
  }
}

/** DELETE /api/events/[id]/tables/[tid] — suppression, invités → sans table. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; tid: string }> },
) {
  try {
    const { id: eventId, tid } = await params;
    const ctx = await requireTenant('table:manage');
    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    await removeTable(ctx, eventId, tid, ip);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
