import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/server/services/tenant';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';


/** PATCH /api/admin/events/:id — { status: draft|published|archived }. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    const { updateAdminEvent } = await import('@/server/services/admin');
    const body = await req.json().catch(() => null);
    const updated = await updateAdminEvent(id, String(body?.status ?? ''));
    return NextResponse.json({ ok: true, event: { id: updated.id, status: updated.status, name: updated.name } });
  } catch (e) {
    return apiError(e);
  }
}

/** DELETE /api/admin/events/:id — suppression cascade (invités, scans…). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    const { deleteAdminEvent } = await import('@/server/services/admin');
    await deleteAdminEvent(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
