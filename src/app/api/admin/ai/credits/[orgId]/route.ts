import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/server/services/tenant';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';


/** GET /api/admin/ai/credits/:orgId — historique IA de l'org + solde net. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  try {
    await requireSuperAdmin();
    const { orgId } = await params;
    const { listAiCreditsForOrg } = await import('@/server/services/admin');
    const url = new URL(req.url);
    const res = await listAiCreditsForOrg(orgId, {
      page: Number(url.searchParams.get('page') ?? 1),
      pageSize: Number(url.searchParams.get('pageSize') ?? 20),
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return apiError(e);
  }
}

/** POST /api/admin/ai/credits/:orgId — { delta, reason? } : ajustement manuel. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  try {
    await requireSuperAdmin();
    const { orgId } = await params;
    const { adjustAiCredits } = await import('@/server/services/admin');
    const body = await req.json().catch(() => null);
    const row = await adjustAiCredits(orgId, body as never);
    return NextResponse.json({ ok: true, usage: { id: row.id, creditsCost: row.creditsCost, inputSummary: row.inputSummary } });
  } catch (e) {
    return apiError(e);
  }
}
