import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { listTables, createTable } from '@/server/services/guest';
import { createTableSchema } from '@/lib/schemas/guest';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** GET /api/events/[id]/tables — tables + occupation (guest:read). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: eventId } = await params;
    const ctx = await requireTenant('guest:read');
    const tables = await listTables(ctx, eventId);
    return NextResponse.json({
      ok: true,
      tables: tables.map((t) => ({
        id: t.id,
        name: t.name,
        capacity: t.capacity,
        sortOrder: t.sortOrder,
        occupied: t._count.guests,
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}

/** POST /api/events/[id]/tables — création (table:manage). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: eventId } = await params;
    const ctx = await requireTenant('table:manage');
    const body = await req.json().catch(() => null);
    const parsed = createTableSchema.safeParse(body);
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
    const table = await createTable(ctx, eventId, parsed.data, ip);
    return NextResponse.json({ ok: true, table: { id: table.id, name: table.name, capacity: table.capacity } }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
