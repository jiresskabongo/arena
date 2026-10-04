import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { getAiUsage } from '@/server/services/ai';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';

/** GET /api/ai/usage — historique des crédits IA (paginé) + total mensuel. */
export async function GET(req: Request) {
  try {
    const ctx = await requireTenant();
    const url = new URL(req.url);
    const res = await getAiUsage(ctx, {
      page: Number(url.searchParams.get('page') ?? 1),
      pageSize: Number(url.searchParams.get('pageSize') ?? 20),
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return apiError(e);
  }
}
