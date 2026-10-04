import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/server/services/tenant';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';


/** GET /api/admin/analytics — métriques descriptives §49 (6 mois). */
export async function GET() {
  try {
    await requireSuperAdmin();
    const { adminAnalytics } = await import('@/server/services/admin');
    return NextResponse.json({ ok: true, analytics: await adminAnalytics() });
  } catch (e) {
    return apiError(e);
  }
}
