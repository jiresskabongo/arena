import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { listTemplates } from '@/server/services/design';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';

/** GET /api/templates — bibliothèque (plateforme + org), verrou premium calculé. */
export async function GET(req: Request) {
  try {
    const ctx = await requireTenant();
    const url = new URL(req.url);
    const items = await listTemplates(ctx, {
      category: url.searchParams.get('category') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
    });
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return apiError(e);
  }
}
