import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/server/services/tenant';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';


/** GET /api/admin/payments/:id — détail (super admin). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    const { getAdminPayment } = await import('@/server/services/admin');
    const p = await getAdminPayment(id);
    return NextResponse.json({ ok: true, payment: p });
  } catch (e) {
    return apiError(e);
  }
}
