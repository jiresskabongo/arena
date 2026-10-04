import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { listCheckIns } from '@/server/services/checkin';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';

/** GET /api/events/[id]/checkins — historique de check-in (pagination, recherche, filtres). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    const url = new URL(req.url);
    const res = await listCheckIns(ctx, id, {
      page: Number(url.searchParams.get('page') ?? 1),
      pageSize: Number(url.searchParams.get('pageSize') ?? 25),
      search: url.searchParams.get('search') ?? undefined,
      result: url.searchParams.get('result') ?? undefined,
      entryPoint: url.searchParams.get('entryPoint') ?? undefined,
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return apiError(e);
  }
}
