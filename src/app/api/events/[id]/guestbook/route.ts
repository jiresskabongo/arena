import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { listGuestbook } from '@/server/services/statistics';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';

/** GET /api/events/[id]/guestbook — messages du livre d'or (tous statuts, paginé). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    const url = new URL(req.url);
    const res = await listGuestbook(ctx, id, {
      page: Number(url.searchParams.get('page') ?? 1),
      pageSize: Number(url.searchParams.get('pageSize') ?? 25),
      status: url.searchParams.get('status') ?? undefined,
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return apiError(e);
  }
}
