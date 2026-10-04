import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/server/services/tenant';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';


/** PATCH /api/admin/templates/:id — modification. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    const { updateAdminTemplate } = await import('@/server/services/admin');
    const body = await req.json().catch(() => null);
    const tpl = await updateAdminTemplate(id, body as never);
    return NextResponse.json({ ok: true, template: { id: tpl.id, name: tpl.name, status: tpl.status, isFeatured: tpl.isFeatured, isPremium: tpl.isPremium } });
  } catch (e) {
    return apiError(e);
  }
}

/** DELETE /api/admin/templates/:id — archive si référencé, sinon suppression. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    const { deleteAdminTemplate } = await import('@/server/services/admin');
    const res = await deleteAdminTemplate(id);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return apiError(e);
  }
}
