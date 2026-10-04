import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { listDesigns, createDesign, createDesignSchema } from '@/server/services/design';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** GET /api/designs — liste paginée (designs:read = tout rôle org via guest:read analogique). */
export async function GET(req: Request) {
  try {
    const ctx = await requireTenant();
    const url = new URL(req.url);
    const res = await listDesigns(ctx, {
      eventId: url.searchParams.get('eventId') ?? undefined,
      page: Number(url.searchParams.get('page') ?? 1),
      pageSize: Number(url.searchParams.get('pageSize') ?? 12),
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return apiError(e);
  }
}

/** POST /api/designs — création (design:create), éventuellement depuis un template. */
export async function POST(req: Request) {
  try {
    const ctx = await requireTenant('design:create');
    const body = await req.json().catch(() => null);
    const parsed = createDesignSchema.safeParse(body);
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
    const design = await createDesign(ctx, parsed.data, ip);
    return NextResponse.json({ ok: true, design: { id: design.id, name: design.name } }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
