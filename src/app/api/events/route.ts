import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { createEvent, listEvents } from '@/server/services/event';
import { createEventSchema, paginationSchema } from '@/lib/schemas/event';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** POST /api/events — création (permission event:create ; quota + essai vérifiés). */
export async function POST(req: Request) {
  try {
    const ctx = await requireTenant('event:create');

    const body = await req.json().catch(() => null);
    const parsed = createEventSchema.safeParse(body);
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
    const created = await createEvent(ctx, parsed.data, ip);
    return NextResponse.json({ ok: true, event: created }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}

/** GET /api/events — liste paginée (tous rôles de l'org). */
export async function GET(req: Request) {
  try {
    const ctx = await requireTenant();
    if (!ctx.organization) {
      return NextResponse.json({ ok: true, items: [], total: 0, page: 1, pageSize: 10, totalPages: 1 });
    }

    const url = new URL(req.url);
    const paged = paginationSchema.parse({
      page: url.searchParams.get('page') ?? '1',
      pageSize: url.searchParams.get('pageSize') ?? '10',
    });

    const result = await listEvents(ctx.organization.id, paged.page, paged.pageSize);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return apiError(e);
  }
}
