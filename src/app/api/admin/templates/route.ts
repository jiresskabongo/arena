import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/server/services/tenant';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';


/** GET /api/admin/templates — templates plateforme (scope=all inclut orgs). */
export async function GET(req: Request) {
  try {
    await requireSuperAdmin();
    const { listAdminTemplates } = await import('@/server/services/admin');
    const url = new URL(req.url);
    const res = await listAdminTemplates({
      page: Number(url.searchParams.get('page') ?? 1),
      pageSize: Number(url.searchParams.get('pageSize') ?? 20),
      search: url.searchParams.get('search') ?? undefined,
      scope: url.searchParams.get('scope') === 'all' ? 'all' : 'platform',
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return apiError(e);
  }
}

/** POST /api/admin/templates — création template plateforme. */
export async function POST(req: Request) {
  try {
    await requireSuperAdmin();
    const { createAdminTemplate } = await import('@/server/services/admin');
    const body = await req.json().catch(() => null);
    const tpl = await createAdminTemplate(body as never);
    return NextResponse.json({ ok: true, template: { id: tpl.id, name: tpl.name, status: tpl.status } });
  } catch (e) {
    return apiError(e);
  }
}
