import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/server/services/tenant';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';


/** PATCH /api/admin/users/:id — drapeau isSuperAdmin (super admin). */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    const { updateAdminUser } = await import('@/server/services/admin');
    const body = await req.json().catch(() => null);
    const updated = await updateAdminUser(id, body as never);
    return NextResponse.json({ ok: true, user: { id: updated.id, isSuperAdmin: updated.isSuperAdmin, email: updated.email } });
  } catch (e) {
    return apiError(e);
  }
}

/** DELETE /api/admin/users/:id — suppression dure (409 si owner d'org active). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    const { deleteAdminUser } = await import('@/server/services/admin');
    await deleteAdminUser(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
