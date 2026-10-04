import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/server/services/tenant';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';


/** GET /api/admin/subscriptions?page&pageSize&status&planCode (super admin). */
export async function GET(req: Request) {
  try {
    await requireSuperAdmin();
    const { listAdminSubscriptions } = await import('@/server/services/admin');
    const url = new URL(req.url);
    const res = await listAdminSubscriptions({
      page: Number(url.searchParams.get('page') ?? 1),
      pageSize: Number(url.searchParams.get('pageSize') ?? 20),
      status: url.searchParams.get('status') ?? undefined,
      planCode: url.searchParams.get('planCode') ?? undefined,
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return apiError(e);
  }
}
