import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/server/services/tenant';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';


/** PATCH /api/admin/organizations/:id — isActive / devise (super admin). */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    const { updateAdminOrg } = await import('@/server/services/admin');
    const body = await req.json().catch(() => null);
    const updated = await updateAdminOrg(id, body as never);
    return NextResponse.json({ ok: true, org: { id: updated.id, name: updated.name, isActive: updated.isActive, currency: updated.currency } });
  } catch (e) {
    return apiError(e);
  }
}

/** DELETE /api/admin/organizations/:id — suppression dure (409 si sub active). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    const { deleteAdminOrg } = await import('@/server/services/admin');
    await deleteAdminOrg(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
