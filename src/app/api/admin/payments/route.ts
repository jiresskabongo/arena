import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/server/services/tenant';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';


/** GET /api/admin/payments?page&pageSize&status&orgId (super admin). */
export async function GET(req: Request) {
  try {
    await requireSuperAdmin();
    const { listAdminPayments } = await import('@/server/services/admin');
    const url = new URL(req.url);
    const res = await listAdminPayments({
      page: Number(url.searchParams.get('page') ?? 1),
      pageSize: Number(url.searchParams.get('pageSize') ?? 20),
      status: url.searchParams.get('status') ?? undefined,
      orgId: url.searchParams.get('orgId') ?? undefined,
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return apiError(e);
  }
}
