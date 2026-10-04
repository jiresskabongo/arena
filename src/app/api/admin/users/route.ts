import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/server/services/tenant';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';


/** GET /api/admin/users?page&pageSize&search (super admin). */
export async function GET(req: Request) {
  try {
    await requireSuperAdmin();
    const { listAdminUsers } = await import('@/server/services/admin');
    const url = new URL(req.url);
    const res = await listAdminUsers({
      page: Number(url.searchParams.get('page') ?? 1),
      pageSize: Number(url.searchParams.get('pageSize') ?? 20),
      search: url.searchParams.get('search') ?? undefined,
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return apiError(e);
  }
}
