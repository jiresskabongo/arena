import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { getEventStatistics } from '@/server/services/statistics';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';

/** GET /api/events/[id]/statistics — KPIs + séries graphiques (CDC §36). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    const stats = await getEventStatistics(ctx, id);
    return NextResponse.json({ ok: true, stats });
  } catch (e) {
    return apiError(e);
  }
}
