import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/server/services/tenant';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';


/** GET /api/admin/dashboard — KPIs plateforme (super admin). */
export async function GET() {
  try {
    await requireSuperAdmin();
    const { adminDashboard } = await import('@/server/services/admin');
    return NextResponse.json({ ok: true, dashboard: await adminDashboard() });
  } catch (e) {
    return apiError(e);
  }
}
